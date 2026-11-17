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
const { trialSessionQuery, trialAiKeyAccess, realTrial } = vi.hoisted(() => ({
  trialSessionQuery: vi.fn(),
  trialAiKeyAccess: vi.fn(),
  realTrial: {} as { trialAiKeyAccess?: (...args: never[]) => unknown },
}));
// trialAiKeyAccess is the real function behind a spy, so a test can see whether a path consults it.
vi.mock("./trial-ai-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("./trial-ai-access")>();
  realTrial.trialAiKeyAccess = original.trialAiKeyAccess as never;
  trialAiKeyAccess.mockImplementation(original.trialAiKeyAccess);
  return { ...original, trialSessionQuery, trialAiKeyAccess };
});

const { readAgentGrant } = vi.hoisted(() => ({ readAgentGrant: vi.fn() }));
vi.mock("./agent-grants", () => ({ readAgentGrant }));

import { insideAgentMcpDispatch, withinAgentMcpDispatch } from "./agent-mcp-dispatch";
import { authorizeAgentRequest, authorizeFoundationRequest, revalidateFoundationAuthorization } from "./developer-auth";

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

  /*
    P0 2026-11-09: the trial's browser Ask is metered once per request, by the route, after its body is
    validated and before any retrieval (review N2). Authorization itself spends nothing.
  */
  describe("a free evaluation's browser Ask", () => {
    const TRIAL_ACCESS = { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2099-01-01T00:00:00Z" };
    const session = (path: string) => new Request(`https://tavonel.com${path}`, { headers: { authorization: "Bearer supabase-session" } });
    beforeEach(() => {
      getRequestUser.mockResolvedValue({ id: "user" });
      authorizeFoundationSessionProduct.mockResolvedValue({ ok: true, access: TRIAL_ACCESS });
      trialSessionQuery.mockResolvedValue({ ok: true });
    });

    it("authorizes a trial's Ask and its late re-check without spending, and names the principal a trial", async () => {
      const request = session("/api/collections/x/ask");
      const first = await authorizeFoundationRequest(request, "ask:read");
      if (!first.ok) throw new Error("trial authorization failed");
      expect(first.principal).toMatchObject({ kind: "session", accessSource: "trial", workspaceKey: "pilot-user", userId: "user" });
      expect((await revalidateFoundationAuthorization(request, first.principal, "ask:read")).ok).toBe(true);
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

const AGENT_KEY = "49d42924-a3cc-4a09-b92d-9c86b58901a1";
const AGENT_USER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const AGENT_GRANT = "29d42924-a3cc-4a09-b92d-9c86b58901a1";
const AGENT_WS = "pilot-1234567890abcdef";
const agentBearer = `tvnl_agt_abcdefghijkl_${"a".repeat(43)}`;
const agentRequest = (bearer: string | null = agentBearer) => new Request("https://tavonel.com/api/agent-mcp", {
  method: "POST",
  headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
});
const agentPrincipal = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  principal: {
    kind: "api-key", audience: "agent", keyId: AGENT_KEY, workspaceKey: AGENT_WS, userId: AGENT_USER, scopes: [],
    agent: { grantId: AGENT_GRANT, scopes: ["agent:read", "agent:propose"] }, authorizationRevision: 7, ...overrides,
  },
});

describe("an agent credential at the REST surface (I-2, REST half)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeDeveloperApiRateLimit.mockResolvedValue({ ok: true });
    authorizeFoundationProduct.mockResolvedValue({ ok: true, source: "paid", billingExempt: false });
    foundationPilotAccess.mockReturnValue({ membership: { workspaceId: AGENT_WS } });
    getWorkspaceMembership.mockResolvedValue({ ok: true, membership: { state: "active", role: "owner", authorizationRevision: 7 } });
  });

  it("is refused with API_KEY_AUDIENCE_INVALID, not treated as a session, when authentication refuses its audience", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({ ok: false, code: "API_KEY_AUDIENCE_INVALID" });
    const result = await authorizeFoundationRequest(agentRequest(), "collections:compile", "studio");
    expect(result).toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID", status: 401 });
    expect(authenticateDeveloperApiKey).toHaveBeenCalledWith(agentBearer);
    expect(getRequestUser).not.toHaveBeenCalled();
  });

  it("is refused even inside the agent dispatch, where authentication accepts it: REST never serves an agent credential", async () => {
    authenticateDeveloperApiKey.mockResolvedValue(agentPrincipal());
    const result = await withinAgentMcpDispatch(() => authorizeFoundationRequest(agentRequest(), "collections:compile", "studio"));
    expect(result).toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID", status: 401 });
    for (const scope of ["documents:read", "collections:read", "worlds:read"] as const) {
      expect(await authorizeFoundationRequest(agentRequest(), scope)).toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID", status: 401 });
    }
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
    expect(authorizeFoundationProduct).not.toHaveBeenCalled();
  });

  it("refuses a principal whose audience is not its token form's", async () => {
    authenticateDeveloperApiKey.mockResolvedValue(agentPrincipal({ audience: "api", scopes: ["collections:compile"] }));
    expect(await authorizeFoundationRequest(agentRequest(), "collections:compile")).toEqual({ ok: false, code: "API_KEY_INVALID", status: 401 });
    authenticateDeveloperApiKey.mockResolvedValue(agentPrincipal());
    expect(await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/collections", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "collections:read")).toEqual({ ok: false, code: "API_KEY_INVALID", status: 401 });
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });
});

