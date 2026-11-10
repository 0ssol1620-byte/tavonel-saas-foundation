import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  G11 REMOTE-MCP, contract stage (DECISION-REGISTER S6-09, S6-10).

  What these prove: the switch is a 404 everywhere while off; the remote tool list IS the stdio
  bridge's (nine reads, no write); every credential failure is a 401 or 403 before any route
  runs; a token for one workspace reads nothing of another; and the OAuth code + PKCE exchange
  mints a read-only, expiring developer key and refuses every tampered, stale or replayed input.

  What they do not prove: that a real client (ChatGPT, Claude) completes the flow against a real
  deployment. That is the preview-shadow step, and nothing here should be read as it.
*/

const MINE = "pilot-alpha";
const USER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const THEIR_COLLECTION = `collection-${"b".repeat(32)}`;
const ORIGIN = "https://tavonel.test";
const READ_SCOPES = ["ask:read", "collections:download", "collections:read", "documents:read", "worlds:read"];

const mocks = vi.hoisted(() => ({
  authenticateKey: vi.fn(),
  createKey: vi.fn(),
  listKeys: vi.fn(),
  revokeKey: vi.fn(),
  authorize: vi.fn(),
  session: vi.fn(),
  activeWorld: vi.fn(),
  listWorlds: vi.fn(),
  readModel: vi.fn(),
  loadCandidate: vi.fn(),
  signerEnv: vi.fn(),
  sessionProduct: vi.fn(),
  toolCall: vi.fn(async () => null),
  timing: vi.fn(async () => "not_recorded"),
}));

vi.mock("@/lib/operations-alert-triggers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-alert-triggers")>()),
  recordMcpToolCall: mocks.toolCall,
}));
vi.mock("@/lib/operations-e2e-timing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-e2e-timing")>()),
  recordFirstMcpAnswerTiming: mocks.timing,
}));

vi.mock("@/lib/developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  authenticateDeveloperApiKey: mocks.authenticateKey,
  createDeveloperApiKey: mocks.createKey,
  listRecentRemoteMcpKeys: mocks.listKeys,
  revokeDeveloperApiKey: mocks.revokeKey,
}));
vi.mock("@/lib/self-service-trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./self-service-trial")>()),
  authorizeFoundationSessionProduct: mocks.sessionProduct,
}));
vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: mocks.authorize,
  requireFoundationSession: mocks.session,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: mocks.activeWorld,
  listFoundationActiveWorlds: mocks.listWorlds,
}));
vi.mock("@/lib/world-read-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-read-model")>()),
  loadWorldReadModel: mocks.readModel,
}));
vi.mock("@/lib/collection-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./collection-storage")>()),
  loadPreferredCollectionCandidate: mocks.loadCandidate,
}));
vi.mock("@/lib/r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()),
  readR2SignerEnv: mocks.signerEnv,
}));

import { GET as mcpGet, POST as mcp } from "../app/api/mcp/route";
import { POST as register } from "../app/api/mcp/oauth/register/route";
import { POST as authorizeRoute } from "../app/api/mcp/oauth/authorize/route";
import { POST as token } from "../app/api/mcp/oauth/token/route";
import { GET as protectedResource } from "../app/.well-known/oauth-protected-resource/[[...resource]]/route";
import { GET as authorizationServer } from "../app/.well-known/oauth-authorization-server/route";
import OAuthAuthorizeLayout from "../app/oauth/authorize/layout";
import { TOOLS } from "../public/developer/tavonel-mcp.mjs";
import { REMOTE_MCP_SCOPES, REMOTE_MCP_TOOL_SCOPES, remoteMcpCohortRefusal, requestOrigin, summarizeRemoteMcpSli, toolFailureCode } from "./remote-mcp";
import { POST as createKeyRoute } from "../app/api/developer/keys/route";
import { insideRemoteMcpDispatch } from "./remote-mcp-dispatch";

const VERIFIER = "remote-mcp-pkce-verifier-0123456789-abcdefghij";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REDIRECT = "https://client.example/oauth/callback";

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return mcp(new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}
const call = (name: string, args: Record<string, unknown>, bearer?: string) =>
  rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, bearer ? { authorization: `Bearer ${bearer}` } : {});
const keyPrincipal = (scopes: string[]) => ({ ok: true, principal: { kind: "api-key", keyId: "key-1", workspaceKey: MINE, userId: USER, scopes, authorizationRevision: 4 } });

async function registeredClient() {
  const response = await register(new Request(`${ORIGIN}/api/mcp/oauth/register`, {
    method: "POST",
    body: JSON.stringify({ client_name: "Example agent", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  }));
  expect(response.status).toBe(201);
  return (await response.json() as { client_id: string }).client_id;
}

function consent(decision: string, request: Record<string, string>, bearer?: string) {
  return authorizeRoute(new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
    method: "POST",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    body: JSON.stringify({ decision, request }),
  }));
}

const authorizationRequest = (clientId: string, extra: Record<string, string> = {}) => ({
  response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
  code_challenge_method: "S256", state: "client-state-1", resource: `${ORIGIN}/api/mcp`, ...extra,
});

async function approvedCode(clientId: string) {
  mocks.session.mockResolvedValueOnce({ ok: true, principal: { kind: "session", workspaceKey: MINE, userId: USER, scopes: [], accessSource: "paid", authorizationRevision: 4, workspaceRole: "owner" } });
  const response = await consent("approve", authorizationRequest(clientId), "supabase-session");
  const body = await response.json() as { code: string; redirectTo: string };
  expect(body.code).toBe("AUTHORIZATION_GRANTED");
  return new URL(body.redirectTo).searchParams.get("code")!;
}

