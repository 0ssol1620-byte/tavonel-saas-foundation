import { createHash } from "node:crypto";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_KEY = /^ws_[a-z0-9]{8,64}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const REASON_CODE = /^[A-Z0-9_]{3,80}$/;

export const LARGE_DOCUMENT_POLICY = {
  schemaVersion: "tavonel.large_document_policy.v1",
  directUploadMaxBytes: 5 * 1024 * 1024,
  directUploadMaxPages: 80,
  splitSourceMaxBytes: 2 * 1024 * 1024 * 1024,
  splitSourceMaxPages: 10_000,
  splitPartMaxBytes: 5 * 1024 * 1024,
  splitPartMaxPages: 80,
  splitPartLimit: 256,
  acceptedMimeTypes: [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/tiff",
  ],
} as const;

export type LargeDocumentAdmissionInput = {
  workspaceKey: string;
  documentId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  pageCount: number;
  sourceSha256: string;
};

export type LargeDocumentAdmission =
  | { ok: false; code: string }
  | {
      ok: true;
      decision: "direct" | "split";
      schemaVersion: "tavonel.large_document_admission.v1";
      source: LargeDocumentAdmissionInput;
      parts: Array<{
        partId: string;
        firstPage: number;
        lastPage: number;
        objectSuffix: string;
        maxBytes: number;
        requiresByteVerification: true;
      }>;
      invariants: {
        sourceDigestRequired: true;
        preservePageOrder: true;
        rejectEncryptedOutput: true;
        recursivelySplitOversizeParts: true;
        compileOnlyAfterAllPartsReady: true;
      };
    };

function safePositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

export function planLargeDocumentAdmission(
  input: LargeDocumentAdmissionInput
): LargeDocumentAdmission {
  if (!WORKSPACE_KEY.test(input.workspaceKey) || !UUID.test(input.documentId)) {
    return { ok: false, code: "DOCUMENT_IDENTITY_INVALID" };
  }
  if (
    !input.fileName ||
    input.fileName.length > 255 ||
    /[\\/\0]/.test(input.fileName)
  ) {
    return { ok: false, code: "FILE_NAME_INVALID" };
  }
  if (
    !LARGE_DOCUMENT_POLICY.acceptedMimeTypes.includes(input.mimeType as never)
  ) {
    return { ok: false, code: "MIME_TYPE_UNSUPPORTED" };
  }
  if (
    !safePositiveInteger(input.byteSize) ||
    !safePositiveInteger(input.pageCount) ||
    !SHA256.test(input.sourceSha256)
  ) {
    return { ok: false, code: "SOURCE_METADATA_INVALID" };
  }

  const direct =
    input.byteSize <= LARGE_DOCUMENT_POLICY.directUploadMaxBytes &&
    input.pageCount <= LARGE_DOCUMENT_POLICY.directUploadMaxPages;
  if (!direct && input.mimeType !== "application/pdf") {
    return { ok: false, code: "NON_PDF_SPLIT_UNSUPPORTED" };
  }
  if (input.byteSize > LARGE_DOCUMENT_POLICY.splitSourceMaxBytes) {
    return { ok: false, code: "SOURCE_TOO_LARGE" };
  }
  if (input.pageCount > LARGE_DOCUMENT_POLICY.splitSourceMaxPages) {
    return { ok: false, code: "SOURCE_TOO_MANY_PAGES" };
  }

  const averagePageBytes = Math.ceil(input.byteSize / input.pageCount);
  const estimatedBytePageLimit = Math.max(
    1,
    Math.floor(LARGE_DOCUMENT_POLICY.splitPartMaxBytes / averagePageBytes)
  );
  const pagesPerPart = direct
    ? input.pageCount
    : Math.min(LARGE_DOCUMENT_POLICY.splitPartMaxPages, estimatedBytePageLimit);
  const partCount = Math.ceil(input.pageCount / pagesPerPart);
  if (partCount > LARGE_DOCUMENT_POLICY.splitPartLimit) {
    return { ok: false, code: "SPLIT_PART_LIMIT_EXCEEDED" };
  }
  const extension = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/tiff": "tiff",
  }[input.mimeType];

  const parts = Array.from({ length: partCount }, (_, index) => {
    const ordinal = String(index + 1).padStart(4, "0");
    const firstPage = index * pagesPerPart + 1;
    return {
      partId: `part-${ordinal}`,
      firstPage,
      lastPage: Math.min(input.pageCount, firstPage + pagesPerPart - 1),
      objectSuffix: `parts/${ordinal}.${extension}`,
      maxBytes: LARGE_DOCUMENT_POLICY.splitPartMaxBytes,
      requiresByteVerification: true as const,
    };
  });

  return {
    ok: true,
    decision: direct ? "direct" : "split",
    schemaVersion: "tavonel.large_document_admission.v1",
    source: input,
    parts,
    invariants: {
      sourceDigestRequired: true,
      preservePageOrder: true,
      rejectEncryptedOutput: true,
      recursivelySplitOversizeParts: true,
      compileOnlyAfterAllPartsReady: true,
    },
  };
}

