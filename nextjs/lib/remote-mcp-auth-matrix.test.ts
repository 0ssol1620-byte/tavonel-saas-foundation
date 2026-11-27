import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-D19-4. An enumerated auth / expiry / revoke / origin / error matrix for the remote MCP and its
  OAuth routes. One uniquely named case per refusal, grouped by the surface it attacks; the last
  test pins the count and the uniqueness of the names so a case cannot be dropped or duplicated
  without this file saying so.

  The mock harness is the one in remote-mcp.test.ts (vi.mock calls are file-scoped, so it is
  repeated). Same limit as that file: every store is a mock. Nothing here proves the same refusals
  over TLS against a real deployment and real stores (that is WO-D19-10, EXTERNAL).

  "1999-01-01" is the unsupported protocol version on purpose: a later work order may add newer
  versions, and it must not turn one of these refusals into an acceptance.
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
import { REMOTE_MCP_TOOL_SCOPES } from "./remote-mcp";

const VERIFIER = "remote-mcp-pkce-verifier-0123456789-abcdefghij";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REDIRECT = "https://client.example/oauth/callback";
const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return mcp(new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}
const call = (name: string, args: Record<string, unknown>, bearer?: string, headers: Record<string, string> = {}) =>
  rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers });
const keyPrincipal = (scopes: string[]) => ({ ok: true, principal: { kind: "api-key", keyId: "key-1", workspaceKey: MINE, userId: USER, scopes, authorizationRevision: 4 } });
const sessionPrincipal = (accessSource = "paid") => ({ ok: true, principal: { kind: "session", workspaceKey: MINE, userId: USER, scopes: [], accessSource, authorizationRevision: 4, workspaceRole: "owner" } });
type ToolResult = { result: { isError: boolean; content: Array<{ text: string }> } };
const resultText = async (response: Response) => ((await response.json()) as ToolResult).result.content[0]!.text;

