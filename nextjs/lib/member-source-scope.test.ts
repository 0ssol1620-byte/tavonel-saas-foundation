import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-C-T3: a member reads only the sources an owner/admin put in their scope (nothing by default),
  and a World only when every source behind it is in scope. The database answers every call; these
  tests hold the server side to that: asked first, never cached, anything but a boolean is a refusal,
  owners and admins unchanged, lists drop what a member cannot read without naming it.

  The package path is the real one: a stored candidate's source manifest is read by the real
  collectionSourceDocumentIds; only the store reads and the signature check are stubbed.
*/
const h = vi.hoisted(() => ({
  request: vi.fn(), config: vi.fn(), activeWorld: vi.fn(), listWorlds: vi.fn(), loadCandidate: vi.fn(),
  signer: vi.fn(), authorize: vi.fn(), readModel: vi.fn(), membership: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("./supabase-admin", () => ({ supabaseAdminRequest: h.request, readSupabaseAdminConfig: h.config }));
vi.mock("./world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: h.activeWorld, listFoundationActiveWorlds: h.listWorlds,
}));
vi.mock("./collection-storage", () => ({ loadPreferredCollectionCandidate: h.loadCandidate }));
vi.mock("./r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()), readR2SignerEnv: h.signer,
}));
// The signature check is the route's concern and is covered elsewhere; here a package is reviewable when it has files.
vi.mock("./collection-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./collection-download")>()),
  validateReviewableCollectionArtifact: (value: { package?: unknown }) => (value && value.package ? value : null),
}));
vi.mock("./developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()), authorizeFoundationRequest: h.authorize,
}));
vi.mock("./world-read-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-read-model")>()), loadWorldReadModel: h.readModel,
}));
vi.mock("./workspace-membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-membership")>()),
  requireWorkspaceMembership: h.membership, revalidateWorkspaceMembership: h.revalidate,
}));

import { checkConnectorSourceAccessForViewer, checkMemberSourceScope } from "./connector-source-access";
import { filterMemberReadableDocumentIds, memberCollectionScopeRefusal, memberSourcesRefusal } from "./member-source-scope";
import { GET as worldRead } from "../app/api/v1/world/[id]/route";
import { GET as lensRead } from "../app/api/v1/world/[id]/[lens]/route";
import { GET as listCollections } from "../app/api/v1/collections/route";
import { GET as readScope, PUT as writeScope } from "../app/api/workspaces/[workspaceKey]/members/[userId]/sources/route";

const WS = "pilot-acme01";
const MEMBER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const OWNER = "11111111-1111-4111-8111-111111111111";
const D1 = "00000001-d0c0-4d0c-8d0c-d0c0d0c0d0c0";
const D2 = "00000002-d0c0-4d0c-8d0c-d0c0d0c0d0c0";
const COLLECTION = "col-alpha";
const DIGEST = `sha256:${"a".repeat(64)}`;
const viewer = (role: string, userId = MEMBER) => ({ workspaceKey: WS, userId, workspaceRole: role });
const principal = (role: "owner" | "admin" | "member") => ({
  kind: "api-key" as const, workspaceKey: WS, userId: role === "member" ? MEMBER : OWNER,
  scopes: ["worlds:read", "collections:read"], authorizationRevision: 1, workspaceRole: role,
});
/** A stored candidate whose source manifest names these product documents (the shape the TS compiler writes). */
const pkg = (...documentIds: string[]) => ({ package: { files: [
  { path: "source/collection-files.json", content: JSON.stringify(documentIds.map((documentId) => ({ documentId }))) },
  { path: "rag/documents.jsonl", content: documentIds.map((documentId) => JSON.stringify({ documentId })).join("\n") },
] } });
/** Route the RPC mock by path; an unknown path is a failure the code must not treat as an answer. */
function rpc(answers: Record<string, unknown>) {
  h.request.mockImplementation(async (_config: unknown, path: string, init?: RequestInit) => {
    const name = path.replace("/rest/v1/rpc/", "");
    const answer = answers[name];
    if (typeof answer === "function") return answer(JSON.parse(String(init?.body ?? "{}")));
    return answer === undefined ? new Response("no such rpc", { status: 404 }) : Response.json(answer);
  });
}
const paths = () => h.request.mock.calls.map((call) => String(call[1]).replace("/rest/v1/rpc/", ""));
const routeParams = <T,>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TAVONEL_GOOGLE_VIEWER_LINK_ENABLED", "true");
  vi.stubEnv("TAVONEL_GOOGLE_DRIVE_ACL_MAX_AGE_SECONDS", "");
  h.config.mockReturnValue({});
  h.signer.mockReturnValue({ accountId: "a", accessKeyId: "i", secretAccessKey: "s", bucket: "b" });
  h.activeWorld.mockResolvedValue({ ok: true, world: { manifestDigest: DIGEST, collectionId: COLLECTION } });
  h.loadCandidate.mockResolvedValue({ ok: true, value: { key: "k", artifact: pkg(D1, D2) } });
});

