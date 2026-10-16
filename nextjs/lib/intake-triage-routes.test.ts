import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), admitted: vi.fn(), createStage: vi.fn(), presign: vi.fn(),
  claimStage: vi.fn(), readStaging: vi.fn(), sealSource: vi.fn(), finishStage: vi.fn(),
  readStages: vi.fn(), createReceipt: vi.fn(), createPreflight: vi.fn(),
}));

vi.mock("@/lib/activation-policy", () => ({ activationPolicy: { customerIntake: { enabled: true, reason: null } } }));
vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: mocks.auth }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: mocks.admitted }));
vi.mock("@/lib/compute-reservation", () => ({
  createFoundationIntakeTriageStage: mocks.createStage,
  claimFoundationIntakeTriageStage: mocks.claimStage,
  finishFoundationIntakeTriageStage: mocks.finishStage,
  readFoundationIntakeTriageStages: mocks.readStages,
  createFoundationIntakeTriageReceipt: mocks.createReceipt,
  createFoundationIntakePreflightApproval: mocks.createPreflight,
}));
vi.mock("@/lib/r2-presign", () => ({
  FOUNDATION_TRIAL_INTAKE_MAX_BYTES: 5 * 1024 * 1024,
  presignFoundationTriageStagingPut: mocks.presign,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ bucket: "foundation", accountId: "account", accessKeyId: "key", secretAccessKey: "secret" }),
  FOUNDATION_TRIAGE_MAX_SOURCE_BYTES: 5 * 1024 * 1024,
  readFoundationTriageStagingObject: mocks.readStaging,
  sealFoundationTriageSource: mocks.sealSource,
}));
vi.mock("@/lib/qualified-input", () => ({ validateQualifiedDocumentInput: () => ({ valid: true, normalizedMimeType: "application/pdf" }) }));
vi.mock("@/lib/magic-bytes", () => ({ verifySourceSignature: () => ({ ok: true }) }));
vi.mock("@/lib/intake-approval", () => ({
  deriveFileKey: vi.fn(async () => "fk_12345678"),
  intakeManifestDigest: vi.fn(async () => "sha256:" + "1".repeat(64)),
  MAX_APPROVAL_FILES: 128,
}));
vi.mock("@/lib/usage-pricing", () => ({
  intakePricingFingerprint: vi.fn(async () => "sha256:" + "2".repeat(64)),
  quoteIntakeManifest: vi.fn(() => ({ ok: true, quote: { estimatedUsd: 1, maximumUsd: 3 } })),
}));
vi.mock("@/lib/intake-triage", () => ({
  buildIntakeTriage: vi.fn((input: { observations: Array<{ fileKey: string }> }) => ({
    version: "tavonel-intake-triage-v1", inventoryDigest: "sha256:" + "3".repeat(64),
    approvalReady: false, approvalBlockers: ["content_safety_classification_unknown"],
    selectedFileKeys: [], files: input.observations.map((row) => ({ fileKey: row.fileKey, disposition: "needs_review" })),
  })),
  intakeTriageDigest: vi.fn(async () => "sha256:" + "3".repeat(64)),
}));
vi.mock("@/lib/intake-triage-rollout", () => ({
  INTAKE_TRIAGE_ROLLOUT_ENABLED: true,
  intakeTriageDisabledResponse: () => Response.json({ code: "INTAKE_TRIAGE_DISABLED" }, { status: 404 }),
}));

import { POST as stagePost } from "../app/api/v1/uploads/triage/stage/route";
import { POST as completePost } from "../app/api/v1/uploads/triage/complete/route";
import { POST as receiptPost } from "../app/api/v1/uploads/triage/receipt/route";
import { POST as preflightPost } from "../app/api/v1/uploads/triage/preflight/route";

const user = "22222222-2222-4222-8222-222222222222";
const workspace = "pilot-abc123";
const stageId = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";
const batchId = "55555555-5555-4555-8555-555555555555";
const preflightApprovalId = "99999999-9999-4999-8999-999999999999";
const fileKey = "fk_12345678";
const digest = "sha256:" + "a".repeat(64);
const stagingKey = `quarantine/${workspace}/triage-staging/${stageId}/upload`;
const sealedSourceKey = `quarantine/${workspace}/${documentId}/source`;

function minimalOnePagePdf() {
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj\n",
    "4 0 obj << /Length 36 >> stream\nBT /F1 12 Tf 10 10 Td (Hello) Tj ET\nendstream endobj\n",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(body, "ascii")); body += object; }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

