import { describe, expect, it, vi } from "vitest";
import { approveAndSealTriage, finalizeTriageReceipt, quoteTriageProcessing, stageTriage, type StageTriageResult, type TriageReceiptReply, type TriageUploadFile } from "./intake-triage-client";


const batch: Extract<StageTriageResult, { kind: "ready" }> = {
  kind: "ready",
  batchId: "batch-1",
  staged: [{ index: 0, stageId: "stage-1", relativePath: "a.pdf", requestedBytes: 4, uploadUrl: "https://upload.test/a" }],
};
const files: TriageUploadFile[] = [{ file: new File(["pdf!"], "a.pdf"), relativePath: "a.pdf", mimeType: "application/pdf" }];
const review = [{ fileKey: "file-1", relativePath: "a.pdf", choice: null }];
const estimate = {
  currency: "USD",
  initial: { minimum: 0.04, maximum: 0.06 },
  incremental: { minimum: 0, maximum: 0 },
  customerChargeCoverage: {
    policy: "published_page_admission_once",
    scope: "entire_affected_source_version_set",
    pricingFingerprint: `sha256:${"b".repeat(64)}`,
    sourceVersions: [{ fileKey: "file-1", revision: null, contentSha256: `sha256:${"c".repeat(64)}`, mode: "new_read" }],
  },
  operatorCost: { status: "not_priced", unavailableProviders: ["cdr_infrastructure"] },
  basis: "published customer page-price policy",
  assumptions: ["Prior-read recompile requires trusted persisted reading proof."],
};
const validReady = {
  code: "TRIAGE_RECEIPT_READY",
  receipt: {
    receiptId: "00000000-0000-4000-8000-000000000001",
    triageVersion: "tavonel-intake-triage-v1",
    inventoryDigest: `sha256:${"a".repeat(64)}`,
    inventory: { inventoryDigest: `sha256:${"a".repeat(64)}`, pricingFingerprint: `sha256:${"b".repeat(64)}`,
      selectedFileKeys: ["file-1"] },
    estimate,
    approvalReady: true,
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  review: [{ fileKey: "file-1", relativePath: "a.pdf", disposition: "include", unknowns: { signature: "valid" } }],
  approvalBlockers: [], estimate,
  quote: { estimatedUsd: 0.04, maximumUsd: 0.06 },
};

describe("triage receipt protocol validation", () => {
  it("rejects exclude-all 409 without freezing the client, then accepts a valid retry", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "TRIAGE_NO_FILES_SELECTED" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validReady), { status: 200 }));
    const excluded = await finalizeTriageReceipt(batch, "approval-1", { "file-1": "exclude" }, "token", fetcher);
    expect(excluded).toMatchObject({ error: { code: "TRIAGE_NO_FILES_SELECTED", status: 409 } });
    const retried = await finalizeTriageReceipt(batch, "approval-1", { "file-1": "include" }, "token", fetcher);
    expect(retried).toMatchObject({ code: "TRIAGE_RECEIPT_READY", receipt: { approvalReady: true } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: "TRIAGE_NO_FILES_SELECTED", review },
    { code: "TRIAGE_CHOICES_REQUIRED", review: [{ fileKey: "file-1" }] },
  ])("rejects an operational or malformed 409 as a receipt: %j", async (body) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 }));
    const result = await finalizeTriageReceipt(batch, "approval-1", { "file-1": "exclude" }, "token", fetcher);
    expect(result).toHaveProperty("error");
  });

  it("requires the complete receipt, review, estimate and quote shape for success", async () => {
    const malformed = { ...validReady, receipt: undefined };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(malformed), { status: 200 }));
    const result = await finalizeTriageReceipt(batch, "approval-1", { "file-1": "include" }, "token", fetcher);
    expect(result).toHaveProperty("error");
  });

  it("forwards the operation AbortSignal to the empty-choices receipt request", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: "TRIAGE_PREFLIGHT_APPROVED",
        approval: { preflightApprovalId: "00000000-0000-4000-8000-000000000001" },
        providerCalls: 0,
        monetaryCostStatus: "not_priced",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "TRIAGE_FILE_SEALED" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "TRIAGE_CHOICES_REQUIRED", review }), { status: 409 }));
    await approveAndSealTriage(batch, files, "token", fetcher, signal);
    expect(fetcher.mock.calls[3]?.[1]?.signal).toBe(signal);
  });
});

