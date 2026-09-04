import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { getFoundationAccountGrant, getFoundationSelfServiceTrial } from "./account-grants";
import { billingProductDecision, type ProductAccessLevel } from "./billing-product-access";
import { getFoundationBillingAccount } from "./billing-store";
import { readAccessMode } from "./foundation-pilot";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

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
  const secret = env.FOUNDATION_BILLING_HMAC?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
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

function issueDeviceCookie(secret: string) {
  const id = randomBytes(16).toString("hex");
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

function planAllows(accessPlan: "observer_access" | "studio_access", required: ProductAccessLevel) {
  return required === "observer" || accessPlan === "studio_access";
}

export async function authorizeFoundationSessionProduct(
  workspaceKey: string,
  userId: string,
  required: ProductAccessLevel,
) {
  const grantResult = await getFoundationAccountGrant(userId);
  if (!grantResult.ok) return { ok: false as const, code: grantResult.code, status: 503 };
  if (grantResult.grant) {
    if (!planAllows(grantResult.grant.accessPlan, required)) {
      return { ok: false as const, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
    }
    return {
      ok: true as const,
      access: {
        source: "owner" as const,
        accessPlan: grantResult.grant.accessPlan,
        billingExempt: grantResult.grant.billingExempt,
        expiresAt: null,
      } satisfies EffectiveSessionAccess,
    };
  }

  const billing = await getFoundationBillingAccount(workspaceKey, userId);
  if (!billing.ok) return { ok: false as const, code: billing.code, status: 503 };
  const paid = billingProductDecision(billing.account, required);
  if (paid.ok) {
    return {
      ok: true as const,
      access: {
        source: "paid" as const,
        accessPlan: billing.account.accessPlan as "observer_access" | "studio_access",
        billingExempt: false,
        expiresAt: null,
      } satisfies EffectiveSessionAccess,
    };
  }

  const trialResult = await getFoundationSelfServiceTrial(workspaceKey, userId);
  if (!trialResult.ok) return { ok: false as const, code: trialResult.code, status: 503 };
  const trial = trialResult.trial;
  if (trial?.status === "trialing" && Date.parse(trial.expiresAt) > Date.now()) {
    if (required === "studio") return { ok: false as const, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
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

  let deviceId = verifyDeviceCookie(readCookie(request, DEVICE_COOKIE), secret);
  let setCookie: string | undefined;
  if (!deviceId) {
    const issued = issueDeviceCookie(secret);
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

export async function checkTrialCompileCapacity(
  workspaceKey: string,
  userId: string,
  idempotencyKey?: string,
) {
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

  const jobs = new URLSearchParams({
    select: "job_id,state",
    workspace_key: `eq.${workspaceKey}`,
    limit: "20",
  });
  const response = await supabaseAdminRequest(config, `/rest/v1/foundation_compile_jobs?${jobs}`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return { ok: false as const, code: "TRIAL_COMPILE_CHECK_FAILED" };
  const rows = await response.json().catch(() => []) as Array<{ state?: unknown }>;
  const worldBearing = rows.filter((row) => !["failed", "cancelled"].includes(String(row.state ?? ""))).length;
  return { ok: true as const, allowed: worldBearing < Math.max(1, limit) };
}
