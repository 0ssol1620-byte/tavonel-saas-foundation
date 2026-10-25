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
}));

vi.mock("@/lib/developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  authenticateDeveloperApiKey: mocks.authenticateKey,
  createDeveloperApiKey: mocks.createKey,
  listDeveloperApiKeys: mocks.listKeys,
  revokeDeveloperApiKey: mocks.revokeKey,
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
import { REMOTE_MCP_SCOPES, REMOTE_MCP_TOOL_SCOPES, requestOrigin } from "./remote-mcp";

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
  mocks.authenticateKey.mockResolvedValue(keyPrincipal(READ_SCOPES));
  mocks.authorize.mockResolvedValue({ ok: true, principal: { kind: "api-key", keyId: "key-1", workspaceKey: MINE, userId: USER, scopes: READ_SCOPES, authorizationRevision: 4, workspaceRole: "owner" } });
  mocks.listKeys.mockResolvedValue({ ok: true, keys: [] });
  mocks.createKey.mockResolvedValue({ ok: true, key: { keyId: "key-9" }, token: "tvnl_live_minted" });
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
    expect(challenges[3]).toContain("write scope");
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

  it("refuses a state longer than 512 characters instead of cutting it", async () => {
    const clientId = await registeredClient();
    const long = await (await consent("describe", authorizationRequest(clientId, { state: "s".repeat(513) }))).json() as { code: string; error: string; redirectTo: string };
    expect([long.code, long.error]).toEqual(["AUTHORIZATION_REQUEST_REJECTED", "invalid_request"]);
    expect(new URL(long.redirectTo).searchParams.has("state")).toBe(false);
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

  it("issues a code only to a session that could hold an API key", async () => {
    const clientId = await registeredClient();
    mocks.session.mockResolvedValueOnce({ ok: false, code: "AUTH_REQUIRED", status: 401 });
    expect((await consent("approve", authorizationRequest(clientId))).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ ok: true, principal: { workspaceKey: MINE, userId: USER, accessSource: "trial", authorizationRevision: 4 } });
    const trial = await consent("approve", authorizationRequest(clientId), "supabase-session");
    expect([trial.status, (await trial.json()).code]).toEqual([402, "TRIAL_FEATURE_NOT_INCLUDED"]);
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
    expect(await response.json()).toEqual({ access_token: "tvnl_live_minted", token_type: "Bearer", expires_in: 3600, scope: READ_SCOPES.join(" ") });
    const minted = mocks.createKey.mock.calls[0]![0];
    expect(minted).toMatchObject({ workspaceKey: MINE, userId: USER, authorizationRevision: 4, scopes: READ_SCOPES });
    expect(minted.name).toMatch(/^MCP: Example agent #[A-Za-z0-9_-]{22}$/);
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