const registerRaw = (body: string) => register(new Request(`${ORIGIN}/api/mcp/oauth/register`, { method: "POST", body }));
const registerJson = (body: unknown) => registerRaw(JSON.stringify(body));
async function registeredClient(name = "Example agent") {
  const response = await registerJson({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
  expect(response.status).toBe(201);
  return (await response.json() as { client_id: string }).client_id;
}

const consentRaw = (body: string, bearer?: string) => authorizeRoute(new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
  method: "POST",
  headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  body,
}));
const consent = (decision: string, request: Record<string, string>, bearer?: string) => consentRaw(JSON.stringify({ decision, request }), bearer);
/** The authorization request, with any parameter dropped by passing undefined for it. */
function authRequest(clientId: string, overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
    code_challenge_method: "S256", state: "client-state-1", resource: `${ORIGIN}/api/mcp`, ...overrides,
  };
  return Object.fromEntries(Object.entries(base).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
type Describe = { code: string; error?: string; redirectTo?: string };
async function describeRequest(clientId: string, overrides: Record<string, string | undefined>) {
  const response = await consent("describe", authRequest(clientId, overrides));
  return { status: response.status, body: await response.json() as Describe };
}
async function approvedCode(clientId: string) {
  mocks.session.mockResolvedValueOnce(sessionPrincipal());
  const body = await (await consent("approve", authRequest(clientId), "supabase-session")).json() as Describe;
  expect(body.code).toBe("AUTHORIZATION_GRANTED");
  return new URL(body.redirectTo!).searchParams.get("code")!;
}

const exchangeRaw = (body: string, contentType = "application/x-www-form-urlencoded") => token(new Request(`${ORIGIN}/api/mcp/oauth/token`, {
  method: "POST", headers: { "content-type": contentType }, body,
}));
const exchange = (fields: Record<string, string>) => exchangeRaw(new URLSearchParams(fields).toString());
type Grant = { error?: string; error_description?: string; code?: string };
const grant = (clientId: string, code: string, extra: Record<string, string> = {}) =>
  ({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "remote-mcp-unit-test-sealing-secret-value");
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", `${MINE},pilot-beta`);
  mocks.authenticateKey.mockResolvedValue(keyPrincipal(READ_SCOPES));
  mocks.authorize.mockResolvedValue({ ok: true, principal: { kind: "api-key", keyId: "key-1", workspaceKey: MINE, userId: USER, scopes: READ_SCOPES, authorizationRevision: 4, workspaceRole: "owner" } });
  mocks.listKeys.mockResolvedValue({ ok: true, keys: [] });
  mocks.createKey.mockResolvedValue({ ok: true, key: { keyId: "key-9" }, token: "tvnl_mcp_minted" });
  mocks.sessionProduct.mockResolvedValue({ ok: true, access: { source: "paid", accessPlan: "studio_access", billingExempt: false, expiresAt: null } });
  mocks.revokeKey.mockResolvedValue({ ok: true });
  mocks.activeWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
  mocks.listWorlds.mockResolvedValue({ ok: true, worlds: [], nextCursor: null });
  mocks.readModel.mockResolvedValue({ ok: false, code: "WORLD_NOT_FOUND", status: 404 });
  mocks.loadCandidate.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
  mocks.signerEnv.mockReturnValue({ accountId: "acct", accessKeyId: "id", secretAccessKey: "secret", bucket: "b" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ the table */

const cases: Array<[string, () => Promise<void>]> = [];
const names = new Set<string>();
function add(name: string, run: () => Promise<void>) {
  if (names.has(name)) throw new Error(`duplicate matrix case: ${name}`);
  names.add(name);
  cases.push([name, run]);
}
const noWorkspaceTouched = () => {
  for (const mock of [mocks.createKey, mocks.revokeKey, mocks.listKeys, mocks.authorize]) expect(mock).not.toHaveBeenCalled();
};

/* 1. discovery and origin binding (6) */
const wellKnown = (headers: Record<string, string> = {}) => protectedResource(
  new Request(`http://localhost:3000/.well-known/oauth-protected-resource/api/mcp`, { headers }),
  { params: Promise.resolve({ resource: ["api", "mcp"] }) },
);
add("discovery: protected-resource metadata names this origin's /api/mcp and the read scopes", async () => {
  const body = await (await wellKnown({ host: "tavonel.test", "x-forwarded-proto": "https" })).json();
  expect(body).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN], scopes_supported: READ_SCOPES, bearer_methods_supported: ["header"] });
});
add("discovery: protected-resource metadata for any other resource path is 404", async () => {
  const response = await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/other`), { params: Promise.resolve({ resource: ["other"] }) });
  expect(response.status).toBe(404);
});
add("discovery: protected-resource metadata follows the forwarded host, not the internal one", async () => {
  const body = await (await wellKnown({ host: "internal:3000", "x-forwarded-host": "preview.tavonel.test", "x-forwarded-proto": "https" })).json();
  expect(body.resource).toBe("https://preview.tavonel.test/api/mcp");
});
add("discovery: a malformed host header falls back to the request URL, never into the metadata", async () => {
  const body = await (await wellKnown({ host: "evil.test/path?x" })).json();
  expect(body.resource).toBe("http://localhost:3000/api/mcp");
});
add("discovery: authorization-server metadata offers S256 only, public clients only, code grant only (no refresh)", async () => {
  const body = await (await authorizationServer(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
  expect(body).toMatchObject({
    issuer: ORIGIN, code_challenge_methods_supported: ["S256"], grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"], response_types_supported: ["code"],
  });
  expect(JSON.stringify(body)).not.toMatch(/refresh_token|client_secret|"plain"/);
});
add("discovery: the 401 challenge points at the origin the client addressed", async () => {
  const response = await call("get_world", { collectionId: THEIR_COLLECTION }, undefined, { host: "preview.tavonel.test", "x-forwarded-proto": "https" });
  expect([response.status, response.headers.get("www-authenticate")])
    .toEqual([401, 'Bearer resource_metadata="https://preview.tavonel.test/.well-known/oauth-protected-resource/api/mcp"']);
});

/* 2. registration (22) */
const longUri = (length: number) => `https://client.example/${"a".repeat(length - "https://client.example/".length)}`;
const registrationRefused = (name: string, body: unknown, error: string) => add(`register: ${name} is 400 ${error}`, async () => {
  const response = await registerJson(body);
  expect([response.status, (await response.json()).error]).toEqual([400, error]);
});
add("register: an https redirect URI is 201 and answers with the values the server will use", async () => {
  const response = await registerJson({ client_name: "Agent", redirect_uris: [REDIRECT] });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ redirect_uris: [REDIRECT], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" });
});
add("register: a loopback http redirect URI (127.0.0.1) is 201", async () => {
  expect((await registerJson({ redirect_uris: ["http://127.0.0.1:33418/callback"] })).status).toBe(201);
});
add("register: a loopback http redirect URI (localhost) is 201", async () => {
  expect((await registerJson({ redirect_uris: ["http://localhost:8080/cb"] })).status).toBe(201);
});
registrationRefused("a non-loopback http redirect URI", { redirect_uris: ["http://client.example/cb"] }, "invalid_redirect_uri");
registrationRefused("a redirect URI with a fragment", { redirect_uris: ["https://client.example/cb#frag"] }, "invalid_redirect_uri");
registrationRefused("a redirect URI with userinfo", { redirect_uris: ["https://user:pass@client.example/cb"] }, "invalid_redirect_uri");
registrationRefused("zero redirect URIs", { redirect_uris: [] }, "invalid_redirect_uri");
registrationRefused("six redirect URIs", { redirect_uris: Array.from({ length: 6 }, (_, index) => `https://client.example/cb${index}`) }, "invalid_redirect_uri");
registrationRefused("a 513-character redirect URI", { redirect_uris: [longUri(513)] }, "invalid_redirect_uri");
registrationRefused("redirect_uris that is not an array", { redirect_uris: REDIRECT }, "invalid_redirect_uri");
registrationRefused("a javascript: redirect URI", { redirect_uris: ["javascript:alert(1)"] }, "invalid_redirect_uri");
registrationRefused("a confidential auth method", { redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" }, "invalid_client_metadata");
registrationRefused("a non-code response type", { redirect_uris: [REDIRECT], response_types: ["token"] }, "invalid_client_metadata");
registrationRefused("a JSON array body", [REDIRECT], "invalid_client_metadata");
add("register: a 512-character redirect URI is the longest accepted", async () => {
  expect((await registerJson({ redirect_uris: [longUri(512)] })).status).toBe(201);
});
add("register: control characters in the client name are stripped before it is sealed", async () => {
  const response = await registerJson({ client_name: "Ex\u0000ample\u0007\n agent", redirect_uris: [REDIRECT] });
  const body = await response.json() as { client_name: string };
  expect([response.status, body.client_name]).toEqual([201, "Example agent"]);
});
add("register: a client name over 48 characters is cut to 48", async () => {
  const body = await (await registerJson({ client_name: "n".repeat(80), redirect_uris: [REDIRECT] })).json() as { client_name: string };
  expect(body.client_name).toBe("n".repeat(48));
});
add("register: a missing client name is a fixed label, not an empty string", async () => {
  expect((await (await registerJson({ redirect_uris: [REDIRECT] })).json()).client_name).toBe("Unnamed MCP client");
});
add("register: duplicate redirect URIs collapse to one", async () => {
  expect((await (await registerJson({ redirect_uris: [REDIRECT, REDIRECT] })).json()).redirect_uris).toEqual([REDIRECT]);
});
add("register: a body that is not JSON is 400 invalid_client_metadata", async () => {
  const response = await registerRaw("{not json");
  expect([response.status, (await response.json()).error]).toEqual([400, "invalid_client_metadata"]);
});
add("register: a body over 8 KiB is 400 and registers nothing", async () => {
  const response = await registerRaw(JSON.stringify({ redirect_uris: [REDIRECT], client_name: "x".repeat(9_000) }));
  expect([response.status, (await response.json()).error]).toEqual([400, "invalid_client_metadata"]);
});
add("register: no sealing secret is 503 REMOTE_MCP_NOT_CONFIGURED", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "short");
  const response = await registerJson({ redirect_uris: [REDIRECT] });
  expect([response.status, (await response.json()).error_description]).toEqual([503, "REMOTE_MCP_NOT_CONFIGURED"]);
});
add("register: the switch off is 404", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "");
  expect((await registerJson({ redirect_uris: [REDIRECT] })).status).toBe(404);
});

/* 3. authorize / consent (24) */
const rejectedWith = (name: string, overrides: Record<string, string | undefined>, error: string) =>
  add(`authorize: ${name} is sent back to the client as ${error}, with state and issuer, and no code`, async () => {
    const { body } = await describeRequest(await registeredClient(), overrides);
    expect(body.code).toBe("AUTHORIZATION_REQUEST_REJECTED");
    const back = new URL(body.redirectTo!);
    expect([back.searchParams.get("error"), back.searchParams.get("iss"), back.searchParams.has("code")]).toEqual([error, ORIGIN, false]);
    if (overrides.state === undefined || overrides.state === "client-state-1") expect(back.searchParams.get("state")).toBe("client-state-1");
  });
rejectedWith("a missing code_challenge", { code_challenge: undefined }, "invalid_request");
rejectedWith("a plain code_challenge_method", { code_challenge_method: "plain" }, "invalid_request");
rejectedWith("a missing code_challenge_method", { code_challenge_method: undefined }, "invalid_request");
rejectedWith("a 42-character code_challenge", { code_challenge: CHALLENGE.slice(0, 42) }, "invalid_request");
rejectedWith("a 44-character code_challenge", { code_challenge: `${CHALLENGE}A` }, "invalid_request");
rejectedWith("a resource that is another server", { resource: "https://elsewhere.test/api/mcp" }, "invalid_target");
rejectedWith("this origin's other path as the resource", { resource: `${ORIGIN}/api/v1` }, "invalid_target");
rejectedWith("an unknown scope", { scope: "worlds:read teapot:brew" }, "invalid_scope");
rejectedWith("a write scope", { scope: "worlds:read connections:write" }, "invalid_scope");
rejectedWith("response_type=token", { response_type: "token" }, "unsupported_response_type");
rejectedWith("a missing response_type", { response_type: undefined }, "unsupported_response_type");
add("authorize: a 513-character state is refused on the page and never redirects", async () => {
  const { status, body } = await describeRequest(await registeredClient(), { state: "s".repeat(513) });
  expect([status, body.code]).toEqual([400, "AUTHORIZATION_REQUEST_INVALID"]);
  expect(body).not.toHaveProperty("redirectTo");
});
add("authorize: a redirect URI the client did not register never redirects", async () => {
  const { status, body } = await describeRequest(await registeredClient(), { redirect_uri: "https://attacker.test/cb" });
  expect([status, body.code]).toEqual([400, "AUTHORIZATION_REQUEST_INVALID"]);
  expect(body).not.toHaveProperty("redirectTo");
});
add("authorize: a missing redirect URI never redirects", async () => {
  const { status, body } = await describeRequest(await registeredClient(), { redirect_uri: undefined });
  expect([status, body]).toMatchObject([400, { code: "AUTHORIZATION_REQUEST_INVALID" }]);
  expect(body).not.toHaveProperty("redirectTo");
});
add("authorize: a tampered client id is invalid_client on the page and never redirects", async () => {
  const clientId = await registeredClient();
  const { status, body } = await describeRequest(`${clientId.slice(0, -4)}AAAA`, {});
  expect([status, body.error]).toEqual([400, "invalid_client"]);
  expect(body).not.toHaveProperty("redirectTo");
});
add("authorize: a client id that is really an authorization code is not a client", async () => {
  const code = await approvedCode(await registeredClient());
  const { status, body } = await describeRequest(code, {});
  expect([status, body.error]).toEqual([400, "invalid_client"]);
});
add("authorize: deny redirects access_denied to the registered URI and reads no session", async () => {
  const body = await (await consent("deny", authRequest(await registeredClient()))).json() as Describe;
  const back = new URL(body.redirectTo!);
  expect([body.code, `${back.origin}${back.pathname}`, back.searchParams.get("error"), back.searchParams.has("code")]).toEqual(["AUTHORIZATION_DENIED", REDIRECT, "access_denied", false]);
  expect(mocks.session).not.toHaveBeenCalled();
});
add("authorize: a workspace outside the cohort gets 403 REMOTE_MCP_COHORT_EXCLUDED and no code", async () => {
  const clientId = await registeredClient();
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
  mocks.session.mockResolvedValueOnce(sessionPrincipal());
  const response = await consent("approve", authRequest(clientId), "supabase-session");
  const body = await response.json() as Describe;
  expect([response.status, body.code, "redirectTo" in body]).toEqual([403, "REMOTE_MCP_COHORT_EXCLUDED", false]);
});
add("authorize: an unreadable cohort is 503 REMOTE_MCP_COHORT_CONFIG_INVALID and no code", async () => {
  const clientId = await registeredClient();
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-*");
  mocks.session.mockResolvedValueOnce(sessionPrincipal());
  const response = await consent("approve", authRequest(clientId), "supabase-session");
  const body = await response.json() as Describe;
  expect([response.status, body.code, "redirectTo" in body]).toEqual([503, "REMOTE_MCP_COHORT_CONFIG_INVALID", false]);
});
add("authorize: a free evaluation with trial AI access off is 402 TRIAL_FEATURE_NOT_INCLUDED", async () => {
  const clientId = await registeredClient();
  mocks.session.mockResolvedValueOnce({ ok: true, principal: { workspaceKey: MINE, userId: USER, accessSource: "trial", authorizationRevision: 4 } });
  const response = await consent("approve", authRequest(clientId), "supabase-session");
  const body = await response.json() as Describe;
  expect([response.status, body.code, "redirectTo" in body]).toEqual([402, "TRIAL_FEATURE_NOT_INCLUDED", false]);
});
add("authorize: approve with no session is 401 and no code", async () => {
  const clientId = await registeredClient();
  mocks.session.mockResolvedValueOnce({ ok: false, code: "AUTH_REQUIRED", status: 401 });
  const response = await consent("approve", authRequest(clientId));
  const body = await response.json() as Describe;
  expect([response.status, body.code, "redirectTo" in body]).toEqual([401, "AUTH_REQUIRED", false]);
});
add("authorize: approve with a session the plan refuses is that refusal, with no code", async () => {
  const clientId = await registeredClient();
  mocks.session.mockResolvedValueOnce({ ok: false, code: "BILLING_PLAN_REQUIRED", status: 402 });
  const response = await consent("approve", authRequest(clientId), "supabase-session");
  const body = await response.json() as Describe;
  expect([response.status, body.code, "redirectTo" in body]).toEqual([402, "BILLING_PLAN_REQUIRED", false]);
});
add("authorize: an unknown decision is 400 AUTHORIZATION_DECISION_INVALID and reads no session", async () => {
  const response = await consent("grant", authRequest(await registeredClient()));
  expect([response.status, (await response.json()).code]).toEqual([400, "AUTHORIZATION_DECISION_INVALID"]);
  expect(mocks.session).not.toHaveBeenCalled();
});
add("authorize: a body that is not JSON is 400 INVALID_JSON", async () => {
  const response = await consentRaw("{nope");
  expect([response.status, (await response.json()).code]).toEqual([400, "INVALID_JSON"]);
});
add("authorize: a body over 16 KiB is 413 REQUEST_TOO_LARGE", async () => {
  const response = await consentRaw(JSON.stringify({ decision: "describe", request: { state: "s".repeat(17_000) } }));
  expect([response.status, (await response.json()).code]).toEqual([413, "REQUEST_TOO_LARGE"]);
});
add("authorize: no sealing secret is 503 REMOTE_MCP_NOT_CONFIGURED", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "");
  const response = await consent("describe", {});
  expect([response.status, (await response.json()).code]).toEqual([503, "REMOTE_MCP_NOT_CONFIGURED"]);
});
add("authorize: the switch off is 404 and reads no session", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "");
  expect((await consent("approve", {}, "supabase-session")).status).toBe(404);
  expect(mocks.session).not.toHaveBeenCalled();
});

