import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-AGENT-OAUTH-1: the OAuth dance for the agent proposal MCP, against the real route handlers (register,
  authorize, token, protected-resource and authorization-server metadata, /api/agent-mcp, /api/mcp, the grant
  revoke route), and its refusal matrix: cross-audience, scope, flag off, replay, expiry, revoke.

  Harness as lib/remote-mcp-auth-matrix.test.ts: every store is a mock. The grant store is an in-memory stand-in
  for lib/agent-grants.ts, and authenticateDeveloperApiKey a stand-in that keeps the real function's audience rule
  (a `tvnl_agt_` token authenticates only inside the agent dispatch). authorizeAgentRequest and
  authorizeFoundationRequest are the real ones. Nothing here proves the flow against a real deployment, real
  stores or a real ChatGPT/Claude connector.
*/

const WS = "pilot-alpha";
const USER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const ORIGIN = "https://tavonel.test";
const AGENT_RESOURCE = `${ORIGIN}/api/agent-mcp`;
const MCP_TOKEN = `tvnl_mcp_${"m".repeat(12)}_${"s".repeat(43)}`;

type Grant = { grantId: string; clientLabel: string; scopes: string[]; token: string; expiresAt: string; revokedAt: string | null };

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  revokeSession: vi.fn(),
  sessionProduct: vi.fn(),
  product: vi.fn(),
  membership: vi.fn(),
  pilot: vi.fn(),
  authenticate: vi.fn(),
  rate: vi.fn(),
  grants: [] as Array<{ grantId: string; clientLabel: string; scopes: string[]; token: string; expiresAt: string; revokedAt: string | null }>,
  createGrant: vi.fn(),
  expired: new Set<string>(),
  truncated: false,
  openProposals: vi.fn(),
  keyOutlivesGrant: new Set<string>(),
  createKey: vi.fn(),
  revokeKey: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  requireFoundationSession: mocks.session,
  requireFoundationRevokeSession: mocks.revokeSession,
}));
vi.mock("@/lib/self-service-trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./self-service-trial")>()),
  authorizeFoundationSessionProduct: mocks.sessionProduct,
}));
vi.mock("@/lib/billing-product-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./billing-product-access")>()),
  authorizeFoundationProduct: mocks.product,
}));
vi.mock("@/lib/workspace-membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-membership")>()),
  getWorkspaceMembership: mocks.membership,
}));
vi.mock("@/lib/foundation-pilot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./foundation-pilot")>()),
  foundationPilotAccess: mocks.pilot,
}));
vi.mock("@/lib/developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  authenticateDeveloperApiKey: mocks.authenticate,
  consumeDeveloperApiRateLimit: mocks.rate,
  createDeveloperApiKey: mocks.createKey,
  revokeDeveloperApiKey: mocks.revokeKey,
}));
vi.mock("@/lib/agent-grants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-grants")>()),
  createAgentGrant: mocks.createGrant,
  listAgentGrants: async () => ({ ok: true, grants: mocks.grants.map(({ token: _t, scopes: _s, ...grant }) => ({ ...grant, createdAt: "2026-11-27T00:00:00.000Z", lastUsedAt: null })), truncated: mocks.truncated }),
  readAgentGrant: async (_ws: string, grantId: string) => {
    const grant = mocks.grants.find((entry) => entry.grantId === grantId);
    return { ok: true, grant: grant ? { grantId, authorizationRevision: 4, createdAt: "2026-11-27T00:00:00.000Z", revokedAt: grant.revokedAt } : null };
  },
  revokeAgentGrant: async (_ws: string, _user: string, grantId: string) => {
    const grant = mocks.grants.find((entry) => entry.grantId === grantId && entry.revokedAt === null);
    if (!grant) return { ok: false, code: "AGENT_GRANT_NOT_FOUND" };
    grant.revokedAt = new Date().toISOString();
    return { ok: true, revokedAt: grant.revokedAt, keysRevoked: 1, proposalsWithdrawn: 0 };
  },
}));

vi.mock("@/lib/change-proposals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./change-proposals")>()),
  grantHasOpenProposals: mocks.openProposals,
}));

import { insideAgentMcpDispatch } from "./agent-mcp-dispatch";
import { authorizeFoundationRequest } from "./developer-auth";
import { POST as register } from "../app/api/mcp/oauth/register/route";
import { POST as authorizeRoute } from "../app/api/mcp/oauth/authorize/route";
import { POST as token } from "../app/api/mcp/oauth/token/route";
import { POST as readOnlyMcp } from "../app/api/mcp/route";
import { POST as agentMcp } from "../app/api/agent-mcp/route";
import { DELETE as revokeGrant } from "../app/api/agent-grants/[id]/route";
import { GET as protectedResource } from "../app/.well-known/oauth-protected-resource/[[...resource]]/route";
import { GET as authorizationServer } from "../app/.well-known/oauth-authorization-server/route";

