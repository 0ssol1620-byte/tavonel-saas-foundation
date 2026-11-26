import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-C-T1 closing round: what a `member` acting in a shared workspace may NOT do.

  Two classes, each driven through the real routes:

  1. The remote MCP surface. A member's credential -- whatever its form (`tvnl_live_`, `tvnl_mcp_`)
     and however it got there -- never resolves to the shared workspace on that surface: not through
     the real POST /api/mcp dispatch into the /api/v1 handlers, and not at the OAuth consent that
     mints the token. The remote MCP lists Worlds without the viewer's source scope (TC-D3).
  2. Connection mutation. Creating, revoking or syncing a workspace connection is the owner's or an
     admin's act (TC-D7); a member is refused before anything reaches the store or the secret broker.
     The last test enumerates every connection route handler on disk, so a new one cannot land
     unclassified.

  Real developer-auth, real resolver, real routes; only the store hop, the session user and the
  stores behind each route are faked.
*/

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const OWN_OF = (userId: string) => `pilot-${userId.replace(/-/g, "").slice(0, 16)}`;
const SHARED = OWN_OF(OWNER);
const MEMBER_OWN = OWN_OF(MEMBER);
const ORIGIN = "https://tavonel.test";
const CONN = "55555555-5555-4555-8555-555555555555";
const COLLECTION = `collection-${"c".repeat(32)}`;
const READ_SCOPES = ["ask:read", "collections:download", "collections:read", "documents:read", "worlds:read"];

type Row = { workspace_key: string; user_id: string; role: string; state: string; accepted_at: string; revoked_at: string | null; authorization_revision: number };
const store = vi.hoisted(() => ({ members: [] as Row[], user: null as { id: string } | null }));

vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://store.test", serviceRoleKey: "k".repeat(40) }),
  supabaseAdminRequest: async (_config: unknown, path: string) => {
    const url = new URL(path, "https://store.test");
    const eq = (name: string) => url.searchParams.get(name)?.replace(/^eq\./, "");
    if (url.pathname === "/rest/v1/foundation_workspace_members") {
      const rows = store.members.filter((row) => row.user_id === eq("user_id")
        && (!url.searchParams.has("workspace_key") || row.workspace_key === eq("workspace_key"))
        && (!url.searchParams.has("state") || row.state === eq("state")));
      return new Response(JSON.stringify(rows));
    }
    throw new Error(`unexpected store path ${path}`);
  },
}));
vi.mock("./foundation-pilot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./foundation-pilot")>()),
  getRequestUser: async () => store.user,
}));
const m = vi.hoisted(() => ({
  session: vi.fn(), key: vi.fn(), authenticate: vi.fn(), rate: vi.fn(),
  createConnection: vi.fn(), revokeConnection: vi.fn(), applyBatch: vi.fn(), inventory: vi.fn(),
  oauthRef: vi.fn(), oauthRevoke: vi.fn(), oauthCreate: vi.fn(), viewerRevoke: vi.fn(),
  brokerDelete: vi.fn(), brokerPut: vi.fn(), enqueue: vi.fn(), listJobs: vi.fn(),
  listWorlds: vi.fn(), activeWorld: vi.fn(),
}));
vi.mock("./self-service-trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./self-service-trial")>()),
  authorizeFoundationSessionProduct: m.session,
  trialFeatureBlocked: () => false,
}));
vi.mock("./billing-product-access", () => ({ authorizeFoundationProduct: m.key }));
vi.mock("./trial-ai-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./trial-ai-access")>()),
  trialAiAccess: async () => ({ ok: true }),
}));
vi.mock("./developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  authenticateDeveloperApiKey: m.authenticate,
  consumeDeveloperApiRateLimit: m.rate,
  createFoundationConnection: m.createConnection,
  revokeFoundationConnection: m.revokeConnection,
  applyFoundationConnectionBatch: m.applyBatch,
}));
vi.mock("./connection-source-inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connection-source-inventory")>()),
  applyConnectionInventoryRequest: m.inventory,
}));
vi.mock("./connector-oauth-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connector-oauth-store")>()),
  getOAuthConnectionSecretReference: m.oauthRef,
  revokeOAuthConnection: m.oauthRevoke,
  createOAuthAuthorization: m.oauthCreate,
  revokeGoogleDriveViewerPrincipals: m.viewerRevoke,
}));
vi.mock("./connector-oauth-secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connector-oauth-secrets")>()),
  readOAuthSecretBrokerConfig: () => ({ url: "https://broker.test", token: "t".repeat(40) }),
  deleteOAuthSecret: m.brokerDelete,
  putOAuthSecret: m.brokerPut,
}));
vi.mock("./job-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./job-store")>()),
  enqueueConnectorSync: m.enqueue,
  listConnectionJobs: m.listJobs,
}));
vi.mock("./customer-data-admission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./customer-data-admission")>()),
  canAdmitCustomerSource: async () => true,
}));
vi.mock("./activation-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./activation-policy")>();
  return { ...actual, activationPolicy: { ...actual.activationPolicy, customerIntake: { ...actual.activationPolicy.customerIntake, enabled: true } } };
});
vi.mock("./world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  listFoundationActiveWorlds: m.listWorlds,
  getFoundationActiveWorld: m.activeWorld,
}));
vi.mock("./operations-alert-triggers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-alert-triggers")>()),
  recordMcpToolCall: async () => null,
}));
vi.mock("./operations-e2e-timing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-e2e-timing")>()),
  recordFirstMcpAnswerTiming: async () => "not_recorded",
}));

