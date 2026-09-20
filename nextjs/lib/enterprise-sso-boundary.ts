import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ENTERPRISE_SSO_ROLES = ["owner", "admin", "security_admin", "billing_admin", "member", "viewer"] as const;
export type EnterpriseSsoRole = (typeof ENTERPRISE_SSO_ROLES)[number];

export type SsoTenantConfig = {
  tenantId: string;
  issuer: string;
  audience: string;
  verifiedDomains: readonly string[];
  allowedRoles: readonly EnterpriseSsoRole[];
  roleClaim: string;
  jitProvisioning: boolean;
  providerVerifiedAt: string;
};

export type VerifiedSsoAssertion = {
  signatureVerified: boolean;
  tenantId: string;
  issuer: string;
  audience: string | readonly string[];
  subject: string;
  email: string;
  roles: readonly string[];
  issuedAt: number;
  expiresAt: number;
  assertionId: string;
};

export type SsoStateClaims = {
  tenantId: string;
  nonce: string;
  returnPath: string;
  issuedAt: number;
  expiresAt: number;
  keyId: string;
};

export interface ReplayStore {
  reserve(namespace: "sso_state" | "sso_assertion", tenantId: string, value: string, expiresAt: number): Promise<boolean>;
  consume(namespace: "sso_state", tenantId: string, value: string, now: number): Promise<boolean>;
}

const TENANT_ID = /^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])?$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const CLAIM_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const SUBJECT = /^[^\u0000-\u001f\u007f]{1,512}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strictHttpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search) return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isRole(value: unknown): value is EnterpriseSsoRole {
  return typeof value === "string" && ENTERPRISE_SSO_ROLES.includes(value as EnterpriseSsoRole);
}

export function parseSsoTenantConfig(value: unknown): SsoTenantConfig | null {
  if (!isRecord(value)) return null;
  const tenantId = typeof value.tenantId === "string" ? value.tenantId : "";
  const issuer = strictHttpsUrl(value.issuer);
  const audience = typeof value.audience === "string" && value.audience.length <= 1000 ? value.audience : null;
  const domains = Array.isArray(value.verifiedDomains)
    ? [...new Set(value.verifiedDomains.map((item) => typeof item === "string" ? item.trim().toLowerCase() : ""))]
    : [];
  const roles = Array.isArray(value.allowedRoles) ? [...new Set(value.allowedRoles)] : [];
  const roleClaim = value.roleClaim === undefined ? "roles" : value.roleClaim;
  const jitProvisioning = value.jitProvisioning === undefined ? false : value.jitProvisioning;
  const providerVerifiedAt = typeof value.providerVerifiedAt === "string" ? value.providerVerifiedAt : "";
  if (!TENANT_ID.test(tenantId) || !issuer || !audience || !domains.length || domains.length > 20
    || domains.some((item) => !DOMAIN.test(item)) || !roles.length || roles.length > ENTERPRISE_SSO_ROLES.length
    || roles.some((item) => !isRole(item)) || typeof roleClaim !== "string" || !CLAIM_NAME.test(roleClaim)
    || typeof jitProvisioning !== "boolean" || !Number.isFinite(Date.parse(providerVerifiedAt))) return null;
  return {
    tenantId, issuer, audience, verifiedDomains: domains, allowedRoles: roles as EnterpriseSsoRole[],
    roleClaim, jitProvisioning, providerVerifiedAt: new Date(providerVerifiedAt).toISOString(),
  };
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function equalText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function issueSsoState(input: {
  tenantId: string;
  returnPath: string;
  keyId: string;
  secret: string;
  replayStore: ReplayStore;
  now?: number;
  ttlSeconds?: number;
}) {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? 300;
  if (!TENANT_ID.test(input.tenantId) || !/^\/(?!\/)[^\u0000-\u001f]{0,500}$/.test(input.returnPath)
    || !/^[A-Za-z0-9._-]{1,64}$/.test(input.keyId) || Buffer.byteLength(input.secret) < 32
    || ttl < 60 || ttl > 600) return { ok: false as const, code: "SSO_STATE_CONFIGURATION_INVALID" };
  const claims: SsoStateClaims = {
    tenantId: input.tenantId,
    nonce: randomBytes(24).toString("base64url"),
    returnPath: input.returnPath,
    issuedAt: now,
    expiresAt: now + ttl,
    keyId: input.keyId,
  };
  if (!await input.replayStore.reserve("sso_state", claims.tenantId, claims.nonce, claims.expiresAt)) {
    return { ok: false as const, code: "SSO_STATE_RESERVATION_FAILED" };
  }
  const payload = encode(JSON.stringify(claims));
  const signature = createHmac("sha256", input.secret).update(payload).digest("base64url");
  return { ok: true as const, state: `${payload}.${signature}`, claims };
}

export async function verifyAndConsumeSsoState(input: {
  state: string;
  expectedTenantId: string;
  secrets: Readonly<Record<string, string | undefined>>;
  replayStore: ReplayStore;
  now?: number;
}) {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const [payload, signature, extra] = input.state.split(".");
  if (!payload || !signature || extra || input.state.length > 4096) return { ok: false as const, code: "SSO_STATE_INVALID" };
  let claims: SsoStateClaims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SsoStateClaims; }
  catch { return { ok: false as const, code: "SSO_STATE_INVALID" }; }
  const secret = typeof claims.keyId === "string" ? input.secrets[claims.keyId] : undefined;
  if (!secret || Buffer.byteLength(secret) < 32) return { ok: false as const, code: "SSO_STATE_KEY_UNAVAILABLE" };
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!equalText(signature, expected)) return { ok: false as const, code: "SSO_STATE_SIGNATURE_INVALID" };
  if (!TENANT_ID.test(claims.tenantId) || claims.tenantId !== input.expectedTenantId
    || !SUBJECT.test(claims.nonce) || !/^\/(?!\/)[^\u0000-\u001f]{0,500}$/.test(claims.returnPath)
    || !Number.isInteger(claims.issuedAt) || !Number.isInteger(claims.expiresAt)
    || claims.issuedAt >= claims.expiresAt
    || claims.issuedAt > now + 120 || claims.expiresAt <= now || claims.expiresAt - claims.issuedAt > 600) {
    return { ok: false as const, code: "SSO_STATE_CLAIMS_INVALID" };
  }
  if (!await input.replayStore.consume("sso_state", claims.tenantId, claims.nonce, now)) {
    return { ok: false as const, code: "SSO_STATE_REPLAY_REFUSED" };
  }
  return { ok: true as const, claims };
}

