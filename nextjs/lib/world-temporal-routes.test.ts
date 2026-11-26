import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-D18-2: `known_at` / `valid_at` on the lens read and on search.

  What each test protects: a refused time never reads anything and never spends a trial unit; a
  historical read serves exactly the World the activation log names and goes through the same
  access and admission gates as a current one; a request with no time field is the response it
  always was; and search never answers from a superseded World whose index is not queryable.
*/

const m = vi.hoisted(() => ({
  authorize: vi.fn(), reauthorize: vi.fn(), readModel: vi.fn(), activeWorld: vi.fn(), versions: vi.fn(), freshness: vi.fn(),
  resolveAt: vi.fn(), persist: vi.fn(), pipeline: vi.fn(), indexState: vi.fn(), runtimeResolve: vi.fn(), spend: vi.fn(), bind: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: m.authorize, revalidateFoundationAuthorization: m.reauthorize }));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: m.activeWorld,
  listFoundationWorldVersions: m.versions,
  getWorldFreshness: m.freshness,
}));
vi.mock("@/lib/world-read-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-read-model")>()),
  loadWorldReadModel: m.readModel,
}));
vi.mock("@/lib/world-activation-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-activation-history")>()),
  resolveWorldAtKnownAt: m.resolveAt,
}));
vi.mock("@/lib/consumer-context-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./consumer-context-api")>();
  return { ...actual, bindConsumerContext: m.bind };
});
vi.mock("@/lib/model-attempt-receipt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./model-attempt-receipt")>()),
  persistRetrievalModelAttempt: m.persist,
}));
vi.mock("@/lib/trial-ai-access", () => ({ spendTrialSessionQuery: m.spend }));
vi.mock("@/lib/retrieval-pipeline", () => ({ runRetrievalPipeline: m.pipeline }));
vi.mock("@/lib/retrieval-runtime-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-runtime-config")>()),
  resolveConfiguredProductionRetrievalRuntime: m.runtimeResolve,
}));
vi.mock("@/lib/retrieval-index-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-index-status")>()),
  readRetrievalIndexState: m.indexState,
}));

import { GET as getLens } from "../app/api/v1/world/[id]/[lens]/route";
import { POST as postSearch } from "../app/api/collections/[id]/search/route";
import { EMPTY_WORLD_FRESHNESS } from "./world-store";
import { DERIVED_DATA_REFUSED } from "./derived-data-admission";

const WORKSPACE = "pilot-acme01";
const COLLECTION = `collection-${"a".repeat(32)}`;
const OLD = `sha256:${"1".repeat(64)}`;
const ACTIVE = `sha256:${"2".repeat(64)}`;
const SECRET = "x".repeat(40);
const T = "2026-11-10T00:00:00.000Z";
const ACTIVATED = "2026-11-02T08:00:00.000Z";
const evId = (index: number) => `ev-${String(index).padStart(32, "0")}`;

const principal = { kind: "api-key", workspaceKey: WORKSPACE, userId: "u", keyId: "k", scopes: ["worlds:read", "ask:read"], authorizationRevision: 3, workspaceRole: "owner" };

// What loadWorldReadModel really builds for a digest that is not the active one: status "candidate"
// on the World and every fact, and that same digest handed to the freshness read as the candidate
// hint (world-read-model.ts:643, 785-787). A superseded World can never carry "superseded" here.
const model = (count: number, manifest: string) => ({
  world: { id: COLLECTION, manifestDigest: manifest, status: manifest === ACTIVE ? "active" : "candidate", revision: { state: "read", value: 1 } },
  contract: { origin: "compiled_artifact" },
  freshness: {
    ...EMPTY_WORLD_FRESHNESS, activeManifestDigest: ACTIVE,
    candidateAwaitingActivation: manifest !== ACTIVE, candidateManifestDigest: manifest === ACTIVE ? null : manifest,
  },
  objects: [{ id: "obj-1", status: manifest === ACTIVE ? "active" : "candidate" }],
  relations: [{ id: "rel-1", status: manifest === ACTIVE ? "active" : "candidate" }], evidence: Array.from({ length: count }, (_, i) => ({ id: evId(i) })), history: [], files: [],
  review: { state: "not_yet" }, signature: { state: "not_yet" },
});

