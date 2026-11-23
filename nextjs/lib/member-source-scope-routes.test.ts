import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-TRAIN-2: the two WO-C-T3 routes that route-classification checks only by a token in their file
  (collections/[id]/world and v1/runs/[runId]/events), driven through their real handlers. A member
  without scope is refused MEMBER_SOURCE_SCOPE_DENIED (403) before anything is read; an owner goes on
  to the read, so the refusal is the scope's, not the route's.

  The scope gate, the consumer-context binding and the source manifest parse are real; only the
  authorization, the store reads and the signature check are stubbed, as in member-source-scope.test.ts.
*/
const h = vi.hoisted(() => ({
  request: vi.fn(), config: vi.fn(), activeWorld: vi.fn(), versions: vi.fn(), loadCandidate: vi.fn(),
  signer: vi.fn(), authorize: vi.fn(), jobStatus: vi.fn(), jobEvents: vi.fn(),
}));
vi.mock("./supabase-admin", () => ({ supabaseAdminRequest: h.request, readSupabaseAdminConfig: h.config }));
vi.mock("./world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: h.activeWorld, listFoundationWorldVersions: h.versions,
}));
vi.mock("./collection-storage", () => ({ loadPreferredCollectionCandidate: h.loadCandidate }));
vi.mock("./r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()), readR2SignerEnv: h.signer,
}));
vi.mock("./collection-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./collection-download")>()),
  validateReviewableCollectionArtifact: (value: { package?: unknown }) => (value && value.package ? value : null),
}));
vi.mock("./developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()), authorizeFoundationRequest: h.authorize,
}));
vi.mock("./job-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./job-store")>()), getJobStatus: h.jobStatus, listJobEvents: h.jobEvents,
}));

import { GET as collectionWorld } from "../app/api/collections/[id]/world/route";
import { GET as runEvents } from "../app/api/v1/runs/[runId]/events/route";

const WS = "pilot-acme01";
const MEMBER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const OWNER = "11111111-1111-4111-8111-111111111111";
const D1 = "00000001-d0c0-4d0c-8d0c-d0c0d0c0d0c0";
const COLLECTION = `collection-${"ab".repeat(16)}`;
const DIGEST = `sha256:${"a".repeat(64)}`;
const RUN = "run-0001";
const principal = (role: "owner" | "member") => ({
  kind: "api-key" as const, workspaceKey: WS, userId: role === "member" ? MEMBER : OWNER,
  scopes: ["worlds:read", "documents:read"], authorizationRevision: 1, workspaceRole: role,
});
const get = (path: string) => new Request(`https://tavonel.test${path}`, { headers: { authorization: "Bearer tvnl_live_x" } });
const routeParams = <T,>(value: T) => ({ params: Promise.resolve(value) });
const rpcPaths = () => h.request.mock.calls.map((call) => String(call[1]).replace("/rest/v1/rpc/", ""));

beforeEach(() => {
  vi.resetAllMocks();
  h.config.mockReturnValue({});
  h.signer.mockReturnValue({ accountId: "a", accessKeyId: "i", secretAccessKey: "s", bucket: "b" });
  h.activeWorld.mockResolvedValue({ ok: true, world: { manifestDigest: DIGEST, collectionId: COLLECTION } });
  h.versions.mockResolvedValue({ ok: true, versions: [] });
  h.loadCandidate.mockResolvedValue({ ok: true, value: { key: "k", artifact: { package: { files: [
    { path: "source/collection-files.json", content: JSON.stringify([{ documentId: D1 }]) },
    { path: "rag/documents.jsonl", content: JSON.stringify({ documentId: D1 }) },
  ] } } } });
  h.jobStatus.mockResolvedValue({ ok: false, code: "JOB_NOT_FOUND" });
  // A member without scope: every source is outside it.
  h.request.mockImplementation(async (_config: unknown, path: string) =>
    path === "/rest/v1/rpc/documents_outside_member_scope" ? Response.json(true) : new Response("no such rpc", { status: 404 }));
});

describe("collections/[id]/world", () => {
  it("refuses a member without scope with MEMBER_SOURCE_SCOPE_DENIED (403), before the versions are read", async () => {
    h.authorize.mockResolvedValue({ ok: true, principal: principal("member") });
    const response = await collectionWorld(get(`/api/collections/${COLLECTION}/world`), routeParams({ id: COLLECTION }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rpcPaths()).toEqual(["documents_outside_member_scope"]);
    expect(h.versions).not.toHaveBeenCalled();
  });

  it("serves an owner the World with no scope read", async () => {
    h.authorize.mockResolvedValue({ ok: true, principal: principal("owner") });
    const response = await collectionWorld(get(`/api/collections/${COLLECTION}/world`), routeParams({ id: COLLECTION }));
    expect(response.status).toBe(200);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.versions).toHaveBeenCalledOnce();
  });
});

describe("v1/runs/[runId]/events", () => {
  it("refuses a member with MEMBER_SOURCE_SCOPE_DENIED (403), before the run is looked up", async () => {
    h.authorize.mockResolvedValue({ ok: true, principal: principal("member") });
    const response = await runEvents(get(`/api/v1/runs/${RUN}/events`), routeParams({ runId: RUN }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(h.jobStatus).not.toHaveBeenCalled();
    expect(h.jobEvents).not.toHaveBeenCalled();
  });

  it("lets an owner through to the run lookup", async () => {
    h.authorize.mockResolvedValue({ ok: true, principal: principal("owner") });
    const response = await runEvents(get(`/api/v1/runs/${RUN}/events`), routeParams({ runId: RUN }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "JOB_NOT_FOUND" });
    expect(h.jobStatus).toHaveBeenCalledWith(WS, RUN);
  });
});
