import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CollectionOcrInput } from "./collection-compiler";
import { buildProductCoreV2Request } from "./core-runtime-v2";
import fixture from "./fixtures/compile-input-manifest.v1.json";
import {
  buildCompileInputManifest,
  manifestDigest,
  verifyCompileInputManifest,
  type CompileInputDocument,
  type CompileInputManifest,
} from "./compile-input-manifest";

const sha256 = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const GOLDEN_DIGEST = "sha256:82acaf72d9045611ed6eb5c0ef698e68d2f630785d7b95aab0521d630d5509b7";
const input = fixture.input as unknown as Parameters<typeof buildCompileInputManifest>[0];
const scope = { workspaceId: input.workspaceId };
const strip = (docs: CompileInputDocument[]) => docs.map(({ versionKey: _v, ...d }) => d);

function built(chunkBytesMax = fixture.chunkBytesMax) {
  return buildCompileInputManifest(input, { chunkBytesMax });
}
/** Re-seal a tampered manifest so the refusal under test is the one that fires, not the digest. */
function reseal(manifest: CompileInputManifest): CompileInputManifest {
  const { manifestSha256: _m, ...rest } = manifest;
  return { ...rest, manifestSha256: manifestDigest(rest) };
}
const code = (m: CompileInputManifest, bodies: Record<string, string>, ws = input.workspaceId) => {
  const r = verifyCompileInputManifest(m, bodies, { workspaceId: ws });
  return r.ok ? "ok" : r.code;
};