async function lens(query: string, name = "evidence") {
  const response = await getLens(new Request(`https://tavonel.test/api/v1/world/${COLLECTION}/${name}${query}`, { headers: { authorization: "Bearer tvnl_live_probe" } }), {
    params: Promise.resolve({ id: COLLECTION, lens: name }),
  });
  return { status: response.status, body: await response.json() };
}

async function search(body: Record<string, unknown>) {
  const response = await postSearch(new Request(`https://tavonel.test/api/v1/collections/${COLLECTION}/search`, {
    method: "POST", headers: { authorization: "Bearer tvnl_live_probe", "content-type": "application/json" },
    body: JSON.stringify({ query: "retention period", ...body }),
  }), { params: Promise.resolve({ id: COLLECTION }) });
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", SECRET);
  const actual = await vi.importActual<typeof import("./consumer-context-api")>("./consumer-context-api");
  m.bind.mockImplementation(actual.bindConsumerContext);
  m.authorize.mockResolvedValue({ ok: true, principal });
  m.reauthorize.mockResolvedValue({ ok: true, principal });
  m.activeWorld.mockResolvedValue({ ok: true, world: { manifestDigest: ACTIVE, revision: 4, worldStateId: "ws-active", candidateObjectKey: "x" } });
  m.versions.mockResolvedValue({ ok: true, versions: [
    { manifest_digest: ACTIVE, world_state_id: "ws-active", lifecycle_status: "active" },
    { manifest_digest: OLD, world_state_id: "ws-old", lifecycle_status: "superseded" },
  ] });
  m.freshness.mockResolvedValue({ checkedAt: "2026-11-16T00:00:00.000Z" });
  m.resolveAt.mockResolvedValue({ ok: true, manifestDigest: OLD, activatedAt: ACTIVATED });
  m.readModel.mockImplementation(async (_ws: string, _id: string, digest: string) => ({ ok: true, model: model(6, digest) }));
  m.spend.mockResolvedValue({ ok: true });
  m.persist.mockResolvedValue({ ok: true });
  m.indexState.mockResolvedValue({ status: "compiled", errorClass: null, runId: "run-old", retrievalProfileId: "p" });
  m.runtimeResolve.mockResolvedValue({ ok: true, runtime: { profile: { id: "p" }, embedder: undefined, reranker: undefined, routerDecision: undefined, decision: { components: {}, fallbacks: [] }, controlPlaneLineage: null } });
  m.pipeline.mockResolvedValue({
    ok: true, packet: { items: [{ unitId: "u1" }] },
    diagnostics: { compileRunId: "run-old", retrievalProfileId: "p", lexicalCandidateCount: 1, denseCandidateCount: 0, structureCandidateCount: 0, fusedCandidateCount: 1, rerankerApplied: false, gateRejections: [], degradations: [] },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("lens read with known_at", () => {
  it("serves the World the activation log names, and says so", async () => {
    const { status, body } = await lens(`?known_at=${T}`);
    expect(status).toBe(200);
    expect(m.resolveAt).toHaveBeenCalledWith(WORKSPACE, COLLECTION, T);
    expect(m.readModel).toHaveBeenCalledWith(WORKSPACE, COLLECTION, OLD);
    expect(body.world.manifestDigest).toBe(OLD);
    expect(body.temporal).toEqual({ knownAt: T, resolution: "world_activation_log", manifestDigest: OLD, activatedAt: ACTIVATED, current: false });
  });

  it("reads the active World through the normal path when it is the one activated at T", async () => {
    m.resolveAt.mockResolvedValue({ ok: true, manifestDigest: ACTIVE, activatedAt: ACTIVATED });
    const { status, body } = await lens(`?known_at=${T}`);
    expect(status).toBe(200);
    expect(m.readModel).toHaveBeenCalledWith(WORKSPACE, COLLECTION, ACTIVE);
    expect(body.temporal).toMatchObject({ manifestDigest: ACTIVE, current: true });
  });

  it("reports a superseded World as superseded, never as a candidate awaiting activation", async () => {
    const present = { ...EMPTY_WORLD_FRESHNESS, activeManifestDigest: ACTIVE, candidateAwaitingActivation: false, candidateManifestDigest: null };
    m.freshness.mockResolvedValue(present);
    const { status, body } = await lens(`?known_at=${T}`, "objects");
    expect(status).toBe(200);
    expect(body.world).toMatchObject({ manifestDigest: OLD, status: "superseded" });
    expect(body.objects).toEqual([{ id: "obj-1", status: "superseded" }]);
    const relations = await lens(`?known_at=${T}`, "relations");
    expect(relations.body.relations).toEqual([{ id: "rel-1", status: "superseded" }]);
    // The freshness is the present one, read without the historical digest as a candidate hint.
    expect(m.freshness).toHaveBeenCalledWith(WORKSPACE, COLLECTION);
    expect(body.freshness).toEqual(present);
    expect(body.freshness.candidateAwaitingActivation).toBe(false);
    expect(body.freshness.candidateManifestDigest).toBeNull();
    expect(body.temporal.current).toBe(false);
  });

  it("leaves the model alone when the World activated at T is the active one", async () => {
    m.resolveAt.mockResolvedValue({ ok: true, manifestDigest: ACTIVE, activatedAt: ACTIVATED });
    const { body } = await lens(`?known_at=${T}`, "objects");
    expect(body.world.status).toBe("active");
    expect(body.objects).toEqual([{ id: "obj-1", status: "active" }]);
    expect(m.freshness).not.toHaveBeenCalled();
  });

  it("normalizes an offset to the instant the resolver sees", async () => {
    await lens(`?known_at=${encodeURIComponent("2026-11-10T09:00:00+09:00")}`);
    expect(m.resolveAt).toHaveBeenCalledWith(WORKSPACE, COLLECTION, T);
  });

  it("composes with ids", async () => {
    const { status, body } = await lens(`?known_at=${T}&ids=${evId(4)},${evId(1)}`);
    expect(status).toBe(200);
    expect(body.evidence).toEqual([{ id: evId(4) }, { id: evId(1) }]);
    expect(body.temporal.manifestDigest).toBe(OLD);
  });

  it("composes with page_token, which binds the historical digest", async () => {
    const first = await lens(`?known_at=${T}&limit=2`);
    expect(first.status).toBe(200);
    const token = first.body.page.nextPageToken as string;
    expect(typeof token).toBe("string");
    const next = await lens(`?known_at=${T}&page_token=${encodeURIComponent(token)}`);
    expect(next.status).toBe(200);
    expect(next.body.evidence.map((item: { id: string }) => item.id)).toEqual([evId(2), evId(3)]);
    // The same token without the time points at a different World: refused, not spliced.
    const spliced = await lens(`?page_token=${encodeURIComponent(token)}`);
    expect(spliced.status).toBe(409);
    expect(spliced.body.code).toBe("PAGE_TOKEN_STALE");
  });

  it("refuses a historical World whose source is now denied, with no content", async () => {
    m.readModel.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED", status: 403, bytes: undefined, bound: undefined });
    const { status, body } = await lens(`?known_at=${T}`);
    expect(status).toBe(403);
    expect(body.code).toBe("CONNECTOR_SOURCE_ACCESS_DENIED");
    expect(body.evidence).toBeUndefined();
    expect(body.temporal).toBeUndefined();
  });

  it("answers 404 before the first activation and 503 when the log cannot be read", async () => {
    m.resolveAt.mockResolvedValue({ ok: false, code: "KNOWN_AT_BEFORE_FIRST_ACTIVATION", status: 404 });
    expect(await lens(`?known_at=${T}`)).toMatchObject({ status: 404, body: { code: "KNOWN_AT_BEFORE_FIRST_ACTIVATION" } });
    m.resolveAt.mockResolvedValue({ ok: false, code: "WORLD_STORE_READ_FAILED", status: 503 });
    expect(await lens(`?known_at=${T}`)).toMatchObject({ status: 503, body: { code: "WORLD_STORE_READ_FAILED" } });
    expect(m.readModel).not.toHaveBeenCalled();
  });

  it.each([
    ["a naive date", "?known_at=2026-11-10", 400, "KNOWN_AT_INVALID"],
    ["garbage", "?known_at=yesterday", 400, "KNOWN_AT_INVALID"],
    ["a repeated known_at", `?known_at=${T}&known_at=${T}`, 400, "KNOWN_AT_INVALID"],
    ["the future", "?known_at=2099-01-01T00:00:00Z", 400, "KNOWN_AT_IN_FUTURE"],
    ["as_of", `?as_of=${T}`, 400, "AS_OF_AMBIGUOUS"],
    ["valid_at", `?valid_at=${T}`, 422, "VALID_TIME_NOT_RECORDED"],
    ["a malformed valid_at", "?valid_at=2026-11-10", 400, "VALID_AT_INVALID"],
  ])("refuses %s before reading anything", async (_name, query, status, code) => {
    const result = await lens(query);
    expect(result.status).toBe(status);
    expect(result.body).toEqual({ code });
    expect(m.resolveAt).not.toHaveBeenCalled();
    expect(m.activeWorld).not.toHaveBeenCalled();
    expect(m.readModel).not.toHaveBeenCalled();
  });

  it("refuses known_at alongside a consumer context", async () => {
    m.bind.mockReturnValue({ ok: true, bound: true });
    expect(await lens(`?known_at=${T}`)).toMatchObject({ status: 400, body: { code: "KNOWN_AT_WITH_CONTEXT" } });
    expect(m.resolveAt).not.toHaveBeenCalled();
  });

  it("leaves a request with no time field exactly as it was", async () => {
    const { status, body } = await lens("");
    expect(status).toBe(200);
    expect(m.resolveAt).not.toHaveBeenCalled();
    expect(m.readModel).toHaveBeenCalledWith(WORKSPACE, COLLECTION, ACTIVE);
    expect(Object.keys(body).sort()).toEqual(["code", "contract", "evidence", "freshness", "page", "world"]);
  });
});

describe("search with known_at", () => {
  it("serves a superseded World whose index is queryable, from that World's digest and state id", async () => {
    const { status, body } = await search({ known_at: T });
    expect(status).toBe(200);
    expect(m.indexState).toHaveBeenCalledWith(expect.objectContaining({ worldManifestDigest: OLD }));
    expect(m.pipeline).toHaveBeenCalledWith(expect.objectContaining({ worldManifestDigest: OLD, worldStateId: "ws-old" }));
    // The attempt receipt names the World that answered, not the active one.
    expect(m.persist).toHaveBeenCalledWith(expect.objectContaining({ worldManifestDigest: OLD }));
    expect(body.temporal).toEqual({ knownAt: T, resolution: "world_activation_log", manifestDigest: OLD, activatedAt: ACTIVATED, current: false });
    // The real active World is still reported as the active one.
    expect(body.activeWorld.manifestDigest).toBe(ACTIVE);
  });

  it("answers 409 and spends no trial unit when the historical index is not queryable", async () => {
    m.indexState.mockResolvedValue({ status: "missing", errorClass: "RETRIEVAL_RUN_NOT_FOUND", runId: null, retrievalProfileId: "p" });
    expect(await search({ known_at: T })).toMatchObject({ status: 409, body: { code: "HISTORICAL_INDEX_UNAVAILABLE" } });
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.pipeline).not.toHaveBeenCalled();
  });

  it("answers 409 and spends nothing when the digest is not among the recorded versions", async () => {
    m.versions.mockResolvedValue({ ok: true, versions: [{ manifest_digest: ACTIVE, world_state_id: "ws-active", lifecycle_status: "active" }] });
    expect(await search({ known_at: T })).toMatchObject({ status: 409, body: { code: "HISTORICAL_INDEX_UNAVAILABLE" } });
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.pipeline).not.toHaveBeenCalled();
  });

  it("runs the unchanged active path when the active World is the one activated at T", async () => {
    m.resolveAt.mockResolvedValue({ ok: true, manifestDigest: ACTIVE, activatedAt: ACTIVATED });
    const { status, body } = await search({ known_at: T });
    expect(status).toBe(200);
    expect(m.versions).not.toHaveBeenCalled();
    expect(m.pipeline).toHaveBeenCalledWith(expect.objectContaining({ worldManifestDigest: ACTIVE, worldStateId: "ws-active" }));
    expect(body.temporal).toMatchObject({ manifestDigest: ACTIVE, current: true });
    expect(m.activeWorld).toHaveBeenCalledTimes(1);
  });

  it("surfaces a pipeline refusal for a World whose source access has since been denied", async () => {
    m.pipeline.mockResolvedValue({ ok: false, code: DERIVED_DATA_REFUSED });
    m.runtimeResolve.mockResolvedValue({ ok: true, runtime: { profile: { id: "p" }, decision: { components: {}, fallbacks: [] }, controlPlaneLineage: null } });
    const { status, body } = await search({ known_at: T });
    expect(status).toBe(403);
    expect(body.contextPacket).toBeUndefined();
  });

  it.each([
    ["a naive date", { known_at: "2026-11-10" }, 400, "KNOWN_AT_INVALID"],
    ["a non-string", { known_at: 1763285400 }, 400, "KNOWN_AT_INVALID"],
    ["the future", { known_at: "2099-01-01T00:00:00Z" }, 400, "KNOWN_AT_IN_FUTURE"],
    ["as_of", { as_of: T }, 400, "AS_OF_AMBIGUOUS"],
    ["valid_at", { valid_at: T }, 422, "VALID_TIME_NOT_RECORDED"],
  ])("refuses %s before spending a trial unit or reading a World", async (_name, extra, status, code) => {
    const result = await search(extra);
    expect(result.status).toBe(status);
    expect(result.body).toEqual({ code });
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.resolveAt).not.toHaveBeenCalled();
    expect(m.activeWorld).not.toHaveBeenCalled();
  });

  it("answers 404 before the first activation, before spending", async () => {
    m.resolveAt.mockResolvedValue({ ok: false, code: "KNOWN_AT_BEFORE_FIRST_ACTIVATION", status: 404 });
    expect(await search({ known_at: T })).toMatchObject({ status: 404, body: { code: "KNOWN_AT_BEFORE_FIRST_ACTIVATION" } });
    expect(m.spend).not.toHaveBeenCalled();
  });

  it("refuses known_at alongside a consumer context", async () => {
    m.bind.mockReturnValue({ ok: true, bound: true });
    expect(await search({ known_at: T })).toMatchObject({ status: 400, body: { code: "KNOWN_AT_WITH_CONTEXT" } });
    expect(m.spend).not.toHaveBeenCalled();
  });

  it("leaves a request with no time field exactly as it was", async () => {
    const { status, body } = await search({});
    expect(status).toBe(200);
    expect(m.resolveAt).not.toHaveBeenCalled();
    expect(m.versions).not.toHaveBeenCalled();
    expect(body.temporal).toBeUndefined();
    expect(m.pipeline).toHaveBeenCalledWith(expect.objectContaining({ worldManifestDigest: ACTIVE, worldStateId: "ws-active" }));
  });
});
