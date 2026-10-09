import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), admit: vi.fn(), create: vi.fn(), fingerprint: vi.fn(), quote: vi.fn(),
  ready: vi.fn(), preflight: vi.fn(), manifestDigest: vi.fn(),
  readApproval: vi.fn(), reserveCompute: vi.fn(), reserveAdmission: vi.fn(), presign: vi.fn(), signer: vi.fn(),
  headObject: vi.fn(), headSignature: vi.fn(), supabaseConfig: vi.fn(), supabaseRequest: vi.fn(),
  sessionProduct: vi.fn(), signatureCheck: vi.fn(), trialReuse: vi.fn(), sourceIdempotency: vi.fn(),
}));

vi.mock("@/lib/intake-triage-rollout", () => ({
  INTAKE_TRIAGE_ROLLOUT_ENABLED: false,
  intakeTriageDisabledResponse: () => Response.json({ code: "INTAKE_TRIAGE_DISABLED" }, { status: 404 }),
}));
vi.mock("@/lib/activation-policy", () => ({ activationPolicy: { customerIntake: { enabled: true, reason: "open" } } }));
vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: mocks.authorize }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: mocks.admit }));
vi.mock("@/lib/enterprise-http", () => ({
  readBoundedJson: async (request: Request) => ({ ok: true, value: await request.json() }),
}));
vi.mock("@/lib/intake-approval", () => ({
  ATTEMPT_KEY_PATTERN: /^[A-Za-z0-9_-]{16,128}$/,
  MAX_APPROVAL_FILES: 128,
  MAX_APPROVAL_METADATA_BYTES: 512 * 1024,
  SHA256_DIGEST_PATTERN: /^sha256:[a-f0-9]{64}$/,
  FILE_KEY_PATTERN: /^fk_[A-Za-z0-9_-]{8,128}$/,
  approvedSourceIdempotencyKey: mocks.sourceIdempotency,
  intakeManifestDigest: mocks.manifestDigest,
  readManifestEntry: (value: unknown) => value,
}));
vi.mock("@/lib/compute-reservation", () => ({
  createFoundationIntakeApproval: mocks.create,
  createFoundationIntakePreflightApproval: mocks.preflight,
  readFoundationIntakeApproval: mocks.readApproval,
  reserveFoundationIntakeApprovedFile: mocks.reserveCompute,
}));
vi.mock("@/lib/intake-admission", () => ({ reserveFoundationIntake: mocks.reserveAdmission }));
vi.mock("@/lib/intake-triage-server", () => ({ readReadyUploadTriage: mocks.ready }));
vi.mock("@/lib/qualified-input", () => ({
  validateQualifiedDocumentInput: ({ originalFilename, declaredMimeType }: Record<string, string>) => ({
    valid: true, originalFilename, normalizedMimeType: declaredMimeType,
  }),
}));
vi.mock("@/lib/r2-presign", () => ({
  FOUNDATION_INTAKE_MAX_BYTES: 10_000_000, FOUNDATION_TRIAL_INTAKE_MAX_BYTES: 10_000_000,
  PROCESSING_CEILING: { maxSourcePages: 80 }, PROCESSING_CEILING_SENTENCE: "bounded",
  presignFoundationQuarantinePut: mocks.presign,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: mocks.signer, headFoundationQuarantineObject: mocks.headObject,
  headFoundationQuarantineSignature: mocks.headSignature,
}));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: mocks.supabaseConfig, supabaseAdminRequest: mocks.supabaseRequest,
}));
vi.mock("@/lib/self-service-trial", () => ({ authorizeFoundationSessionProduct: mocks.sessionProduct }));
vi.mock("@/lib/magic-bytes", () => ({ verifySourceSignature: mocks.signatureCheck }));
vi.mock("@/lib/trial-source-risk", () => ({ assessTrialSourceReuse: mocks.trialReuse }));
vi.mock("@/lib/usage-pricing", () => ({
  intakePricingFingerprint: mocks.fingerprint,
  quoteIntakeManifest: mocks.quote,
}));

import { POST as legacyApprovalPost } from "../app/api/uploads/approval/route";
import { POST as legacyCapabilityPost } from "../app/api/uploads/capability/route";
import { POST as legacyConfirmPost } from "../app/api/uploads/confirm/route";
import { POST as legacyQuotePost } from "../app/api/v1/uploads/quote/route";
import { POST as disabledCompletePost } from "../app/api/v1/uploads/triage/complete/route";
import { POST as disabledPreflightPost } from "../app/api/v1/uploads/triage/preflight/route";
import { POST as disabledReceiptPost } from "../app/api/v1/uploads/triage/receipt/route";
import { POST as disabledStagePost } from "../app/api/v1/uploads/triage/stage/route";

