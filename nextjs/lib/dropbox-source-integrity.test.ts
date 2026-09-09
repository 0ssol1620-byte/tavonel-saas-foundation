import { describe, expect, it } from "vitest";
import { dropboxContentHash, verifyDropboxSource } from "./dropbox-source-integrity";
const bytes = new TextEncoder().encode("abc");
const digest = "4f8b42c22dd3729b519ba6f68d2da7cc5b2d606d05daed5ad5128cc03e6c6358";
const item = { nativeId: "id:file", revision: "a1c10ce0dd78", name: "file.pdf", mimeType: "application/pdf", sizeBytes: 3, modifiedAt: null, kind: "file" as const };
const metadata = { id: item.nativeId, rev: item.revision, size: 3, content_hash: digest };
const response = (value: unknown) => new Response(null, { headers: { "Dropbox-API-Result": JSON.stringify(value) } });
describe("Dropbox version and byte binding", () => {
  it("matches independently computed hash vectors, including a 4 MiB boundary", () => {
    expect(dropboxContentHash(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(dropboxContentHash(bytes)).toBe(digest);
    const multi = new Uint8Array(4194305); multi[4194304] = 88;
    expect(dropboxContentHash(multi)).toBe("9003a63bc35be0960b839b3fa5295e5ee676943708f4cc39bf8e26ec7cea2c32");
  });
  it("accepts only the requested immutable ID/revision with matching bytes", () => {
    expect(verifyDropboxSource(response(metadata), bytes, item)).toBeNull();
  });
  it.each([{ id: "id:other" }, { rev: "new-revision" }])("refuses another identity/version %j", override => {
    expect(verifyDropboxSource(response({ ...metadata, ...override }), bytes, item)).toBe("SOURCE_REVISION_MISMATCH");
  });
  it.each([{ size: 4 }, { content_hash: "a".repeat(64) }])("refuses inconsistent content %j", override => {
    expect(verifyDropboxSource(response({ ...metadata, ...override }), bytes, item)).toBe("SOURCE_CONTENT_HASH_MISMATCH");
  });
  it("does not replace missing provider proof with an assumption", () => {
    expect(verifyDropboxSource(new Response(null), bytes, item)).toBe("SOURCE_REVISION_UNQUALIFIED");
    expect(verifyDropboxSource(response({ ...metadata, content_hash: null }), bytes, item)).toBe("SOURCE_REVISION_UNQUALIFIED");
  });
});
