import { cdrRequestSignature, hmacSecretIsConfigured, sha256DigestHeader } from "./hmac";
import { ocrPageRangeSiblingKey, ocrProgressSiblingKey, ocrSiblingKey } from "./keys";
import { RetryableError } from "./errors";
import { parseReaderBinding, readerBindingSha256 } from "../../../shared/completedReadReceipt";

type OcrR2Bucket = {
  get(key: string): Promise<{ size?: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: { stage: string };
      onlyIf?: { etagDoesNotMatch: string };
    },
  ): Promise<unknown>;
};

export type OcrDispatchStatus = "skipped" | "written" | "exists" | "failed";
export type OcrFailureCode =
  | "OCR_REVIEW_ALREADY_EXISTS"
  | "OCR_SOURCE_MISSING"
  | "OCR_SOURCE_EMPTY"
  | "OCR_TIMEOUT_OR_NETWORK"
  | "OCR_HTTP_UNAVAILABLE"
  | "OCR_HTTP_REJECTED"
  | "OCR_RESPONSE_NOT_JSON"
  | "OCR_RESPONSE_INVALID"
  | "OCR_PERSISTED_RESULT_INVALID"
  | "OCR_RESULT_WRITE_FAILED"
  | "OCR_PAGES_INCOMPLETE";

/**
 * A pod that died and a model that was wrong are different problems.
 *
 * Every failure above used to end the same way: two credits charged, a create-once
 * `explicit_operator_only` receipt written, and the document parked forever. That is right for a
 * reader that answered wrongly and wrong for a socket that closed -- and since the receipt is
 * create-once, the first cold start slower than the request budget parked the document
 * permanently and billed the customer for it.
 *
 * So each code says which kind it is. `transport` costs nothing, writes no receipt, and is left
 * to the queue's own bounded retry (`wrangler.jsonc`: max_retries 10 with backoff); `semantic`
 * keeps the receipt and the operator gate, because the reader did run and its answer did not
 * hold. The category names are the ones the scheduler already uses --
 * `core-integration/services/scheduler/src/akc_scheduler/retry_policy.py` -- so the two trees
 * classify a failure the same way instead of inventing a second taxonomy.
 */
export type OcrFailureKind = "transport" | "semantic";
/** The subset of `retry_policy.RetryCategory` that OCR dispatch can actually produce. */
export type OcrRetryCategory = "download_timeout" | "provider_5xx" | "invalid_output" | "unsupported_file";

export const OCR_FAILURE_CATEGORY: Record<OcrFailureCode, { kind: OcrFailureKind; retryCategory: OcrRetryCategory }> = {
  // The request never produced an answer: no reader ran, so nothing is owed and nothing is known.
  OCR_TIMEOUT_OR_NETWORK: { kind: "transport", retryCategory: "download_timeout" },
  OCR_HTTP_UNAVAILABLE: { kind: "transport", retryCategory: "provider_5xx" },
  OCR_SOURCE_MISSING: { kind: "transport", retryCategory: "download_timeout" },
  OCR_RESULT_WRITE_FAILED: { kind: "transport", retryCategory: "provider_5xx" },
  // A page range has no durable answer yet, so nothing was assembled. The ranges that were read
  // stay stored create-once, and the next delivery asks only for the missing ones.
  OCR_PAGES_INCOMPLETE: { kind: "transport", retryCategory: "download_timeout" },
  // The reader answered, or the source itself is the problem. A person decides what happens next.
  OCR_HTTP_REJECTED: { kind: "semantic", retryCategory: "unsupported_file" },
  OCR_SOURCE_EMPTY: { kind: "semantic", retryCategory: "unsupported_file" },
  OCR_RESPONSE_NOT_JSON: { kind: "semantic", retryCategory: "invalid_output" },
  OCR_RESPONSE_INVALID: { kind: "semantic", retryCategory: "invalid_output" },
  OCR_PERSISTED_RESULT_INVALID: { kind: "semantic", retryCategory: "invalid_output" },
  OCR_REVIEW_ALREADY_EXISTS: { kind: "semantic", retryCategory: "invalid_output" },
};

/** Unknown codes are semantic on purpose: never silently free, never silently retried. */
export function ocrFailureKind(code: OcrFailureCode | undefined): OcrFailureKind {
  return code ? OCR_FAILURE_CATEGORY[code]?.kind ?? "semantic" : "semantic";
}

export type OcrDispatchResult = {
  status: OcrDispatchStatus;
  key?: string;
  reason?: string;
  reasonCode?: OcrFailureCode;
  requestId?: string;
  inputSha256?: string;
  outputSha256?: string;
  observedPageCount?: number;
  readerRevision?: string;
  readerBindingSha256?: string;
  computeCredits: 0 | 2;
};

export type OcrDispatchEnv = {
  FOUNDATION_QUARANTINE: OcrR2Bucket;
  FOUNDATION_OCR_URL?: string;
  TAVONEL_OCR_HMAC?: string;
  TAVONEL_CDR_HMAC?: string;
  RUNPOD_API_KEY?: string;
  FOUNDATION_R2_BUCKET: string;
  FOUNDATION_COMPLETED_READ_ENABLED?: string;
  FOUNDATION_COMPLETED_READ_BINDING?: string;
  /** Opt-in only for a pinned v3 reader; a v2 create-once winner cannot satisfy it. */
  FOUNDATION_OCR_CONFLICT_V3_REQUIRED?: string;
  /**
   * Pages per OCR request. Unset (every deployment today) keeps the one whole-document request.
   * Set, the PDF is read range by range and `ocr.json` is assembled from the ranges. The reader
   * must have `TAVONEL_OCR_PAGE_RANGES_ENABLED`. There is no default: the size comes from a
   * measured seconds-per-page figure (table/limits design A4.1), and none is measured yet.
   */
  FOUNDATION_OCR_PAGE_RANGE_SIZE?: string;
};

/** Must stay retryable even after the queue's cold-start retry budget. */
export class OcrEvidenceRetryableError extends RetryableError {}
const MAX_PERSISTED_OCR_BYTES = 24 * 1024 * 1024;