function request(body: unknown) {
  return new Request("https://tavonel.invalid/api", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function stageRow(overrides: Record<string, unknown> = {}) {
  return {
    stageId, batchId, workspaceKey: workspace, actorUserId: user, documentId,
    preflightApprovalId,
    relativePath: "report.pdf", originalFilename: "report.pdf", declaredMimeType: "application/pdf",
    requestedBytes: 4, stagingKey, sealedSourceKey, state: "sealing", sealToken: "66666666-6666-4666-8666-666666666666",
    sealMode: null,
    fenceGeneration: 1, sealLeaseUntil: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, principal: { workspaceKey: workspace, userId: user, accessSource: "paid" } });
  mocks.admitted.mockResolvedValue(true);
  mocks.createStage.mockResolvedValue({ ok: true, json: {
    stageId, batchId, workspaceKey: workspace, actorUserId: user, documentId,
    stagingKey, relativePath: "report.pdf", originalFilename: "report.pdf",
    declaredMimeType: "application/pdf", createdAt: new Date().toISOString(),
    uploadExpiresAt: new Date(Date.now() + 60_000).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
  } });
  mocks.presign.mockReturnValue({ ok: true, uploadUrl: "https://storage.invalid/signed" });
  mocks.claimStage.mockImplementation(async (value) => ({ ok: true, json: stageRow({
    sealToken: value.sealToken, documentId: value.sealToken, fenceGeneration: 1,
    preflightApprovalId: value.preflightApprovalId,
    sealedSourceKey: `quarantine/${workspace}/${value.sealToken}/source`,
  }) }));
  mocks.readStaging.mockResolvedValue({ ok: true, bytes: Buffer.from("%PDF"), sha256: digest, byteLength: 4 });
  mocks.sealSource.mockImplementation(async (_env, value) => ({ ok: true, key: `quarantine/${workspace}/${value.documentId}/source`, sha256: value.sha256, byteLength: value.bytes.length, etag: "etag-1" }));
  mocks.finishStage.mockImplementation(async (value) => ({ ok: true, json: stageRow({
    state: "sealed", fileKey: value.fileKey, contentSha256: value.contentSha256, objectEtag: value.objectEtag,
    sealMode: "server_only_copy_v1",
    sealToken: value.sealToken,
    documentId: value.sealToken, sealedSourceKey: `quarantine/${workspace}/${value.sealToken}/source`,
  }) }));
  mocks.readStages.mockResolvedValue({ ok: true, json: { stages: [] } });
  mocks.createReceipt.mockResolvedValue({ ok: true, result: { receiptId: "77777777-7777-4777-8777-777777777777" } });
  mocks.createPreflight.mockImplementation(async (value) => ({ ok: true, json: {
    ...value, approvalStage: "preflight", budgetScope: "bounded_bytes_and_file_count",
    maxFiles: 1, maxTotalBytes: 4, providerCalls: 0, monetaryCostStatus: "not_priced",
  } }));
});

