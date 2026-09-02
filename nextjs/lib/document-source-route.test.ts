import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, pilotAccess, productAccess, listObjects, signPdf } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  productAccess: vi.fn(),
  listObjects: vi.fn(),
  signPdf: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: getUser, foundationPilotAccess: pilotAccess }));
vi.mock("@/lib/billing-product-access", () => ({ authorizeFoundationProduct: productAccess }));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  listImmutableWorkspaceObjects: listObjects,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "tavonel-foundation-pilot", accessKeyId: "key", secretAccessKey: "secret" }),
}));
vi.mock("@/lib/r2-presign", () => ({ presignWorkspaceSanitizedPdfGet: signPdf }));

import { GET } from "../app/api/documents/[id]/source/route";

const workspaceId = "pilot-969dc192daa24119";
const userId = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const documentId = "doc-source-1";
const version = "ab".repeat(32);
const key = `immutable/${workspaceId}/${workspaceId}/${documentId}/${version}/sanitized.pdf`;

function request(requestedVersion = version) {
  return new Request(`https://tavonel.com/api/documents/${documentId}/source?version=${requestedVersion}`, {
    headers: { authorization: "Bearer session" },
  });
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: userId });
  pilotAccess.mockReset().mockReturnValue({ membership: { workspaceId } });
  productAccess.mockReset().mockResolvedValue({ ok: true });
  listObjects.mockReset().mockResolvedValue({
    ok: true,
    objects: [
      { key: `immutable/other/other/${documentId}/${version}/sanitized.pdf`, size: 10 },
      { key, size: 20 },
    ],
  });
  signPdf.mockReset().mockReturnValue({ ok: true, readUrl: "https://r2.example/signed-pdf" });
});

describe("document source PDF route", () => {
  it("returns a short-lived URL only for the exact version inside the authenticated workspace", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      documentId,
      versionKey: version,
      readUrl: "https://r2.example/signed-pdf",
      expiresInSeconds: 120,
    });
    expect(signPdf).toHaveBeenCalledWith(expect.any(Object), {
      workspaceId,
      key,
      expiresInSeconds: 120,
    });
  });

  it("does not fall back to a different version", async () => {
    const response = await GET(request("cd".repeat(32)), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(404);
    expect(signPdf).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated requests before listing tenant objects", async () => {
    getUser.mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(401);
    expect(listObjects).not.toHaveBeenCalled();
  });
});
