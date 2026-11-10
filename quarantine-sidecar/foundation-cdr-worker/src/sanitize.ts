import type { FailureClass } from "../../../shared/uskcEnums";
import { PermanentReject, RetryableError } from "./errors";
import { cdrAuthorization } from "./identity";
import { assertFoundationOnlyTarget } from "./guards";
import { cdrRequestSignature, hmacSecretIsConfigured, sha256DigestHeader, sha256Hex } from "./hmac";
import { runTextLayerShadow } from "./text-layer-shadow";
import {
  MAX_SOURCE_BYTES,
  STAGE_1_MAX_SOURCE_BYTES,
  intakeCeilingStage,
  assertProcessableSourceKey,
  cdrReceiptSiblingKey,
  immutableObjectKey,
  ocrReviewSiblingKey,
  ocrSiblingKey,
  parseQuarantineSourceKey,
  segmentImmutableKey,
  segmentManifestKey,
  segmentPlanKey,
  segmentRangePrefix,
  sourcePartFromR2Object,
} from "./keys";
import {
  OCR_FAILURE_CATEGORY,
  OcrEvidenceRetryableError,
  dispatchOcrAfterSanitize,
  ocrFailureKind,
  type OcrDispatchResult,
  type OcrFailureCode,
} from "./ocr";

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
  /** Optional so a narrower binding or an older fake still satisfies the type. */
  list?(options: { prefix: string }): Promise<{ objects: Array<{ key: string }> }>;
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
  FOUNDATION_COMPLETED_READ_ENABLED?: string;
  FOUNDATION_COMPLETED_READ_BINDING?: string;
  FOUNDATION_QUARANTINE: R2BucketLike;
  TAVONEL_CDR_URL: string;
  TAVONEL_CDR_HMAC?: string;
  FOUNDATION_CDR_IDENTITY_HMAC?: string;
  TAVONEL_CDR_PROVIDER: string;
  FOUNDATION_R2_BUCKET: string;
  FOUNDATION_OCR_URL?: string;
  TAVONEL_OCR_HMAC?: string;
  /** D1 intake ceiling stage (keys.ts intakeCeilingStage): "0" or unset, or "1". */
  TAVONEL_INTAKE_CEILING_STAGE?: string;
  /** D2 text-layer shadow (text-layer-shadow.ts): "1" on, unset or "0" off. */
  FOUNDATION_CDR_TEXT_LAYER_FIRST?: string;
  /** Segmented sources (`sourceSegmentPages`): unset off, else "80" (pages per CDR request). */
  FOUNDATION_SOURCE_SEGMENT_PAGES?: string;
  /** Producer on the consumer's own queue: a segmented source continues as a new message. */
  FOUNDATION_SEGMENT_CONTINUATION?: { send(body: unknown, options?: { contentType?: "json" }): Promise<unknown> };
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;
const SAFE_CDR_DETAIL_PATTERN = /^CDR [A-Za-z0-9 ._()-]{1,156}$/;
const SAFE_CDR_REJECT_CODES = new Set(["MALWARE_DETECTED"]);
const CDR_RECEIPT_SCHEMA = "tavonel.cdr_receipt.v2";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_RECEIPT_BYTES = 16 * 1024;
// Matches the qualified Cloud Run output ceiling, not the smaller source ceiling. Stage 1 is the
// CDR's STAGE_1_MAX_OUTPUT_BYTES (18 MiB / 80 pages x 200 pages); the cross-tree test pins both.
const MAX_SANITIZED_BYTES = 18 * 1024 * 1024;
const STAGE_1_MAX_SANITIZED_BYTES = 45 * 1024 * 1024;

/** The response is larger than the bound the caller set. Distinct so a caller can name it. */
class ResponseBoundExceeded extends RetryableError {}

async function boundedResponseBytes(response: Response, limit: number): Promise<ArrayBuffer> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new ResponseBoundExceeded("CDR response exceeds its allowed bound");
  }
  if (!response.body) throw new RetryableError("CDR response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) throw new ResponseBoundExceeded("CDR response exceeds its allowed bound");
      chunks.push(next.value);
    }
    if (declared !== null && Number(declared) !== length) throw new RetryableError("CDR response length did not match");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ResponseBoundExceeded) throw error;
    throw new RetryableError("CDR response could not be read within its allowed bound");
  } finally {
    reader.releaseLock();
  }
}

async function safeCdrRejectDetail(response: Response): Promise<string | null> {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await boundedResponseBytes(response, 4096)));
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || !("detail" in body)) {
    return null;
  }
  const detail = (body as { detail?: unknown }).detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const code = (detail as { code?: unknown }).code;
    return typeof code === "string" && SAFE_CDR_REJECT_CODES.has(code) ? code : null;
  }
  if (typeof detail !== "string") return null;
  const normalized = detail.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return SAFE_CDR_DETAIL_PATTERN.test(normalized) ? normalized : null;
}

