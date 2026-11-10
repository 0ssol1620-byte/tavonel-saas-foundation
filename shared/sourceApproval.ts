/**
 * What intake approved for one source, written beside it before its upload URL exists (ADR-0006, F1).
 *
 * The capability route writes it create-once at `quarantine/<ws>/<doc>/approval.json`, server-side,
 * from the reservation it just made; no presigned URL is ever issued for this key. The worker reads
 * it before segmenting a PDF and never reads a page range past `approvedMaxPages`. A source with no
 * valid approval is treated as approved at one request's pages (80), never more.
 */
export const SOURCE_APPROVAL_SCHEMA = "tavonel.source_approval.v1" as const;
export const SOURCE_APPROVAL_FILENAME = "approval.json";

export type SourceApproval = {
  schemaVersion: typeof SOURCE_APPROVAL_SCHEMA;
  documentId: string;
  approvedMaxPages: number;
  pageBasis: "measured" | "declared" | "unknown";
  reservedCredits: number;
  maximumCredits: number;
};

const FIELDS = "approvedMaxPages,documentId,maximumCredits,pageBasis,reservedCredits,schemaVersion";
const PAGE_BASES: ReadonlySet<string> = new Set(["measured", "declared", "unknown"]);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function sourceApprovalKey(workspaceKey: string, documentId: string): string {
  return `quarantine/${workspaceKey}/${documentId}/${SOURCE_APPROVAL_FILENAME}`;
}

/** The whole shape, for this document, or null. A half-valid approval approves nothing. */
export function parseSourceApproval(value: unknown, documentId: string): SourceApproval | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== FIELDS || row.schemaVersion !== SOURCE_APPROVAL_SCHEMA
    || row.documentId !== documentId || !count(row.approvedMaxPages) || (row.approvedMaxPages as number) < 1
    || typeof row.pageBasis !== "string" || !PAGE_BASES.has(row.pageBasis)
    || !count(row.reservedCredits) || !count(row.maximumCredits)) return null;
  return row as SourceApproval;
}