import { POST as mcp } from "../app/api/mcp/route";
import { POST as register } from "../app/api/mcp/oauth/register/route";
import { POST as consentRoute } from "../app/api/mcp/oauth/authorize/route";
import { GET as listConnections, POST as createConnection } from "../app/api/connections/route";
import { DELETE as revokeConnection } from "../app/api/connections/[id]/route";
import { DELETE as revokeConnectionV1 } from "../app/api/v1/connections/[id]/route";
import { POST as createConnectionV1 } from "../app/api/v1/connections/route";
import { POST as syncConnectionV1 } from "../app/api/v1/connections/[id]/sync/route";
import { POST as oauthAuthorize } from "../app/api/v1/oauth-connectors/authorize/route";
import { DELETE as oauthRevoke } from "../app/api/v1/oauth-connectors/connections/[id]/route";
import { GET as oauthJobs, POST as oauthSync } from "../app/api/v1/oauth-connectors/connections/[id]/sync/route";
import { POST as viewerLinksRevoke } from "../app/api/v1/oauth-connectors/viewer-links/revoke/route";
import { REMOTE_MCP_TOOL_SCOPES } from "./remote-mcp";
import { authorizeFoundationRequest, requireFoundationSession } from "./developer-auth";
import { withinRemoteMcpDispatch } from "./remote-mcp-dispatch";