const hash = `sha256:${"a".repeat(64)}`;
const actor = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const documentId = "33333333-3333-4333-8333-333333333333";
const attemptKey = "attempt_0123456789abcdef";
const scopeDigest = `sha256:${"b".repeat(64)}`;
const fileKey = "fk_12345678";
const entry = {
  fileKey: "fk_12345678", originalFilename: "report.pdf", contentSha256: hash,
  byteLength: 1024, mimeType: "application/pdf", claimedPages: null, claimedBasis: null,
};
const manifest = { clientManifestDigest: hash, files: [entry] };

function request(url: string, value: Record<string, unknown>) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
}

beforeEach(() => {
  mocks.authorize.mockReset().mockResolvedValue({ ok: true, principal: {
    workspaceKey: "pilot-abc123", userId: actor, accessSource: "paid",
  } });
  mocks.admit.mockReset().mockResolvedValue(true);
  mocks.create.mockReset().mockResolvedValue({ ok: true, result: { attemptKey: "attempt_0123456789abcdef" } });
  mocks.readApproval.mockReset().mockResolvedValue({ ok: true, result: {
    attemptKey, scopeDigest, pricingFingerprint: hash,
    files: [{ fileKey, documentId, contentSha256: hash, byteLength: 1024, mimeType: "application/pdf",
      pageBasis: "unknown", approvedMaxPages: 80, reservedCredits: 1, maximumCredits: 1 }],
  } });
  mocks.reserveCompute.mockReset().mockResolvedValue({ ok: true, result: {
    reservationId: documentId, approvedReservedCredits: 1, approvedMaximumCredits: 1, billingSource: "paid",
    reservationExpiresAt: "2026-10-04T12:05:00Z", approvedMaxPages: 80, pageBasis: "unknown",
  } });
  mocks.reserveAdmission.mockReset().mockResolvedValue({ ok: true, result: { expiresAt: "2026-10-04T12:05:00Z" } });
  mocks.presign.mockReset().mockReturnValue({ ok: true, uploadUrl: "https://upload.invalid/signed" });
  mocks.signer.mockReset().mockReturnValue({ endpoint: "synthetic" });
  mocks.headObject.mockReset().mockResolvedValue({ ok: true, exists: true, sizeBytes: 1024, contentType: "application/pdf", etag: "etag" });
  mocks.headSignature.mockReset().mockResolvedValue({ ok: true, exists: true, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) });
  mocks.supabaseConfig.mockReset().mockReturnValue({ endpoint: "synthetic" });
  mocks.supabaseRequest.mockReset().mockResolvedValue(new Response(JSON.stringify({
    admission: { documentId, status: "confirmed", confirmedAt: "2026-10-04T12:00:00Z" },
    approvedFile: { fileKey, documentId, fileState: "confirmed" },
  }), { status: 200, headers: { "content-type": "application/json" } }));
  mocks.sessionProduct.mockReset().mockResolvedValue({ ok: true, access: { source: "paid" } });
  mocks.signatureCheck.mockReset().mockReturnValue({ ok: true });
  mocks.trialReuse.mockReset().mockResolvedValue({ ok: true });
  mocks.sourceIdempotency.mockReset().mockReturnValue("stable-source-token");
  mocks.fingerprint.mockReset().mockResolvedValue(hash);
  mocks.quote.mockReset().mockImplementation((files: Array<unknown>) => ({
    ok: true,
    quote: { maximumPages: files.length * 80, reservedCredits: files.length, maximumCredits: files.length,
      estimatedUsd: files.length / 100, maximumUsd: files.length / 50,
      files: files.map(() => ({ pageBasis: "unknown", approvedMaxPages: 80, reservedCredits: 1, maximumCredits: 1 })) },
  }));
  mocks.ready.mockReset();
  mocks.preflight.mockReset();
  mocks.manifestDigest.mockReset().mockResolvedValue(hash);
});