async function inspectPersistedOcr(
  env: OcrDispatchEnv, immutablePdfKey: string, inputSha256: string, status: "exists" | "written",
): Promise<OcrDispatchResult> {
  const key = ocrSiblingKey(immutablePdfKey);
  let object: Awaited<ReturnType<OcrR2Bucket["get"]>>;
  let bytes: ArrayBuffer;
  try {
    object = await env.FOUNDATION_QUARANTINE.get(key);
    if (!object) throw new Error("missing");
    if (object.size !== undefined && (object.size < 1 || object.size > MAX_PERSISTED_OCR_BYTES)) {
      return { status: "failed", key, inputSha256, reasonCode: "OCR_PERSISTED_RESULT_INVALID", computeCredits: 2 };
    }
    bytes = await object.arrayBuffer();
  } catch {
    throw new OcrEvidenceRetryableError("persisted OCR cannot be read; retry required");
  }
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_PERSISTED_OCR_BYTES
      || (object.size !== undefined && bytes.byteLength !== object.size)) throw new Error("size");
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const result = qualifyOcrResult(payload, inputSha256, "persisted");
    if (!result || payload.sourceImmutableKey !== immutablePdfKey) throw new Error("contract");
    if (env.FOUNDATION_OCR_CONFLICT_V3_REQUIRED === "true" && result.schemaVersion !== OCR_RESULT_SCHEMA_V3) {
      throw new OcrEvidenceRetryableError("persisted v2 OCR lacks required v3 conflict evidence");
    }
    const outputSha256 = await sha256DigestHeader(bytes);
    const facts: OcrDispatchResult = { status, key, inputSha256, outputSha256,
      observedPageCount: result.pageCount, computeCredits: 2 };
    // Legacy objects have no provenance. Never stamp them with today's configured revision.
    if (env.FOUNDATION_COMPLETED_READ_ENABLED === "true" || result.schemaVersion === OCR_RESULT_SCHEMA_V3) {
      const binding = parseReaderBinding(env.FOUNDATION_COMPLETED_READ_BINDING, (env.FOUNDATION_OCR_URL ?? "").trim());
      if (!binding || payload.readerRevision !== binding.readerRevision
        || payload.readerBindingSha256 !== await readerBindingSha256(binding)) {
        throw new OcrEvidenceRetryableError("persisted OCR reader provenance is not qualified");
      }
      facts.readerRevision = payload.readerRevision;
      facts.readerBindingSha256 = payload.readerBindingSha256;
    }
    return facts;
  } catch (error) {
    if (error instanceof OcrEvidenceRetryableError) throw error;
    return { status: "failed", key, inputSha256, reasonCode: "OCR_PERSISTED_RESULT_INVALID",
      reason: "persisted OCR does not match the sanitized source", computeCredits: 2 };
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PROD_MARKERS = ["tavonel-pdf-cdr", "tavonel-prod", "tavonel-quarantine-sidecar"];
const OCR_RESULT_SCHEMA_V2 = "tavonel.ocr_result.v2";
const OCR_RESULT_SCHEMA_V3 = "tavonel.ocr_result.v3";
const RECOGNIZER_IDENTITIES: Record<string, string> = {
  "general-ppocrv6": "sha256:6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
  "korean-ppocrv5": "sha256:cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b",
};
const AUTHORITY_CLASSES = new Set(["unknown", "informal", "official", "contractual"]);
// RunPod cold starts have been observed at roughly 30 seconds. Keep the request below the
// approved 90-second execution ceiling while leaving enough room for startup and one-page OCR.
//
// It stays at 85 s even though a queue consumer may run for 15 minutes of wall time. A longer
// single request would hold the invocation open while a scaled-to-zero GPU boots and would still
// have no answer when the boot is slower than the guess. The consumer redelivers the message
// after a delay instead (OCR_COLD_START_RETRY_DELAYS_S in index.ts), which costs nothing while
// it waits and keeps the request inside the approved ceiling.
export const OCR_REQUEST_TIMEOUT_MS = 85_000;
/** One JSON document per line. Matches the worker's `tavonel.ocr_progress.v1` stream. */
const OCR_PROGRESS_SCHEMA = "tavonel.ocr_progress.v1";
const NDJSON_MEDIA_TYPE = "application/x-ndjson";
/** The separator is the contract, so it is named rather than inlined. */
const LINE_SEPARATOR = String.fromCharCode(10);

export type OcrProgressPage = {
  pageNumber1: number;
  pageCount: number;
  path: string;
  regionCount: number;
  meanConfidence: number;
  boxes: Array<{ bbox1000: number[]; confidence: number; text: string; regionId: string }>;
};

/**
 * What is written to the progress object while a document is being read.
 *
 * This carries the lines that were read, and it is worth being precise about why that is safe.
 * The property the product actually promises is that the *application server* never carries file
 * bytes -- and it does not: this object is written by the worker to the bucket, and the browser
 * reads it from the bucket with a signed URL the application issues without ever seeing the
 * content. Text living here is the customer's own document travelling from their storage to
 * their screen, which is the same trip the original file already makes.
 *
 * Two limits keep it honest anyway. Only a rolling window of pages is retained, so the object
 * never becomes a second copy of the document; and `ocr.json` is still the only record, still
 * written create-once. This object is a view, expires, and is evidence of nothing.
 */
export type OcrProgressDocument = {
  schemaVersion: typeof OCR_PROGRESS_SCHEMA;
  sourceImmutableKey: string;
  inputSha256: string;
  state: "reading" | "read" | "refused";
  pagesRead: number;
  pageCount: number | null;
  regionsFound: number;
  pages: OcrProgressPage[];
};

/** Keeps the object small no matter how long the document is. The counts stay exact. */
const PROGRESS_PAGE_WINDOW = 12;

export function qualifyProgressPage(line: unknown): OcrProgressPage | null {
  if (!line || typeof line !== "object") return null;
  const page = line as Record<string, unknown>;
  if (page.schemaVersion !== OCR_PROGRESS_SCHEMA || page.type !== "page") return null;
  if (typeof page.pageNumber1 !== "number" || page.pageNumber1 < 1) return null;
  if (typeof page.pageCount !== "number" || page.pageCount < 1) return null;
  if (page.pageNumber1 > page.pageCount) return null;
  if (typeof page.regionCount !== "number" || page.regionCount < 0) return null;
  if (typeof page.meanConfidence !== "number" || page.meanConfidence < 0 || page.meanConfidence > 1) return null;
  if (typeof page.path !== "string") return null;
  const boxes = Array.isArray(page.boxes) ? page.boxes : [];
  return {
    pageNumber1: page.pageNumber1,
    pageCount: page.pageCount,
    path: page.path,
    regionCount: page.regionCount,
    meanConfidence: page.meanConfidence,
    boxes: boxes.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const box = entry as Record<string, unknown>;
      const bbox = Array.isArray(box.bbox1000) ? box.bbox1000 : [];
      if (bbox.length !== 4 || bbox.some((value) => typeof value !== "number" || value < 0 || value > 1000)) return [];
      const confidence = typeof box.confidence === "number" ? box.confidence : 0;
      return [{
        bbox1000: bbox as number[],
        confidence: Math.max(0, Math.min(1, confidence)),
        text: typeof box.text === "string" ? box.text.slice(0, 400) : "",
        regionId: typeof box.regionId === "string" ? box.regionId.slice(0, 256) : "",
      }];
    }),
  };
}

