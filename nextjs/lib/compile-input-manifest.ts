import { createHash } from "node:crypto";
import type { ProductCoreV2CompileRequest } from "./core-runtime-v2";

/*
  Versioned chunk manifest for a compile input that does not fit one request body (F30-08).

  Contract and pure builder/verifier only: nothing here transfers a byte or touches dispatch.
  The current refusals (COMPILE_INPUT_TOO_LARGE, CORE_OUTPUT_TOO_LARGE) stay authoritative
  until a transfer path built on this has its own tests.

  A chunk body is the canonical JSON (keys sorted by UTF-16 code unit, no whitespace) of an array of
  segments. A document's first segment carries its header (everything but `regions`); a document
  too big for one chunk continues in further segments that carry only region ranges, so a region
  is never cut. Documents keep the order the request carries them in (buildProductCoreV2Request already makes it
  deterministic), then region order, so two builds of one request are byte-identical and the
  reassembled documents equal request.documents.
*/

export const COMPILE_INPUT_MANIFEST_SCHEMA = "tavonel.compile_input_manifest.v1" as const;
export const COMPILE_INPUT_CHUNK_BYTES_MAX = 4_000_000;

type RequestDocument = ProductCoreV2CompileRequest["documents"][number];
export type CompileInputDocument = RequestDocument & { versionKey: string };

export type CompileInputManifest = {
  schemaVersion: typeof COMPILE_INPUT_MANIFEST_SCHEMA;
  workspaceId: string;
  collectionId: string;
  requestId: string;
  coreRequestSchema: "tavonel.product_core.compile_request.v2";
  chunkBytesMax: number;
  totalBytes: number;
  documents: Array<{ documentId: string; versionKey: string; chunkIds: string[] }>;
  chunks: Array<{ chunkId: string; index: number; byteLength: number; sha256: string }>;
  manifestSha256: string;
};

export type ManifestRefusal =
  | "manifest_schema_unknown"
  | "manifest_workspace_foreign"
  | "manifest_digest_mismatch"
  | "manifest_chunk_index_invalid"
  | "manifest_chunk_missing"
  | "manifest_chunk_length_mismatch"
  | "manifest_chunk_sha256_mismatch"
  | "manifest_chunk_too_large"
  | "manifest_chunk_unreadable"
  | "manifest_total_mismatch"
  | "manifest_document_chunk_missing"
  | "manifest_document_invalid";

export type ManifestVerification =
  | { ok: true; documents: RequestDocument[] }
  | { ok: false; code: ManifestRefusal };

type Segment = { documentId: string; header?: Omit<RequestDocument, "regions">; regions: RequestDocument["regions"] };

