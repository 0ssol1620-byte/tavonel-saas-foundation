/** Internal evidence only. Pages are observations; credits remain the fixed 0|2 ledger facts. */
export const COMPLETED_READ_SCHEMA = "tavonel.completed_read.v1" as const;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;
const DOCUMENT = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export type QualifiedReaderBinding = {
  schemaVersion: "tavonel.qualified_reader_binding.v1";
  endpoint: string;
  readerRevision: string;
  qualificationSha256: string;
};

/** This is an independently qualified immutable deployment, never a revision guessed from a URL.
 * The database must also contain the exact reviewed binding. No binding ships enabled. */
export function parseReaderBinding(raw: string | undefined, endpoint: string): QualifiedReaderBinding | null {
  let value: unknown;
  try { value = JSON.parse(raw ?? ""); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "endpoint,qualificationSha256,readerRevision,schemaVersion"
    || row.schemaVersion !== "tavonel.qualified_reader_binding.v1" || row.endpoint !== endpoint
    || typeof row.readerRevision !== "string" || !DIGEST.test(row.readerRevision)
    || typeof row.qualificationSha256 !== "string" || !DIGEST.test(row.qualificationSha256)) return null;
  try {
    const url = new URL(endpoint);
    if (endpoint.length > 512 || url.protocol !== "https:" || url.username || url.password || url.hash || url.search) return null;
  } catch { return null; }
  return row as QualifiedReaderBinding;
}

export async function readerBindingSha256(binding: QualifiedReaderBinding): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([
    binding.schemaVersion, binding.endpoint, binding.readerRevision, binding.qualificationSha256,
  ]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export type CompletedReadFacts = {
  schemaVersion: typeof COMPLETED_READ_SCHEMA;
  workspaceKey: string;
  documentId: string;
  originalKey: string;
  originalSha256: string;
  sanitizedKey: string;
  sanitizedSha256: string;
  ocrKey: string;
  ocrSha256: string;
  observedPageCount: number;
  readerRevision: string;
  readerBindingSha256: string;
};

/** Exact wire shape, scoped object keys and independent original/sanitized digests. */
export function parseCompletedReadFacts(value: unknown): CompletedReadFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as CompletedReadFacts;
  if (Object.keys(row).sort().join(",") !== "documentId,observedPageCount,ocrKey,ocrSha256,originalKey,originalSha256,readerBindingSha256,readerRevision,sanitizedKey,sanitizedSha256,schemaVersion,workspaceKey"
    || row.schemaVersion !== COMPLETED_READ_SCHEMA
    || typeof row.workspaceKey !== "string" || !WORKSPACE.test(row.workspaceKey)
    || typeof row.documentId !== "string" || !DOCUMENT.test(row.documentId)
    || [row.originalKey, row.sanitizedKey, row.ocrKey].some(key => typeof key !== "string")
    || [row.originalSha256, row.sanitizedSha256, row.ocrSha256, row.readerRevision, row.readerBindingSha256]
      .some(digest => typeof digest !== "string" || !DIGEST.test(digest))
    || !Number.isInteger(row.observedPageCount) || row.observedPageCount < 1 || row.observedPageCount > 80) return null;
  const prefix = `immutable/${row.workspaceKey}/${row.workspaceKey}/${row.documentId}/${row.sanitizedSha256.slice(7)}`;
  if (row.originalKey !== `quarantine/${row.workspaceKey}/${row.documentId}/source`
    || row.sanitizedKey !== `${prefix}/sanitized.pdf` || row.ocrKey !== `${prefix}/ocr.json`) return null;
  return row;
}
