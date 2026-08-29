const SHA256 = /^sha256:[a-f0-9]{64}$/;
const FAILURE_CODES = new Set([
  "OCR_SOURCE_MISSING",
  "OCR_SOURCE_EMPTY",
  "OCR_TIMEOUT_OR_NETWORK",
  "OCR_HTTP_REJECTED",
  "OCR_RESPONSE_NOT_JSON",
  "OCR_RESPONSE_INVALID",
  "OCR_RESULT_WRITE_FAILED",
]);

export type OcrReviewReceipt = {
  schemaVersion: "tavonel.ocr_review_receipt.v1";
  status: "operator_review";
  immutableKey: string;
  inputSha256: string;
  reasonCode: string;
  retryPolicy: "explicit_operator_only";
  candidatePromotion: false;
};

export function validateOcrReviewReceipt(
  value: unknown,
  expectedImmutableKey: string,
): OcrReviewReceipt | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as Partial<OcrReviewReceipt>;
  if (
    receipt.schemaVersion !== "tavonel.ocr_review_receipt.v1" ||
    receipt.status !== "operator_review" ||
    receipt.immutableKey !== expectedImmutableKey ||
    !SHA256.test(receipt.inputSha256 ?? "") ||
    typeof receipt.reasonCode !== "string" ||
    !FAILURE_CODES.has(receipt.reasonCode) ||
    receipt.retryPolicy !== "explicit_operator_only" ||
    receipt.candidatePromotion !== false
  ) return null;
  return receipt as OcrReviewReceipt;
}
