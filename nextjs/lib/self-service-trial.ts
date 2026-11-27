import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { getFoundationSelfServiceTrial } from "./account-grants";
import { previousBillingHmac } from "./billing-binding";
import { billingSecret } from "./billing-secrets";
import {
  billingProductDecision,
  planReachesLevel,
  resolveWorkspaceEntitlement,
  type ProductAccessLevel,
} from "./billing-product-access";
import { readAccessMode } from "./foundation-pilot";
import { collectionCandidateKey } from "./immutable-keys";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { ACTIVE_WORLD_PAGE_MAX, listFoundationActiveWorlds } from "./world-store";

const DEVICE_COOKIE = "tvnl_device";
const DEVICE_ID = /^[a-f0-9]{32}$/;
const SIGNATURE = /^[a-f0-9]{64}$/;
const WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SessionAccessSource = "owner" | "paid" | "trial";

export type EffectiveSessionAccess = {
  source: SessionAccessSource;
  accessPlan: "observer_access" | "studio_access";
  billingExempt: boolean;
  expiresAt: string | null;
};

type SessionUser = {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown>;
};

function hmac(secret: string, domain: string, value: string) {
  return createHmac("sha256", secret).update(`${domain}\0${value}`, "utf8").digest("hex");
}

function readTrialSecret(env: Readonly<Record<string, string | undefined>> = process.env) {
  // Reuse the already-operated billing HMAC, but domain-separate every trial use. This avoids a
  // second secret-management surface while ensuring a device token can never be replayed as a
  // checkout binding or vice versa.
  return billingSecret("FOUNDATION_BILLING_HMAC", env) ?? null;
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function verifyDeviceCookie(value: string | null, secret: string) {
  if (!value) return null;
  const [version, id, signature] = value.split(".");
  if (version !== "v1" || !DEVICE_ID.test(id ?? "") || !SIGNATURE.test(signature ?? "")) return null;
  const expected = hmac(secret, "tavonel-trial-device-token/v1", id);
  try {
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))) return null;
  } catch {
    return null;
  }
  return id;
}

