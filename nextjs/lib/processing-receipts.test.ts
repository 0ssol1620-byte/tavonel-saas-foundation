import { describe, expect, it } from "vitest";
import { validateOcrReviewReceipt } from "./processing-receipts";

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
