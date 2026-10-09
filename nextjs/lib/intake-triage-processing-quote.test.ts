import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admit: vi.fn(), ready: vi.fn(), fingerprint: vi.fn(), quote: vi.fn() }));

vi.mock("@/lib/activation-policy", () => ({ activationPolicy: { customerIntake: { enabled: true, reason: null } } }));
vi.mock("@/lib/enterprise-http", () => ({ readBoundedJson: async (request: Request) => ({ ok: true, value: await request.json() }) }));
vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: mocks.auth }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: mocks.admit }));
vi.mock("@/lib/intake-approval", () => ({
  MAX_APPROVAL_FILES: 128, MAX_APPROVAL_METADATA_BYTES: 512 * 1024,
  SHA256_DIGEST_PATTERN: /^sha256:[a-f0-9]{64}$/,
  intakeManifestDigest: vi.fn(), readManifestEntry: vi.fn(),
}));
vi.mock("@/lib/intake-triage-server", () => ({ readReadyUploadTriage: mocks.ready }));
vi.mock("@/lib/intake-triage-rollout", () => ({ INTAKE_TRIAGE_ROLLOUT_ENABLED: true }));
vi.mock("@/lib/qualified-input", () => ({
  validateQualifiedDocumentInput: ({ originalFilename, declaredMimeType }: Record<string, string>) => ({
    valid: true, normalizedMimeType: declaredMimeType, originalFilename,
  }),
}));
vi.mock("@/lib/r2-presign", () => ({
  FOUNDATION_INTAKE_MAX_BYTES: 5 * 1024 * 1024, FOUNDATION_TRIAL_INTAKE_MAX_BYTES: 1024 * 1024,
  PROCESSING_CEILING: { maxSourcePages: 80 }, PROCESSING_CEILING_SENTENCE: "bounded",
}));
vi.mock("@/lib/usage-pricing", () => ({ intakePricingFingerprint: mocks.fingerprint, quoteIntakeManifest: mocks.quote }));

import { POST } from "../app/api/v1/uploads/quote/route";

const workspaceKey = "pilot-abc123";
const userId = "22222222-2222-4222-8222-222222222222";
const receiptId = "11111111-1111-4111-8111-111111111111";
const digest = `sha256:${"a".repeat(64)}`;
const fileKey = "fk_12345678";
const entries = [{ fileKey, originalFilename: "report.pdf", contentSha256: digest,
  byteLength: 1024, mimeType: "application/pdf", claimedPages: null, claimedBasis: null }];

function request() {
  return new Request("https://tavonel.invalid/api/v1/uploads/quote", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ triageReceiptId: receiptId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, principal: { workspaceKey, userId, accessSource: "paid" } });
  mocks.admit.mockResolvedValue(true);
  mocks.fingerprint.mockResolvedValue(digest);
  mocks.ready.mockResolvedValue({ ok: true, result: {
    receipt: { receiptId, triageVersion: "tavonel-intake-triage-v1", inventoryDigest: digest,
      configurationRevision: "config-1", pricingFingerprint: digest,
      estimate: { currency: "USD", initial: { minimum: 1, maximum: 3 } } },
    entries, clientManifestDigest: `sha256:${"b".repeat(64)}`,
  } });
  mocks.quote.mockReturnValue({ ok: true, quote: {
    maximumPages: 80, reservedCredits: 200, maximumCredits: 400, estimatedUsd: 2, maximumUsd: 4,
    files: [{ pageBasis: "unknown", approvedMaxPages: 80, reservedCredits: 200, maximumCredits: 400 }],
  } });
});

describe("receipt-bound full-processing quote", () => {
  it("quotes only the accepted receipt source set at the current published price", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTAKE_QUOTE", triageReceiptId: receiptId, triageInventoryDigest: digest,
      pricingFingerprint: digest, quote: { maximumCredits: 400, maximumUsd: 4 },
      files: [{ fileKey, approvedMaxPages: 80 }],
    });
    expect(mocks.ready).toHaveBeenCalledWith({ workspaceKey, userId, receiptId });
    expect(mocks.quote).toHaveBeenCalledWith([{ bytes: 1024, mimeType: "application/pdf", claimedPages: null, claimedBasis: null }]);
  });

  it("returns the qualification blocker before pricing or approval can proceed", async () => {
    mocks.ready.mockResolvedValue({ ok: false, code: "INTAKE_REVIEW_OR_BUDGET_REQUIRED", status: 409 });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it("refuses a quote when published pricing changed after receipt creation", async () => {
    mocks.fingerprint.mockResolvedValue(`sha256:${"c".repeat(64)}`);
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "INTAKE_PRICE_STALE" });
    expect(mocks.quote).not.toHaveBeenCalled();
  });
});
