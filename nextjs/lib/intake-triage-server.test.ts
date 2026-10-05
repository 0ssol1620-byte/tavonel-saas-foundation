import { describe, expect, it, vi } from "vitest";
import { intakeManifestDigest, type IntakeManifestEntry } from "./intake-approval";
import { readReadyUploadTriage } from "./intake-triage-server";

const digest = `sha256:${"a".repeat(64)}`;
const receiptId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const fileKey = "fk_12345678";
const now = Date.parse("2026-10-04T12:00:00Z");

vi.mock("./compute-reservation", () => ({
  readFoundationIntakeTriageReceipt: vi.fn(),
}));
import { readFoundationIntakeTriageReceipt } from "./compute-reservation";

function receipt(overrides: Record<string, unknown> = {}) {
  const entry: IntakeManifestEntry = {
    fileKey, originalFilename: "report.pdf", contentSha256: digest, byteLength: 32,
    mimeType: "application/pdf", claimedPages: null, claimedBasis: null,
  };
  return {
    receiptId, workspaceKey: "pilot-abc123", actorUserId: userId, sourceKind: "direct_upload" as const,
    sourceId: "attempt_source_12345678", inventoryRevision: "", triageVersion: "tavonel-intake-triage-v1" as const,
    inventoryDigest: digest, configurationRevision: "triage-config-1", pricingFingerprint: digest,
    inventory: {
      version: "tavonel-intake-triage-v1", inventoryDigest: digest, approvalReady: true,
      selectedFileKeys: [fileKey],
      scope: { workspaceKey: "pilot-abc123", sourceId: "attempt_source_12345678" },
      files: [{ fileKey, relativePath: "report.pdf", disposition: "include",
        revision: null, digestEvidence: "server_verified", contentSha256: digest, byteLength: 32, mimeType: "application/pdf" }],
    },
    estimate: {
      currency: "USD", initial: { minimum: 3.2, maximum: 4.8 }, incremental: { minimum: 0, maximum: 0 },
      customerChargeCoverage: { policy: "published_page_admission_once", scope: "entire_affected_source_version_set",
        pricingFingerprint: digest, sourceVersions: [{ fileKey, revision: null, contentSha256: digest, mode: "new_read" }] },
      operatorCost: { status: "not_priced", unavailableProviders: ["cdr_infrastructure"] },
    },
    fileBindings: [{ fileKey, stageId: "44444444-4444-4444-8444-444444444444",
      stagingKey: `quarantine/pilot-abc123/triage-staging/44444444-4444-4444-8444-444444444444/upload`,
      documentId, objectKey: `quarantine/pilot-abc123/${documentId}/source`,
      objectVersion: "version-1", stagingWriteExpiresAt: "2026-10-04T12:01:00Z",
      sealMode: "server_only_copy_v1", sealedAt: "2026-10-04T11:59:01Z", sealed: true }],
    approvalReady: true, expiresAt: "2026-10-04T12:05:00Z", ...overrides,
    _entries: [entry],
  };
}

describe("readReadyUploadTriage", () => {
  it("accepts a future staging URL expiry only for the server-owned sealed-copy mode", async () => {
    const value = receipt();
    value.inventoryRevision = await intakeManifestDigest(value._entries as IntakeManifestEntry[]);
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: value as never });
    const result = await readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now });
    expect(result.ok).toBe(true);
  });

  it("accepts complete customer pricing when operator costs remain unavailable", async () => {
    const value = receipt();
    value.inventoryRevision = await intakeManifestDigest(value._entries as IntakeManifestEntry[]);
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: value as never });
    await expect(readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now }))
      .resolves.toMatchObject({ ok: true });
  });

  it("rejects missing affected source scope and unknown new-read/reprocessing coverage", async () => {
    const missing = receipt();
    missing.estimate.customerChargeCoverage.sourceVersions = [];
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: missing as never });
    await expect(readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now }))
      .resolves.toEqual({ ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 });
    const unknown = receipt();
    unknown.estimate.customerChargeCoverage.sourceVersions[0]!.mode = "unknown_reprocessing";
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: unknown as never });
    await expect(readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now }))
      .resolves.toEqual({ ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 });
  });


  it("returns READ_PROOF_REQUIRED for an unchanged source without persisted read proof", async () => {
    const value = receipt();
    Object.assign(value.inventory.files[0]!, { revision: "source-revision-1" });
    Object.assign(value.estimate.customerChargeCoverage.sourceVersions[0]!, {
      revision: "source-revision-1", mode: "unchanged_already_read_recompile",
    });
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: value as never });
    await expect(readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now }))
      .resolves.toEqual({ ok: false, code: "READ_PROOF_REQUIRED", status: 409 });
  });
  it("rejects a customer charge range that differs from the recomputed complete-manifest quote", async () => {
    const underquoted = receipt();
    underquoted.estimate.initial.maximum = 0.06;
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: underquoted as never });
    await expect(readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now }))
      .resolves.toEqual({ ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 });
  });

  it("rejects a receipt after its immutable review window has expired", async () => {
    const value = receipt({ expiresAt: "2026-10-04T11:59:59Z" });
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: value as never });
    await expect(readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now }))
      .resolves.toEqual({ ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 });
  });

  it("rejects unknown or final-writable seal modes and any unverified digest", async () => {
    const value = receipt();
    value.inventoryRevision = await intakeManifestDigest(value._entries as IntakeManifestEntry[]);
    const unsealed = { ...value, fileBindings: [{ ...value.fileBindings[0], sealMode: "client_final_put_v1" }] };
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: unsealed as never });
    await expect(readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now }))
      .resolves.toEqual({ ok: false, code: "INTAKE_TRIAGE_OBJECT_NOT_SEALED", status: 409 });
    const unknownMode = { ...value, fileBindings: [{ ...value.fileBindings[0], sealMode: "unknown" }] };
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: unknownMode as never });
    await expect(readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now }))
      .resolves.toEqual({ ok: false, code: "INTAKE_TRIAGE_OBJECT_NOT_SEALED", status: 409 });
    const unverified = receipt();
    unverified.inventoryRevision = await intakeManifestDigest(unverified._entries as IntakeManifestEntry[]);
    Object.assign(unverified.inventory.files[0]!, { digestEvidence: "connector_observed" });
    vi.mocked(readFoundationIntakeTriageReceipt).mockResolvedValue({ ok: true, result: unverified as never });
    await expect(readReadyUploadTriage({ workspaceKey: "pilot-abc123", userId, receiptId, now }))
      .resolves.toEqual({ ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 });
  });
});
