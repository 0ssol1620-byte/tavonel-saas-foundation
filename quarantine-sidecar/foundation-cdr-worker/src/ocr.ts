import { cdrRequestSignature, hmacSecretIsConfigured, sha256DigestHeader } from "./hmac";
import { ocrSiblingKey } from "./keys";

type OcrR2Bucket = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
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

export type OcrDispatchStatus = "skipped" | "written" | "exists" | "failed";
export type OcrFailureCode =
  | "OCR_SOURCE_MISSING"
  | "OCR_SOURCE_EMPTY"
  | "OCR_TIMEOUT_OR_NETWORK"
  | "OCR_HTTP_REJECTED"
  | "OCR_RESPONSE_NOT_JSON"
  | "OCR_RESPONSE_INVALID"
  | "OCR_RESULT_WRITE_FAILED";

export type OcrDispatchResult = {
  status: OcrDispatchStatus;
  key?: string;
  reason?: string;
  reasonCode?: OcrFailureCode;
  requestId?: string;
  inputSha256?: string;
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
export const OCR_REQUEST_TIMEOUT_MS = 25_000;

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
    return { status: "skipped", reason: "FOUNDATION_OCR_URL is unset" };
  }
  if (isForbiddenOcrUrl(url) || (env.FOUNDATION_R2_BUCKET || "").includes("tavonel-prod")) {
    return { status: "skipped", reason: "OCR URL or bucket is not a Foundation target" };
  }
  if (!looksLikeFoundationOcrUrl(url)) {
    return { status: "skipped", reason: "OCR URL is not a Foundation target" };
  }

  const ocrKey = ocrSiblingKey(immutablePdfKey);
  const pdf = await env.FOUNDATION_QUARANTINE.get(immutablePdfKey);
  if (!pdf) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_SOURCE_MISSING", reason: "immutable PDF is not readable for OCR" };
  }

  const bytes = await pdf.arrayBuffer();
  if (bytes.byteLength < 1) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_SOURCE_EMPTY", reason: "immutable PDF is empty" };
  }

  const inputSha256 = await sha256DigestHeader(bytes);
  const timestamp = now().toISOString();
  const requestId = newRequestId();
  const hmac = (env.TAVONEL_OCR_HMAC || env.TAVONEL_CDR_HMAC || "").trim();
  const headers: Record<string, string> = {
    "x-tavonel-input-sha256": inputSha256,
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
    return { status: "failed", key: ocrKey, reasonCode: "OCR_TIMEOUT_OR_NETWORK", reason: "OCR request timed out or failed", requestId, inputSha256 };
  }
  if (!response.ok) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_HTTP_REJECTED", reason: `OCR returned HTTP ${response.status}`, requestId, inputSha256 };
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_RESPONSE_NOT_JSON", reason: "OCR response is not JSON", requestId, inputSha256 };
  }
  const qualified = qualifyOcrResult(payload, inputSha256);
  if (!qualified) {
    return { status: "failed", key: ocrKey, reasonCode: "OCR_RESPONSE_INVALID", reason: "OCR response contract is invalid", requestId, inputSha256 };
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
      return { status: "exists", key: ocrKey };
    }
    return { status: "failed", key: ocrKey, reasonCode: "OCR_RESULT_WRITE_FAILED", reason: "ocr.json write failed", requestId, inputSha256 };
  }
  return { status: "written", key: ocrKey, requestId, inputSha256 };
}
