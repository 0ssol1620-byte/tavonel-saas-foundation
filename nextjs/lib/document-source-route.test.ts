import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, pilotAccess, productAccess, listObjects, signPdf, sourceAccess, acquire, release } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  productAccess: vi.fn(),
  listObjects: vi.fn(),
  signPdf: vi.fn(),
  sourceAccess: vi.fn(),
  acquire: vi.fn(), release: vi.fn(),
}));
vi.mock("@/lib/workspace-operation-guard", () => ({ acquireWorkspaceOperation: acquire }));
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
  release.mockReset().mockResolvedValue(undefined);
  acquire.mockReset().mockResolvedValue({ ok: true, replay: false, release });
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
    expect(release).toHaveBeenCalledOnce();
  });
  it("refuses over-cap requests before loading PDF bytes", async () => {
    acquire.mockResolvedValue({ ok: false, code: "WORKSPACE_CONCURRENCY_LIMIT", status: 429 });
    const response = await GET(new Request(request().url + "&format=pdf"), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(429);
    expect(signPdf).not.toHaveBeenCalled();
  });
  it("holds the slot until consumption or cancellation", async () => {
    signPdf.mockResolvedValue({ ok: true, bytes: new Uint8Array(200_000) });
    const response = await GET(new Request(request().url + "&format=pdf"), { params: Promise.resolve({ id: documentId }) });
    expect(release).not.toHaveBeenCalled();
    const reader = response.body!.getReader();
    await reader.read();
    expect(release).not.toHaveBeenCalled();
    await reader.cancel();
    expect(release).toHaveBeenCalledOnce();
  });
  it("releases the slot when the PDF provider refuses the source", async () => {
    signPdf.mockResolvedValue({ ok: false, code: "SOURCE_DIGEST_MISMATCH" });
    const response = await GET(new Request(request().url + "&format=pdf"), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "SOURCE_DIGEST_MISMATCH" });
    expect(release).toHaveBeenCalledOnce();
  });
  it("releases the slot if the provider throws before a response exists", async () => {
    signPdf.mockRejectedValue(new Error("provider unavailable"));
    await expect(GET(new Request(request().url + "&format=pdf"), { params: Promise.resolve({ id: documentId }) }))
      .rejects.toThrow("provider unavailable");
    expect(release).toHaveBeenCalledOnce();
  });
  it("returns no PDF when its source is suspended while bytes load", async () => {
    signPdf.mockImplementationOnce(async () => {
      sourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
      return { ok: true, bytes: new Uint8Array([37, 80, 68, 70]) };
    });
    const response = await GET(new Request(request().url + "&format=pdf"), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not fall back to a different version", async () => {
    const response = await GET(request("cd".repeat(32)), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(404);
    expect(signPdf).not.toHaveBeenCalled();
  });

  it("refuses an unpinned read when multiple source versions have no authoritative order", async () => {
    const second = "cd".repeat(32);
    listObjects.mockResolvedValue({ ok: true, objects: [
      { key, size: 20 },
      { key: `immutable/${workspaceId}/${workspaceId}/${documentId}/${second}/sanitized.pdf`, size: 21 },
    ] });
    const response = await GET(new Request(`https://tavonel.com/api/documents/${documentId}/source`),
      { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "SOURCE_VERSION_AMBIGUOUS" });
    expect(signPdf).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated requests before listing tenant objects", async () => {
    getUser.mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(401);
    expect(listObjects).not.toHaveBeenCalled();
  });
});