const RELEASE_REASONS = new Set([
  "OCR_SOURCE_MISSING",
  "OCR_SOURCE_EMPTY",
  "OCR_TIMEOUT_OR_NETWORK",
  "OCR_HTTP_REJECTED",
  "OCR_RESPONSE_NOT_JSON",
  "OCR_RESPONSE_INVALID",
  "OCR_RESULT_WRITE_FAILED",
  "OCR_LOW_TEXT_YIELD",
  "CDR_TERMINAL_FAILURE",
  "MALWARE_REJECTED",
  "SPLIT_TERMINAL_FAILURE",
  "OPERATOR_REVIEW_REQUIRED",
]);

export function buildCreditRelease(input: {
  workspaceKey: string;
  documentId: string;
  terminalState: "failed_terminal" | "operator_review";
  reasonCode: string;
}) {
  if (
    !WORKSPACE_KEY.test(input.workspaceKey) ||
    !UUID.test(input.documentId) ||
    !REASON_CODE.test(input.reasonCode) ||
    !RELEASE_REASONS.has(input.reasonCode)
  ) {
    return { ok: false as const, code: "CREDIT_RELEASE_INVALID" };
  }
  const releaseKey = createHash("sha256")
    .update(
      `${input.workspaceKey}:${input.documentId}:${input.terminalState}:${input.reasonCode}`
    )
    .digest("hex");
  return {
    ok: true as const,
    settlement: {
      schemaVersion: "tavonel.credit_release.v1" as const,
      workspaceKey: input.workspaceKey,
      documentId: input.documentId,
      outcome: "released" as const,
      actualCredits: 0,
      reasonCode: input.reasonCode,
      releaseKey: `sha256:${releaseKey}`,
      retryPolicy: "new_reservation_required" as const,
    },
  };
}

export type DeletionEvidenceInput = {
  evidenceId: string;
  workspaceKey: string;
  requestedAt: string;
  completedAt: string;
  scope: "document" | "workspace" | "account";
  subjectId: string;
  deletedObjectCount: number;
  deletedRowCount: number;
  storageListingEmpty: boolean;
  databaseLookupEmpty: boolean;
  backupExpiryRecorded: boolean;
  auditDigest: string;
};

function validTimeOrder(start: string, end: string) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
}

export function issueDeletionEvidence(input: DeletionEvidenceInput) {
  if (
    !UUID.test(input.evidenceId) ||
    !WORKSPACE_KEY.test(input.workspaceKey) ||
    !input.subjectId ||
    input.subjectId.length > 128 ||
    !validTimeOrder(input.requestedAt, input.completedAt) ||
    !Number.isSafeInteger(input.deletedObjectCount) ||
    input.deletedObjectCount < 0 ||
    !Number.isSafeInteger(input.deletedRowCount) ||
    input.deletedRowCount < 0 ||
    !input.storageListingEmpty ||
    !input.databaseLookupEmpty ||
    !input.backupExpiryRecorded ||
    !SHA256.test(input.auditDigest)
  ) {
    return { ok: false as const, code: "DELETION_NOT_PROVEN" };
  }
  return {
    ok: true as const,
    evidence: {
      schemaVersion: "tavonel.deletion_evidence.v1" as const,
      ...input,
      outcome: "verified_deleted" as const,
    },
  };
}