/**
 * Reads an NDJSON body line by line, reporting each qualified page and returning the last line.
 *
 * The last line is the OCR result and is handed back untouched, so the same qualifier that
 * guarded the buffered response guards this one. A line that does not qualify as a page is not an
 * error -- it is simply not reported -- because the only line that decides anything is the last.
 */
export async function readOcrStream(
  body: ReadableStream<Uint8Array>,
  onPage: (page: OcrProgressPage) => Promise<void> | void,
): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let last: unknown = null;
  let receivedBytes = 0;

  const consume = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    const page = qualifyProgressPage(parsed);
    if (page) {
      await onPage(page);
      return;
    }
    // Not a page: this is either the result or a refusal. Either way it is the answer, and the
    // last one to arrive wins.
    last = parsed;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_PERSISTED_OCR_BYTES) {
      await reader.cancel();
      throw new Error("OCR stream exceeds the result bound");
    }
    buffered += decoder.decode(value, { stream: true });
    let newline = buffered.indexOf(LINE_SEPARATOR);
    while (newline >= 0) {
      await consume(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf(LINE_SEPARATOR);
    }
  }
  buffered += decoder.decode();
  await consume(buffered);
  return last;
}

async function readBoundedOcrJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("missing OCR body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PERSISTED_OCR_BYTES) { await reader.cancel(); throw new Error("OCR response exceeds the result bound"); }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}


type OcrRegion = {
  regionId: string;
  pageIndex0: number;
  pageNumber1: number;
  order: number;
  blockType: string;
  text: string;
  bbox1000: [number, number, number, number];
  confidence: number;
  authority: string;
  recognitionConflict?: {
    sourceSha256: string;
    regionId: string;
    pageIndex0: number;
    bbox1000: [number, number, number, number];
    candidates: Array<{
      engineId: "general-ppocrv6" | "korean-ppocrv5";
      modelSha256: string;
      text: string;
      confidence: number;
      polygon: number[][];
    }>;
  };
};

type QualifiedOcrResult = {
  schemaVersion: typeof OCR_RESULT_SCHEMA_V2 | typeof OCR_RESULT_SCHEMA_V3;
  status: "ok";
  text: string;
  pageCount: number;
  inputSha256: string;
  regions: OcrRegion[];
  recognitionConflictCount?: number;
};

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

function polygonBounds(points: number[][]): [number, number, number, number] {
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
}

function polygonBoxIoU(left: number[][], right: number[][]): number {
  const a = polygonBounds(left), b = polygonBounds(right);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  if (areaA <= 0 || areaB <= 0) return 0;
  const intersection = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return intersection / (areaA + areaB - intersection);
}

export function qualifyOcrResult(
  payload: unknown, expectedInputSha256: string, location: "response" | "persisted" = "response",
): QualifiedOcrResult | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const result = payload as Partial<QualifiedOcrResult>;
  const v3 = result.schemaVersion === OCR_RESULT_SCHEMA_V3;
  if (!v3 && (Object.hasOwn(payload, "recognitionConflict") || Object.hasOwn(payload, "recognitionConflicts"))) return null;
  if (v3 && !exactKeys(payload as Record<string, unknown>, [
    "schemaVersion", "status", "text", "pageCount", "inputSha256", "regions", "recognitionConflictCount",
    ...(location === "persisted" ? ["sourceImmutableKey", "readerRevision", "readerBindingSha256"] : []),
  ])) return null;
  if (
    (result.schemaVersion !== OCR_RESULT_SCHEMA_V2 && !v3) ||
    result.status !== "ok" ||
    typeof result.text !== "string" ||
    result.text.length < 1 ||
    result.text.length > 4_000_000 ||
    !Number.isInteger(result.pageCount) ||
    Number(result.pageCount) < 1 ||
    Number(result.pageCount) > 80 ||
    result.inputSha256 !== expectedInputSha256 ||
    !SHA256_PATTERN.test(result.inputSha256) ||
    !Array.isArray(result.regions) ||
    result.regions.length < 1 ||
    result.regions.length > 50_000
  ) return null;
  if (v3 && (!Number.isInteger(result.recognitionConflictCount) ||
    Number(result.recognitionConflictCount) < 0 || Number(result.recognitionConflictCount) > 128)) return null;

  const regionIds = new Set<string>();
  const orders = new Set<number>();
  let conflictCount = 0;
  for (const region of result.regions) {
    if (!region || typeof region !== "object" || Array.isArray(region)) return null;
    if (v3 && !exactKeys(region as unknown as Record<string, unknown>, [
      "regionId", "pageIndex0", "pageNumber1", "order", "blockType", "text",
      "bbox1000", "confidence", "authority", ...(region.recognitionConflict ? ["recognitionConflict"] : []),
    ])) return null;
    if (!v3 && Object.hasOwn(region, "recognitionConflict")) return null;
    const bbox = region.bbox1000;
    if (
      typeof region.regionId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(region.regionId) ||
      regionIds.has(region.regionId) ||
      !Number.isInteger(region.pageIndex0) ||
      region.pageIndex0 < 0 ||
      region.pageIndex0 >= Number(result.pageCount) ||
      region.pageNumber1 !== region.pageIndex0 + 1 ||
      !Number.isInteger(region.order) ||
      region.order < 0 ||
      orders.has(region.order) ||
      typeof region.blockType !== "string" ||
      typeof region.text !== "string" ||
      region.text.trim().length < 1 ||
      region.text.length > 200_000 ||
      !Array.isArray(bbox) ||
      bbox.length !== 4 ||
      bbox.some((coordinate) => !Number.isInteger(coordinate) || coordinate < 0 || coordinate > 1000) ||
      bbox[0] >= bbox[2] ||
      bbox[1] >= bbox[3] ||
      typeof region.confidence !== "number" ||
      !Number.isFinite(region.confidence) ||
      region.confidence < 0 ||
      region.confidence > 1 ||
      !AUTHORITY_CLASSES.has(region.authority)
    ) return null;
    if (v3 && region.recognitionConflict !== undefined) {
      conflictCount += 1;
      if (conflictCount > 128) return null;
      const conflict = region.recognitionConflict as Record<string, unknown>;
      if (!conflict || typeof conflict !== "object" || Array.isArray(conflict) ||
        !exactKeys(conflict, ["sourceSha256", "regionId", "pageIndex0", "bbox1000", "candidates"]) ||
        conflict.sourceSha256 !== expectedInputSha256 || conflict.regionId !== region.regionId ||
        conflict.pageIndex0 !== region.pageIndex0 ||
        !Array.isArray(conflict.bbox1000) ||
        conflict.bbox1000.length !== 4 || conflict.bbox1000.some((x, i) => x !== bbox[i]) ||
        !Array.isArray(conflict.candidates) || conflict.candidates.length !== 2) return null;
      const engines = new Set<string>();
      let selectedMatches = 0;
      const texts = new Set<string>();
      const polygons: number[][][] = [];
      for (const item of conflict.candidates) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const candidate = item as Record<string, unknown>;
        if (!exactKeys(candidate, ["engineId", "modelSha256", "text", "confidence", "polygon"]) ||
          typeof candidate.engineId !== "string" ||
          candidate.modelSha256 !== RECOGNIZER_IDENTITIES[candidate.engineId] ||
          engines.has(candidate.engineId) ||
          typeof candidate.text !== "string" || !candidate.text.trim() || candidate.text.length > 2000 ||
          typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) ||
          candidate.confidence < 0 || candidate.confidence > 1 ||
          !Array.isArray(candidate.polygon) || candidate.polygon.length < 3 || candidate.polygon.length > 8 ||
          candidate.polygon.some((point) => !Array.isArray(point) || point.length !== 2 ||
            point.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0))) return null;
        engines.add(candidate.engineId);
        texts.add(candidate.text);
        polygons.push(candidate.polygon as number[][]);
        if (candidate.text === region.text && candidate.confidence === region.confidence) selectedMatches += 1;
      }
      if (engines.size !== 2 || texts.size !== 2 || selectedMatches !== 1 ||
        polygonBoxIoU(polygons[0], polygons[1]) < 0.45) return null;
    }
    regionIds.add(region.regionId);
    orders.add(region.order);
  }
  if (result.regions.some((_region, index) => !orders.has(index))) return null;
  if (v3 && conflictCount !== result.recognitionConflictCount) return null;
  if (v3 && (location === "persisted" && (
      typeof (payload as Record<string, unknown>).sourceImmutableKey !== "string" ||
      !SHA256_PATTERN.test((payload as Record<string, unknown>).readerRevision as string) ||
      !SHA256_PATTERN.test((payload as Record<string, unknown>).readerBindingSha256 as string)
    ))) return null;
  if (result.text !== result.regions.map((region) => region.text).join("\n").trim()) return null;
  return result as QualifiedOcrResult;
}