async function putCreateOnceJson(
  bucket: R2BucketLike,
  key: string,
  value: Record<string, unknown>,
): Promise<"written" | "exists" | "failed"> {
  try {
    const written = await bucket.put(key, new TextEncoder().encode(`${JSON.stringify(value)}\n`), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { stage: "processing-receipt" },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    return written === null ? "exists" : "written";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return /precondition|already exists|conflict/iu.test(message) ? "exists" : "failed";
  }
}

type CdrBinding = {
  parts: { workspaceId: string; documentId: string };
  /** The stage's sanitized-PDF bound; a reused object above it is not reused. */
  maxSanitizedBytes: number;
  sourceKey: string;
  inputSha256: string;
  provider: string;
  targetSha256: string;
  /** Where an output with this digest is stored. */
  keyFor: (outputSha256: string) => string;
  /** The prefix a reusable earlier output is listed under. */
  listPrefix: string;
  /** Set for one range of a segmented source; its receipt must name the same range. */
  pageRange?: { start0: number; end0: number; sourcePages: number };
};

/** A segment receipt names its range and the source's page count; a whole-document receipt names neither. */
function receiptRangeMatches(record: Record<string, unknown>, range: CdrBinding["pageRange"]): boolean {
  if (!range) return record.pageRange === undefined && record.sourcePages === undefined;
  const named = record.pageRange as Record<string, unknown> | undefined;
  return !!named && typeof named === "object" && named.start0 === range.start0 && named.end0 === range.end0
    && record.sourcePages === range.sourcePages;
}

/** Validate what is actually persisted, including a concurrent create-once winner. */
async function verifiedImmutable(
  bucket: R2BucketLike,
  immutableKey: string,
  binding: CdrBinding,
): Promise<{ immutableKey: string; outputSha256: string } | null> {
  const receipt = await bucket.get(cdrReceiptSiblingKey(immutableKey));
  if (!receipt || receipt.size < 1 || receipt.size > MAX_RECEIPT_BYTES) return null;
  const receiptBytes = await receipt.arrayBuffer();
  if (receiptBytes.byteLength !== receipt.size) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(receiptBytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== CDR_RECEIPT_SCHEMA || record.status !== "clean"
    || record.sourceKey !== binding.sourceKey || record.inputSha256 !== binding.inputSha256
    || record.provider !== binding.provider || record.targetSha256 !== binding.targetSha256
    || record.immutableKey !== immutableKey || typeof record.outputSha256 !== "string"
    || !DIGEST_PATTERN.test(record.outputSha256)
    || immutableKey !== binding.keyFor(record.outputSha256) || !receiptRangeMatches(record, binding.pageRange)) {
    return null;
  }
  const pdf = await bucket.get(immutableKey);
  if (!pdf || pdf.size < 1 || pdf.size > binding.maxSanitizedBytes) return null;
  const bytes = await pdf.arrayBuffer();
  if (bytes.byteLength !== pdf.size || await sha256DigestHeader(bytes) !== record.outputSha256) return null;
  return { immutableKey, outputSha256: record.outputSha256 };
}

/** Valid same-source, same-target redelivery avoids paying for CDR twice. */
async function reusableImmutable(
  bucket: R2BucketLike,
  binding: CdrBinding,
): Promise<{ immutableKey: string; outputSha256: string } | null> {
  if (!bucket.list) return null;
  const prefix = binding.listPrefix;
  let listed: { objects: Array<{ key: string }> };
  try {
    listed = await bucket.list({ prefix });
  } catch {
    return null;
  }
  for (const object of listed.objects) {
    if (!object.key.endsWith("/sanitized.pdf")) continue;
    const verified = await verifiedImmutable(bucket, object.key, binding);
    if (verified) return verified;
  }
  return null;
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
  "MALWARE_DETECTED": "MALWARE_QUARANTINED",
  "CDR source filename is invalid": "UNSUPPORTED_FORMAT",
  "CDR source format is not qualified for PDF rasterization": "UNSUPPORTED_FORMAT",
  "CDR Office package expansion is not qualified": "UNSUPPORTED_FORMAT",
  "CDR Office package is invalid or encrypted": "ENCRYPTED_SOURCE",
  "CDR password-protected PDF is not qualified": "ENCRYPTED_SOURCE",
  "CDR Office package contains unqualified active or embedded content": "MALWARE_QUARANTINED",
  /*
    The HTML analogue of the line above, and the same class for the same reason.

    `reject_active_html` refuses script, event-handler and external-reference markup before
    LibreOffice opens the file (`cdr-cloudrun/app.py:280`). What it found is active content the
    deployment will not execute, which is the statement `MALWARE_QUARANTINED` makes -- not a
    judgement that the document is broken.
  */
  "CDR HTML source contains unqualified active or external content": "MALWARE_QUARANTINED",
  "CDR source exceeds the controlled-beta size limit": "PARSER_OOM",
  "CDR sanitized output is outside the controlled-beta size limit": "PARSER_OOM",
  "CDR source rendering budget is not qualified": "PARSER_OOM",
  "CDR source page count is not qualified": "PARSER_OOM",
  // A range one request may not render: the same ceiling as the page count, met per request.
  "CDR page range is not qualified": "PARSER_OOM",
  // The page count a segmented source was planned on no longer holds for the bytes sent.
  "CDR page range starts past the end of the document": "RECEIPT_MISMATCH",
  "CDR source is empty": "CORRUPT_SOURCE",
  "CDR source could not be converted safely": "CORRUPT_SOURCE",
  /*
    The refusal scan could not read the bytes it was asked to scan.

    `app.py:278` raises this when reading the source off disk fails, and it is raised as 422
    rather than 5xx, so it lands here as a statement about the document. `CORRUPT_SOURCE` is the
    honest reading: the deployment held the file and still could not read it, which is what the
    neighbouring "could not be converted" and "is empty" lines say. The decode itself never
    reaches this -- it is lossy on purpose -- so only an unreadable file arrives here.
  */
  "CDR HTML source could not be read": "CORRUPT_SOURCE",
  "CDR source renderer rejected this document": "CORRUPT_SOURCE",
  "CDR source could not be rasterized safely": "CORRUPT_SOURCE",
  "CDR sanitized PDF could not be created": "CORRUPT_SOURCE",
  "CDR image source is not qualified": "CORRUPT_SOURCE",
  "CDR image source could not be normalized safely": "CORRUPT_SOURCE",
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

export const OCR_REVIEW_RECEIPT_SCHEMA = "tavonel.ocr_review_receipt.v2" as const;
const LEGACY_OCR_REVIEW_RECEIPT_SCHEMA = "tavonel.ocr_review_receipt.v1";
const LEGACY_OCR_REVIEW_FIELDS = [
  "candidatePromotion", "immutableKey", "inputSha256", "occurredAt", "reason",
  "reasonCode", "requestId", "retryPolicy", "schemaVersion", "status",
].sort();
const OCR_REVIEW_FIELDS = [...LEGACY_OCR_REVIEW_FIELDS, "billingDisposition", "computeCredits", "sourceKey"].sort();
const MAX_OCR_REVIEW_REASON = 512;

type OcrReviewBilling =
  | { billingDisposition: "released"; computeCredits: 0 }
  | { billingDisposition: "operator_review"; computeCredits: 2 };

const RELEASED: OcrReviewBilling = { billingDisposition: "released", computeCredits: 0 };
const OPERATOR_REVIEW: OcrReviewBilling = { billingDisposition: "operator_review", computeCredits: 2 };

/** `ocr.ts` calls an empty source semantic yet charges nothing for it: the reader never ran. */
const UNCHARGED_SEMANTIC_FAILURES: ReadonlySet<string> = new Set<OcrFailureCode>(["OCR_SOURCE_EMPTY"]);

/**
 * What a recorded OCR failure was billed, from its reason code and nothing else.
 *
 * The receipt existing says nothing about money. A transport failure that outlived its retries
 * is recorded at zero credits, so "a receipt exists, charge two" turned a settlement that failed
 * before commit into a charge, and a committed release whose reply was lost into a conflict.
 * `OCR_REVIEW_ALREADY_EXISTS` was the old replay marker and was never a failure anyone observed,
 * so it -- like any code outside the taxonomy -- has no billing and is never replayed.
 */
function recordedFailureBilling(code: unknown): OcrReviewBilling | null {
  if (typeof code !== "string" || code === "OCR_REVIEW_ALREADY_EXISTS" || !Object.hasOwn(OCR_FAILURE_CATEGORY, code)) {
    return null;
  }
  if (OCR_FAILURE_CATEGORY[code as OcrFailureCode].kind === "transport") return RELEASED;
  return UNCHARGED_SEMANTIC_FAILURES.has(code) ? RELEASED : OPERATOR_REVIEW;
}

/**
 * Replays the recorded OCR failure for this immutable PDF, or returns null when none exists.
 *
 * A present receipt is evidence only once it is bounded, parses, and binds this source, this
 * immutable PDF and its digest to a known reason and billing disposition. Anything less throws
 * retryable before OCR and before settlement: re-reading the document could bill it twice, and
 * guessing the disposition could bill it wrongly once.
 */
async function recordedOcrReview(
  bucket: R2BucketLike,
  reviewKey: string,
  binding: { sourceKey: string; immutableKey: string; inputSha256: string },
): Promise<OcrDispatchResult | null> {
  let size: number;
  let bytes: ArrayBuffer;
  try {
    const object = await bucket.get(reviewKey);
    if (!object) return null;
    size = object.size;
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_RECEIPT_BYTES) throw new Error("size");
    bytes = await object.arrayBuffer();
  } catch {
    throw new OcrEvidenceRetryableError("OCR review evidence cannot be read within its bound; retry required");
  }
  const unqualified = () => new OcrEvidenceRetryableError("OCR review evidence is not qualified; operator review required");
  let record: Record<string, unknown>;
  try {
    if (bytes.byteLength !== size) throw new Error("length");
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    record = parsed as Record<string, unknown>;
  } catch {
    throw unqualified();
  }

  const legacy = record.schemaVersion === LEGACY_OCR_REVIEW_RECEIPT_SCHEMA;
  if (!legacy && record.schemaVersion !== OCR_REVIEW_RECEIPT_SCHEMA) throw unqualified();
  const fields = Object.keys(record).sort();
  const expectedFields = legacy ? LEGACY_OCR_REVIEW_FIELDS : OCR_REVIEW_FIELDS;
  if (fields.length !== expectedFields.length || fields.some((field, index) => field !== expectedFields[index])) {
    throw unqualified();
  }
  if (record.status !== "operator_review" || record.retryPolicy !== "explicit_operator_only"
    || record.candidatePromotion !== false
    || record.immutableKey !== binding.immutableKey || record.inputSha256 !== binding.inputSha256
    || (!legacy && record.sourceKey !== binding.sourceKey)
    || typeof record.reason !== "string" || record.reason.length < 1 || record.reason.length > MAX_OCR_REVIEW_REASON
    || (record.requestId !== null
      && (typeof record.requestId !== "string" || record.requestId.length < 1 || record.requestId.length > 160))
    || typeof record.occurredAt !== "string" || !Number.isFinite(Date.parse(record.occurredAt))) {
    throw unqualified();
  }
  // v1 recorded no disposition, so the reason code alone decides it -- the same rule v2 is checked
  // against. `OCR_SOURCE_EMPTY` was always dispatched at zero credits, so a v1 replay releases it.
  const billing = recordedFailureBilling(record.reasonCode);
  if (!billing || (!legacy && (record.billingDisposition !== billing.billingDisposition
    || record.computeCredits !== billing.computeCredits))) {
    throw unqualified();
  }
  return {
    status: "failed",
    key: ocrSiblingKey(binding.immutableKey),
    reasonCode: record.reasonCode as OcrFailureCode,
    reason: record.reason as string,
    ...(typeof record.requestId === "string" ? { requestId: record.requestId } : {}),
    inputSha256: binding.inputSha256,
    computeCredits: billing.computeCredits,
  };
}

export async function sanitizeObject(
  env: SanitizeEnv,
  objectKey: string,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
  newRequestId: () => string = () => crypto.randomUUID(),
  /**
   * What to do with an OCR failure `ocr.ts` classified as `transport`.
   *
   * `raise` is the default and the answer for a caller with no retry of its own: the failure is
   * raised as retryable, nothing terminal is written and nothing is charged. `defer` belongs to a
   * caller that will redeliver the message itself after a delay -- it gets the result back and
   * writes no receipt, because the create-once operator-review record would park the document
   * permanently on the first cold start. `record` is that caller's last attempt: the failure has
   * outlived the retries, so it is written down the ordinary way (still at zero credits) rather
   * than disappearing into the dead-letter queue.
   */
  options: SanitizeOptions = {},
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
  const stage = intakeCeilingStage(env);
  if (!stage) throw new RetryableError("TAVONEL_INTAKE_CEILING_STAGE must be 0 or 1");
  const maxSourceBytes = stage === "1" ? STAGE_1_MAX_SOURCE_BYTES : MAX_SOURCE_BYTES;
  const maxSanitizedBytes = stage === "1" ? STAGE_1_MAX_SANITIZED_BYTES : MAX_SANITIZED_BYTES;
  const cap = `quarantine source exceeds the ${maxSourceBytes / (1024 * 1024)} MiB Foundation CDR cap`;
  if (object.size > maxSourceBytes) {
    throw refuse("PARSER_OOM", cap, {
      observedBytes: object.size,
      declaredBytes,
    });
  }

  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > maxSourceBytes) {
    throw refuse("PARSER_OOM", cap, {
      observedBytes: bytes.byteLength,
      declaredBytes,
    });
  }
  if (bytes.byteLength < 1) {
    throw refuse("CORRUPT_SOURCE", "quarantine source is empty", { observedBytes: 0, declaredBytes });
  }

  const inputSha256 = await sha256DigestHeader(bytes);
  // This binds configured routing, not scanner/image qualification. A runtime-policy change
  // at the same URL must also change the provider identity before rollout.
  const targetSha256 = await sha256DigestHeader(new TextEncoder().encode(JSON.stringify([
    env.FOUNDATION_R2_BUCKET, env.TAVONEL_CDR_PROVIDER, env.TAVONEL_CDR_URL,
  ])));
  const binding: CdrBinding = {
    parts, maxSanitizedBytes, sourceKey: objectKey, inputSha256, provider: env.TAVONEL_CDR_PROVIDER, targetSha256,
    keyFor: (outputSha256) => immutableObjectKey(parts.workspaceId, parts.documentId, outputSha256),
    listPrefix: `immutable/${parts.workspaceId}/${parts.workspaceId}/${parts.documentId}/`,
  };
  const ctx: DisarmContext = {
    env, object, bytes, inputSha256, observed: { observedBytes: bytes.byteLength, declaredBytes },
    stage, maxSanitizedBytes, fetcher, now, newRequestId,
  };
  const reused = await reusableImmutable(env.FOUNDATION_QUARANTINE, binding);
  const segmentPages = sourceSegmentPages(env);
  if (!reused && segmentPages !== null && SEGMENTABLE_MIMES.has(sourcePartFromR2Object(object).contentType)) {
    // A long source is read one page range at a time. A short one comes back whole from the first
    // range request and takes the ordinary path below with that answer.
    const segmented = await sanitizeSegmented(ctx, binding, segmentPages, options);
    if (segmented.kind === "result") return segmented.result;
    return finishWholeDocument(ctx, binding, segmented.stored, options);
  }
  // A reused PDF was disarmed on an earlier delivery; running the CDR again would only pay twice.
  const stored: StoredImmutable = reused
    ? { ...reused, cdrReceiptStatus: "exists" }
    : await storeDisarmed(env, binding, await requestDisarm(ctx, null), {});
  return finishWholeDocument(ctx, binding, stored, options);
}

