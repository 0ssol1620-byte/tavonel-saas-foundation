import { createHash, createHmac } from "node:crypto";
import { assertSafeUrl, safeFetch } from "./safe-url";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  G8 CHANGE-NOTIFY (DECISION-REGISTER S6-15): tell a workspace that a change was processed, and
  leave activation where it is.

  "Activation is always an explicit human decision." (`activation-policy.ts`) is kept as it is.
  What this adds is the other half the register asks for: when a finished compile's candidate
  differs from the World the workspace's AI reads, one signed POST goes to the endpoint registered
  for that workspace. The notification activates nothing. It carries no route, score, prompt or
  internal state -- `ChangeNotificationEvent` is the whole public shape, and the outbox row that
  tracks attempts is a separate type that is never sent.

  The whole feature is behind `TAVONEL_CHANGE_NOTIFY_ENABLED === "1"`, unset in production. Off,
  `runChangeNotifyTurn` reads nothing and sends nothing. On, it still refuses to run unless the
  signing secret and the endpoint registry are both present and valid, and the outbox table
  (`supabase/migrations/20261019150000_change_notify_outbox.sql`) has to exist -- a store error is
  reported, never papered over.

  Detection is a comparison, not a guess: the compile job's recorded candidate digest against the
  workspace's active pointer for the same collection. Same digest, no notification.

  Delivery is at least once. The delivery id is derived from (workspace, collection, candidate),
  so enqueueing the same change twice is one row, and every retry sends the same id and the same
  canonical body. A claim is an optimistic `attempt = N` update, so two overlapping cron turns
  cannot both send one attempt. Bounded backoff, then a dead-letter row with its receipt.

  Registration is operator config, the smallest honest surface while every workspace is set up
  with us anyway: `TAVONEL_CHANGE_NOTIFY_ENDPOINTS` is a JSON object of workspace key to https URL.
  Each workspace gets its own signing key, derived from `TAVONEL_CHANGE_NOTIFY_SECRET`, so one
  receiver's key cannot forge another workspace's notification. No email: that would need a
  provider secret this lane does not hold.

  ponytail: one master secret, per-workspace keys derived from it. Rotating it rotates every
  workspace at once and there is no previous-key window; add per-workspace stored keys when a
  workspace needs to rotate alone.
*/

export const CHANGE_NOTIFY_ENV = {
  enabled: "TAVONEL_CHANGE_NOTIFY_ENABLED",
  secret: "TAVONEL_CHANGE_NOTIFY_SECRET",
  endpoints: "TAVONEL_CHANGE_NOTIFY_ENDPOINTS",
} as const;

export const CHANGE_NOTIFY_HEADERS = {
  deliveryId: "tavonel-delivery-id",
  timestamp: "tavonel-timestamp",
  signature: "tavonel-signature",
} as const;

export const CHANGE_NOTIFY_EVENT_TYPE = "world.candidate_awaiting_activation";
/** How far a receiver should let `tavonel-timestamp` drift from its own clock. */
export const CHANGE_NOTIFY_TOLERANCE_SECONDS = 300;
/** Wait after attempt n (1-based) before attempt n + 1. Attempt `MAX` failing is the dead letter. */
export const CHANGE_NOTIFY_RETRY_DELAYS_SECONDS = [60, 300, 1_800, 7_200, 21_600] as const;
export const CHANGE_NOTIFY_MAX_ATTEMPTS = CHANGE_NOTIFY_RETRY_DELAYS_SECONDS.length + 1;

