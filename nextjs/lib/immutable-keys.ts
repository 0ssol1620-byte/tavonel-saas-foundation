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
};

export function groupImmutableDocuments(
  workspaceId: string,
  objects: ImmutableObjectMeta[],
): DocumentListItem[] {
  const grouped = new Map<string, DocumentListItem>();
  for (const object of objects) {
    if (!isKeyInsideWorkspacePrefix(workspaceId, object.key)) {
      continue;
    }
    const prefix = immutableWorkspacePrefix(workspaceId);
    const rest = object.key.slice(prefix.length);
    const parts = rest.split("/");
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
    return current?.versionKey === item.versionKey ? [] : [item.documentId];
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
