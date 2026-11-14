/**
 * A workspace this deployment minted for a drill and nothing else.
 *
 * The deletion drill has to write real objects under `quarantine/` and `immutable/`, because a
 * deletion rehearsed only against `synthetic/` proves nothing about the prefixes the sweeper
 * actually walks. What makes that safe is the workspace, not the prefix: a probe workspace is
 * created by the drill, holds nothing but its own few hundred bytes, and cannot collide with a
 * `pilot-` key a customer was issued.
 */
export const PROBE_WORKSPACE_PATTERN = /^pilot-drill[0-9a-f]{8}$/;

export const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
export const COLLECTION_ID_PATTERN = /^collection-[a-f0-9]{32}$/;

export function immutableWorkspacePrefix(workspaceId: string): string {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    return "";
  }
  return `immutable/${workspaceId}/${workspaceId}/`;
}

export function isKeyInsideWorkspacePrefix(workspaceId: string, key: string): boolean {
  const prefix = immutableWorkspacePrefix(workspaceId);
  if (!prefix || !key) {
    return false;
  }
  if (key.includes("..") || key.includes("\\") || key.includes("//") || key.startsWith("/") || key.startsWith("immutable/../")) {
    return false;
  }
  if (!key.startsWith(prefix)) {
    return false;
  }
  const rest = key.slice(prefix.length);
  if (!rest || rest.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return false;
  }
  return true;
}

export function isOcrJsonKey(workspaceId: string, key: string): boolean {
  return isKeyInsideWorkspacePrefix(workspaceId, key) && key.endsWith("/ocr.json");
}

export function isCdrReceiptKey(workspaceId: string, key: string): boolean {
  return isKeyInsideWorkspacePrefix(workspaceId, key) && key.endsWith("/cdr-receipt.json");
}

export function isOcrReviewKey(workspaceId: string, key: string): boolean {
  return isKeyInsideWorkspacePrefix(workspaceId, key) && key.endsWith("/ocr-review.json");
}

export function isSanitizedPdfKey(workspaceId: string, key: string): boolean {
  return isKeyInsideWorkspacePrefix(workspaceId, key) && key.endsWith("/sanitized.pdf");
}

export function collectionCandidateKey(workspaceId: string, collectionId: string, manifestDigest: string): string {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId) || !COLLECTION_ID_PATTERN.test(collectionId) || !/^[a-f0-9]{64}$/.test(manifestDigest)) {
    return "";
  }
  return `${immutableWorkspacePrefix(workspaceId)}collections/${collectionId}/${manifestDigest}/candidate-world.json`;
}

export function isCollectionCandidateKey(workspaceId: string, key: string): boolean {
  if (!isKeyInsideWorkspacePrefix(workspaceId, key)) return false;
  const rest = key.slice(immutableWorkspacePrefix(workspaceId).length);
  const parts = rest.split("/");
  return parts.length === 4 && parts[0] === "collections" && COLLECTION_ID_PATTERN.test(parts[1] ?? "") && /^[a-f0-9]{64}$/.test(parts[2] ?? "") && parts[3] === "candidate-world.json";
}

export type ImmutableObjectMeta = {
  key: string;
  size: number;
  /** R2 ListObjectsV2 observation time. Undefined only for legacy/test callers. */
  lastModified?: string;
};

export type DocumentListItem = {
  documentId: string;
  versionKey: string;
  sanitizedKey: string | null;
  sanitizedSize: number | null;
  /** Time the sanitized representation itself became durable, never an OCR sidecar time. */
  sanitizedObservedAt?: string | null;
  ocrJsonKey: string | null;
  ocrJsonSize: number | null;
  hasOcrJson: boolean;
  cdrReceiptKey: string | null;
  ocrReviewKey: string | null;
  processingState: "sanitized" | "ocr_ready" | "operator_review";
  ocrReviewReasonCode?: string;
  /*
    A segmented source (ADR-0006): one logical source whose readings are its page ranges.

    Present only when `<doc>/segments/manifest.json` is listed; ranges without it are never listed
    (the worker writes the manifest last, after every range has an ocr.json). The fields above then
    describe the range that starts at page 1, so the preview, the progress capability and the
    digest checks keep working on one ordinary sanitized PDF. Every range version found is listed,
    a repeated range included: `selectCurrentDocumentVersions` refuses that as ambiguous, and the
    compile verifies the manifest against this list before it reads anything.
  */
  segments?: DocumentSegment[];
  segmentManifestKey?: string;
};

