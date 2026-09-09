import { describe, expect, it, vi } from "vitest";
import { observeSourceVersion, verifySourceVersion } from "./source-version-guard";
const item = { nativeId: "file", revision: "1", name: "file.pdf", mimeType: "application/pdf", sizeBytes: 3, modifiedAt: null, kind: "file" as const };
const google = { id: "file", version: "1", mimeType: "application/pdf", size: "3",
  md5Checksum: "900150983cd24fb0d6963f7d28e17f72", capabilities: { canDownload: true } };
const graph = { id: "file", eTag: '"etag-1"', cTag: '"content-1"', size: 3,
  file: { mimeType: "application/pdf", hashes: { sha1Hash: "a9993e364706816aba3e25717850c26c9cd0d89d" } } };
describe("source version observations around download", () => {
  it("binds Google version and binary checksum to bytes", async () => {
    const before = await observeSourceVersion("google_drive", item, {}, "token", vi.fn().mockResolvedValue(Response.json(google)));
    expect(verifySourceVersion(before, before, new TextEncoder().encode("abc"))).toBeNull();
    expect(verifySourceVersion(before, before, new TextEncoder().encode("abd"))).toBe("SOURCE_CONTENT_HASH_MISMATCH");
    expect(verifySourceVersion(before, { ...before!, version: "2" }, new TextEncoder().encode("abc"))).toBe("SOURCE_REVISION_MISMATCH");
  });
  it.each([{ version: "2" }, { trashed: true }, { id: "other" }])("rejects changed Google identity %j", async changed => {
    await expect(observeSourceVersion("google_drive", item, {}, "token", vi.fn().mockResolvedValue(Response.json({ ...google, ...changed }))))
      .rejects.toThrow("SOURCE_REVISION_MISMATCH");
  });
  it("does not treat missing binary checksums or download permission as proof", async () => {
    for (const changed of [{ md5Checksum: undefined }, { capabilities: { canDownload: false } }]) {
      await expect(observeSourceVersion("google_drive", item, {}, "token", vi.fn().mockResolvedValue(Response.json({ ...google, ...changed }))))
        .rejects.toThrow("SOURCE_REVISION_UNQUALIFIED");
    }
  });
  it("keeps native exports under version observation without pretending an export checksum exists", async () => {
    const native = { ...google, mimeType: "application/vnd.google-apps.document", md5Checksum: undefined, size: undefined };
    const observed = await observeSourceVersion("google_drive", { ...item, mimeType: native.mimeType }, {}, "token", vi.fn().mockResolvedValue(Response.json(native)));
    expect(observed).toMatchObject({ version: "1", hash: null, size: null });
  });
  it("uses the requested SharePoint drive for metadata and validates SHA1 when supplied", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(graph));
    const observed = await observeSourceVersion("microsoft_graph", { ...item, revision: graph.eTag }, { siteId: "site,123" }, "token", fetcher);
    expect(String(fetcher.mock.calls[0][0])).toContain("/sites/site%2C123/drive/items/file");
    expect(verifySourceVersion(observed, observed, new TextEncoder().encode("abc"))).toBeNull();
    expect(verifySourceVersion(observed, observed, new TextEncoder().encode("abd"))).toBe("SOURCE_CONTENT_HASH_MISMATCH");
  });
  it("rejects deleted Graph items and unavailable metadata", async () => {
    await expect(observeSourceVersion("microsoft_graph", { ...item, revision: graph.eTag }, {}, "token", vi.fn().mockResolvedValue(Response.json({ ...graph, deleted: {} }))))
      .rejects.toThrow("SOURCE_REVISION_MISMATCH");
    await expect(observeSourceVersion("google_drive", item, {}, "token", vi.fn().mockResolvedValue(new Response(null, { status: 403 }))))
      .rejects.toThrow("SOURCE_VERSION_READ_FAILED");
  });
  it("checks Graph QuickXorHash and refuses reliance on the unsupported SHA256 field", async () => {
    const row = { ...graph, file: { mimeType: "application/pdf", hashes: { quickXorHash: "YRDDGAAAAAAAAAAAAwAAAAAAAAA=" } } };
    const observed = await observeSourceVersion("microsoft_graph", { ...item, revision: graph.eTag }, {}, "token", vi.fn().mockResolvedValue(Response.json(row)));
    expect(verifySourceVersion(observed, observed, new TextEncoder().encode("abc"))).toBeNull();
    expect(verifySourceVersion(observed, observed, new TextEncoder().encode("abd"))).toBe("SOURCE_CONTENT_HASH_MISMATCH");
    const unsupported = { ...graph, file: { mimeType: "application/pdf", hashes: { sha256Hash: "a".repeat(64) } } };
    await expect(observeSourceVersion("microsoft_graph", { ...item, revision: graph.eTag }, {}, "token", vi.fn().mockResolvedValue(Response.json(unsupported))))
      .rejects.toThrow("SOURCE_REVISION_UNQUALIFIED");
  });
});