type DisarmContext = {
  env: SanitizeEnv;
  object: R2ObjectLike;
  bytes: ArrayBuffer;
  inputSha256: string;
  observed: { observedBytes: number; declaredBytes: number | null };
  stage: string;
  maxSanitizedBytes: number;
  fetcher: typeof fetch;
  now: () => Date;
  newRequestId: () => string;
};

type SanitizeOptions = { onTransportFailure?: "raise" | "defer" | "record" };

type Disarmed = {
  sanitized: ArrayBuffer;
  outputSha256: string;
  requestId: string;
  timestamp: string;
  /** Set only for a ranged request: the source's page count and the range actually rendered. */
  range: { start0: number; end0: number; sourcePages: number } | null;
};

type StoredImmutable = { immutableKey: string; outputSha256: string; cdrReceiptStatus: "written" | "exists" | "failed" };

/**
 * One signed CDR request: the whole source, or the page range `[start0, end0)` of it.
 *
 * The range travels inside the signed request id (`_p<start0>_<end0>`), so it is covered by the
 * signature and the CDR's replay guard (`cdr-cloudrun/app.py` PAGE_RANGE_REQUEST_ID).
 */
async function requestDisarm(ctx: DisarmContext, pageRange: [number, number] | null): Promise<Disarmed> {
  const { env, object, bytes, inputSha256, observed, fetcher } = ctx;
  const { filename, contentType } = sourcePartFromR2Object(object);
  const timestamp = ctx.now().toISOString();
  const requestId = pageRange ? `${ctx.newRequestId()}_p${pageRange[0]}_${pageRange[1]}` : ctx.newRequestId();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new RetryableError("CDR request id is invalid");
  }

  const signature = await cdrRequestSignature(env.TAVONEL_CDR_HMAC as string, timestamp, requestId, inputSha256);
  const form = new FormData();
  form.append("source", new Blob([bytes], { type: contentType }), filename);

  let response: Response;
  try {
    const authorization = await cdrAuthorization(env.TAVONEL_CDR_URL, env.FOUNDATION_CDR_IDENTITY_HMAC, fetcher);
    response = await fetcher(env.TAVONEL_CDR_URL, {
      method: "POST",
      headers: {
        ...(authorization ? { authorization } : {}),
        "x-tavonel-input-sha256": inputSha256,
        "x-tavonel-cdr-timestamp": timestamp,
        "x-tavonel-cdr-request-id": requestId,
        "x-tavonel-cdr-signature": signature,
      },
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
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
    // A CDR that answers ranges says so on every refusal (cdr-cloudrun/app.py CDR_RANGES_HEADER).
    // One that predates ranges reads the whole source and refuses past 80 pages: that is our
    // deploy order, not the customer's document, so it is retried, never refused (E4).
    if (pageRange && response.headers.get("x-tavonel-cdr-ranges") !== "1") {
      await response.body?.cancel();
      throw new RetryableError("CDR revision predates ranged requests; deploy the CDR before the worker");
    }
    const detail = await safeCdrRejectDetail(response);
    const suffix = detail ? `: ${detail}` : "";
    // A refused range refuses the source, and says which pages it was refused on.
    const pages = pageRange ? ` on pages ${pageRange[0] + 1}-${pageRange[1]}` : "";
    throw refuse(
      cdrRefusalFailureClass(response.status, detail),
      `synthetic CDR rejected the source${pages} (${response.status})${suffix}`,
      observed,
    );
  }

  const cdrStatus = response.headers.get("x-tavonel-cdr-status");
  const echoedInput = response.headers.get("x-tavonel-input-sha256");
  const outputDigest = response.headers.get("x-tavonel-cdr-output-sha256");
  const responseType = response.headers.get("content-type") || "";
  if (cdrStatus !== "clean" || !responseType.toLowerCase().includes("application/pdf")) {
    throw refuse("CORRUPT_SOURCE", "synthetic CDR did not return a clean PDF", observed);
  }
  if (echoedInput !== inputSha256) {
    throw refuse("RECEIPT_MISMATCH", "synthetic CDR input digest did not match", observed);
  }
  if (!outputDigest) {
    throw refuse("RECEIPT_MISMATCH", "synthetic CDR output digest is missing", observed);
  }
  const range = pageRange ? answeredPageRange(response, pageRange) : null;

  // A clean PDF above the stage bound is a named refusal, not a retry: every retry would pay
  // for the same CDR run and end in the DLQ. It happens when the CDR runs a higher stage.
  const outputCap = `sanitized PDF exceeds the ${ctx.maxSanitizedBytes / (1024 * 1024)} MiB stage-${ctx.stage} bound`;
  let sanitized: ArrayBuffer;
  try {
    sanitized = await boundedResponseBytes(response, ctx.maxSanitizedBytes);
  } catch (error) {
    if (error instanceof ResponseBoundExceeded) throw refuse("PARSER_OOM", outputCap, observed);
    throw error;
  }
  if (sanitized.byteLength < 1) {
    throw new RetryableError("CDR output is outside the qualified storage bound");
  }
  const computedOutput = `sha256:${await sha256Hex(sanitized)}`;
  if (outputDigest !== computedOutput) {
    throw refuse("RECEIPT_MISMATCH", "synthetic CDR output digest did not match the PDF body", observed);
  }
  return { sanitized, outputSha256: outputDigest, requestId, timestamp, range };
}

/**
 * The range the CDR says it rendered, held to the range that was asked for.
 *
 * A CDR revision that predates ranged requests ignores the suffix and answers without these
 * headers. That is this deployment's misconfiguration, not a verdict on the document, so it
 * retries (and dead-letters) rather than refusing the customer's source.
 */
function answeredPageRange(response: Response, [start0, end0]: [number, number]) {
  const sourcePages = Number(response.headers.get("x-tavonel-cdr-source-pages") ?? "");
  const answered = /^(\d{1,4})-(\d{1,4})$/.exec(response.headers.get("x-tavonel-cdr-page-range") ?? "");
  if (!answered || !Number.isSafeInteger(sourcePages) || sourcePages < 1 || sourcePages > MAX_SEGMENTED_SOURCE_PAGES) {
    throw new RetryableError("CDR did not answer the page range it was asked for; it may predate ranged requests");
  }
  const rendered = { start0: Number(answered[1]), end0: Number(answered[2]) };
  if (rendered.start0 !== start0 || rendered.end0 !== Math.min(end0, sourcePages) || rendered.end0 <= rendered.start0) {
    throw new RetryableError("CDR answered a different page range than it was asked for");
  }
  return { ...rendered, sourcePages };
}

/** Store one disarmed answer create-once with its receipt, and verify what actually persisted. */
async function storeDisarmed(
  env: SanitizeEnv,
  binding: CdrBinding,
  disarmed: Disarmed,
  receiptExtra: Record<string, unknown>,
): Promise<StoredImmutable> {
  const immutableKey = binding.keyFor(disarmed.outputSha256);
  try {
    await env.FOUNDATION_QUARANTINE.put(immutableKey, new Uint8Array(disarmed.sanitized), {
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

  const cdrReceiptStatus = await putCreateOnceJson(env.FOUNDATION_QUARANTINE, cdrReceiptSiblingKey(immutableKey), {
    schemaVersion: CDR_RECEIPT_SCHEMA,
    status: "clean",
    sourceKey: binding.sourceKey,
    immutableKey,
    inputSha256: binding.inputSha256,
    outputSha256: disarmed.outputSha256,
    provider: binding.provider,
    targetSha256: binding.targetSha256,
    requestId: disarmed.requestId,
    occurredAt: disarmed.timestamp,
    candidatePromotion: false,
    ...receiptExtra,
  });
  // A null/throwing conditional PUT means another object won. Never authorize its
  // bytes or receipt from the fresh response; inspect both persisted winners first.
  const persisted = await verifiedImmutable(env.FOUNDATION_QUARANTINE, immutableKey, binding);
  if (cdrReceiptStatus === "failed" || !persisted || persisted.outputSha256 !== disarmed.outputSha256) {
    throw new RetryableError("persisted CDR evidence conflicts or is incomplete; operator review required");
  }
  return { immutableKey, outputSha256: disarmed.outputSha256, cdrReceiptStatus };
}

type ReadOutcome = { ocr: OcrDispatchResult; recorded: boolean; ocrReview?: SanitizeResult["ocrReview"] };

/**
 * Read one stored sanitized PDF, or replay its recorded failure, and record a new failure.
 *
 * A whole document and every range of a segmented one go through this, so a range is read,
 * retried, billed and parked exactly as a whole document is.
 */
async function readSanitized(
  ctx: DisarmContext,
  sourceKey: string,
  stored: StoredImmutable,
  options: SanitizeOptions,
): Promise<ReadOutcome> {
  const { env, now } = ctx;
  const { immutableKey } = stored;
  const reviewKey = ocrReviewSiblingKey(immutableKey);
  const reviewBinding = { sourceKey, immutableKey, inputSha256: stored.outputSha256 };

  // A recorded failure is the outcome of an earlier delivery whose settlement may not have
  // committed, or whose reply was lost. Say the same thing again; never read the document again.
  const recorded = await recordedOcrReview(env.FOUNDATION_QUARANTINE, reviewKey, reviewBinding);
  if (recorded) return { ocr: recorded, recorded: true, ocrReview: { key: reviewKey, status: "exists" } };
  let ocr: OcrDispatchResult;
  try {
    ocr = await dispatchOcrAfterSanitize(env, immutableKey, ctx.fetcher, now, ctx.newRequestId);
  } catch (error) {
    if (error instanceof OcrEvidenceRetryableError) throw error;
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
   * the request budget used to park a document forever and charge two credits for it.
   *
   * `raise` charges nothing, writes nothing, and hands the failure back as retryable. `defer`
   * does the same but returns the result instead, because that caller schedules the next attempt
   * itself with a delay long enough for a scaled-to-zero endpoint to boot. `record` is that
   * caller's last attempt, and falls through to the receipt below -- at the zero credits a
   * transport failure carries, so the settlement releases the reservation rather than billing for
   * a reader that never ran.
   */
  const transportFailure = ocr.status === "failed" && ocrFailureKind(ocr.reasonCode) === "transport";
  const onTransportFailure = options.onTransportFailure ?? "raise";
  if (transportFailure && onTransportFailure === "raise") {
    throw new RetryableError(`OCR is not available yet (${ocr.reasonCode})`);
  }
  if (ocr.status !== "failed" || (transportFailure && onTransportFailure === "defer")) {
    return { ocr, recorded: false };
  }

  const reasonCode = ocr.reasonCode ?? "OCR_TIMEOUT_OR_NETWORK";
  const billing = recordedFailureBilling(reasonCode);
  // The disposition written here is what every replay will settle, so it must be the one this
  // attempt is about to settle -- never a guess a later reader has to reconcile.
  if (!billing || billing.computeCredits !== ocr.computeCredits) {
    throw new RetryableError("OCR failure billing does not match its reason; operator review required");
  }
  const reviewStatus = await putCreateOnceJson(env.FOUNDATION_QUARANTINE, reviewKey, {
    schemaVersion: OCR_REVIEW_RECEIPT_SCHEMA,
    status: "operator_review",
    sourceKey,
    immutableKey,
    inputSha256: ocr.inputSha256 ?? stored.outputSha256,
    reasonCode,
    reason: ocr.reason ?? "OCR failed after CDR",
    requestId: ocr.requestId ?? null,
    occurredAt: now().toISOString(),
    retryPolicy: "explicit_operator_only",
    candidatePromotion: false,
    billingDisposition: billing.billingDisposition,
    computeCredits: billing.computeCredits,
  });
  // The PUT's answer is not the record. Whatever it reported, the durable receipt is what every
  // replay settles, so it is what this attempt settles: `written` is checked because a reply is
  // not a stored object, `exists` adopts a concurrent winner rather than this attempt's losing
  // answer, and `failed` may have committed before the error surfaced -- then the persisted
  // disposition and reason are recovered, never guessed. No valid receipt, no settlement.
  //
  // This does not make OCR exactly-once. A PUT that truly never persisted leaves no record, so
  // the redelivery this retry causes dispatches OCR again; closing that needs a durable
  // pre-dispatch intent or provider-side idempotency, which this path does not have.
  const durable = await recordedOcrReview(env.FOUNDATION_QUARANTINE, reviewKey, reviewBinding);
  if (!durable) {
    throw new OcrEvidenceRetryableError(`OCR review receipt is not durable after a ${reviewStatus} write; retry required`);
  }
  return { ocr: durable, recorded: false, ocrReview: { key: reviewKey, status: reviewStatus } };
}

function resultFor(ctx: DisarmContext, sourceKey: string, stored: StoredImmutable, read: ReadOutcome): SanitizeResult {
  return {
    sourceKey,
    immutableKey: stored.immutableKey,
    inputSha256: ctx.inputSha256,
    outputSha256: stored.outputSha256,
    status: "clean",
    ocr: read.ocr,
    cdrReceipt: { key: cdrReceiptSiblingKey(stored.immutableKey), status: stored.cdrReceiptStatus },
    ...(read.ocrReview ? { ocrReview: read.ocrReview } : {}),
  };
}

async function finishWholeDocument(
  ctx: DisarmContext,
  binding: CdrBinding,
  stored: StoredImmutable,
  options: SanitizeOptions,
): Promise<SanitizeResult> {
  const read = await readSanitized(ctx, binding.sourceKey, stored, options);

  // D2 shadow: beside a stored ocr.json only, after it, and unable to change it (never throws).
  if (!read.recorded && (read.ocr.status === "written" || read.ocr.status === "exists") && read.ocr.key) {
    const { filename, contentType } = sourcePartFromR2Object(ctx.object);
    await runTextLayerShadow({
      env: ctx.env, immutablePdfKey: stored.immutableKey, ocrKey: read.ocr.key, inputSha256: ctx.inputSha256,
      source: { bytes: ctx.bytes, filename, contentType }, fetcher: ctx.fetcher, now: ctx.now, newRequestId: ctx.newRequestId,
    });
  }
  return resultFor(ctx, binding.sourceKey, stored, read);
}

/*
  Segmented sources (docs/adr/0006-segmented-large-sources.md).

  A source longer than one CDR request may render is read as consecutive page ranges of at most
  `FOUNDATION_SOURCE_SEGMENT_PAGES` pages. Each range is an ordinary sanitized PDF with its own
  receipt and its own ocr.json, stored create-once under the source's own prefix:

    immutable/<ws>/<ws>/<doc>/segments/plan.json                          the page count, once
    immutable/<ws>/<ws>/<doc>/segments/<start0>-<end0>/<v>/sanitized.pdf  one per range, with siblings
    immutable/<ws>/<ws>/<doc>/segments/manifest.json                      every range, once all are read

  Nothing under `segments/` is a document to the site until `manifest.json` exists, and the
  manifest is written only after every range has an ocr.json: a source with a refused or unread
  range is refused or parked whole, never shown in part. The prefix is the source's own, so the
  deletion sweep removes a segmented source exactly as it removes a whole one.

  Every range output is create-once and found again by listing, so a redelivery continues from the
  first range that is not yet read and pays for no range twice.

  One delivery reads at most one range that is not yet read (one CDR request and that range's OCR,
  the same work as today's whole 80-page document) and then continues the source as a NEW queue
  message (`SegmentContinuation`, sent by index.ts through FOUNDATION_SEGMENT_CONTINUATION). A new
  message starts at attempt 1, so the cold-start grace and max_retries apply to each range rather
  than to the whole source (REVIEW-PR231-R1 E1, E2).
*/

/** Pages per range. Pinned: the CDR's MAX_PAGES, and the object count ADR-0006 bounds deletion on. */
const SEGMENT_PAGES = 80;
/** The CDR's SEGMENTED_MAX_DOCUMENT_PAGES. */
export const MAX_SEGMENTED_SOURCE_PAGES = 500;
/** The formats intake counts pages for before upload (`nextjs/lib/page-count.ts`). */
const SEGMENTABLE_MIMES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const SEGMENT_PLAN_SCHEMA = "tavonel.source_segment_plan.v1";
export const SEGMENT_MANIFEST_SCHEMA = "tavonel.source_segments.v1";
/** A delivery read its one new range and more remain: index.ts sends the source on as a new message. */
export class SegmentContinuation extends RetryableError {
  constructor(readonly nextPage1: number) {
    super(`segmented source continues from page ${nextPage1} on the next delivery`);
  }
}

/**
 * Off unless set; when set it must be exactly 80, and the rest of the configuration must allow it.
 * Every refusal is a configuration error raised before any CDR request is paid for (E3).
 */
export function sourceSegmentPages(
  env: Pick<SanitizeEnv, "FOUNDATION_SOURCE_SEGMENT_PAGES" | "FOUNDATION_COMPLETED_READ_ENABLED" | "FOUNDATION_SEGMENT_CONTINUATION">,
): number | null {
  const raw = (env.FOUNDATION_SOURCE_SEGMENT_PAGES ?? "").trim();
  if (raw === "") return null;
  if (raw !== String(SEGMENT_PAGES)) {
    throw new RetryableError(`FOUNDATION_SOURCE_SEGMENT_PAGES must be ${SEGMENT_PAGES} or unset`);
  }
  if (env.FOUNDATION_COMPLETED_READ_ENABLED === "true") {
    // The completed-read proof binds one sanitized PDF and one ocr.json; a segmented source has several.
    throw new RetryableError("FOUNDATION_SOURCE_SEGMENT_PAGES cannot be set while FOUNDATION_COMPLETED_READ_ENABLED is true");
  }
  if (!env.FOUNDATION_SEGMENT_CONTINUATION) {
    throw new RetryableError("FOUNDATION_SOURCE_SEGMENT_PAGES needs the FOUNDATION_SEGMENT_CONTINUATION queue producer");
  }
  return SEGMENT_PAGES;
}

async function hasObject(bucket: R2BucketLike, key: string): Promise<boolean> {
  // Without listing a stored range cannot be found again, so it is treated as not yet read.
  if (!bucket.list) return false;
  const listed = await bucket.list({ prefix: key });
  return listed.objects.some((object) => object.key === key);
}

type SegmentPlan = { totalPages: number; segmentPages: number };

async function readJsonRecord(bucket: R2BucketLike, key: string): Promise<{ record: Record<string, unknown> | null; bytes: ArrayBuffer } | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  if (object.size < 1 || object.size > MAX_SEGMENT_RECORD_BYTES) return { record: null, bytes: new ArrayBuffer(0) };
  const bytes = await object.arrayBuffer();
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return { record: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null, bytes };
  } catch {
    return { record: null, bytes };
  }
}

/** 500 pages in ranges of one page is 500 entries of about 400 bytes each. */
const MAX_SEGMENT_RECORD_BYTES = 256 * 1024;

async function readSegmentPlan(bucket: R2BucketLike, key: string, binding: CdrBinding): Promise<SegmentPlan | null> {
  const stored = await readJsonRecord(bucket, key);
  if (!stored) return null;
  const record = stored.record;
  const totalPages = record?.totalPages;
  const segmentPages = record?.segmentPages;
  if (!record || record.schemaVersion !== SEGMENT_PLAN_SCHEMA || record.sourceKey !== binding.sourceKey
    || record.inputSha256 !== binding.inputSha256 || typeof totalPages !== "number" || typeof segmentPages !== "number"
    || !Number.isSafeInteger(totalPages) || !Number.isSafeInteger(segmentPages) || segmentPages < 1
    || segmentPages > SEGMENT_PAGES || totalPages <= segmentPages || totalPages > MAX_SEGMENTED_SOURCE_PAGES) {
    throw new RetryableError("stored segment plan does not match this source; operator review required");
  }
  return { totalPages, segmentPages };
}

/**
 * A manifest that already exists for these bytes is the finished reading: a redelivery returns it
 * without listing, hashing or re-verifying a single range (E6). Two stored versions of one range
 * (a duplicate delivery racing, a CDR whose output is not byte-deterministic) can no longer turn a
 * finished source into a retry loop, because the manifest already names the one that was read.
 */
async function finishedManifest(bucket: R2BucketLike, key: string, binding: CdrBinding) {
  const stored = await readJsonRecord(bucket, key);
  if (!stored) return null;
  const record = stored.record;
  const totalPages = record?.totalPages;
  const segments = record?.segments;
  if (!record || record.schemaVersion !== SEGMENT_MANIFEST_SCHEMA || record.sourceKey !== binding.sourceKey
    || record.inputSha256 !== binding.inputSha256 || record.segmentPages !== SEGMENT_PAGES
    || typeof totalPages !== "number" || !Number.isSafeInteger(totalPages)
    || totalPages <= SEGMENT_PAGES || totalPages > MAX_SEGMENTED_SOURCE_PAGES
    || !Array.isArray(segments) || segments.length !== Math.ceil(totalPages / SEGMENT_PAGES)) {
    throw new RetryableError("stored segment manifest does not match this source; operator review required");
  }
  return { totalPages, bytes: stored.bytes };
}

function manifestResult(
  ctx: DisarmContext, whole: CdrBinding, manifestKey: string, planKey: string,
  manifest: { totalPages: number; bytes: ArrayBuffer }, status: "written" | "exists", outputSha256: string,
): SegmentedOutcome {
  return { kind: "result", result: {
    sourceKey: whole.sourceKey,
    immutableKey: manifestKey,
    inputSha256: ctx.inputSha256,
    outputSha256,
    status: "clean",
    // One settlement for the source, at the per-document charge a whole document settles today
    // (`ocr.ts` computeCredits): segmentation changes how a source is read, not what it costs.
    ocr: { status, key: manifestKey, observedPageCount: manifest.totalPages, computeCredits: 2 },
    cdrReceipt: { key: planKey, status: "exists" },
  } };
}

type SegmentedOutcome = { kind: "whole"; stored: StoredImmutable } | { kind: "result"; result: SanitizeResult };

async function sanitizeSegmented(
  ctx: DisarmContext,
  whole: CdrBinding,
  segmentPages: number,
  options: SanitizeOptions,
): Promise<SegmentedOutcome> {
  const { env } = ctx;
  const bucket = env.FOUNDATION_QUARANTINE;
  const { workspaceId, documentId } = whole.parts;
  const planKey = segmentPlanKey(workspaceId, documentId);
  const manifestKey = segmentManifestKey(workspaceId, documentId);

  const finished = await finishedManifest(bucket, manifestKey, whole);
  if (finished) {
    return manifestResult(ctx, whole, manifestKey, planKey, finished, "exists", `sha256:${await sha256Hex(finished.bytes)}`);
  }

  let plan = await readSegmentPlan(bucket, planKey, whole);
  let first: Disarmed | null = null;
  if (!plan) {
    first = await requestDisarm(ctx, [0, segmentPages]);
    const sourcePages = first.range!.sourcePages;
    if (sourcePages <= segmentPages) {
      // The first range is the whole document: store it exactly where an unranged answer goes.
      return { kind: "whole", stored: await storeDisarmed(env, whole, first, {}) };
    }
    const status = await putCreateOnceJson(bucket, planKey, {
      schemaVersion: SEGMENT_PLAN_SCHEMA, sourceKey: whole.sourceKey, inputSha256: whole.inputSha256,
      totalPages: sourcePages, segmentPages,
    });
    plan = status === "failed" ? null : await readSegmentPlan(bucket, planKey, whole);
    if (!plan) throw new RetryableError("segment plan is not durable; retry required");
  }
  if (plan.segmentPages !== segmentPages) {
    // The same source must be cut the same way on every delivery, or two cuts would both be stored.
    throw new RetryableError("segment size changed while a segmented source was being read");
  }

  const read: Array<Record<string, unknown>> = [];
  // The first ranged request of a new plan is this delivery's one new range.
  let worked = first !== null;
  for (let start0 = 0; start0 < plan.totalPages; start0 += segmentPages) {
    const end0 = Math.min(start0 + segmentPages, plan.totalPages);
    const binding: CdrBinding = {
      ...whole,
      keyFor: (outputSha256) => segmentImmutableKey(workspaceId, documentId, start0, end0, outputSha256),
      listPrefix: segmentRangePrefix(workspaceId, documentId, start0, end0),
      pageRange: { start0, end0, sourcePages: plan.totalPages },
    };
    const reused = await reusableImmutable(bucket, binding);
    const isFirst = start0 === 0 && first !== null;
    // A range is work when it has no ocr.json yet: a CDR request, an OCR read, or both.
    const needsWork = !reused || !(await hasObject(bucket, ocrSiblingKey(reused.immutableKey)));
    if (needsWork && worked && !isFirst) throw new SegmentContinuation(start0 + 1);
    if (needsWork) worked = true;
    let stored: StoredImmutable;
    if (reused) {
      stored = { ...reused, cdrReceiptStatus: "exists" };
    } else {
      const disarmed = start0 === 0 && first ? first : await requestDisarm(ctx, [start0, start0 + segmentPages]);
      if (disarmed.range!.sourcePages !== plan.totalPages || disarmed.range!.end0 !== end0) {
        throw refuse("RECEIPT_MISMATCH", `CDR page count changed between ranges (pages ${start0 + 1}-${end0})`, ctx.observed);
      }
      stored = await storeDisarmed(env, binding, disarmed, { pageRange: { start0, end0 }, sourcePages: plan.totalPages });
    }

    const outcome = await readSanitized(ctx, whole.sourceKey, stored, options);
    if (outcome.ocr.status !== "written" && outcome.ocr.status !== "exists") {
      // A range that was not read ends the source here: refused, parked or retried exactly as a
      // whole document would be, and with no manifest, so no range of it is ever shown.
      return { kind: "result", result: resultFor(ctx, whole.sourceKey, stored, outcome) };
    }
    read.push({
      start0, end0, immutableKey: stored.immutableKey, sanitizedSha256: stored.outputSha256,
      ocrKey: ocrSiblingKey(stored.immutableKey),
    });
  }

  const manifest = {
    schemaVersion: SEGMENT_MANIFEST_SCHEMA, sourceKey: whole.sourceKey, inputSha256: whole.inputSha256,
    totalPages: plan.totalPages, segmentPages, segments: read,
  };
  const manifestStatus = await putCreateOnceJson(bucket, manifestKey, manifest);
  // A concurrent winner is adopted only when it is the same reading: the same source, the same
  // cut and the same ranges at the same immutable keys. Anything else means two readings raced.
  const durable = manifestStatus === "failed" ? null : await readJsonRecord(bucket, manifestKey);
  if (!durable?.record || JSON.stringify(durable.record) !== JSON.stringify(manifest)) {
    throw new RetryableError("segment manifest is not durable or conflicts; operator review required");
  }
  return manifestResult(ctx, whole, manifestKey, planKey, { totalPages: plan.totalPages, bytes: durable.bytes },
    manifestStatus === "written" ? "written" : "exists", `sha256:${await sha256Hex(durable.bytes)}`);
}
