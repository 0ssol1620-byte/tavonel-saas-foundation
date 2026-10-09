import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), admit: vi.fn(), readApproval: vi.fn(), readTriage: vi.fn(),
  reserveAdmission: vi.fn(), reserveCompute: vi.fn(), head: vi.fn(), fingerprint: vi.fn(),
}));

vi.mock("@/lib/activation-policy", () => ({ activationPolicy: { customerIntake: { enabled: true, reason: null } } }));
vi.mock("@/lib/enterprise-http", () => ({
  readBoundedJson: async (request: Request) => ({ ok: true, value: await request.json() }),
}));
vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: mocks.authorize }));
vi.mock("@/lib/compute-reservation", () => ({
  readFoundationIntakeApproval: mocks.readApproval,
  reserveFoundationIntakeApprovedFile: mocks.reserveCompute,
}));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: mocks.admit }));
vi.mock("@/lib/intake-admission", () => ({ reserveFoundationIntake: mocks.reserveAdmission }));
vi.mock("@/lib/qualified-input", () => ({
  validateQualifiedDocumentInput: ({ originalFilename, declaredMimeType }: Record<string, string>) => ({
    valid: true, originalFilename, normalizedMimeType: declaredMimeType,
  }),
}));
vi.mock("@/lib/r2-presign", () => ({
  FOUNDATION_INTAKE_MAX_BYTES: 10_000_000,
  FOUNDATION_TRIAL_INTAKE_MAX_BYTES: 10_000_000,
  PROCESSING_CEILING: { maxSourcePages: 80 },
  PROCESSING_CEILING_SENTENCE: "bounded",
  presignFoundationQuarantinePut: vi.fn(),
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ bucket: "foundation" }),
  headFoundationQuarantineObject: mocks.head,
}));
vi.mock("@/lib/intake-triage-server", () => ({ readReadyUploadTriage: mocks.readTriage }));
vi.mock("@/lib/intake-triage-rollout", () => ({ INTAKE_TRIAGE_ROLLOUT_ENABLED: true }));
vi.mock("@/lib/usage-pricing", () => ({ intakePricingFingerprint: mocks.fingerprint }));
vi.mock("@/lib/intake-approval", () => ({
  approvedSourceIdempotencyKey: vi.fn(async () => "stable-source-token"),
  ATTEMPT_KEY_PATTERN: /^[A-Za-z0-9_-]{16,128}$/,
  FILE_KEY_PATTERN: /^fk_[A-Za-z0-9_-]{8,128}$/,
  SHA256_DIGEST_PATTERN: /^sha256:[a-f0-9]{64}$/,
}));

import { POST as capability } from "../app/api/uploads/capability/route";

const workspaceKey = "pilot-abc123";
const userId = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const documentId = "33333333-3333-4333-8333-333333333333";
const attemptKey = "attempt_0123456789abcdef";
const fileKey = "fk_12345678";
const digest = `sha256:${"a".repeat(64)}`;
const scopeDigest = `sha256:${"b".repeat(64)}`;
const objectKey = `quarantine/${workspaceKey}/${documentId}/source`;
const entry = { fileKey, contentSha256: digest, byteLength: 1024, mimeType: "application/pdf" };

function request() {
  return new Request("https://tavonel.invalid/api/uploads/capability", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tavonel-source-idempotency-key": "stable-source-token" },
    body: JSON.stringify({
      originalFilename: "report.pdf", declaredMimeType: "application/pdf", requestedBytes: 1024,
      attemptKey, scopeDigest, pricingFingerprint: digest, fileKey, contentSha256: digest,
    }),
  });
}

function matchingHead() {
  return { ok: true, exists: true, sizeBytes: 1024, contentType: "application/pdf", etag: "server-etag-v1" };
}

beforeEach(() => {
  mocks.authorize.mockReset().mockResolvedValue({ ok: true, principal: {
    workspaceKey, userId, accessSource: "paid",
  } });
  mocks.admit.mockReset().mockResolvedValue(true);
  mocks.readApproval.mockReset().mockResolvedValue({ ok: true, result: {
    attemptKey, scopeDigest, pricingFingerprint: digest, triageReceiptId: "11111111-1111-4111-8111-111111111111",
    triageVersion: "tavonel-intake-triage-v1", triageInventoryDigest: digest,
    configurationRevision: "triage-config-1",
    files: [{ ...entry, documentId }],
  } });
  mocks.readTriage.mockReset().mockResolvedValue({ ok: true, result: {
    receipt: {
      receiptId: "11111111-1111-4111-8111-111111111111", inventoryDigest: digest,
      configurationRevision: "triage-config-1",
      fileBindings: [{ fileKey, documentId, objectKey, objectVersion: "server-etag-v1" }],
    },
    entries: [entry], clientManifestDigest: digest,
  } });
  mocks.reserveAdmission.mockReset().mockResolvedValue({ ok: true, result: { expiresAt: "2099-01-01T00:00:00Z" } });
  mocks.reserveCompute.mockReset().mockResolvedValue({ ok: true, result: {
    reservationId: "44444444-4444-4444-8444-444444444444", approvedReservedCredits: 1,
    approvedMaximumCredits: 2, billingSource: "paid", reservationExpiresAt: "2099-01-01T00:05:00Z",
    approvedMaxPages: 80, pageBasis: "unknown",
  } });
  mocks.head.mockReset().mockResolvedValue(matchingHead());
  mocks.fingerprint.mockReset().mockResolvedValue(digest);
});

