import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";

const { getUser, pilotAccess, productAccess, getCandidate, listObjects, promote, sourceAccess, ensureIndex } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  productAccess: vi.fn(),
  getCandidate: vi.fn(),
  listObjects: vi.fn(),
  promote: vi.fn(),
  sourceAccess: vi.fn(),
  ensureIndex: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: getUser, foundationPilotAccess: pilotAccess }));
vi.mock("@/lib/billing-product-access", () => ({ authorizeFoundationProduct: productAccess }));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  getWorkspaceCollectionCandidate: getCandidate,
  listImmutableWorkspaceObjects: listObjects,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
vi.mock("@/lib/world-store", () => ({ promoteFoundationCandidate: promote }));
/*
  The FD-02 self-serve ceiling, passed through: it is asserted in
  `lib/activation-rate-limit.test.ts` and exercised per route in
  `lib/world-activation-plan-gate.test.ts`, and a limiter that read the audit tables from here
  would answer every case with a transport error instead of the behaviour under test.
*/
vi.mock("@/lib/activation-rate-limit", () => ({ checkActivationRateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess }));
vi.mock("@/lib/retrieval-index-status", () => ({ ensureRetrievalIndexForActiveWorld: ensureIndex }));

import { POST } from "../app/api/collections/[id]/promote/route";

const workspaceId = "pilot-download";
const userId = "969dc192-daa2-4119-a5d9-9a7621f171a1";

function input(documentId: string, versionKey: string, text: string): CollectionOcrInput {
  const sanitizedKey = `immutable/${workspaceId}/${workspaceId}/${documentId}/${versionKey}/sanitized.pdf`;
  return {
    documentId,
    versionKey,
    sanitizedKey,
    ocrJsonKey: sanitizedKey.replace("sanitized.pdf", "ocr.json"),
    pageCount: 1,
    text,
    inputSha256: `sha256:${versionKey}`,
    sourceImmutableKey: sanitizedKey,
    regions: [{
      regionId: `${documentId}-p1-b1`, pageIndex0: 0, pageNumber1: 1, order: 0,
      blockType: "paragraph", text, bbox1000: [80, 120, 920, 320], confidence: 0.99,
      authority: "contractual",
    }],
  };
}

const compiled = compileCollectionCandidate([
  input("doc-one", "a".repeat(64), "Quarterly revenue increased after the reviewed policy change."),
]);
/*
  The receipt carries the artifact counts and the equivalence verdict the wire actually stores
  (`dispatchProductCoreV2` refuses a receipt without them), because the promote route now reads
  them: audit TM02's gate.
*/
const receipt = {
  requestId: "core-proof",
  outputSha256: compiled.manifestDigest,
  candidatePromotion: false,
  equivalence: "not_run",
  totalArtifacts: 8,
  rebuiltArtifacts: 8,
  workAvoidedArtifacts: 0,
};
const artifact = {
  ...compiled,
  coreExecution: {
    status: "completed",
    runtime: "tavonel-python-core-v2",
    worldStateId: "world-state-1",
    receipt,
  },
};
const withReceipt = (patch: Record<string, unknown>) => ({
  ...artifact,
  coreExecution: { ...artifact.coreExecution, receipt: { ...receipt, ...patch } },
});

function request() {
  return new Request(`https://tavonel.com/api/collections/${artifact.collectionId}/promote`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer session" },
    body: JSON.stringify({ manifestDigest: artifact.manifestDigest, expectedCurrentManifest: null, reason: "Reviewed exact evidence." }),
  });
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: userId });
  pilotAccess.mockReset().mockReturnValue({ membership: { workspaceId, role: "owner" } });
  productAccess.mockReset().mockResolvedValue({ ok: true });
  getCandidate.mockReset().mockResolvedValue({ ok: true, json: artifact });
  listObjects.mockReset().mockResolvedValue({
    ok: true,
    objects: artifact.sourceDocuments.flatMap((document) => [
      { key: document.sanitizedKey, size: 100, lastModified: "2026-09-10T00:00:00.000Z" },
      { key: document.ocrJsonKey, size: 100, lastModified: "2026-09-10T00:01:00.000Z" },
    ]),
  });
  promote.mockReset().mockResolvedValue({ ok: true, result: { status: "active" } });
  sourceAccess.mockReset().mockResolvedValue({ ok: true });
  ensureIndex.mockReset().mockResolvedValue({ status: "compiled", runId: "rrun-1", retrievalProfileId: "rprof-1" });
});