/** One page range of a segmented source: 0-based, end-exclusive, in original page numbers. */
export type DocumentSegment = {
  start0: number;
  end0: number;
  versionKey: string;
  sanitizedKey: string | null;
  ocrJsonKey: string | null;
};

const SEGMENT_RANGE = /^(0|[1-9][0-9]{0,5})-([1-9][0-9]{0,5})$/;

export function groupImmutableDocuments(
  workspaceId: string,
  objects: ImmutableObjectMeta[],
): DocumentListItem[] {
  const grouped = new Map<string, DocumentListItem>();
  const manifests = new Map<string, string>();
  const ranges = new Map<string, Map<string, DocumentSegment & { observedAt: string | null; size: number | null }>>();
  for (const object of objects) {
    if (!isKeyInsideWorkspacePrefix(workspaceId, object.key)) {
      continue;
    }
    const prefix = immutableWorkspacePrefix(workspaceId);
    const rest = object.key.slice(prefix.length);
    const parts = rest.split("/");
    if (parts[1] === "segments" && DOCUMENT_ID_PATTERN.test(parts[0])) {
      const [documentId, , range, versionKey, filename] = parts;
      if (parts.length === 3 && range === "manifest.json") manifests.set(documentId, object.key);
      const bounds = parts.length === 5 ? SEGMENT_RANGE.exec(range) : null;
      if (!bounds || !/^[a-f0-9]{64}$/.test(versionKey) || (filename !== "sanitized.pdf" && filename !== "ocr.json")) continue;
      const start0 = Number(bounds[1]);
      const end0 = Number(bounds[2]);
      if (end0 <= start0) continue;
      const byRange = ranges.get(documentId) ?? new Map();
      const segment = byRange.get(`${range}/${versionKey}`)
        ?? { start0, end0, versionKey, sanitizedKey: null, ocrJsonKey: null, observedAt: null, size: null };
      if (filename === "sanitized.pdf") {
        segment.sanitizedKey = object.key;
        segment.size = object.size;
        segment.observedAt = validInstant(object.lastModified) ? object.lastModified : null;
      } else {
        segment.ocrJsonKey = object.key;
      }
      byRange.set(`${range}/${versionKey}`, segment);
      ranges.set(documentId, byRange);
      continue;
    }
    if (parts.length !== 3) {
      continue;
    }
    const [documentId, versionKey, filename] = parts;
    if (!DOCUMENT_ID_PATTERN.test(documentId) || !/^[a-f0-9]{32,64}$/i.test(versionKey)) {
      continue;
    }
    const id = `${documentId}/${versionKey}`;
    const current =
      grouped.get(id) ??
      ({
        documentId,
        versionKey,
        sanitizedKey: null,
        sanitizedSize: null,
        sanitizedObservedAt: null,
        ocrJsonKey: null,
        ocrJsonSize: null,
        hasOcrJson: false,
        cdrReceiptKey: null,
        ocrReviewKey: null,
        processingState: "sanitized",
      } satisfies DocumentListItem);
    if (filename === "sanitized.pdf") {
      current.sanitizedKey = object.key;
      current.sanitizedSize = object.size;
      current.sanitizedObservedAt = validInstant(object.lastModified) ? object.lastModified! : null;
    } else if (filename === "ocr.json") {
      current.ocrJsonKey = object.key;
      current.ocrJsonSize = object.size;
      current.hasOcrJson = true;
      current.processingState = "ocr_ready";
    } else if (filename === "cdr-receipt.json") {
      current.cdrReceiptKey = object.key;
    } else if (filename === "ocr-review.json") {
      current.ocrReviewKey = object.key;
      if (!current.hasOcrJson) current.processingState = "operator_review";
    } else {
      continue;
    }
    grouped.set(id, current);
  }
  for (const [documentId, manifestKey] of manifests) {
    const found = [...(ranges.get(documentId)?.values() ?? [])]
      .sort((left, right) => left.start0 - right.start0 || left.versionKey.localeCompare(right.versionKey));
    const first = found.find((segment) => segment.start0 === 0);
    const segments = found.map(({ start0, end0, versionKey, sanitizedKey, ocrJsonKey }) =>
      ({ start0, end0, versionKey, sanitizedKey, ocrJsonKey }));
    const hasOcrJson = segments.length > 0 && segments.every((segment) => segment.sanitizedKey && segment.ocrJsonKey);
    grouped.set(`${documentId}/segments`, {
      documentId,
      versionKey: first?.versionKey ?? "",
      sanitizedKey: first?.sanitizedKey ?? null,
      sanitizedSize: first?.size ?? null,
      sanitizedObservedAt: first?.observedAt ?? null,
      ocrJsonKey: first?.ocrJsonKey ?? null,
      ocrJsonSize: null,
      hasOcrJson,
      cdrReceiptKey: null,
      ocrReviewKey: null,
      processingState: "sanitized",
      segments,
      segmentManifestKey: manifestKey,
    });
  }
  return [...grouped.values()].map((item) => ({
    ...item,
    processingState: item.hasOcrJson ? "ocr_ready" : item.ocrReviewKey ? "operator_review" : "sanitized",
  }));
}