describe("triage sealed-object metadata gate", () => {
  it.each([
    ["changed ETag", () => mocks.head.mockResolvedValue({ ...matchingHead(), etag: "different-etag" })],
    ["missing HEAD ETag", () => mocks.head.mockResolvedValue({ ...matchingHead(), etag: undefined })],
    ["missing object", () => mocks.head.mockResolvedValue({ ok: true, exists: false })],
    ["wrong size", () => mocks.head.mockResolvedValue({ ...matchingHead(), sizeBytes: 1023 })],
    ["wrong MIME", () => mocks.head.mockResolvedValue({ ...matchingHead(), contentType: "application/octet-stream" })],
    ["HEAD failure", () => mocks.head.mockResolvedValue({ ok: false, code: "R2_HEAD_FAILED" })],
  ] as const)("rejects %s before creating admission or compute reservations", async (_label, setHead) => {
    setHead();
    const response = await capability(request());
    expect(response.status).toBe(_label === "HEAD failure" ? 503 : 409);
    expect(mocks.reserveAdmission).not.toHaveBeenCalled();
    expect(mocks.reserveCompute).not.toHaveBeenCalled();
  });

  it("rejects a missing server-owned ETag binding before HEAD or reservation", async () => {
    mocks.readTriage.mockResolvedValueOnce({ ok: true, result: {
      receipt: {
        receiptId: "11111111-1111-4111-8111-111111111111", inventoryDigest: digest,
        configurationRevision: "triage-config-1",
        fileBindings: [{ fileKey, documentId, objectKey, objectVersion: "" }],
      }, entries: [entry], clientManifestDigest: digest,
    } });
    const response = await capability(request());
    expect(response.status).toBe(409);
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.reserveAdmission).not.toHaveBeenCalled();
    expect(mocks.reserveCompute).not.toHaveBeenCalled();
  });

  it("rejects a receipt digest or inventory version mismatch before HEAD or reservation", async () => {
    mocks.readApproval.mockResolvedValueOnce({ ok: true, result: {
      attemptKey, scopeDigest, pricingFingerprint: digest, triageReceiptId: "11111111-1111-4111-8111-111111111111",
      triageVersion: "tavonel-intake-triage-v1", triageInventoryDigest: `sha256:${"c".repeat(64)}`,
      configurationRevision: "triage-config-1", files: [{ ...entry, documentId }],
    } });
    const response = await capability(request());
    expect(response.status).toBe(409);
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.reserveAdmission).not.toHaveBeenCalled();
    expect(mocks.reserveCompute).not.toHaveBeenCalled();
  });

  it("rejects per-file digest drift between the approval and sealed inventory", async () => {
    mocks.readTriage.mockResolvedValueOnce({ ok: true, result: {
      receipt: {
        receiptId: "11111111-1111-4111-8111-111111111111", inventoryDigest: digest,
        configurationRevision: "triage-config-1",
        fileBindings: [{ fileKey, documentId, objectKey, objectVersion: "server-etag-v1" }],
      },
      entries: [{ ...entry, contentSha256: `sha256:${"d".repeat(64)}` }], clientManifestDigest: digest,
    } });
    const response = await capability(request());
    expect(response.status).toBe(409);
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.reserveAdmission).not.toHaveBeenCalled();
    expect(mocks.reserveCompute).not.toHaveBeenCalled();
  });

  it("checks matching metadata before reservations and again afterward", async () => {
    mocks.head.mockResolvedValueOnce(matchingHead()).mockResolvedValueOnce(matchingHead());
    const response = await capability(request());
    expect(response.status).toBe(200);
    expect(mocks.head).toHaveBeenCalledTimes(2);
    expect(mocks.reserveAdmission).toHaveBeenCalledTimes(1);
    expect(mocks.reserveCompute).toHaveBeenCalledTimes(1);
  });

  it("retains a second metadata check for changes racing after the first HEAD", async () => {
    mocks.head.mockResolvedValueOnce(matchingHead()).mockResolvedValueOnce({ ...matchingHead(), etag: "raced-etag" });
    const response = await capability(request());
    expect(response.status).toBe(409);
    expect(mocks.head).toHaveBeenCalledTimes(2);
    expect(mocks.reserveAdmission).toHaveBeenCalledTimes(1);
    expect(mocks.reserveCompute).toHaveBeenCalledTimes(1);
  });
});