const VERIFIER = "agent-oauth-pkce-verifier-0123456789-abcdefghij";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REDIRECT = "https://client.example/oauth/callback";

const sessionPrincipal = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  principal: { kind: "session", workspaceKey: WS, userId: USER, scopes: [], accessSource: "paid", authorizationRevision: 4, workspaceRole: "owner", email: "owner@example.com", ...overrides },
});

async function registeredClient(name = "ChatGPT") {
  const response = await register(new Request(`${ORIGIN}/api/mcp/oauth/register`, { method: "POST",
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }) }));
  expect(response.status).toBe(201);
  return (await response.json() as { client_id: string }).client_id;
}
function authRequest(clientId: string, overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
    code_challenge_method: "S256", state: "client-state-1", resource: AGENT_RESOURCE, ...overrides,
  };
  return Object.fromEntries(Object.entries(base).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
type Answer = { code: string; error?: string; redirectTo?: string; scopes?: string[]; resource?: string; client?: unknown };
async function consent(decision: string, request: Record<string, string>, extra: Record<string, unknown> = {}, bearer?: string) {
  const response = await authorizeRoute(new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
    method: "POST", headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, body: JSON.stringify({ decision, request, ...extra }),
  }));
  return { status: response.status, body: await response.json() as Answer };
}
async function approvedCode(clientId: string, extra: Record<string, unknown> = {}, overrides: Record<string, string | undefined> = {}) {
  mocks.session.mockResolvedValueOnce(sessionPrincipal());
  const { body } = await consent("approve", authRequest(clientId, overrides), extra, "supabase-session");
  expect(body.code).toBe("AUTHORIZATION_GRANTED");
  const url = new URL(body.redirectTo!);
  expect(url.searchParams.get("iss")).toBe(ORIGIN);
  expect(url.searchParams.get("state")).toBe("client-state-1");
  return url.searchParams.get("code")!;
}
const exchange = (fields: Record<string, string>) => token(new Request(`${ORIGIN}/api/mcp/oauth/token`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(),
}));
const codeGrant = (clientId: string, code: string, extra: Record<string, string> = {}) =>
  ({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER, resource: AGENT_RESOURCE, ...extra });
type TokenAnswer = { access_token?: string; token_type?: string; expires_in?: number; scope?: string; refresh_token?: string; error?: string; error_description?: string };
async function agentToken(clientId: string, extra: Record<string, unknown> = {}) {
  const response = await exchange(codeGrant(clientId, await approvedCode(clientId, extra)));
  expect(response.status).toBe(200);
  return await response.json() as TokenAnswer;
}