describe("triage staging routes", () => {
  it("creates bounded preflight approval with explicit no-price and no-provider disclosure", async () => {
    const response = await preflightPost(request({ batchId, choices: [{ stageId, choice: "preflight" }] }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.approvalStage).toBe("preflight");
    expect(payload.budgetScope).toBe("bounded_bytes_and_file_count");
    expect(payload.providerCalls).toBe(0);
    expect(payload.monetaryCostStatus).toBe("not_priced");
    expect(payload.costDisclosure).toContain("not priced");
    expect(payload.safetyDisclosure).toContain("remain unknown");
    expect(mocks.createPreflight).toHaveBeenCalledWith(expect.objectContaining({
      workspaceKey: workspace, actorUserId: user, batchId,
      stageChoices: [{ stageId, choice: "preflight" }],
    }));
  });

  it("requires preflight approval before staging bytes are read or sealed", async () => {
    const response = await completePost(request({ stageId }));
    expect(response.status).toBe(400);
    expect(mocks.claimStage).not.toHaveBeenCalled();
    expect(mocks.readStaging).not.toHaveBeenCalled();
    expect(mocks.sealSource).not.toHaveBeenCalled();
  });

  it("keeps a bounded customer quote while qualification remains blocked and operator cost is unpriced", async () => {
    const pdfBytes = minimalOnePagePdf();
    const pdfDigest = `sha256:${createHash("sha256").update(pdfBytes).digest("hex")}`;
    mocks.readStaging.mockResolvedValue({ ok: true, bytes: pdfBytes, sha256: pdfDigest, byteLength: pdfBytes.length });
    mocks.sealSource.mockImplementation(async (_env, value) => ({
      ok: true, key: `quarantine/${workspace}/${value.documentId}/source`,
      sha256: value.sha256, byteLength: value.bytes.length, etag: "etag-pdf-1",
    }));
    const preflightResponse = await preflightPost(request({ batchId, choices: [{ stageId, choice: "preflight" }] }));
    const approval = (await preflightResponse.json()).approval as { preflightApprovalId: string };
    expect(preflightResponse.status).toBe(200);
    mocks.claimStage.mockImplementationOnce(async (value) => ({ ok: true, json: stageRow({
      sealToken: value.sealToken, documentId: value.sealToken,
      preflightApprovalId: value.preflightApprovalId, requestedBytes: pdfBytes.length,
      sealedSourceKey: `quarantine/${workspace}/${value.sealToken}/source`,
    }) }));
    const complete = await completePost(request({ stageId, preflightApprovalId: approval.preflightApprovalId }));
    expect(complete.status).toBe(200);
    expect(mocks.readStaging).toHaveBeenCalledTimes(1);
    expect(mocks.finishStage).toHaveBeenCalledWith(expect.objectContaining({ contentSha256: pdfDigest }));
    mocks.readStages.mockResolvedValue({ ok: true, json: { stages: [stageRow({
      preflightApprovalId: approval.preflightApprovalId,
      state: "sealed", requestedBytes: pdfBytes.length, fileKey, contentSha256: pdfDigest,
      objectEtag: "etag-pdf-1", signature: "valid",
      sealMode: "server_only_copy_v1",
      sealedAt: new Date().toISOString(), uploadExpiresAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })] } });
    const response = await receiptPost(request({ batchId, preflightApprovalId: approval.preflightApprovalId, choices: { [fileKey]: "include" } }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.code).toBe("TRIAGE_REVIEW_REQUIRED");
    expect(mocks.createReceipt).toHaveBeenCalledWith(expect.objectContaining({
      fileBindings: [expect.objectContaining({ fileKey, objectVersion: "etag-pdf-1", sealed: true,
        stagingWriteExpiresAt: expect.any(String), sealMode: "server_only_copy_v1" })],
    }));
    const capturedBinding = (mocks.createReceipt.mock.calls.at(-1)?.[0].fileBindings as Array<Record<string, unknown>>)[0]!;
    expect(Date.parse(String(capturedBinding.stagingWriteExpiresAt))).toBeLessThan(Date.now());
    expect(payload.approvalBlockers).toContain("content_safety_classification_unknown");
    expect(payload.estimate.initial.maximum).toBeGreaterThan(0);
    expect(payload.estimate.incremental).toEqual({ minimum: 0, maximum: 0 });
    expect(payload.estimate.customerChargeCoverage.scope).toBe("entire_affected_source_version_set");
    expect(payload.estimate.operatorCost.status).toBe("not_priced");
    expect(payload.approvalBlockers).not.toContain("customer_charge_scope_or_new_read_coverage_incomplete");
    expect(mocks.createReceipt).toHaveBeenCalledWith(expect.objectContaining({ approvalReady: false }));
  });

  it("replays an idempotent stage identity and signs only its staging key", async () => {
    const first = await stagePost(request({ batchId, files: [{ relativePath: "report.pdf", idempotencyKey: "88888888-8888-4888-8888-888888888888", declaredMimeType: "application/pdf", requestedBytes: 4 }] }));
    const second = await stagePost(request({ batchId, files: [{ relativePath: "report.pdf", idempotencyKey: "88888888-8888-4888-8888-888888888888", declaredMimeType: "application/pdf", requestedBytes: 4 }] }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.createStage).toHaveBeenCalledTimes(2);
    expect(mocks.presign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workspaceKey: workspace, stageId, contentLength: 4 }));
    expect(JSON.stringify(await first.json())).not.toContain(sealedSourceKey);
  });

  it("returns the scope-bound busy refusal when a competing seal already owns the lease", async () => {
    mocks.claimStage.mockResolvedValue({ ok: false, code: "INTAKE_TRIAGE_STAGE_BUSY", status: 409 });
    const response = await completePost(request({ stageId, preflightApprovalId }));
    expect(response.status).toBe(409);
    expect(mocks.claimStage).toHaveBeenCalledWith(expect.objectContaining({ workspaceKey: workspace, actorUserId: user, stageId }));
    expect(mocks.sealSource).not.toHaveBeenCalled();
  });

  it("returns a previously sealed result on replay without rereading or overwriting", async () => {
    mocks.claimStage.mockResolvedValue({ ok: true, json: stageRow({ state: "sealed", fileKey, contentSha256: digest }) });
    const response = await completePost(request({ stageId, preflightApprovalId }));
    expect(response.status).toBe(200);
    expect(mocks.readStaging).not.toHaveBeenCalled();
    expect(mocks.sealSource).not.toHaveBeenCalled();
    expect(mocks.finishStage).not.toHaveBeenCalled();
  });

  it("uses the authenticated actor/workspace for wrong-scope denial", async () => {
    mocks.claimStage.mockResolvedValue({ ok: false, code: "INTAKE_TRIAGE_STAGE_NOT_FOUND", status: 404 });
    const response = await completePost(request({ stageId, preflightApprovalId }));
    expect(response.status).toBe(404);
    expect(mocks.claimStage).toHaveBeenCalledWith(expect.objectContaining({ workspaceKey: workspace, actorUserId: user }));
  });

  it("does not publish a late seal response after the database lease expires", async () => {
    mocks.finishStage.mockResolvedValue({ ok: false, code: "INTAKE_TRIAGE_SEAL_RETRY_REQUIRED", status: 409 });
    const response = await completePost(request({ stageId, preflightApprovalId }));
    expect(response.status).toBe(409);
    expect(mocks.sealSource).toHaveBeenCalledTimes(1);
    expect(mocks.finishStage).toHaveBeenCalledTimes(1);
  });

  it("isolates a late first writer from the winning second writer with different final keys", async () => {
    let releaseA!: () => void;
    let notifyAStarted!: () => void;
    const pausedA = new Promise<void>((resolve) => { releaseA = resolve; });
    const aStarted = new Promise<void>((resolve) => { notifyAStarted = resolve; });
    const attemptKeys: string[] = [];
    let generation = 0;
    mocks.claimStage.mockImplementation(async (value) => ({ ok: true, json: stageRow({
      sealToken: value.sealToken, documentId: value.sealToken, fenceGeneration: ++generation,
      preflightApprovalId: value.preflightApprovalId,
      sealedSourceKey: `quarantine/${workspace}/${value.sealToken}/source`,
    }) }));
    mocks.sealSource.mockImplementationOnce(async (_env, value) => {
      attemptKeys.push(`quarantine/${workspace}/${value.documentId}/source`);
      notifyAStarted();
      await pausedA;
      return { ok: true, key: attemptKeys[0], sha256: digest, byteLength: 4, etag: "etag-a" };
    }).mockImplementationOnce(async (_env, value) => {
      attemptKeys.push(`quarantine/${workspace}/${value.documentId}/source`);
      return { ok: true, key: attemptKeys[1], sha256: digest, byteLength: 4, etag: "etag-b" };
    });
    mocks.finishStage.mockImplementation(async (value) => value.fenceGeneration === 1
      ? { ok: false, code: "INTAKE_TRIAGE_SEAL_RETRY_REQUIRED", status: 409 }
      : { ok: true, json: stageRow({ state: "sealed", fileKey, contentSha256: digest,
        sealToken: value.sealToken, documentId: value.sealToken,
        sealedSourceKey: `quarantine/${workspace}/${value.sealToken}/source` }) });

    const first = completePost(request({ stageId, preflightApprovalId }));
    await aStarted;
    const second = await completePost(request({ stageId, preflightApprovalId }));
    releaseA();
    const lateFirst = await first;
    expect(second.status).toBe(200);
    expect(lateFirst.status).toBe(409);
    expect(attemptKeys).toHaveLength(2);
    expect(attemptKeys[0]).not.toBe(attemptKeys[1]);
    expect(JSON.stringify(await second.json())).toContain(attemptKeys[1]);
  });

  it("refuses an expired staged inventory and one returned under the wrong principal", async () => {
    mocks.readStages.mockResolvedValueOnce({ ok: true, json: { stages: [stageRow({ state: "sealed", expiresAt: "2000-01-01T00:00:00Z" })] } });
    expect((await receiptPost(request({ batchId, preflightApprovalId, choices: { [fileKey]: "include" } }))).status).toBe(409);
    mocks.readStages.mockResolvedValueOnce({ ok: true, json: { stages: [stageRow({ state: "sealed", expiresAt: new Date(Date.now() + 60000).toISOString(), actorUserId: "99999999-9999-4999-8999-999999999999" })] } });
    expect((await receiptPost(request({ batchId, preflightApprovalId, choices: { [fileKey]: "include" } }))).status).toBe(409);
    expect(mocks.createReceipt).not.toHaveBeenCalled();
  });
});