describe("authorizeAgentRequest (workorders/agent-native.md §2.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateDeveloperApiKey.mockImplementation(async () => (insideAgentMcpDispatch() ? agentPrincipal() : { ok: false, code: "API_KEY_AUDIENCE_INVALID" }));
    readAgentGrant.mockResolvedValue({ ok: true, grant: { grantId: AGENT_GRANT, authorizationRevision: 7, createdAt: "2026-11-17T00:00:00Z", revokedAt: null } });
    foundationPilotAccess.mockReturnValue({ membership: { workspaceId: AGENT_WS } });
    getWorkspaceMembership.mockResolvedValue({ ok: true, membership: { state: "active", role: "editor", authorizationRevision: 7 } });
    authorizeFoundationProduct.mockResolvedValue({ ok: true, source: "paid", billingExempt: false });
    consumeDeveloperApiRateLimit.mockResolvedValue({ ok: true });
  });

  it("authenticates inside the agent dispatch, checks the grant, membership and product, then spends one unit of the tool's scope", async () => {
    const result = await authorizeAgentRequest(agentRequest(), "agent:read");
    expect(result).toEqual({
      ok: true,
      principal: {
        kind: "agent", workspaceKey: AGENT_WS, userId: AGENT_USER, keyId: AGENT_KEY, grantId: AGENT_GRANT,
        scopes: ["agent:read", "agent:propose"], authorizationRevision: 7, workspaceRole: "editor",
      },
    });
    expect(readAgentGrant).toHaveBeenCalledWith(AGENT_WS, AGENT_GRANT, AGENT_USER);
    expect(authorizeFoundationProduct).toHaveBeenCalledWith(AGENT_WS, AGENT_USER, "observer");
    expect(consumeDeveloperApiRateLimit).toHaveBeenCalledWith({ keyId: AGENT_KEY, workspaceKey: AGENT_WS, scope: "agent:read", limit: 120 });
    expect(getRequestUser).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(agentBearer);
  });

  it.each([
    [null, "AUTH_REQUIRED"],
    [`tvnl_live_abcdefghijkl_${"a".repeat(43)}`, "API_KEY_AUDIENCE_INVALID"],
    [`tvnl_mcp_abcdefghijkl_${"a".repeat(43)}`, "API_KEY_AUDIENCE_INVALID"],
    ["a-supabase-session-jwt", "API_KEY_INVALID"],
  ])("refuses bearer %s with 401 %s before authenticating", async (bearer, code) => {
    expect(await authorizeAgentRequest(agentRequest(bearer), "agent:read")).toEqual({ ok: false, code, status: 401 });
    expect(authenticateDeveloperApiKey).not.toHaveBeenCalled();
  });

  it("passes authentication's own refusal through as 401", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({ ok: false, code: "API_KEY_EXPIRED" });
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "API_KEY_EXPIRED", status: 401 });
  });

  it("refuses a principal that is not an agent's", async () => {
    authenticateDeveloperApiKey.mockResolvedValue(agentPrincipal({ audience: "api", agent: null, scopes: ["documents:read"] }));
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID", status: 401 });
  });

  it("refuses a credential without the tool's scope", async () => {
    authenticateDeveloperApiKey.mockResolvedValue(agentPrincipal({ agent: { grantId: AGENT_GRANT, scopes: ["agent:read"] } }));
    expect(await authorizeAgentRequest(agentRequest(), "agent:propose")).toEqual({ ok: false, code: "API_SCOPE_REQUIRED", status: 403 });
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });

  it("a revoked grant is API_KEY_AUTHORIZATION_REVOKED, and so is a grant that does not read back", async () => {
    readAgentGrant.mockResolvedValue({ ok: true, grant: { grantId: AGENT_GRANT, authorizationRevision: 7, createdAt: "2026-11-17T00:00:00Z", revokedAt: "2026-11-17T01:00:00Z" } });
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 });
    readAgentGrant.mockResolvedValue({ ok: true, grant: null });
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 });
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
    expect(authorizeFoundationProduct).not.toHaveBeenCalled();
  });

  it("fails closed when the grant cannot be read", async () => {
    readAgentGrant.mockResolvedValue({ ok: false, code: "DEVELOPER_STORE_READ_FAILED" });
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "DEVELOPER_STORE_READ_FAILED", status: 503 });
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });

  it("a membership revision changed since the key or the grant was made is API_KEY_AUTHORIZATION_REVOKED", async () => {
    getWorkspaceMembership.mockResolvedValue({ ok: true, membership: { state: "active", role: "editor", authorizationRevision: 8 } });
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 });
    getWorkspaceMembership.mockResolvedValue({ ok: true, membership: { state: "active", role: "editor", authorizationRevision: 7 } });
    readAgentGrant.mockResolvedValue({ ok: true, grant: { grantId: AGENT_GRANT, authorizationRevision: 6, createdAt: "2026-11-17T00:00:00Z", revokedAt: null } });
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 });
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });

  it("an inactive membership or a person outside the pilot is refused", async () => {
    getWorkspaceMembership.mockResolvedValue({ ok: true, membership: { state: "removed", role: "editor", authorizationRevision: 7 } });
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 });
    foundationPilotAccess.mockReturnValue({ membership: { workspaceId: "pilot-other" } });
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "PILOT_ACCESS_REQUIRED", status: 403 });
  });

  it("has no trial path: a workspace without product access is refused even with trial AI access on", async () => {
    vi.stubEnv("TAVONEL_TRIAL_AI_ACCESS_ENABLED", "true");
    try {
      authorizeFoundationProduct.mockResolvedValue({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
      // Even a trial check that would admit the call is never asked.
      trialAiKeyAccess.mockResolvedValue({ ok: true });
      expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
      expect(trialAiKeyAccess).not.toHaveBeenCalled();
      expect(trialSessionQuery).not.toHaveBeenCalled();
      expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
    } finally {
      trialAiKeyAccess.mockImplementation(realTrial.trialAiKeyAccess as never);
      vi.unstubAllEnvs();
    }
  });

  it("the 11th agent:propose call in a minute is 429 API_RATE_LIMITED; an unavailable counter is 503", async () => {
    let calls = 0;
    consumeDeveloperApiRateLimit.mockImplementation(async (input: { limit: number }) =>
      (++calls <= input.limit ? { ok: true } : { ok: false, code: "API_RATE_LIMITED" }));
    for (let i = 0; i < 10; i += 1) expect((await authorizeAgentRequest(agentRequest(), "agent:propose")).ok).toBe(true);
    expect(await authorizeAgentRequest(agentRequest(), "agent:propose")).toEqual({ ok: false, code: "API_RATE_LIMITED", status: 429 });
    expect(consumeDeveloperApiRateLimit).toHaveBeenLastCalledWith({ keyId: AGENT_KEY, workspaceKey: AGENT_WS, scope: "agent:propose", limit: 10 });
    consumeDeveloperApiRateLimit.mockResolvedValue({ ok: false, code: "API_RATE_LIMIT_UNAVAILABLE" });
    expect(await authorizeAgentRequest(agentRequest(), "agent:read")).toEqual({ ok: false, code: "API_RATE_LIMIT_UNAVAILABLE", status: 503 });
  });
});