function agentRpc(body: unknown, bearer?: string, headers: Record<string, string> = {}) {
  return agentMcp(new Request(`${ORIGIN}/api/agent-mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers },
    body: JSON.stringify(body),
  }));
}
const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } } };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };
const PROPOSE = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "propose_compile", arguments: { documentIds: [], idempotencyKey: "client-key-1" } } };

let minted = 0;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.grants.length = 0;
  mocks.expired.clear();
  mocks.truncated = false;
  mocks.keyOutlivesGrant.clear();
  mocks.openProposals.mockResolvedValue({ ok: true, open: false });
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "agent-oauth-unit-test-sealing-secret-value");
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", WS);
  vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "true");
  vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", WS);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.sessionProduct.mockResolvedValue({ ok: true, access: { source: "paid", accessPlan: "studio_access", billingExempt: false, expiresAt: null } });
  mocks.product.mockResolvedValue({ ok: true, source: "paid" });
  mocks.membership.mockResolvedValue({ ok: true, membership: { state: "active", authorizationRevision: 4, role: "owner" } });
  mocks.pilot.mockReturnValue({ membership: { workspaceId: WS }, entitlement: {} });
  mocks.rate.mockResolvedValue({ ok: true });
  mocks.createGrant.mockImplementation(async (input: { clientLabel: string; scopes: string[]; ttlSeconds: number }) => {
    minted += 1;
    const grant: Grant = {
      grantId: `00000000-0000-4000-8000-${String(minted).padStart(12, "0")}`,
      clientLabel: input.clientLabel, scopes: [...input.scopes],
      token: `tvnl_agt_${String(minted).padStart(12, "a")}_${"s".repeat(43)}`,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000).toISOString(), revokedAt: null,
    };
    mocks.grants.push(grant);
    return { ok: true, token: grant.token, grant: { grantId: grant.grantId, clientLabel: grant.clientLabel, createdAt: new Date().toISOString(), expiresAt: grant.expiresAt, revokedAt: null, lastUsedAt: null } };
  });
  // The key store, with the real function's audience rule and its expired/revoked answers.
  mocks.authenticate.mockImplementation(async (bearer: string) => {
    if (bearer.startsWith("tvnl_agt_")) {
      if (!insideAgentMcpDispatch()) return { ok: false, code: "API_KEY_AUDIENCE_INVALID" };
      const grant = mocks.grants.find((entry) => entry.token === bearer);
      if (!grant || (grant.revokedAt && !mocks.keyOutlivesGrant.has(bearer))) return { ok: false, code: "API_KEY_INVALID" };
      if (mocks.expired.has(bearer)) return { ok: false, code: "API_KEY_EXPIRED" };
      return { ok: true, principal: { kind: "api-key", audience: "agent", keyId: `key-${grant.grantId}`, workspaceKey: WS, userId: USER,
        scopes: [], agent: { grantId: grant.grantId, scopes: grant.scopes }, authorizationRevision: 4 } };
    }
    if (bearer === MCP_TOKEN) {
      return { ok: true, principal: { kind: "api-key", audience: "mcp", keyId: "mcp-key", workspaceKey: WS, userId: USER, scopes: ["worlds:read"], agent: null, authorizationRevision: 4 } };
    }
    return { ok: false, code: "API_KEY_INVALID" };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WO-AGENT-OAUTH-1: the whole dance against the route handlers", () => {
  it("challenge -> metadata -> register -> consent -> token -> initialize, tools/list; read-only by default", async () => {
    // 1. An unauthenticated initialize is refused with the challenge naming the agent resource's metadata.
    const refused = await agentRpc(INITIALIZE);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/agent-mcp"`);
    // 2. The resource metadata names this resource, the shared issuer and the two agent scopes.
    const prm = await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/agent-mcp`), { params: Promise.resolve({ resource: ["api", "agent-mcp"] }) });
    expect(await prm.json()).toEqual({ resource: AGENT_RESOURCE, authorization_servers: [ORIGIN], scopes_supported: ["agent:read", "agent:propose"],
      bearer_methods_supported: ["header"], resource_name: expect.any(String) });
    // 3. The issuer's metadata is the read-only MCP's, unchanged (its scopes stay the read scopes).
    const as = await (await authorizationServer(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json() as Record<string, unknown>;
    expect(as).toMatchObject({ issuer: ORIGIN, token_endpoint: `${ORIGIN}/api/mcp/oauth/token`, registration_endpoint: `${ORIGIN}/api/mcp/oauth/register` });
    expect(as.scopes_supported).not.toContain("agent:read");
    // 4. Register, describe (the page learns it is the agent endpoint), approve without ticking propose.
    const clientId = await registeredClient();
    const described = await consent("describe", authRequest(clientId));
    expect(described.body).toMatchObject({ code: "AUTHORIZATION_REQUEST_VALID", resource: "agent-mcp", scopes: ["agent:propose", "agent:read"] });
    const tokenAnswer = await agentToken(clientId);
    expect(tokenAnswer).toEqual({ access_token: expect.stringMatching(/^tvnl_agt_/), token_type: "Bearer", expires_in: 900, scope: "agent:read" });
    expect(tokenAnswer.refresh_token).toBeUndefined();
    expect(mocks.createGrant).toHaveBeenCalledWith(expect.objectContaining({ workspaceKey: WS, userId: USER, authorizationRevision: 4,
      scopes: ["agent:read"], ttlSeconds: 900, grantorEmail: "owner@example.com", clientLabel: expect.stringMatching(/^ChatGPT #[A-Za-z0-9_-]{12}$/) }));
    // 5. The token works at the agent endpoint.
    const initialized = await agentRpc(INITIALIZE, tokenAnswer.access_token);
    expect(initialized.status).toBe(200);
    expect((await initialized.json()).result.serverInfo.name).toBe("tavonel-agent");
    const listed = await agentRpc(LIST, tokenAnswer.access_token);
    expect(listed.status).toBe(200);
    const tools = (await listed.json()).result.tools as Array<{ name: string; annotations: { readOnlyHint?: boolean } }>;
    expect(tools.map((tool) => tool.name)).toContain("propose_compile");
    // GPT Q1: a tool that saves a proposal is a write tool, never readOnlyHint:true.
    for (const tool of tools) expect(tool.annotations.readOnlyHint, tool.name).toBe(!tool.name.startsWith("propose_"));
    // 6. A read-only grant cannot propose: 403 with the insufficient_scope challenge, before any tool runs.
    const propose = await agentRpc(PROPOSE, tokenAnswer.access_token);
    expect(propose.status).toBe(403);
    expect((await propose.json()).error.message).toBe("API_SCOPE_REQUIRED");
    expect(propose.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(propose.headers.get("www-authenticate")).toContain('scope="agent:read agent:propose"');
    // 7. Step-up with exactly the challenged scope is a valid request, and a ticked consent grants it.
    const stepUp = await consent("describe", authRequest(clientId, { scope: "agent:read agent:propose" }));
    expect(stepUp.body).toMatchObject({ code: "AUTHORIZATION_REQUEST_VALID", scopes: ["agent:propose", "agent:read"] });
    const upgraded = await exchange(codeGrant(clientId, await approvedCode(clientId, { allowPropose: true }, { scope: "agent:read agent:propose" })));
    expect((await upgraded.json() as TokenAnswer).scope).toBe("agent:propose agent:read");
  });

  it("agent:propose is granted only when the person ticked its own line", async () => {
    const clientId = await registeredClient();
    expect((await agentToken(clientId, { allowPropose: true })).scope).toBe("agent:propose agent:read");
    expect((await agentToken(clientId, { allowPropose: "yes" })).scope).toBe("agent:read");
    expect(mocks.createGrant.mock.calls.map((call) => (call[0] as { scopes: string[] }).scopes)).toEqual([["agent:propose", "agent:read"], ["agent:read"]]);
  });

  it("a grant revoked under Workspace > Developers stops its token at once", async () => {
    const clientId = await registeredClient();
    const { access_token: bearer } = await agentToken(clientId);
    expect((await agentRpc(LIST, bearer)).status).toBe(200);
    mocks.revokeSession.mockResolvedValueOnce(sessionPrincipal({ accessSource: undefined }));
    const grantId = mocks.grants[0]!.grantId;
    const revoked = await revokeGrant(new Request(`${ORIGIN}/api/agent-grants/${grantId}`, { method: "DELETE" }), { params: Promise.resolve({ id: grantId }) });
    expect((await revoked.json()).code).toBe("REVOKED");
    const after = await agentRpc(LIST, bearer);
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("an expired access token is 401 invalid_token with the challenge; no refresh token exists to use", async () => {
    const clientId = await registeredClient();
    const { access_token: bearer } = await agentToken(clientId);
    mocks.expired.add(bearer!);
    const response = await agentRpc(LIST, bearer);
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("API_KEY_EXPIRED");
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token", error_description="API_KEY_EXPIRED"');
  });
});

describe("WO-AGENT-OAUTH-1: cross-audience refusals", () => {
  it("a read-only MCP token is refused at the agent endpoint (401, challenge for the agent resource)", async () => {
    const response = await agentRpc(LIST, MCP_TOKEN);
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("API_KEY_AUDIENCE_INVALID");
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource/api/agent-mcp");
  });

  it("an OAuth agent token is refused at the read-only MCP and by the REST authorization", async () => {
    const clientId = await registeredClient();
    const { access_token: bearer } = await agentToken(clientId, { allowPropose: true });
    const mcp = await readOnlyMcp(new Request(`${ORIGIN}/api/mcp`, { method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_sources", arguments: {} } }) }));
    expect(mcp.status).toBe(401);
    expect((await mcp.json()).error.message).toBe("AUTH_INVALID");
    const rest = await authorizeFoundationRequest(new Request(`${ORIGIN}/api/v1/documents`, { headers: { authorization: `Bearer ${bearer}` } }), "documents:read");
    expect(rest).toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID", status: 401 });
  });

  it("an agent code is refused when exchanged for the read-only resource, and a read-only code for the agent resource", async () => {
    const clientId = await registeredClient();
    const agentCode = await approvedCode(clientId);
    const asReadOnly = await exchange(codeGrant(clientId, agentCode, { resource: `${ORIGIN}/api/mcp` }));
    expect(asReadOnly.status).toBe(400);
    expect((await asReadOnly.json() as TokenAnswer).error).toBe("invalid_target");
    // A read-only consent (resource /api/mcp) never opens as an agent code.
    mocks.session.mockResolvedValueOnce(sessionPrincipal());
    const readOnly = await consent("approve", authRequest(clientId, { resource: `${ORIGIN}/api/mcp` }), {}, "supabase-session");
    expect(readOnly.body.code).toBe("AUTHORIZATION_GRANTED");
    const readOnlyCode = new URL(readOnly.body.redirectTo!).searchParams.get("code")!;
    expect(readOnlyCode.startsWith("tvagt_code_")).toBe(false);
    const asAgent = await exchange(codeGrant(clientId, readOnlyCode));
    expect(asAgent.status).toBe(400);
    expect((await asAgent.json() as TokenAnswer).error).toBe("invalid_target");
    // A forged agent prefix on a read-only code's body does not open either (sealing purpose differs).
    const forged = await exchange(codeGrant(clientId, `tvagt_code_${readOnlyCode.slice("tvmcp_code_".length)}`));
    expect((await forged.json() as TokenAnswer).error).toBe("invalid_grant");
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });
});

describe("WO-AGENT-OAUTH-1: scope and consent refusals", () => {
  it.each([
    ["a read-only scope", "worlds:read agent:read"],
    ["agent:propose without agent:read", "agent:propose"],
  ])("%s is invalid_scope, sent back to the client", async (_name, scope) => {
    const clientId = await registeredClient();
    const { body } = await consent("describe", authRequest(clientId, { scope }));
    expect(body).toMatchObject({ code: "AUTHORIZATION_REQUEST_REJECTED", error: "invalid_scope" });
    expect(new URL(body.redirectTo!).searchParams.get("error")).toBe("invalid_scope");
  });

  it("the read-only MCP still refuses an agent scope for its own resource", async () => {
    const clientId = await registeredClient();
    const { body } = await consent("describe", authRequest(clientId, { resource: `${ORIGIN}/api/mcp`, scope: "agent:read" }));
    expect(body).toMatchObject({ code: "AUTHORIZATION_REQUEST_REJECTED", error: "invalid_scope" });
  });

  it.each([
    ["a member", sessionPrincipal({ workspaceRole: "member" }), 403, "AGENT_MCP_MEMBER_UNAVAILABLE"],
    ["a free evaluation", sessionPrincipal({ accessSource: "trial" }), 402, "TRIAL_FEATURE_NOT_INCLUDED"],
    ["a workspace outside the agent cohort", sessionPrincipal({ workspaceKey: "pilot-beta" }), 404, "NOT_FOUND"],
    ["no session", { ok: false, code: "AUTH_REQUIRED", status: 401 }, 401, "AUTH_REQUIRED"],
  ])("approve by %s issues no code", async (_name, principal, status, code) => {
    const clientId = await registeredClient();
    mocks.session.mockResolvedValueOnce(principal);
    const answer = await consent("approve", authRequest(clientId), { allowPropose: true }, "supabase-session");
    expect(answer.status).toBe(status);
    expect(answer.body).toEqual({ code });
  });

  it("deny goes back to the client as access_denied with its state", async () => {
    const clientId = await registeredClient();
    const { body } = await consent("deny", authRequest(clientId));
    const url = new URL(body.redirectTo!);
    expect([body.code, url.searchParams.get("error"), url.searchParams.get("state")]).toEqual(["AUTHORIZATION_DENIED", "access_denied", "client-state-1"]);
  });

  it("the readiness precheck is not offered for the agent resource", async () => {
    const clientId = await registeredClient();
    expect((await consent("precheck", authRequest(clientId), {}, "supabase-session")).body.code).toBe("AUTHORIZATION_DECISION_INVALID");
  });
});

describe("WO-AGENT-OAUTH-1: code replay, expiry, cohort at issue", () => {
  it("a second redemption is invalid_grant and revokes the grant the first one made", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    expect((await exchange(codeGrant(clientId, code))).status).toBe(200);
    const again = await exchange(codeGrant(clientId, code));
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: "invalid_grant", error_description: "The authorization code was already used." });
    expect(mocks.grants).toHaveLength(1);
    expect(mocks.grants[0]!.revokedAt).not.toBeNull();
  });

  it("an expired code, a wrong verifier and another client are invalid_grant", async () => {
    const clientId = await registeredClient();
    const other = await registeredClient("Other");
    const code = await approvedCode(clientId);
    expect((await (await exchange(codeGrant(clientId, code, { code_verifier: `${VERIFIER}x` }))).json() as TokenAnswer).error).toBe("invalid_grant");
    expect((await (await exchange(codeGrant(other, code))).json() as TokenAnswer).error).toBe("invalid_grant");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 121_000);
    const late = await exchange(codeGrant(clientId, code));
    expect(await late.json()).toMatchObject({ error: "invalid_grant", error_description: "The authorization code has expired." });
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it("a workspace removed from the cohort between consent and exchange gets nothing, told as a resource that does not exist", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", "pilot-beta");
    const response = await exchange(codeGrant(clientId, code));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_target", error_description: "The resource is not this server's agent MCP endpoint." });
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it("a plan that turned into a free evaluation at issue time gets nothing", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    mocks.sessionProduct.mockResolvedValueOnce({ ok: true, access: { source: "trial" } });
    const response = await exchange(codeGrant(clientId, code));
    expect(response.status).toBe(402);
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it("review N3: a grant list cut at its cap is unknown, so the exchange is refused (503) and nothing is minted", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    mocks.truncated = true;
    const response = await exchange(codeGrant(clientId, code));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "temporarily_unavailable", error_description: "AGENT_GRANT_LIST_TRUNCATED" });
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it("review N1: a membership revision that moved is 403 with an invalid_token challenge, so the connector signs in again", async () => {
    const clientId = await registeredClient();
    const { access_token: bearer } = await agentToken(clientId);
    mocks.membership.mockResolvedValue({ ok: true, membership: { state: "active", authorizationRevision: 5, role: "owner" } });
    const response = await agentRpc(LIST, bearer);
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe("API_KEY_AUTHORIZATION_REVOKED");
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token", error_description="API_KEY_AUTHORIZATION_REVOKED"');
  });
});

/*
  403 classification (FOUNDER-DECISIONS-20261127-GPT-CRITICAL-PATH Q3; receipts/WO-COMMON/ACCEPTANCE.md item 5): a dead credential
  is challenged so the connector signs in again; a policy denial is not, because a new consent cannot restore it.
*/
describe("WO-AGENT-OAUTH-1: which refusals invite a new sign-in", () => {
  it("a revoked grant whose key still reads back is 403 with an invalid_token challenge (the credential is dead)", async () => {
    const clientId = await registeredClient();
    const { access_token: bearer } = await agentToken(clientId);
    mocks.keyOutlivesGrant.add(bearer!);
    mocks.grants[0]!.revokedAt = new Date().toISOString();
    const response = await agentRpc(LIST, bearer);
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("a member whose role was reduced: the token is refused with no challenge, and re-consent is refused with no code", async () => {
    const clientId = await registeredClient();
    const { access_token: bearer } = await agentToken(clientId, { allowPropose: true });
    // The demotion moves the authorization revision (atomic world activation trigger) and the role.
    mocks.membership.mockResolvedValue({ ok: true, membership: { state: "active", authorizationRevision: 5, role: "member" } });
    const refused = await agentRpc(LIST, bearer);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.message).toBe("API_KEY_AUTHORIZATION_REVOKED");
    expect(refused.headers.get("www-authenticate")).toBeNull();
    // A new consent rechecks the CURRENT role and refuses: a denial, not a challenge, and no code is issued.
    mocks.session.mockResolvedValueOnce(sessionPrincipal({ workspaceRole: "member", authorizationRevision: 5 }));
    const again = await consent("approve", authRequest(clientId), { allowPropose: true }, "supabase-session");
    expect(again).toEqual({ status: 403, body: { code: "AGENT_MCP_MEMBER_UNAVAILABLE" } });
    expect(mocks.createGrant).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a membership that ended", { ok: true, membership: { state: "removed", authorizationRevision: 4, role: "owner" } }, 403, "WORKSPACE_MEMBERSHIP_REQUIRED"],
    ["a membership store that cannot answer", { ok: false, code: "WORKSPACE_MEMBERSHIP_STORE_NOT_CONFIGURED", status: 503 }, 503, "WORKSPACE_MEMBERSHIP_STORE_NOT_CONFIGURED"],
  ])("%s is a denial with no challenge", async (_name, membership, status, code) => {
    const clientId = await registeredClient();
    const { access_token: bearer } = await agentToken(clientId);
    mocks.membership.mockResolvedValue(membership);
    const response = await agentRpc(LIST, bearer);
    expect(response.status).toBe(status);
    expect((await response.json()).error.message).toBe(code);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("a workspace taken out of the cohort: a bare 404, the same as no such endpoint, with no challenge", async () => {
    const clientId = await registeredClient();
    const { access_token: bearer } = await agentToken(clientId);
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", "pilot-beta");
    const response = await agentRpc(LIST, bearer);
    expect([response.status, await response.text(), response.headers.get("www-authenticate")]).toEqual([404, "", null]);
  });
});

describe("WO-AGENT-OAUTH-1: a failed step-up never takes away the existing read connection", () => {
  it("deny, a refused exchange and a grant that cannot be made all leave the read-only grant working and untouched", async () => {
    const clientId = await registeredClient();
    const { access_token: readToken } = await agentToken(clientId);
    const stepUp = { scope: "agent:read agent:propose" };
    // 1. The person declines the step-up.
    expect((await consent("deny", authRequest(clientId, stepUp))).body.code).toBe("AUTHORIZATION_DENIED");
    // 2. The step-up code is exchanged with a wrong verifier.
    const code = await approvedCode(clientId, { allowPropose: true }, stepUp);
    expect((await exchange(codeGrant(clientId, code, { code_verifier: `${VERIFIER}x` }))).status).toBe(400);
    // 3. The step-up grant cannot be created (key cap).
    mocks.createGrant.mockResolvedValueOnce({ ok: false, code: "AGENT_GRANT_LIMIT_REACHED" });
    const capped = await exchange(codeGrant(clientId, await approvedCode(clientId, { allowPropose: true }, stepUp)));
    expect(capped.status).toBe(409);
    expect(await capped.json()).toEqual({ error: "access_denied", error_description: "AGENT_GRANT_LIMIT_REACHED", code: "AGENT_GRANT_LIMIT_REACHED" });
    expect(mocks.grants).toHaveLength(1);
    expect(mocks.grants[0]!.revokedAt).toBeNull();
    expect((await agentRpc(LIST, readToken)).status).toBe(200);
    // The read-only MCP's keys are never touched by the agent flow.
    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.revokeKey).not.toHaveBeenCalled();
  });

  it("a successful step-up adds a grant and leaves the read-only one live (never widened, never revoked)", async () => {
    const clientId = await registeredClient();
    const { access_token: readToken } = await agentToken(clientId);
    const upgraded = await exchange(codeGrant(clientId, await approvedCode(clientId, { allowPropose: true }, { scope: "agent:read agent:propose" })));
    expect((await upgraded.json() as TokenAnswer).scope).toBe("agent:propose agent:read");
    expect(mocks.grants.map((grant) => [grant.scopes, grant.revokedAt])).toEqual([[["agent:read"], null], [["agent:propose", "agent:read"], null]]);
    expect((await agentRpc(LIST, readToken)).status).toBe(200);
  });
});

describe("WO-AGENT-OAUTH-1 review P1: ended OAuth grants do not pile up in the Agent access list", () => {
  const past = (ms: number) => new Date(Date.now() - ms).toISOString();
  const issuedLines = () => vi.mocked(console.info).mock.calls
    .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>).filter((entry) => entry.event === "agent_oauth_token_issued");
  const seed = (clientLabel: string, expiresAt: string) => {
    const grant: Grant = { grantId: `10000000-0000-4000-8000-${String(mocks.grants.length + 1).padStart(12, "0")}`, clientLabel, scopes: ["agent:read"],
      token: `tvnl_agt_seed${String(mocks.grants.length).padStart(8, "0")}_${"s".repeat(43)}`, expiresAt, revokedAt: null };
    mocks.grants.push(grant);
    return grant;
  };

  it("a new token revokes the person's expired OAuth grants that have no open proposal, and nothing else", async () => {
    const ended = seed("ChatGPT #AAAAAAAAAAAA", past(10 * 60_000));
    const withOpen = seed("ChatGPT #BBBBBBBBBBBB", past(10 * 60_000));
    const inGrace = seed("ChatGPT #CCCCCCCCCCCC", past(30_000));
    const panelExpired = seed("Claude Desktop", past(10 * 60_000));
    const panelLive = seed("My agent", new Date(Date.now() + 86_400_000).toISOString());
    mocks.openProposals.mockImplementation(async (_ws: string, grantId: string) => ({ ok: true, open: grantId === withOpen.grantId }));
    const clientId = await registeredClient();
    await agentToken(clientId);
    expect([ended, withOpen, inGrace, panelExpired, panelLive].map((grant) => grant.revokedAt !== null)).toEqual([true, false, false, false, false]);
    expect(mocks.openProposals.mock.calls.map((call) => call[1])).toEqual([ended.grantId, withOpen.grantId]);
    // The log line keeps its identity: candidates = swept + keptOpen + unknown + deferred.
    expect(issuedLines()[0]?.sweep).toEqual({ candidates: 2, swept: 1, keptOpen: 1, unknown: 0, deferred: 0 });
    // The grant just issued is live and untouched.
    expect(mocks.grants.at(-1)!.revokedAt).toBeNull();
  });

  it("a proposal check that fails, or throws, leaves the grant alone and never fails the token", async () => {
    const ended = seed("ChatGPT #DDDDDDDDDDDD", past(10 * 60_000));
    mocks.openProposals.mockResolvedValueOnce({ ok: false, code: "PROPOSAL_STORE_RESPONSE_INVALID", status: 503 });
    const clientId = await registeredClient();
    expect((await agentToken(clientId)).token_type).toBe("Bearer");
    mocks.openProposals.mockRejectedValueOnce(new Error("boom"));
    expect((await agentToken(clientId)).token_type).toBe("Bearer");
    expect(ended.revokedAt).toBeNull();
    // Not measured is null, never 0: the failed check is "unknown", the throw is no count at all.
    expect(issuedLines().map((entry) => entry.sweep)).toEqual([{ candidates: 1, swept: 0, keptOpen: 0, unknown: 1, deferred: 0 }, null]);
  });

  it("past the per-issuance cap the rest is counted as deferred, not dropped", async () => {
    for (let i = 0; i < 12; i += 1) seed(`ChatGPT #${String(i).padStart(12, "E")}`, past(10 * 60_000));
    const clientId = await registeredClient();
    await agentToken(clientId);
    expect(mocks.openProposals).toHaveBeenCalledTimes(10);
    expect(issuedLines()[0]?.sweep).toEqual({ candidates: 12, swept: 10, keptOpen: 0, unknown: 0, deferred: 2 });
  });
});

