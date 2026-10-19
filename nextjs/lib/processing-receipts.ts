const SHA256 = /^sha256:[a-f0-9]{64}$/;
// The CDR worker's quarantine source key (foundation-cdr-worker/src/keys.ts SOURCE_KEY_PATTERN), bounded like an R2 key.
const SOURCE_KEY = /^quarantine\/[^/]+\/[^/]+\/source$/;
const MAX_SOURCE_KEY = 1_024;
const FAILURE_CODES = new Set([
  "OCR_SOURCE_MISSING",
  "OCR_SOURCE_EMPTY",
  "OCR_TIMEOUT_OR_NETWORK",
  "OCR_HTTP_UNAVAILABLE",
  "OCR_HTTP_REJECTED",
  "OCR_RESPONSE_NOT_JSON",
  "OCR_RESPONSE_INVALID",
  "OCR_PERSISTED_RESULT_INVALID",
  "OCR_RESULT_WRITE_FAILED",
  "OCR_PAGES_INCOMPLETE",
]);

type OcrReviewReceiptV1 = {
  schemaVersion: "tavonel.ocr_review_receipt.v1";
  status: "operator_review";
  immutableKey: string;
  inputSha256: string;
  reasonCode: string;
  retryPolicy: "explicit_operator_only";
  candidatePromotion: false;
};

/**
 * What the CDR worker has written since 933fb05e (sanitize.ts OCR_REVIEW_RECEIPT_SCHEMA): v1 plus the
 * source it read and the disposition its settlement used -- exactly one of the two OcrReviewBilling pairs.
 */
type OcrReviewReceiptV2 = Omit<OcrReviewReceiptV1, "schemaVersion"> & {
  schemaVersion: "tavonel.ocr_review_receipt.v2";
  sourceKey: string;
} & (
  | { billingDisposition: "released"; computeCredits: 0 }
  | { billingDisposition: "operator_review"; computeCredits: 2 }
);

export type OcrReviewReceipt = OcrReviewReceiptV1 | OcrReviewReceiptV2;

/** Why a loaded receipt was refused: a stable code, so a refusal never reads as a row with no reason. */
export type OcrReviewReceiptRejection = "OCR_RECEIPT_SCHEMA_UNSUPPORTED" | "OCR_RECEIPT_INVALID";

export function checkOcrReviewReceipt(
  value: unknown,
  expectedImmutableKey: string,
): { ok: true; receipt: OcrReviewReceipt } | { ok: false; code: OcrReviewReceiptRejection } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "OCR_RECEIPT_INVALID" };
  const receipt = value as Record<string, unknown>;
  const v2 = receipt.schemaVersion === "tavonel.ocr_review_receipt.v2";
  if (!v2 && receipt.schemaVersion !== "tavonel.ocr_review_receipt.v1") {
    return { ok: false, code: "OCR_RECEIPT_SCHEMA_UNSUPPORTED" };
  }
  if (
    receipt.status !== "operator_review" ||
    receipt.immutableKey !== expectedImmutableKey ||
    typeof receipt.inputSha256 !== "string" ||
    !SHA256.test(receipt.inputSha256) ||
    typeof receipt.reasonCode !== "string" ||
    !FAILURE_CODES.has(receipt.reasonCode) ||
    receipt.retryPolicy !== "explicit_operator_only" ||
    receipt.candidatePromotion !== false ||
    (v2 && (
      typeof receipt.sourceKey !== "string" ||
      receipt.sourceKey.length > MAX_SOURCE_KEY ||
      !SOURCE_KEY.test(receipt.sourceKey) ||
      !((receipt.billingDisposition === "released" && receipt.computeCredits === 0) ||
        (receipt.billingDisposition === "operator_review" && receipt.computeCredits === 2))
    ))
  ) return { ok: false, code: "OCR_RECEIPT_INVALID" };
  return { ok: true, receipt: value as OcrReviewReceipt };
}

export function validateOcrReviewReceipt(
  value: unknown,
  expectedImmutableKey: string,
): OcrReviewReceipt | null {
  const checked = checkOcrReviewReceipt(value, expectedImmutableKey);
  return checked.ok ? checked.receipt : null;
}