function validInstant(value: string | undefined): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

export type CurrentDocumentSelection = {
  documents: DocumentListItem[];
  ambiguousDocumentIds: string[];
};

export type SourceVersionReference = {
  documentId: string;
  versionKey: string;
};

export type CurrentSourceVersionCheck =
  | { ok: true }
  | { ok: false; code: "SOURCE_VERSION_AMBIGUOUS" | "SOURCE_VERSION_CHANGED"; documentIds: string[] };

/** Compare a source-bound candidate with one complete workspace inventory. */
export function checkCurrentSourceVersions(
  workspaceId: string,
  objects: readonly ImmutableObjectMeta[],
  expected: readonly SourceVersionReference[],
): CurrentSourceVersionCheck {
  const selected = selectCurrentDocumentVersions(groupImmutableDocuments(workspaceId, [...objects]));
  const expectedIds = new Set(expected.map((item) => item.documentId));
  const ambiguous = selected.ambiguousDocumentIds.filter((id) => expectedIds.has(id)).sort();
  if (ambiguous.length > 0) {
    return { ok: false, code: "SOURCE_VERSION_AMBIGUOUS", documentIds: ambiguous };
  }
  const changed = expected.flatMap((item) => {
    const current = selected.documents.find((candidate) => candidate.documentId === item.documentId);
    // A segmented source is compiled as its ranges, so a candidate names each range's version.
    const versions = current?.segments ? current.segments.map((segment) => segment.versionKey) : [current?.versionKey];
    return versions.includes(item.versionKey) ? [] : [item.documentId];
  });
  return changed.length > 0
    ? { ok: false, code: "SOURCE_VERSION_CHANGED", documentIds: [...new Set(changed)].sort() }
    : { ok: true };
}

/**
 * Choose the current immutable representation for every logical document.
 *
 * OCR completion is deliberately not a selector. A finished historical OCR must never outrank a
 * newer sanitized representation that is still being read. R2's sanitized-object observation
 * time is the only chronology available on this path today. If more than one version exists and
 * that chronology is missing or tied, the caller receives an explicit ambiguity rather than an
 * arbitrary array-order winner.
 */
