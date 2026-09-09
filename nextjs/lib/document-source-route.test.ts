import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, pilotAccess, productAccess, listObjects, signPdf, sourceAccess } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  productAccess: vi.fn(),
  listObjects: vi.fn(),
  signPdf: vi.fn(),
  sourceAccess: vi.fn(),
}));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess }));

vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: getUser, foundationPilotAccess: pilotAccess }));
vi.mock("@/lib/billing-product-access", () => ({ authorizeFoundationProduct: productAccess }));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  listImmutableWorkspaceObjects: listObjects,
  getWorkspaceSanitizedPdf: signPdf,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "tavonel-foundation-pilot", accessKeyId: "key", secretAccessKey: "secret" }),
}));

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
  sourceAccess.mockReset().mockResolvedValue({ ok: true });
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
  signPdf.mockReset().mockResolvedValue({ ok: true, bytes: new Uint8Array([37, 80, 68, 70]) });
});

describe("document source PDF route", () => {
  it("does not issue a read capability for a suspended source", async () => {
    sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const response = await GET(request(), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(signPdf).not.toHaveBeenCalled();
  });
  it("returns an authenticated route only for the exact workspace version", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      documentId,
      versionKey: version,
      readUrl: `/api/documents/${documentId}/source?version=${version}&format=pdf`,
      requiresAuthorization: true,
    });
    expect(signPdf).not.toHaveBeenCalled();
  });
  it("returns PDF bytes through the authenticated path", async () => {
    const response = await GET(new Request(request().url + "&format=pdf"), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(signPdf).toHaveBeenCalledWith(expect.any(Object), workspaceId, key);
    expect(sourceAccess).toHaveBeenCalledTimes(2);
  });
  it("returns no PDF when its source is suspended while bytes load", async () => {
    signPdf.mockImplementationOnce(async () => {
      sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
      return { ok: true, bytes: new Uint8Array([37, 80, 68, 70]) };
    });
    const response = await GET(new Request(request().url + "&format=pdf"), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
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