/* 4. token (23) */
const refusedGrant = (name: string, mutate: (clientId: string, code: string) => Record<string, string>, error: string) =>
  add(`token: ${name} is invalid_grant-class ${error} and mints nothing`, async () => {
    const clientId = await registeredClient();
    const code = await approvedCode(clientId);
    const response = await exchange(mutate(clientId, code));
    expect((await response.json() as Grant).error).toBe(error);
    expect(mocks.createKey).not.toHaveBeenCalled();
  });
refusedGrant("a grant type other than authorization_code", (c, code) => grant(c, code, { grant_type: "refresh_token" }), "unsupported_grant_type");
refusedGrant("a missing grant type", (c, code) => { const { grant_type: _drop, ...rest } = grant(c, code); return rest; }, "unsupported_grant_type");
refusedGrant("a wrong verifier", (c, code) => grant(c, code, { code_verifier: `${VERIFIER}x` }), "invalid_grant");
refusedGrant("a missing verifier", (c, code) => { const { code_verifier: _drop, ...rest } = grant(c, code); return rest; }, "invalid_grant");
refusedGrant("a 42-character verifier", (c, code) => grant(c, code, { code_verifier: VERIFIER.slice(0, 42) }), "invalid_grant");
refusedGrant("a verifier with a character outside the PKCE set", (c, code) => grant(c, code, { code_verifier: `${VERIFIER}!` }), "invalid_grant");
refusedGrant("a tampered code", (c, code) => grant(c, `${code.slice(0, -2)}AA`), "invalid_grant");
refusedGrant("a code with no prefix", (c, code) => grant(c, code.replace("tvmcp_code_", "")), "invalid_grant");
refusedGrant("a missing code", (c) => grant(c, ""), "invalid_grant");
refusedGrant("a client id passed as the code", (c) => grant(c, c), "invalid_grant");
refusedGrant("a redirect URI that differs from the authorization request", (c, code) => grant(c, code, { redirect_uri: "https://client.example/other" }), "invalid_grant");
refusedGrant("a resource that is not this server's MCP endpoint", (c, code) => grant(c, code, { resource: "https://elsewhere.test/api/mcp" }), "invalid_target");
add("token: a code redeemed by another registered client is invalid_grant and mints nothing", async () => {
  const clientId = await registeredClient();
  const other = await registeredClient("Other agent");
  const code = await approvedCode(clientId);
  expect((await (await exchange(grant(other, code))).json() as Grant).error).toBe("invalid_grant");
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: an unregistered client id is 401 invalid_client", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  const response = await exchange(grant(`${clientId.slice(0, -4)}AAAA`, code));
  expect([response.status, (await response.json() as Grant).error]).toEqual([401, "invalid_client"]);
});
add("token: an expired code (121 s later) is invalid_grant 'expired' and mints nothing", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  vi.useFakeTimers({ now: Date.now() + 121_000 });
  expect(await (await exchange(grant(clientId, code))).json()).toMatchObject({ error: "invalid_grant", error_description: "The authorization code has expired." });
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: a code redeemed twice is refused the second time and revokes the key the first minted", async () => {
  const clientId = await registeredClient();
  const fields = grant(clientId, await approvedCode(clientId));
  expect((await exchange(fields)).status).toBe(200);
  const name = mocks.createKey.mock.calls[0]![0].name as string;
  mocks.listKeys.mockResolvedValueOnce({ ok: true, keys: [{ keyId: "key-9", name, revokedAt: null }] });
  const second = await exchange(fields);
  expect([second.status, (await second.json() as Grant).error]).toEqual([400, "invalid_grant"]);
  expect(mocks.revokeKey).toHaveBeenCalledWith(MINE, USER, 4, "key-9");
  expect(mocks.createKey).toHaveBeenCalledTimes(1);
});
add("token: a JSON body is 400 invalid_request", async () => {
  const clientId = await registeredClient();
  const response = await exchangeRaw(JSON.stringify(grant(clientId, await approvedCode(clientId))), "application/json");
  expect([response.status, (await response.json() as Grant).error]).toEqual([400, "invalid_request"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: a form body over 16 KiB is 400 invalid_request", async () => {
  const response = await exchangeRaw(`grant_type=authorization_code&code=${"a".repeat(17_000)}`);
  expect([response.status, (await response.json() as Grant).error]).toEqual([400, "invalid_request"]);
});
add("token: a member whose authorization changed after consent is invalid_grant", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  mocks.createKey.mockResolvedValueOnce({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY" });
  const response = await exchange(grant(clientId, code));
  expect([response.status, (await response.json() as Grant).error]).toEqual([400, "invalid_grant"]);
});
add("token: a workspace removed from the cohort between consent and exchange is 403 and mints nothing", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
  const response = await exchange(grant(clientId, code));
  expect([response.status, (await response.json() as Grant).code]).toEqual([403, "REMOTE_MCP_COHORT_EXCLUDED"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: a malformed cohort is 503 and mints nothing", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "");
  const response = await exchange(grant(clientId, code));
  expect([response.status, (await response.json() as Grant).code]).toEqual([503, "REMOTE_MCP_COHORT_CONFIG_INVALID"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: a plan that lapsed inside the code's 120 s is refused at issue time", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  mocks.sessionProduct.mockResolvedValueOnce({ ok: false, code: "BILLING_PLAN_REQUIRED", status: 402 });
  const response = await exchange(grant(clientId, code));
  expect([response.status, (await response.json() as Grant).code]).toEqual([402, "BILLING_PLAN_REQUIRED"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: a billing store that cannot answer is 503 temporarily_unavailable and mints nothing", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  mocks.sessionProduct.mockResolvedValueOnce({ ok: false, code: "BILLING_STORE_UNAVAILABLE", status: 503 });
  const response = await exchange(grant(clientId, code));
  expect([response.status, (await response.json() as Grant).error]).toEqual([503, "temporarily_unavailable"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: a free evaluation with trial AI access off is 402 TRIAL_FEATURE_NOT_INCLUDED", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  mocks.sessionProduct.mockResolvedValueOnce({ ok: true, access: { source: "trial", accessPlan: "observer_access", billingExempt: false, expiresAt: null } });
  const response = await exchange(grant(clientId, code));
  expect([response.status, (await response.json() as Grant).code]).toEqual([402, "TRIAL_FEATURE_NOT_INCLUDED"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: a trial that already holds its one live key is 402 TRIAL_LIMIT_REACHED and mints nothing", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  vi.stubEnv("TAVONEL_TRIAL_AI_ACCESS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://store.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (new URL(url).pathname === "/rest/v1/foundation_api_keys"
    ? new Response(JSON.stringify([{ key_id: "manual-1" }]), { status: 200 })
    : new Response(JSON.stringify({ status: "allowed", reason: null }), { status: 200 }))));
  mocks.sessionProduct.mockResolvedValueOnce({ ok: true, access: { source: "trial", accessPlan: "observer_access", billingExempt: false, expiresAt: null } });
  const response = await exchange(grant(clientId, code));
  expect([response.status, (await response.json() as Grant).code]).toEqual([402, "TRIAL_LIMIT_REACHED"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: a key store that cannot list recent keys is 503 and mints nothing", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  mocks.listKeys.mockResolvedValueOnce({ ok: false, code: "API_KEY_LIST_FAILED" });
  const response = await exchange(grant(clientId, code));
  expect([response.status, (await response.json() as Grant).error]).toEqual([503, "temporarily_unavailable"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
});
add("token: a key store that cannot mint is 503 temporarily_unavailable", async () => {
  const clientId = await registeredClient();
  const code = await approvedCode(clientId);
  mocks.createKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_CREATE_FAILED" });
  const response = await exchange(grant(clientId, code));
  expect([response.status, (await response.json() as Grant).error]).toEqual([503, "temporarily_unavailable"]);
});
add("token: no sealing secret is 503 REMOTE_MCP_NOT_CONFIGURED", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "short");
  const response = await exchange({ grant_type: "authorization_code" });
  expect([response.status, (await response.json() as Grant).error_description]).toEqual([503, "REMOTE_MCP_NOT_CONFIGURED"]);
});
add("token: the switch off is 404", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "");
  expect((await exchange({ grant_type: "authorization_code" })).status).toBe(404);
});
add("token: a valid exchange is the positive control: 200, no-store, read-only scopes, one-hour expiry", async () => {
  const clientId = await registeredClient();
  const response = await exchange(grant(clientId, await approvedCode(clientId)));
  expect([response.status, response.headers.get("cache-control")]).toEqual([200, "no-store"]);
  expect(await response.json()).toEqual({ access_token: "tvnl_mcp_minted", token_type: "Bearer", expires_in: 3600, scope: READ_SCOPES.join(" ") });
  expect(mocks.createKey.mock.calls[0]![0]).toMatchObject({ audience: "mcp", scopes: READ_SCOPES });
});

/* 5. bearer at /api/mcp (17) */
const WORLD = { collectionId: THEIR_COLLECTION };
add("bearer: initialize with no token is allowed", async () => {
  const response = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  expect(response.status).toBe(200);
  expect(mocks.authenticateKey).not.toHaveBeenCalled();
});
add("bearer: tools/list with no token is allowed", async () => {
  expect((await rpc(LIST)).status).toBe(200);
  expect(mocks.authenticateKey).not.toHaveBeenCalled();
});
add("bearer: ping with no token is allowed", async () => {
  expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
});
add("bearer: tools/call with no token is 401 AUTH_REQUIRED and runs no route", async () => {
  const response = await call("list_worlds", {});
  expect([response.status, (await response.json()).error.message]).toEqual([401, "AUTH_REQUIRED"]);
  expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  expect(mocks.authorize).not.toHaveBeenCalled();
});
const rejectedBearer = (name: string, authorization: string) => add(`bearer: ${name} is 401 invalid_token before any route runs`, async () => {
  const response = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "list_worlds", arguments: {} } }, { authorization });
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  expect(mocks.authenticateKey).not.toHaveBeenCalled();
  expect(mocks.authorize).not.toHaveBeenCalled();
});
rejectedBearer("the Basic scheme", "Basic dHZubF9saXZlX3g6");
rejectedBearer("a lowercase bearer scheme", "bearer tvnl_live_mine");
rejectedBearer("an empty bearer", "Bearer ");
rejectedBearer("a foreign token format", "Bearer some-other-jwt");
rejectedBearer("a tvnl_ token of an unknown kind", "Bearer tvnl_test_mine");
add("bearer: an expired token is 401 invalid_token 'expired'", async () => {
  mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_EXPIRED" });
  const response = await call("list_worlds", {}, "tvnl_mcp_expired");
  expect([response.status, response.headers.get("www-authenticate")]).toEqual([401, expect.stringContaining("The access token has expired.")]);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
add("bearer: a revoked token is 401 invalid_token 'not valid'", async () => {
  mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_INVALID" });
  const response = await call("list_worlds", {}, "tvnl_mcp_revoked");
  expect([response.status, response.headers.get("www-authenticate")]).toEqual([401, expect.stringContaining("The access token is not valid.")]);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
add("bearer: a key store that cannot answer fails closed as 401", async () => {
  mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "DEVELOPER_STORE_READ_FAILED" });
  expect((await call("list_worlds", {}, "tvnl_mcp_mine")).status).toBe(401);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
add("bearer: a key holding a write scope is 401 even for tools/list", async () => {
  mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal([...READ_SCOPES, "connections:write"]));
  const response = await rpc(LIST, { authorization: "Bearer tvnl_live_writer" });
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("holds a scope outside the read-only MCP scopes");
});
add("bearer: a bad token is refused on initialize too, not only on tools/call", async () => {
  mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_INVALID" });
  expect((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, { authorization: "Bearer tvnl_live_unknown" })).status).toBe(401);
});
add("bearer: the switch off is 404 before the token is read", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "");
  expect((await call("list_worlds", {}, "tvnl_mcp_mine")).status).toBe(404);
  expect(mocks.authenticateKey).not.toHaveBeenCalled();
});
add("bearer: a live token whose workspace left the cohort is 403 REMOTE_MCP_COHORT_EXCLUDED", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
  const response = await call("list_worlds", {}, "tvnl_mcp_mine");
  expect([response.status, (await response.json()).error.message]).toEqual([403, "REMOTE_MCP_COHORT_EXCLUDED"]);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
add("bearer: a live token under an unreadable cohort is 503 and runs no route", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-alpha,");
  const response = await call("list_worlds", {}, "tvnl_mcp_mine");
  expect([response.status, (await response.json()).error.message]).toEqual([503, "REMOTE_MCP_COHORT_CONFIG_INVALID"]);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
add("bearer: a valid tvnl_mcp_ token reaches the route carrying the same bearer (positive control)", async () => {
  const response = await call("list_worlds", {}, "tvnl_mcp_mine");
  expect([response.status, ((await response.json()) as ToolResult).result.isError]).toEqual([200, false]);
  expect(mocks.authorize.mock.calls[0]![0].headers.get("authorization")).toBe("Bearer tvnl_mcp_mine");
});

/* 6. origin and transport (15) */
add("transport: a foreign Origin is 403 MCP_ORIGIN_REFUSED", async () => {
  const response = await rpc(LIST, { origin: "https://attacker.test" });
  expect([response.status, (await response.json()).error.message]).toEqual([403, "MCP_ORIGIN_REFUSED"]);
});
add("transport: the same Origin is accepted", async () => {
  expect((await rpc(LIST, { origin: ORIGIN })).status).toBe(200);
});
add("transport: no Origin (a server-side client) is accepted", async () => {
  expect((await rpc(LIST)).status).toBe(200);
});
add("transport: the literal Origin 'null' is 403", async () => {
  expect((await rpc(LIST, { origin: "null" })).status).toBe(403);
});
add("transport: the same host over http is a different Origin and is 403", async () => {
  expect((await rpc(LIST, { origin: "http://tavonel.test" })).status).toBe(403);
});
add("transport: an Origin with a trailing slash is not the origin and is 403", async () => {
  expect((await rpc(LIST, { origin: `${ORIGIN}/` })).status).toBe(403);
});
add("transport: an Origin on a sibling subdomain is 403", async () => {
  expect((await rpc(LIST, { origin: "https://evil.tavonel.test" })).status).toBe(403);
});
add("transport: a foreign Origin is refused before a valid token is even read", async () => {
  expect((await call("list_worlds", {}, "tvnl_mcp_mine", { origin: "https://attacker.test" })).status).toBe(403);
  expect(mocks.authenticateKey).not.toHaveBeenCalled();
});
add("transport: protocol version 2025-06-18 is accepted", async () => {
  expect((await rpc(LIST, { "mcp-protocol-version": "2025-06-18" })).status).toBe(200);
});
add("transport: protocol version 2025-03-26 is accepted", async () => {
  expect((await rpc(LIST, { "mcp-protocol-version": "2025-03-26" })).status).toBe(200);
});
add("transport: protocol version 1999-01-01 is 400 MCP_PROTOCOL_VERSION_UNSUPPORTED", async () => {
  const response = await rpc(LIST, { "mcp-protocol-version": "1999-01-01" });
  expect([response.status, (await response.json()).error.message]).toEqual([400, "MCP_PROTOCOL_VERSION_UNSUPPORTED"]);
});
add("transport: a JSON-RPC batch is 400 Invalid Request", async () => {
  const response = await rpc([LIST]);
  expect([response.status, (await response.json()).error.message]).toEqual([400, "Invalid Request"]);
});
add("transport: a body that is not JSON is 400 Parse error", async () => {
  const response = await rpc("{not json");
  expect([response.status, (await response.json()).error.message]).toEqual([400, "Parse error"]);
});
add("transport: a message that is not JSON-RPC 2.0 is 400", async () => {
  expect((await rpc({ jsonrpc: "1.0", id: 1, method: "tools/list" })).status).toBe(400);
});
add("transport: a JSON scalar body is 400", async () => {
  expect((await rpc("42")).status).toBe(400);
});
add("transport: a body over 64 KiB is 413 REQUEST_TOO_LARGE and reads no token", async () => {
  const response = await rpc({ ...LIST, params: { pad: "x".repeat(65_600) } }, { authorization: "Bearer tvnl_mcp_mine" });
  expect([response.status, (await response.json()).error.message]).toEqual([413, "REQUEST_TOO_LARGE"]);
  expect(mocks.authenticateKey).not.toHaveBeenCalled();
});
add("transport: a notification is 202 with no body", async () => {
  const response = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  expect([response.status, await response.text()]).toEqual([202, ""]);
});
add("transport: a request with a null id is treated as a notification: 202", async () => {
  expect((await rpc({ jsonrpc: "2.0", id: null, method: "tools/list" })).status).toBe(202);
});
add("transport: GET is 405 with Allow: POST", async () => {
  const response = mcpGet();
  expect([response.status, response.headers.get("allow")]).toEqual([405, "POST"]);
});
add("transport: GET with the switch off is 404, not 405", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "");
  expect(mcpGet().status).toBe(404);
});
add("transport: an unknown JSON-RPC method is -32601 Method not found", async () => {
  const response = await rpc({ jsonrpc: "2.0", id: 1, method: "resources/list" });
  expect((await response.json()).error.code).toBe(-32601);
});

/* 7. scope: each tool without its scope (9) */
const SCOPE_CASES: Array<[string, Record<string, unknown>]> = [
  ["list_sources", {}],
  ["list_worlds", {}],
  ["get_world", WORLD],
  ["search_world", { ...WORLD, query: "refund policy" }],
  ["ask_world", { ...WORLD, question: "What changed?" }],
  ["get_object", WORLD],
  ["get_relation", WORLD],
  ["get_evidence", WORLD],
  ["download_package", WORLD],
];
for (const [tool, args] of SCOPE_CASES) {
  add(`scope: ${tool} without ${REMOTE_MCP_TOOL_SCOPES[tool]} is 403 insufficient_scope naming it, before any route`, async () => {
    const needed = REMOTE_MCP_TOOL_SCOPES[tool]!;
    mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal(READ_SCOPES.filter((scope) => scope !== needed)));
    const response = await call(tool, args, "tvnl_mcp_narrow");
    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain(`scope="${needed}"`);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
}

/* 8. cross-tenant: each tool reaches only the caller's workspace (9) */
const CROSS: Array<[string, Record<string, unknown>, keyof typeof mocks]> = [
  ["get_world", WORLD, "readModel"],
  ["search_world", { ...WORLD, query: "refund policy" }, "activeWorld"],
  ["ask_world", { ...WORLD, question: "What changed?" }, "activeWorld"],
  ["get_object", { ...WORLD, objectId: `object-${"c".repeat(32)}` }, "readModel"],
  ["get_relation", { ...WORLD, relationId: `relation-${"c".repeat(32)}` }, "readModel"],
  ["get_evidence", { ...WORLD, evidenceId: `evidence-${"c".repeat(32)}` }, "readModel"],
  ["download_package", WORLD, "loadCandidate"],
];
for (const [tool, args, store] of CROSS) {
  add(`cross-tenant: ${tool} on another workspace's collection is a not-found tool result from the caller's own workspace`, async () => {
    const response = await call(tool, args, "tvnl_mcp_mine");
    expect(response.status).toBe(200);
    const body = (await response.json()) as ToolResult;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toMatch(/^API_ERROR_(404|409)/);
    expect(mocks[store].mock.calls.length).toBeGreaterThan(0);
    for (const seen of mocks[store].mock.calls) expect(seen).toContain(MINE);
  });
}
add("cross-tenant: list_worlds lists the caller's workspace only and offers no way to name another", async () => {
  expect((await call("list_worlds", { limit: 5 }, "tvnl_mcp_mine")).status).toBe(200);
  expect(mocks.listWorlds).toHaveBeenCalledWith(MINE, { limit: 5, cursor: null });
  const named = await call("list_worlds", { workspace: "pilot-beta" }, "tvnl_mcp_mine");
  expect(await resultText(named)).toMatch(/^INPUT_INVALID: .*no argument "workspace"/);
});
add("cross-tenant: list_sources offers no way to name another workspace or collection", async () => {
  const named = await call("list_sources", { collectionId: THEIR_COLLECTION }, "tvnl_mcp_mine");
  expect(await resultText(named)).toMatch(/^INPUT_INVALID: .*no argument "collectionId"/);
  expect(mocks.authorize).not.toHaveBeenCalled();
});

/* 9. errors (9) */
add("error: a handler that throws is a constant REMOTE_MCP_INTERNAL_ERROR, never the exception's text", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.authorize.mockRejectedValueOnce(new Error("connection to db-internal.example refused for pilot-alpha"));
    const response = await call("list_worlds", {}, "tvnl_mcp_mine");
    const text = await resultText(response);
    expect([response.status, text]).toEqual([200, "API_ERROR_500: REMOTE_MCP_INTERNAL_ERROR"]);
    expect(text + JSON.stringify(log.mock.calls)).not.toContain("db-internal");
  } finally { log.mockRestore(); }
});
add("error: a route 5xx behind a 200 result is a 5xx in the SLI line and in the alert trigger", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    mocks.authorize.mockResolvedValueOnce({ ok: false, code: "DEVELOPER_STORE_READ_FAILED", status: 503 });
    expect((await call("list_worlds", {}, "tvnl_mcp_mine")).status).toBe(200);
    const sli = info.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>).filter((line) => "sli" in line);
    expect(sli.map((line) => [line.status, line.upstreamStatus])).toEqual([[200, 503]]);
    expect(mocks.toolCall).toHaveBeenLastCalledWith(true);
  } finally { info.mockRestore(); }
});
add("error: a 429 from the route is the tool result and the route is not run past it", async () => {
  mocks.authorize.mockResolvedValueOnce({ ok: false, code: "API_RATE_LIMITED", status: 429 });
  const response = await call("list_worlds", {}, "tvnl_mcp_mine");
  expect(await resultText(response)).toMatch(/^API_ERROR_429: API_RATE_LIMITED/);
  expect(mocks.listWorlds).not.toHaveBeenCalled();
});
add("error: an unknown tool is TOOL_NOT_FOUND, and a client-chosen name never reaches the SLI or funnel line", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const response = await call("drop_all_worlds", {}, "tvnl_mcp_mine");
    expect(await resultText(response)).toMatch(/^TOOL_NOT_FOUND/);
    expect(JSON.stringify(info.mock.calls)).not.toContain("drop_all_worlds");
    expect(mocks.authorize).not.toHaveBeenCalled();
  } finally { info.mockRestore(); }
});
add("error: an argument the tool does not declare is INPUT_INVALID and runs no route", async () => {
  const response = await call("get_world", { ...WORLD, as_of: "2026-01-01" }, "tvnl_mcp_mine");
  expect(await resultText(response)).toMatch(/^INPUT_INVALID: .*no argument "as_of"/);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
add("error: a collection id of the wrong shape is INPUT_INVALID and runs no route", async () => {
  const response = await call("get_world", { collectionId: "collection-../../etc" }, "tvnl_mcp_mine");
  expect(await resultText(response)).toMatch(/^INPUT_INVALID/);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
add("error: a missing required argument is INPUT_INVALID and runs no route", async () => {
  const response = await call("ask_world", WORLD, "tvnl_mcp_mine");
  expect(await resultText(response)).toMatch(/^INPUT_INVALID: ask_world requires question/);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
add("error: a tvnl_mcp_ token sent straight to the REST API is refused before any other check", async () => {
  const real = await vi.importActual<typeof import("./developer-auth")>("./developer-auth");
  mocks.authenticateKey.mockResolvedValueOnce({ ok: true, principal: { ...keyPrincipal(READ_SCOPES).principal, audience: "mcp" } });
  const refused = await real.authorizeFoundationRequest(
    new Request(`${ORIGIN}/api/v1/collections`, { headers: { authorization: "Bearer tvnl_mcp_abcdefghijkl_secret" } }), "collections:read",
  );
  expect(refused).toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID", status: 401 });
});
add("error: a tvnl_mcp_ token cannot be used to call the OAuth routes as a session", async () => {
  const clientId = await registeredClient();
  mocks.session.mockResolvedValueOnce({ ok: false, code: "AUTH_REQUIRED", status: 401 });
  const response = await consent("approve", authRequest(clientId), "tvnl_mcp_minted");
  expect([response.status, (await response.json()).code]).toEqual([401, "AUTH_REQUIRED"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
});

/* 10. deny side effects (3) */
const NO_SIDE_EFFECT = () => {
  for (const mock of [mocks.session, mocks.sessionProduct, mocks.createKey, mocks.listKeys, mocks.revokeKey, mocks.authenticateKey]) expect(mock).not.toHaveBeenCalled();
};
add("deny: Deny reads no session, mints no key and lists or revokes nothing", async () => {
  const body = await (await consent("deny", authRequest(await registeredClient()))).json() as Describe;
  expect(body.code).toBe("AUTHORIZATION_DENIED");
  NO_SIDE_EFFECT();
});
add("deny: Deny carries no code, workspace, user or key identifier in the redirect", async () => {
  const body = await (await consent("deny", authRequest(await registeredClient()))).json() as Describe;
  const back = new URL(body.redirectTo!);
  expect([...back.searchParams.keys()].sort()).toEqual(["error", "error_description", "iss", "state"]);
  expect(body.redirectTo).not.toContain(MINE);
  expect(body.redirectTo).not.toContain(USER);
});
add("deny: Deny then a token request has nothing to redeem and mints nothing", async () => {
  const clientId = await registeredClient();
  await consent("deny", authRequest(clientId));
  const response = await exchange(grant(clientId, "tvmcp_code_" + "A".repeat(60)));
  expect([response.status, (await response.json() as Grant).error]).toEqual([400, "invalid_grant"]);
  expect(mocks.createKey).not.toHaveBeenCalled();
  noWorkspaceTouched();
});

/* 11. tools/list (WO-MCP-LIST-AUTH) */
type Listed = { result: { tools: Array<{ name: string }> } };
const listText = async (headers: Record<string, string> = {}) => {
  const response = await rpc(LIST, headers);
  expect(response.status).toBe(200);
  return response.text();
};
const listedNames = async (bearer: string) => ((JSON.parse(await listText({ authorization: `Bearer ${bearer}` })) as Listed).result.tools.map((tool) => tool.name));
const BRIDGE_NINE = Object.keys(REMOTE_MCP_TOOL_SCOPES);
const anonymousChallenge = async () => {
  const response = await rpc(LIST);
  expect([response.status, (await response.json()).error.message]).toEqual([401, "AUTH_REQUIRED"]);
  expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
};
add("list: no token is the static definitions only: the nine tools, read without any token or store", async () => {
  const text = await listText();
  expect((JSON.parse(text) as Listed).result.tools.map((tool) => tool.name)).toEqual(BRIDGE_NINE);
  expect(text).not.toMatch(/collection-[a-f0-9]{32}|pilot-|evidence-[a-f0-9]{32}/);
  expect(text).not.toContain(USER);
  for (const mock of [mocks.authenticateKey, mocks.authorize, mocks.listWorlds, mocks.activeWorld, mocks.readModel]) expect(mock).not.toHaveBeenCalled();
});
add("list: no token is the same bytes for every caller, whatever host addressed it", async () => {
  expect(await listText({ host: "preview.tavonel.test", "x-forwarded-proto": "https" })).toBe(await listText());
});
add("list: no token, with canonical tools on, is the static eleven and still reads no store", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_CANONICAL_TOOLS", "true");
  const text = await listText();
  expect((JSON.parse(text) as Listed).result.tools.map((tool) => tool.name)).toEqual([...BRIDGE_NINE, "search", "fetch"]);
  expect(text).not.toMatch(/collection-[a-f0-9]{32}|pilot-/);
  expect(mocks.authenticateKey).not.toHaveBeenCalled();
});
add("list: no token can list but never execute: tools/call of every listed tool is 401 and runs no route", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_CANONICAL_TOOLS", "true");
  for (const tool of [...BRIDGE_NINE, "search", "fetch"]) {
    const response = await call(tool, {});
    expect([tool, response.status, (await response.json()).error.message]).toEqual([tool, 401, "AUTH_REQUIRED"]);
  }
  for (const mock of [mocks.authorize, mocks.listWorlds, mocks.activeWorld, mocks.readModel, mocks.loadCandidate]) expect(mock).not.toHaveBeenCalled();
});
add("list: a token holding every read scope sees exactly the anonymous list, byte for byte (every listed name has a scope)", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_CANONICAL_TOOLS", "true");
  expect(await listText({ authorization: "Bearer tvnl_mcp_mine" })).toBe(await listText());
});
add("list: a token short of ask:read does not see the tools ask:read gates", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_CANONICAL_TOOLS", "true");
  mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal(READ_SCOPES.filter((scope) => scope !== "ask:read")));
  expect(await listedNames("tvnl_mcp_narrow")).toEqual(["list_sources", "list_worlds", "get_world", "get_object", "get_relation", "get_evidence", "download_package", "fetch"]);
});
add("list: a token holding only documents:read sees list_sources alone; the hidden tools still answer 403 when called", async () => {
  mocks.authenticateKey.mockResolvedValue(keyPrincipal(["documents:read"]));
  expect(await listedNames("tvnl_mcp_narrow")).toEqual(["list_sources"]);
  expect((await call("list_worlds", {}, "tvnl_mcp_narrow")).status).toBe(403);
});
add("list: a token holding no scope sees an empty list", async () => {
  mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal([]));
  expect(await listedNames("tvnl_mcp_empty")).toEqual([]);
});
add("list: two workspaces' tokens with the same scopes get the same bytes (the list names no tenant)", async () => {
  mocks.authenticateKey.mockResolvedValueOnce(keyPrincipal(READ_SCOPES));
  const mine = await listText({ authorization: "Bearer tvnl_mcp_mine" });
  mocks.authenticateKey.mockResolvedValueOnce({ ok: true, principal: { ...keyPrincipal(READ_SCOPES).principal, workspaceKey: "pilot-beta" } });
  expect(await listText({ authorization: "Bearer tvnl_mcp_theirs" })).toBe(mine);
});
add("list: a token whose workspace is outside the cohort is 403 on tools/list too", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
  const response = await rpc(LIST, { authorization: "Bearer tvnl_mcp_mine" });
  expect([response.status, (await response.json()).error.message]).toEqual([403, "REMOTE_MCP_COHORT_EXCLUDED"]);
});
const listRefused = (name: string, authorization: string, setup: () => void = () => {}) => add(`list: ${name} is 401 invalid_token on tools/list`, async () => {
  setup();
  const response = await rpc(LIST, { authorization });
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
});
listRefused("a revoked token", "Bearer tvnl_mcp_revoked", () => mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_INVALID" }));
listRefused("an expired token", "Bearer tvnl_mcp_expired", () => mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_EXPIRED" }));
listRefused("an agent-resource token (wrong audience)", "Bearer tvnl_agt_abcdefghijkl_secret");
listRefused("a foreign JWT", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x");
add("list-auth flag: exactly 'true' makes tools/list with no token 401 AUTH_REQUIRED with the resource_metadata challenge", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_LIST_AUTH", "true");
  await anonymousChallenge();
  expect(mocks.authenticateKey).not.toHaveBeenCalled();
});
add("list-auth flag on: initialize and ping with no token still answer 200 (capability discovery stays public)", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_LIST_AUTH", "true");
  expect((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).status).toBe(200);
  expect((await rpc({ jsonrpc: "2.0", id: 2, method: "ping" })).status).toBe(200);
});
add("list-auth flag on: a valid token lists exactly what it lists with the flag off", async () => {
  const off = await listText({ authorization: "Bearer tvnl_mcp_mine" });
  vi.stubEnv("TAVONEL_REMOTE_MCP_LIST_AUTH", "true");
  expect(await listText({ authorization: "Bearer tvnl_mcp_mine" })).toBe(off);
});
add("list-auth flag on: a revoked token is still 401 invalid_token, not AUTH_REQUIRED", async () => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_LIST_AUTH", "true");
  mocks.authenticateKey.mockResolvedValueOnce({ ok: false, code: "API_KEY_INVALID" });
  const response = await rpc(LIST, { authorization: "Bearer tvnl_mcp_revoked" });
  expect([response.status, (await response.json()).error.message]).toEqual([401, "AUTH_INVALID"]);
});
add("list-auth flag: any value but exactly 'true' is off, byte-identical to unset", async () => {
  const unset = await listText();
  for (const value of ["", "TRUE", "1", " true", "true ", "yes", "on"]) {
    vi.stubEnv("TAVONEL_REMOTE_MCP_LIST_AUTH", value);
    expect([value, await listText()]).toEqual([value, unset]);
  }
});
add("list-auth flag: T01/T06 issuer and resource metadata are byte-identical with it on, and no agent resource is advertised", async () => {
  const read = async () => [
    await (await authorizationServer(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).text(),
    await (await wellKnown({ host: "tavonel.test", "x-forwarded-proto": "https" })).text(),
  ];
  const off = await read();
  vi.stubEnv("TAVONEL_REMOTE_MCP_LIST_AUTH", "true");
  expect(await read()).toEqual(off);
  expect(off.join("")).not.toContain("agent-mcp");
  const agent = await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/agent-mcp`), { params: Promise.resolve({ resource: ["api", "agent-mcp"] }) });
  expect(await agent.text()).not.toContain("agent-mcp");
});

/* ------------------------------------------------------------------- the run */

describe("remote MCP auth / expiry / revoke / origin / error matrix (WO-D19-4)", () => {
  it.each(cases)("%s", async (_name, run) => {
    await run();
  });

  it("holds at least 100 cases and every name is unique", () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    expect(new Set(cases.map(([name]) => name)).size).toBe(cases.length);
  });
});