export function selectCurrentDocumentVersions(documents: readonly DocumentListItem[]): CurrentDocumentSelection {
  const byDocument = new Map<string, DocumentListItem[]>();
  for (const document of documents) {
    const versions = byDocument.get(document.documentId) ?? [];
    versions.push(document);
    byDocument.set(document.documentId, versions);
  }

  const current: DocumentListItem[] = [];
  const ambiguousDocumentIds: string[] = [];
  for (const [documentId, versions] of byDocument) {
    // Two versions of one range: the manifest pins one, and nothing short of reading it may choose.
    if (versions.some((version) => new Set(version.segments?.map((segment) => segment.start0)).size !== (version.segments?.length ?? 0))) {
      ambiguousDocumentIds.push(documentId);
      continue;
    }
    if (versions.length === 1) {
      current.push(versions[0]!);
      continue;
    }
    const observed = versions.map((version) => ({
      version,
      instant: validInstant(version.sanitizedObservedAt ?? undefined)
        ? Date.parse(version.sanitizedObservedAt!)
        : null,
    }));
    if (observed.some((item) => item.instant === null)) {
      ambiguousDocumentIds.push(documentId);
      continue;
    }
    const latest = Math.max(...observed.map((item) => item.instant!));
    const winners = observed.filter((item) => item.instant === latest);
    if (winners.length !== 1) {
      ambiguousDocumentIds.push(documentId);
      continue;
    }
    current.push(winners[0]!.version);
  }
  return { documents: current, ambiguousDocumentIds };
}

/*
  A segmented source's manifest (worker `src/sanitize.ts`, "Segmented sources"), checked before any
  range of it is read.

  The manifest is the worker's statement that every range was read; the listing is what exists.
  A compile reads only when the two agree exactly: the ranges start at page 1, follow each other
  with no gap and no overlap to `totalPages`, each is at most one CDR request, each key is the one
  the worker's key shape gives for that range inside this workspace and this document, and every
  one of them is listed with its ocr.json. Anything else is a named refusal, never a partial read.
*/
export const SEGMENT_MANIFEST_SCHEMA = "tavonel.source_segments.v1";
/** The worker's bound for plan.json and manifest.json (`MAX_SEGMENT_RECORD_BYTES`). */
export const SEGMENT_MANIFEST_MAX_BYTES = 256 * 1024;
/** One CDR request (`app.py` MAX_PAGES); the worker refuses a larger `FOUNDATION_SOURCE_SEGMENT_PAGES`. */
const MAX_SEGMENT_PAGES = 80;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

export type SegmentManifestRefusalCode =
  | "SEGMENT_MANIFEST_SCHEMA_INVALID"
  | "SEGMENT_MANIFEST_SOURCE_MISMATCH"
  | "SEGMENT_MANIFEST_RANGE_GAP"
  | "SEGMENT_MANIFEST_RANGE_OVERLAP"
  | "SEGMENT_MANIFEST_RANGE_INVALID"
  | "SEGMENT_MANIFEST_KEY_FOREIGN"
  | "SEGMENT_MANIFEST_RANGE_MISSING"
  | "SEGMENT_RANGE_NOT_IN_MANIFEST"
  | "SEGMENT_RANGES_SHARE_BYTES";

export type VerifiedSegment = { start0: number; end0: number; versionKey: string; sanitizedKey: string; ocrJsonKey: string };