describe("compile input manifest", () => {
  it("matches the golden fixture byte for byte and pins its digest", () => {
    const { manifest, chunkBodies } = built();
    expect(manifest).toEqual(fixture.expected.manifest);
    expect(chunkBodies).toEqual(fixture.expected.chunkBodies);
    expect(manifest.manifestSha256).toBe(GOLDEN_DIGEST);
    // a document continued across chunks, none cut mid-region
    expect(manifest.documents[0]!.chunkIds.length).toBeGreaterThan(1);
  });

  it("keeps the request's document order and is deterministic", () => {
    const a = built();
    expect(JSON.stringify(built())).toBe(JSON.stringify(a));
    expect(a.manifest.documents.map((d) => d.documentId)).toEqual(input.documents.map((d) => d.nativeId));
    const reversed = buildCompileInputManifest({ ...input, documents: [...input.documents].reverse() }, { chunkBytesMax: fixture.chunkBytesMax });
    expect(reversed.manifest.documents.map((d) => d.documentId)).toEqual([...input.documents].reverse().map((d) => d.nativeId));
  });

  it("round-trips to the documents of the real single-body request, whatever the id ordering", () => {
    const base = (documentId: string, logicalSourceId?: string): CollectionOcrInput => ({
      documentId,
      ...(logicalSourceId ? { logicalSourceId } : {}),
      versionKey: "c".repeat(64),
      sanitizedKey: `immutable/${documentId}/sanitized.pdf`,
      ocrJsonKey: `immutable/${documentId}/ocr.json`,
      pageCount: 1,
      text: "t",
      inputSha256: `sha256:${"c".repeat(64)}`,
      sourceImmutableKey: `immutable/${documentId}/sanitized.pdf`,
      regions: [{ regionId: `r-${documentId}`, pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph", text: "t", bbox1000: [1, 2, 3, 4], confidence: 1, authority: "informal" }],
    });
    for (const docs of [
      [base("d1", "src-ffff"), base("d2", "src-0000")],
      [base("Bdoc"), base("adoc")],
      [base("doc-1"), base("doc-2")],
    ]) {
      const request = buildProductCoreV2Request("pilot-acme01", docs, new Date("2026-08-29T00:00:00Z"), "req-1");
      const withKeys = request.documents.map((d) => ({ ...d, versionKey: "c".repeat(64) }));
      for (const max of [900, 4_000_000]) {
        const { manifest, chunkBodies } = buildCompileInputManifest(
          { workspaceId: "pilot-acme01", collectionId: request.collectionId, requestId: request.requestId, documents: withKeys },
          { chunkBytesMax: max },
        );
        expect(verifyCompileInputManifest(manifest, chunkBodies, { workspaceId: "pilot-acme01" })).toEqual({ ok: true, documents: request.documents });
      }
    }
  });

  it("builds a many-region multi-chunk document in linear time", () => {
    const region = { ...input.documents[0]!.regions[0]!, text: "y".repeat(200) };
    const doc: CompileInputDocument = { ...input.documents[0]!, regions: Array.from({ length: 5000 }, (_, i) => ({ ...region, regionId: `r-${i}`, order: i })) };
    const started = Date.now();
    const { manifest, chunkBodies } = buildCompileInputManifest({ ...input, documents: [doc] }, { chunkBytesMax: 200_000 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(manifest.chunks.length).toBeGreaterThan(4);
    expect(manifest.chunks.every((c) => c.byteLength <= 200_000)).toBe(true);
    const { versionKey: _v, ...expected } = doc;
    expect(verifyCompileInputManifest(manifest, chunkBodies, scope)).toEqual({ ok: true, documents: [expected] });
  });

  it("round-trips to the single-body request documents", () => {
    for (const max of [fixture.chunkBytesMax, 4_000_000]) {
      const { manifest, chunkBodies } = built(max);
      const result = verifyCompileInputManifest(manifest, chunkBodies, scope);
      expect(result).toEqual({ ok: true, documents: strip(input.documents) });
    }
    expect(built(4_000_000).manifest.chunks).toHaveLength(1);
  });

  it("splits a 3-document set over 9 MB into chunks that each fit", () => {
    const text = "x".repeat(100_000);
    const big = (n: string): CompileInputDocument => ({
      ...input.documents[0]!,
      nativeId: n,
      regions: Array.from({ length: 31 }, (_, i) => ({ ...input.documents[0]!.regions[0]!, regionId: `${n}-${i}`, order: i, text })),
    });
    const docs = [big("d1"), big("d2"), big("d3")];
    const { manifest, chunkBodies } = buildCompileInputManifest({ ...input, documents: docs });
    expect(manifest.totalBytes).toBeGreaterThan(9_000_000);
    expect(manifest.chunks.length).toBeGreaterThanOrEqual(3);
    expect(manifest.chunks.every((c) => c.byteLength <= manifest.chunkBytesMax)).toBe(true);
    const result = verifyCompileInputManifest(manifest, chunkBodies, scope);
    expect(result.ok && result.documents).toEqual(strip(docs));
  });

  it("refuses a region that cannot fit any chunk instead of cutting it", () => {
    expect(() => built(300)).toThrow(/exceeds chunkBytesMax/);
  });

  it("refuses a document whose header alone exceeds the limit, naming the header", () => {
    expect(() => built(200)).toThrow(/header exceeds chunkBytesMax/);
  });

  describe("refusals", () => {
    it("unknown schema", () => {
      const { manifest, chunkBodies } = built();
      expect(code({ ...manifest, schemaVersion: "tavonel.compile_input_manifest.v9" as never }, chunkBodies)).toBe("manifest_schema_unknown");
    });
    it("foreign workspace", () => {
      const { manifest, chunkBodies } = built();
      expect(code(manifest, chunkBodies, "pilot-someoneelse00001")).toBe("manifest_workspace_foreign");
    });
    it("manifest digest mismatch", () => {
      const { manifest, chunkBodies } = built();
      expect(code({ ...manifest, requestId: "req-other" }, chunkBodies)).toBe("manifest_digest_mismatch");
    });
    it("gap, duplicate and out-of-order index", () => {
      const { manifest, chunkBodies } = built();
      for (const indexes of [[0, 2, 3, 4], [0, 1, 1, 3], [1, 0, 2, 3]]) {
        const chunks = manifest.chunks.map((c, i) => ({ ...c, index: indexes[i]! }));
        expect(code(reseal({ ...manifest, chunks }), chunkBodies)).toBe("manifest_chunk_index_invalid");
      }
    });
    it("missing chunk body", () => {
      const { manifest, chunkBodies } = built();
      const { "chunk-000001": _gone, ...rest } = chunkBodies;
      expect(code(manifest, rest)).toBe("manifest_chunk_missing");
    });
    it("length and sha256 mismatch", () => {
      const { manifest, chunkBodies } = built();
      expect(code(manifest, { ...chunkBodies, "chunk-000000": chunkBodies["chunk-000000"] + " " })).toBe("manifest_chunk_length_mismatch");
      const flipped = chunkBodies["chunk-000000"]!.replace("Synthetic", "Synthesis");
      expect(flipped.length).toBe(chunkBodies["chunk-000000"]!.length);
      expect(code(manifest, { ...chunkBodies, "chunk-000000": flipped })).toBe("manifest_chunk_sha256_mismatch");
    });
    it("chunk over chunkBytesMax", () => {
      const { manifest, chunkBodies } = built();
      expect(code(reseal({ ...manifest, chunkBytesMax: 100 }), chunkBodies)).toBe("manifest_chunk_too_large");
    });
    it("document referencing a missing chunk", () => {
      const { manifest, chunkBodies } = built();
      const documents = manifest.documents.map((d, i) => (i === 0 ? { ...d, chunkIds: [...d.chunkIds, "chunk-000099"] } : d));
      expect(code(reseal({ ...manifest, documents }), chunkBodies)).toBe("manifest_document_chunk_missing");
    });
    it("total bytes that do not add up", () => {
      const { manifest, chunkBodies } = built();
      expect(code(reseal({ ...manifest, totalBytes: manifest.totalBytes + 1 }), chunkBodies)).toBe("manifest_total_mismatch");
    });
    const tamper = (mutate: (m: CompileInputManifest) => CompileInputManifest) => {
      const { manifest, chunkBodies } = built();
      return code(reseal(mutate(manifest)), chunkBodies);
    };
    it("a middle chunk dropped from a document's chunkIds", () => {
      expect(tamper((m) => ({ ...m, documents: m.documents.map((d, i) => (i === 0 ? { ...d, chunkIds: [d.chunkIds[0]!, ...d.chunkIds.slice(2)] } : d)) }))).toBe("manifest_document_invalid");
    });
    it("chunkIds out of order", () => {
      expect(tamper((m) => ({ ...m, documents: m.documents.map((d, i) => (i === 0 ? { ...d, chunkIds: [...d.chunkIds].reverse() } : d)) }))).toBe("manifest_document_invalid");
    });
    it("a document entry removed, leaving orphan segments", () => {
      expect(tamper((m) => ({ ...m, documents: m.documents.slice(1) }))).toBe("manifest_document_invalid");
    });
    it("a duplicated document entry", () => {
      expect(tamper((m) => ({ ...m, documents: [...m.documents, m.documents[0]!] }))).toBe("manifest_document_invalid");
    });
    it("a segment that is not a segment", () => {
      const { manifest, chunkBodies } = built();
      const body = "[null]";
      const chunks = manifest.chunks.map((c, i) => (i === 0 ? { ...c, byteLength: body.length, sha256: sha256(body) } : c));
      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      expect(code(reseal({ ...manifest, chunks, totalBytes: total }), { ...chunkBodies, "chunk-000000": body })).toBe("manifest_chunk_unreadable");
    });
    it("a different Core request schema", () => {
      expect(tamper((m) => ({ ...m, coreRequestSchema: "other" as never }))).toBe("manifest_schema_unknown");
    });
    it("the caller's own chunk ceiling", () => {
      const { manifest, chunkBodies } = built();
      const r = verifyCompileInputManifest(manifest, chunkBodies, { workspaceId: input.workspaceId, chunkBytesMax: 100 });
      expect(r).toEqual({ ok: false, code: "manifest_chunk_too_large" });
    });
    it("a document whose header is missing or duplicated", () => {
      const { manifest, chunkBodies } = built();
      const documents = manifest.documents.map((d, i) => (i === 0 ? { ...d, chunkIds: [d.chunkIds[1]!] } : d));
      expect(code(reseal({ ...manifest, documents }), chunkBodies)).toBe("manifest_document_invalid");
    });
  });
});
