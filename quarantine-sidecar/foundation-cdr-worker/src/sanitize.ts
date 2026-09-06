import type { FailureClass } from "../../../shared/uskcEnums";
import { PermanentReject, RetryableError } from "./errors";
import { assertFoundationOnlyTarget } from "./guards";
import { cdrRequestSignature, hmacSecretIsConfigured, sha256DigestHeader, sha256Hex } from "./hmac";
import {
  MAX_SOURCE_BYTES,
  assertProcessableSourceKey,
  cdrReceiptSiblingKey,
  immutableObjectKey,
  ocrReviewSiblingKey,
  parseQuarantineSourceKey,
  sourcePartFromR2Object,
} from "./keys";
import { dispatchOcrAfterSanitize, ocrFailureKind, type OcrDispatchResult } from "./ocr";

export type SanitizeResult = {
  sourceKey: string;
  immutableKey: string;
  inputSha256: string;
  outputSha256: string;
  status: "clean";
  ocr: OcrDispatchResult;
  cdrReceipt: { key: string; status: "written" | "exists" | "failed" };
  ocrReview?: { key: string; status: "written" | "exists" | "failed" };
};

export type R2ObjectLike = {
  size: number;
  httpMetadata?: { contentType?: string; contentDisposition?: string };
  customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type R2BucketLike = {
  get(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: { stage: string };
      onlyIf: { etagDoesNotMatch: string };
    },
  ): Promise<unknown>;
};

export type SanitizeEnv = {
  FOUNDATION_QUARANTINE: R2BucketLike;
  TAVONEL_CDR_URL: string;
  TAVONEL_CDR_HMAC?: string;
  TAVONEL_CDR_PROVIDER: string;
  FOUNDATION_R2_BUCKET: string;
  FOUNDATION_OCR_URL?: string;
  TAVONEL_OCR_HMAC?: string;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;
const SAFE_CDR_DETAIL_PATTERN = /^CDR [A-Za-z0-9 ._()-]{1,156}$/;

async function safeCdrRejectDetail(response: Response): Promise<string | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || !("detail" in body)) {
    return null;
  }
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail !== "string") {
    return null;
  }
  const normalized = detail.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return SAFE_CDR_DETAIL_PATTERN.test(normalized) ? normalized : null;
}

