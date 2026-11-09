import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateDeveloperApiKey,
  getRequestUser,
  foundationPilotAccess,
  authorizeFoundationProduct,
  authorizeFoundationSessionProduct,
  trialFeatureBlocked,
  consumeDeveloperApiRateLimit,
  getWorkspaceMembership,
} = vi.hoisted(() => ({
  authenticateDeveloperApiKey: vi.fn(),
  getRequestUser: vi.fn(),
  foundationPilotAccess: vi.fn(),
  authorizeFoundationProduct: vi.fn(),
  authorizeFoundationSessionProduct: vi.fn(),
  trialFeatureBlocked: vi.fn(),
  consumeDeveloperApiRateLimit: vi.fn(),
  getWorkspaceMembership: vi.fn(),
}));

vi.mock("./developer-store", () => ({ authenticateDeveloperApiKey, consumeDeveloperApiRateLimit }));
vi.mock("./foundation-pilot", () => ({ getRequestUser, foundationPilotAccess }));
vi.mock("./billing-product-access", () => ({ authorizeFoundationProduct }));
vi.mock("./self-service-trial", () => ({ authorizeFoundationSessionProduct, trialFeatureBlocked }));
vi.mock("./workspace-membership", () => ({ getWorkspaceMembership }));
const { trialSessionQuery } = vi.hoisted(() => ({ trialSessionQuery: vi.fn() }));
vi.mock("./trial-ai-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./trial-ai-access")>()),
  trialSessionQuery,
}));

import { authorizeFoundationRequest, revalidateFoundationAuthorization } from "./developer-auth";