export function ocrUrlHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isForbiddenOcrUrl(url: string): boolean {
  const host = ocrUrlHost(url);
  const haystack = `${host} ${url}`.toLowerCase();
  return PROD_MARKERS.some((marker) => haystack.includes(marker));
}

export function looksLikeFoundationOcrUrl(url: string): boolean {
  const trimmed = (url || "").trim();
  if (!trimmed || isForbiddenOcrUrl(trimmed)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (parsed.protocol !== "https:" && !local) {
    return false;
  }
  const path = parsed.pathname.toLowerCase();
  return host.includes("ocr") || host.includes("foundation") || path.includes("/v1/ocr");
}

export function shouldDispatchOcr(url: string | undefined | null): boolean {
  return looksLikeFoundationOcrUrl((url || "").trim());
}

export async function dispatchOcrAfterSanitize(
  env: OcrDispatchEnv,
  immutablePdfKey: string,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
  newRequestId: () => string = () => crypto.randomUUID(),
  timeoutMs = OCR_REQUEST_TIMEOUT_MS,
): Promise<OcrDispatchResult> {
  const url = (env.FOUNDATION_OCR_URL || "").trim();
  if (!url) {
    return { status: "skipped", reason: "FOUNDATION_OCR_URL is unset", computeCredits: 0 };
  }
  if (isForbiddenOcrUrl(url) || (env.FOUNDATION_R2_BUCKET || "").includes("tavonel-prod")) {
    return { status: "skipped", reason: "OCR URL or bucket is not a Foundation target", computeCredits: 0 };
  }
  if (!looksLikeFoundationOcrUrl(url)) {
    return { status: "skipped", reason: "OCR URL is not a Foundation target", computeCredits: 0 };
  }
  const rangeSize = ocrPageRangeSize(env);

  const ocrKey = ocrSiblingKey(immutablePdfKey);
  let existingOcr: Awaited<ReturnType<OcrR2Bucket["get"]>>;
  let pdf: Awaited<ReturnType<OcrR2Bucket["get"]>>;
  try {
    existingOcr = await env.FOUNDATION_QUARANTINE.get(ocrKey);
    pdf = await env.FOUNDATION_QUARANTINE.get(immutablePdfKey);
  } catch {
    throw new OcrEvidenceRetryableError("OCR source or existence lookup cannot be read; retry required");
  }
  if (!pdf) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_SOURCE_MISSING", reason: "immutable PDF is not readable for OCR", computeCredits: 0 };
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await pdf.arrayBuffer();
  } catch {
    throw new OcrEvidenceRetryableError("OCR source body cannot be read; retry required");
  }
  if (bytes.byteLength < 1) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_SOURCE_EMPTY", reason: "immutable PDF is empty", computeCredits: 0 };
  }

  const inputSha256 = await sha256DigestHeader(bytes);
  let rangeReadOnly = false;
  if (existingOcr) {
    const persisted = await inspectPersistedOcr(env, immutablePdfKey, inputSha256, "exists");
    if (rangeSize === null || persisted.status !== "failed") return persisted;
    // A document longer than one reader answer fails the whole-document check by its page count
    // alone. It is proven against its stored ranges instead, without asking the reader again.
    rangeReadOnly = true;
  }
  const binding = env.FOUNDATION_COMPLETED_READ_ENABLED === "true"
    ? parseReaderBinding(env.FOUNDATION_COMPLETED_READ_BINDING, url) : null;
  if (env.FOUNDATION_OCR_CONFLICT_V3_REQUIRED === "true" && !binding) {
    throw new OcrEvidenceRetryableError("v3 OCR requires a qualified completed-read binding");
  }
  if (env.FOUNDATION_COMPLETED_READ_ENABLED === "true" && !binding) {
    throw new OcrEvidenceRetryableError("qualified immutable OCR reader binding is missing");
  }
  const reader: ReaderPost = { env, url, ocrKey, bytes, inputSha256, binding, fetcher, now, newRequestId, timeoutMs };
  if (rangeSize !== null) {
    return dispatchOcrRanges({ ...reader, immutablePdfKey, size: rangeSize, readOnly: rangeReadOnly,
      provenance: binding ? { readerRevision: binding.readerRevision, readerBindingSha256: await readerBindingSha256(binding) } : {} });
  }
  // Ask for the per-page view. A worker that does not implement it ignores this and answers
  // with JSON exactly as before, which is why there is no capability check here.
  const posted = await postToReader(reader, `${NDJSON_MEDIA_TYPE}, application/json`);
  if ("failed" in posted) return posted.failed;
  const { response, requestId } = posted;

  /*
   * Two ways to read the same answer.
   *
   * A streamed response is read line by line so the reading can be watched while it happens; a
   * buffered one is read as it always was. Both end at `qualifyOcrResult` with the same object,
   * because the worker builds the last line of the stream and the body of the JSON response from
   * one function. Nothing below this point knows or cares which path was taken.
   */
  const progressKey = ocrProgressSiblingKey(immutablePdfKey);
  let payload: unknown;
  const streamed = (response.headers.get("content-type") || "").toLowerCase().includes(NDJSON_MEDIA_TYPE);
  if (streamed && response.body) {
    const progress: OcrProgressDocument = {
      schemaVersion: OCR_PROGRESS_SCHEMA,
      sourceImmutableKey: immutablePdfKey,
      inputSha256,
      state: "reading",
      pagesRead: 0,
      pageCount: null,
      regionsFound: 0,
      pages: [],
    };
    const writeProgress = async () => {
      try {
        await env.FOUNDATION_QUARANTINE.put(progressKey, new TextEncoder().encode(JSON.stringify(progress)), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: { stage: "ocr-progress" },
        });
      } catch {
        // A progress write is a convenience. Losing one must never cost the read.
      }
    };
    try {
      payload = await readOcrStream(response.body, async (page) => {
        progress.pagesRead = Math.max(progress.pagesRead, page.pageNumber1);
        progress.pageCount = page.pageCount;
        progress.regionsFound += page.regionCount;
        progress.pages = [...progress.pages, page].slice(-PROGRESS_PAGE_WINDOW);
        await writeProgress();
      });
    } catch {
      return { status: "failed", key: ocrKey, reasonCode: "OCR_TIMEOUT_OR_NETWORK", reason: "OCR stream ended before a result", requestId, inputSha256, computeCredits: 0 };
    }
    progress.state = "read";
    await writeProgress();
  } else {
    try {
      payload = await readBoundedOcrJson(response);
    } catch {
      return { status: "failed", key: ocrKey, reasonCode: "OCR_RESPONSE_NOT_JSON", reason: "OCR response is not JSON", requestId, inputSha256, computeCredits: 2 };
    }
  }
  const qualified = qualifyOcrResult(payload, inputSha256);
  if (!qualified) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_RESPONSE_INVALID", reason: "OCR response contract is invalid", requestId, inputSha256, computeCredits: 2 };
  }
  await assertReaderAnswer(env, payload, qualified.schemaVersion, binding);

  const persistedBytes = await persistedOcrBody(qualified, immutablePdfKey, binding);
  if (persistedBytes.byteLength > MAX_PERSISTED_OCR_BYTES) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_RESPONSE_INVALID", computeCredits: 2 };
  }
  return putOcrJsonCreateOnce(env, ocrKey, persistedBytes, { requestId, inputSha256 },
    (status) => inspectPersistedOcr(env, immutablePdfKey, inputSha256, status));
}

