import { createHash } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import type { CollectionOcrInput } from "./collection-compiler";
import { buildProductCoreV2Request, CORE_V2_MAX_REQUEST_BYTES } from "./core-runtime-v2";
import fixture from "./fixtures/compile-input-manifest.v1.json";
import {
  COMPILE_INPUT_CHUNK_BYTES_MAX,
  COMPILE_INPUT_ID_MAX_LENGTH,
  COMPILE_INPUT_MANIFEST_MAX_ENTRIES,
  COMPILE_INPUT_MAX_REGIONS,
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
    // 20,000 regions: the linear builder takes a few hundred ms; a per-region rescan of the range takes over a minute.
    const region = { ...input.documents[0]!.regions[0]!, text: "y".repeat(200) };
    const doc: CompileInputDocument = { ...input.documents[0]!, regions: Array.from({ length: 20_000 }, (_, i) => ({ ...region, regionId: `r-${i}`, order: i })) };
    const started = Date.now();
    const { manifest, chunkBodies } = buildCompileInputManifest({ ...input, documents: [doc] }, { chunkBytesMax: 800_000 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(manifest.chunks.length).toBeGreaterThan(4);
    expect(manifest.chunks.every((c) => c.byteLength <= 800_000)).toBe(true);
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

  it("refuses a chunkBytesMax that is not a positive safe integer instead of building without a limit", () => {
    for (const bad of [NaN, 0, -1, 1.5, Infinity, 2 ** 53, "900" as never, null as never, COMPILE_INPUT_CHUNK_BYTES_MAX + 1, Number.MAX_SAFE_INTEGER, 32 * 1024 * 1024]) {
      expect(() => built(bad)).toThrow(/chunkBytesMax must be a positive safe integer/);
    }
    expect(built(COMPILE_INPUT_CHUNK_BYTES_MAX).manifest.chunkBytesMax).toBe(COMPILE_INPUT_CHUNK_BYTES_MAX);
    // the hard ceiling is only meaningful while one chunk still fits one Core request
    expect(COMPILE_INPUT_CHUNK_BYTES_MAX).toBeLessThanOrEqual(CORE_V2_MAX_REQUEST_BYTES);
  });

  const totalRegions = input.documents.reduce((n, d) => n + d.regions.length, 0);
  const EMPTY_REGION = {} as CompileInputDocument["regions"][number];

  it("checks every input bound before any work proportional to the input", () => {
    const doc = input.documents[0]!;
    const big = "x".repeat(50_000_000);
    const million = Array.from({ length: 1_000_000 }, (_, i) => ({ ...doc, nativeId: `d-${i}`, regions: [] }));
    const cases: Array<[string, () => unknown]> = [
      ["1e6 documents", () => buildCompileInputManifest({ ...input, documents: million })],
      ["50 MB requestId", () => buildCompileInputManifest({ ...input, requestId: big })],
      ["50 MB workspaceId", () => buildCompileInputManifest({ ...input, workspaceId: big })],
      ["50 MB collectionId", () => buildCompileInputManifest({ ...input, collectionId: big })],
      ["50 MB nativeId", () => buildCompileInputManifest({ ...input, documents: [...input.documents, { ...doc, nativeId: big }] })],
      ["50 MB versionKey", () => buildCompileInputManifest({ ...input, documents: [...input.documents, { ...doc, versionKey: big }] })],
      ["regions over the cap", () => buildCompileInputManifest({ ...input, documents: [...input.documents, { ...doc, nativeId: "d-many", regions: new Array(COMPILE_INPUT_MAX_REGIONS).fill(doc.regions[0]) }] })],
      // a region list that is not a list would make the region count NaN, and NaN passes every `>` check
      ["regions not a list", () => buildCompileInputManifest({ ...input, documents: [{ ...doc, regions: { length: 1 } as never }] })],
      ["documents not a list", () => buildCompileInputManifest({ ...input, documents: { length: 1 } as never })],
    ];
    for (const [label, build] of cases) {
      const started = Date.now();
      expect(build, label).toThrow(/bounds/);
      expect(Date.now() - started, label).toBeLessThan(200);
    }
  });

  it("bounds the region count of the whole compile in the builder: the cap builds and round-trips, one more is refused", () => {
    const doc = input.documents[0]!;
    const fill = (n: number) => [...input.documents, { ...doc, nativeId: "d-many", regions: new Array(n).fill(EMPTY_REGION) }];
    const atCap = fill(COMPILE_INPUT_MAX_REGIONS - totalRegions);
    const { manifest, chunkBodies } = buildCompileInputManifest({ ...input, documents: atCap });
    const result = verifyCompileInputManifest(manifest, chunkBodies, scope);
    expect(result.ok && result.documents.reduce((n, d) => n + d.regions.length, 0)).toBe(COMPILE_INPUT_MAX_REGIONS);
    expect(() => buildCompileInputManifest({ ...input, documents: fill(COMPILE_INPUT_MAX_REGIONS - totalRegions + 1) })).toThrow(/regions/);
  });

  it("stops splitting as soon as the chunk count passes its bound", () => {
    // 200,000 regions of 725 bytes (600 'y') at a 1,000-byte ceiling: two do not fit beside the 36-byte
    // chunk framing, so each region is its own chunk and the 10,001st chunk is refused, not after building
    // and hashing all 200,000. The bound is asserted by count, not by wall clock (hosted runners took
    // 1.07 s and 1.59 s where this machine takes about 0.6 s). `text` is a getter: every canonical() of the
    // region reads it once. The whole-document size pass reads each region once (200,000); the splitter then
    // reads each region it consumes exactly once. By code, 10,000 chunks exist when the throw fires and 0 are
    // hashed (hashing follows the loop). Without the early stop the splitter would read 200,000 more.
    const total = 200_000;
    let reads = 0;
    const region = { ...input.documents[0]!.regions[0]!, text: undefined as unknown as string };
    Object.defineProperty(region, "text", { enumerable: true, get: () => (reads++, "y".repeat(600)) });
    const doc: CompileInputDocument = { ...input.documents[0]!, regions: new Array(total).fill(region) };
    let thrown: unknown;
    try {
      buildCompileInputManifest({ ...input, documents: [doc] }, { chunkBytesMax: 1_000 });
    } catch (error) {
      thrown = error;
    }
    const consumedBySplitter = reads - total;
    expect(consumedBySplitter).toBeGreaterThanOrEqual(COMPILE_INPUT_MANIFEST_MAX_ENTRIES);
    expect(consumedBySplitter).toBeLessThanOrEqual(COMPILE_INPUT_MANIFEST_MAX_ENTRIES + 10);
    expect(String(thrown)).toMatch(/more than 10000 chunks/);
  });

  it("never builds a manifest the verifier would refuse for its size: ids and list lengths are bounded", () => {
    const long = "x".repeat(COMPILE_INPUT_ID_MAX_LENGTH + 1);
    for (const over of [{ requestId: long }, { collectionId: long }, { workspaceId: long }]) {
      expect(() => buildCompileInputManifest({ ...input, ...over })).toThrow(/bounds/);
    }
    const doc = input.documents[0]!;
    expect(() => buildCompileInputManifest({ ...input, documents: [{ ...doc, versionKey: long }] })).toThrow(/bounds/);
    expect(() => buildCompileInputManifest({ ...input, documents: [{ ...doc, nativeId: long }] })).toThrow(/bounds/);
    const many = Array.from({ length: COMPILE_INPUT_MANIFEST_MAX_ENTRIES + 1 }, (_, i) => ({ ...doc, nativeId: `d-${i}`, regions: [] }));
    expect(() => buildCompileInputManifest({ ...input, documents: many })).toThrow(/bounds/);
  });

  it("puts the header in a segment of its own when the first region does not fit beside it", () => {
    const first = input.documents[0]!;
    const doc: CompileInputDocument = {
      ...first,
      title: "T".repeat(400),
      regions: [0, 1, 2].map((i) => ({ ...first.regions[0]!, regionId: `h-${i}`, order: i, text: "w".repeat(300) })),
    };
    const { manifest, chunkBodies } = buildCompileInputManifest({ ...input, documents: [doc] }, { chunkBytesMax: 1000 });
    expect(manifest.chunks.every((c) => c.byteLength <= 1000)).toBe(true);
    expect(JSON.parse(chunkBodies[manifest.chunks[0]!.chunkId]!)).toEqual([expect.objectContaining({ regions: [] })]);
    expect(verifyCompileInputManifest(manifest, chunkBodies, scope)).toEqual({ ok: true, documents: strip([doc]) });
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

    /** Replace chunk `index`'s body and re-seal its length, digest and the total, so only the body is under test. */
    const withBody = (manifest: CompileInputManifest, bodies: Record<string, string>, index: number, body: string) => {
      const chunks = manifest.chunks.map((c, i) => (i === index ? { ...c, byteLength: Buffer.byteLength(body), sha256: sha256(body) } : c));
      const totalBytes = chunks.reduce((n, c) => n + c.byteLength, 0);
      return [reseal({ ...manifest, chunks, totalBytes }), { ...bodies, [manifest.chunks[index]!.chunkId]: body }] as const;
    };

    it("a manifest chunkBytesMax that is not a number cannot switch the ceiling off", () => {
      const { manifest, chunkBodies } = built();
      for (const bad of ["x", "900", null, -1, 0, 1.5, 2 ** 53, Number.MAX_SAFE_INTEGER, 1e15, COMPILE_INPUT_CHUNK_BYTES_MAX + 1]) {
        const m = reseal({ ...manifest, chunkBytesMax: bad as never });
        expect(code(m, chunkBodies)).not.toBe("ok");
        expect(verifyCompileInputManifest(m, chunkBodies, { ...scope, chunkBytesMax: 100 }).ok).toBe(false);
      }
    });

    it("a caller ceiling that is not a positive safe integer refuses instead of lifting the limit", () => {
      const { manifest, chunkBodies } = built();
      for (const bad of [NaN, 0, -1, 1.5, Infinity, "100" as never, null as never, Number.MAX_SAFE_INTEGER, COMPILE_INPUT_CHUNK_BYTES_MAX + 1]) {
        expect(verifyCompileInputManifest(manifest, chunkBodies, { ...scope, chunkBytesMax: bad })).toEqual({ ok: false, code: "manifest_chunk_too_large" });
      }
      expect(verifyCompileInputManifest(manifest, chunkBodies, { ...scope, chunkBytesMax: 900 }).ok).toBe(true);
    });

    it("a chunk id naming an Object.prototype key, or a body that is not a string", () => {
      const { manifest, chunkBodies } = built();
      for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
        const old = manifest.chunks[0]!.chunkId;
        const chunks = manifest.chunks.map((c, i) => (i === 0 ? { ...c, chunkId: name } : c));
        const documents = manifest.documents.map((d) => ({ ...d, chunkIds: d.chunkIds.map((id) => (id === old ? name : id)) }));
        const { [old]: _gone, ...rest } = chunkBodies;
        expect(code(reseal({ ...manifest, chunks, documents }), rest)).toBe("manifest_chunk_missing");
      }
      expect(code(manifest, { ...chunkBodies, "chunk-000000": 5 as never })).toBe("manifest_chunk_missing");
      expect(code(manifest, null as never)).toBe("manifest_chunk_missing");
    });

    it("a continuation that does not follow its own document's run of segments", () => {
      const { manifest, chunkBodies } = buildCompileInputManifest(input, { chunkBytesMax: 4_000_000 });
      const segments = JSON.parse(chunkBodies["chunk-000000"]!) as Array<{ documentId: string; regions: unknown[] }>;
      const a = segments[0]!;
      const interleaved = JSON.stringify([...segments, { documentId: a.documentId, regions: [a.regions[0]] }]);
      expect(code(...withBody(manifest, chunkBodies, 0, interleaved))).toBe("manifest_document_invalid");
    });

    it("reassembles a continuation of any region count the cap admits, without the call stack, and refuses one more", () => {
      // At the hard byte ceiling a continuation of empty-object regions carries about 1.33 million of them, so the
      // region cap, not the byte ceiling, is what binds; spreading that many into one call overflows V8's stack
      // from roughly 120,000 on.
      const { manifest, chunkBodies } = built();
      const open = { ...manifest, chunkBytesMax: COMPILE_INPUT_CHUNK_BYTES_MAX };
      const segments = JSON.parse(chunkBodies[manifest.chunks[1]!.chunkId]!) as Array<{ documentId: string; header?: unknown; regions: unknown[] }>;
      expect(segments[0]!.header).toBeUndefined();
      const others = input.documents[0]!.regions.length - segments[0]!.regions.length;
      const rest = totalRegions - segments[0]!.regions.length;
      const withCount = (count: number) => {
        const body = JSON.stringify([{ documentId: segments[0]!.documentId, regions: new Array(count).fill({}) }, ...segments.slice(1)]);
        expect(Buffer.byteLength(body)).toBeLessThanOrEqual(COMPILE_INPUT_CHUNK_BYTES_MAX);
        return verifyCompileInputManifest(...withBody(open, chunkBodies, 1, body), scope);
      };
      for (const count of [150_000, COMPILE_INPUT_MAX_REGIONS - rest]) {
        const result = withCount(count);
        expect(result.ok && result.documents[0]!.regions.length).toBe(others + count);
      }
      expect(withCount(COMPILE_INPUT_MAX_REGIONS - rest + 1)).toEqual({ ok: false, code: "manifest_document_invalid" });
    });

    it("counts regions across every chunk of the compile, not per chunk", () => {
      // One document whose continuations are each well under the cap and the byte ceiling, but together exceed the cap.
      const doc = input.documents[0]!;
      const { regions: _r, versionKey, ...header } = doc;
      const sealed = (perChunk: number[]) => {
        const bodies: Record<string, string> = {};
        const chunks = [{ documentId: doc.nativeId, header, regions: [] as unknown[] }, ...perChunk.map((n) => ({ documentId: doc.nativeId, regions: new Array(n).fill({}) }))]
          .map((segment, index) => {
            const body = JSON.stringify([segment]);
            const chunkId = `chunk-${index}`;
            bodies[chunkId] = body;
            return { chunkId, index, byteLength: Buffer.byteLength(body), sha256: sha256(body) };
          });
        const unsealed = {
          schemaVersion: "tavonel.compile_input_manifest.v1" as const, workspaceId: input.workspaceId, collectionId: input.collectionId,
          requestId: input.requestId, coreRequestSchema: "tavonel.product_core.compile_request.v2" as const,
          chunkBytesMax: COMPILE_INPUT_CHUNK_BYTES_MAX, totalBytes: chunks.reduce((n, c) => n + c.byteLength, 0),
          documents: [{ documentId: doc.nativeId, versionKey, chunkIds: chunks.map((c) => c.chunkId) }], chunks,
        };
        return verifyCompileInputManifest({ ...unsealed, manifestSha256: manifestDigest(unsealed) }, bodies, scope);
      };
      const half = COMPILE_INPUT_MAX_REGIONS / 2;
      const atCap = sealed([half, half]);
      expect(atCap.ok && atCap.documents[0]!.regions.length).toBe(COMPILE_INPUT_MAX_REGIONS);
      expect(sealed([half, half, 1])).toEqual({ ok: false, code: "manifest_document_invalid" });
      expect(sealed([half, half + 1])).toEqual({ ok: false, code: "manifest_document_invalid" });
      // the reviewer's shape: four chunks of about 1.33 million each
      expect(sealed([1_333_266, 1_333_266, 1_333_266])).toEqual({ ok: false, code: "manifest_document_invalid" });
    });

    it("bounds every list and string before walking it, so an oversized manifest is refused at once", () => {
      const { manifest, chunkBodies } = built();
      const over = COMPILE_INPUT_MANIFEST_MAX_ENTRIES + 1;
      const doc = manifest.documents[0]!;
      const cases: unknown[] = [
        // unsealed on purpose: the size check runs before the digest, so none of these is hashed
        { ...manifest, documents: Array.from({ length: 1_000_000 }, (_, i) => ({ ...doc, documentId: `d${i}` })) },
        { ...manifest, chunks: Array.from({ length: over }, (_, i) => ({ ...manifest.chunks[0]!, chunkId: `c${i}`, index: i })) },
        { ...manifest, documents: [{ ...doc, chunkIds: Array.from({ length: manifest.chunks.length + 1 }, () => doc.chunkIds[0]!) }] },
        { ...manifest, documents: manifest.documents.map((d) => ({ ...d, chunkIds: manifest.chunks.map((c) => c.chunkId) })) },
        { ...manifest, requestId: "x".repeat(50_000_000) },
      ];
      for (const candidate of cases) {
        const started = Date.now();
        expect(verifyCompileInputManifest(candidate, chunkBodies, scope)).toEqual({ ok: false, code: "manifest_schema_unknown" });
        expect(Date.now() - started).toBeLessThan(200);
      }
    });

    it("hostile chunk bodies are refused with a code, never thrown", () => {
      const { manifest, chunkBodies } = built();
      const bodies = [
        "[null]", "[[]]", "{}", "null", "[1]", '"x"', "", "[", "[".repeat(400) + "]".repeat(400),
        '[{"documentId":5,"regions":[]}]', '[{"documentId":"x","regions":null}]', '[{"documentId":"x","regions":[null]}]',
        '[{"documentId":"x","regions":[],"header":[]}]', '[{"documentId":"x","regions":[],"header":null}]',
        '[{"documentId":"constructor","regions":[]}]', "[]",
      ];
      const results = bodies.map((body) => [body.slice(0, 40), code(...withBody(manifest, chunkBodies, 1, body))]);
      expect(results.filter(([, c]) => c === "ok" || !String(c).startsWith("manifest_"))).toEqual([]);
    });

    it("never throws and never accepts a manifest with any one field replaced, deleted or added", async () => {
      const { manifest, chunkBodies } = built();
      const DELETE = Symbol("delete");
      const hostile: unknown[] = [
        DELETE, null, undefined, NaN, Infinity, -1, 0, 1, 1.5, 2 ** 53, "", "x", "constructor", "__proto__", true, [], {}, [null], { length: 1 },
        // oversized but well-typed: the values a type check alone lets through
        "x".repeat(COMPILE_INPUT_ID_MAX_LENGTH + 1), Number.MAX_SAFE_INTEGER, COMPILE_INPUT_CHUNK_BYTES_MAX + 1,
        Array.from({ length: COMPILE_INPUT_MANIFEST_MAX_ENTRIES + 1 }, () => "chunk-000000"),
        // far past every bound: one reference each, so the memory is paid once however many paths reuse it
        "x".repeat(50_000_000), Array.from({ length: 1_000_000 }, () => "chunk-000000"), 1e15, -1e15, 1e308,
      ];
      const freeText = new Set(["collectionId", "requestId", "versionKey"]);
      type Key = string | number;
      const paths = (value: unknown, at: Key[] = []): Key[][] => [
        at,
        ...(value && typeof value === "object"
          ? Object.entries(value).flatMap(([k, v]) => paths(v, [...at, Array.isArray(value) ? Number(k) : k]))
          : []),
      ];
      const valueAt = (path: Key[]) => path.reduce<unknown>((v, k) => (v as Record<Key, unknown>)[k], manifest);
      const mutate = (path: Key[], next: unknown): unknown => {
        if (!path.length) return next === DELETE ? undefined : next;
        const copy = structuredClone(manifest) as unknown as Record<Key, unknown>;
        const parent = path.slice(0, -1).reduce<Record<Key, unknown>>((v, k) => v[k] as Record<Key, unknown>, copy);
        const key = path[path.length - 1]!;
        if (next !== DELETE) parent[key] = next;
        else if (Array.isArray(parent)) parent.splice(Number(key), 1);
        else delete parent[key];
        return copy;
      };
      const sealed = (m: unknown, path: Key[]) =>
        m && typeof m === "object" && !Array.isArray(m) && path[0] !== "manifestSha256" ? reseal(m as CompileInputManifest) : m;
      const failures: string[] = [];
      const check = (label: string, candidate: unknown, mayPass: boolean) => {
        let result: string;
        try {
          result = code(candidate as CompileInputManifest, chunkBodies);
        } catch (error) {
          failures.push(`${label} threw ${String(error)}`);
          return;
        }
        if (result === "ok" && !mayPass) failures.push(`${label} accepted`);
      };
      for (const path of paths(manifest)) {
        const original = valueAt(path);
        for (const next of hostile) {
          const same = next !== DELETE && isDeepStrictEqual(original, next);
          const text = typeof next === "string" && next.length > 0 && next.length <= COMPILE_INPUT_ID_MAX_LENGTH && freeText.has(String(path[path.length - 1]));
          check(`${path.join(".")}=${String(next === DELETE ? "<delete>" : JSON.stringify(next))}`, sealed(mutate(path, next), path), same || text);
        }
        if (original && typeof original === "object" && !Array.isArray(original)) {
          check(`${path.join(".")}+extra`, sealed(mutate([...path, "extra"], 1), [...path, "extra"]), false);
        }
        // Synchronous otherwise: 24-54 s in one stretch, which outlives vitest's fixed 60 s worker RPC window
        // on a loaded hosted runner ("Timeout calling onTaskUpdate", WO-CI-VITEST-RPC-1). One macrotask per path.
        await yieldToEventLoop();
      }
      expect(failures).toEqual([]);
    }, 120_000);
  });
});
