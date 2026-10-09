import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, pilotAccess, productAccess, listObjects, sourceAccess, presign } = vi.hoisted(() => ({
  getUser: vi.fn(), pilotAccess: vi.fn(), productAccess: vi.fn(), listObjects: vi.fn(),
  sourceAccess: vi.fn(), presign: vi.fn(),
}));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: sourceAccess }));
vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: getUser, foundationPilotAccess: pilotAccess }));
vi.mock("@/lib/billing-product-access", () => ({ authorizeFoundationProduct: productAccess }));
vi.mock("@/lib/r2-objects", () => ({ listImmutableWorkspaceObjects: listObjects }));
vi.mock("@/lib/r2-presign", () => ({ presignWorkspaceProgressGet: presign }));
vi.mock("@/lib/r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ accountId: "account", bucket: "bucket", accessKeyId: "key", secretAccessKey: "secret" }) }));

import { GET } from "../app/api/documents/[id]/progress/route";

const workspaceId = "pilot-acl-progress";
const userId = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const documentId = "doc-progress-1";
const version = "ab".repeat(32);
const key = `immutable/${workspaceId}/${workspaceId}/${documentId}/${version}/sanitized.pdf`;

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: userId });
  pilotAccess.mockReset().mockReturnValue({ membership: { workspaceId } });
  productAccess.mockReset().mockResolvedValue({ ok: true });
  sourceAccess.mockReset().mockResolvedValue({ ok: true });
  listObjects.mockReset().mockResolvedValue({ ok: true, objects: [{ key, size: 20 }] });
  presign.mockReset().mockReturnValue({ ok: true, readUrl: "https://bucket.test/signed-progress" });
});

function request() {
  return new Request(`https://tavonel.com/api/documents/${documentId}/progress`, { headers: { authorization: "Bearer session" } });
}

describe("document progress route", () => {
  it("checks the authenticated session viewer before signing the exact version descriptor", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "OK", documentId, versionKey: version, sourceImmutableKey: key,
      sourceSha256: `sha256:${version}`, readUrl: "https://bucket.test/signed-progress", expiresInSeconds: 120,
    });
    expect(sourceAccess).toHaveBeenCalledWith(workspaceId, [documentId], userId);
    expect(presign).toHaveBeenCalledWith(expect.any(Object), {
      workspaceId, key: `immutable/${workspaceId}/${workspaceId}/${documentId}/${version}/ocr-progress.json`,
      expiresInSeconds: 120,
    });
  });

  it("does not mint a progress URL when viewer authorization denies the source", async () => {
    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const response = await GET(request(), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(403);
    expect(presign).not.toHaveBeenCalled();
  });
});