type ReaderBinding = NonNullable<ReturnType<typeof parseReaderBinding>>;

type ReaderPost = {
  env: OcrDispatchEnv;
  url: string;
  ocrKey: string;
  bytes: ArrayBuffer;
  inputSha256: string;
  binding: ReaderBinding | null;
  fetcher: typeof fetch;
  now: () => Date;
  newRequestId: () => string;
  timeoutMs: number;
};

/**
 * One signed POST of the sanitized PDF to the reader.
 *
 * A failure comes back exactly as the whole-document request has always reported it; a range
 * request is the same POST with one more header. Provenance violations throw retryable, as before.
 */
async function postToReader(
  post: ReaderPost, accept: string, pageRange?: string,
): Promise<{ response: Response; requestId: string } | { failed: OcrDispatchResult }> {
  const { env, ocrKey, inputSha256, binding } = post;
  const timestamp = post.now().toISOString();
  const requestId = post.newRequestId();
  const hmac = (env.TAVONEL_OCR_HMAC || env.TAVONEL_CDR_HMAC || "").trim();
  const headers: Record<string, string> = { "x-tavonel-input-sha256": inputSha256, accept };
  // Not signed: the answer echoes the range it read, and the caller refuses any other range.
  if (pageRange) headers["x-tavonel-ocr-page-range"] = pageRange;
  const runpodKey = (env.RUNPOD_API_KEY || "").trim();
  if (runpodKey) {
    headers.Authorization = `Bearer ${runpodKey}`;
  }
  if (hmacSecretIsConfigured(hmac) && REQUEST_ID_PATTERN.test(requestId)) {
    headers["x-tavonel-ocr-timestamp"] = timestamp;
    headers["x-tavonel-ocr-request-id"] = requestId;
    headers["x-tavonel-ocr-signature"] = await cdrRequestSignature(
      hmac,
      timestamp,
      requestId,
      inputSha256,
    );
  }

  const form = new FormData();
  form.append("source", new Blob([post.bytes], { type: "application/pdf" }), "sanitized.pdf");

  let response: Response;
  try {
    response = await post.fetcher(post.url, {
      method: "POST",
      headers,
      body: form,
      // A qualification attests this endpoint only; following a redirect invalidates attribution.
      ...(binding ? { redirect: "error" as const } : {}),
      signal: AbortSignal.timeout(post.timeoutMs),
    });
  } catch {
    return { failed: { status: "failed", key: ocrKey, reasonCode: "OCR_TIMEOUT_OR_NETWORK", reason: "OCR request timed out or failed", requestId, inputSha256, computeCredits: 0 } };
  }
  let responseEndpointMatches = false;
  if (binding) {
    try { responseEndpointMatches = new URL(response.url).href === new URL(binding.endpoint).href; } catch { /* fail closed */ }
  }
  if (binding && (response.redirected || !responseEndpointMatches
    || (response.status >= 300 && response.status < 400))) {
    throw new OcrEvidenceRetryableError("OCR response endpoint provenance is not qualified");
  }
  const responseRevision = response.headers.get("x-tavonel-reader-revision");
  if (binding && responseRevision !== null && responseRevision !== binding.readerRevision) {
    throw new OcrEvidenceRetryableError("OCR response reader revision conflicts with qualification");
  }
  if (!response.ok) {
    // 5xx and 429 are the endpoint being unavailable, not an answer about this document.
    const unavailable = response.status >= 500 || response.status === 429;
    return { failed: unavailable
      ? { status: "failed", key: ocrKey, reasonCode: "OCR_HTTP_UNAVAILABLE", reason: `OCR returned HTTP ${response.status}`, requestId, inputSha256, computeCredits: 0 }
      : { status: "failed", key: ocrKey, reasonCode: "OCR_HTTP_REJECTED", reason: `OCR returned HTTP ${response.status}`, requestId, inputSha256, computeCredits: 2 } };
  }
  return { response, requestId };
}