function issueDeviceCookie(secret: string, id = randomBytes(16).toString("hex")) {
  const signature = hmac(secret, "tavonel-trial-device-token/v1", id);
  return {
    id,
    header: `${DEVICE_COOKIE}=v1.${id}.${signature}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
  };
}

function normalizeIpPrefix(request: Request, fallback: string) {
  const raw = (request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "")
    .split(",")[0]?.trim();
  if (!raw || isIP(raw) === 0) return `unavailable:${fallback}`;
  if (isIP(raw) === 4) {
    const parts = raw.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  // Vercel forwards IPv6 in canonical form. /56 is intentionally coarse: useful for velocity,
  // not a persistent network identifier, and only the HMAC of this value is stored.
  const chunks = raw.toLowerCase().split(":");
  return `${chunks.slice(0, 4).join(":")}::/56`;
}

export async function authorizeFoundationSessionProduct(
  workspaceKey: string,
  userId: string,
  required: ProductAccessLevel,
) {
  // The workspace's grant and account (WO-C-T2): the caller's own in their own workspace, the
  // workspace payer's for an active admin or member.
  const entitlement = await resolveWorkspaceEntitlement(workspaceKey, userId);
  if (!entitlement.ok) return entitlement;
  if (entitlement.grant) {
    if (!planReachesLevel(entitlement.grant.accessPlan, required)) {
      return { ok: false as const, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
    }
    return {
      ok: true as const,
      access: {
        source: "owner" as const,
        accessPlan: entitlement.grant.accessPlan,
        billingExempt: entitlement.grant.billingExempt,
        expiresAt: null,
      } satisfies EffectiveSessionAccess,
    };
  }

  const paid = billingProductDecision(entitlement.account, required);
  if (paid.ok) {
    return {
      ok: true as const,
      access: {
        source: "paid" as const,
        accessPlan: entitlement.account.accessPlan as "observer_access" | "studio_access",
        billingExempt: false,
        expiresAt: null,
      } satisfies EffectiveSessionAccess,
    };
  }
  // A free evaluation is one person's: a member never draws on the owner's (reserve_foundation_compute_v3).
  if (entitlement.member) return { ok: false as const, code: paid.code, status: paid.status };

  const trialResult = await getFoundationSelfServiceTrial(workspaceKey, userId);
  if (!trialResult.ok) return { ok: false as const, code: trialResult.code, status: 503 };
  const trial = trialResult.trial;
  if (trial?.status === "trialing" && Date.parse(trial.expiresAt) > Date.now()) {
    if (required === "studio") return { ok: false as const, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
    // The free evaluation has no connector scope (trial-ai-access.ts). Same code the session
    // path already answers a trial's `connections:*` scope with.
    if (required === "connections") return { ok: false as const, code: "TRIAL_FEATURE_NOT_INCLUDED", status: 402 };
    return {
      ok: true as const,
      access: {
        source: "trial" as const,
        accessPlan: "observer_access" as const,
        billingExempt: true,
        expiresAt: trial.expiresAt,
      } satisfies EffectiveSessionAccess,
    };
  }

  return { ok: false as const, code: paid.code, status: paid.status };
}

export type TrialBootstrapResult =
  | { ok: true; access: EffectiveSessionAccess; setCookie?: string; limits?: { files: number; pages: number; worlds: number } }
  | { ok: false; code: string; status: number; setCookie?: string };

export async function bootstrapFoundationSelfServiceTrial(
  request: Request,
  user: SessionUser,
  workspaceKey: string,
): Promise<TrialBootstrapResult> {
  if (!UUID.test(user.id) || !WORKSPACE.test(workspaceKey)) {
    return { ok: false, code: "TRIAL_BOOTSTRAP_INVALID", status: 400 };
  }

  // Owner and paid access do not need a device/IP signal at all. Keep those identities out of
  // the abuse ledger; it is for free-compute decisions, not for tracking paying users.
  const existing = await authorizeFoundationSessionProduct(workspaceKey, user.id, "observer");
  if (existing.ok && existing.access.source !== "trial") return { ok: true, access: existing.access };

  if (readAccessMode() !== "self_service") {
    return { ok: false, code: "SELF_SERVICE_NOT_ENABLED", status: 403 };
  }
  const provider = typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "";
  if (provider !== "google") return { ok: false, code: "GOOGLE_SIGN_IN_REQUIRED", status: 403 };

  const secret = readTrialSecret();
  if (!secret) return { ok: false, code: "TRIAL_RISK_GATE_NOT_CONFIGURED", status: 503 };

  const cookie = readCookie(request, DEVICE_COOKIE);
  let deviceId = verifyDeviceCookie(cookie, secret);
  let setCookie: string | undefined;
  if (!deviceId) {
    // A token signed before a FOUNDATION_BILLING_HMAC rotation keeps its device id and is re-signed
    // with the current key at once: the previous key only ever verifies.
    const previous = previousBillingHmac();
    const rotated = previous ? verifyDeviceCookie(cookie, previous) : null;
    const issued = issueDeviceCookie(secret, rotated ?? undefined);
    deviceId = issued.id;
    setCookie = issued.header;
  }
  const ipPrefix = normalizeIpPrefix(request, deviceId);
  const deviceHash = `hmac256:${hmac(secret, "tavonel-trial-device-hash/v1", deviceId)}`;
  const ipPrefixHash = `hmac256:${hmac(secret, "tavonel-trial-ip-prefix/v1", ipPrefix)}`;

  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "TRIAL_STORE_NOT_CONFIGURED", status: 503, setCookie };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/bootstrap_foundation_self_service_trial", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: user.id,
        p_workspace_key: workspaceKey,
        p_device_hash: deviceHash,
        p_ip_prefix_hash: ipPrefixHash,
        p_provider: provider,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { ok: false, code: "TRIAL_BOOTSTRAP_FAILED", status: 503, setCookie };
  }
  if (!response.ok) return { ok: false, code: "TRIAL_BOOTSTRAP_FAILED", status: 503, setCookie };
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.status !== "string") {
    return { ok: false, code: "TRIAL_BOOTSTRAP_RECEIPT_INVALID", status: 503, setCookie };
  }
  if (body.status === "denied") {
    const code = typeof body.code === "string" ? body.code : "TRIAL_NOT_AVAILABLE";
    return { ok: false, code, status: code === "TRIAL_REVIEW_REQUIRED" ? 429 : 403, setCookie };
  }
  if (body.status === "owner") {
    return {
      ok: true,
      access: { source: "owner", accessPlan: body.accessPlan === "observer_access" ? "observer_access" : "studio_access", billingExempt: body.billingExempt === true, expiresAt: null },
      setCookie,
    };
  }
  if (body.status === "paid") {
    return {
      ok: true,
      access: { source: "paid", accessPlan: body.accessPlan === "studio_access" ? "studio_access" : "observer_access", billingExempt: false, expiresAt: null },
      setCookie,
    };
  }
  if (body.status !== "trial" || typeof body.expiresAt !== "string"
    || typeof body.fileLimit !== "number" || typeof body.pageLimit !== "number" || typeof body.worldLimit !== "number") {
    return { ok: false, code: "TRIAL_BOOTSTRAP_RECEIPT_INVALID", status: 503, setCookie };
  }
  return {
    ok: true,
    access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: body.expiresAt },
    setCookie,
    limits: { files: body.fileLimit, pages: body.pageLimit, worlds: body.worldLimit },
  };
}

export function trialFeatureBlocked(scope: string) {
  return scope.startsWith("connections:");
}

/*
  WO-TRIAL-P0 (2026-11-27). A free evaluation whose compile settled `review_required` could never
  activate it -- promote refuses it with `validatePromotableCollectionArtifact` -- and could not
  compile again either, because this check counted that job as the evaluation's one World. The
  customer was left with no World and no way forward.

  A settled `review_required` job whose own candidate fails the promote route's predicate, and
  whose collection has no active World, is therefore not a World. It is a spent attempt instead,
  and attempts are bounded: compute is spent on each one. Everything else still counts as before
  (`ready`, and every unfinished state, because an unfinished job may still become the World).
  Owner decision (founder delegation): the owner may not override the review reasons.
*/
/** Compiles of one free evaluation that may end in a version nobody can activate. The third is refused. */
export const TRIAL_NON_PROMOTABLE_COMPILE_LIMIT = 2;
/** Rows read per check. A full page is not a complete answer, so it never allows. */
const TRIAL_COMPILE_SCAN = 20;

export type TrialCompileCapacity =
  | { ok: false; code: string }
  | { ok: true; allowed: true }
  | { ok: true; allowed: false; code: "TRIAL_WORLD_LIMIT_REACHED" | "TRIAL_COMPILE_ATTEMPTS_EXHAUSTED" };

type TrialJobRow = { state?: unknown; collection_id?: unknown; candidate_manifest_digest?: unknown };

/** true: this job's candidate can never be activated. false: count it as a World. null: could not read. */
async function settledWithoutWorld(
  workspaceKey: string,
  row: TrialJobRow,
  activeCollections: () => Promise<Set<string> | null>,
): Promise<boolean | null> {
  const collectionId = typeof row.collection_id === "string" ? row.collection_id : "";
  const digest = typeof row.candidate_manifest_digest === "string" ? row.candidate_manifest_digest : "";
  const key = digest.startsWith("sha256:") ? collectionCandidateKey(workspaceKey, collectionId, digest.slice(7)) : "";
  // Nothing to read the verdict from: it keeps counting, which is the old answer.
  if (!key) return false;
  const active = await activeCollections();
  if (!active) return null;
  if (active.has(collectionId)) return false;
  const signer = readR2SignerEnv();
  if (!signer) return null;
  // Loaded only here: every route that authorizes through developer-auth imports this module, and
  // none of them needs the compiler's validator in its graph.
  const [{ getWorkspaceCollectionCandidate }, { validatePromotableCollectionArtifact }] = await Promise.all([
    import("./r2-objects"), import("./collection-download"),
  ]);
  const loaded = await getWorkspaceCollectionCandidate(signer, workspaceKey, key);
  // Review T-1: deleting a source deletes its candidate (migration 20260930010000) and keeps the job row.
  // A definite absence can never be promoted, so it is a spent attempt (still capped); any other failure refuses.
  if (!loaded.ok) return loaded.code === "NOT_FOUND" ? true : null;
  return validatePromotableCollectionArtifact(loaded.json, collectionId) === null;
}

export async function checkTrialCompileCapacity(
  workspaceKey: string,
  userId: string,
  idempotencyKey?: string,
): Promise<TrialCompileCapacity> {
  const trialResult = await getFoundationSelfServiceTrial(workspaceKey, userId);
  if (!trialResult.ok) return { ok: false as const, code: trialResult.code };
  if (!trialResult.trial || trialResult.trial.status !== "trialing") return { ok: true as const, allowed: true };
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "TRIAL_STORE_NOT_CONFIGURED" };

  if (idempotencyKey) {
    const same = new URLSearchParams({
      select: "job_id",
      workspace_key: `eq.${workspaceKey}`,
      idempotency_key: `eq.${idempotencyKey}`,
      limit: "1",
    });
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_compile_jobs?${same}`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { ok: false as const, code: "TRIAL_COMPILE_CHECK_FAILED" };
    const rows = await response.json().catch(() => []) as unknown[];
    if (rows.length > 0) return { ok: true as const, allowed: true };
  }

  const policyResponse = await supabaseAdminRequest(config,
    "/rest/v1/foundation_trial_policy?select=world_limit&policy_key=eq.default&limit=1",
    { signal: AbortSignal.timeout(5_000) });
  if (!policyResponse.ok) return { ok: false as const, code: "TRIAL_COMPILE_CHECK_FAILED" };
  const policyRows = await policyResponse.json().catch(() => []) as Array<{ world_limit?: unknown }>;
  const limit = Number(policyRows[0]?.world_limit ?? 1);

  const worldLimit = Math.max(1, limit);

  const jobs = new URLSearchParams({
    select: "job_id,state,collection_id,candidate_manifest_digest",
    workspace_key: `eq.${workspaceKey}`,
    state: "not.in.(failed,cancelled)",
    order: "created_at.asc",
    limit: String(TRIAL_COMPILE_SCAN),
  });
  const response = await supabaseAdminRequest(config, `/rest/v1/foundation_compile_jobs?${jobs}`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return { ok: false as const, code: "TRIAL_COMPILE_CHECK_FAILED" };
  const rows = await response.json().catch(() => null) as TrialJobRow[] | null;
  if (!Array.isArray(rows)) return { ok: false as const, code: "TRIAL_COMPILE_CHECK_FAILED" };

  const review = rows.filter((row) => row?.state === "review_required");
  let worldBearing = rows.length - review.length;
  let spentAttempts = 0;
  if (worldBearing >= worldLimit) return { ok: true as const, allowed: false, code: "TRIAL_WORLD_LIMIT_REACHED" };

  let active: Promise<Set<string> | null> | null = null;
  const activeCollections = () => active ??= listFoundationActiveWorlds(workspaceKey, { limit: ACTIVE_WORLD_PAGE_MAX })
    .then((read) => read.ok && read.nextCursor === null ? new Set(read.worlds.map((world) => world.collectionId)) : null);
  // At most worldLimit + TRIAL_NON_PROMOTABLE_COMPILE_LIMIT candidate reads: every row moves one counter.
  for (const row of review) {
    const dead = await settledWithoutWorld(workspaceKey, row, activeCollections);
    if (dead === null) return { ok: false as const, code: "TRIAL_COMPILE_CHECK_FAILED" };
    if (dead) spentAttempts += 1;
    else worldBearing += 1;
    if (worldBearing >= worldLimit) return { ok: true as const, allowed: false, code: "TRIAL_WORLD_LIMIT_REACHED" };
    if (spentAttempts >= TRIAL_NON_PROMOTABLE_COMPILE_LIMIT) {
      return { ok: true as const, allowed: false, code: "TRIAL_COMPILE_ATTEMPTS_EXHAUSTED" };
    }
  }
  // Every refusal above only grows with more rows; an allow read from a full page may be wrong.
  if (rows.length >= TRIAL_COMPILE_SCAN) return { ok: false as const, code: "TRIAL_COMPILE_CHECK_FAILED" };
  return { ok: true as const, allowed: true };
}