function exchange(fields: Record<string, string>) {
  return token(new Request(`${ORIGIN}/api/mcp/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "remote-mcp-unit-test-sealing-secret-value");
  // A1.0: the remote MCP canary cohort (TAVONEL_REMOTE_MCP_COHORT); both test workspaces are in it.
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", `${MINE},pilot-beta`);
  mocks.authenticateKey.mockResolvedValue(keyPrincipal(READ_SCOPES));
  mocks.authorize.mockResolvedValue({ ok: true, principal: { kind: "api-key", keyId: "key-1", workspaceKey: MINE, userId: USER, scopes: READ_SCOPES, authorizationRevision: 4, workspaceRole: "owner" } });
  mocks.listKeys.mockResolvedValue({ ok: true, keys: [] });
  mocks.createKey.mockResolvedValue({ ok: true, key: { keyId: "key-9" }, token: "tvnl_mcp_minted" });
  mocks.sessionProduct.mockResolvedValue({ ok: true, access: { source: "paid", accessPlan: "studio_access", billingExempt: false, expiresAt: null } });
  mocks.revokeKey.mockResolvedValue({ ok: true });
  mocks.activeWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
  mocks.readModel.mockResolvedValue({ ok: false, code: "WORLD_NOT_FOUND", status: 404 });
  mocks.loadCandidate.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
  mocks.signerEnv.mockReturnValue({ accountId: "acct", accessKeyId: "id", secretAccessKey: "secret", bucket: "b" });
});
afterEach(() => vi.unstubAllEnvs());

describe("TAVONEL_REMOTE_MCP_ENABLED off (production)", () => {
  it("answers 404 on every remote MCP route and touches no store", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "");
    const empty = { params: Promise.resolve({}) };
    const responses = await Promise.all([
      rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      mcpGet(),
      register(new Request(`${ORIGIN}/api/mcp/oauth/register`, { method: "POST", body: "{}" })),
      consent("describe", {}),
      exchange({ grant_type: "authorization_code" }),
      protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`), empty),
      authorizationServer(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`)),
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404, 404]);
    let thrown: unknown = null;
    try { OAuthAuthorizeLayout({ children: null }); } catch (error) { thrown = error; }
    expect(String((thrown as { digest?: unknown } | null)?.digest)).toMatch(/404/);
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });

  it("stays off for any value other than the exact string true", async () => {
    for (const value of ["1", "TRUE", "yes", " true"]) {
      vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", value);
      expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status, value).toBe(404);
    }
  });
});

describe("the remote tool list is the stdio bridge's", () => {
  it("lists exactly the bridge's nine read-only tools, byte for byte, with no key", async () => {
    const response = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(200);
    const { result } = await response.json() as { result: { tools: Array<{ name: string; description: string; inputSchema: unknown; annotations: unknown }> } };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "list_sources", "list_worlds", "get_world", "search_world", "ask_world",
      "get_object", "get_relation", "get_evidence", "download_package",
    ]);
    expect(result.tools).toEqual(TOOLS.map(({ name, description, inputSchema }: { name: string; description: string; inputSchema: unknown }) => ({
      name, description, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    })));
    expect(mocks.authenticateKey).not.toHaveBeenCalled();
  });

  it("has no tool that writes: every request is a GET or one of the two read POSTs", () => {
    const sample = { collectionId: `collection-${"0".repeat(32)}`, query: "sample query", question: "sample question" };
    for (const tool of TOOLS as Array<{ name: string; request: (input: unknown) => { method: string; path: string } }>) {
      const request = tool.request(sample);
      expect(request.method === "GET" || /\/(search|ask)$/.test(request.path), tool.name).toBe(true);
      expect(tool.name).not.toMatch(/upload|compile|promote|activate|rollback|delete|write|create|update|sync|revoke/);
    }
  });

  it("initializes as the bridge does", async () => {
    const response = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    const { result } = await response.json() as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect([result.protocolVersion, result.serverInfo.name]).toEqual(["2025-06-18", "tavonel-readonly"]);
  });

  it("pins each tool's scope to the literal its route authorizes with", () => {
    const routeOf: Record<string, string> = {
      list_sources: "app/api/documents/route.ts",
      list_worlds: "app/api/v1/collections/route.ts",
      get_world: "app/api/v1/world/[id]/route.ts",
      search_world: "app/api/collections/[id]/search/route.ts",
      ask_world: "app/api/collections/[id]/ask/route.ts",
      get_object: "app/api/v1/world/[id]/[lens]/route.ts",
      get_relation: "app/api/v1/world/[id]/[lens]/route.ts",
      get_evidence: "app/api/v1/world/[id]/[lens]/route.ts",
      download_package: "app/api/collections/[id]/download/route.ts",
    };
    expect(Object.keys(REMOTE_MCP_TOOL_SCOPES)).toEqual(TOOLS.map((tool: { name: string }) => tool.name));
    for (const [tool, scope] of Object.entries(REMOTE_MCP_TOOL_SCOPES)) {
      const source = readFileSync(resolve(import.meta.dirname, "..", routeOf[tool]!), "utf8");
      expect(source, tool).toContain(`authorizeFoundationRequest(request, "${scope}"`);
    }
    expect([...REMOTE_MCP_SCOPES]).toEqual(READ_SCOPES);
  });
});

describe("credential failures stop before any route runs", () => {
  const args = { collectionId: THEIR_COLLECTION };

  it("401s a tool call with no token and names where discovery starts", async () => {
    const response = await call("get_world", args);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("401s an unknown, expired, foreign-format or write-capable token as invalid_token", async () => {
    mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_INVALID" });
    mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_EXPIRED" });
    mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal([...READ_SCOPES, "connections:write"]));
    const outcomes = [
      await call("get_world", args, "tvnl_live_unknown"),
      await call("get_world", args, "tvnl_live_expired"),
      await call("get_world", args, "some-other-jwt"),
      await call("get_world", args, "tvnl_live_writer"),
    ];
    expect(outcomes.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    const challenges = outcomes.map((response) => response.headers.get("www-authenticate") ?? "");
    for (const challenge of challenges) expect(challenge).toContain('error="invalid_token"');
    expect(challenges[1]).toContain("expired");
    expect(challenges[3]).toContain("holds a scope outside the read-only MCP scopes");
    // A present-but-bad token is refused even for discovery.
    mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_INVALID" });
    expect((await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { authorization: "Bearer tvnl_live_unknown" })).status).toBe(401);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("403s a token without the tool's scope, with the scope it needs", async () => {
    mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal(["worlds:read"]));
    const response = await call("ask_world", { collectionId: THEIR_COLLECTION, question: "What changed?" }, "tvnl_live_narrow");
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope", error_description="This tool needs ask:read.", scope="ask:read"');
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
});

describe("a token for one workspace reads nothing of another", () => {
  for (const [tool, extra, store] of [
    ["get_world", {}, "readModel"],
    ["get_evidence", { limit: 5 }, "readModel"],
    ["download_package", {}, "loadCandidate"],
  ] as const) {
    it(`${tool} for a foreign collection is a 404 tool result from the caller's own workspace`, async () => {
      const response = await call(tool, { collectionId: THEIR_COLLECTION, ...extra }, "tvnl_live_mine");
      expect(response.status).toBe(200);
      const { result } = await response.json() as { result: { isError: boolean; content: Array<{ text: string }> } };
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.text).toMatch(/^API_ERROR_404/);
      const calls = mocks[store].mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) expect(args).toContain(MINE);
      // The route authorized the same bearer the client presented.
      expect(mocks.authorize.mock.calls[0]![0].headers.get("authorization")).toBe("Bearer tvnl_live_mine");
    });
  }

  it("passes a read through to the route and returns its body", async () => {
    mocks.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [{ collectionId: `collection-${"a".repeat(32)}`, manifestDigest: `sha256:${"d".repeat(64)}`, revision: 3 }], nextCursor: null });
    const response = await call("list_worlds", { limit: 5 }, "tvnl_live_mine");
    const { result } = await response.json() as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]!.text).collections).toHaveLength(1);
    expect(mocks.listWorlds).toHaveBeenCalledWith(MINE, { limit: 5, cursor: null });
  });
});

