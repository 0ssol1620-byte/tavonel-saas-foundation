import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-C-T1: which workspace a request acts in.

  The real resolver, the real developer-auth, the real select/mine routes and the real
  workspace-membership reader run here. Only the HTTP hop to the store is faked: a table of
  foundation_workspace_members rows answered the way PostgREST answers them, so the membership
  parse, the identity check and every fallback path are the production code. The session user is
  stubbed (Supabase Auth is a network call) and pilot access is the real self-service rule.
*/

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const OWN_OF = (userId: string) => `pilot-${userId.replace(/-/g, "").slice(0, 16)}`;
const SHARED = OWN_OF(OWNER);
const MEMBER_OWN = OWN_OF(MEMBER);
const STRANGER_OWN = OWN_OF(STRANGER);

type Row = { workspace_key: string; user_id: string; role: string; state: string; accepted_at: string; revoked_at: string | null; authorization_revision: number };
const store = vi.hoisted(() => ({
  members: [] as Row[],
  billing: [] as Record<string, unknown>[],
  down: false,
  paths: [] as string[],
  user: null as { id: string } | null,
  /** Supabase Auth's user_metadata per user id, as GET /auth/v1/admin/users/{id} answers it; absent = 404. */
  authUsers: {} as Record<string, unknown>,
  authDown: false,
}));

vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://store.test", serviceRoleKey: "k".repeat(40) }),
  supabaseAdminRequest: async (_config: unknown, path: string) => {
    store.paths.push(path);
    if (store.down) throw new Error("store unreachable");
    const url = new URL(path, "https://store.test");
    const eq = (name: string) => url.searchParams.get(name)?.replace(/^eq\./, "");
    if (url.pathname === "/rest/v1/foundation_workspace_members") {
      let rows = url.searchParams.has("user_id") ? store.members.filter((row) => row.user_id === eq("user_id")) : store.members;
      const workspace = url.searchParams.get("workspace_key");
      if (workspace?.startsWith("in.(")) rows = rows.filter((row) => workspace.slice(4, -1).split(",").includes(row.workspace_key));
      else if (workspace !== null) rows = rows.filter((row) => row.workspace_key === eq("workspace_key"));
      if (url.searchParams.has("role")) rows = rows.filter((row) => row.role === eq("role"));
      if (url.searchParams.has("state")) rows = rows.filter((row) => row.state === eq("state"));
      rows = [...rows].sort((a, b) => a.workspace_key.localeCompare(b.workspace_key));
      const embedded = (url.searchParams.get("select") ?? "").includes("foundation_workspaces(");
      const shaped = rows.map((row) => embedded ? { ...row, foundation_workspaces: { display_name: `${row.workspace_key} name` } } : row);
      return new Response(JSON.stringify(shaped.slice(0, Number(url.searchParams.get("limit") ?? "1000"))));
    }
    if (url.pathname === "/rest/v1/foundation_billing_accounts") {
      const keys = (url.searchParams.get("workspace_key") ?? "").replace(/^in\.\(|\)$/g, "").split(",");
      return new Response(JSON.stringify(store.billing.filter((row) => keys.includes(String(row.workspace_key)))));
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      if (store.authDown) throw new Error("auth unreachable");
      const id = decodeURIComponent(url.pathname.slice("/auth/v1/admin/users/".length));
      if (!Object.hasOwn(store.authUsers, id)) return new Response(JSON.stringify({ code: 404, msg: "User not found" }), { status: 404 });
      return new Response(JSON.stringify({ id, email: `${id}@mail.test`, user_metadata: store.authUsers[id] }));
    }
    throw new Error(`unexpected store path ${path}`);
  },
}));
vi.mock("./foundation-pilot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./foundation-pilot")>()),
  getRequestUser: async () => store.user,
}));
const product = vi.hoisted(() => ({ session: vi.fn(), key: vi.fn(), authenticate: vi.fn(), rate: vi.fn() }));
vi.mock("./self-service-trial", () => ({ authorizeFoundationSessionProduct: product.session, trialFeatureBlocked: () => false }));
vi.mock("./billing-product-access", () => ({ authorizeFoundationProduct: product.key }));
vi.mock("./developer-store", () => ({ authenticateDeveloperApiKey: product.authenticate, consumeDeveloperApiRateLimit: product.rate }));
const billingRoute = vi.hoisted(() => ({ account: vi.fn(), notices: vi.fn() }));
vi.mock("./billing-store", () => ({ getFoundationBillingAccount: billingRoute.account }));
vi.mock("./billing-gate-enforcement", () => ({ listBillingNotices: billingRoute.notices }));