describe("the chokepoint asks the member scope first", () => {
  it("refuses a source outside the scope before any connector or legacy path, with the caller's 403 code", async () => {
    rpc({ documents_outside_member_scope: true, connector_documents_blocked_for_viewer: false, connector_documents_blocked: false });
    await expect(checkConnectorSourceAccessForViewer(WS, [D1], MEMBER)).resolves.toEqual({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(paths()).toEqual(["documents_outside_member_scope"]);
    // The legacy fallback (flag off) is behind it too.
    vi.stubEnv("TAVONEL_GOOGLE_VIEWER_LINK_ENABLED", "false");
    h.request.mockClear();
    await expect(checkConnectorSourceAccessForViewer(WS, [D1], MEMBER)).resolves.toEqual({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(paths()).toEqual(["documents_outside_member_scope"]);
  });

  it.each([
    ["an error status", () => new Response("down", { status: 500 })],
    ["a non-boolean body", () => Response.json("false")],
    ["null", () => Response.json(null)],
    ["a thrown transport error", () => { throw new Error("socket"); }],
  ])("treats %s from the scope store as unavailable, never as allowed", async (_label, answer) => {
    rpc({ documents_outside_member_scope: answer, connector_documents_blocked_for_viewer: false, connector_documents_blocked: false });
    await expect(checkConnectorSourceAccessForViewer(WS, [D1], MEMBER)).resolves.toEqual({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    expect(paths()).toEqual(["documents_outside_member_scope"]);
  });

  it("sends the principal's user id and the de-duplicated ids, and admits only on false", async () => {
    rpc({ documents_outside_member_scope: false, connector_documents_blocked_for_viewer: false });
    await expect(checkConnectorSourceAccessForViewer(WS, [D1, D1, D2], MEMBER)).resolves.toEqual({ ok: true });
    expect(JSON.parse(String(h.request.mock.calls[0]![2]?.body))).toEqual({ p_workspace_key: WS, p_user_id: MEMBER, p_document_ids: [D1, D2] });
  });

  it("asks again on every request: a scope narrowed mid-session refuses the next call", async () => {
    let outside = false;
    rpc({ documents_outside_member_scope: () => Response.json(outside), connector_documents_blocked_for_viewer: false });
    await expect(checkMemberSourceScope(WS, MEMBER, [D1])).resolves.toEqual({ ok: true });
    outside = true;
    await expect(checkMemberSourceScope(WS, MEMBER, [D1])).resolves.toEqual({ ok: false, code: "MEMBER_SOURCE_SCOPE_DENIED" });
    expect(paths()).toEqual(["documents_outside_member_scope", "documents_outside_member_scope"]);
  });

  it("refuses hostile input before asking anything", async () => {
    rpc({ documents_outside_member_scope: false });
    for (const [workspace, user, ids] of [
      ["../pilot-acme01", MEMBER, [D1]], [WS, "member", [D1]], [WS, MEMBER, ["../x"]],
      [WS, MEMBER, Array.from({ length: 2001 }, (_, i) => `doc-${i}`)],
    ] as const) {
      await expect(checkMemberSourceScope(workspace, user, ids)).resolves.toEqual({ ok: false, code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE" });
    }
    expect(h.request).not.toHaveBeenCalled();
  });
});

describe("lists drop what a member cannot read", () => {
  it("answers owners and admins from the input without a round trip", async () => {
    for (const role of ["owner", "admin"]) {
      const result = await filterMemberReadableDocumentIds(viewer(role), [D1, D2]);
      expect(result).toEqual({ ok: true, documentIds: new Set([D1, D2]) });
    }
    expect(h.request).not.toHaveBeenCalled();
  });

  it("asks the database for a member, and for any role it does not know", async () => {
    rpc({ member_readable_document_ids: [D2] });
    await expect(filterMemberReadableDocumentIds(viewer("member"), [D1, D2])).resolves.toEqual({ ok: true, documentIds: new Set([D2]) });
    await expect(filterMemberReadableDocumentIds(viewer("viewer"), [D1, D2])).resolves.toEqual({ ok: true, documentIds: new Set([D2]) });
    expect(paths()).toEqual(["member_readable_document_ids", "member_readable_document_ids"]);
  });

  it.each([
    ["an id it was not asked about", [D1, "other-doc"]],
    ["a non-array", { ids: [D1] }],
    ["a non-string id", [1]],
  ])("refuses an answer naming %s", async (_label, answer) => {
    rpc({ member_readable_document_ids: answer });
    await expect(filterMemberReadableDocumentIds(viewer("member"), [D1, D2])).resolves.toEqual({ ok: false, code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE" });
  });
});

describe("the World gate", () => {
  it("lets owners and admins through without reading anything", async () => {
    await expect(memberCollectionScopeRefusal(viewer("owner"), COLLECTION)).resolves.toBeNull();
    await expect(memberCollectionScopeRefusal(viewer("admin"), COLLECTION, DIGEST)).resolves.toBeNull();
    await expect(memberSourcesRefusal(viewer("admin"), [D1])).resolves.toBeNull();
    expect(h.activeWorld).not.toHaveBeenCalled();
    expect(h.loadCandidate).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });

  it("checks every source the active World's package names", async () => {
    rpc({ documents_outside_member_scope: (body: { p_document_ids: string[] }) => Response.json(body.p_document_ids.includes(D2)) });
    await expect(memberCollectionScopeRefusal(viewer("member"), COLLECTION)).resolves.toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED", status: 403 });
    expect(h.loadCandidate).toHaveBeenCalledWith(expect.anything(), WS, COLLECTION, DIGEST);
    expect(JSON.parse(String(h.request.mock.calls[0]![2]?.body)).p_document_ids).toEqual([D1, D2]);
    h.loadCandidate.mockResolvedValue({ ok: true, value: { key: "k", artifact: pkg(D1) } });
    await expect(memberCollectionScopeRefusal(viewer("member"), COLLECTION)).resolves.toBeNull();
  });

  it("checks the named version, not the active one", async () => {
    rpc({ documents_outside_member_scope: false });
    const other = `sha256:${"b".repeat(64)}`;
    await expect(memberCollectionScopeRefusal(viewer("member"), COLLECTION, other)).resolves.toBeNull();
    expect(h.activeWorld).not.toHaveBeenCalled();
    expect(h.loadCandidate).toHaveBeenCalledWith(expect.anything(), WS, COLLECTION, other);
  });

  it("refuses a World whose sources cannot be established, and is unavailable when a store cannot answer", async () => {
    rpc({ documents_outside_member_scope: false });
    h.loadCandidate.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
    await expect(memberCollectionScopeRefusal(viewer("member"), COLLECTION)).resolves.toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED", status: 403 });
    h.loadCandidate.mockResolvedValueOnce({ ok: true, value: { key: "k", artifact: { package: { files: [] } } } });
    await expect(memberCollectionScopeRefusal(viewer("member"), COLLECTION)).resolves.toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED", status: 403 });
    h.loadCandidate.mockResolvedValueOnce({ ok: false, code: "R2_READ_FAILED" });
    await expect(memberCollectionScopeRefusal(viewer("member"), COLLECTION)).resolves.toEqual({ code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE", status: 503 });
    h.activeWorld.mockResolvedValueOnce({ ok: false, code: "WORLD_STORE_READ_FAILED" });
    await expect(memberCollectionScopeRefusal(viewer("member"), COLLECTION)).resolves.toEqual({ code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE", status: 503 });
    h.signer.mockReturnValueOnce(null);
    await expect(memberCollectionScopeRefusal(viewer("member"), COLLECTION)).resolves.toEqual({ code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE", status: 503 });
    rpc({ documents_outside_member_scope: () => new Response("down", { status: 503 }) });
    await expect(memberCollectionScopeRefusal(viewer("member"), COLLECTION)).resolves.toEqual({ code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE", status: 503 });
  });
});

describe("World routes", () => {
  const model = { world: { id: COLLECTION }, evidence: [{ id: "ev-1" }], objects: [], relations: [], history: [], files: [], review: {}, freshness: {} };
  const get = (path: string) => new Request(`https://tavonel.test${path}`, { headers: { authorization: "Bearer tvnl_live_x" } });

  it("refuses a member a World or a lens with one source out of scope, before the World is read", async () => {
    h.authorize.mockResolvedValue({ ok: true, principal: principal("member") });
    rpc({ documents_outside_member_scope: true });
    const world = await worldRead(get(`/api/v1/world/${COLLECTION}`), routeParams({ id: COLLECTION }));
    expect(world.status).toBe(403);
    expect(await world.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED" });
    const lens = await lensRead(get(`/api/v1/world/${COLLECTION}/evidence`), routeParams({ id: COLLECTION, lens: "evidence" }));
    expect(lens.status).toBe(403);
    expect(await lens.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED" });
    expect(h.readModel).not.toHaveBeenCalled();
  });

  it("serves a member a World whose sources are all in scope, and a scope store outage is a 503", async () => {
    h.authorize.mockResolvedValue({ ok: true, principal: principal("member") });
    h.readModel.mockResolvedValue({ ok: true, model });
    rpc({ documents_outside_member_scope: false });
    expect((await worldRead(get(`/api/v1/world/${COLLECTION}`), routeParams({ id: COLLECTION }))).status).toBe(200);
    rpc({ documents_outside_member_scope: () => new Response("down", { status: 500 }) });
    const down = await worldRead(get(`/api/v1/world/${COLLECTION}`), routeParams({ id: COLLECTION }));
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE" });
  });

  it("leaves an owner's read exactly as it was: no scope read at all", async () => {
    h.authorize.mockResolvedValue({ ok: true, principal: principal("owner") });
    h.readModel.mockResolvedValue({ ok: true, model });
    const response = await worldRead(get(`/api/v1/world/${COLLECTION}`), routeParams({ id: COLLECTION }));
    expect(response.status).toBe(200);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.loadCandidate).not.toHaveBeenCalled();
  });

  it("lists to a member only the Worlds in scope, with no count and a cursor that is a returned id", async () => {
    h.authorize.mockResolvedValue({ ok: true, principal: principal("member") });
    const row = (collectionId: string) => ({ collectionId, manifestDigest: `sha256:${collectionId.slice(-1).repeat(64)}`, revision: 1, updatedAt: "t" });
    h.listWorlds.mockResolvedValueOnce({ ok: true, worlds: [row("col-a"), row("col-b"), row("col-c")], nextCursor: "col-c" })
      .mockResolvedValueOnce({ ok: true, worlds: [row("col-d"), row("col-e")], nextCursor: null });
    // b and c are out of scope: their packages name D2.
    h.loadCandidate.mockImplementation(async (_s: unknown, _w: string, id: string) =>
      ({ ok: true, value: { key: id, artifact: ["col-b", "col-c"].includes(id) ? pkg(D1, D2) : pkg(D1) } }));
    rpc({ documents_outside_member_scope: (body: { p_document_ids: string[] }) => Response.json(body.p_document_ids.includes(D2)) });
    const page = await listCollections(get("/api/v1/collections?limit=2"));
    const body = await page.json();
    expect(body.collections.map((c: { collectionId: string }) => c.collectionId)).toEqual(["col-a", "col-d"]);
    expect(body.page.nextCursor).toBe("col-d");
    const text = JSON.stringify(body);
    expect(text).not.toContain("col-b");
    expect(text).not.toContain("col-c");
    expect(text).not.toMatch(/"total"|"count"/);
  });

  it("gives an owner the store's page unchanged", async () => {
    h.authorize.mockResolvedValue({ ok: true, principal: principal("owner") });
    h.listWorlds.mockResolvedValue({ ok: true, worlds: [{ collectionId: "col-b" }], nextCursor: "col-b" });
    const body = await (await listCollections(get("/api/v1/collections?limit=1"))).json();
    expect(body.collections).toEqual([{ collectionId: "col-b" }]);
    expect(body.page.nextCursor).toBe("col-b");
    expect(h.request).not.toHaveBeenCalled();
  });
});

describe("GET/PUT /api/workspaces/{workspaceKey}/members/{userId}/sources", () => {
  const manager = { ok: true, principal: { userId: OWNER, workspaceKey: WS, role: "owner", authorizationRevision: 1 } };
  const put = (body: unknown, key: string | null = "scope_put_key_00000001") => new Request(`https://tavonel.test/api/workspaces/${WS}/members/${MEMBER}/sources`, {
    method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { authorization: "Bearer jwt", "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
  });
  const ctx = routeParams({ workspaceKey: WS, userId: MEMBER });

  beforeEach(() => {
    h.membership.mockResolvedValue(manager);
    h.revalidate.mockResolvedValue(manager);
  });

  it("replaces a member's scope through the owner/admin RPC and answers the public shape", async () => {
    rpc({ set_member_source_scope: (body: Record<string, unknown>) => Response.json({
      workspaceKey: WS, userId: MEMBER, kind: "listed", documentCount: 2, digest: "sha256:x", idempotentReplay: false, _body: body,
    }) });
    const response = await writeScope(put({ kind: "listed", documentIds: [D1, D2, D1] }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE_SET", scope: { userId: MEMBER, kind: "listed", documentCount: 2 }, idempotentReplay: false });
    expect(JSON.parse(String(h.request.mock.calls[0]![2]?.body))).toEqual({
      p_workspace_key: WS, p_actor_user_id: OWNER, p_member_user_id: MEMBER, p_kind: "listed",
      p_document_ids: [D1, D2], p_request_id: "scope-put:scope_put_key_00000001",
    });
    expect(h.membership).toHaveBeenCalledWith(expect.any(Request), WS, ["owner", "admin"]);
  });

  it.each([
    ["no idempotency key", { kind: "all" }, null, 400, "IDEMPOTENCY_KEY_INVALID"],
    ["a short idempotency key", { kind: "all" }, "short", 400, "IDEMPOTENCY_KEY_INVALID"],
    ["all with ids", { kind: "all", documentIds: [D1] }, undefined, 400, "MEMBER_SOURCE_SCOPE_INPUT_INVALID"],
    ["listed without ids", { kind: "listed" }, undefined, 400, "MEMBER_SOURCE_SCOPE_INPUT_INVALID"],
    ["an unknown kind", { kind: "none" }, undefined, 400, "MEMBER_SOURCE_SCOPE_INPUT_INVALID"],
    ["an extra field", { kind: "all", role: "admin" }, undefined, 400, "MEMBER_SOURCE_SCOPE_INPUT_INVALID"],
    ["a non-uuid id", { kind: "listed", documentIds: ["../etc"] }, undefined, 400, "MEMBER_SOURCE_SCOPE_INPUT_INVALID"],
    ["an upper-case id", { kind: "listed", documentIds: [D1.toUpperCase()] }, undefined, 400, "MEMBER_SOURCE_SCOPE_INPUT_INVALID"],
    ["2,001 ids", { kind: "listed", documentIds: Array.from({ length: 2001 }, () => D1) }, undefined, 400, "MEMBER_SOURCE_SCOPE_INPUT_INVALID"],
    ["a non-object body", [], undefined, 400, "MEMBER_SOURCE_SCOPE_INPUT_INVALID"],
    ["broken JSON", "{", undefined, 400, "INVALID_JSON"],
  ] as const)("refuses %s without writing", async (_label, body, key, status, code) => {
    rpc({ set_member_source_scope: { userId: MEMBER, kind: "all", documentCount: 0, idempotentReplay: false } });
    const response = await writeScope(put(body, key === undefined ? "scope_put_key_00000001" : key), ctx);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(h.request).not.toHaveBeenCalled();
  });

  it.each([
    ["member_source_scope_target_forbidden", 409, "MEMBER_SOURCE_SCOPE_TARGET_FORBIDDEN"],
    ["member_source_scope_idempotency_conflict", 409, "MEMBER_SOURCE_SCOPE_IDEMPOTENCY_CONFLICT"],
    ["member_source_scope_forbidden", 403, "MEMBER_SOURCE_SCOPE_FORBIDDEN"],
    ["workspace_member_not_found", 404, "WORKSPACE_MEMBER_NOT_FOUND"],
    ["something else", 503, "MEMBER_SOURCE_SCOPE_UNAVAILABLE"],
  ])("maps the database's %s", async (message, status, code) => {
    rpc({ set_member_source_scope: () => Response.json({ message }, { status: 400 }) });
    const response = await writeScope(put({ kind: "all" }), ctx);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
  });

  it("refuses a store answer that does not match what was asked", async () => {
    rpc({ set_member_source_scope: { userId: MEMBER, kind: "listed", documentCount: 1, idempotentReplay: false } });
    const response = await writeScope(put({ kind: "listed", documentIds: [D1, D2] }), ctx);
    expect(response.status).toBe(503);
  });

  it("refuses a member before anything is read or written", async () => {
    h.membership.mockResolvedValue({ ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 });
    expect((await writeScope(put({ kind: "all" }), ctx)).status).toBe(403);
    expect((await readScope(new Request("https://tavonel.test/x"), ctx)).status).toBe(403);
    expect(h.request).not.toHaveBeenCalled();
  });

  it("reads a scope back as the public DTO, and refuses a malformed store answer", async () => {
    rpc({ get_member_source_scope: { workspaceKey: WS, userId: MEMBER, kind: "listed", documentIds: [D1] } });
    const response = await readScope(new Request("https://tavonel.test/x"), ctx);
    expect(await response.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE", scope: { userId: MEMBER, kind: "listed", documentIds: [D1] } });
    for (const bad of [
      { userId: OWNER, kind: "listed", documentIds: [D1] }, { userId: MEMBER, kind: "some", documentIds: [] },
      { userId: MEMBER, kind: "none", documentIds: [D1] }, { userId: MEMBER, kind: "listed", documentIds: [] },
      { userId: MEMBER, kind: "listed", documentIds: ["x"] },
    ]) {
      rpc({ get_member_source_scope: bad });
      expect((await readScope(new Request("https://tavonel.test/x"), ctx)).status).toBe(503);
    }
  });
});