export async function validateSsoAssertion(input: {
  assertion: VerifiedSsoAssertion;
  config: SsoTenantConfig;
  existingUser: boolean;
  replayStore: ReplayStore;
  now?: number;
}) {
  const { assertion, config } = input;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!assertion.signatureVerified) return { ok: false as const, code: "SSO_SIGNATURE_REQUIRED" };
  if (assertion.tenantId !== config.tenantId) return { ok: false as const, code: "SSO_TENANT_MISMATCH" };
  if (!equalText(assertion.issuer, config.issuer)) return { ok: false as const, code: "SSO_ISSUER_MISMATCH" };
  const audiences = Array.isArray(assertion.audience) ? assertion.audience : [assertion.audience];
  if (!audiences.some((item) => equalText(item, config.audience))) return { ok: false as const, code: "SSO_AUDIENCE_MISMATCH" };
  if (!SUBJECT.test(assertion.subject) || !SUBJECT.test(assertion.assertionId)
    || !Number.isInteger(assertion.issuedAt) || !Number.isInteger(assertion.expiresAt)
    || assertion.issuedAt >= assertion.expiresAt
    || assertion.issuedAt > now + 120 || assertion.expiresAt <= now - 120
    || assertion.expiresAt - assertion.issuedAt > 600) return { ok: false as const, code: "SSO_ASSERTION_TIME_INVALID" };
  const email = assertion.email.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  const domain = at > 0 ? email.slice(at + 1) : "";
  if (!DOMAIN.test(domain) || !config.verifiedDomains.includes(domain)) return { ok: false as const, code: "SSO_DOMAIN_UNVERIFIED" };
  if (!input.existingUser && !config.jitProvisioning) return { ok: false as const, code: "SSO_JIT_DISABLED" };
  const requestedRoles = [...new Set(assertion.roles)];
  if (!requestedRoles.length || requestedRoles.some((role) => !isRole(role) || !config.allowedRoles.includes(role))) {
    return { ok: false as const, code: "SSO_ROLE_NOT_ALLOWED" };
  }
  if (!await input.replayStore.reserve("sso_assertion", config.tenantId, assertion.assertionId, assertion.expiresAt)) {
    return { ok: false as const, code: "SSO_ASSERTION_REPLAY_REFUSED" };
  }
  return {
    ok: true as const,
    identity: { tenantId: config.tenantId, subject: assertion.subject, email, roles: requestedRoles as EnterpriseSsoRole[] },
  };
}

export function redactIdentityAudit(input: { tenantId: string; action: string; outcome: string; subject?: string; email?: string; code?: string }) {
  const digest = (value: string | undefined) => value ? createHash("sha256").update(value.trim().toLowerCase()).digest("hex") : undefined;
  return {
    tenantId: input.tenantId,
    action: input.action,
    outcome: input.outcome,
    subjectHash: digest(input.subject),
    emailHash: digest(input.email),
    code: input.code,
  };
}
