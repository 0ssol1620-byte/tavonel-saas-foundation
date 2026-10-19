import { describe, expect, it } from "vitest";
import { checkOcrReviewReceipt, validateOcrReviewReceipt } from "./processing-receipts";

const immutableKey = `immutable/pilot/pilot/doc/${"a".repeat(64)}/sanitized.pdf`;

describe("OCR operator-review receipt", () => {
  it("accepts only an exact immutable binding with explicit-only retry policy", () => {
    const receipt = {
      schemaVersion: "tavonel.ocr_review_receipt.v1",
      status: "operator_review",
      immutableKey,
      inputSha256: `sha256:${"a".repeat(64)}`,
      reasonCode: "OCR_TIMEOUT_OR_NETWORK",
      retryPolicy: "explicit_operator_only",
      candidatePromotion: false,
    };
    expect(validateOcrReviewReceipt(receipt, immutableKey)).toEqual(receipt);
    expect(validateOcrReviewReceipt({ ...receipt, immutableKey: `${immutableKey}.other` }, immutableKey)).toBeNull();
    expect(validateOcrReviewReceipt({ ...receipt, retryPolicy: "automatic" }, immutableKey)).toBeNull();
    expect(validateOcrReviewReceipt({ ...receipt, reasonCode: "UNTRUSTED_EXTERNAL_TEXT" }, immutableKey)).toBeNull();
  });

  it("knows the CDR worker's page-range code before the page-range flag can emit it", () => {
    // PR #152: a page range with no durable answer ends as OCR_PAGES_INCOMPLETE, a transport failure
    // recorded at zero credits on the last attempt. A receipt carrying it must not read as unknown.
    const receipt = {
      schemaVersion: "tavonel.ocr_review_receipt.v1",
      status: "operator_review",
      immutableKey,
      inputSha256: `sha256:${"a".repeat(64)}`,
      reasonCode: "OCR_PAGES_INCOMPLETE",
      retryPolicy: "explicit_operator_only",
      candidatePromotion: false,
    };
    expect(validateOcrReviewReceipt(receipt, immutableKey)).toEqual(receipt);
    expect(validateOcrReviewReceipt({ ...receipt, reasonCode: "OCR_PAGES_INCOMPLETE_V2" }, immutableKey)).toBeNull();
  });
});