export type RestoreEvidenceInput = {
  evidenceId: string;
  backupId: string;
  snapshotAt: string;
  startedAt: string;
  completedAt: string;
  isolatedDestination: boolean;
  sourceManifestDigest: string;
  restoredManifestDigest: string;
  expectedRowCount: number;
  restoredRowCount: number;
  integrityChecksPassed: number;
  cleanupCompletedAt: string;
};

export function issueRestoreEvidence(input: RestoreEvidenceInput) {
  const completedMs = Date.parse(input.completedAt);
  const cleanupMs = Date.parse(input.cleanupCompletedAt);
  if (
    !UUID.test(input.evidenceId) ||
    !input.backupId ||
    input.backupId.length > 128 ||
    !validTimeOrder(input.startedAt, input.completedAt) ||
    !Number.isFinite(Date.parse(input.snapshotAt)) ||
    !input.isolatedDestination ||
    !SHA256.test(input.sourceManifestDigest) ||
    input.sourceManifestDigest !== input.restoredManifestDigest ||
    !Number.isSafeInteger(input.expectedRowCount) ||
    input.expectedRowCount < 0 ||
    input.restoredRowCount !== input.expectedRowCount ||
    !Number.isSafeInteger(input.integrityChecksPassed) ||
    input.integrityChecksPassed < 1 ||
    !Number.isFinite(cleanupMs) ||
    cleanupMs < completedMs
  ) {
    return { ok: false as const, code: "RESTORE_NOT_PROVEN" };
  }
  return {
    ok: true as const,
    evidence: {
      schemaVersion: "tavonel.restore_evidence.v1" as const,
      ...input,
      outcome: "verified_restored" as const,
      recoveryTimeSeconds: Math.ceil(
        (completedMs - Date.parse(input.startedAt)) / 1000
      ),
    },
  };
}

type AlertInput = {
  alertId: string;
  kind: "incident" | "cost";
  severity: "info" | "warning" | "critical";
  service: "web" | "supabase" | "r2" | "cdr" | "runpod" | "billing";
  summary: string;
  observedAt: string;
  currentValue?: number;
  thresholdValue?: number;
  unit?: "usd" | "percent" | "count" | "seconds";
  runbookUrl: string;
};

export function buildOperationsAlert(input: AlertInput) {
  const hasMetric =
    input.currentValue !== undefined ||
    input.thresholdValue !== undefined ||
    input.unit !== undefined;
  if (
    !UUID.test(input.alertId) ||
    input.summary.length < 8 ||
    input.summary.length > 240 ||
    !Number.isFinite(Date.parse(input.observedAt)) ||
    !input.runbookUrl.startsWith("https://") ||
    (input.kind === "cost" && (!hasMetric || input.unit !== "usd")) ||
    (hasMetric &&
      (!Number.isFinite(input.currentValue) ||
        !Number.isFinite(input.thresholdValue) ||
        !input.unit))
  ) {
    return { ok: false as const, code: "ALERT_PAYLOAD_INVALID" };
  }
  const dedupeKey = createHash("sha256")
    .update(`${input.kind}:${input.service}:${input.summary}`)
    .digest("hex")
    .slice(0, 24);
  return {
    ok: true as const,
    payload: {
      schemaVersion: "tavonel.operations_alert.v1" as const,
      ...input,
      dedupeKey,
      containsCredentials: false as const,
    },
  };
}

export function validateHumanChangeEvidence(input: {
  changeId: string;
  action: "promotion" | "rollback";
  workspaceKey: string;
  requesterId: string;
  approverId: string;
  reason: string;
  candidateDigest: string;
  previousWorldDigest: string;
  resultingWorldDigest: string;
  approvedAt: string;
}) {
  return (
    UUID.test(input.changeId) &&
    WORKSPACE_KEY.test(input.workspaceKey) &&
    input.requesterId.length >= 3 &&
    input.approverId.length >= 3 &&
    input.requesterId !== input.approverId &&
    input.reason.length >= 12 &&
    input.reason.length <= 500 &&
    SHA256.test(input.candidateDigest) &&
    SHA256.test(input.previousWorldDigest) &&
    SHA256.test(input.resultingWorldDigest) &&
    Number.isFinite(Date.parse(input.approvedAt)) &&
    (input.action !== "rollback" ||
      input.resultingWorldDigest === input.previousWorldDigest)
  );
}
