import { cdrRequestSignature, hmacSecretIsConfigured, sha256DigestHeader } from "./hmac";
import { ocrProgressSiblingKey, ocrSiblingKey } from "./keys";

type OcrR2Bucket = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
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
  | "OCR_RESULT_WRITE_FAILED";

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
  // The reader answered, or the source itself is the problem. A person decides what happens next.
  OCR_HTTP_REJECTED: { kind: "semantic", retryCategory: "unsupported_file" },
  OCR_SOURCE_EMPTY: { kind: "semantic", retryCategory: "unsupported_file" },
  OCR_RESPONSE_NOT_JSON: { kind: "semantic", retryCategory: "invalid_output" },
  OCR_RESPONSE_INVALID: { kind: "semantic", retryCategory: "invalid_output" },
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
  computeCredits: 0 | 2;
};

export type OcrDispatchEnv = {
  FOUNDATION_QUARANTINE: OcrR2Bucket;
  FOUNDATION_OCR_URL?: string;
  TAVONEL_OCR_HMAC?: string;
  TAVONEL_CDR_HMAC?: string;
  RUNPOD_API_KEY?: string;
  FOUNDATION_R2_BUCKET: string;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PROD_MARKERS = ["tavonel-pdf-cdr", "tavonel-prod", "tavonel-quarantine-sidecar"];
const OCR_RESULT_SCHEMA = "tavonel.ocr_result.v2";
const AUTHORITY_CLASSES = new Set(["unknown", "informal", "official", "contractual"]);
// RunPod cold starts have been observed at roughly 30 seconds. Keep the request below the
// approved 90-second execution ceiling while leaving enough room for startup and one-page OCR.
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
};

type QualifiedOcrResult = {
  schemaVersion: typeof OCR_RESULT_SCHEMA;
  status: "ok";
  text: string;
  pageCount: number;
  inputSha256: string;
  regions: OcrRegion[];
};

export function qualifyOcrResult(payload: unknown, expectedInputSha256: string): QualifiedOcrResult | null {
  if (!payload || typeof payload !== "object") return null;
  const result = payload as Partial<QualifiedOcrResult>;
  if (
    result.schemaVersion !== OCR_RESULT_SCHEMA ||
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

  const regionIds = new Set<string>();
  const orders = new Set<number>();
  for (const region of result.regions) {
    if (!region || typeof region !== "object") return null;
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
    regionIds.add(region.regionId);
    orders.add(region.order);
  }
  if (result.regions.some((_region, index) => !orders.has(index))) return null;
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

  const ocrKey = ocrSiblingKey(immutablePdfKey);
  const existingOcr = await env.FOUNDATION_QUARANTINE.get(ocrKey);
  if (existingOcr) return { status: "exists", key: ocrKey, computeCredits: 2 };
  const pdf = await env.FOUNDATION_QUARANTINE.get(immutablePdfKey);
  if (!pdf) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_SOURCE_MISSING", reason: "immutable PDF is not readable for OCR", computeCredits: 0 };
  }

  const bytes = await pdf.arrayBuffer();
  if (bytes.byteLength < 1) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_SOURCE_EMPTY", reason: "immutable PDF is empty", computeCredits: 0 };
  }

  const inputSha256 = await sha256DigestHeader(bytes);
  const timestamp = now().toISOString();
  const requestId = newRequestId();
  const hmac = (env.TAVONEL_OCR_HMAC || env.TAVONEL_CDR_HMAC || "").trim();
  const headers: Record<string, string> = {
    "x-tavonel-input-sha256": inputSha256,
    // Ask for the per-page view. A worker that does not implement it ignores this and answers
    // with JSON exactly as before, which is why there is no capability check here.
    accept: `${NDJSON_MEDIA_TYPE}, application/json`,
  };
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
  form.append("source", new Blob([bytes], { type: "application/pdf" }), "sanitized.pdf");

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_TIMEOUT_OR_NETWORK", reason: "OCR request timed out or failed", requestId, inputSha256, computeCredits: 0 };
  }
  if (!response.ok) {
    // 5xx and 429 are the endpoint being unavailable, not an answer about this document.
    const unavailable = response.status >= 500 || response.status === 429;
    return unavailable
      ? { status: "failed", key: ocrKey, reasonCode: "OCR_HTTP_UNAVAILABLE", reason: `OCR returned HTTP ${response.status}`, requestId, inputSha256, computeCredits: 0 }
      : { status: "failed", key: ocrKey, reasonCode: "OCR_HTTP_REJECTED", reason: `OCR returned HTTP ${response.status}`, requestId, inputSha256, computeCredits: 2 };
  }

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
      payload = (await response.json()) as typeof payload;
    } catch {
      return { status: "failed", key: ocrKey, reasonCode: "OCR_RESPONSE_NOT_JSON", reason: "OCR response is not JSON", requestId, inputSha256, computeCredits: 2 };
    }
  }
  const qualified = qualifyOcrResult(payload, inputSha256);
  if (!qualified) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_RESPONSE_INVALID", reason: "OCR response contract is invalid", requestId, inputSha256, computeCredits: 2 };
  }

  const body = JSON.stringify({
    schemaVersion: qualified.schemaVersion,
    status: qualified.status,
    text: qualified.text,
    pageCount: qualified.pageCount,
    regions: qualified.regions,
    sourceImmutableKey: immutablePdfKey,
    inputSha256: qualified.inputSha256,
  });

  try {
    await env.FOUNDATION_QUARANTINE.put(ocrKey, new TextEncoder().encode(body), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { stage: "ocr-json" },
      onlyIf: { etagDoesNotMatch: "*" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/precondition|already exists|conflict/iu.test(message)) {
      return { status: "exists", key: ocrKey, computeCredits: 2 };
    }
    return { status: "failed", key: ocrKey, reasonCode: "OCR_RESULT_WRITE_FAILED", reason: "ocr.json write failed", requestId, inputSha256, computeCredits: 0 };
  }
  return { status: "written", key: ocrKey, requestId, inputSha256, computeCredits: 2 };
}