const WORKSPACE_KEY = /^pilot-[A-Za-z0-9]{1,16}$/;
const COLLECTION_ID = /^collection-[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DELIVERY_ID = /^dlv_[a-f0-9]{32}$/;
const MAX_ENDPOINTS = 50;
const SWEEP_WINDOW_MS = 24 * 60 * 60 * 1_000;
const SWEEP_LIMIT = 50;
const DELIVERY_LIMIT = 5;
const DELIVERY_TIMEOUT_MS = 5_000;

/** The public DTO: every field a receiver gets, and nothing else. */
export type ChangeNotificationEvent = {
  type: typeof CHANGE_NOTIFY_EVENT_TYPE;
  deliveryId: string;
  workspaceKey: string;
  collectionId: string;
  candidateManifestDigest: string;
  activeManifestDigest: string | null;
  processedAt: string;
  reviewRequired: boolean;
  activation: "explicit_human_decision";
};

/** The internal outbox row. Never serialized to a receiver. */
type OutboxRow = {
  delivery_id: string;
  workspace_key: string;
  event: ChangeNotificationEvent;
  state: "pending" | "delivered" | "dead";
  attempt: number;
  available_at: string;
  created_at: string;
};

export type ChangeNotifyConfig = { secret: string; endpoints: ReadonlyMap<string, string> };

export function readChangeNotifyConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { enabled: true; config: ChangeNotifyConfig } | { enabled: false; code: string } {
  if (env[CHANGE_NOTIFY_ENV.enabled] !== "1") return { enabled: false, code: "CHANGE_NOTIFY_DISABLED" };
  const secret = env[CHANGE_NOTIFY_ENV.secret]?.trim() ?? "";
  if (secret.length < 32) return { enabled: false, code: "CHANGE_NOTIFY_SECRET_MISSING" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(env[CHANGE_NOTIFY_ENV.endpoints] ?? "");
  } catch {
    return { enabled: false, code: "CHANGE_NOTIFY_ENDPOINTS_INVALID" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { enabled: false, code: "CHANGE_NOTIFY_ENDPOINTS_INVALID" };
  const entries = Object.entries(parsed as Record<string, unknown>);
  // One bad entry refuses the registry rather than dropping that workspace silently.
  if (entries.length > MAX_ENDPOINTS || entries.some(([key, url]) =>
    !WORKSPACE_KEY.test(key) || typeof url !== "string" || !assertSafeUrl(url).ok)) {
    return { enabled: false, code: "CHANGE_NOTIFY_ENDPOINTS_INVALID" };
  }
  return { enabled: true, config: { secret, endpoints: new Map(entries as Array<[string, string]>) } };
}

/** The key handed to one workspace's receiver. Derived, so no key is stored anywhere. */
export function workspaceSigningKey(secret: string, workspaceKey: string) {
  return createHmac("sha256", secret).update(`tavonel-change-notify-v1:${workspaceKey}`).digest("hex");
}

export function signChangeNotification(signingKey: string, deliveryId: string, timestamp: string, body: string) {
  return `v1=${createHmac("sha256", signingKey).update(`${deliveryId}.${timestamp}.${body}`).digest("hex")}`;
}

/** Sorted keys, no whitespace: the same event is the same bytes on every attempt. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function changeDeliveryId(workspaceKey: string, collectionId: string, candidateManifestDigest: string) {
  return `dlv_${createHash("sha256").update(`${workspaceKey}\n${collectionId}\n${candidateManifestDigest}`).digest("hex").slice(0, 32)}`;
}

export type ChangeNotifyTurn =
  | { code: string; enabled: false }
  | { code: "OK" | "CHANGE_NOTIFY_INCOMPLETE"; enabled: true; enqueued: number; delivered: number; retrying: number; dead: number; errors: string[] };

const TABLE = "/rest/v1/foundation_change_notifications";

async function rows(config: NonNullable<ReturnType<typeof readSupabaseAdminConfig>>, path: string, init?: RequestInit) {
  try {
    const response = await supabaseAdminRequest(config, path, init);
    if (!response.ok) return null;
    const text = await response.text();
    if (text === "") return [];
    const body = JSON.parse(text) as unknown;
    return Array.isArray(body) ? (body as Array<Record<string, unknown>>) : null;
  } catch {
    return null;
  }
}

/**
 * One cron turn: find changes, enqueue them, deliver what is due.
 *
 * Off (the production value) it returns before any read. Every store failure is named in
 * `errors`, so a turn that did nothing because the table is missing does not look like a quiet one.
 */
export async function runChangeNotifyTurn(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: () => Date = () => new Date(),
): Promise<ChangeNotifyTurn> {
  const read = readChangeNotifyConfig(env);
  if (!read.enabled) return { code: read.code, enabled: false };
  const store = readSupabaseAdminConfig(env);
  const result = { code: "OK" as "OK" | "CHANGE_NOTIFY_INCOMPLETE", enabled: true as const, enqueued: 0, delivered: 0, retrying: 0, dead: 0, errors: [] as string[] };
  if (!store) return { ...result, code: "CHANGE_NOTIFY_INCOMPLETE", errors: ["CHANGE_NOTIFY_STORE_NOT_CONFIGURED"] };
  const { endpoints, secret } = read.config;
  if (endpoints.size === 0) return result;

  // 1. Detect: newest candidate per (workspace, collection) whose digest is not the active one.
  // Only registered workspaces are read, and every event is built from its own row's workspace.
  const workspaces = [...endpoints.keys()];
  const since = new Date(now().getTime() - SWEEP_WINDOW_MS).toISOString();
  const jobs = await rows(store, `/rest/v1/foundation_compile_jobs?${new URLSearchParams({
    select: "workspace_key,collection_id,candidate_manifest_digest,state,updated_at",
    workspace_key: `in.(${workspaces.join(",")})`,
    state: "in.(ready,review_required)",
    candidate_manifest_digest: "not.is.null",
    updated_at: `gte.${since}`,
    order: "updated_at.desc",
    limit: String(SWEEP_LIMIT),
  })}`);
  if (!jobs) result.errors.push("CHANGE_NOTIFY_SWEEP_READ_FAILED");
  const newest = new Map<string, Record<string, unknown>>();
  for (const job of jobs ?? []) {
    const ws = String(job.workspace_key), collection = String(job.collection_id), digest = String(job.candidate_manifest_digest);
    if (!endpoints.has(ws) || !COLLECTION_ID.test(collection) || !SHA256.test(digest)) continue;
    if (!newest.has(`${ws}/${collection}`)) newest.set(`${ws}/${collection}`, job);
  }
  if (newest.size > 0) {
    const collections = [...new Set([...newest.values()].map((job) => String(job.collection_id)))];
    const pointers = await rows(store, `/rest/v1/foundation_active_worlds?${new URLSearchParams({
      select: "workspace_key,collection_id,manifest_digest",
      workspace_key: `in.(${workspaces.join(",")})`,
      collection_id: `in.(${collections.join(",")})`,
    })}`);
    if (!pointers) result.errors.push("CHANGE_NOTIFY_POINTER_READ_FAILED");
    else {
      const active = new Map(pointers.map((row) => [`${row.workspace_key}/${row.collection_id}`, String(row.manifest_digest)]));
      const fresh = [...newest.entries()].flatMap(([pair, job]) => {
        const activeDigest = active.get(pair);
        const candidate = String(job.candidate_manifest_digest);
        if (activeDigest === candidate) return [];
        const workspaceKey = String(job.workspace_key), collectionId = String(job.collection_id);
        const deliveryId = changeDeliveryId(workspaceKey, collectionId, candidate);
        const event: ChangeNotificationEvent = {
          type: CHANGE_NOTIFY_EVENT_TYPE, deliveryId, workspaceKey, collectionId,
          candidateManifestDigest: candidate,
          activeManifestDigest: activeDigest && SHA256.test(activeDigest) ? activeDigest : null,
          processedAt: String(job.updated_at),
          reviewRequired: job.state === "review_required",
          activation: "explicit_human_decision",
        };
        return [{ delivery_id: deliveryId, workspace_key: workspaceKey, event }];
      });
      if (fresh.length > 0) {
        // The primary key is the delivery id: a change already enqueued, delivered or dead is a no-op.
        const inserted = await rows(store, `${TABLE}?on_conflict=delivery_id`, {
          method: "POST",
          headers: { prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify(fresh),
        });
        if (!inserted) result.errors.push("CHANGE_NOTIFY_ENQUEUE_FAILED");
        else result.enqueued = inserted.length;
      }
    }
  }

  // 2. Deliver what is due, in parallel so the turn's wall clock is one timeout, not five.
  const due = await rows(store, `${TABLE}?${new URLSearchParams({
    select: "delivery_id,workspace_key,event,state,attempt,available_at,created_at",
    state: "eq.pending",
    available_at: `lte.${now().toISOString()}`,
    order: "available_at.asc",
    limit: String(DELIVERY_LIMIT),
  })}`);
  if (!due) {
    result.errors.push("CHANGE_NOTIFY_DUE_READ_FAILED");
  } else {
    const outcomes = await Promise.all(due.map((row) => deliverOne(store, row as unknown as OutboxRow, endpoints, secret, now)));
    for (const outcome of outcomes) {
      if (outcome === "delivered") result.delivered += 1;
      else if (outcome === "retrying") result.retrying += 1;
      else if (outcome === "dead") result.dead += 1;
      else if (outcome !== "lost") result.errors.push(outcome);
    }
  }
  if (result.errors.length > 0) {
    console.error("change-notify turn errors", { errors: result.errors });
    result.code = "CHANGE_NOTIFY_INCOMPLETE";
  }
  return result;
}

async function deliverOne(
  store: NonNullable<ReturnType<typeof readSupabaseAdminConfig>>,
  row: OutboxRow,
  endpoints: ReadonlyMap<string, string>,
  secret: string,
  now: () => Date,
): Promise<"delivered" | "retrying" | "dead" | "lost" | string> {
  if (!DELIVERY_ID.test(row.delivery_id) || !WORKSPACE_KEY.test(row.workspace_key) || !Number.isInteger(row.attempt)) {
    return "CHANGE_NOTIFY_ROW_INVALID";
  }
  const guard = (attempt: number) => `${TABLE}?${new URLSearchParams({
    delivery_id: `eq.${row.delivery_id}`, workspace_key: `eq.${row.workspace_key}`, state: "eq.pending", attempt: `eq.${attempt}`,
  })}`;
  const patch = (attempt: number, fields: Record<string, unknown>) => rows(store, guard(attempt), {
    method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(fields),
  });
  const body = canonicalJson(row.event);
  const bury = async (attempt: number, lastStatus: number | null, lastError: string) => {
    const deadAt = now().toISOString();
    const receipt = {
      deliveryId: row.delivery_id, workspaceKey: row.workspace_key, eventType: row.event?.type ?? null,
      attempts: attempt, lastStatus, lastError, bodySha256: createHash("sha256").update(body).digest("hex"),
      enqueuedAt: row.created_at, deadAt,
    };
    const settled = await patch(attempt, { state: "dead", dead_at: deadAt, last_status: lastStatus, last_error: lastError, dead_letter_receipt: receipt });
    return settled === null ? "CHANGE_NOTIFY_SETTLE_FAILED" : settled.length === 1 ? "dead" : "lost";
  };

  // A workspace whose endpoint was withdrawn, or the event of another tenant reaching this row,
  // is never sent anywhere else: it is buried with its reason.
  const endpoint = endpoints.get(row.workspace_key);
  if (!endpoint || row.event?.workspaceKey !== row.workspace_key || row.event?.deliveryId !== row.delivery_id) {
    return bury(row.attempt, null, endpoint ? "CHANGE_NOTIFY_ROW_MISMATCH" : "CHANGE_NOTIFY_ENDPOINT_NOT_REGISTERED");
  }
  // A worker that died after claiming the last attempt left it pending; settle it, do not resend.
  if (row.attempt >= CHANGE_NOTIFY_MAX_ATTEMPTS) return bury(row.attempt, null, "CHANGE_NOTIFY_ATTEMPTS_EXHAUSTED");

  // Claim attempt n + 1 and schedule its retry in the same write: a crash after this line is a
  // retry at the scheduled time, never a lost notification and never a second sender.
  const attempt = row.attempt + 1;
  const delay = CHANGE_NOTIFY_RETRY_DELAYS_SECONDS[Math.min(attempt, CHANGE_NOTIFY_RETRY_DELAYS_SECONDS.length) - 1]!;
  const claimed = await patch(row.attempt, { attempt, available_at: new Date(now().getTime() + delay * 1_000).toISOString() });
  if (claimed === null) return "CHANGE_NOTIFY_CLAIM_FAILED";
  if (claimed.length !== 1) return "lost";

  const timestamp = String(Math.floor(now().getTime() / 1_000));
  const response = await safeFetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "TAVONEL-Change-Notify/1",
      [CHANGE_NOTIFY_HEADERS.deliveryId]: row.delivery_id,
      [CHANGE_NOTIFY_HEADERS.timestamp]: timestamp,
      [CHANGE_NOTIFY_HEADERS.signature]: signChangeNotification(workspaceSigningKey(secret, row.workspace_key), row.delivery_id, timestamp, body),
    },
    body,
  }, { maxRedirects: 0, timeoutMs: DELIVERY_TIMEOUT_MS, maxResponseBytes: 4_096 });
  const status = response.ok ? response.status : null;
  const error = response.ok ? (status! >= 200 && status! < 300 ? null : `HTTP_${status}`) : response.code;

  if (error === null) {
    // ACK after the receiver said 2xx. If this write fails the row retries and the receiver
    // dedupes by delivery id -- at least once, by construction.
    const settled = await patch(attempt, { state: "delivered", delivered_at: now().toISOString(), last_status: status, last_error: null });
    return settled === null ? "CHANGE_NOTIFY_SETTLE_FAILED" : "delivered";
  }
  if (attempt >= CHANGE_NOTIFY_MAX_ATTEMPTS) return bury(attempt, status, error);
  const recorded = await patch(attempt, { last_status: status, last_error: error });
  return recorded === null ? "CHANGE_NOTIFY_SETTLE_FAILED" : "retrying";
}