const byUtf16 = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => byUtf16(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function wellFormed(value: unknown): boolean {
  const s = value as Segment | null;
  return (
    !!s && typeof s === "object" && typeof s.documentId === "string" && Array.isArray(s.regions) &&
    (s.header === undefined || (!!s.header && typeof s.header === "object" && !Array.isArray(s.header)))
  );
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

export function manifestDigest(manifest: Omit<CompileInputManifest, "manifestSha256">): string {
  return sha(canonical(manifest));
}

export function buildCompileInputManifest(
  input: { workspaceId: string; collectionId: string; requestId: string; documents: CompileInputDocument[] },
  options: { chunkBytesMax?: number } = {},
): { manifest: CompileInputManifest; chunkBodies: Record<string, string> } {
  const chunkBytesMax = options.chunkBytesMax ?? COMPILE_INPUT_CHUNK_BYTES_MAX;
  const docs = input.documents;
  if (new Set(docs.map((d) => d.nativeId)).size !== docs.length) throw new Error("duplicate documentId");

  const chunks: Segment[][] = [[]];
  let size = 2; // "[]"
  const docChunks = new Map<string, number[]>();
  const place = (documentId: string, segment: Segment, segmentBytes: number) => {
    if (segmentBytes + 2 > chunkBytesMax) throw new Error(`document ${documentId} segment exceeds chunkBytesMax`);
    let current = chunks[chunks.length - 1]!;
    if (current.length && size + segmentBytes + 1 > chunkBytesMax) {
      current = [];
      chunks.push(current);
      size = 2;
    }
    size += segmentBytes + (current.length ? 1 : 0);
    current.push(segment);
    const list = docChunks.get(documentId) ?? [];
    if (list[list.length - 1] !== chunks.length - 1) list.push(chunks.length - 1);
    docChunks.set(documentId, list);
  };

  for (const doc of docs) {
    const { regions, versionKey: _versionKey, ...header } = doc;
    const whole: Segment = { documentId: doc.nativeId, header, regions };
    const wholeBytes = bytes(canonical(whole));
    if (wholeBytes + 2 <= chunkBytesMax) {
      place(doc.nativeId, whole, wholeBytes);
      continue;
    }
    // Contiguous region ranges, never mid-region. Sizes are kept incrementally: a segment is its
    // empty-regions form plus the region bytes plus one comma between regions, so this is O(regions).
    const baseFirst = bytes(canonical({ documentId: doc.nativeId, header, regions: [] }));
    const baseRest = bytes(canonical({ documentId: doc.nativeId, regions: [] }));
    if (baseFirst + 2 > chunkBytesMax) throw new Error(`document ${doc.nativeId} header exceeds chunkBytesMax`);
    let range: RequestDocument["regions"] = [];
    let regionBytes = 0;
    let first = true;
    const segmentBytes = () => (first ? baseFirst : baseRest) + regionBytes + Math.max(0, range.length - 1);
    const flush = () => {
      const segment: Segment = first
        ? { documentId: doc.nativeId, header, regions: range }
        : { documentId: doc.nativeId, regions: range };
      place(doc.nativeId, segment, segmentBytes());
      first = false;
      range = [];
      regionBytes = 0;
    };
    for (const region of regions) {
      const rb = bytes(canonical(region));
      if (segmentBytes() + rb + (range.length ? 1 : 0) + 2 > chunkBytesMax) {
        if (!range.length) throw new Error(`region ${region.regionId} exceeds chunkBytesMax`);
        flush();
        if (baseRest + rb + 2 > chunkBytesMax) throw new Error(`region ${region.regionId} exceeds chunkBytesMax`);
      }
      range.push(region);
      regionBytes += rb;
    }
    flush();
  }

  const chunkBodies: Record<string, string> = {};
  const chunkMeta = chunks.map((segments, index) => {
    const body = canonical(segments);
    const chunkId = `chunk-${String(index).padStart(6, "0")}`;
    chunkBodies[chunkId] = body;
    return { chunkId, index, byteLength: bytes(body), sha256: sha(body) };
  });
  const unsealed: Omit<CompileInputManifest, "manifestSha256"> = {
    schemaVersion: COMPILE_INPUT_MANIFEST_SCHEMA,
    workspaceId: input.workspaceId,
    collectionId: input.collectionId,
    requestId: input.requestId,
    coreRequestSchema: "tavonel.product_core.compile_request.v2",
    chunkBytesMax,
    totalBytes: chunkMeta.reduce((sum, c) => sum + c.byteLength, 0),
    documents: docs.map((d) => ({
      documentId: d.nativeId,
      versionKey: d.versionKey,
      chunkIds: docChunks.get(d.nativeId)!.map((i) => chunkMeta[i]!.chunkId),
    })),
    chunks: chunkMeta,
  };
  return { manifest: { ...unsealed, manifestSha256: manifestDigest(unsealed) }, chunkBodies };
}

export function verifyCompileInputManifest(
  manifest: CompileInputManifest,
  chunkBodies: Record<string, string>,
  expected: { workspaceId: string; chunkBytesMax?: number },
): ManifestVerification {
  const fail = (code: ManifestRefusal): ManifestVerification => ({ ok: false, code });
  if (manifest.schemaVersion !== COMPILE_INPUT_MANIFEST_SCHEMA) return fail("manifest_schema_unknown");
  if (manifest.workspaceId !== expected.workspaceId) return fail("manifest_workspace_foreign");
  if (manifest.coreRequestSchema !== "tavonel.product_core.compile_request.v2") return fail("manifest_schema_unknown");
  const { manifestSha256, ...unsealed } = manifest;
  if (manifestDigest(unsealed) !== manifestSha256) return fail("manifest_digest_mismatch");
  if (manifest.chunks.some((chunk, i) => chunk.index !== i)) return fail("manifest_chunk_index_invalid");

  // The caller's own ceiling wins over whatever the manifest declares about itself.
  const chunkBytesMax = Math.min(manifest.chunkBytesMax, expected.chunkBytesMax ?? Infinity);
  let total = 0;
  let segmentCount = 0;
  const parsed = new Map<string, Segment[]>();
  for (const chunk of manifest.chunks) {
    const body = chunkBodies[chunk.chunkId];
    if (body === undefined) return fail("manifest_chunk_missing");
    const length = bytes(body);
    if (length !== chunk.byteLength) return fail("manifest_chunk_length_mismatch");
    if (length > chunkBytesMax) return fail("manifest_chunk_too_large");
    if (sha(body) !== chunk.sha256) return fail("manifest_chunk_sha256_mismatch");
    total += length;
    try {
      const segments: unknown = JSON.parse(body);
      if (!Array.isArray(segments) || !segments.every(wellFormed)) return fail("manifest_chunk_unreadable");
      parsed.set(chunk.chunkId, segments as Segment[]);
      segmentCount += segments.length;
    } catch {
      return fail("manifest_chunk_unreadable");
    }
  }
  if (total !== manifest.totalBytes) return fail("manifest_total_mismatch");

  if (new Set(manifest.documents.map((d) => d.documentId)).size !== manifest.documents.length) return fail("manifest_document_invalid");
  const indexOf = new Map(manifest.chunks.map((c) => [c.chunkId, c.index]));
  let consumed = 0;
  const documents: RequestDocument[] = [];
  for (const entry of manifest.documents) {
    let previous: number | undefined;
    for (const chunkId of entry.chunkIds) {
      const index = indexOf.get(chunkId);
      if (index === undefined) return fail("manifest_document_chunk_missing");
      if (previous !== undefined && index !== previous + 1) return fail("manifest_document_invalid");
      previous = index;
    }
    let header: Segment["header"];
    const regions: RequestDocument["regions"] = [];
    for (const chunkId of entry.chunkIds) {
      const segments = parsed.get(chunkId);
      if (!segments) return fail("manifest_document_chunk_missing");
      const own = segments.filter((s) => s.documentId === entry.documentId);
      if (!own.length) return fail("manifest_document_invalid");
      consumed += own.length;
      for (const segment of own) {
        if (segment.header) {
          if (header) return fail("manifest_document_invalid");
          header = segment.header;
        } else if (!header) return fail("manifest_document_invalid");
        regions.push(...segment.regions);
      }
    }
    if (!header || header.nativeId !== entry.documentId) return fail("manifest_document_invalid");
    documents.push({ ...header, regions });
  }
  // Every segment of every chunk belongs to exactly one listed document, once.
  if (consumed !== segmentCount) return fail("manifest_document_invalid");
  return { ok: true, documents };
}
