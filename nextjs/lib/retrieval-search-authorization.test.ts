import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, reauthorize, pipeline, activeWorld, freshness, indexState, runtimeResolve } = vi.hoisted(() => ({
  authorize: vi.fn(),
  reauthorize: vi.fn(),
  pipeline: vi.fn(),
  activeWorld: vi.fn(),
  freshness: vi.fn(),
  indexState: vi.fn(),
  runtimeResolve: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({
  authorizeFoundationRequest: authorize,
  revalidateFoundationAuthorization: reauthorize,
}));
vi.mock("@/lib/retrieval-pipeline", () => ({ runRetrievalPipeline: pipeline }));
vi.mock("@/lib/retrieval-runtime-config", () => ({
  buildProductionRetrievalProfile: () => ({ id: "profile-1" }),
  createProductionEmbedderAdapter: vi.fn(),
  createProductionRerankerAdapter: vi.fn(),
  readRetrievalRuntimeEnv: () => null,
  resolveConfiguredProductionRetrievalRuntime: runtimeResolve,
  selectProductionRetrievalRuntime: () => ({
    profile: { id: "profile-1" },
    embedder: undefined,
    reranker: undefined,
    routerDecision: undefined,
    decision: {
      evaluatedAt: "2026-09-20T00:00:00.000Z",
      registrySource: "unconfigured",
      components: {},
      fallbacks: ["lexical", "structural"],
    },
  }),
}));
vi.mock("@/lib/retrieval-index-status", () => ({
  readRetrievalIndexState: indexState,
  retrievalIndexNotice: () => "Compile the active World before searching it.",
}));
vi.mock("@/lib/world-store", () => ({
  getFoundationActiveWorld: activeWorld,
  getWorldFreshness: freshness,
}));

import { POST } from "../app/api/collections/[id]/search/route";

const COLLECTION = `collection-${"a".repeat(32)}`;
const WORKSPACE = "pilot-search-auth";
const PRINCIPAL = {
  kind: "api-key" as const,
  workspaceKey: WORKSPACE,
  userId: "user-1",
  keyId: "key-1",
  scopes: ["ask:read"],
  accessSource: "paid" as const,
};
const ACTIVE = {
  workspaceKey: WORKSPACE,
  collectionId: COLLECTION,
  manifestDigest: `sha256:${"b".repeat(64)}`,
  revision: 3,
  worldStateId: "world-state-3",
};

function request() {
  return new Request(`https://tavonel.com/api/v1/collections/${COLLECTION}/search`, {
    method: "POST",
    headers: {
      authorization: "Bearer tvnl_live_fixture",
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: "retention period" }),
  });
}

function contextPacket() {
  return {
    worldId: COLLECTION,
    worldVersion: ACTIVE.worldStateId,
    retrievalProfile: "profile-1",
    query: "retention period",
    items: [{
      unitId: "unit-1",
      text: "Retention is thirty days.",
      claimIds: ["claim-1"],
      entityIds: [],
      sourceVersionId: "document-1/version-1",
      evidenceIds: ["evidence-1"],
      pageNumber1: 1,
      bbox1000: [80, 120, 920, 320],
      authority: "contractual",
      retrieval: { lexicalRank: 1, denseRank: null, structureRank: null, rerankerScore: null },
    }],
    heldConflicts: [],
    abstentionReasons: [],
  };
}

beforeEach(() => {
  authorize.mockReset().mockResolvedValue({ ok: true, principal: PRINCIPAL });
  reauthorize.mockReset().mockResolvedValue({ ok: true, principal: PRINCIPAL });
  activeWorld.mockReset().mockResolvedValue({ ok: true, world: ACTIVE });
  freshness.mockReset().mockResolvedValue({ checkedAt: "2026-09-20T00:00:00.000Z" });
  indexState.mockReset().mockResolvedValue({ status: "missing", errorClass: null });
  runtimeResolve.mockReset().mockResolvedValue({ ok: true, runtime: {
    profile: { id: "profile-1" }, embedder: undefined, reranker: undefined,
    routerDecision: undefined,
    decision: { evaluatedAt: "2026-09-20T00:00:00.000Z", registrySource: "unconfigured",
      components: {}, fallbacks: ["lexical", "structural"] },
  } });
  pipeline.mockReset().mockResolvedValue({
    ok: true,
    packet: contextPacket(),
    diagnostics: {
      compileRunId: "run-1",
      retrievalProfileId: "profile-1",
      lexicalCandidateCount: 1,
      denseCandidateCount: 0,
      structureCandidateCount: 0,
      fusedCandidateCount: 1,
      rerankerApplied: false,
      gateRejections: [],
      degradations: [],
    },
  });
});

describe("search late authorization", () => {
  it("returns evidence only after revalidating the original principal", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: COLLECTION }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.code).toBe("SEARCH_RESULTS");
    expect(JSON.stringify(body)).not.toMatch(/shadowEvaluation|policyId|canaryBucket/);
    expect(reauthorize).toHaveBeenCalledOnce();
    expect(reauthorize).toHaveBeenCalledWith(expect.any(Request), PRINCIPAL, "ask:read", "observer");
    expect(freshness.mock.invocationCallOrder[0]).toBeLessThan(reauthorize.mock.invocationCallOrder[0]);
    expect(pipeline).toHaveBeenCalledWith(expect.objectContaining({ routerDecision: undefined }));
    expect(runtimeResolve).toHaveBeenCalledWith(expect.objectContaining({
      workspaceKey: WORKSPACE, collectionId: COLLECTION, endpoint: "search",
      query: "retention period", indexStatus: "missing",
    }));
  });

  it("returns no ContextPacket when the API key is revoked while retrieval runs", async () => {
    reauthorize.mockResolvedValue({ ok: false, code: "API_KEY_REVOKED", status: 401 });

    const response = await POST(request(), { params: Promise.resolve({ id: COLLECTION }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ code: "API_KEY_REVOKED" });
    expect(JSON.stringify(body)).not.toContain("Retention is thirty days");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("revalidates after loading index state before returning a conflict response", async () => {
    pipeline.mockResolvedValue({ ok: false, code: "RETRIEVAL_RUN_NOT_FOUND" });
    reauthorize.mockResolvedValue({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 });

    const response = await POST(request(), { params: Promise.resolve({ id: COLLECTION }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "AUTHORIZATION_CHANGED_RETRY" });
    expect(indexState).toHaveBeenCalledOnce();
    expect(indexState.mock.invocationCallOrder[0]).toBeLessThan(reauthorize.mock.invocationCallOrder[0]);
  });
});