describe("separate full-processing quote", () => {
  it("asks the server for the current quote and binds it to the ready receipt", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "INTAKE_QUOTE", triageReceiptId: validReady.receipt.receiptId,
      triageInventoryDigest: validReady.receipt.inventoryDigest,
      clientManifestDigest: `sha256:${"c".repeat(64)}`,
      pricingFingerprint: validReady.estimate.customerChargeCoverage.pricingFingerprint,
      quote: { maximumPages: 80, reservedCredits: 2, maximumCredits: 4, estimatedUsd: 0.02, maximumUsd: 0.04 },
      files: [{ fileKey: "file-1" }],
    }), { status: 200 }));
    const result = await quoteTriageProcessing(validReady as unknown as TriageReceiptReply, "token", fetcher);
    expect(result).toMatchObject({ quote: { maximumCredits: 4, maximumUsd: 0.04 }, files: [{ fileKey: "file-1" }] });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/uploads/quote", expect.objectContaining({ method: "POST" }));
  });

  it("never requests a paid quote for a review-blocked receipt", async () => {
    const fetcher = vi.fn();
    const blocked = { ...validReady, code: "TRIAGE_REVIEW_REQUIRED", approvalBlockers: ["ENCRYPTION_UNKNOWN"] };
    const result = await quoteTriageProcessing(blocked as unknown as TriageReceiptReply, "token", fetcher);
    expect(result).toMatchObject({ error: { code: "INTAKE_REVIEW_OR_BUDGET_REQUIRED" } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not offer a stale-pricing quote as approvable", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "INTAKE_PRICE_STALE" }), { status: 409 }));
    const result = await quoteTriageProcessing(validReady as unknown as TriageReceiptReply, "token", fetcher);
    expect(result).toMatchObject({ error: { code: "INTAKE_PRICE_STALE", status: 409 } });
  });

  it("rejects a maximum-dollar value that does not match the quoted credit ceiling", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "INTAKE_QUOTE", triageReceiptId: validReady.receipt.receiptId,
      triageInventoryDigest: validReady.receipt.inventoryDigest,
      clientManifestDigest: `sha256:${"c".repeat(64)}`,
      pricingFingerprint: validReady.estimate.customerChargeCoverage.pricingFingerprint,
      quote: { maximumPages: 80, reservedCredits: 2, maximumCredits: 4, estimatedUsd: 0.02, maximumUsd: 4 },
      files: [{ fileKey: "file-1" }],
    }), { status: 200 }));
    const result = await quoteTriageProcessing(validReady as unknown as TriageReceiptReply, "token", fetcher);
    expect(result).toMatchObject({ error: { code: "INTAKE_QUOTE_INVALID", status: 503 } });
  });
});



describe("server triage client rollout boundary", () => {
  it("falls back only for the explicit disabled response", async () => {
    const disabled = await stageTriage([], "token", vi.fn(async () => new Response(
      JSON.stringify({ code: "INTAKE_TRIAGE_DISABLED" }), { status: 404 },
    )) as typeof fetch);
    expect(disabled).toEqual({ kind: "disabled" });

    const unavailable = await stageTriage([], "token", vi.fn(async () => new Response(
      JSON.stringify({ code: "COMPUTE_LEDGER_NOT_CONFIGURED" }), { status: 503 },
    )) as typeof fetch);
    expect(unavailable).toMatchObject({ kind: "blocked", error: { code: "COMPUTE_LEDGER_NOT_CONFIGURED" } });
  });

  it("rejects partial inventories rather than silently dropping source rows", async () => {
    const reply = await stageTriage([], "token", vi.fn(async () => new Response(
      JSON.stringify({ code: "TRIAGE_STAGE_PARTIAL", staged: [], errors: [{ index: 0, code: "UNSUPPORTED_MIME" }] }), { status: 400 },
    )) as typeof fetch);
    expect(reply).toMatchObject({ kind: "blocked", error: { code: "TRIAGE_STAGE_PARTIAL", detail: [{ index: 0, code: "UNSUPPORTED_MIME" }] } });
  });
});
