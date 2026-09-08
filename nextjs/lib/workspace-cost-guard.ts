import { createHmac, timingSafeEqual } from "node:crypto";

/*
  Two cheap requests that are expensive to serve (blueprint §32, S-21 and S-22).

  `/ask` costs a caller one HTTP request and costs this deployment an embedder, a reranker and a
  Core turn. A signed export costs a caller one GET and costs this deployment a zip build and a
  signature over the whole package. Neither had any application-level cost control at all: the
  edge limit is 60/min keyed on IP, which is a limit on one attacker's laptop and not a limit on
  one workspace, one API key, or one retry loop.

  Three controls here, and one deliberately absent:

    CONCURRENCY -- at most N in-flight requests of a given kind per workspace. Not a rate limit:
                   a rate limit lets sixty requests start at once and then sleeps, which is the
                   shape that exhausts a connection pool. This bounds what is running.

    TIMEOUT     -- a slot that is never released is a workspace that can never ask again, so
                   every slot carries a deadline and is reclaimed past it. The routes also carry
                   Next's own `maxDuration`, which is the platform's version of the same promise.

    IDEMPOTENCY -- a retry that carries the same `Idempotency-Key` collapses onto the first
                   attempt instead of paying for the work twice. A second key with a different
                   body is a client bug and is refused rather than silently answered from the
                   first one's result.

  ABSENT: the compute reservation §32 also asks for. `reserveFoundationCompute` is the only
  reservation primitive in this repository and it debits a customer's credits
  (lib/compute-reservation.ts:56, `p_reserved_credits`). Charging for a question that has never
  been charged for is a pricing decision, not a security fix, so it is not made here. The
  concurrency, timeout and idempotency halves are; see the lane report's FOUNDER_DECISION row.

  ponytail: per-process state, like the contact limiter above it. On Vercel this bounds one
  instance rather than the deployment, which is a real ceiling and is why the durable version is
  a Postgres advisory-lock or a counter RPC in the same migration as
  `consume_public_form_rate_limit`. Recorded rather than pretended: the numbers below are per
  instance and the report says so.
*/

export const WORKSPACE_ASK_CONCURRENCY = 4;
export const WORKSPACE_EXPORT_CONCURRENCY = 2;
const SLOT_TIMEOUT_MS = 60_000;
const IDEMPOTENCY_TTL_MS = 10 * 60_000;

type Slot = { expiresAt: number };
const slots = new Map<string, Slot[]>();

type Replay = { bodyDigest: string; expiresAt: number; value: unknown };
const replays = new Map<string, Replay>();

/**
 * The bucket key never contains the workspace key itself.
 *
 * The same reason the contact limiter salts its key: a process-local map is a place tenant
 * identifiers accumulate, and a heap dump or an error that serialises one is a cross-tenant
 * disclosure of who is using the product. The HMAC salt is per process and never leaves it.
 */
const SALT = createHmac("sha256", "workspace-cost-guard").update(String(process.pid)).digest();

function bucketKey(scope: string, workspaceKey: string) {
  return `${scope}:${createHmac("sha256", SALT).update(workspaceKey).digest("base64url")}`;
}

function live(list: Slot[], now: number) {
  return list.filter((slot) => slot.expiresAt > now);
}

export type SlotLease = { ok: true; release: () => void } | { ok: false; code: "WORKSPACE_CONCURRENCY_LIMIT" };

/**
 * Take one concurrency slot for this workspace, or refuse.
 *
 * `release` is idempotent and safe to call from a `finally`: a route that throws must not leave
 * the slot held until the deadline, and a route that releases twice must not free somebody
 * else's slot.
 */
export function acquireWorkspaceSlot(
  scope: string,
  workspaceKey: string,
  limit: number,
  now = Date.now(),
): SlotLease {
  const key = bucketKey(scope, workspaceKey);
  const held = live(slots.get(key) ?? [], now);
  if (held.length >= limit) {
    slots.set(key, held);
    return { ok: false, code: "WORKSPACE_CONCURRENCY_LIMIT" };
  }
  const slot: Slot = { expiresAt: now + SLOT_TIMEOUT_MS };
  held.push(slot);
  slots.set(key, held);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const current = slots.get(key);
      if (!current) return;
      const index = current.indexOf(slot);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) slots.delete(key);
    },
  };
}

function digestOf(value: string) {
  return createHmac("sha256", SALT).update(value).digest("base64url");
}

function sameDigest(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type IdempotencyVerdict<T> =
  | { ok: true; replay: false }
  | { ok: true; replay: true; value: T }
  | { ok: false; code: "IDEMPOTENCY_KEY_INVALID" | "IDEMPOTENCY_CONFLICT" };

/** `Idempotency-Key` as the standard spells it: opaque, bounded, and printable. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{8,128}$/;

/**
 * What to do with a request that carries an idempotency key.
 *
 * The conflict case is the one worth being strict about. Answering a second, different request
 * from the first one's stored result is how a client ends up acting on an answer to a question
 * it did not ask, so a reused key with a different body is a 409 rather than a replay.
 */
export function checkIdempotency<T>(
  scope: string,
  workspaceKey: string,
  key: string | null,
  body: string,
  now = Date.now(),
): IdempotencyVerdict<T> {
  if (key === null) return { ok: true, replay: false };
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) return { ok: false, code: "IDEMPOTENCY_KEY_INVALID" };
  const mapKey = `${bucketKey(scope, workspaceKey)}:${key}`;
  const stored = replays.get(mapKey);
  const bodyDigest = digestOf(body);
  if (!stored || stored.expiresAt <= now) {
    replays.delete(mapKey);
    return { ok: true, replay: false };
  }
  if (!sameDigest(stored.bodyDigest, bodyDigest)) return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
  return { ok: true, replay: true, value: stored.value as T };
}

/** Record a completed result so the next retry with this key replays instead of re-running. */
export function rememberIdempotent(
  scope: string,
  workspaceKey: string,
  key: string | null,
  body: string,
  value: unknown,
  now = Date.now(),
) {
  if (key === null || !IDEMPOTENCY_KEY_PATTERN.test(key)) return;
  for (const [mapKey, entry] of replays) if (entry.expiresAt <= now) replays.delete(mapKey);
  replays.set(`${bucketKey(scope, workspaceKey)}:${key}`, {
    bodyDigest: digestOf(body),
    expiresAt: now + IDEMPOTENCY_TTL_MS,
    value,
  });
}

/** Test seam: the guards are process state, and a test that leaks it into the next test lies. */
export function resetWorkspaceCostGuard() {
  slots.clear();
  replays.clear();
}
