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
};

export type DocumentListItem = {
  documentId: string;
  versionKey: string;
  sanitizedKey: string | null;
  sanitizedSize: number | null;
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