describe("disabled triage rollout compatibility", () => {
  it("keeps the legacy metadata quote path working without any triage receipt RPC", async () => {
    const response = await legacyQuotePost(request("https://tavonel.com/api/v1/uploads/quote", manifest));
    expect(response.status).toBe(200);
    expect(mocks.quote).toHaveBeenCalledTimes(1);
    expect(mocks.ready).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ code: "INTAKE_QUOTE", clientManifestDigest: hash });
  });

  it("keeps the legacy approval RPC contract when triage is disabled", async () => {
    const response = await legacyApprovalPost(request("https://tavonel.com/api/uploads/approval", {
      ...manifest, attemptKey: "attempt_0123456789abcdef", pricingFingerprint: hash, aggregateMaximumCredits: 1,
    }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]![0]).not.toHaveProperty("triageReceiptId");
    expect(mocks.ready).not.toHaveBeenCalled();
  });

  it("keeps capability on the legacy signed-upload path when triage is disabled", async () => {
    const response = await legacyCapabilityPost(new Request("https://tavonel.com/api/uploads/capability", {
      method: "POST", headers: { "content-type": "application/json", "x-tavonel-source-idempotency-key": "stable-source-token" },
      body: JSON.stringify({ originalFilename: "report.pdf", declaredMimeType: "application/pdf", requestedBytes: 1024,
        attemptKey, scopeDigest, pricingFingerprint: hash, fileKey, contentSha256: hash }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: "QUALIFIED", uploadUrl: "https://upload.invalid/signed" });
    expect(mocks.reserveCompute).toHaveBeenCalledTimes(1);
    expect(mocks.ready).not.toHaveBeenCalled();
    expect(mocks.headObject).not.toHaveBeenCalled();
  });

  it("fails closed before reservation or final-key signing for an existing triage approval after rollout-off", async () => {
    mocks.readApproval.mockResolvedValueOnce({ ok: true, result: {
      attemptKey, scopeDigest, pricingFingerprint: hash,
      triageReceiptId: "11111111-1111-4111-8111-111111111111",
      triageVersion: "tavonel-intake-triage-v1", triageInventoryDigest: hash,
      configurationRevision: "triage-config-1",
      files: [{ fileKey, documentId, contentSha256: hash, byteLength: 1024, mimeType: "application/pdf",
        pageBasis: "unknown", approvedMaxPages: 80, reservedCredits: 1, maximumCredits: 1 }],
    } });
    const response = await legacyCapabilityPost(new Request("https://tavonel.com/api/uploads/capability", {
      method: "POST", headers: { "content-type": "application/json", "x-tavonel-source-idempotency-key": "stable-source-token" },
      body: JSON.stringify({ originalFilename: "report.pdf", declaredMimeType: "application/pdf", requestedBytes: 1024,
        attemptKey, scopeDigest, pricingFingerprint: hash, fileKey, contentSha256: hash }),
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "INTAKE_TRIAGE_ROLLOUT_DISABLED" });
    expect(mocks.reserveAdmission).not.toHaveBeenCalled();
    expect(mocks.reserveCompute).not.toHaveBeenCalled();
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it("keeps confirmation on the legacy approval and confirmation RPC path when triage is disabled", async () => {
    const response = await legacyConfirmPost(request("https://tavonel.com/api/uploads/confirm", {
      documentId, sourceSha256: hash, attemptKey, scopeDigest, fileKey,
    }));
    expect(response.status).toBe(200);
    expect(mocks.readApproval).toHaveBeenCalledTimes(1);
    expect(mocks.supabaseRequest).toHaveBeenCalledWith(expect.anything(),
      "/rest/v1/rpc/confirm_foundation_intake_approved_upload", expect.anything());
    expect(mocks.ready).not.toHaveBeenCalled();
  });

  it("does not confirm an existing triage approval through the legacy route after rollout-off", async () => {
    mocks.readApproval.mockResolvedValueOnce({ ok: true, result: {
      attemptKey, scopeDigest, pricingFingerprint: hash,
      triageReceiptId: "11111111-1111-4111-8111-111111111111",
      triageVersion: "tavonel-intake-triage-v1", triageInventoryDigest: hash,
      configurationRevision: "triage-config-1",
      files: [{ fileKey, documentId, contentSha256: hash, byteLength: 1024, mimeType: "application/pdf",
        pageBasis: "unknown", approvedMaxPages: 80, reservedCredits: 1, maximumCredits: 1 }],
    } });
    const response = await legacyConfirmPost(request("https://tavonel.com/api/uploads/confirm", {
      documentId, sourceSha256: hash, attemptKey, scopeDigest, fileKey,
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "INTAKE_TRIAGE_ROLLOUT_DISABLED" });
    expect(mocks.supabaseRequest).not.toHaveBeenCalled();
    expect(mocks.ready).not.toHaveBeenCalled();
  });

  it("returns one clean disabled response across all new triage endpoints without touching RPCs", async () => {
    const routes = [
      [disabledPreflightPost, "preflight"], [disabledStagePost, "stage"],
      [disabledCompletePost, "complete"], [disabledReceiptPost, "receipt"],
    ] as const;
    for (const [post, endpoint] of routes) {
      const response = await post(request(`https://tavonel.com/api/v1/uploads/triage/${endpoint}`, {
        batchId: "11111111-1111-4111-8111-111111111111", choices: [],
      }));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "INTAKE_TRIAGE_DISABLED" });
    }
    expect(mocks.preflight).not.toHaveBeenCalled();
  });
});