export function verifySegmentManifest(
  workspaceId: string,
  item: DocumentListItem,
  value: unknown,
): { ok: true; totalPages: number; segments: VerifiedSegment[] } | { ok: false; code: SegmentManifestRefusalCode; start0?: number } {
  const refuse = (code: SegmentManifestRefusalCode, start0?: number) =>
    ({ ok: false as const, code, ...(start0 === undefined ? {} : { start0 }) });
  const isInteger = (number: unknown): number is number => Number.isSafeInteger(number);
  const manifest = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const prefix = immutableWorkspacePrefix(workspaceId);
  if (
    !manifest || !prefix || manifest.schemaVersion !== SEGMENT_MANIFEST_SCHEMA ||
    !isInteger(manifest.totalPages) || manifest.totalPages < 1 ||
    !isInteger(manifest.segmentPages) || manifest.segmentPages < 1 || manifest.segmentPages > MAX_SEGMENT_PAGES ||
    !Array.isArray(manifest.segments) || manifest.segments.length < 1 || manifest.segments.length > manifest.totalPages
  ) return refuse("SEGMENT_MANIFEST_SCHEMA_INVALID");
  if (
    manifest.sourceKey !== `quarantine/${workspaceId}/${item.documentId}/source` ||
    typeof manifest.inputSha256 !== "string" || !SHA256_DIGEST.test(manifest.inputSha256)
  ) return refuse("SEGMENT_MANIFEST_SOURCE_MISMATCH");
  const { totalPages, segmentPages } = manifest;

  const segments: VerifiedSegment[] = [];
  let next0 = 0;
  for (const raw of manifest.segments as unknown[]) {
    const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (
      !row || !isInteger(row.start0) || !isInteger(row.end0) ||
      typeof row.sanitizedSha256 !== "string" || !SHA256_DIGEST.test(row.sanitizedSha256) ||
      typeof row.immutableKey !== "string" || typeof row.ocrKey !== "string"
    ) return refuse("SEGMENT_MANIFEST_SCHEMA_INVALID");
    const { start0, end0 } = row;
    if (start0 > next0) return refuse("SEGMENT_MANIFEST_RANGE_GAP", next0);
    if (start0 < next0) return refuse("SEGMENT_MANIFEST_RANGE_OVERLAP", start0);
    if (end0 <= start0 || end0 - start0 > segmentPages || end0 > totalPages) return refuse("SEGMENT_MANIFEST_RANGE_INVALID", start0);
    const versionKey = row.sanitizedSha256.slice("sha256:".length);
    const sanitizedKey = `${prefix}${item.documentId}/segments/${start0}-${end0}/${versionKey}/sanitized.pdf`;
    const ocrJsonKey = `${sanitizedKey.slice(0, -"sanitized.pdf".length)}ocr.json`;
    if (row.immutableKey !== sanitizedKey || row.ocrKey !== ocrJsonKey) return refuse("SEGMENT_MANIFEST_KEY_FOREIGN", start0);
    segments.push({ start0, end0, versionKey, sanitizedKey, ocrJsonKey });
    next0 = end0;
  }
  if (next0 !== totalPages) return refuse("SEGMENT_MANIFEST_RANGE_GAP", next0);

  const listed = item.segments ?? [];
  const missing = segments.find((segment) => !listed.some((found) => found.start0 === segment.start0 &&
    found.end0 === segment.end0 && found.sanitizedKey === segment.sanitizedKey && found.ocrJsonKey === segment.ocrJsonKey));
  if (missing) return refuse("SEGMENT_MANIFEST_RANGE_MISSING", missing.start0);
  const unexplained = listed.find((found) => !segments.some((segment) => segment.start0 === found.start0 &&
    segment.end0 === found.end0 && segment.versionKey === found.versionKey));
  if (unexplained) return refuse("SEGMENT_RANGE_NOT_IN_MANIFEST", unexplained.start0);
  // A citation is joined back to its source by content digest, so two ranges with one digest
  // could not be told apart downstream (collection-source-access.ts).
  if (new Set(segments.map((segment) => segment.versionKey)).size !== segments.length) return refuse("SEGMENT_RANGES_SHARE_BYTES");
  return { ok: true, totalPages, segments };
}

/**
 * The one sanitized PDF a source read serves, and where its first page sits in the original.
 *
 * A whole document is its own PDF at offset 0. A segmented source is served one range at a time:
 * `version` names a range, `page1` an original page, and the read is that range's PDF at
 * `localPage1 = page1 - pageStart0`. Neither given is the range that starts at page 1. A request
 * that matches no range, or more than one, is null: the caller answers NOT_FOUND, never a guess.
 */
export function sourceReadTarget(
  item: DocumentListItem,
  version: string | null,
  page1: number | null,
): { versionKey: string; sanitizedKey: string; pageStart0: number; localPage1: number | null } | null {
  if (!item.segments) {
    return item.sanitizedKey && (!version || item.versionKey === version)
      ? { versionKey: item.versionKey, sanitizedKey: item.sanitizedKey, pageStart0: 0, localPage1: page1 }
      : null;
  }
  const page = page1 ?? (version ? null : 1);
  const hits = item.segments.filter((segment) => segment.sanitizedKey && (!version || segment.versionKey === version) &&
    (page === null || (page > segment.start0 && page <= segment.end0)));
  if (hits.length !== 1) return null;
  const [hit] = hits;
  return { versionKey: hit.versionKey, sanitizedKey: hit.sanitizedKey!, pageStart0: hit.start0,
    localPage1: page1 === null ? null : page1 - hit.start0 };
}
