import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, pilotAccess, productAccess, listObjects, getOcr, sourceAccess, presign } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  productAccess: vi.fn(),
  listObjects: vi.fn(),
  getOcr: vi.fn(),
  sourceAccess: vi.fn(),
  presign: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: getUser, foundationPilotAccess: pilotAccess }));
vi.mock("@/lib/billing-product-access", () => ({ authorizeFoundationProduct: productAccess }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess }));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  listImmutableWorkspaceObjects: listObjects,
  getWorkspaceOcrJson: getOcr,
}));
vi.mock("@/lib/r2-presign", () => ({ presignWorkspaceProgressGet: presign }));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));

import { GET as candidatesGET } from "../app/api/documents/[id]/candidates/route";
import { GET as progressGET } from "../app/api/documents/[id]/progress/route";

const workspaceId = "pilot-969dc192daa24119";
const userId = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const documentId = "doc-source-1";
const version = "ab".repeat(32);
const prefix = `immutable/${workspaceId}/${workspaceId}/${documentId}/${version}`;

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: userId });
  pilotAccess.mockReset().mockReturnValue({ membership: { workspaceId } });
  productAccess.mockReset().mockResolvedValue({ ok: true });
  listObjects.mockReset().mockResolvedValue({ ok: true, objects: [
    { key: `${prefix}/sanitized.pdf`, size: 100 },
    { key: `${prefix}/ocr.json`, size: 100 },
  ] });
  getOcr.mockReset().mockResolvedValue({ ok: true, json: { text: "bounded candidate" } });
  sourceAccess.mockReset().mockResolvedValue({ ok: true });
  presign.mockReset().mockReturnValue({ ok: true, readUrl: "https://r2.example/progress" });
});

describe("document derived-data source access", () => {
  it("does not return OCR candidates from a suspended connector source", async () => {
    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const response = await candidatesGET(
      new Request(`https://tavonel.com/api/documents/${documentId}/candidates`),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(response.status).toBe(403);
    expect(getOcr).not.toHaveBeenCalled();
  });

  it("revalidates connector access after loading OCR and before returning it", async () => {
    sourceAccess.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED",
    });
    const response = await candidatesGET(
      new Request(`https://tavonel.com/api/documents/${documentId}/candidates`),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(response.status).toBe(403);
    expect(getOcr).toHaveBeenCalledOnce();
  });

  it("returns OCR candidates after both access checks pass", async () => {
    const response = await candidatesGET(
      new Request(`https://tavonel.com/api/documents/${documentId}/candidates`),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(response.status).toBe(200);
    expect(sourceAccess).toHaveBeenCalledTimes(2);
  });

  it("returns no OCR data if the session expires while the object loads", async () => {
    getUser.mockResolvedValueOnce({ id: userId }).mockResolvedValueOnce(null);
    const response = await candidatesGET(
      new Request(`https://tavonel.com/api/documents/${documentId}/candidates`),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(response.status).toBe(401);
    expect(getOcr).toHaveBeenCalledOnce();
  });

  it("does not mint a progress capability for a suspended connector source", async () => {
    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const response = await progressGET(
      new Request(`https://tavonel.com/api/documents/${documentId}/progress`),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(response.status).toBe(403);
    expect(presign).not.toHaveBeenCalled();
  });

  it("mints the bounded progress capability after access is confirmed", async () => {
    const response = await progressGET(
      new Request(`https://tavonel.com/api/documents/${documentId}/progress`),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(response.status).toBe(200);
    expect(presign).toHaveBeenCalledOnce();
  });

  it("does not mint a progress capability after the session expires", async () => {
    getUser.mockResolvedValueOnce({ id: userId }).mockResolvedValueOnce(null);
    const response = await progressGET(
      new Request(`https://tavonel.com/api/documents/${documentId}/progress`),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(response.status).toBe(401);
    expect(presign).not.toHaveBeenCalled();
  });
});