const objects = vi.hoisted(() => ({ list: vi.fn(), viewer: vi.fn() }));
vi.mock("./r2-objects", () => ({ listImmutableWorkspaceObjects: objects.list }));
vi.mock("./r2-presign", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-presign")>()),
  presignWorkspaceProgressGet: () => ({ ok: true, readUrl: "https://bucket.test/signed" }),
}));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }) }));
vi.mock("./connector-source-access", () => ({ checkConnectorSourceAccessForViewer: objects.viewer }));

import { GET as progress } from "../app/api/documents/[id]/progress/route";
import { POST as rollback } from "../app/api/collections/[id]/world/rollback/route";
import { GET as mine } from "../app/api/workspaces/mine/route";
import { POST as select } from "../app/api/workspaces/select/route";
import { GET as billingStatus } from "../app/api/billing/status/route";
import { readActingWorkspaceCookie, resolveActingWorkspace, revalidateActingWorkspace } from "./acting-workspace";
import { authorizeFoundationRequest, requireFoundationSession } from "./developer-auth";
import { withinRemoteMcpDispatch } from "./remote-mcp-dispatch";

const row = (workspace: string, user: string, role: string, state = "active", revision = 1): Row => ({
  workspace_key: workspace, user_id: user, role, state,
  accepted_at: "2026-11-18T00:00:00Z", revoked_at: state === "revoked" ? "2026-11-18T01:00:00Z" : null,
  authorization_revision: revision,
});

function request(cookie?: string, extra: Record<string, string> = {}) {
  return new Request("https://tavonel.test/api/v1/documents", {
    headers: { authorization: "Bearer session-jwt", ...(cookie === undefined ? {} : { cookie }), ...extra },
  });
}
const membershipReads = () => store.paths.filter((path) => path.startsWith("/rest/v1/foundation_workspace_members"));

