import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The routes audit X01, X06, TM06 and R4-01 add, driven as HTTP.

  What each one is for:

    GET  /v1/collections                        discovery, keyset paged, scoped by the credential
    GET  /v1/world/{id}/{lens}?limit&cursor     a bounded read of a lens that used to be unbounded
    GET  /v1/world/{id}/manifest-status?digest  is the copy I hold still the active one
    POST /v1/collections/{id}/retrieval-index   rebuild the derived index, owner or admin only

  The two properties worth a test each are the ones that would be invisible in production: that
  the workspace comes from the principal and not from anything a caller can send, and that a
  request the endpoint cannot honour is refused rather than answered approximately.
*/

const { authorize, listWorlds, manifestStatus, readModel, activeWorld, pilot, ensureIndex, readIndexState, candidate, productAccess } =
  vi.hoisted(() => ({
    authorize: vi.fn(),
    listWorlds: vi.fn(),
    manifestStatus: vi.fn(),
    readModel: vi.fn(),
    activeWorld: vi.fn(),
    pilot: vi.fn(),
    ensureIndex: vi.fn(),
    readIndexState: vi.fn(),
    candidate: vi.fn(),
    productAccess: vi.fn(),
  }));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
}));
// The index rebuild takes the activation plan-and-role bar promotion takes, so it asks this too.
// Admitted here; *which* plans and roles it admits is `world-activation-plan-gate.test.ts`.
vi.mock("@/lib/billing-product-access", () => ({ authorizeFoundationProduct: productAccess }));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  listFoundationActiveWorlds: listWorlds,
  getManifestActivationStatus: manifestStatus,
  getFoundationActiveWorld: activeWorld,
}));
vi.mock("@/lib/world-read-model", () => ({ loadWorldReadModel: readModel }));
vi.mock("@/lib/foundation-pilot", () => ({ foundationPilotAccess: pilot, getRequestUser: vi.fn() }));
vi.mock("@/lib/retrieval-index-status", () => ({
  ensureRetrievalIndexForActiveWorld: ensureIndex,
  readRetrievalIndexState: readIndexState,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }) }));
/*
  The FD-02 self-serve ceiling, passed through: it is asserted in
  `lib/activation-rate-limit.test.ts` and exercised per route in
  `lib/world-activation-plan-gate.test.ts`, and a limiter that read the audit tables from here
  would answer every case with a transport error instead of the behaviour under test.
*/
vi.mock("@/lib/activation-rate-limit", () => ({ checkActivationRateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  getWorkspaceCollectionCandidate: candidate,
}));

import { GET as listCollections } from "../app/api/v1/collections/route";
import { GET as getLens } from "../app/api/v1/world/[id]/[lens]/route";
import { GET as getManifestStatus } from "../app/api/v1/world/[id]/manifest-status/route";
import { POST as recompileIndex } from "../app/api/v1/collections/[id]/retrieval-index/route";
import { EMPTY_WORLD_FRESHNESS } from "./world-store";

const WORKSPACE = "pilot-acme01";
const USER = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const COLLECTION = `collection-${"a".repeat(32)}`;
const MANIFEST = `sha256:${"1".repeat(64)}`;
const params = Promise.resolve({ id: COLLECTION });

function request(path: string) {
  return new Request(`https://tavonel.test${path}`, {
    headers: { authorization: "Bearer tvnl_live_probe" },
  });
}

function objectsModel(count: number) {
  return {
    world: { id: COLLECTION, manifestDigest: MANIFEST, status: "active", revision: { state: "read", value: 1 } },
    contract: { origin: "compiled_artifact", deterministicSample: false, realObjectsOnly: true, missingData: "not_yet" },
    freshness: { ...EMPTY_WORLD_FRESHNESS, activeManifestDigest: MANIFEST },
    objects: Array.from({ length: count }, (_, index) => ({ id: `claim-${String(index).padStart(32, "0")}` })),
    relations: [],
    evidence: [],
    history: [{ version: "v1" }],
    files: [{ path: "canonical/model.json" }],
    review: { state: "not_yet" },
    signature: { state: "not_yet", reason: "unsigned" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({
    ok: true,
    principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: USER, keyId: "key-1", scopes: [] },
  });
  pilot.mockReturnValue({ membership: { workspaceId: WORKSPACE, role: "owner" } });
  productAccess.mockResolvedValue({ ok: true, source: "paid", billingExempt: false });
  listWorlds.mockResolvedValue({ ok: true, worlds: [{ collectionId: COLLECTION, manifestDigest: MANIFEST, revision: 1, updatedAt: "2026-09-11T00:00:00.000Z" }], nextCursor: null });
  manifestStatus.mockResolvedValue({ ok: true, status: { collectionId: COLLECTION, manifestDigest: MANIFEST, active: true, activeManifestDigest: MANIFEST, knownToWorkspace: true, lifecycleStatus: "active", activatedAt: "2026-09-10T00:00:00.000Z" } });
  readModel.mockResolvedValue({ ok: true, model: objectsModel(5) });
  activeWorld.mockResolvedValue({ ok: true, world: { manifestDigest: MANIFEST, revision: 1, worldStateId: "ws-1", candidateObjectKey: "immutable/x" } });
  candidate.mockResolvedValue({ ok: true, json: { collectionId: COLLECTION, manifestDigest: MANIFEST } });
  readIndexState.mockResolvedValue({ status: "missing", errorClass: null, runId: null, retrievalProfileId: "bge-m3-v1" });
  ensureIndex.mockResolvedValue({ status: "compiled", errorClass: null, runId: "retrieval-run-1", retrievalProfileId: "bge-m3-v1" });
});

