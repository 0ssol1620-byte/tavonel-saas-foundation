import { describe, expect, it } from "vitest";
import fixture from "./fixtures/compile-input-manifest.v1.json";
import {
  buildCompileInputManifest,
  manifestDigest,
  verifyCompileInputManifest,
  type CompileInputDocument,
  type CompileInputManifest,
} from "./compile-input-manifest";

const GOLDEN_DIGEST = "sha256:82acaf72d9045611ed6eb5c0ef698e68d2f630785d7b95aab0521d630d5509b7";
const input = fixture.input as unknown as Parameters<typeof buildCompileInputManifest>[0];
const scope = { workspaceId: input.workspaceId };
const strip = (docs: CompileInputDocument[]) =>
  [...docs].sort((a, b) => a.nativeId.localeCompare(b.nativeId)).map(({ versionKey: _v, ...d }) => d);

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

  it("is deterministic regardless of input order", () => {
    const a = built();
    const b = buildCompileInputManifest({ ...input, documents: [...input.documents].reverse() }, { chunkBytesMax: fixture.chunkBytesMax });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
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
    it("a document whose header is missing or duplicated", () => {
      const { manifest, chunkBodies } = built();
      const documents = manifest.documents.map((d, i) => (i === 0 ? { ...d, chunkIds: [d.chunkIds[1]!] } : d));
      expect(code(reseal({ ...manifest, documents }), chunkBodies)).toBe("manifest_document_invalid");
    });
  });
});
