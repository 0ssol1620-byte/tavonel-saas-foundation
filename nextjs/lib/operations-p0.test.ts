import { describe, expect, it } from "vitest";
import {
  LARGE_DOCUMENT_POLICY,
  buildCreditRelease,
  buildOperationsAlert,
  issueDeletionEvidence,
  issueRestoreEvidence,
  planLargeDocumentAdmission,
  validateHumanChangeEvidence,
} from "./operations-p0";

const id = "123e4567-e89b-42d3-a456-426614174000";
const digest = `sha256:${"a".repeat(64)}`;

describe("P0 operational contracts", () => {
  it("admits small documents directly and plans ordered verified parts for large PDFs", () => {
    const base = {
      workspaceKey: "ws_abcdefgh",
      documentId: id,
      fileName: "source.pdf",
      mimeType: "application/pdf",
      sourceSha256: digest,
    };
    expect(
      planLargeDocumentAdmission({ ...base, byteSize: 1000, pageCount: 2 })
    ).toMatchObject({ ok: true, decision: "direct" });
    expect(
      planLargeDocumentAdmission({
        ...base,
        fileName: "scan.png",
        mimeType: "image/png",
        byteSize: 1000,
        pageCount: 1,
      })
    ).toMatchObject({
      ok: true,
      parts: [{ objectSuffix: "parts/0001.png" }],
    });
    const large = planLargeDocumentAdmission({
      ...base,
      byteSize: 40 * 1024 * 1024,
      pageCount: 400,
    });
    expect(large).toMatchObject({
      ok: true,
      decision: "split",
      invariants: { compileOnlyAfterAllPartsReady: true },
    });
    if (!large.ok) throw new Error("expected admission");
    expect(large.parts.length).toBeGreaterThan(1);
    expect(large.parts[0]).toMatchObject({
      firstPage: 1,
      requiresByteVerification: true,
      maxBytes: LARGE_DOCUMENT_POLICY.splitPartMaxBytes,
    });
    expect(large.parts.at(-1)?.lastPage).toBe(400);
  });

  it("rejects unsafe paths, oversized non-PDF inputs and excessive split counts", () => {
    const base = {
      workspaceKey: "ws_abcdefgh",
      documentId: id,
      sourceSha256: digest,
    };
    expect(
      planLargeDocumentAdmission({
        ...base,
        fileName: "../x.pdf",
        mimeType: "application/pdf",
        byteSize: 1,
        pageCount: 1,
      })
    ).toEqual({ ok: false, code: "FILE_NAME_INVALID" });
    expect(
      planLargeDocumentAdmission({
        ...base,
        fileName: "scan.tiff",
        mimeType: "image/tiff",
        byteSize: 6 * 1024 * 1024,
        pageCount: 2,
      })
    ).toEqual({ ok: false, code: "NON_PDF_SPLIT_UNSUPPORTED" });
    expect(
      planLargeDocumentAdmission({
        ...base,
        fileName: "huge.pdf",
        mimeType: "application/pdf",
        byteSize: 2 * 1024 * 1024 * 1024,
        pageCount: 10_000,
      })
    ).toEqual({ ok: false, code: "SPLIT_PART_LIMIT_EXCEEDED" });
  });

  it("releases all reserved credit for terminal failure and operator review", () => {
    expect(
      buildCreditRelease({
        workspaceKey: "ws_abcdefgh",
        documentId: id,
        terminalState: "failed_terminal",
        reasonCode: "OCR_TIMEOUT_OR_NETWORK",
      })
    ).toMatchObject({
      ok: true,
      settlement: {
        outcome: "released",
        actualCredits: 0,
        retryPolicy: "new_reservation_required",
      },
    });
    expect(
      buildCreditRelease({
        workspaceKey: "ws_abcdefgh",
        documentId: id,
        terminalState: "operator_review",
        reasonCode: "OCR_LOW_TEXT_YIELD",
      })
    ).toMatchObject({
      ok: true,
      settlement: { outcome: "released", actualCredits: 0 },
    });
    expect(
      buildCreditRelease({
        workspaceKey: "ws_abcdefgh",
        documentId: id,
        terminalState: "failed_terminal",
        reasonCode: "MADE_UP",
      })
    ).toEqual({ ok: false, code: "CREDIT_RELEASE_INVALID" });
  });

  it("issues deletion and restore evidence only after independent checks pass", () => {
    const deletion = {
      evidenceId: id,
      workspaceKey: "ws_abcdefgh",
      requestedAt: "2026-08-30T00:00:00Z",
      completedAt: "2026-08-30T00:02:00Z",
      scope: "workspace" as const,
      subjectId: "ws_abcdefgh",
      deletedObjectCount: 4,
      deletedRowCount: 8,
      storageListingEmpty: true,
      databaseLookupEmpty: true,
      backupExpiryRecorded: true,
      auditDigest: digest,
    };
    expect(issueDeletionEvidence(deletion)).toMatchObject({
      ok: true,
      evidence: { outcome: "verified_deleted" },
    });
    expect(
      issueDeletionEvidence({ ...deletion, storageListingEmpty: false })
    ).toEqual({ ok: false, code: "DELETION_NOT_PROVEN" });

    const restore = {
      evidenceId: id,
      backupId: "backup-2026-08-30",
      snapshotAt: "2026-08-30T00:00:00Z",
      startedAt: "2026-08-30T01:00:00Z",
      completedAt: "2026-08-30T01:03:00Z",
      isolatedDestination: true,
      sourceManifestDigest: digest,
      restoredManifestDigest: digest,
      expectedRowCount: 12,
      restoredRowCount: 12,
      integrityChecksPassed: 5,
      cleanupCompletedAt: "2026-08-30T01:05:00Z",
    };
    expect(issueRestoreEvidence(restore)).toMatchObject({
      ok: true,
      evidence: { outcome: "verified_restored", recoveryTimeSeconds: 180 },
    });
    expect(issueRestoreEvidence({ ...restore, restoredRowCount: 11 })).toEqual({
      ok: false,
      code: "RESTORE_NOT_PROVEN",
    });
  });

  it("builds credential-free deduplicated incident and cost alert envelopes", () => {
    const common = {
      alertId: id,
      severity: "critical" as const,
      service: "runpod" as const,
      summary: "GPU queue has exceeded the processing SLO",
      observedAt: "2026-08-30T00:00:00Z",
      runbookUrl: "https://tavonel.com/runbooks/gpu",
    };
    expect(buildOperationsAlert({ ...common, kind: "incident" })).toMatchObject(
      { ok: true, payload: { containsCredentials: false } }
    );
    expect(
      buildOperationsAlert({
        ...common,
        kind: "cost",
        currentValue: 51,
        thresholdValue: 50,
        unit: "usd",
      })
    ).toMatchObject({
      ok: true,
      payload: { kind: "cost", dedupeKey: expect.any(String) },
    });
    expect(buildOperationsAlert({ ...common, kind: "cost" })).toEqual({
      ok: false,
      code: "ALERT_PAYLOAD_INVALID",
    });
  });

  it("requires four-eyes evidence and exact rollback restoration", () => {
    const evidence = {
      changeId: id,
      action: "rollback" as const,
      workspaceKey: "ws_abcdefgh",
      requesterId: "operator-a",
      approverId: "operator-b",
      reason: "Quality regression confirmed",
      candidateDigest: digest,
      previousWorldDigest: digest,
      resultingWorldDigest: digest,
      approvedAt: "2026-08-30T00:00:00Z",
    };
    expect(validateHumanChangeEvidence(evidence)).toBe(true);
    expect(
      validateHumanChangeEvidence({ ...evidence, approverId: "operator-a" })
    ).toBe(false);
    expect(
      validateHumanChangeEvidence({
        ...evidence,
        resultingWorldDigest: `sha256:${"b".repeat(64)}`,
      })
    ).toBe(false);
  });
});