/*
  The CDR worker has written `tavonel.ocr_review_receipt.v2` since 933fb05e (2026-10-08):
  `foundation-cdr-worker/src/sanitize.ts` puts exactly these thirteen fields, in this order, and
  its OcrReviewBilling type allows exactly two dispositions. A validator that knew only v1 turned
  every receipt the current worker writes into a held row with no reason.
*/
describe("OCR operator-review receipt v2", () => {
  const sourceKey = "quarantine/pilot/doc/source";
  const workerReceipt = {
    schemaVersion: "tavonel.ocr_review_receipt.v2",
    status: "operator_review",
    sourceKey,
    immutableKey,
    inputSha256: `sha256:${"a".repeat(64)}`,
    reasonCode: "OCR_HTTP_REJECTED",
    reason: "OCR failed after CDR",
    requestId: null,
    occurredAt: "2026-08-29T00:00:00.000Z",
    retryPolicy: "explicit_operator_only",
    candidatePromotion: false,
    billingDisposition: "operator_review",
    computeCredits: 2,
  };

  it("accepts the receipt the CDR worker writes, field for field, for both of its dispositions", () => {
    expect(validateOcrReviewReceipt(workerReceipt, immutableKey)).toEqual(workerReceipt);
    const released = { ...workerReceipt, reasonCode: "OCR_TIMEOUT_OR_NETWORK", requestId: "fixture-review-request",
      billingDisposition: "released", computeCredits: 0 };
    expect(validateOcrReviewReceipt(released, immutableKey)).toEqual(released);
  });

  it("holds v2 to the same binding as v1", () => {
    expect(validateOcrReviewReceipt({ ...workerReceipt, immutableKey: `${immutableKey}.other` }, immutableKey)).toBeNull();
    expect(validateOcrReviewReceipt({ ...workerReceipt, retryPolicy: "automatic" }, immutableKey)).toBeNull();
    expect(validateOcrReviewReceipt({ ...workerReceipt, reasonCode: "UNTRUSTED_EXTERNAL_TEXT" }, immutableKey)).toBeNull();
    expect(validateOcrReviewReceipt({ ...workerReceipt, candidatePromotion: true }, immutableKey)).toBeNull();
    expect(validateOcrReviewReceipt({ ...workerReceipt, inputSha256: "a".repeat(64) }, immutableKey)).toBeNull();
  });

  it.each([
    ["an unknown disposition", { billingDisposition: "refunded" }],
    ["a disposition of the wrong case", { billingDisposition: "RELEASED", computeCredits: 0 }],
    ["no disposition", { billingDisposition: undefined, computeCredits: undefined }],
    ["a release that charged", { billingDisposition: "released", computeCredits: 2 }],
    ["a review that charged nothing", { billingDisposition: "operator_review", computeCredits: 0 }],
    ["credits as a string", { computeCredits: "2" }],
    ["fractional credits", { computeCredits: 2.5 }],
    ["negative credits", { billingDisposition: "released", computeCredits: -0.5 }],
    ["no source key", { sourceKey: undefined }],
    ["a source key outside quarantine", { sourceKey: "immutable/pilot/doc/source" }],
    ["a source key with an extra segment", { sourceKey: "quarantine/pilot/doc/extra/source" }],
    ["an unbounded source key", { sourceKey: `quarantine/${"p".repeat(1_024)}/doc/source` }],
    ["a source key that is not a string", { sourceKey: ["quarantine/pilot/doc/source"] }],
  ])("rejects a v2 receipt with %s", (_, override) => {
    expect(validateOcrReviewReceipt({ ...workerReceipt, ...override }, immutableKey)).toBeNull();
  });

  it("knows the two worker codes it used to drop, with the disposition the worker gives each", () => {
    // ocr.ts OCR_FAILURE_CATEGORY: OCR_HTTP_UNAVAILABLE is transport (provider_5xx), released at zero
    // credits; OCR_PERSISTED_RESULT_INVALID is semantic (invalid_output), kept for review at two.
    for (const receipt of [
      { ...workerReceipt, reasonCode: "OCR_HTTP_UNAVAILABLE", billingDisposition: "released", computeCredits: 0 },
      { ...workerReceipt, reasonCode: "OCR_PERSISTED_RESULT_INVALID" },
      { schemaVersion: "tavonel.ocr_review_receipt.v1", status: "operator_review", immutableKey, inputSha256: `sha256:${"a".repeat(64)}`,
        reasonCode: "OCR_HTTP_UNAVAILABLE", retryPolicy: "explicit_operator_only", candidatePromotion: false },
    ]) {
      expect(validateOcrReviewReceipt(receipt, immutableKey)).toEqual(receipt);
    }
  });

  it("says why a receipt was refused, telling an unknown schema from a broken one", () => {
    expect(checkOcrReviewReceipt(workerReceipt, immutableKey)).toEqual({ ok: true, receipt: workerReceipt });
    expect(checkOcrReviewReceipt({ ...workerReceipt, schemaVersion: "tavonel.ocr_review_receipt.v9" }, immutableKey))
      .toEqual({ ok: false, code: "OCR_RECEIPT_SCHEMA_UNSUPPORTED" });
    expect(checkOcrReviewReceipt({ ...workerReceipt, schemaVersion: undefined }, immutableKey))
      .toEqual({ ok: false, code: "OCR_RECEIPT_SCHEMA_UNSUPPORTED" });
    expect(checkOcrReviewReceipt({ ...workerReceipt, billingDisposition: "refunded" }, immutableKey))
      .toEqual({ ok: false, code: "OCR_RECEIPT_INVALID" });
    expect(checkOcrReviewReceipt(null, immutableKey)).toEqual({ ok: false, code: "OCR_RECEIPT_INVALID" });
    expect(checkOcrReviewReceipt([], immutableKey)).toEqual({ ok: false, code: "OCR_RECEIPT_INVALID" });
  });
});