describe("W1-A3 operations signals from the MCP transport", () => {
  it("counts each tool call once, as a 5xx only when a route behind it answered 5xx", async () => {
    mocks.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [], nextCursor: null });
    await call("list_worlds", { limit: 5 }, "tvnl_live_mine");
    expect(mocks.toolCall).toHaveBeenLastCalledWith(false);

    mocks.authorize.mockResolvedValueOnce({ ok: false, code: "DEVELOPER_STORE_READ_FAILED", status: 503 });
    const failed = await call("list_worlds", { limit: 5 }, "tvnl_live_mine");
    expect(failed.status).toBe(200);
    expect(mocks.toolCall).toHaveBeenLastCalledWith(true);
    expect(mocks.toolCall).toHaveBeenCalledTimes(2);

    await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    expect(mocks.toolCall).toHaveBeenCalledTimes(2);
  });

  it("asks for the timing receipt only after an answer tool succeeded, for the caller's workspace", async () => {
    mocks.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [], nextCursor: null });
    await call("list_worlds", { limit: 5 }, "tvnl_live_mine");
    await call("get_world", { collectionId: THEIR_COLLECTION }, "tvnl_live_mine");
    expect(mocks.timing).not.toHaveBeenCalled();
  });
});

describe("the origin metadata is bound to", () => {
  it("is the host the client addressed, with the forwarded scheme, and the URL when no host is sent", () => {
    const at = (headers: Record<string, string>) => requestOrigin(new Request("http://localhost:3000/api/mcp", { headers }));
    expect(at({ host: "127.0.0.1:3471" })).toBe("http://127.0.0.1:3471");
    expect(at({ host: "tavonel.com", "x-forwarded-proto": "https" })).toBe("https://tavonel.com");
    expect(at({ host: "internal:3000", "x-forwarded-host": "preview.tavonel.test", "x-forwarded-proto": "https" })).toBe("https://preview.tavonel.test");
    expect(at({ host: "evil.test/path?x" , "x-forwarded-proto": "javascript" })).toBe("http://localhost:3000");
    expect(at({})).toBe("http://localhost:3000");
  });
});

describe("Streamable HTTP transport", () => {
  it("refuses a foreign Origin, an unsupported protocol version, a batch and unparseable JSON", async () => {
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await rpc(list, { origin: "https://attacker.test" })).status).toBe(403);
    expect((await rpc(list, { origin: ORIGIN })).status).toBe(200);
    expect((await rpc(list, { "mcp-protocol-version": "1999-01-01" })).status).toBe(400);
    expect((await rpc(list, { "mcp-protocol-version": "2025-06-18" })).status).toBe(200);
    expect((await rpc([list])).status).toBe(400);
    expect((await rpc("{not json")).status).toBe(400);
  });

  it("accepts a notification with 202 and no body, and answers GET with 405", async () => {
    const accepted = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect([accepted.status, await accepted.text()]).toEqual([202, ""]);
    const get = mcpGet();
    expect([get.status, get.headers.get("allow")]).toEqual([405, "POST"]);
  });
});