beforeEach(() => {
  vi.stubEnv("ACCESS_MODE", "self_service");
  vi.stubEnv("VERCEL_ENV", "");
  store.members = [
    row(SHARED, OWNER, "owner"),
    row(SHARED, MEMBER, "member"),
    row(MEMBER_OWN, MEMBER, "owner"),
    row(STRANGER_OWN, STRANGER, "owner"),
  ];
  store.billing = [];
  store.down = false;
  store.paths = [];
  store.user = { id: MEMBER };
  store.authUsers = {
    [OWNER]: { full_name: "  Olivia Owner " },
    [MEMBER]: { full_name: "Mina Member" },
    [STRANGER]: {},
  };
  store.authDown = false;
  product.session.mockReset().mockResolvedValue({ ok: true, access: { source: "paid", accessPlan: "studio_access", billingExempt: false, expiresAt: null } });
  product.key.mockReset().mockResolvedValue({ ok: true, source: "paid", billingExempt: false });
  product.authenticate.mockReset();
  product.rate.mockReset().mockResolvedValue({ ok: true });
  billingRoute.account.mockReset().mockResolvedValue({ ok: true, account: { subscriptionStatus: "active" } });
  billingRoute.notices.mockReset().mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("readActingWorkspaceCookie", () => {
  it.each([
    ["absent", undefined],
    ["empty value", "tavonel_ws="],
    ["quoted", `tavonel_ws="${SHARED}"`],
    ["path traversal", "tavonel_ws=pilot-../../x"],
    ["too long", `tavonel_ws=pilot-${"a".repeat(17)}`],
    ["not a workspace key", "tavonel_ws=collection-abc"],
    ["percent-encoded", `tavonel_ws=${encodeURIComponent(`${SHARED};`)}`],
    ["repeated (ambiguous)", `tavonel_ws=${SHARED}; tavonel_ws=${MEMBER_OWN}`],
    ["another cookie's name", `workspace=${SHARED}; x_tavonel_ws=${SHARED}`],
    ["oversized", `tavonel_ws=${"p".repeat(10_000)}`],
  ])("reads nothing from a cookie that is %s", (_label, cookie) => {
    expect(readActingWorkspaceCookie(request(cookie))).toBeNull();
  });

  it("reads one well-formed value among other cookies", () => {
    expect(readActingWorkspaceCookie(request(`a=1; tavonel_ws=${SHARED}; b=2`))).toBe(SHARED);
  });
});

describe("resolveActingWorkspace", () => {
  it("answers the user's own workspace without reading the store when there is no cookie", async () => {
    const resolved = await resolveActingWorkspace(request(), { id: MEMBER });
    expect(resolved).toEqual({ ok: true, shared: false, membership: { workspaceId: MEMBER_OWN, userId: MEMBER, role: "owner" } });
    expect(store.paths).toEqual([]);
  });

  it("answers the shared workspace, with the stored role, for an active member", async () => {
    const resolved = await resolveActingWorkspace(request(`tavonel_ws=${SHARED}`), { id: MEMBER });
    expect(resolved).toEqual({ ok: true, shared: true, membership: { workspaceId: SHARED, userId: MEMBER, role: "member" } });
  });

  it.each([
    ["never a member", () => { store.user = { id: STRANGER }; }, STRANGER, STRANGER_OWN],
    ["revoked", () => { store.members[1] = row(SHARED, MEMBER, "member", "revoked", 2); }, MEMBER, MEMBER_OWN],
    ["a workspace that does not exist", () => { store.members = store.members.filter((item) => item.workspace_key !== SHARED); }, MEMBER, MEMBER_OWN],
  ])("answers the user's own workspace and nothing else for a cookie naming a workspace the user is %s", async (_label, arrange, userId, own) => {
    arrange();
    const resolved = await resolveActingWorkspace(request(`tavonel_ws=${SHARED}`), { id: userId });
    expect(resolved).toEqual({ ok: true, shared: false, membership: { workspaceId: own, userId, role: "owner" } });
  });

  it("is a 503 when the store cannot be read, never the own workspace standing in for the shared one", async () => {
    store.down = true;
    expect(await resolveActingWorkspace(request(`tavonel_ws=${SHARED}`), { id: MEMBER }))
      .toEqual({ ok: false, code: "WORKSPACE_MEMBERSHIP_READ_FAILED", status: 503 });
  });

  it("is a 503 when the store answers a row in a shape it never writes (an unknown role is not passed through)", async () => {
    store.members[1] = { ...row(SHARED, MEMBER, "member"), role: "superuser" };
    const resolved = await resolveActingWorkspace(request(`tavonel_ws=${SHARED}`), { id: MEMBER });
    expect(resolved).toEqual({ ok: false, code: "WORKSPACE_MEMBERSHIP_STORE_INVALID", status: 503 });
  });

  it("refuses a user outside pilot access before reading any cookie", async () => {
    vi.stubEnv("ACCESS_MODE", "pilot");
    vi.stubEnv("FOUNDATION_PILOT_USER_IDS", OWNER);
    expect(await resolveActingWorkspace(request(`tavonel_ws=${SHARED}`), { id: MEMBER }))
      .toEqual({ ok: false, code: "PILOT_ACCESS_REQUIRED", status: 403 });
    expect(store.paths).toEqual([]);
  });

  it("revalidation refuses a membership revoked or a role changed after the request began", async () => {
    const first = await resolveActingWorkspace(request(`tavonel_ws=${SHARED}`), { id: MEMBER });
    if (!first.ok) throw new Error("expected the shared workspace");
    expect(await revalidateActingWorkspace(request(`tavonel_ws=${SHARED}`), { id: MEMBER }, first.membership)).toEqual({ ok: true });
    store.members[1] = row(SHARED, MEMBER, "admin", "active", 2);
    expect(await revalidateActingWorkspace(request(`tavonel_ws=${SHARED}`), { id: MEMBER }, first.membership))
      .toEqual({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 });
    store.members[1] = row(SHARED, MEMBER, "member", "revoked", 3);
    expect(await revalidateActingWorkspace(request(`tavonel_ws=${SHARED}`), { id: MEMBER }, first.membership))
      .toEqual({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 });
  });
});

describe("developer-auth acts in the resolved workspace", () => {
  it("leaves an owner with no cookie exactly where they were: own workspace, no extra store read", async () => {
    store.user = { id: OWNER };
    const result = await authorizeFoundationRequest(request(), "documents:read");
    expect(result).toMatchObject({ ok: true, principal: { kind: "session", workspaceKey: SHARED, userId: OWNER, workspaceRole: "owner" } });
    // One read: the durable authority of the owner's own workspace, as before WO-C-T1.
    expect(membershipReads()).toHaveLength(1);
  });

  it("puts a member's session in the shared workspace, with the member role", async () => {
    const result = await authorizeFoundationRequest(request(`tavonel_ws=${SHARED}`), "documents:read");
    expect(result).toMatchObject({ ok: true, principal: { workspaceKey: SHARED, userId: MEMBER, workspaceRole: "member" } });
    expect(product.session).toHaveBeenCalledWith(SHARED, MEMBER, "observer");
  });

  it.each([
    ["a workspace the user is not a member of", STRANGER_OWN],
    ["a malformed value", "pilot-../../etc"],
  ])("ignores a cookie naming %s and keeps the user's own workspace", async (_label, value) => {
    const result = await authorizeFoundationRequest(request(`tavonel_ws=${value}`), "documents:read");
    expect(result).toMatchObject({ ok: true, principal: { workspaceKey: MEMBER_OWN, workspaceRole: "owner" } });
  });

  it("drops a member revoked between select and request back to their own workspace", async () => {
    store.members[1] = row(SHARED, MEMBER, "member", "revoked", 2);
    const result = await authorizeFoundationRequest(request(`tavonel_ws=${SHARED}`), "documents:read");
    expect(result).toMatchObject({ ok: true, principal: { workspaceKey: MEMBER_OWN } });
  });

  it("still ignores the x-tavonel-workspace header, with or without the cookie", async () => {
    const headerOnly = await authorizeFoundationRequest(request(undefined, { "x-tavonel-workspace": SHARED }), "documents:read");
    expect(headerOnly).toMatchObject({ ok: true, principal: { workspaceKey: MEMBER_OWN } });
    store.user = { id: STRANGER };
    const both = await authorizeFoundationRequest(request(`tavonel_ws=${SHARED}`, { "x-tavonel-workspace": SHARED }), "documents:read");
    expect(both).toMatchObject({ ok: true, principal: { workspaceKey: STRANGER_OWN } });
  });

  it("answers 503 when the membership store is down for a requested shared workspace", async () => {
    store.down = true;
    expect(await authorizeFoundationRequest(request(`tavonel_ws=${SHARED}`), "documents:read"))
      .toEqual({ ok: false, code: "WORKSPACE_MEMBERSHIP_READ_FAILED", status: 503 });
  });

  it("binds a key created from a shared-workspace session to that workspace (requireFoundationSession)", async () => {
    const session = await requireFoundationSession(request(`tavonel_ws=${SHARED}`), "observer");
    expect(session).toMatchObject({ ok: true, principal: { workspaceKey: SHARED, workspaceRole: "member", authorizationRevision: 1 } });
  });
});

describe("API keys bound to a shared workspace", () => {
  const key = (audience: "api" | "mcp", overrides: Record<string, unknown> = {}) => {
    product.authenticate.mockResolvedValue({
      ok: true,
      principal: {
        kind: "api-key", keyId: "44444444-4444-4444-8444-444444444444", workspaceKey: SHARED, userId: MEMBER,
        scopes: ["documents:read"], authorizationRevision: 1, audience, agent: null, ...overrides,
      },
    });
    return new Request("https://tavonel.test/api/v1/documents", {
      headers: { authorization: `Bearer ${audience === "mcp" ? "tvnl_mcp_" : "tvnl_live_"}abcdefghijkl_${"a".repeat(43)}`, cookie: `tavonel_ws=${MEMBER_OWN}` },
    });
  };

  it("admits a member's key in the workspace it was made in (the derived-key condition is gone)", async () => {
    const result = await authorizeFoundationRequest(key("api"), "documents:read");
    expect(result).toMatchObject({ ok: true, principal: { kind: "api-key", workspaceKey: SHARED, workspaceRole: "member" } });
  });

  it("refuses the key once the membership is revoked, and after a re-invite as a revoked authorization", async () => {
    store.members[1] = row(SHARED, MEMBER, "member", "revoked", 2);
    expect(await authorizeFoundationRequest(key("api"), "documents:read"))
      .toEqual({ ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 });
    store.members[1] = row(SHARED, MEMBER, "member", "active", 3);
    expect(await authorizeFoundationRequest(key("api"), "documents:read"))
      .toEqual({ ok: false, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 });
  });

  it("keeps pilot access as a condition for a key", async () => {
    vi.stubEnv("ACCESS_MODE", "pilot");
    vi.stubEnv("FOUNDATION_PILOT_USER_IDS", OWNER);
    expect(await authorizeFoundationRequest(key("api"), "documents:read"))
      .toEqual({ ok: false, code: "PILOT_ACCESS_REQUIRED", status: 403 });
  });

  it("refuses a member's remote MCP token inside the MCP dispatch with REMOTE_MCP_MEMBER_UNAVAILABLE", async () => {
    expect(await withinRemoteMcpDispatch(() => authorizeFoundationRequest(key("mcp"), "documents:read")))
      .toEqual({ ok: false, code: "REMOTE_MCP_MEMBER_UNAVAILABLE", status: 403 });
    expect(product.rate).not.toHaveBeenCalled();
  });

  it("leaves the remote MCP open to an admin", async () => {
    store.members[1] = row(SHARED, MEMBER, "admin");
    const result = await withinRemoteMcpDispatch(() => authorizeFoundationRequest(key("mcp"), "documents:read"));
    expect(result).toMatchObject({ ok: true, principal: { workspaceKey: SHARED, workspaceRole: "admin" } });
  });

  it("leaves the remote MCP open to the owner", async () => {
    const result = await withinRemoteMcpDispatch(() => authorizeFoundationRequest(key("mcp", { userId: OWNER }), "documents:read"));
    expect(result).toMatchObject({ ok: true, principal: { workspaceKey: SHARED, workspaceRole: "owner" } });
  });

  it("refuses a member's remote MCP token outside the dispatch as before, with the audience code", async () => {
    expect(await authorizeFoundationRequest(key("mcp"), "documents:read"))
      .toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID", status: 401 });
  });
});

describe("POST /api/workspaces/select", () => {
  const post = (body: unknown, user: string | null = MEMBER) => {
    store.user = user ? { id: user } : null;
    return select(new Request("https://tavonel.test/api/workspaces/select", {
      method: "POST", headers: { authorization: "Bearer session-jwt", "content-type": "application/json" }, body: JSON.stringify(body),
    }));
  };

  it("sets the cookie only after the membership check, Secure, HttpOnly, SameSite=Lax, Path=/, 30 days", async () => {
    const response = await post({ workspaceKey: SHARED });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "WORKSPACE_SELECTED", workspaceKey: SHARED, role: "member", shared: true });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`tavonel_ws=${SHARED}`);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it.each([
    ["not a member", () => { store.members.splice(1, 1); }],
    ["revoked", () => { store.members[1] = row(SHARED, MEMBER, "member", "revoked", 2); }],
    ["unknown", () => { store.members = store.members.filter((item) => item.workspace_key !== SHARED); }],
  ])("refuses a workspace the caller is %s with one indistinguishable answer and no cookie", async (_label, arrange) => {
    arrange();
    const response = await post({ workspaceKey: SHARED });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "WORKSPACE_MEMBERSHIP_REQUIRED" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("clears the cookie when the caller chooses their own workspace, without a store read", async () => {
    const response = await post({ workspaceKey: MEMBER_OWN });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/tavonel_ws=;.*Max-Age=0/);
    expect(store.paths).toEqual([]);
  });

  it.each([
    [{}], [{ workspaceKey: 7 }], [{ workspaceKey: "pilot-../x" }], [["pilot-abc"]], [null], [{ workspaceKey: "x".repeat(2_000) }],
  ])("refuses a malformed body %j before any store read", async (body) => {
    const response = await post(body);
    expect([400, 413]).toContain(response.status);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(store.paths).toEqual([]);
  });

  it("refuses without a session and when the store is down (no cookie either way)", async () => {
    const anonymous = await post({ workspaceKey: SHARED }, null);
    expect(anonymous.status).toBe(401);
    store.down = true;
    const down = await post({ workspaceKey: SHARED });
    expect(down.status).toBe(503);
    expect(down.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET /api/workspaces/mine", () => {
  const get = (cookie?: string) => mine(request(cookie));

  it("lists the caller's active memberships through the public shape, and the acting one", async () => {
    store.billing = [{ workspace_key: SHARED, access_plan: "studio_access", plan_code: "team", subscription_status: "active", paddle_customer_id: "ctm_secret" }];
    const response = await get(`tavonel_ws=${SHARED}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      code: "OK",
      actingWorkspaceKey: SHARED,
      truncated: false,
      workspaces: [
        { workspaceKey: MEMBER_OWN, role: "owner", workspaceName: `${MEMBER_OWN} name`, ownerDisplayName: "Mina Member", planLabel: null, acting: false },
        { workspaceKey: SHARED, role: "member", workspaceName: `${SHARED} name`, ownerDisplayName: "Olivia Owner", planLabel: "Team", acting: true },
      ].sort((a, b) => a.workspaceKey.localeCompare(b.workspaceKey)),
    });
    // The owner's name and nothing else of the owner: no user id, no email, no other metadata.
    expect(JSON.stringify(body)).not.toContain("ctm_secret");
    expect(JSON.stringify(body)).not.toContain(OWNER);
    expect(JSON.stringify(body)).not.toContain("mail.test");
    expect(store.paths.filter((path) => path.startsWith("/auth/v1/admin/users/")).sort())
      .toEqual([`/auth/v1/admin/users/${OWNER}`, `/auth/v1/admin/users/${MEMBER}`].sort());
  });

  it("omits a revoked membership and labels no plan for a lapsed subscription", async () => {
    store.members[1] = row(SHARED, MEMBER, "member", "revoked", 2);
    store.billing = [{ workspace_key: MEMBER_OWN, access_plan: "observer_access", plan_code: "personal", subscription_status: "canceled" }];
    const body = await (await get(`tavonel_ws=${SHARED}`)).json();
    expect(body.actingWorkspaceKey).toBe(MEMBER_OWN);
    expect(body.workspaces).toEqual([{ workspaceKey: MEMBER_OWN, role: "owner", workspaceName: `${MEMBER_OWN} name`, ownerDisplayName: "Mina Member", planLabel: null, acting: true }]);
  });

  // The owner's name is what they typed at sign-up: hostile input, never echoed unbounded.
  it.each([
    ["no metadata at all", undefined],
    ["metadata that is not an object", "Olivia"],
    ["metadata that is an array", ["Olivia"]],
    ["no full_name", {}],
    ["an empty name", { full_name: "" }],
    ["a blank name", { full_name: " \t " }],
    ["a number", { full_name: 42 }],
    ["null", { full_name: null }],
    ["an object", { full_name: { first: "Olivia" } }],
    ["a name over 120 characters", { full_name: "O".repeat(121) }],
    ["a control character", { full_name: "Olivia\u0000Owner" }],
    ["a line break", { full_name: "Olivia\nOwner" }],
  ])("answers no owner name, not a guess, for %s", async (_label, metadata) => {
    store.authUsers[OWNER] = metadata;
    const body = await (await get(`tavonel_ws=${SHARED}`)).json();
    expect(body.code).toBe("OK");
    expect(body.workspaces.find((item: { workspaceKey: string }) => item.workspaceKey === SHARED).ownerDisplayName).toBeNull();
  });

  it("keeps a name of exactly 120 characters, trimmed", async () => {
    store.authUsers[OWNER] = { full_name: ` ${"O".repeat(120)} ` };
    const body = await (await get(`tavonel_ws=${SHARED}`)).json();
    expect(body.workspaces.find((item: { workspaceKey: string }) => item.workspaceKey === SHARED).ownerDisplayName).toBe("O".repeat(120));
  });

  it.each([
    ["the owner's auth user is missing (404)", () => { delete store.authUsers[OWNER]; }, "WORKSPACE_MEMBERSHIP_READ_FAILED"],
    ["Supabase Auth is unreachable", () => { store.authDown = true; }, "WORKSPACE_MEMBERSHIP_READ_FAILED"],
    ["a listed workspace has no active owner row", () => { store.members[0] = row(SHARED, OWNER, "owner", "revoked", 2); }, "WORKSPACE_MEMBERSHIP_STORE_INVALID"],
    ["a workspace answers two owner rows", () => { store.members.push(row(SHARED, STRANGER, "owner")); }, "WORKSPACE_MEMBERSHIP_STORE_INVALID"],
    ["an owner row carries a malformed user id", () => { store.members[0] = { ...row(SHARED, OWNER, "owner"), user_id: "../admin" }; }, "WORKSPACE_MEMBERSHIP_STORE_INVALID"],
  ])("fails closed when %s: a 503, never a list with the name quietly missing", async (_label, arrange, code) => {
    arrange();
    const response = await get(`tavonel_ws=${SHARED}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code });
  });

  it("fails closed on two paying accounts for one workspace and on a malformed store row", async () => {
    store.billing = [
      { workspace_key: SHARED, plan_code: "team", subscription_status: "active" },
      { workspace_key: SHARED, plan_code: "personal", subscription_status: "active" },
    ];
    expect((await get()).status).toBe(503);
    store.billing = [];
    store.members[1] = { ...row(SHARED, MEMBER, "member"), role: "superuser" };
    expect(await (await get()).json()).toEqual({ code: "WORKSPACE_MEMBERSHIP_STORE_INVALID" });
  });

  it("is 401 without a session and 503 when the store is down", async () => {
    store.user = null;
    expect((await get()).status).toBe(401);
    store.user = { id: MEMBER };
    store.down = true;
    expect((await get()).status).toBe(503);
  });
});

describe("session routes act in the resolved workspace", () => {
  const documentId = "doc-shared-1";
  const version = "ab".repeat(32);
  const objectFor = (workspace: string) => ({ key: `immutable/${workspace}/${workspace}/${documentId}/${version}/sanitized.pdf`, size: 20 });
  const read = (cookie?: string) => progress(request(cookie), { params: Promise.resolve({ id: documentId }) });

  beforeEach(() => {
    objects.list.mockReset().mockImplementation(async (_signer: unknown, workspace: string) => ({ ok: true, objects: [objectFor(workspace)] }));
    objects.viewer.mockReset().mockResolvedValue({ ok: true });
  });

  it("reads a document of the shared workspace for an active member, every store hop on that workspace", async () => {
    const response = await read(`tavonel_ws=${SHARED}`);
    expect(response.status).toBe(200);
    expect(objects.list.mock.calls.map((call) => call[1])).toEqual([SHARED]);
    expect(objects.viewer).toHaveBeenCalledWith(SHARED, [documentId], MEMBER);
  });

  it("reads the member's own workspace once the membership is revoked, and nothing of the shared one", async () => {
    store.members[1] = row(SHARED, MEMBER, "member", "revoked", 2);
    const response = await read(`tavonel_ws=${SHARED}`);
    expect(response.status).toBe(200);
    expect(objects.list.mock.calls.map((call) => call[1])).toEqual([MEMBER_OWN]);
    expect(JSON.stringify(await response.json())).not.toContain(SHARED);
  });

  it("refuses to release what it read when the membership is revoked during the request", async () => {
    objects.viewer.mockImplementation(async () => {
      store.members[1] = row(SHARED, MEMBER, "member", "revoked", 2);
      return { ok: true };
    });
    const response = await read(`tavonel_ws=${SHARED}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "AUTHORIZATION_CHANGED_RETRY" });
  });

  it("keeps rollback with owner and admin: a member acting in the shared workspace is refused by role", async () => {
    const body = JSON.stringify({
      operationId: "22222222-2222-4222-8222-222222222222",
      targetManifestDigest: `sha256:${"b".repeat(64)}`,
      expectedCurrentManifest: `sha256:${"a".repeat(64)}`,
      expectedCurrentRevision: 1,
      reason: "member rollback probe",
    });
    const response = await rollback(new Request("https://tavonel.test/api/collections/x/world/rollback", {
      method: "POST",
      headers: { authorization: "Bearer session-jwt", cookie: `tavonel_ws=${SHARED}`, "content-type": "application/json", "content-length": String(body.length) },
      body,
    }), { params: Promise.resolve({ id: `collection-${"c".repeat(32)}` }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "ROLLBACK_ROLE_REQUIRED" });
    expect(product.key).toHaveBeenCalledWith(SHARED, MEMBER, "activation", "member");
  });
});

describe("billing ignores the cookie", () => {
  it("reads the caller's own workspace for billing status even while acting in a shared one", async () => {
    const response = await billingStatus(new Request("https://tavonel.test/api/billing/status", {
      headers: { authorization: "Bearer session-jwt", cookie: `tavonel_ws=${SHARED}` },
    }));
    expect(response.status).toBe(200);
    expect(billingRoute.account).toHaveBeenCalledWith(MEMBER_OWN, MEMBER);
    expect(billingRoute.notices).toHaveBeenCalledWith(MEMBER_OWN, MEMBER);
    expect(membershipReads().every((path) => path.includes(`workspace_key=eq.${MEMBER_OWN}`))).toBe(true);
  });
});