/** What every qualified reader answer must also satisfy before it is stored, whole or in ranges. */
async function assertReaderAnswer(
  env: OcrDispatchEnv, payload: unknown, schemaVersion: QualifiedOcrResult["schemaVersion"], binding: ReaderBinding | null,
): Promise<void> {
  if (schemaVersion === OCR_RESULT_SCHEMA_V3 && !binding) {
    throw new OcrEvidenceRetryableError("v3 OCR result has no qualified completed-read binding");
  }
  if (env.FOUNDATION_OCR_CONFLICT_V3_REQUIRED === "true" && schemaVersion !== OCR_RESULT_SCHEMA_V3) {
    throw new OcrEvidenceRetryableError("v2 OCR response lacks required v3 conflict evidence");
  }

  if (binding) {
    const provenance = payload as Record<string, unknown>;
    if ((Object.hasOwn(provenance, "readerRevision") && provenance.readerRevision !== binding.readerRevision)
      || (Object.hasOwn(provenance, "readerBindingSha256")
        && provenance.readerBindingSha256 !== await readerBindingSha256(binding))) {
      throw new OcrEvidenceRetryableError("OCR result reader provenance conflicts with qualification");
    }
  }
}

/** The one serialization of `ocr.json`, so a document assembled from ranges is the same bytes. */
async function persistedOcrBody(
  qualified: QualifiedOcrResult, immutablePdfKey: string, binding: ReaderBinding | null,
): Promise<Uint8Array> {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: qualified.schemaVersion,
    status: qualified.status,
    text: qualified.text,
    pageCount: qualified.pageCount,
    regions: qualified.regions,
    ...(qualified.schemaVersion === OCR_RESULT_SCHEMA_V3 ?
      { recognitionConflictCount: qualified.recognitionConflictCount } : {}),
    sourceImmutableKey: immutablePdfKey,
    inputSha256: qualified.inputSha256,
    ...(binding ? { readerRevision: binding.readerRevision, readerBindingSha256: await readerBindingSha256(binding) } : {}),
  }));
}