describe("OAuth 2.1 metadata and registration", () => {
  it("publishes RFC 9728 and RFC 8414 documents bound to the request origin", async () => {
    const resource = await (await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`), { params: Promise.resolve({ resource: ["api", "mcp"] }) })).json();
    expect(resource).toEqual({
      resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN], scopes_supported: READ_SCOPES,
      bearer_methods_supported: ["header"], resource_name: "TAVONEL Compiled World (read-only)",
    });
    expect((await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/other`), { params: Promise.resolve({ resource: ["other"] }) })).status).toBe(404);
    const server = await (await authorizationServer(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
    expect(server).toMatchObject({
      issuer: ORIGIN, authorization_endpoint: `${ORIGIN}/oauth/authorize`, token_endpoint: `${ORIGIN}/api/mcp/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/mcp/oauth/register`, code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code"], token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("registers public clients only, with https or loopback redirect URIs", async () => {
    const attempt = (body: unknown) => register(new Request(`${ORIGIN}/api/mcp/oauth/register`, { method: "POST", body: JSON.stringify(body) }));
    expect((await attempt({ redirect_uris: ["http://client.example/cb"] })).status).toBe(400);
    expect((await attempt({ redirect_uris: ["https://client.example/cb#frag"] })).status).toBe(400);
    expect((await attempt({ redirect_uris: ["https://user@client.example/cb"] })).status).toBe(400);
    expect((await attempt({ redirect_uris: ["https://user:pass@client.example/cb"] })).status).toBe(400);
    expect((await attempt({ redirect_uris: ["javascript:alert(1)"] })).status).toBe(400);
    expect((await attempt({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" })).status).toBe(400);
    expect((await attempt({ redirect_uris: ["http://127.0.0.1:33418/callback"] })).status).toBe(201);
  });

  it("fails closed with no sealing secret", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "short");
    expect((await register(new Request(`${ORIGIN}/api/mcp/oauth/register`, { method: "POST", body: JSON.stringify({ redirect_uris: [REDIRECT] }) }))).status).toBe(503);
    expect((await exchange({ grant_type: "authorization_code" })).status).toBe(503);
  });
});

describe("consent", () => {
  it("describes a valid request without any workspace, user or key identifier", async () => {
    const clientId = await registeredClient();
    const body = await (await consent("describe", authorizationRequest(clientId))).json();
    expect(body).toEqual({ code: "AUTHORIZATION_REQUEST_VALID", client: { name: "Example agent", redirectOrigin: "https://client.example" }, scopes: READ_SCOPES });
  });

  it("never redirects to an unverified client or an unregistered redirect URI", async () => {
    const clientId = await registeredClient();
    const forged = await consent("describe", authorizationRequest(`${clientId.slice(0, -4)}AAAA`));
    const elsewhere = await consent("describe", authorizationRequest(clientId, { redirect_uri: "https://attacker.test/cb" }));
    for (const response of [forged, elsewhere]) {
      expect(response.status).toBe(400);
      expect(await response.json()).not.toHaveProperty("redirectTo");
    }
  });

  /*
    REVIEW-2026-10-19 B1. Registration is open, so the registered string is the only thing a
    redirect may go to: compared exactly, never normalised, for every decision -- and a mismatch
    never reaches the session check.
  */
  it("matches the redirect URI exactly as registered, for describe, deny and approve", async () => {
    const clientId = await registeredClient();
    const variants = [
      `${REDIRECT}/`,
      `${REDIRECT}?next=1`,
      `${REDIRECT}?`,
      `${REDIRECT}#fragment`,
      "https://user@client.example/oauth/callback",
      "https://user:pass@client.example/oauth/callback",
      "http://client.example/oauth/callback",
      "https://client.example:8443/oauth/callback",
      "https://client.example:443/oauth/callback",
      "https://CLIENT.example/oauth/callback",
      "https://client.example/oauth/Callback",
      "https://client.example/oauth/callback/..",
      "https://client.example.attacker.test/oauth/callback",
      "",
    ];
    for (const variant of variants) {
      for (const decision of ["describe", "deny", "approve"]) {
        const response = await consent(decision, authorizationRequest(clientId, { redirect_uri: variant }), "supabase-session");
        const body = await response.json();
        expect([response.status, body.code], `${decision} ${variant}`).toEqual([400, "AUTHORIZATION_REQUEST_INVALID"]);
        expect(body, `${decision} ${variant}`).not.toHaveProperty("redirectTo");
      }
    }
    const missing: Record<string, string> = { ...authorizationRequest(clientId) };
    delete missing.redirect_uri;
    expect((await consent("describe", missing)).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("keeps a registered query exactly, and sends Deny and Allow to that URI and nowhere else", async () => {
    const withQuery = "https://client.example/oauth/callback?tenant=a";
    const registered = await register(new Request(`${ORIGIN}/api/mcp/oauth/register`, {
      method: "POST",
      body: JSON.stringify({ client_name: "Query agent", redirect_uris: [withQuery] }),
    }));
    const { client_id: clientId } = await registered.json() as { client_id: string };
    for (const variant of [REDIRECT, "https://client.example/oauth/callback?tenant=b", "https://client.example/oauth/callback?tenant=a&x=1"]) {
      expect((await consent("describe", authorizationRequest(clientId, { redirect_uri: variant }))).status, variant).toBe(400);
    }
    const request = authorizationRequest(clientId, { redirect_uri: withQuery });
    expect((await (await consent("describe", request)).json()).code).toBe("AUTHORIZATION_REQUEST_VALID");
    const destination = (redirectTo: string) => {
      const url = new URL(redirectTo);
      return [url.origin + url.pathname, url.searchParams.get("tenant"), [...url.searchParams.keys()].sort()];
    };
    const denied = await (await consent("deny", request)).json() as { redirectTo: string };
    expect(destination(denied.redirectTo)).toEqual([REDIRECT, "a", ["error", "error_description", "iss", "state", "tenant"]]);
    mocks.session.mockResolvedValueOnce({ ok: true, principal: { kind: "session", workspaceKey: MINE, userId: USER, scopes: [], accessSource: "paid", authorizationRevision: 4, workspaceRole: "owner" } });
    const granted = await (await consent("approve", request, "supabase-session")).json() as { code: string; redirectTo: string };
    expect(granted.code).toBe("AUTHORIZATION_GRANTED");
    expect(destination(granted.redirectTo)).toEqual([REDIRECT, "a", ["code", "iss", "state", "tenant"]]);
  });

  it("refuses a state longer than 512 characters on the page, without cutting it or sending the client anywhere", async () => {
    const clientId = await registeredClient();
    // REMOTE-MCP re-review N1: an error response must echo the state it was sent (RFC 6749 §4.1.2.1), and this one cannot,
    // so the refusal stays on the page, like a request whose client or redirect URI did not verify.
    for (const decision of ["describe", "deny", "approve"] as const) {
      const response = await consent(decision, authorizationRequest(clientId, { state: "s".repeat(513) }));
      const long = await response.json() as { code: string; error: string; description: string; redirectTo?: string };
      expect([response.status, long.code, long.error], decision).toEqual([400, "AUTHORIZATION_REQUEST_INVALID", "invalid_request"]);
      expect(long.description).toBe("The state parameter is longer than 512 characters.");
      expect(long, decision).not.toHaveProperty("redirectTo");
    }
    const longest = await (await consent("deny", authorizationRequest(clientId, { state: "s".repeat(512) }))).json() as { redirectTo: string };
    expect(new URL(longest.redirectTo).searchParams.get("state")).toBe("s".repeat(512));
  });

  it("sends PKCE, scope and resource errors back to the client with state and issuer", async () => {
    const clientId = await registeredClient();
    for (const [extra, error] of [
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ scope: "worlds:read connections:write" }, "invalid_scope"],
      [{ resource: "https://elsewhere.test/mcp" }, "invalid_target"],
      [{ response_type: "token" }, "unsupported_response_type"],
    ] as const) {
      const body = await (await consent("describe", authorizationRequest(clientId, extra))).json() as { code: string; redirectTo: string };
      expect(body.code).toBe("AUTHORIZATION_REQUEST_REJECTED");
      const back = new URL(body.redirectTo);
      expect([back.origin + back.pathname, back.searchParams.get("error"), back.searchParams.get("state"), back.searchParams.get("iss")])
        .toEqual([REDIRECT, error, "client-state-1", ORIGIN]);
      expect(back.searchParams.has("code")).toBe(false);
    }
  });

  it("W1-A2 flag on: a trial inside its bounds gets a code, and over a bound gets 402 TRIAL_LIMIT_REACHED and no code", async () => {
    const clientId = await registeredClient();
    vi.stubEnv("TAVONEL_TRIAL_AI_ACCESS_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://store.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
    let status = "allowed";
    const store = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://store.test/rest/v1/rpc/foundation_trial_ai_access");
      // Consent reads the bounds; it never spends a query.
      expect(JSON.parse(String(init?.body))).toMatchObject({ p_user_id: USER, p_workspace_key: MINE, p_consume_query: false });
      return new Response(JSON.stringify({ status, reason: status === "allowed" ? null : "TRIAL_AI_WORLD_LIMIT" }), { status: 200 });
    });
    vi.stubGlobal("fetch", store);
    try {
      const trialSession = { ok: true, principal: { kind: "session", workspaceKey: MINE, userId: USER, scopes: [], accessSource: "trial", authorizationRevision: 4, workspaceRole: "owner" } };
      mocks.session.mockResolvedValueOnce(trialSession);
      const granted = await consent("approve", authorizationRequest(clientId), "supabase-session");
      const body = await granted.json() as { code: string; redirectTo: string };
      expect([granted.status, body.code]).toEqual([200, "AUTHORIZATION_GRANTED"]);
      expect(new URL(body.redirectTo).searchParams.get("code")).toMatch(/^tvmcp_code_/);
      status = "limit_reached";
      mocks.session.mockResolvedValueOnce(trialSession);
      const capped = await consent("approve", authorizationRequest(clientId), "supabase-session");
      const cappedBody = await capped.json() as Record<string, unknown>;
      expect([capped.status, cappedBody.code, "redirectTo" in cappedBody]).toEqual([402, "TRIAL_LIMIT_REACHED", false]);
      expect(store).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("issues a code only to a session that could hold an API key", async () => {
    const clientId = await registeredClient();
    mocks.session.mockResolvedValueOnce({ ok: false, code: "AUTH_REQUIRED", status: 401 });
    expect((await consent("approve", authorizationRequest(clientId))).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ ok: true, principal: { workspaceKey: MINE, userId: USER, accessSource: "trial", authorizationRevision: 4 } });
    const trial = await consent("approve", authorizationRequest(clientId), "supabase-session");
    expect([trial.status, (await trial.json()).code]).toEqual([402, "TRIAL_FEATURE_NOT_INCLUDED"]);
    // W1-A2: with trial AI access on and its bounds unreadable, consent fails closed -- no code.
    vi.stubEnv("TAVONEL_TRIAL_AI_ACCESS_ENABLED", "true");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    mocks.session.mockResolvedValueOnce({ ok: true, principal: { workspaceKey: MINE, userId: USER, accessSource: "trial", authorizationRevision: 4 } });
    const unreadable = await consent("approve", authorizationRequest(clientId), "supabase-session");
    expect([unreadable.status, (await unreadable.json()).code]).toEqual([503, "TRIAL_AI_ACCESS_CHECK_FAILED"]);
    vi.stubEnv("TAVONEL_TRIAL_AI_ACCESS_ENABLED", "");
    const denied = await (await consent("deny", authorizationRequest(clientId))).json() as { redirectTo: string };
    expect(new URL(denied.redirectTo).searchParams.get("error")).toBe("access_denied");
    const code = await approvedCode(clientId);
    expect(code).toMatch(/^tvmcp_code_/);
    // Sealed: the workspace and the user are not readable from the code.
    expect(Buffer.from(code.slice("tvmcp_code_".length), "base64url").toString("latin1")).not.toContain(MINE);
  });
});

describe("token exchange", () => {
  it("mints a read-only developer key that expires with the token, and returns nothing internal", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    const before = Date.now();
    const response = await exchange({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: VERIFIER, resource: `${ORIGIN}/api/mcp` });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ access_token: "tvnl_mcp_minted", token_type: "Bearer", expires_in: 3600, scope: READ_SCOPES.join(" ") });
    const minted = mocks.createKey.mock.calls[0]![0];
    expect(minted).toMatchObject({ workspaceKey: MINE, userId: USER, authorizationRevision: 4, scopes: READ_SCOPES, audience: "mcp" });
    expect(minted.name).toMatch(/^MCP: Example agent ~[0-9a-f]{12} #[A-Za-z0-9_-]{22}$/);
    expect(Date.parse(minted.expiresAt) - before).toBeGreaterThanOrEqual(3_599_000);
    expect(Date.parse(minted.expiresAt) - before).toBeLessThanOrEqual(3_601_000);
  });

  it("refuses a wrong verifier, another client, a tampered code, a stale code and a non-form body", async () => {
    const clientId = await registeredClient();
    const otherClient = await registeredClient();
    const code = await approvedCode(clientId);
    const base = { grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER };
    const refusals = [
      await exchange({ ...base, code_verifier: `${VERIFIER}x` }),
      await exchange({ ...base, client_id: otherClient }),
      await exchange({ ...base, code: `${code.slice(0, -2)}AA` }),
      await exchange({ ...base, redirect_uri: "https://client.example/other" }),
      await exchange({ ...base, code: clientId }),
    ];
    for (const response of refusals) expect((await response.json()).error).toBe("invalid_grant");
    vi.useFakeTimers({ now: Date.now() + 121_000 });
    try {
      expect(await (await exchange(base)).json()).toMatchObject({ error: "invalid_grant", error_description: "The authorization code has expired." });
    } finally {
      vi.useRealTimers();
    }
    const json = await token(new Request(`${ORIGIN}/api/mcp/oauth/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(base) }));
    expect([json.status, (await json.json()).error]).toEqual([400, "invalid_request"]);
    expect(mocks.createKey).not.toHaveBeenCalled();
  });

  it("refuses a second redemption of one code and revokes the key the first one minted", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    const fields = { grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER };
    expect((await exchange(fields)).status).toBe(200);
    const name = mocks.createKey.mock.calls[0]![0].name as string;
    mocks.listKeys.mockResolvedValueOnce({ ok: true, keys: [{ keyId: "key-9", name, revokedAt: null }] });
    const second = await exchange(fields);
    expect([second.status, (await second.json()).error]).toEqual([400, "invalid_grant"]);
    expect(mocks.revokeKey).toHaveBeenCalledWith(MINE, USER, 4, "key-9");
    expect(mocks.createKey).toHaveBeenCalledTimes(1);
  });

  it("refuses when the member's authorization changed after consent", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    mocks.createKey.mockResolvedValueOnce({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY" });
    const response = await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER });
    expect([response.status, (await response.json()).error]).toEqual([400, "invalid_grant"]);
  });
});

/*
  W1-A1.0 (PROGRAM-2026-11-04 §4.A). The remote MCP reuses the processing cohort -- no cohort flag
  of its own -- and, being a canary, admits nobody while that cohort is unset, malformed or wider
  than the D-19 cap of three. Checked at consent, at minting and on every call.
*/
describe("A1.0: the processing cohort gates every token and every call", () => {
  const args = { collectionId: THEIR_COLLECTION };

  it("refuses to mint a token for a workspace outside the cohort, with 403 REMOTE_MCP_COHORT_EXCLUDED", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
    const response = await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "access_denied", error_description: "REMOTE_MCP_COHORT_EXCLUDED", code: "REMOTE_MCP_COHORT_EXCLUDED" });
    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.listKeys).not.toHaveBeenCalled();
  });

  it("refuses consent for a workspace outside the cohort before any code exists", async () => {
    const clientId = await registeredClient();
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
    mocks.session.mockResolvedValueOnce({ ok: true, principal: { kind: "session", workspaceKey: MINE, userId: USER, scopes: [], accessSource: "paid", authorizationRevision: 4, workspaceRole: "owner" } });
    const response = await consent("approve", authorizationRequest(clientId), "supabase-session");
    const body = await response.json();
    expect([response.status, body.code]).toEqual([403, "REMOTE_MCP_COHORT_EXCLUDED"]);
    expect(body).not.toHaveProperty("redirectTo");
  });

  it("refuses a live token's call once its workspace is outside the cohort, before any route runs", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
    const response = await call("get_world", args, "tvnl_live_mine");
    expect(response.status).toBe(403);
    expect((await response.json()).error).toEqual({ code: -32001, message: "REMOTE_MCP_COHORT_EXCLUDED" });
    expect(mocks.authorize).not.toHaveBeenCalled();
    // Discovery without a token names no workspace, so it stays open.
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(200);
  });

  it("admits nobody when the cohort is unset, empty, malformed or wider than the canary", async () => {
    const clientId = await registeredClient();
    for (const value of [undefined, "", " ", "pilot-*", "pilot-alpha,", "pilot-alpha;pilot-beta", "pilot-alpha,pilot-b,pilot-c,pilot-d"]) {
      const code = await approvedCodeUnder(clientId);
      if (value === undefined) vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", undefined as unknown as string);
      else vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", value);
      const minted = await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER });
      expect([minted.status, (await minted.json()).code], String(value)).toEqual([503, "REMOTE_MCP_COHORT_CONFIG_INVALID"]);
      const called = await call("get_world", args, "tvnl_live_mine");
      expect([called.status, (await called.json()).error.message], String(value)).toEqual([503, "REMOTE_MCP_COHORT_CONFIG_INVALID"]);
      vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", `${MINE},pilot-beta`);
    }
    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("401s an expired token and a token revoked a moment ago, with invalid_token", async () => {
    mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_EXPIRED" });
    const expired = await call("list_worlds", {}, "tvnl_live_expired");
    expect(expired.status).toBe(401);
    expect(expired.headers.get("www-authenticate")).toContain('error="invalid_token", error_description="The access token has expired."');
    // Revocation is the key row's revoked_at, read on every call: the next call after it is a 401.
    mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal(READ_SCOPES));
    mocks.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [], nextCursor: null });
    expect((await call("list_worlds", {}, "tvnl_live_mine")).status).toBe(200);
    mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_INVALID" });
    const revoked = await call("list_worlds", {}, "tvnl_live_mine");
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain('error="invalid_token", error_description="The access token is not valid."');
  });

  it("refuses to load the route when the tool table it imports holds a write tool", async () => {
    vi.resetModules();
    vi.doMock("@/public/developer/tavonel-mcp.mjs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../public/developer/tavonel-mcp.mjs")>();
      const promote = { name: "promote_world", request: () => ({ method: "POST", path: "/api/v1/collections/x/promote" }) };
      return { ...actual, TOOLS: [...actual.TOOLS, promote] };
    });
    try {
      await expect(import("../app/api/mcp/route")).rejects.toThrow("MCP_WRITE_TOOL_REFUSED");
    } finally {
      vi.doUnmock("@/public/developer/tavonel-mcp.mjs");
      vi.resetModules();
    }
  });
});

/** A code minted while the default cohort is in force, whatever a test sets afterwards. */
async function approvedCodeUnder(clientId: string) {
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", `${MINE},pilot-beta`);
  return approvedCode(clientId);
}

describe("telemetry: funnel events and the SLI line carry no identifier", () => {
  const lines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

  it("records mcp_token_issued on a minted token, and nothing else from the token route", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect((await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER })).status).toBe(200);
      expect(lines(info)).toEqual([{ event: "mcp_token_issued" }]);
    } finally { info.mockRestore(); }
  });

  it("records mcp_tool_called for a tool that ran, mcp_tool_failed with the constant code, and one SLI line per POST", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      mocks.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [], nextCursor: null });
      await call("list_worlds", {}, "tvnl_live_mine");
      await call("get_world", { collectionId: THEIR_COLLECTION }, "tvnl_live_mine");
      await call("get_world", { collectionId: THEIR_COLLECTION });
      await call("not_a_tool_the-client typed", {}, "tvnl_live_mine");
      const recorded = lines(info);
      const funnel = recorded.filter((line) => "event" in line);
      expect(funnel).toEqual([
        { event: "mcp_tool_called", tool: "list_worlds" },
        { event: "mcp_tool_called", tool: "get_world" },
        { event: "mcp_tool_failed", tool: "get_world", code: "WORLD_NOT_FOUND" },
        { event: "mcp_tool_failed", tool: "get_world", code: "AUTH_REQUIRED" },
        { event: "mcp_tool_called", tool: "unknown" },
        { event: "mcp_tool_failed", tool: "unknown", code: "TOOL_NOT_FOUND" },
      ]);
      const sli = recorded.filter((line) => "sli" in line);
      expect(sli.map((line) => [line.method, line.tool, line.status, line.upstreamStatus])).toEqual([
        ["tools/call", "list_worlds", 200, 200], ["tools/call", "get_world", 200, 404], ["tools/call", "get_world", 401, null], ["tools/call", "unknown", 200, null],
      ]);
      for (const line of sli) expect(typeof line.durationMs).toBe("number");
      expect(JSON.stringify(recorded)).not.toContain(THEIR_COLLECTION);
      expect(JSON.stringify(recorded)).not.toContain("tvnl_live_mine");
    } finally { info.mockRestore(); }
  });

  it("reduces a failure to its constant code and summarizes latency and 5xx over every call", () => {
    expect(toolFailureCode("API_ERROR_404: WORLD_NOT_FOUND")).toBe("WORLD_NOT_FOUND");
    expect(toolFailureCode("API_ERROR_503: UNKNOWN")).toBe("UNKNOWN");
    expect(toolFailureCode("INPUT_INVALID: question must be text about pilot-alpha")).toBe("INPUT_INVALID");
    expect(toolFailureCode("a sentence with an id collection-123")).toBe("TOOL_FAILED");
    expect(toolFailureCode(undefined)).toBe("TOOL_FAILED");
    expect(summarizeRemoteMcpSli([])).toEqual({ calls: 0, p50Ms: null, p95Ms: null, http5xx: 0, server5xx: 0, server5xxRatio: null });
    const records = Array.from({ length: 20 }, (_, index) => ({ status: index === 0 ? 503 : 200, upstreamStatus: index === 1 ? 503 : index === 2 ? 404 : null, durationMs: index + 1 }));
    // One HTTP 5xx and one tool whose route answered 503 inside a 200: two of twenty. A 404 is not a 5xx.
    expect(summarizeRemoteMcpSli(records)).toEqual({ calls: 20, p50Ms: 10, p95Ms: 19, http5xx: 1, server5xx: 2, server5xxRatio: 0.1 });
  });
});

describe("review R1: audience, failures, cohort, key churn, trial", () => {
  it("M1: dispatches every tool to its /api/v1 handler inside the remote MCP context, and nothing outside it", async () => {
    const contexts: boolean[] = [];
    mocks.authorize.mockImplementation(async () => {
      contexts.push(insideRemoteMcpDispatch());
      return { ok: true, principal: { kind: "api-key", keyId: "key-1", workspaceKey: MINE, userId: USER, scopes: READ_SCOPES, authorizationRevision: 4, workspaceRole: "owner" } };
    });
    mocks.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [], nextCursor: null });
    await call("list_worlds", {}, "tvnl_mcp_mine");
    expect(contexts).toEqual([true]);
    expect(insideRemoteMcpDispatch()).toBe(false);
  });

  it("M1: with the switch off or the workspace out of the cohort, a tvnl_mcp_ token is refused at /api/mcp (the REST API refuses it always: remote-mcp-r1.test.ts)", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
    const out = await call("list_worlds", {}, "tvnl_mcp_mine");
    expect([out.status, (await out.json()).error.message]).toEqual([403, "REMOTE_MCP_COHORT_EXCLUDED"]);
    vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "false");
    expect((await call("list_worlds", {}, "tvnl_mcp_mine")).status).toBe(404);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("M2: a handler that throws is a 5xx in the SLI and a constant code to the client, never the exception's text", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.authorize.mockRejectedValueOnce(new Error("connection to db-internal.example refused for pilot-alpha"));
      const response = await call("list_worlds", {}, "tvnl_mcp_mine");
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.result).toMatchObject({ isError: true, content: [{ type: "text", text: "API_ERROR_500: REMOTE_MCP_INTERNAL_ERROR" }] });
      expect(JSON.stringify(body)).not.toContain("db-internal");
      const sli = info.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>).filter((line) => "sli" in line);
      expect(sli.map((line) => [line.status, line.upstreamStatus])).toEqual([[200, 500]]);
      expect(summarizeRemoteMcpSli(sli as never)).toMatchObject({ calls: 1, http5xx: 0, server5xx: 1 });
      const logged = error.mock.calls.map(([line]) => JSON.parse(String(line)));
      expect(logged).toEqual([{ event: "remote_mcp_dispatch_threw", requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), error: "Error" }]);
    } finally { info.mockRestore(); error.mockRestore(); }
  });

  it("M5: the canary reads TAVONEL_REMOTE_MCP_COHORT, never the processing cohort", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", undefined as unknown as string);
    vi.stubEnv("TAVONEL_PROCESSING_WORKSPACE_COHORT", MINE);
    const refused = await call("list_worlds", {}, "tvnl_mcp_mine");
    expect([refused.status, (await refused.json()).error.message]).toEqual([503, "REMOTE_MCP_COHORT_CONFIG_INVALID"]);
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", MINE);
    vi.stubEnv("TAVONEL_PROCESSING_WORKSPACE_COHORT", "pilot-beta");
    mocks.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [], nextCursor: null });
    expect((await (await call("list_worlds", {}, "tvnl_mcp_mine")).json()).result.isError).toBe(false);
  });

  it("M6: a reconnect revokes the same client's live keys, and no other client's, expired or revoked key", async () => {
    const clientId = await registeredClient();
    const otherClient = await registeredClient();
    const tag = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 12);
    const live = new Date(Date.now() + 600_000).toISOString();
    const gone = new Date(Date.now() - 1_000).toISOString();
    mocks.listKeys.mockResolvedValueOnce({ ok: true, keys: [
      { keyId: "same-live", name: `MCP: Example agent ~${tag(clientId)} #a`, expiresAt: live, revokedAt: null },
      { keyId: "same-expired", name: `MCP: Example agent ~${tag(clientId)} #b`, expiresAt: gone, revokedAt: null },
      { keyId: "same-revoked", name: `MCP: Example agent ~${tag(clientId)} #c`, expiresAt: live, revokedAt: gone },
      { keyId: "other-live", name: `MCP: Example agent ~${tag(otherClient)} #d`, expiresAt: live, revokedAt: null },
    ] });
    const code = await approvedCode(clientId);
    const response = await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER });
    expect(response.status).toBe(200);
    expect(mocks.listKeys).toHaveBeenCalledWith(MINE, USER, expect.any(String));
    expect(mocks.revokeKey.mock.calls.map((args) => args[3])).toEqual(["same-live"]);
    // The new key is minted before the old one goes, so a failed revoke never leaves the client without a key.
    expect(mocks.createKey.mock.invocationCallOrder[0]).toBeLessThan(mocks.revokeKey.mock.invocationCallOrder[0]!);
  });

  it("M6: a hand-made key may not take the MCP: name the remote MCP's own keys are listed and revoked by", async () => {
    mocks.session.mockResolvedValue({ ok: true, principal: { kind: "session", workspaceKey: MINE, userId: USER, scopes: [], accessSource: "paid", authorizationRevision: 4, workspaceRole: "owner" } });
    for (const name of ["MCP: Claude", "mcp:x", "  MCP:spoof"]) {
      const response = await createKeyRoute(new Request(`${ORIGIN}/api/developer/keys`, { method: "POST", body: JSON.stringify({ name, scopes: ["worlds:read"] }) }));
      expect([response.status, (await response.json()).code], name).toEqual([400, "API_KEY_INPUT_INVALID"]);
    }
    expect(mocks.createKey).not.toHaveBeenCalled();
  });

  it("refuses a free evaluation at token issue too, not only at consent, and mints nothing", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    mocks.sessionProduct.mockResolvedValueOnce({ ok: true, access: { source: "trial", accessPlan: "observer_access", billingExempt: false, expiresAt: null } });
    const response = await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER });
    expect([response.status, await response.json()]).toEqual([402, { error: "access_denied", error_description: "TRIAL_FEATURE_NOT_INCLUDED", code: "TRIAL_FEATURE_NOT_INCLUDED" }]);
    mocks.sessionProduct.mockResolvedValueOnce({ ok: false, code: "BILLING_STORE_UNAVAILABLE", status: 503 });
    const unknown = await exchange({ grant_type: "authorization_code", code: await approvedCode(clientId), client_id: clientId, code_verifier: VERIFIER });
    expect([unknown.status, (await unknown.json()).error]).toEqual([503, "temporarily_unavailable"]);
    expect(mocks.createKey).not.toHaveBeenCalled();
  });

  it("W1-A2 flag on: the one-live-key cap is checked at token issue -- a held key refuses, a reconnect's own keys do not count", async () => {
    vi.stubEnv("TAVONEL_TRIAL_AI_ACCESS_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://store.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
    const trialProduct = { ok: true, access: { source: "trial", accessPlan: "observer_access", billingExempt: false, expiresAt: null } };
    let held = true;
    const keyReads: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/rest/v1/foundation_api_keys") {
        keyReads.push(parsed);
        return new Response(JSON.stringify(held ? [{ key_id: "manual-1" }] : []), { status: 200 });
      }
      expect(parsed.pathname).toBe("/rest/v1/rpc/foundation_trial_ai_access");
      return new Response(JSON.stringify({ status: "allowed", reason: null }), { status: 200 });
    }));
    try {
      const clientId = await registeredClient();
      // A live key (hand-made or MCP, whatever its name) is the trial's one key: no second one is minted.
      mocks.sessionProduct.mockResolvedValueOnce(trialProduct);
      const capped = await exchange({ grant_type: "authorization_code", code: await approvedCode(clientId), client_id: clientId, code_verifier: VERIFIER });
      expect([capped.status, await capped.json()]).toEqual([402, { error: "access_denied", error_description: "TRIAL_LIMIT_REACHED", code: "TRIAL_LIMIT_REACHED" }]);
      expect(keyReads[0]!.searchParams.has("token_kind")).toBe(false);
      expect(keyReads[0]!.searchParams.has("name")).toBe(false);
      expect(mocks.createKey).not.toHaveBeenCalled();

      // A reconnect: the same client's live key is excluded from the count, then replaced.
      held = false;
      const tag = createHash("sha256").update(clientId).digest("hex").slice(0, 12);
      mocks.listKeys.mockResolvedValueOnce({ ok: true, keys: [
        { keyId: "same-live", name: `MCP: Example agent ~${tag} #a`, expiresAt: new Date(Date.now() + 600_000).toISOString(), revokedAt: null },
      ] });
      mocks.sessionProduct.mockResolvedValueOnce(trialProduct);
      const reconnect = await exchange({ grant_type: "authorization_code", code: await approvedCode(clientId), client_id: clientId, code_verifier: VERIFIER });
      expect(reconnect.status).toBe(200);
      expect(keyReads[1]!.searchParams.get("key_id")).toBe("not.in.(same-live)");
      expect(mocks.revokeKey.mock.calls.map((args) => args[3])).toEqual(["same-live"]);

      // Unreadable bounds fail closed: 503, nothing minted.
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
      mocks.createKey.mockClear();
      mocks.sessionProduct.mockResolvedValueOnce(trialProduct);
      const unreadable = await exchange({ grant_type: "authorization_code", code: await approvedCode(clientId), client_id: clientId, code_verifier: VERIFIER });
      expect([unreadable.status, (await unreadable.json()).code]).toEqual([503, "TRIAL_AI_ACCESS_CHECK_FAILED"]);
      expect(mocks.createKey).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/*
  General availability (2026-11-09): TAVONEL_REMOTE_MCP_COHORT=all drops the workspace list and
  nothing else. Each failure path below is the one that still has to hold once the list is gone.
*/
describe("GA: the cohort value all admits every workspace and keeps every other check", () => {
  const args = { collectionId: THEIR_COLLECTION };
  beforeEach(() => vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "all"));

  it("admits a workspace no list names: consent, token and a tool call", async () => {
    expect(remoteMcpCohortRefusal("pilot-zz9", { TAVONEL_REMOTE_MCP_COHORT: "all" })).toBeNull();
    const clientId = await registeredClient();
    const minted = await exchange({ grant_type: "authorization_code", code: await approvedCode(clientId), client_id: clientId, code_verifier: VERIFIER });
    expect(minted.status).toBe(200);
    expect(mocks.createKey).toHaveBeenCalledTimes(1);
    mocks.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [], nextCursor: null });
    expect((await call("list_worlds", {}, "tvnl_live_mine")).status).toBe(200);
  });

  it("is exact: any other spelling, or all beside a workspace, admits nobody", async () => {
    for (const value of ["ALL", " all", "all ", "*", "all,pilot-alpha", "pilot-alpha,all"]) {
      vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", value);
      const called = await call("get_world", args, "tvnl_live_mine");
      expect([called.status, (await called.json()).error.message], value).toEqual([503, "REMOTE_MCP_COHORT_CONFIG_INVALID"]);
    }
    // A principal whose workspace key is not a workspace key is never admitted by all.
    expect(remoteMcpCohortRefusal("not-a-workspace", { TAVONEL_REMOTE_MCP_COHORT: "all" })).toBe("REMOTE_MCP_COHORT_EXCLUDED");
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("a disabled switch is still a 404 everywhere", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "");
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(404);
    expect((await call("list_worlds", {}, "tvnl_live_mine")).status).toBe(404);
    expect((await exchange({ grant_type: "authorization_code" })).status).toBe(404);
    expect(mocks.authenticateKey).not.toHaveBeenCalled();
  });

  it("a revoked key is a 401 before any route runs", async () => {
    mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_INVALID" });
    const revoked = await call("list_worlds", {}, "tvnl_live_mine");
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("a key for one workspace still reads nothing of another", async () => {
    const response = await call("get_world", args, "tvnl_live_mine");
    const { result } = await response.json() as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect([response.status, result.isError]).toEqual([200, true]);
    expect(result.content[0]!.text).toMatch(/^API_ERROR_404/);
    for (const called of mocks.readModel.mock.calls) expect(called).toContain(MINE);
  });

  it("an over-limit key gets the route's 429 as the tool result, and the route is not run past it", async () => {
    mocks.authorize.mockResolvedValueOnce({ ok: false, code: "API_RATE_LIMITED", status: 429 });
    const response = await call("list_worlds", {}, "tvnl_live_mine");
    const { result } = await response.json() as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect([response.status, result.isError]).toEqual([200, true]);
    expect(result.content[0]!.text).toMatch(/^API_ERROR_429: API_RATE_LIMITED/);
    expect(mocks.listWorlds).not.toHaveBeenCalled();
  });

  it("a free evaluation still gets no token while trial AI access is off", async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    mocks.sessionProduct.mockResolvedValueOnce({ ok: true, access: { source: "trial", accessPlan: "observer_access", billingExempt: false, expiresAt: null } });
    const response = await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER });
    expect([response.status, (await response.json()).code]).toEqual([402, "TRIAL_FEATURE_NOT_INCLUDED"]);
    expect(mocks.createKey).not.toHaveBeenCalled();
  });
});

describe("a hand-made key can be made to work at /api/mcp", () => {
  it("the Developers panel offers the exact scopes checkBearer accepts, and a key holding them is admitted", async () => {
    const { CONNECT_AI_SCOPES } = await import("../components/workspace/connect-ai-panel");
    expect([...CONNECT_AI_SCOPES].sort()).toEqual([...REMOTE_MCP_SCOPES]);
    const panel = readFileSync(resolve(import.meta.dirname, "../components/developer-panel.tsx"), "utf8");
    expect(panel).toContain("onClick={() => setScopes([...CONNECT_AI_SCOPES])}");
    mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal([...CONNECT_AI_SCOPES]));
    mocks.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [], nextCursor: null });
    expect((await call("list_worlds", {}, "tvnl_live_preset")).status).toBe(200);
    // One scope more, a connector read, and the same key is refused before any route runs.
    mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal([...CONNECT_AI_SCOPES, "connections:read"]));
    const refused = await call("list_worlds", {}, "tvnl_live_wider");
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain("holds a scope outside the read-only MCP scopes");
  });
});
