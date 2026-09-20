import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleSsoCallbackBoundary } from "./enterprise-identity-route-boundary";
import { issueSsoState, parseSsoTenantConfig, redactIdentityAudit, validateSsoAssertion, verifyAndConsumeSsoState, type ReplayStore } from "./enterprise-sso-boundary";

class MemoryReplayStore implements ReplayStore {
  private values = new Set<string>();
  async reserve(namespace: "sso_state" | "sso_assertion", tenantId: string, value: string) {
    const key = `${namespace}:${tenantId}:${value}`;
    if (this.values.has(key)) return false;
    this.values.add(key);
    return true;
  }
  async consume(namespace: "sso_state", tenantId: string, value: string) {
    const key = `${namespace}:${tenantId}:${value}`;
    if (!this.values.has(key)) return false;
    this.values.delete(key);
    return true;
  }
}

const secret = "state-secret-with-at-least-thirty-two-bytes";
const configValue = {
  tenantId: "tenant-a", issuer: "https://idp.example.com", audience: "urn:tavonel:tenant-a",
  verifiedDomains: ["example.com"], allowedRoles: ["member", "viewer"],
  providerVerifiedAt: "2026-09-20T00:00:00.000Z",
};

function signState(claims: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

describe("B16 SSO fail-closed boundary", () => {
  it("defaults JIT provisioning off and validates provider-neutral tenant metadata", () => {
    expect(parseSsoTenantConfig(configValue)).toMatchObject({ tenantId: "tenant-a", jitProvisioning: false });
    expect(parseSsoTenantConfig({ ...configValue, issuer: "http://idp.example.com" })).toBeNull();
  });

  it("signs, expires, tenant-binds, and consumes state exactly once", async () => {
    const store = new MemoryReplayStore();
    const issued = await issueSsoState({ tenantId: "tenant-a", returnPath: "/enterprise", keyId: "k1", secret, replayStore: store, now: 1_000, ttlSeconds: 60 });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(await verifyAndConsumeSsoState({ state: issued.state, expectedTenantId: "tenant-b", secrets: { k1: secret }, replayStore: store, now: 1_010 })).toMatchObject({ ok: false, code: "SSO_STATE_CLAIMS_INVALID" });
    expect((await verifyAndConsumeSsoState({ state: issued.state, expectedTenantId: "tenant-a", secrets: { k1: secret }, replayStore: store, now: 1_010 })).ok).toBe(true);
    expect(await verifyAndConsumeSsoState({ state: issued.state, expectedTenantId: "tenant-a", secrets: { k1: secret }, replayStore: store, now: 1_010 })).toMatchObject({ ok: false, code: "SSO_STATE_REPLAY_REFUSED" });
  });

  it("requires state and assertion issue times to precede their expiry times", async () => {
    const baseState = { tenantId: "tenant-a", nonce: "state-nonce", returnPath: "/enterprise", issuedAt: 1_060, expiresAt: 1_060, keyId: "k1" };
    expect(await verifyAndConsumeSsoState({ state: signState(baseState), expectedTenantId: "tenant-a", secrets: { k1: secret }, replayStore: new MemoryReplayStore(), now: 1_000 }))
      .toMatchObject({ ok: false, code: "SSO_STATE_CLAIMS_INVALID" });
    expect(await verifyAndConsumeSsoState({ state: signState({ ...baseState, issuedAt: 1_061 }), expectedTenantId: "tenant-a", secrets: { k1: secret }, replayStore: new MemoryReplayStore(), now: 1_000 }))
      .toMatchObject({ ok: false, code: "SSO_STATE_CLAIMS_INVALID" });

    const config = parseSsoTenantConfig(configValue)!;
    const assertion = { signatureVerified: true, tenantId: "tenant-a", issuer: config.issuer, audience: config.audience, subject: "subject-1", email: "person@example.com", roles: ["member"], issuedAt: 1_100, expiresAt: 1_100, assertionId: "assertion-time-order" };
    expect(await validateSsoAssertion({ assertion, config, existingUser: true, replayStore: new MemoryReplayStore(), now: 1_000 }))
      .toMatchObject({ ok: false, code: "SSO_ASSERTION_TIME_INVALID" });
    expect(await validateSsoAssertion({ assertion: { ...assertion, issuedAt: 1_101 }, config, existingUser: true, replayStore: new MemoryReplayStore(), now: 1_000 }))
      .toMatchObject({ ok: false, code: "SSO_ASSERTION_TIME_INVALID" });
  });

  it("rejects wrong issuer, audience, domain, role, unsigned assertions, disabled JIT, and assertion replay", async () => {
    const config = parseSsoTenantConfig(configValue)!;
    const base = { signatureVerified: true, tenantId: "tenant-a", issuer: config.issuer, audience: config.audience, subject: "subject-1", email: "person@example.com", roles: ["member"], issuedAt: 1_000, expiresAt: 1_300, assertionId: "assertion-1" };
    const validate = (overrides: Partial<typeof base>, existingUser = true, store = new MemoryReplayStore()) => validateSsoAssertion({ assertion: { ...base, ...overrides }, config, existingUser, replayStore: store, now: 1_100 });
    expect(await validate({ signatureVerified: false })).toMatchObject({ ok: false, code: "SSO_SIGNATURE_REQUIRED" });
    expect(await validate({ issuer: "https://other.example.com" })).toMatchObject({ ok: false, code: "SSO_ISSUER_MISMATCH" });
    expect(await validate({ audience: "urn:other" })).toMatchObject({ ok: false, code: "SSO_AUDIENCE_MISMATCH" });
    expect(await validate({ email: "person@other.example" })).toMatchObject({ ok: false, code: "SSO_DOMAIN_UNVERIFIED" });
    expect(await validate({ roles: ["owner"] })).toMatchObject({ ok: false, code: "SSO_ROLE_NOT_ALLOWED" });
    expect(await validate({}, false)).toMatchObject({ ok: false, code: "SSO_JIT_DISABLED" });
    const replay = new MemoryReplayStore();
    expect((await validate({}, true, replay)).ok).toBe(true);
    expect(await validate({}, true, replay)).toMatchObject({ ok: false, code: "SSO_ASSERTION_REPLAY_REFUSED" });
  });

  it("keeps the route disabled until activation and redacts identity audit fields", async () => {
    const result = await handleSsoCallbackBoundary({ tenantId: "tenant-a", state: "unused", stateSecrets: {}, replayStore: new MemoryReplayStore(), config: parseSsoTenantConfig(configValue)!, assertion: {} as never, existingUser: true, runtimeEnabled: false });
    expect(result).toMatchObject({ ok: false, code: "SSO_PROVIDER_NOT_ACTIVATED", status: 503 });
    const audit = redactIdentityAudit({ tenantId: "tenant-a", action: "login", outcome: "denied", email: "person@example.com", subject: "subject-1" });
    expect(JSON.stringify(audit)).not.toContain("person@example.com");
    expect(JSON.stringify(audit)).not.toContain("subject-1");
  });
});
