import { PermanentReject, RetryableError } from "./errors";
import { assertFoundationOnlyTarget } from "./guards";
import { cdrRequestSignature, hmacSecretIsConfigured, sha256DigestHeader, sha256Hex } from "./hmac";
import {
  MAX_SOURCE_BYTES,
  assertProcessableSourceKey,
  cdrReceiptSiblingKey,
  immutableObjectKey,
  ocrReviewSiblingKey,
  sourcePartFromR2Object,
} from "./keys";
import { dispatchOcrAfterSanitize, type OcrDispatchResult } from "./ocr";

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
  if (object.size > MAX_SOURCE_BYTES) {
    throw new PermanentReject("quarantine source exceeds the 5 MiB Foundation CDR cap");
  }

  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new PermanentReject("quarantine source exceeds the 5 MiB Foundation CDR cap");
  }
  if (bytes.byteLength < 1) {
    throw new PermanentReject("quarantine source is empty");
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
  if (response.status !== 200) {
    throw new PermanentReject("synthetic CDR rejected the source");
  }

  const cdrStatus = response.headers.get("x-tavonel-cdr-status");
  const echoedInput = response.headers.get("x-tavonel-input-sha256");
  const outputSha256Header = response.headers.get("x-tavonel-cdr-output-sha256");
  const responseType = response.headers.get("content-type") || "";
  if (cdrStatus !== "clean" || !responseType.toLowerCase().includes("application/pdf")) {
    throw new PermanentReject("synthetic CDR did not return a clean PDF");
  }
  if (echoedInput !== inputSha256) {
    throw new PermanentReject("synthetic CDR input digest did not match");
  }
  if (!outputSha256Header) {
    throw new PermanentReject("synthetic CDR output digest is missing");
  }

  const sanitized = await response.arrayBuffer();
  const computedOutput = `sha256:${await sha256Hex(sanitized)}`;
  if (outputSha256Header !== computedOutput) {
    throw new PermanentReject("synthetic CDR output digest did not match the PDF body");
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