describe("World promotion source-version gate", () => {
  it("activates only while every compiled source version is current", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: artifact.collectionId }) });
    expect(response.status).toBe(200);
    expect(promote).toHaveBeenCalledOnce();
  });

  it("refuses a candidate after a newer source version arrives", async () => {
    const current = artifact.sourceDocuments[0]!;
    const newer = "b".repeat(64);
    listObjects.mockResolvedValue({ ok: true, objects: [
      { key: current.sanitizedKey, size: 100, lastModified: "2026-09-09T00:00:00.000Z" },
      { key: current.ocrJsonKey, size: 100, lastModified: "2026-09-09T00:01:00.000Z" },
      { key: `immutable/${workspaceId}/${workspaceId}/${current.documentId}/${newer}/sanitized.pdf`, size: 100,
        lastModified: "2026-09-10T00:00:00.000Z" },
    ] });

    const response = await POST(request(), { params: Promise.resolve({ id: artifact.collectionId }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "SOURCE_VERSION_CHANGED", documentIds: [current.documentId] });
    expect(promote).not.toHaveBeenCalled();
  });

  it("fails closed when the workspace inventory is incomplete", async () => {
    listObjects.mockResolvedValue({ ok: false, code: "LIST_LIMIT_EXCEEDED" });
    const response = await POST(request(), { params: Promise.resolve({ id: artifact.collectionId }) });
    expect(response.status).toBe(503);
    expect(promote).not.toHaveBeenCalled();
  });

  it("does not activate a source whose connector access was revoked", async () => {
    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const response = await POST(request(), { params: Promise.resolve({ id: artifact.collectionId }) });
    expect(response.status).toBe(403);
    expect(promote).not.toHaveBeenCalled();
  });

  it("does not activate after the browser session changes", async () => {
    getUser.mockResolvedValueOnce({ id: userId }).mockResolvedValueOnce(null);
    const response = await POST(request(), { params: Promise.resolve({ id: artifact.collectionId }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "AUTHORIZATION_CHANGED_RETRY" });
    expect(promote).not.toHaveBeenCalled();
  });
});

/*
  Audit TM02 at the point it decides something.

  The gate reads the Core's own verdict off the stored receipt; it does not re-derive one. What
  is asserted here is the ordering the integration owes both lanes: the refusal happens before
  the pointer moves, and the retrieval index is compiled after it (R4-01), so a refused
  promotion neither activates a World nor spends an embedder on one.
*/
describe("the full-rebuild equivalence gate in front of promotion", () => {
  async function promoteWith(json: unknown) {
    getCandidate.mockResolvedValue({ ok: true, json });
    const response = await POST(request(), { params: Promise.resolve({ id: artifact.collectionId }) });
    return { response, body: await response.json() as Record<string, unknown> };
  }

  it("promotes and then compiles the index when the Core reported no divergence", async () => {
    const { response, body } = await promoteWith(withReceipt({ equivalence: "passed", rebuiltArtifacts: 3, workAvoidedArtifacts: 5 }));
    expect(response.status).toBe(200);
    expect(body.code).toBe("WORLD_ACTIVE");
    expect(promote).toHaveBeenCalledOnce();
    expect(ensureIndex).toHaveBeenCalledOnce();
    // The gate refuses before promotion; the index is compiled after it. Both, in that order.
    expect(promote.mock.invocationCallOrder[0]!).toBeLessThan(ensureIndex.mock.invocationCallOrder[0]!);
  });

  it("promotes an uncompared full rebuild, which is every compile on this deployment", async () => {
    const { response, body } = await promoteWith(artifact);
    expect(response.status).toBe(200);
    expect(body.code).toBe("WORLD_ACTIVE");
    expect(promote).toHaveBeenCalledOnce();
  });

  it("refuses a receipt whose artifacts are not all accounted for", async () => {
    const { response, body } = await promoteWith(withReceipt({ equivalence: "passed", rebuiltArtifacts: 3, workAvoidedArtifacts: 4 }));
    expect(response.status).toBe(409);
    expect(body.code).toBe("WORLD_EQUIVALENCE_REFUSED");
    expect((body.equivalence as { status: string }).status).toBe("mismatch");
    expect(promote).not.toHaveBeenCalled();
    expect(ensureIndex).not.toHaveBeenCalled();
  });

  it.each([
    ["a verdict nothing recognises", { equivalence: "probably" }],
    ["counts that cannot be read", { totalArtifacts: "eight" }],
    ["no verdict at all", { equivalence: undefined }],
  ])("refuses %s rather than promoting on trust", async (_label, patch) => {
    const { response, body } = await promoteWith(withReceipt(patch));
    expect(response.status).toBe(409);
    expect(body.code).toBe("WORLD_EQUIVALENCE_REFUSED");
    expect((body.equivalence as { status: string }).status).toBe("unknown");
    expect(promote).not.toHaveBeenCalled();
    expect(ensureIndex).not.toHaveBeenCalled();
  });

  it("refuses a selective rebuild the Core said diverges, and says which check caught it", async () => {
    /*
      A `failed` verdict never reaches the gate: validatePromotableCollectionArtifact already
      refuses it, so the promoter sees WORLD_CANDIDATE_NOT_PROMOTABLE. Asserted here so the two
      refusals cannot both drift away at once and leave a divergent rebuild promotable.
    */
    const { response, body } = await promoteWith(withReceipt({ equivalence: "failed" }));
    expect(response.status).toBe(422);
    expect(body.code).toBe("WORLD_CANDIDATE_NOT_PROMOTABLE");
    expect(promote).not.toHaveBeenCalled();
    expect(ensureIndex).not.toHaveBeenCalled();
  });
});