const row = (workspace: string, user: string, role: string): Row => ({
  workspace_key: workspace, user_id: user, role, state: "active",
  accepted_at: "2026-11-18T00:00:00Z", revoked_at: null, authorization_revision: 1,
});
const setRole = (role: string) => { store.members[1] = row(SHARED, MEMBER, role); };
const keyFor = (userId: string, audience: "api" | "mcp", scopes = READ_SCOPES) => m.authenticate.mockResolvedValue({
  ok: true,
  principal: { kind: "api-key", keyId: "44444444-4444-4444-8444-444444444444", workspaceKey: SHARED, userId, scopes, authorizationRevision: 1, audience, agent: null },
});
const bearer = (audience: "api" | "mcp") => `${audience === "mcp" ? "tvnl_mcp_" : "tvnl_live_"}abcdefghijkl_${"a".repeat(43)}`;
const sessionHeaders = { authorization: "Bearer session-jwt", cookie: `tavonel_ws=${SHARED}` };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ACCESS_MODE", "self_service");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "remote-mcp-unit-test-sealing-secret-value");
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", `${SHARED},${MEMBER_OWN}`);
  store.members = [row(SHARED, OWNER, "owner"), row(SHARED, MEMBER, "member"), row(MEMBER_OWN, MEMBER, "owner")];
  store.user = { id: MEMBER };
  m.session.mockResolvedValue({ ok: true, access: { source: "paid", accessPlan: "studio_access", billingExempt: false, expiresAt: null } });
  m.key.mockResolvedValue({ ok: true, source: "paid", billingExempt: false });
  m.rate.mockResolvedValue({ ok: true });
  m.listWorlds.mockResolvedValue({ ok: true, worlds: [], nextCursor: null });
  m.activeWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
  m.createConnection.mockResolvedValue({ ok: true, connection: { connectionId: CONN } });
  m.revokeConnection.mockResolvedValue({ ok: true });
  m.applyBatch.mockResolvedValue({ ok: true, result: {} });
  m.inventory.mockResolvedValue({ ok: true, result: {} });
  m.oauthRef.mockResolvedValue({ ok: true, refreshTokenReference: "ref-owner" });
  m.oauthRevoke.mockResolvedValue({ ok: true });
  m.oauthCreate.mockResolvedValue({ ok: true, expiresAt: "2026-11-23T00:10:00Z" });
  m.viewerRevoke.mockResolvedValue({ ok: true, revokedCount: 0 });
  m.brokerDelete.mockResolvedValue(undefined);
  m.brokerPut.mockResolvedValue("ref-new");
  m.enqueue.mockResolvedValue({ ok: true, value: { jobId: "job-1", created: true } });
  m.listJobs.mockResolvedValue({ ok: true, value: [] });
});
afterEach(() => { vi.unstubAllEnvs(); });

/* ------------------------------------------------------------ 1. remote MCP */

