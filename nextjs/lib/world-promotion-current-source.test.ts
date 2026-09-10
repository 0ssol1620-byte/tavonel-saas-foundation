import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";

const { getUser, pilotAccess, productAccess, getCandidate, listObjects, promote, sourceAccess } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  productAccess: vi.fn(),
  getCandidate: vi.fn(),
  listObjects: vi.fn(),
  promote: vi.fn(),
  sourceAccess: vi.fn(),
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
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess }));

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
const artifact = {
  ...compiled,
  coreExecution: {
    status: "completed",
    runtime: "tavonel-python-core-v2",
    worldStateId: "world-state-1",
    receipt: { requestId: "core-proof", outputSha256: compiled.manifestDigest, candidatePromotion: false },
  },
};

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
});