describe("WO-AGENT-OAUTH-1: flag off changes nothing", () => {
  it("metadata 404, the agent resource is the read-only MCP's invalid_target, an agent code does not open, the endpoint 404s", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "");
    const prm = await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/agent-mcp`), { params: Promise.resolve({ resource: ["api", "agent-mcp"] }) });
    expect(prm.status).toBe(404);
    const { body } = await consent("describe", authRequest(clientId));
    expect(body).toMatchObject({ code: "AUTHORIZATION_REQUEST_REJECTED", error: "invalid_target" });
    const exchanged = await exchange(codeGrant(clientId, code, { resource: "" }));
    expect((await exchanged.json() as TokenAnswer).error).toBe("invalid_grant");
    expect((await agentRpc(LIST)).status).toBe(404);
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it("a cohort that admits nobody turns the agent resource off the same way", async () => {
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", "");
    const prm = await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/agent-mcp`), { params: Promise.resolve({ resource: ["api", "agent-mcp"] }) });
    expect(prm.status).toBe(404);
  });

  it("issuer off (remote MCP flag unset): no challenge header on the agent endpoint, static credentials unaffected", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "");
    const response = await agentRpc(INITIALIZE);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });
});

describe("WO-AGENT-OAUTH-1: OFF is OFF (ACCEPTANCE item 4)", () => {
  it.each(["TRUE", "true ", "1", "yes"])("flag value %j is off: agent metadata 404, agent resource refused as the read-only MCP refuses it", async (value) => {
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", value);
    const prm = await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/agent-mcp`), { params: Promise.resolve({ resource: ["api", "agent-mcp"] }) });
    expect(prm.status).toBe(404);
    const clientId = await registeredClient();
    expect((await consent("describe", authRequest(clientId))).body).toMatchObject({ code: "AUTHORIZATION_REQUEST_REJECTED", error: "invalid_target" });
  });

  it("the issuer's metadata and the read-only resource metadata are byte-identical with the agent flag on and off", async () => {
    const snapshot = async () => [
      await (await authorizationServer(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).text(),
      await (await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`), { params: Promise.resolve({ resource: ["api", "mcp"] }) })).text(),
      await (await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`), { params: Promise.resolve({}) })).text(),
    ];
    const on = await snapshot();
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "");
    expect(await snapshot()).toEqual(on);
    expect(on.join("")).not.toContain("agent");
  });
});

describe("WO-AGENT-OAUTH-1: transport", () => {
  it("an Origin that is not this origin is refused before authorization; the same origin passes", async () => {
    const refused = await agentRpc(LIST, undefined, { origin: "https://evil.example" });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.message).toBe("MCP_ORIGIN_REFUSED");
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect((await agentRpc(LIST, undefined, { origin: ORIGIN })).status).toBe(401);
  });
});
