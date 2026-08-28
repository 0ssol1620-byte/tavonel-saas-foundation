export const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

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

export function isSanitizedPdfKey(workspaceId: string, key: string): boolean {
  return isKeyInsideWorkspacePrefix(workspaceId, key) && key.endsWith("/sanitized.pdf");
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
      } satisfies DocumentListItem);
    if (filename === "sanitized.pdf") {
      current.sanitizedKey = object.key;
      current.sanitizedSize = object.size;
    } else if (filename === "ocr.json") {
      current.ocrJsonKey = object.key;
      current.ocrJsonSize = object.size;
      current.hasOcrJson = true;
    } else {
      continue;
    }
    grouped.set(id, current);
  }
  return [...grouped.values()];
}