describe("developer request authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeFoundationProduct.mockResolvedValue({ ok: true, source: "paid", billingExempt: false });
    authorizeFoundationSessionProduct.mockResolvedValue({
      ok: true,
      access: { source: "paid", accessPlan: "studio_access", billingExempt: false, expiresAt: null },
    });
    trialFeatureBlocked.mockReturnValue(false);
    consumeDeveloperApiRateLimit.mockResolvedValue({ ok: true });
    getWorkspaceMembership.mockResolvedValue({
      ok: true,
      membership: { state: "active", role: "owner", authorizationRevision: 7 },
    });
    foundationPilotAccess.mockImplementation((userId: string) => ({
      membership: { workspaceId: userId === "user" ? "pilot-user" : "pilot-1234567890abcdef" },
    }));
  });

  it("authorizes a scoped API key without sending it to Supabase Auth", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: {
        kind: "api-key",
        keyId: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
        workspaceKey: "pilot-1234567890abcdef",
        userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
        scopes: ["documents:read"],
        authorizationRevision: 7,
      },
    });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/documents", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "documents:read");
    expect(result.ok).toBe(true);
    expect(getRequestUser).not.toHaveBeenCalled();
    expect(consumeDeveloperApiRateLimit).toHaveBeenCalledWith({
      keyId: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
      workspaceKey: "pilot-1234567890abcdef",
      scope: "documents:read",
      limit: 120,
    });
    expect(authorizeFoundationProduct).toHaveBeenCalledWith("pilot-1234567890abcdef", "59d42924-a3cc-4a09-b92d-9c86b58901a1", "observer");
  });

  it("fails closed when the API key lacks the exact scope", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "user", scopes: ["documents:read"], authorizationRevision: 7 },
    });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/collections/compile", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "collections:compile", "studio");
    expect(result).toEqual({ ok: false, code: "API_SCOPE_REQUIRED", status: 403 });
    expect(authorizeFoundationProduct).not.toHaveBeenCalled();
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });

  it("fails closed when the durable rate counter is unavailable", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "user", scopes: ["ask:read"], authorizationRevision: 7 },
    });
    consumeDeveloperApiRateLimit.mockResolvedValue({ ok: false, code: "API_RATE_LIMIT_UNAVAILABLE" });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/ask", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "ask:read");
    expect(result).toEqual({ ok: false, code: "API_RATE_LIMIT_UNAVAILABLE", status: 503 });
  });

  it("keeps a trial's key refused with trial AI access off, and fails closed with it on and the bounds unreadable", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "user", scopes: ["ask:read"], authorizationRevision: 7 },
    });
    authorizeFoundationProduct.mockResolvedValue({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
    authorizeFoundationSessionProduct.mockResolvedValue({
      ok: true,
      access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2099-01-01T00:00:00Z" },
    });
    const call = () => authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/ask", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "ask:read");
    expect(await call()).toEqual({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
    expect(authorizeFoundationSessionProduct).not.toHaveBeenCalled();
    vi.stubEnv("TAVONEL_TRIAL_AI_ACCESS_ENABLED", "true");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    try {
      expect(await call()).toEqual({ ok: false, code: "TRIAL_AI_ACCESS_CHECK_FAILED", status: 503 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("maps a browser session to its pilot workspace and effective access source", async () => {
    getRequestUser.mockResolvedValue({ id: "59d42924-a3cc-4a09-b92d-9c86b58901a1" });
    foundationPilotAccess.mockReturnValue({ membership: { workspaceId: "pilot-1234567890abcdef" } });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/documents", {
      headers: { authorization: "Bearer supabase-session" },
    }), "documents:read");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.kind).toBe("session");
      expect(result.principal.accessSource).toBe("paid");
    }
    expect(authorizeFoundationSessionProduct).toHaveBeenCalledWith(
      "pilot-1234567890abcdef",
      "59d42924-a3cc-4a09-b92d-9c86b58901a1",
      "observer",
    );
  });

  it("blocks trial-only scopes centrally", async () => {
    getRequestUser.mockResolvedValue({ id: "59d42924-a3cc-4a09-b92d-9c86b58901a1" });
    foundationPilotAccess.mockReturnValue({ membership: { workspaceId: "pilot-1234567890abcdef" } });
    authorizeFoundationSessionProduct.mockResolvedValue({
      ok: true,
      access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2026-09-11T00:00:00Z" },
    });
    trialFeatureBlocked.mockReturnValue(true);
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/connections", {
      headers: { authorization: "Bearer supabase-session" },
    }), "connections:read");
    expect(result).toEqual({ ok: false, code: "TRIAL_FEATURE_NOT_INCLUDED", status: 402 });
  });

  it("revokes API access when the key creator leaves the pilot allowlist", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "departed", scopes: ["documents:read"], authorizationRevision: 7 },
    });
    foundationPilotAccess.mockReturnValue(null);
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/documents", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "documents:read");
    expect(result).toEqual({ ok: false, code: "PILOT_ACCESS_REQUIRED", status: 403 });
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });

  it("revalidates a key without spending a second rate allowance", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({ ok: true, principal: {
      kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "user", scopes: ["ask:read"], authorizationRevision: 7,
    } });
    const request = new Request("https://tavonel.test/api/ask", {
      headers: { authorization: `Bearer ${["tvnl", "live", ""].join("_")}${"a".repeat(43)}` },
    });
    const initial = await authorizeFoundationRequest(request, "ask:read");
    if (!initial.ok) throw new Error("initial authorization failed");
    expect((await revalidateFoundationAuthorization(request, initial.principal, "ask:read")).ok).toBe(true);
    expect(authenticateDeveloperApiKey).toHaveBeenCalledTimes(2);
    expect(consumeDeveloperApiRateLimit).toHaveBeenCalledTimes(1);
  });

  it("refuses a revoked key during late authorization", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({ ok: true, principal: {
      kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "user", scopes: ["ask:read"], authorizationRevision: 7,
    } });
    const request = new Request("https://tavonel.test/api/ask", {
      headers: { authorization: `Bearer ${["tvnl", "live", ""].join("_")}${"a".repeat(43)}` },
    });
    const initial = await authorizeFoundationRequest(request, "ask:read");
    if (!initial.ok) throw new Error("initial authorization failed");
    authenticateDeveloperApiKey.mockResolvedValue({ ok: false, code: "API_KEY_REVOKED" });
    expect(await revalidateFoundationAuthorization(request, initial.principal, "ask:read"))
      .toEqual({ ok: false, code: "API_KEY_REVOKED", status: 401 });
    expect(consumeDeveloperApiRateLimit).toHaveBeenCalledTimes(1);
  });

  it("does not mutate the original authorization when effective access changes", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({ ok: true, principal: {
      kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "user", scopes: ["ask:read"], authorizationRevision: 7,
    } });
    const request = new Request("https://tavonel.test/api/ask", {
      headers: { authorization: `Bearer ${["tvnl", "live", ""].join("_")}${"a".repeat(43)}` },
    });
    const initial = await authorizeFoundationRequest(request, "ask:read");
    if (!initial.ok) throw new Error("initial authorization failed");
    authorizeFoundationProduct.mockResolvedValue({ ok: true, source: "owner", billingExempt: true });
    expect(await revalidateFoundationAuthorization(request, initial.principal, "ask:read"))
      .toEqual({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 });
    expect(initial.principal.accessSource).toBe("paid");
  });

  it("rejects a key issued before a revoke and reinvite ABA cycle", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: {
        kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "user",
        scopes: ["documents:read"], authorizationRevision: 7,
      },
    });
    getWorkspaceMembership.mockResolvedValue({
      ok: true,
      membership: { state: "active", role: "owner", authorizationRevision: 9 },
    });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.test/api/v1/documents", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "documents:read");
    expect(result).toEqual({ ok: false, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 });
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });

  it("rejects an ABA membership change even when identity and role return to their original values", async () => {
    getRequestUser.mockResolvedValue({ id: "user" });
    const request = new Request("https://tavonel.test/api/ask");
    const initial = await authorizeFoundationRequest(request, "ask:read");
    if (!initial.ok) throw new Error("initial authorization failed");
    expect(initial.principal.authorizationRevision).toBe(7);
    getWorkspaceMembership.mockResolvedValue({
      ok: true,
      membership: { state: "active", role: "owner", authorizationRevision: 9 },
    });
    expect(await revalidateFoundationAuthorization(request, initial.principal, "ask:read"))
      .toEqual({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 });
  });

  it("fails closed when durable membership freshness cannot be read", async () => {
    getRequestUser.mockResolvedValue({ id: "user" });
    getWorkspaceMembership.mockResolvedValue({
      ok: false, code: "WORKSPACE_MEMBERSHIP_READ_FAILED", status: 503,
    });
    expect(await authorizeFoundationRequest(new Request("https://tavonel.test/api/ask"), "ask:read"))
      .toEqual({ ok: false, code: "WORKSPACE_MEMBERSHIP_READ_FAILED", status: 503 });
    expect(authorizeFoundationSessionProduct).not.toHaveBeenCalled();
  });

  /* P0 2026-11-09: the trial's browser Ask is metered here, once per request, before any retrieval. */
  describe("a free evaluation's browser Ask", () => {
    const TRIAL_ACCESS = { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2099-01-01T00:00:00Z" };
    const session = (path: string) => new Request(`https://tavonel.com${path}`, { headers: { authorization: "Bearer supabase-session" } });
    beforeEach(() => {
      getRequestUser.mockResolvedValue({ id: "user" });
      authorizeFoundationSessionProduct.mockResolvedValue({ ok: true, access: TRIAL_ACCESS });
      trialSessionQuery.mockResolvedValue({ ok: true });
    });

    it("spends one query on ask:read, and the late re-check spends none", async () => {
      const request = session("/api/collections/x/ask");
      const first = await authorizeFoundationRequest(request, "ask:read");
      expect(first.ok).toBe(true);
      expect(trialSessionQuery).toHaveBeenCalledTimes(1);
      expect(trialSessionQuery).toHaveBeenCalledWith("pilot-user", "user");
      if (!first.ok) return;
      expect((await revalidateFoundationAuthorization(request, first.principal, "ask:read")).ok).toBe(true);
      expect(trialSessionQuery).toHaveBeenCalledTimes(1);
    });

    it("stops the Ask past the trial cap", async () => {
      trialSessionQuery.mockResolvedValue({ ok: false, code: "TRIAL_LIMIT_REACHED", status: 402 });
      expect(await authorizeFoundationRequest(session("/api/collections/x/ask"), "ask:read"))
        .toEqual({ ok: false, code: "TRIAL_LIMIT_REACHED", status: 402 });
    });

    it("leaves other scopes and paid sessions unmetered", async () => {
      expect((await authorizeFoundationRequest(session("/api/v1/documents"), "documents:read")).ok).toBe(true);
      authorizeFoundationSessionProduct.mockResolvedValue({
        ok: true, access: { source: "paid", accessPlan: "observer_access", billingExempt: false, expiresAt: null },
      });
      expect((await authorizeFoundationRequest(session("/api/collections/x/ask"), "ask:read")).ok).toBe(true);
      expect(trialSessionQuery).not.toHaveBeenCalled();
    });
  });

  it("rejects a session that expires after work starts", async () => {
    getRequestUser.mockResolvedValue({ id: "user" });
    const request = new Request("https://tavonel.test/api/ask");
    const initial = await authorizeFoundationRequest(request, "ask:read");
    if (!initial.ok) throw new Error("initial authorization failed");
    getRequestUser.mockResolvedValue(null);
    expect(await revalidateFoundationAuthorization(request, initial.principal, "ask:read"))
      .toEqual({ ok: false, code: "AUTH_REQUIRED", status: 401 });
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });
});
