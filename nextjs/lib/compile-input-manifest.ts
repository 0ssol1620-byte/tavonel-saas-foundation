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

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isCount = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
const isSha = (v: unknown) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));

const MANIFEST_KEYS = [
  "schemaVersion", "workspaceId", "collectionId", "requestId", "coreRequestSchema",
  "chunkBytesMax", "totalBytes", "documents", "chunks", "manifestSha256",
] as const;

/**
 * The manifest arrives as hostile JSON, like the chunk bodies: every field is checked for type, range and
 * exact key set before anything reads it, so no later step can meet a NaN ceiling, a null list or an
 * inherited property.
 */
function manifestShaped(m: unknown): m is CompileInputManifest {
  if (!isRecord(m) || !exactKeys(m, MANIFEST_KEYS)) return false;
  const { chunks, documents } = m;
  return (
    isId(m.workspaceId) && isId(m.collectionId) && isId(m.requestId) &&
    isCount(m.chunkBytesMax, 1) && isCount(m.totalBytes) && isSha(m.manifestSha256) &&
    Array.isArray(chunks) && chunks.every((c) =>
      isRecord(c) && exactKeys(c, ["chunkId", "index", "byteLength", "sha256"]) &&
      isId(c.chunkId) && isCount(c.index) && isCount(c.byteLength) && isSha(c.sha256)) &&
    new Set(chunks.map((c: { chunkId: string }) => c.chunkId)).size === chunks.length &&
    Array.isArray(documents) && documents.every((d) =>
      isRecord(d) && exactKeys(d, ["documentId", "versionKey", "chunkIds"]) &&
      isId(d.documentId) && isId(d.versionKey) && Array.isArray(d.chunkIds) && d.chunkIds.every(isId))
  );
}

function wellFormed(value: unknown): value is Segment {
  return (
    isRecord(value) && isId(value.documentId) && Array.isArray(value.regions) && value.regions.every(isRecord) &&
    (value.header === undefined || isRecord(value.header))
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
  const chunkBytesMax = options.chunkBytesMax === undefined ? COMPILE_INPUT_CHUNK_BYTES_MAX : options.chunkBytesMax;
  if (!isCount(chunkBytesMax, 1)) throw new Error("chunkBytesMax must be a positive safe integer");
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
        // An empty range here is only ever the first segment: the header goes out alone and the
        // region starts the first continuation (a continuation's own fit is checked just below).
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
  manifest: unknown,
  chunkBodies: Readonly<Record<string, string>>,
  expected: { workspaceId: string; chunkBytesMax?: number },
): ManifestVerification {
  const fail = (code: ManifestRefusal): ManifestVerification => ({ ok: false, code });
  if (!manifestShaped(manifest) || manifest.schemaVersion !== COMPILE_INPUT_MANIFEST_SCHEMA) return fail("manifest_schema_unknown");
  if (manifest.workspaceId !== expected.workspaceId) return fail("manifest_workspace_foreign");
  if (manifest.coreRequestSchema !== "tavonel.product_core.compile_request.v2") return fail("manifest_schema_unknown");
  const { manifestSha256, ...unsealed } = manifest;
  if (manifestDigest(unsealed) !== manifestSha256) return fail("manifest_digest_mismatch");
  // A caller ceiling that is not a positive integer cannot be honoured, so nothing passes it.
  if (expected.chunkBytesMax !== undefined && !isCount(expected.chunkBytesMax, 1)) return fail("manifest_chunk_too_large");
  if (manifest.chunks.some((chunk, i) => chunk.index !== i)) return fail("manifest_chunk_index_invalid");

  // The caller's own ceiling wins over whatever the manifest declares about itself.
  const chunkBytesMax = Math.min(manifest.chunkBytesMax, expected.chunkBytesMax ?? manifest.chunkBytesMax);
  const bodies: unknown = chunkBodies;
  let total = 0;
  const stream: Array<{ chunkId: string; segment: Segment }> = [];
  for (const chunk of manifest.chunks) {
    const body = isRecord(bodies) && Object.hasOwn(bodies, chunk.chunkId) ? bodies[chunk.chunkId] : undefined;
    if (typeof body !== "string") return fail("manifest_chunk_missing");
    const length = bytes(body);
    if (length !== chunk.byteLength) return fail("manifest_chunk_length_mismatch");
    if (length > chunkBytesMax) return fail("manifest_chunk_too_large");
    if (sha(body) !== chunk.sha256) return fail("manifest_chunk_sha256_mismatch");
    total += length;
    let segments: unknown;
    try {
      segments = JSON.parse(body);
    } catch {
      return fail("manifest_chunk_unreadable");
    }
    if (!Array.isArray(segments) || !segments.every(wellFormed)) return fail("manifest_chunk_unreadable");
    // Only an empty compile has an empty chunk, and then it is the only one.
    if (!segments.length && manifest.chunks.length > 1) return fail("manifest_document_invalid");
    for (const segment of segments) stream.push({ chunkId: chunk.chunkId, segment });
  }
  if (total !== manifest.totalBytes) return fail("manifest_total_mismatch");

  if (new Set(manifest.documents.map((d) => d.documentId)).size !== manifest.documents.length) return fail("manifest_document_invalid");
  const known = new Set(manifest.chunks.map((c) => c.chunkId));
  const documents: RequestDocument[] = [];
  // The segment stream, in chunk order, is the documents in manifest order. Each document is one contiguous
  // run: its header segment, then at most one continuation per following chunk, spanning exactly its chunkIds.
  let at = 0;
  for (const entry of manifest.documents) {
    if (entry.chunkIds.some((id) => !known.has(id))) return fail("manifest_document_chunk_missing");
    const head = stream[at];
    const header = head?.segment.header;
    if (!head || head.segment.documentId !== entry.documentId || !header || header.nativeId !== entry.documentId) {
      return fail("manifest_document_invalid");
    }
    const spanned = [head.chunkId];
    const regions = [...head.segment.regions];
    for (at += 1; at < stream.length && stream[at]!.segment.documentId === entry.documentId; at += 1) {
      const { chunkId, segment } = stream[at]!;
      if (segment.header || chunkId === spanned[spanned.length - 1]) return fail("manifest_document_invalid");
      spanned.push(chunkId);
      regions.push(...segment.regions);
    }
    if (spanned.length !== entry.chunkIds.length || spanned.some((id, i) => id !== entry.chunkIds[i])) {
      return fail("manifest_document_invalid");
    }
    documents.push({ ...header, regions });
  }
  // Every segment of every chunk belongs to exactly one listed document, once.
  if (at !== stream.length) return fail("manifest_document_invalid");
  return { ok: true, documents };
}
