import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  authorize: vi.fn(), admit: vi.fn(), create: vi.fn(),
  fingerprint: vi.fn(), quote: vi.fn(), ready: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: m.authorize }));
vi.mock("@/lib/activation-policy", () => ({ activationPolicy: { customerIntake: { enabled: true, reason: "open" } } }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: m.admit }));
vi.mock("@/lib/compute-reservation", () => ({ createFoundationIntakeApproval: m.create, readFoundationIntakeApproval: vi.fn() }));
vi.mock("@/lib/intake-triage-server", () => ({ readReadyUploadTriage: m.ready }));
vi.mock("@/lib/intake-triage-rollout", () => ({ INTAKE_TRIAGE_ROLLOUT_ENABLED: true }));
vi.mock("@/lib/usage-pricing", () => ({ intakePricingFingerprint: m.fingerprint, quoteIntakeManifest: m.quote }));

import { POST as approve } from "../app/api/uploads/approval/route";
import { POST as quote } from "../app/api/v1/uploads/quote/route";

const hash = `sha256:${"a".repeat(64)}`;
const attemptKey = "attempt_0123456789abcdef";
const receiptId = "11111111-1111-4111-8111-111111111111";
const fileKey = "fk_12345678";
const entry = {
  fileKey, originalFilename: "report.pdf", contentSha256: hash, byteLength: 1024,
  mimeType: "application/pdf", claimedPages: null, claimedBasis: null,
};
const receipt = {
  receiptId, workspaceKey: "pilot-abc123", actorUserId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
  sourceKind: "direct_upload", sourceId: "stage_0123456789abcdef", inventoryRevision: hash,
  triageVersion: "tavonel-intake-triage-v1", inventoryDigest: hash,
  configurationRevision: "triage-config-1", pricingFingerprint: hash,
  inventory: {}, estimate: { costScope: "entire_affected_compile_request", reprocessingIncluded: true },
  fileBindings: [], approvalReady: true, expiresAt: "2026-10-04T12:05:00Z",
};
const ready = { receipt, entries: [entry], clientManifestDigest: hash };

function request(url: string, value: Record<string, unknown>) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
}

beforeEach(() => {
  m.authorize.mockReset().mockResolvedValue({ ok: true, principal: {
    workspaceKey: "pilot-abc123", userId: receipt.actorUserId, accessSource: "paid",
  } });
  m.admit.mockReset().mockResolvedValue(true);
  m.ready.mockReset().mockResolvedValue({ ok: true, result: ready });
  m.create.mockReset().mockResolvedValue({ ok: true, result: { approvalId: "22222222-2222-4222-8222-222222222222" } });
  m.fingerprint.mockReset().mockResolvedValue(hash);
  m.quote.mockReset().mockImplementation((files: Array<unknown>) => ({
    ok: true,
    quote: { maximumPages: files.length * 80, reservedCredits: files.length, maximumCredits: files.length,
      estimatedUsd: files.length / 100, maximumUsd: files.length / 50,
      files: files.map(() => ({ pageBasis: "unknown", approvedMaxPages: 80, reservedCredits: 1, maximumCredits: 1 })) },
  }));
});

describe("triage receipt quote and approval binding", () => {
  it("refuses the old client manifest-only quote before pricing", async () => {
    const response = await quote(request("https://tavonel.com/api/v1/uploads/quote", {
      clientManifestDigest: hash, files: [entry],
    }));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "INTAKE_TRIAGE_REQUIRED" });
    expect(m.quote).not.toHaveBeenCalled();
  });

  it("refuses enabled quote when the receipt RPC is unavailable and never falls back to client files", async () => {
    m.ready.mockResolvedValue({ ok: false, code: "INTAKE_TRIAGE_RECEIPT_NOT_FOUND", status: 503 });
    const response = await quote(request("https://tavonel.com/api/v1/uploads/quote", {
      triageReceiptId: receiptId, clientManifestDigest: hash, files: [entry],
    }));
    expect(response.status).toBe(503);
    expect(m.ready).toHaveBeenCalledTimes(1);
    expect(m.quote).not.toHaveBeenCalled();
  });

  it("quotes only server-loaded selected inventory, ignoring client file claims", async () => {
    const response = await quote(request("https://tavonel.com/api/v1/uploads/quote", {
      triageReceiptId: receiptId, files: [{ ...entry, byteLength: 999999 }],
    }));
    expect(response.status).toBe(200);
    expect(m.ready).toHaveBeenCalledWith({ workspaceKey: "pilot-abc123", userId: receipt.actorUserId, receiptId });
    expect(m.quote).toHaveBeenCalledWith([{ bytes: entry.byteLength, mimeType: entry.mimeType, claimedPages: null, claimedBasis: null }]);
    await expect(response.json()).resolves.toMatchObject({
      triageReceiptId: receiptId, triageVersion: receipt.triageVersion,
      triageInventoryDigest: hash, clientManifestDigest: hash,
    });
  });

  it("does not create approval when the authenticated receipt lookup is stale or unavailable", async () => {
    m.ready.mockResolvedValue({ ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 });
    const response = await approve(request("https://tavonel.com/api/uploads/approval", {
      attemptKey, triageReceiptId: receiptId, pricingFingerprint: hash, aggregateMaximumCredits: 1,
    }));
    expect(response.status).toBe(409);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("refuses enabled approval when the triage RPC is missing and never retries the legacy path", async () => {
    m.ready.mockResolvedValue({ ok: false, code: "INTAKE_TRIAGE_RECEIPT_NOT_FOUND", status: 503 });
    const response = await approve(request("https://tavonel.com/api/uploads/approval", {
      attemptKey, triageReceiptId: receiptId, pricingFingerprint: hash, aggregateMaximumCredits: 1,
      files: [entry], clientManifestDigest: hash,
    }));
    expect(response.status).toBe(503);
    expect(m.ready).toHaveBeenCalledTimes(1);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("binds the server receipt/version/digests into new approval creation", async () => {
    const response = await approve(request("https://tavonel.com/api/uploads/approval", {
      attemptKey, triageReceiptId: receiptId, pricingFingerprint: hash, aggregateMaximumCredits: 1,
      files: [{ ...entry, contentSha256: `sha256:${"b".repeat(64)}` }],
    }));
    expect(response.status).toBe(200);
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0]![0]).toMatchObject({
      triageReceiptId: receiptId, triageVersion: receipt.triageVersion,
      triageInventoryDigest: hash, configurationRevision: receipt.configurationRevision,
      clientManifestDigest: hash,
    });
    expect(m.create.mock.calls[0]![0].files[0]).toMatchObject({ fileKey, contentSha256: hash, byteLength: 1024 });
  });

  it("refuses a changed pricing fingerprint against the receipt", async () => {
    m.fingerprint.mockResolvedValue(`sha256:${"b".repeat(64)}`);
    const response = await approve(request("https://tavonel.com/api/uploads/approval", {
      attemptKey, triageReceiptId: receiptId, pricingFingerprint: hash, aggregateMaximumCredits: 1,
    }));
    expect(response.status).toBe(409);
    expect(m.create).not.toHaveBeenCalled();
  });
});
