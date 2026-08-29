import { RetryableError } from "./errors";
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

export type OcrDispatchResult = {
  status: OcrDispatchStatus;
  key?: string;
  reason?: string;
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
const PROD_MARKERS = ["tavonel-pdf-cdr", "tavonel-prod", "tavonel-quarantine-sidecar"];

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
    return { status: "failed", key: ocrKey, reason: "immutable PDF is not readable for OCR" };
  }

  const bytes = await pdf.arrayBuffer();
  if (bytes.byteLength < 1) {
    return { status: "failed", key: ocrKey, reason: "immutable PDF is empty" };
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
    response = await fetcher(url, { method: "POST", headers, body: form });
  } catch {
    return { status: "failed", key: ocrKey, reason: "OCR request failed" };
  }
  if (!response.ok) {
    return { status: "failed", key: ocrKey, reason: `OCR returned HTTP ${response.status}` };
  }

  let payload: {
    status?: unknown;
    text?: unknown;
    pageCount?: unknown;
    inputSha256?: unknown;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { status: "failed", key: ocrKey, reason: "OCR response is not JSON" };
  }
  if (payload.status !== "ok" || typeof payload.text !== "string" || typeof payload.pageCount !== "number") {
    return { status: "failed", key: ocrKey, reason: "OCR response is missing required fields" };
  }

  const body = JSON.stringify({
    status: payload.status,
    text: payload.text,
    pageCount: payload.pageCount,
    sourceImmutableKey: immutablePdfKey,
    inputSha256: typeof payload.inputSha256 === "string" ? payload.inputSha256 : inputSha256,
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
    throw new RetryableError("ocr.json write failed");
  }
  return { status: "written", key: ocrKey };
}