async function putOcrJsonCreateOnce(
  env: OcrDispatchEnv,
  ocrKey: string,
  persistedBytes: Uint8Array,
  failure: { requestId?: string; inputSha256: string },
  inspect: (status: "exists" | "written") => Promise<OcrDispatchResult>,
): Promise<OcrDispatchResult> {
  try {
    await env.FOUNDATION_QUARANTINE.put(ocrKey, persistedBytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { stage: "ocr-json" },
      onlyIf: { etagDoesNotMatch: "*" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/precondition|already exists|conflict/iu.test(message)) {
      return inspect("exists");
    }
    if (env.FOUNDATION_COMPLETED_READ_ENABLED === "true") {
      throw new OcrEvidenceRetryableError("OCR persistence is incomplete; retry required");
    }
    return { status: "failed", key: ocrKey, reasonCode: "OCR_RESULT_WRITE_FAILED", reason: "ocr.json write failed", ...failure, computeCredits: 0 };
  }
  // R2 may return null on a failed condition instead of throwing. Read the durable winner on
  // every path; the response candidate and its serialization are never the receipt digest.
  return inspect("written");
}

/*
 * Page-range reading (table/limits design 2026-10-17, A4.1). Off unless
 * FOUNDATION_OCR_PAGE_RANGE_SIZE is set.
 *
 * One whole-document request has to finish inside OCR_REQUEST_TIMEOUT_MS, and a measured 73-page
 * scan took 182.9 s (design A2 #11, F5-GPU-OCR-RECEIPT.json `documentMode`). So the PDF is sent
 * once per range of pages instead, each answer is stored
 * create-once under `ocr-pages/`, and `ocr.json` is assembled only when every range is stored.
 * A range with no durable answer leaves nothing assembled and reports OCR_PAGES_INCOMPLETE; a
 * redelivery reads the stored ranges back and asks the reader only for the missing ones.
 *
 * Joining the ranges in page order and numbering `order` across them gives the regions a
 * whole-document request returns, and `persistedOcrBody` serializes both, so for a document a
 * whole-document request could read, the two paths write the same bytes.
 *
 * ponytail: every range runs inside one queue delivery, so ranges x OCR_REQUEST_TIMEOUT_MS must
 * fit the 15-minute consumer wall; one queue message per range (A4.1) lifts that. The live view
 * (ocr-progress.json) is not written in range mode.
 */
const PAGE_RANGE_SCHEMA = "tavonel.ocr_page_range.v1";
/**
 * The longest document range mode will plan reads for. A loop bound, not a capability: the
 * intake ceiling (`shared/intakeCeiling.ts`, the CDR's MAX_PAGES) still refuses a longer source
 * before OCR, and the reader keeps its own page bound. This only stops a reader that misreports
 * `pageCount` from driving an unbounded run of requests. 500 is the stage-2 page target the
 * table/limits design proposes (A4.5) -- proposed, not measured.
 */
const MAX_RANGE_DOCUMENT_PAGES = 500;

/**
 * Pages per range request, or null for the one whole-document request. A value that is set but
 * malformed is refused, never ignored: a flag that fell back silently would look switched on.
 */
export function ocrPageRangeSize(env: Pick<OcrDispatchEnv, "FOUNDATION_OCR_PAGE_RANGE_SIZE">): number | null {
  const raw = (env.FOUNDATION_OCR_PAGE_RANGE_SIZE ?? "").trim();
  if (!raw) return null;
  if (!/^[1-9]\d{0,2}$/u.test(raw)) {
    throw new OcrEvidenceRetryableError("FOUNDATION_OCR_PAGE_RANGE_SIZE is not a whole number of pages");
  }
  return Number(raw);
}

type ReaderProvenance = { readerRevision?: string; readerBindingSha256?: string };
type PageStatus = { pageNumber1: number; pageStatus: "ok" | "no_text" };

export type QualifiedPageRange = {
  resultSchemaVersion: QualifiedOcrResult["schemaVersion"];
  pageCount: number;
  start0: number;
  end0: number;
  pages: PageStatus[];
  regions: OcrRegion[];
  recognitionConflictCount: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A reader's answer for pages [start0, min(start0 + size, pageCount)), or null.
 *
 * Every rule a whole-document answer obeys is applied by `qualifyOcrResult` itself, to the range
 * re-based as if it were the whole document: region shape, identity, order, bbox, confidence,
 * conflict evidence, and the bounds on pages, text and regions per answer. On top of that, every
 * page of the range is listed exactly once, and `no_text` exactly when it yielded no region.
 */
export function qualifyOcrPageRange(
  payload: unknown,
  expectedInputSha256: string,
  start0: number,
  size: number,
  persisted?: { sourceImmutableKey: string; provenance: ReaderProvenance },
): QualifiedPageRange | null {
  if (!isRecord(payload)) return null;
  const v3 = payload.resultSchemaVersion === OCR_RESULT_SCHEMA_V3;
  if (!v3 && payload.resultSchemaVersion !== OCR_RESULT_SCHEMA_V2) return null;
  if (!exactKeys(payload, [
    "schemaVersion", "status", "resultSchemaVersion", "inputSha256", "pageCount", "pageRange", "pages", "regions",
    ...(v3 ? ["recognitionConflictCount"] : []),
    ...(persisted ? ["sourceImmutableKey", ...Object.keys(persisted.provenance)] : []),
  ])) return null;
  if (persisted && payload.sourceImmutableKey !== persisted.sourceImmutableKey) return null;
  const { pageCount, pageRange, pages, regions } = payload;
  if (payload.schemaVersion !== PAGE_RANGE_SCHEMA || payload.status !== "ok"
    || payload.inputSha256 !== expectedInputSha256 || !SHA256_PATTERN.test(expectedInputSha256)
    || typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 1
    || pageCount > MAX_RANGE_DOCUMENT_PAGES || start0 >= pageCount) return null;
  const end0 = Math.min(start0 + size, pageCount);
  if (!isRecord(pageRange) || !exactKeys(pageRange, ["start0", "end0"])
    || pageRange.start0 !== start0 || pageRange.end0 !== end0) return null;
  if (!Array.isArray(regions) || !Array.isArray(pages) || pages.length !== end0 - start0) return null;
  if (!regions.every((region) => isRecord(region) && typeof region.pageIndex0 === "number"
    && region.pageIndex0 >= start0 && region.pageIndex0 < end0)) return null;
  const read = new Set(regions.map((region) => (region as OcrRegion).pageIndex0));
  if (!pages.every((page, offset) => isRecord(page) && exactKeys(page, ["pageNumber1", "pageStatus"])
    && page.pageNumber1 === start0 + offset + 1
    && page.pageStatus === (read.has(start0 + offset) ? "ok" : "no_text"))) return null;
  const recognitionConflictCount = v3 ? payload.recognitionConflictCount : 0;
  if (regions.length === 0 && recognitionConflictCount !== 0) return null;
  if (regions.length > 0) {
    const shift = (value: unknown) => (typeof value === "number" ? value - start0 : value);
    const rebased = (regions as Record<string, unknown>[]).map((region) => ({
      ...region,
      pageIndex0: shift(region.pageIndex0),
      pageNumber1: shift(region.pageNumber1),
      ...(isRecord(region.recognitionConflict) ? {
        recognitionConflict: { ...region.recognitionConflict, pageIndex0: shift(region.recognitionConflict.pageIndex0) },
      } : {}),
    }));
    const asDocument = {
      schemaVersion: payload.resultSchemaVersion, status: "ok",
      text: (regions as OcrRegion[]).map((region) => region.text).join("\n").trim(),
      pageCount: end0 - start0, inputSha256: expectedInputSha256, regions: rebased,
      ...(v3 ? { recognitionConflictCount } : {}),
    };
    if (!qualifyOcrResult(asDocument, expectedInputSha256)) return null;
  }
  return {
    resultSchemaVersion: payload.resultSchemaVersion as QualifiedPageRange["resultSchemaVersion"],
    pageCount, start0, end0,
    pages: pages as PageStatus[],
    regions: regions as OcrRegion[],
    recognitionConflictCount: recognitionConflictCount as number,
  };
}

type RangeRun = ReaderPost & {
  immutablePdfKey: string;
  size: number;
  /** ocr.json already exists: prove it from stored ranges, and never ask the reader. */
  readOnly: boolean;
  /** The reader provenance every stored range and the assembled ocr.json must carry. */
  provenance: ReaderProvenance;
};

function rangeFailure(
  run: RangeRun, reasonCode: OcrFailureCode, reason: string, computeCredits: 0 | 2, requestId?: string,
): OcrDispatchResult {
  return { status: "failed", key: run.ocrKey, reasonCode, reason, ...(requestId ? { requestId } : {}),
    inputSha256: run.inputSha256, computeCredits };
}

async function readStoredRange(run: RangeRun, key: string, start0: number): Promise<QualifiedPageRange | OcrDispatchResult | "missing"> {
  let bytes: ArrayBuffer;
  try {
    const object = await run.env.FOUNDATION_QUARANTINE.get(key);
    if (!object) return "missing";
    if (object.size !== undefined && (object.size < 1 || object.size > MAX_PERSISTED_OCR_BYTES)) {
      return rangeFailure(run, "OCR_PERSISTED_RESULT_INVALID", "stored OCR page range is out of bounds", 2);
    }
    bytes = await object.arrayBuffer();
  } catch {
    throw new OcrEvidenceRetryableError("stored OCR page range cannot be read; retry required");
  }
  let payload: unknown = null;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { /* refused below */ }
  const fields = isRecord(payload) ? payload : null;
  if (fields && Object.entries(run.provenance).some(([name, value]) => fields[name] !== value)) {
    throw new OcrEvidenceRetryableError("stored OCR page range reader provenance is not qualified");
  }
  const range = qualifyOcrPageRange(payload, run.inputSha256, start0, run.size,
    { sourceImmutableKey: run.immutablePdfKey, provenance: run.provenance });
  if (!range) {
    return rangeFailure(run, "OCR_PERSISTED_RESULT_INVALID", "stored OCR page range does not match the sanitized source", 2);
  }
  if (run.env.FOUNDATION_OCR_CONFLICT_V3_REQUIRED === "true" && range.resultSchemaVersion !== OCR_RESULT_SCHEMA_V3) {
    throw new OcrEvidenceRetryableError("stored v2 OCR page range lacks required v3 conflict evidence");
  }
  return range;
}

const agrees = (range: QualifiedPageRange, first?: QualifiedPageRange) => !first
  || (range.pageCount === first.pageCount && range.resultSchemaVersion === first.resultSchemaVersion);

/**
 * The stored answer for the range starting at `start0`, asking the reader only when none is
 * stored. `first` is the document as the first range described it; every range must agree.
 */
async function obtainRange(
  run: RangeRun, start0: number, first?: QualifiedPageRange,
): Promise<QualifiedPageRange | OcrDispatchResult> {
  const key = ocrPageRangeSiblingKey(run.immutablePdfKey, start0, start0 + run.size);
  const stored = await readStoredRange(run, key, start0);
  if (stored !== "missing") {
    return "status" in stored || agrees(stored, first) ? stored
      : rangeFailure(run, "OCR_PERSISTED_RESULT_INVALID", "stored OCR page ranges disagree about the document", 2);
  }
  const pages = `pages from ${start0 + 1}`;
  if (run.readOnly) {
    return rangeFailure(run, "OCR_PERSISTED_RESULT_INVALID", `ocr.json exists but its ${pages} are not stored`, 2);
  }

  const posted = await postToReader(run, "application/json", `${start0}-${start0 + run.size}`);
  if ("failed" in posted) {
    // An answer that did not hold is that answer; a request that never got one is a missing range.
    return ocrFailureKind(posted.failed.reasonCode) === "transport"
      ? rangeFailure(run, "OCR_PAGES_INCOMPLETE", `${pages} were not read (${posted.failed.reasonCode})`, 0, posted.failed.requestId)
      : posted.failed;
  }
  const { requestId } = posted;
  let payload: unknown;
  try {
    payload = await readBoundedOcrJson(posted.response);
  } catch {
    return rangeFailure(run, "OCR_RESPONSE_NOT_JSON", `OCR response for ${pages} is not JSON`, 2, requestId);
  }
  const answer = qualifyOcrPageRange(payload, run.inputSha256, start0, run.size);
  if (!answer || !agrees(answer, first)) {
    return rangeFailure(run, "OCR_RESPONSE_INVALID", `OCR response for ${pages} does not hold the page-range contract`, 2, requestId);
  }
  await assertReaderAnswer(run.env, payload, answer.resultSchemaVersion, run.binding);

  const body = new TextEncoder().encode(JSON.stringify({
    schemaVersion: PAGE_RANGE_SCHEMA,
    status: "ok",
    resultSchemaVersion: answer.resultSchemaVersion,
    inputSha256: run.inputSha256,
    pageCount: answer.pageCount,
    pageRange: { start0: answer.start0, end0: answer.end0 },
    pages: answer.pages,
    regions: answer.regions,
    ...(answer.resultSchemaVersion === OCR_RESULT_SCHEMA_V3 ? { recognitionConflictCount: answer.recognitionConflictCount } : {}),
    sourceImmutableKey: run.immutablePdfKey,
    ...run.provenance,
  }));
  try {
    await run.env.FOUNDATION_QUARANTINE.put(key, body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { stage: "ocr-page-range" },
      onlyIf: { etagDoesNotMatch: "*" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/precondition|already exists|conflict/iu.test(message)) {
      return rangeFailure(run, "OCR_PAGES_INCOMPLETE", `${pages} could not be stored`, 0, requestId);
    }
  }
  // As for ocr.json: the durable winner is the answer, never the candidate just sent.
  const durable = await readStoredRange(run, key, start0);
  return durable === "missing"
    ? rangeFailure(run, "OCR_PAGES_INCOMPLETE", `${pages} are not durable after the write`, 0, requestId)
    : durable;
}

async function dispatchOcrRanges(run: RangeRun): Promise<OcrDispatchResult> {
  const ranges: QualifiedPageRange[] = [];
  for (let start0 = 0; ranges.length === 0 || start0 < ranges[0].pageCount; start0 += run.size) {
    const range = await obtainRange(run, start0, ranges[0]);
    if ("status" in range) return range;
    ranges.push(range);
  }

  const { pageCount, resultSchemaVersion } = ranges[0];
  const regions = ranges.flatMap((range) => range.regions).map((region, order) => ({ ...region, order }));
  if (regions.length === 0) {
    // Read in one request, this document is refused with 422: no page has text. Say the same.
    return rangeFailure(run, "OCR_HTTP_REJECTED", "OCR found no text on any page", 2);
  }
  const assembled: QualifiedOcrResult = {
    schemaVersion: resultSchemaVersion,
    status: "ok",
    text: regions.map((region) => region.text).join("\n").trim(),
    pageCount,
    inputSha256: run.inputSha256,
    regions,
    ...(resultSchemaVersion === OCR_RESULT_SCHEMA_V3 ?
      { recognitionConflictCount: ranges.reduce((sum, range) => sum + range.recognitionConflictCount, 0) } : {}),
  };
  // The whole-document bounds on text, regions, identity and conflicts, checked by the
  // whole-document qualifier on the assembled regions seen as one page. Page membership was
  // checked range by range, so the page count is the only bound range mode does not share.
  const onePage = { ...assembled, pageCount: 1, regions: regions.map((region) => ({ ...region, pageIndex0: 0, pageNumber1: 1,
    ...(region.recognitionConflict ? { recognitionConflict: { ...region.recognitionConflict, pageIndex0: 0 } } : {}) })) };
  if (!qualifyOcrResult(onePage, run.inputSha256)) {
    return rangeFailure(run, "OCR_RESPONSE_INVALID", "assembled OCR exceeds the whole-document bounds", 2);
  }
  const persistedBytes = await persistedOcrBody(assembled, run.immutablePdfKey, run.binding);
  if (persistedBytes.byteLength > MAX_PERSISTED_OCR_BYTES) {
    return rangeFailure(run, "OCR_RESPONSE_INVALID", "assembled OCR exceeds the stored result bound", 2);
  }
  const inspect = (status: "exists" | "written") => inspectAssembledOcr(run, persistedBytes, pageCount, status);
  return run.readOnly ? inspect("exists") : putOcrJsonCreateOnce(run.env, run.ocrKey, persistedBytes, { inputSha256: run.inputSha256 }, inspect);
}

/** The durable ocr.json holds exactly the assembly of its stored ranges, or it is not this document's. */
async function inspectAssembledOcr(
  run: RangeRun, expected: Uint8Array, pageCount: number, status: "exists" | "written",
): Promise<OcrDispatchResult> {
  let bytes: ArrayBuffer;
  try {
    const object = await run.env.FOUNDATION_QUARANTINE.get(run.ocrKey);
    if (!object) throw new Error("missing");
    bytes = await object.arrayBuffer();
  } catch {
    throw new OcrEvidenceRetryableError("persisted OCR cannot be read; retry required");
  }
  const durable = new Uint8Array(bytes);
  if (durable.byteLength !== expected.byteLength || durable.some((byte, index) => byte !== expected[index])) {
    return rangeFailure(run, "OCR_PERSISTED_RESULT_INVALID", "persisted OCR is not the assembly of its page ranges", 2);
  }
  return { status, key: run.ocrKey, inputSha256: run.inputSha256, outputSha256: await sha256DigestHeader(bytes),
    observedPageCount: pageCount, ...run.provenance, computeCredits: 2 };
}