describe("GET /v1/collections", () => {
  it("lists the credential's own workspace and ignores anything the caller sends", async () => {
    const response = await listCollections(request("/api/v1/collections?workspace=pilot-rival9&limit=10"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.code).toBe("COLLECTIONS_LISTED");
    expect(body.page).toEqual({ limit: 10, cursor: null, nextCursor: null });
    // The only workspace that reaches the store is the principal's. `?workspace=` is not a
    // parameter this endpoint has, so it cannot be one it honours.
    expect(listWorlds).toHaveBeenCalledWith(WORKSPACE, { limit: 10, cursor: null });
  });

  it("refuses a limit or cursor it cannot honour", async () => {
    expect((await listCollections(request("/api/v1/collections?limit=500"))).status).toBe(400);
    expect((await listCollections(request("/api/v1/collections?limit=abc"))).status).toBe(400);
    expect((await listCollections(request("/api/v1/collections?cursor=../../x"))).status).toBe(400);
    expect(listWorlds).not.toHaveBeenCalled();
  });

  it("passes the store's failure through as a 503 rather than an empty list", async () => {
    listWorlds.mockResolvedValue({ ok: false, code: "WORLD_STORE_READ_FAILED" });
    const response = await listCollections(request("/api/v1/collections"));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("WORLD_STORE_READ_FAILED");
  });
});

describe("GET /v1/world/{id}/{lens}", () => {
  it("returns the whole lens when no page is asked for, and says so", async () => {
    const response = await getLens(request(`/api/v1/world/${COLLECTION}/objects`), {
      params: Promise.resolve({ id: COLLECTION, lens: "objects" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.objects).toHaveLength(5);
    // `limit: null` is how a client tells a whole-lens answer from page one of a paged one.
    expect(body.page).toEqual({ limit: null, cursor: null, nextCursor: null, total: 5 });
    expect(body.freshness.activeManifestDigest).toBe(MANIFEST);
  });

  it("pages with a keyset cursor and walks to the end", async () => {
    const page = async (query: string) =>
      (await (await getLens(request(`/api/v1/world/${COLLECTION}/objects${query}`), {
        params: Promise.resolve({ id: COLLECTION, lens: "objects" }),
      })).json());

    const first = await page("?limit=2");
    expect(first.objects.map((item: { id: string }) => item.id)).toEqual([
      `claim-${"0".repeat(32)}`,
      `claim-${"0".repeat(31)}1`,
    ]);
    expect(first.page.nextCursor).toBe(`claim-${"0".repeat(31)}1`);

    const second = await page(`?limit=2&cursor=${first.page.nextCursor}`);
    expect(second.objects).toHaveLength(2);
    const third = await page(`?limit=2&cursor=${second.page.nextCursor}`);
    expect(third.objects).toHaveLength(1);
    expect(third.page.nextCursor).toBeNull();
  });

  it("refuses an unknown cursor rather than reporting the end of the list", async () => {
    // An unrecognised cursor answered with an empty page is a silent truncation.
    const response = await getLens(request(`/api/v1/world/${COLLECTION}/objects?limit=2&cursor=claim-${"f".repeat(32)}`), {
      params: Promise.resolve({ id: COLLECTION, lens: "objects" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("WORLD_PAGE_CURSOR_INVALID");
  });

  it("refuses a page of a lens that has none, and a cursor with no limit", async () => {
    const history = await getLens(request(`/api/v1/world/${COLLECTION}/history?limit=2`), {
      params: Promise.resolve({ id: COLLECTION, lens: "history" }),
    });
    expect(history.status).toBe(400);
    expect((await history.json()).code).toBe("WORLD_LENS_NOT_PAGEABLE");

    const cursorOnly = await getLens(request(`/api/v1/world/${COLLECTION}/objects?cursor=claim-${"0".repeat(32)}`), {
      params: Promise.resolve({ id: COLLECTION, lens: "objects" }),
    });
    expect(cursorOnly.status).toBe(400);
    expect((await cursorOnly.json()).code).toBe("WORLD_PAGE_LIMIT_INVALID");

    const tooLarge = await getLens(request(`/api/v1/world/${COLLECTION}/objects?limit=51`), {
      params: Promise.resolve({ id: COLLECTION, lens: "objects" }),
    });
    expect(tooLarge.status).toBe(400);
  });
});

describe("GET /v1/world/{id}/manifest-status", () => {
  it("answers whether the held digest is the active one", async () => {
    const response = await getManifestStatus(request(`/api/v1/world/${COLLECTION}/manifest-status?digest=${MANIFEST}`), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.code).toBe("MANIFEST_STATUS");
    expect(body.manifestStatus.active).toBe(true);
    expect(manifestStatus).toHaveBeenCalledWith(WORKSPACE, COLLECTION, MANIFEST);
  });

  it("requires a digest and refuses a malformed one", async () => {
    expect((await getManifestStatus(request(`/api/v1/world/${COLLECTION}/manifest-status`), { params })).status).toBe(400);
    expect((await getManifestStatus(request(`/api/v1/world/${COLLECTION}/manifest-status?digest=abc`), { params })).status).toBe(400);
    expect(manifestStatus).not.toHaveBeenCalled();
  });

  it("answers 409 when the collection has nothing promoted at all", async () => {
    manifestStatus.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
    const response = await getManifestStatus(request(`/api/v1/world/${COLLECTION}/manifest-status?digest=${MANIFEST}`), { params });
    expect(response.status).toBe(409);
  });
});

describe("POST /v1/collections/{id}/retrieval-index", () => {
  function post() {
    return new Request(`https://tavonel.test/api/v1/collections/${COLLECTION}/retrieval-index`, {
      method: "POST",
      headers: { authorization: "Bearer tvnl_live_probe" },
    });
  }

  it("rebuilds the index for the active world and reports it compiled", async () => {
    const response = await recompileIndex(post(), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.code).toBe("RETRIEVAL_INDEX_COMPILED");
    expect(body.alreadyCompiled).toBe(false);
    // The manifest comes from the active pointer, so an unpromoted candidate cannot be indexed.
    expect(ensureIndex).toHaveBeenCalledWith(expect.objectContaining({ worldManifestDigest: MANIFEST }));
  });

  it("is a no-op that says so when a completed run already exists", async () => {
    readIndexState.mockResolvedValue({ status: "compiled", errorClass: null, runId: "retrieval-run-1", retrievalProfileId: "bge-m3-v1" });
    const body = await (await recompileIndex(post(), { params })).json();
    expect(body.alreadyCompiled).toBe(true);
  });

  it("answers 503 rather than 200 when the rebuild did not reach a queryable index", async () => {
    // A caller asked for an index. Reporting success for a failed rebuild is how a retry loop
    // ends up believing one is there.
    ensureIndex.mockResolvedValue({ status: "failed", errorClass: "RETRIEVAL_COMPILE_EMBEDDING_PROVIDER_FAILED", runId: "retrieval-run-2", retrievalProfileId: "bge-m3-v1" });
    const response = await recompileIndex(post(), { params });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("RETRIEVAL_INDEX_NOT_COMPILED");
    expect(body.retrievalIndex.errorClass).toBe("RETRIEVAL_COMPILE_EMBEDDING_PROVIDER_FAILED");
  });

  it("takes the same owner or admin bar promotion takes", async () => {
    pilot.mockReturnValue({ membership: { workspaceId: WORKSPACE, role: "member" } });
    const response = await recompileIndex(post(), { params });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("RETRIEVAL_COMPILE_ROLE_REQUIRED");
    expect(ensureIndex).not.toHaveBeenCalled();
  });

  it("refuses when the key's membership is not the key's workspace", async () => {
    pilot.mockReturnValue({ membership: { workspaceId: "pilot-rival9", role: "owner" } });
    const response = await recompileIndex(post(), { params });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("PILOT_ACCESS_REQUIRED");
    expect(ensureIndex).not.toHaveBeenCalled();
  });

  it("has nothing to index when nothing was promoted", async () => {
    activeWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
    const response = await recompileIndex(post(), { params });
    expect(response.status).toBe(409);
    expect(ensureIndex).not.toHaveBeenCalled();
  });
});