const TOOL_ARGS: Record<string, Record<string, unknown>> = {
  list_sources: {},
  list_worlds: {},
  get_world: { collectionId: COLLECTION },
  search_world: { collectionId: COLLECTION, query: "revenue" },
  ask_world: { collectionId: COLLECTION, question: "What changed?" },
  get_object: { collectionId: COLLECTION },
  get_relation: { collectionId: COLLECTION },
  get_evidence: { collectionId: COLLECTION },
  download_package: { collectionId: COLLECTION },
};
const callTool = (name: string, token: string) => mcp(new Request(`${ORIGIN}/api/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: TOOL_ARGS[name] } }),
}));
const toolText = async (response: Response) => {
  const body = await response.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: { message?: string } };
  return { isError: body.result?.isError ?? true, text: body.result?.content?.[0]?.text ?? body.error?.message ?? "" };
};

describe("remote MCP: a member's credential never resolves to the shared workspace (real POST /api/mcp dispatch)", () => {
  it("covers every tool the remote MCP serves", () => {
    expect(Object.keys(TOOL_ARGS).sort()).toEqual(Object.keys(REMOTE_MCP_TOOL_SCOPES).sort());
  });

  it.each(Object.keys(REMOTE_MCP_TOOL_SCOPES).flatMap((tool) => [[tool, "api"], [tool, "mcp"]] as const))(
    "%s with a member's %s key is refused REMOTE_MCP_MEMBER_UNAVAILABLE before any World read or rate unit",
    async (tool, audience) => {
      keyFor(MEMBER, audience);
      const { isError, text } = await toolText(await callTool(tool, bearer(audience)));
      expect(isError).toBe(true);
      // The bridge's download path reports the status alone (`API_ERROR_403`), never the body's code.
      if (tool === "download_package") expect(text).toBe("API_ERROR_403");
      else expect(text).toContain("REMOTE_MCP_MEMBER_UNAVAILABLE");
      expect(m.listWorlds).not.toHaveBeenCalled();
      expect(m.activeWorld).not.toHaveBeenCalled();
      expect(m.rate).not.toHaveBeenCalled();
    },
  );

  it.each(["owner", "admin"])("an %s's live key reaches the shared workspace's Worlds through the same dispatch", async (role) => {
    if (role === "admin") setRole("admin");
    keyFor(role === "owner" ? OWNER : MEMBER, "api");
    const { isError, text } = await toolText(await callTool("list_worlds", bearer("api")));
    expect(text).not.toContain("REMOTE_MCP_MEMBER_UNAVAILABLE");
    expect(isError).toBe(false);
    expect(m.listWorlds).toHaveBeenCalledWith(SHARED, expect.anything());
  });

  it("a member's live key still reads the shared workspace over plain REST (only the MCP surface is closed)", async () => {
    keyFor(MEMBER, "api");
    const result = await authorizeFoundationRequest(new Request(`${ORIGIN}/api/v1/collections`, { headers: { authorization: `Bearer ${bearer("api")}` } }), "collections:read");
    expect(result).toMatchObject({ ok: true, principal: { workspaceKey: SHARED, workspaceRole: "member" } });
  });

  it("a member's session is refused inside the dispatch too, through both session resolvers", async () => {
    store.user = { id: MEMBER };
    const req = () => new Request(`${ORIGIN}/api/v1/collections`, { headers: sessionHeaders });
    expect(await withinRemoteMcpDispatch(() => authorizeFoundationRequest(req(), "collections:read")))
      .toEqual({ ok: false, code: "REMOTE_MCP_MEMBER_UNAVAILABLE", status: 403 });
    expect(await withinRemoteMcpDispatch(() => requireFoundationSession(req(), "observer")))
      .toEqual({ ok: false, code: "REMOTE_MCP_MEMBER_UNAVAILABLE", status: 403 });
  });
});

const VERIFIER = "remote-mcp-pkce-verifier-0123456789-abcdefghij";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REDIRECT = "https://client.example/oauth/callback";
async function consent(decision: "precheck" | "approve") {
  const registered = await register(new Request(`${ORIGIN}/api/mcp/oauth/register`, {
    method: "POST",
    body: JSON.stringify({ client_name: "Example agent", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  }));
  expect(registered.status).toBe(201);
  const clientId = (await registered.json() as { client_id: string }).client_id;
  return consentRoute(new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({ decision, request: {
      response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
      code_challenge_method: "S256", state: "client-state-1", resource: `${ORIGIN}/api/mcp`,
    } }),
  }));
}

describe("remote MCP consent: no token is minted for a member acting in a shared workspace", () => {
  it.each(["precheck", "approve"] as const)("%s by a member is refused with no authorization code and no World read", async (decision) => {
    const response = await consent(decision);
    expect(response.status).toBe(403);
    const body = await response.json() as { code: string; redirectTo?: string };
    expect(body).toEqual({ code: "REMOTE_MCP_MEMBER_UNAVAILABLE" });
    expect(m.listWorlds).not.toHaveBeenCalled();
  });

  it("approve by the owner in the same workspace still grants a code", async () => {
    store.user = { id: OWNER };
    const response = await consent("approve");
    expect(await response.json()).toMatchObject({ code: "AUTHORIZATION_GRANTED" });
  });

  it("a member consenting from their own workspace (no shared cookie) is the owner there and is not refused", async () => {
    const response = await consentRoute(new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
      method: "POST", headers: { authorization: "Bearer session-jwt" }, body: JSON.stringify({ decision: "deny", request: {} }),
    }));
    // The request is invalid on purpose: the point is that nothing about the role refused it.
    expect((await response.json() as { code: string }).code).not.toBe("REMOTE_MCP_MEMBER_UNAVAILABLE");
  });
});

/* ------------------------------------------------------ 2. connection mutation */

type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response;
const ctx = { params: Promise.resolve({ id: CONN }) };
const json = (body: unknown) => JSON.stringify(body);
type Mutation = { name: string; handler: Handler; method: string; path: string; body?: string; keyScope?: string; untouched: () => unknown[] };
const MUTATIONS: Mutation[] = [
  { name: "POST /api/connections (create)", handler: (request) => createConnection(request), method: "POST", path: "/api/connections",
    body: json({ provider: "file_server", mode: "local_agent", displayName: "Shared drive" }), keyScope: "connections:write", untouched: () => [m.createConnection] },
  { name: "POST /api/v1/connections (create)", handler: (request) => createConnectionV1(request), method: "POST", path: "/api/v1/connections",
    body: json({ provider: "file_server", mode: "local_agent", displayName: "Shared drive" }), keyScope: "connections:write", untouched: () => [m.createConnection] },
  { name: "DELETE /api/connections/[id] (revoke)", handler: revokeConnection, method: "DELETE", path: `/api/connections/${CONN}`,
    keyScope: "connections:write", untouched: () => [m.revokeConnection] },
  { name: "DELETE /api/v1/connections/[id] (revoke)", handler: revokeConnectionV1, method: "DELETE", path: `/api/v1/connections/${CONN}`,
    keyScope: "connections:write", untouched: () => [m.revokeConnection] },
  { name: "POST /api/v1/connections/[id]/sync (batch)", handler: syncConnectionV1, method: "POST", path: `/api/v1/connections/${CONN}/sync`,
    body: json({ batchId: "b1" }), keyScope: "connections:sync", untouched: () => [m.applyBatch, m.inventory] },
  { name: "DELETE /api/v1/oauth-connectors/connections/[id] (revoke, deletes the refresh token at the broker)", handler: oauthRevoke, method: "DELETE",
    path: `/api/v1/oauth-connectors/connections/${CONN}`, untouched: () => [m.oauthRef, m.brokerDelete, m.oauthRevoke] },
  { name: "POST /api/v1/oauth-connectors/authorize (new connection)", handler: (request) => oauthAuthorize(request), method: "POST",
    path: "/api/v1/oauth-connectors/authorize", body: json({ provider: "google_drive", displayName: "Drive" }), untouched: () => [m.brokerPut, m.oauthCreate] },
  { name: "POST /api/v1/oauth-connectors/connections/[id]/sync (import)", handler: oauthSync, method: "POST",
    path: `/api/v1/oauth-connectors/connections/${CONN}/sync`, body: json({}), untouched: () => [m.enqueue] },
];
const send = (mutation: Mutation, headers: Record<string, string>) => mutation.handler(new Request(`${ORIGIN}${mutation.path}`, {
  method: mutation.method, headers: { "content-type": "application/json", ...headers }, body: mutation.body,
}), ctx);

describe("connection mutation is an owner's or admin's act (TC-D7)", () => {
  it.each(MUTATIONS.map((mutation) => [mutation.name, mutation] as const))(
    "%s: a member's session is refused CONNECTION_ROLE_REQUIRED and nothing reaches the store or the broker",
    async (_name, mutation) => {
      const response = await send(mutation, sessionHeaders);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ code: "CONNECTION_ROLE_REQUIRED" });
      for (const fn of [...mutation.untouched(), m.brokerDelete, m.brokerPut]) expect(fn).not.toHaveBeenCalled();
    },
  );

  it.each(MUTATIONS.filter((mutation) => mutation.keyScope).map((mutation) => [mutation.name, mutation] as const))(
    "%s: a member's API key bound to the shared workspace is refused the same way, before a rate unit",
    async (_name, mutation) => {
      keyFor(MEMBER, "api", [mutation.keyScope!]);
      const response = await send(mutation, { authorization: `Bearer ${bearer("api")}` });
      expect(await response.json()).toEqual({ code: "CONNECTION_ROLE_REQUIRED" });
      for (const fn of mutation.untouched()) expect(fn).not.toHaveBeenCalled();
      expect(m.rate).not.toHaveBeenCalled();
    },
  );

  it.each(MUTATIONS.flatMap((mutation) => [["owner", mutation.name, mutation], ["admin", mutation.name, mutation]] as const))(
    "an %s passes the role gate: %s",
    async (role, _name, mutation) => {
      if (role === "owner") store.user = { id: OWNER };
      else setRole("admin");
      const response = await send(mutation, sessionHeaders);
      expect(response.status).not.toBe(403);
      expect(await response.clone().text()).not.toContain("CONNECTION_ROLE_REQUIRED");
    },
  );

  it("an unknown role is refused like a member (fail closed), not passed through", async () => {
    const { requireConnectionManager } = await import("./developer-auth");
    for (const role of ["member", "viewer", "", "OWNER", null, undefined]) {
      expect(requireConnectionManager({ workspaceRole: role as never })).toEqual({ ok: false, code: "CONNECTION_ROLE_REQUIRED", status: 403 });
    }
    expect(requireConnectionManager({ workspaceRole: "owner" })).toBeNull();
    expect(requireConnectionManager({ workspaceRole: "admin" })).toBeNull();
  });

  it("a member may still read connections and their jobs, and withdraw their own viewer links", async () => {
    expect((await listConnections(new Request(`${ORIGIN}/api/connections`, { headers: sessionHeaders }))).status).not.toBe(403);
    m.listJobs.mockResolvedValue({ ok: true, value: [] });
    expect(await (await oauthJobs(new Request(`${ORIGIN}/api/v1/oauth-connectors/connections/${CONN}/sync`, { headers: sessionHeaders }), ctx)).text())
      .not.toContain("CONNECTION_ROLE_REQUIRED");
    expect(await (await viewerLinksRevoke(new Request(`${ORIGIN}/api/v1/oauth-connectors/viewer-links/revoke`, { method: "POST", headers: sessionHeaders }))).text())
      .not.toContain("CONNECTION_ROLE_REQUIRED");
    // Linking the member's own Google identity is not a workspace connection.
    expect(await (await oauthAuthorize(new Request(`${ORIGIN}/api/v1/oauth-connectors/authorize`, {
      method: "POST", headers: sessionHeaders, body: json({ provider: "google_drive", displayName: "Me", purpose: "viewer_acl_link" }),
    }))).text()).not.toContain("CONNECTION_ROLE_REQUIRED");
  });
});

/*
  The class guard: every exported handler of every route file under the connection trees is
  classified here. A new connection route (or a new method on one) fails this test until someone
  decides whether a member may call it -- and a mutating one must then appear in MUTATIONS above.
*/
const CLASSIFIED: Record<string, "manager" | "read" | "own" | "upstream"> = {
  "app/api/connections/route.ts GET": "read",
  "app/api/connections/route.ts POST": "manager",
  "app/api/connections/[id]/route.ts DELETE": "manager",
  "app/api/v1/connections/route.ts GET": "read",
  "app/api/v1/connections/route.ts POST": "manager",
  "app/api/v1/connections/[id]/route.ts DELETE": "manager",
  "app/api/v1/connections/[id]/sync/route.ts POST": "manager",
  "app/api/v1/oauth-connectors/route.ts GET": "read",
  "app/api/v1/oauth-connectors/authorize/route.ts POST": "manager",
  // Completes only a state the authorize route issued; a member is never issued one for a connection.
  "app/api/v1/oauth-connectors/callback/[provider]/route.ts GET": "upstream",
  "app/api/v1/oauth-connectors/connections/[id]/route.ts DELETE": "manager",
  "app/api/v1/oauth-connectors/connections/[id]/sync/route.ts POST": "manager",
  "app/api/v1/oauth-connectors/connections/[id]/sync/route.ts GET": "read",
  // Withdraws the caller's own viewer identity links (userId-scoped), never the workspace's.
  "app/api/v1/oauth-connectors/viewer-links/revoke/route.ts POST": "own",
};

describe("every connection route handler is classified", () => {
  it("finds no unclassified handler and no stale entry", () => {
    const root = join(__dirname, "..");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name === "route.ts") {
          const source = readFileSync(path, "utf8");
          const file = relative(root, path).replace(/\\/g, "/");
          for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b[^}]*\}/g)) {
            found.push(`${file} ${match[1] ?? match[2]}`);
          }
        }
      }
    };
    for (const tree of ["app/api/connections", "app/api/v1/connections", "app/api/v1/oauth-connectors"]) walk(join(root, tree));
    expect(found.sort()).toEqual(Object.keys(CLASSIFIED).sort());
    const tested = new Set(MUTATIONS.map((mutation) => `${mutation.method} ${mutation.path.replace(CONN, "[id]")}`));
    for (const [handler, kind] of Object.entries(CLASSIFIED)) {
      if (kind !== "manager") continue;
      const [file, method] = handler.split(" ");
      const path = `/${file!.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`;
      expect(tested.has(`${method} ${path}`), handler).toBe(true);
    }
  });
});
