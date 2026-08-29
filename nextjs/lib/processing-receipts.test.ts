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
});