async function putCreateOnceJson(
  bucket: R2BucketLike,
  key: string,
  value: Record<string, unknown>,
): Promise<"written" | "exists" | "failed"> {
  try {
    await bucket.put(key, new TextEncoder().encode(`${JSON.stringify(value)}\n`), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { stage: "processing-receipt" },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    return "written";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return /precondition|already exists|conflict/iu.test(message) ? "exists" : "failed";
  }
}

/**
 * A refusal that knows what class of refusal it is.
 *
 * A permanent reject used to be a sentence and nothing else: the worker threw, the queue message
 * was acknowledged, a billing release was dispatched, and no object, row or audit event survived.
 * The document simply stopped existing, and the board showed PREPARE running forever.
 *
 * The class travels with the error so the receipt cannot be written with a guessed code. When a
 * refusal reaches the queue handler without one, no receipt is written and the message is *not*
 * acknowledged -- a wrong reason recorded as evidence is worse than a retry.
 */
export type SourceRefusal = PermanentReject & {
  readonly failureClass: FailureClass;
  /** The size R2 reported, when the object was reached before the refusal. Never estimated. */
  readonly observedBytes: number | null;
  /** What intake said it would be, when the object carries it. Null, never inferred. */
  readonly declaredBytes: number | null;
};

export function refuse(
  failureClass: FailureClass,
  message: string,
  observed: { observedBytes?: number | null; declaredBytes?: number | null } = {},
): SourceRefusal {
  return Object.assign(new PermanentReject(message), {
    failureClass,
    observedBytes: observed.observedBytes ?? null,
    declaredBytes: observed.declaredBytes ?? null,
  });
}

export function asSourceRefusal(error: unknown): SourceRefusal | null {
  return error instanceof PermanentReject && typeof (error as SourceRefusal).failureClass === "string"
    ? (error as SourceRefusal)
    : null;
}

/**
 * What each refusal the Cloud Run rasterizer can produce means, in the frozen vocabulary.
 *
 * The keys are the `detail` strings `quarantine-sidecar/cdr-cloudrun/app.py` raises, already
 * narrowed by `safeCdrRejectDetail`. `sanitize.test.ts` reads that file and fails if it grows a
 * refusal this table does not cover, so the mapping cannot quietly fall behind the service that
 * produces it. Authentication and 5xx statuses never reach here: they are this worker's own
 * problem, not a statement about the customer's document, and are raised as retryable.
 *
 * The frozen `FailureClass` set has no "larger than this deployment can process" member, so a
 * ceiling refusal is `PARSER_OOM` -- the reader could not hold the document -- and a
 * `SOURCE_TOO_LARGE` member is proposed for enums v2 in the lane report.
 */
export const CDR_DETAIL_FAILURE_CLASS: Record<string, FailureClass> = {
  "CDR source filename is invalid": "UNSUPPORTED_FORMAT",
  "CDR source format is not qualified for PDF rasterization": "UNSUPPORTED_FORMAT",
  "CDR Office package expansion is not qualified": "UNSUPPORTED_FORMAT",
  "CDR Office package is invalid or encrypted": "ENCRYPTED_SOURCE",
  "CDR password-protected PDF is not qualified": "ENCRYPTED_SOURCE",
  "CDR Office package contains unqualified active or embedded content": "MALWARE_QUARANTINED",
  "CDR source exceeds the controlled-beta size limit": "PARSER_OOM",
  "CDR sanitized output is outside the controlled-beta size limit": "PARSER_OOM",
  "CDR source rendering budget is not qualified": "PARSER_OOM",
  "CDR source page count is not qualified": "PARSER_OOM",
  "CDR source is empty": "CORRUPT_SOURCE",
  "CDR source could not be converted safely": "CORRUPT_SOURCE",
  "CDR source renderer rejected this document": "CORRUPT_SOURCE",
  "CDR source could not be rasterized safely": "CORRUPT_SOURCE",
  "CDR source digest does not match the uploaded body": "RECEIPT_MISMATCH",
  "CDR request has already been consumed": "RECEIPT_MISMATCH",
};

export function cdrRefusalFailureClass(status: number, detail: string | null): FailureClass {
  const mapped = detail ? CDR_DETAIL_FAILURE_CLASS[detail] : undefined;
  if (mapped) return mapped;
  // No detail survived the safety filter. The status is all that is left, and it describes the
  // request rather than the bytes, so the class it yields stays coarse.
  if (status === 413) return "PARSER_OOM";
  if (status === 415) return "UNSUPPORTED_FORMAT";
  return "CORRUPT_SOURCE";
}

export const CDR_REJECT_RECEIPT_SCHEMA = "tavonel.cdr_reject_receipt.v1" as const;

export type CdrRejectReceipt = {
  schemaVersion: typeof CDR_REJECT_RECEIPT_SCHEMA;
  sourceKey: string;
  observedBytes: number | null;
  declaredBytes: number | null;
  reasonCode: FailureClass;
  provider: string;
  occurredAt: string;
};

/** Sibling of the quarantine source, because a refused source never gets an immutable version. */
export function cdrRejectSiblingKey(sourceKey: string): string | null {
  return parseQuarantineSourceKey(sourceKey)
    ? `${sourceKey.slice(0, -"/source".length)}/cdr-reject.json`
    : null;
}

/**
 * Records the refusal, once, next to the source it refused.
 *
 * Create-once: a redelivered queue message writes no second receipt and never changes the first,
 * which is what makes the refusal evidence rather than a log line. Returns null when the refusal
 * carries no class, when the key is not a quarantine source, or when the write failed -- the
 * caller must then retry rather than acknowledge, because a refusal nobody recorded is the exact
 * failure this receipt exists to remove.
 *
 * The receipt carries no filename and no content. A size, a class and a time are the whole of it.
 */
export async function writeCdrRejectReceipt(
  env: { FOUNDATION_QUARANTINE: R2BucketLike; TAVONEL_CDR_PROVIDER: string },
  sourceKey: string,
  error: unknown,
  now: () => Date = () => new Date(),
): Promise<{ key: string; status: "written" | "exists"; receipt: CdrRejectReceipt } | null> {
  const refusal = asSourceRefusal(error);
  const key = cdrRejectSiblingKey(sourceKey);
  if (!refusal || !key) return null;
  const receipt: CdrRejectReceipt = {
    schemaVersion: CDR_REJECT_RECEIPT_SCHEMA,
    sourceKey,
    observedBytes: refusal.observedBytes,
    declaredBytes: refusal.declaredBytes,
    reasonCode: refusal.failureClass,
    provider: env.TAVONEL_CDR_PROVIDER,
    occurredAt: now().toISOString(),
  };
  const status = await putCreateOnceJson(env.FOUNDATION_QUARANTINE, key, receipt);
  return status === "failed" ? null : { key, status, receipt };
}

/** Only what intake wrote onto the object. Absent means unknown, never a stand-in value. */
function declaredBytesOf(object: R2ObjectLike): number | null {
  const raw = Number(object.customMetadata?.declaredBytes ?? "");
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

export async function sanitizeObject(
  env: SanitizeEnv,
  objectKey: string,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
  newRequestId: () => string = () => crypto.randomUUID(),
): Promise<SanitizeResult> {
  if (!hmacSecretIsConfigured(env.TAVONEL_CDR_HMAC)) {
    throw new RetryableError("CDR HMAC is not configured");
  }
  assertFoundationOnlyTarget(env.TAVONEL_CDR_URL, env.FOUNDATION_R2_BUCKET);

  const parts = assertProcessableSourceKey(objectKey);
  const object = await env.FOUNDATION_QUARANTINE.get(objectKey);
  if (!object) {
    throw new RetryableError("quarantine source object is not yet readable");
  }
  const declaredBytes = declaredBytesOf(object);
  if (object.size > MAX_SOURCE_BYTES) {
    throw refuse("PARSER_OOM", "quarantine source exceeds the 5 MiB Foundation CDR cap", {
      observedBytes: object.size,
      declaredBytes,
    });
  }

  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw refuse("PARSER_OOM", "quarantine source exceeds the 5 MiB Foundation CDR cap", {
      observedBytes: bytes.byteLength,
      declaredBytes,
    });
  }
  if (bytes.byteLength < 1) {
    throw refuse("CORRUPT_SOURCE", "quarantine source is empty", { observedBytes: 0, declaredBytes });
  }

  const inputSha256 = await sha256DigestHeader(bytes);
  const { filename, contentType } = sourcePartFromR2Object(object);
  const timestamp = now().toISOString();
  const requestId = newRequestId();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new RetryableError("CDR request id is invalid");
  }

  const signature = await cdrRequestSignature(env.TAVONEL_CDR_HMAC as string, timestamp, requestId, inputSha256);
  const form = new FormData();
  form.append("source", new Blob([bytes], { type: contentType }), filename);

  let response: Response;
  try {
    response = await fetcher(env.TAVONEL_CDR_URL, {
      method: "POST",
      headers: {
        "x-tavonel-input-sha256": inputSha256,
        "x-tavonel-cdr-timestamp": timestamp,
        "x-tavonel-cdr-request-id": requestId,
        "x-tavonel-cdr-signature": signature,
      },
      body: form,
    });
  } catch {
    throw new RetryableError("synthetic CDR request failed");
  }

  if (response.status >= 500) {
    throw new RetryableError("synthetic CDR returned a server error");
  }
  // 401/403 is the worker failing to authenticate, not a verdict on the document. Refusing the
  // customer's source for our own misconfiguration is the operational-versus-semantic confusion
  // this lane exists to remove, so it retries and eventually dead-letters instead.
  if (response.status === 401 || response.status === 403) {
    throw new RetryableError("synthetic CDR did not accept this worker's credentials");
  }
  if (response.status !== 200) {
    const detail = await safeCdrRejectDetail(response);
    const suffix = detail ? `: ${detail}` : "";
    throw refuse(
      cdrRefusalFailureClass(response.status, detail),
      `synthetic CDR rejected the source (${response.status})${suffix}`,
      { observedBytes: bytes.byteLength, declaredBytes },
    );
  }

  const cdrStatus = response.headers.get("x-tavonel-cdr-status");
  const echoedInput = response.headers.get("x-tavonel-input-sha256");
  const outputSha256Header = response.headers.get("x-tavonel-cdr-output-sha256");
  const responseType = response.headers.get("content-type") || "";
  const observed = { observedBytes: bytes.byteLength, declaredBytes };
  if (cdrStatus !== "clean" || !responseType.toLowerCase().includes("application/pdf")) {
    throw refuse("CORRUPT_SOURCE", "synthetic CDR did not return a clean PDF", observed);
  }
  if (echoedInput !== inputSha256) {
    throw refuse("RECEIPT_MISMATCH", "synthetic CDR input digest did not match", observed);
  }
  if (!outputSha256Header) {
    throw refuse("RECEIPT_MISMATCH", "synthetic CDR output digest is missing", observed);
  }

  const sanitized = await response.arrayBuffer();
  const computedOutput = `sha256:${await sha256Hex(sanitized)}`;
  if (outputSha256Header !== computedOutput) {
    throw refuse("RECEIPT_MISMATCH", "synthetic CDR output digest did not match the PDF body", observed);
  }

  const immutableKey = immutableObjectKey(parts.workspaceId, parts.documentId, outputSha256Header);
  try {
    await env.FOUNDATION_QUARANTINE.put(immutableKey, new Uint8Array(sanitized), {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { stage: "immutable-approved" },
      onlyIf: { etagDoesNotMatch: "*" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/precondition|already exists|conflict/iu.test(message)) {
      throw new RetryableError("immutable PDF write failed");
    }
  }

  const cdrReceiptKey = cdrReceiptSiblingKey(immutableKey);
  const cdrReceiptStatus = await putCreateOnceJson(env.FOUNDATION_QUARANTINE, cdrReceiptKey, {
    schemaVersion: "tavonel.cdr_receipt.v1",
    status: "clean",
    sourceKey: objectKey,
    immutableKey,
    inputSha256,
    outputSha256: outputSha256Header,
    provider: env.TAVONEL_CDR_PROVIDER,
    requestId,
    occurredAt: timestamp,
    candidatePromotion: false,
  });

  let ocr: OcrDispatchResult;
  try {
    const existingReview = await env.FOUNDATION_QUARANTINE.get(ocrReviewSiblingKey(immutableKey));
    ocr = existingReview
      ? {
          status: "failed",
          reasonCode: "OCR_REVIEW_ALREADY_EXISTS",
          reason: "an immutable operator-review receipt already exists",
          computeCredits: 2,
        }
      : await dispatchOcrAfterSanitize(env, immutableKey, fetcher, now, newRequestId);
  } catch {
    ocr = {
      status: "failed",
      reasonCode: "OCR_TIMEOUT_OR_NETWORK",
      reason: "OCR dispatch failed after CDR",
      computeCredits: 0,
    };
  }

  /*
   * A transport failure is not an outcome, so nothing terminal is written for one.
   *
   * The receipt below is create-once and `explicit_operator_only`: correct for a reader that
   * answered wrongly, and permanent damage for a socket that closed. One cold start slower than
   * the request budget used to park a document forever and charge two credits for it. Raising
   * here charges nothing, writes nothing, and hands the retry to the queue, which already has a
   * bounded one (`wrangler.jsonc`: max_retries 10, then the dead-letter queue).
   */
  if (ocr.status === "failed" && ocrFailureKind(ocr.reasonCode) === "transport") {
    throw new RetryableError(`OCR is not available yet (${ocr.reasonCode})`);
  }

  let ocrReview: SanitizeResult["ocrReview"];
  if (ocr.status === "failed") {
    const reviewKey = ocrReviewSiblingKey(immutableKey);
    const reviewStatus = await putCreateOnceJson(env.FOUNDATION_QUARANTINE, reviewKey, {
      schemaVersion: "tavonel.ocr_review_receipt.v1",
      status: "operator_review",
      immutableKey,
      inputSha256: ocr.inputSha256 ?? outputSha256Header,
      reasonCode: ocr.reasonCode ?? "OCR_TIMEOUT_OR_NETWORK",
      reason: ocr.reason ?? "OCR failed after CDR",
      requestId: ocr.requestId ?? null,
      occurredAt: now().toISOString(),
      retryPolicy: "explicit_operator_only",
      candidatePromotion: false,
    });
    ocrReview = { key: reviewKey, status: reviewStatus };
  }

  return {
    sourceKey: objectKey,
    immutableKey,
    inputSha256,
    outputSha256: outputSha256Header,
    status: "clean",
    ocr,
    cdrReceipt: { key: cdrReceiptKey, status: cdrReceiptStatus },
    ...(ocrReview ? { ocrReview } : {}),
  };
}
