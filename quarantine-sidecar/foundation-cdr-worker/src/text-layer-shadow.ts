/**
 * D2 text-layer shadow (PROGRAM-2026-11-04 §4.D D2; docs/adr/ADR-2026-11-02-text-layer-first-cdr.md §5
 * steps 1-5). Off unless FOUNDATION_CDR_TEXT_LAYER_FIRST is "1".
 *
 * After OCR has stored `ocr.json`, the same source goes to the CDR's `/v1/text-layer` with a new
 * request id. The verified answer is kept as `text-layer.json`, and `text-layer-shadow.json`
 * records, per page, how far the layer's characters agree with what OCR read. Nothing reads either
 * object to build a World: OCR still reads every page, and no text from the layer is served
 * (`servedPages` is always 0). The receipt carries counts and digests only, never document text.
 *
 * Every failure is a recorded status, never an exception: the shadow cannot fail, slow-retry or
 * change the OCR path it sits beside.
 *   unusable     the layer is not this document's text: refused by the CDR (garbled, encrypted,
 *                corrupt -- ADR §3.3), or an answer that breaks the contract (digest, schema, pages)
 *   unavailable  no answer to judge: the CDR's flag is off (503), transport, auth, server error,
 *                or this worker could not read its own ocr.json
 */
import { cdrRequestSignature, sha256DigestHeader } from "./hmac";
import { cdrAuthorization } from "./identity";

export const TEXT_LAYER_SHADOW_SCHEMA = "tavonel.text_layer_shadow.v1";
export const TEXT_LAYER_SHADOW_FLAG = "FOUNDATION_CDR_TEXT_LAYER_FIRST";
const CDR_TEXT_LAYER_SCHEMA = "tavonel.cdr_text_layer.v1";
const ADR = "docs/adr/ADR-2026-11-02-text-layer-first-cdr.md";
/** The stored ocr.json bound at stage 0; a layer receipt for the same pages is far smaller. */
const MAX_TEXT_LAYER_BYTES = 24 * 1024 * 1024;
const MAX_OCR_JSON_BYTES = 60 * 1024 * 1024;
const PATHS = new Set([
  "textlayer", "ocr:no-text-layer", "ocr:geometry-unsupported", "ocr:hidden-text-suspect",
  "ocr:image-content", "ocr:text-layer-refused",
]);
export const SIMILARITY_METRIC = "char_multiset_dice:nfkc+lowercase+no_whitespace";

type Bucket = {
  get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, options: {
    httpMetadata: { contentType: string }; customMetadata: { stage: string }; onlyIf: { etagDoesNotMatch: string };
  }): Promise<unknown>;
};

export type TextLayerShadowEnv = {
  FOUNDATION_QUARANTINE: Bucket;
  TAVONEL_CDR_URL: string;
  TAVONEL_CDR_HMAC?: string;
  FOUNDATION_CDR_IDENTITY_HMAC?: string;
  FOUNDATION_CDR_TEXT_LAYER_FIRST?: string;
};

export type ShadowPage = {
  pageNumber1: number;
  path: string;
  layerChars: number | null;
  ocrChars: number;
  /** Character-multiset agreement on `textlayer` pages; null where the layer gave no text. */
  charDice: number | null;
};

export type TextLayerShadowReceipt = {
  schemaVersion: typeof TEXT_LAYER_SHADOW_SCHEMA;
  adr: string;
  status: "compared" | "unusable" | "unavailable";
  reason: string | null;
  inputSha256: string;
  ocrJsonSha256: string | null;
  textLayerSha256: string | null;
  servedPages: 0;
  metric: typeof SIMILARITY_METRIC;
  pages: ShadowPage[];
  summary: {
    pages: number;
    textlayerPages: number;
    comparedPages: number;
    layerChars: number;
    ocrChars: number;
    matchedChars: number;
    /** 2 x matched / (layer + OCR) over compared pages; null with no compared page. */
    microDice: number | null;
  };
};

/** "1" on; unset or "0" off; anything else off and said so, because a shadow must never block a read. */
export function textLayerShadowMode(env: Pick<TextLayerShadowEnv, "FOUNDATION_CDR_TEXT_LAYER_FIRST">): "on" | "off" | "misconfigured" {
  const raw = (env.FOUNDATION_CDR_TEXT_LAYER_FIRST ?? "").trim();
  if (raw === "1") return "on";
  return raw === "" || raw === "0" ? "off" : "misconfigured";
}

function normalized(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const char of text.normalize("NFKC").toLowerCase().replace(/\s+/gu, "")) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return counts;
}

/**
 * Agreement of two readings of one page, by character counts after NFKC, lower case and no
 * whitespace: 2 x shared characters / (both totals).
 *
 * ponytail: a bag of characters ignores order, so two pages with the same letters in another order
 * agree fully. It is O(n) where an edit distance on a 200,000-character page is not affordable in a
 * worker; move to a banded edit distance once per-page CPU in the shadow window is measured.
 */
export function charAgreement(layer: string, ocr: string): { layerChars: number; ocrChars: number; matched: number; dice: number | null } {
  const a = normalized(layer);
  const b = normalized(ocr);
  let layerChars = 0;
  let ocrChars = 0;
  let matched = 0;
  for (const count of a.values()) layerChars += count;
  for (const [char, count] of b) {
    ocrChars += count;
    matched += Math.min(count, a.get(char) ?? 0);
  }
  const total = layerChars + ocrChars;
  return { layerChars, ocrChars, matched, dice: total === 0 ? null : (2 * matched) / total };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Our own short service strings, held to a shape a log line and a receipt can carry. */
const boundedReason = (value: unknown) =>
  typeof value === "string" ? value.replace(/[^\w .:/()-]/g, "").slice(0, 160) : "unspecified";

/** OCR text per page from the stored ocr.json, in reading order. */
function ocrPages(payload: unknown): string[] | null {
  if (!isRecord(payload) || !Number.isInteger(payload.pageCount) || !Array.isArray(payload.regions)) return null;
  const pageCount = payload.pageCount as number;
  if (pageCount < 1 || pageCount > 500) return null;
  const pages: Array<Array<{ order: number; text: string }>> = Array.from({ length: pageCount }, () => []);
  for (const region of payload.regions) {
    if (!isRecord(region) || !Number.isInteger(region.pageIndex0) || typeof region.text !== "string") return null;
    const page = pages[region.pageIndex0 as number];
    if (!page) return null;
    page.push({ order: Number(region.order) || 0, text: region.text });
  }
  return pages.map((regions) => regions.sort((left, right) => left.order - right.order).map((region) => region.text).join("\n"));
}

export function textLayerSiblingKey(immutablePdfKey: string, name: "text-layer.json" | "text-layer-shadow.json"): string {
  if (!immutablePdfKey.endsWith("/sanitized.pdf")) throw new Error("immutable PDF key is not a sanitized.pdf object");
  return `${immutablePdfKey.slice(0, -"/sanitized.pdf".length)}/${name}`;
}

export function textLayerUrl(disarmUrl: string): string | null {
  return disarmUrl.endsWith("/v1/disarm") ? `${disarmUrl.slice(0, -"/v1/disarm".length)}/v1/text-layer` : null;
}

export type TextLayerShadowInput = {
  env: TextLayerShadowEnv;
  immutablePdfKey: string;
  ocrKey: string;
  source: { bytes: ArrayBuffer; filename: string; contentType: string };
  /** The authenticated digest of the original source, as /v1/disarm received it. */
  inputSha256: string;
  fetcher: typeof fetch;
  now: () => Date;
  newRequestId: () => string;
};

/**
 * Runs the shadow when the flag is on and no receipt exists yet. Returns the receipt it stored (or
 * found), or null when it did not run. Never throws.
 */
export async function runTextLayerShadow(input: TextLayerShadowInput): Promise<TextLayerShadowReceipt | null> {
  const mode = textLayerShadowMode(input.env);
  if (mode !== "on") {
    if (mode === "misconfigured") log({ status: "skipped", reason: `${TEXT_LAYER_SHADOW_FLAG} is not 0 or 1` });
    return null;
  }
  try {
    const receiptKey = textLayerSiblingKey(input.immutablePdfKey, "text-layer-shadow.json");
    const existing = await input.env.FOUNDATION_QUARANTINE.get(receiptKey);
    if (existing) return JSON.parse(new TextDecoder().decode(await existing.arrayBuffer())) as TextLayerShadowReceipt;
    const receipt = await compare(input);
    await input.env.FOUNDATION_QUARANTINE.put(receiptKey, new TextEncoder().encode(JSON.stringify(receipt)), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { stage: "text-layer-shadow" },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    log({ status: receipt.status, reason: receipt.reason, ...receipt.summary });
    return receipt;
  } catch {
    log({ status: "error", reason: "shadow failed before a receipt was stored" });
    return null;
  }
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: "text_layer_shadow", ...fields }));
}

async function compare(input: TextLayerShadowInput): Promise<TextLayerShadowReceipt> {
  const base = (status: TextLayerShadowReceipt["status"], reason: string | null, extra: Partial<TextLayerShadowReceipt> = {}): TextLayerShadowReceipt => ({
    schemaVersion: TEXT_LAYER_SHADOW_SCHEMA, adr: ADR, status, reason, inputSha256: input.inputSha256,
    ocrJsonSha256: null, textLayerSha256: null, servedPages: 0, metric: SIMILARITY_METRIC, pages: [],
    summary: { pages: 0, textlayerPages: 0, comparedPages: 0, layerChars: 0, ocrChars: 0, matchedChars: 0, microDice: null },
    ...extra,
  });

  const ocrObject = await input.env.FOUNDATION_QUARANTINE.get(input.ocrKey).catch(() => null);
  if (!ocrObject || ocrObject.size < 1 || ocrObject.size > MAX_OCR_JSON_BYTES) return base("unavailable", "ocr_json_unreadable");
  const ocrBytes = await ocrObject.arrayBuffer();
  let ocrText: string[] | null = null;
  try { ocrText = ocrPages(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(ocrBytes))); } catch { /* below */ }
  if (!ocrText) return base("unavailable", "ocr_json_unreadable");
  const ocrJsonSha256 = await sha256DigestHeader(ocrBytes);

  const url = textLayerUrl(input.env.TAVONEL_CDR_URL);
  if (!url || !input.env.TAVONEL_CDR_HMAC) return base("unavailable", "cdr_text_layer_not_configured", { ocrJsonSha256 });

  let response: Response;
  try {
    const timestamp = input.now().toISOString();
    const requestId = input.newRequestId();
    const signature = await cdrRequestSignature(input.env.TAVONEL_CDR_HMAC, timestamp, requestId, input.inputSha256);
    const authorization = await cdrAuthorization(url, input.env.FOUNDATION_CDR_IDENTITY_HMAC, input.fetcher);
    const form = new FormData();
    form.append("source", new Blob([input.source.bytes], { type: input.source.contentType }), input.source.filename);
    response = await input.fetcher(url, {
      method: "POST",
      headers: {
        ...(authorization ? { authorization } : {}),
        "x-tavonel-input-sha256": input.inputSha256,
        "x-tavonel-cdr-timestamp": timestamp,
        "x-tavonel-cdr-request-id": requestId,
        "x-tavonel-cdr-signature": signature,
      },
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return base("unavailable", "cdr_text_layer_transport", { ocrJsonSha256 });
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    // 4xx other than auth is the CDR refusing this document (an encrypted PDF is a 422): the layer
    // is unusable for it. 503 is the CDR's own flag off; auth and 5xx say nothing about the document.
    const documentRefusal = response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403;
    return base(documentRefusal ? "unusable" : "unavailable",
      response.status === 503 ? "cdr_text_layer_disabled" : `cdr_text_layer_http_${response.status}`, { ocrJsonSha256 });
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_TEXT_LAYER_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return base("unusable", "text_layer_too_large", { ocrJsonSha256 });
  }
  const body = await response.arrayBuffer().catch(() => null);
  if (!body) return base("unavailable", "cdr_text_layer_transport", { ocrJsonSha256 });
  if (body.byteLength > MAX_TEXT_LAYER_BYTES) return base("unusable", "text_layer_too_large", { ocrJsonSha256 });
  const textLayerSha256 = await sha256DigestHeader(body);
  if (response.headers.get("x-tavonel-input-sha256") !== input.inputSha256
    || response.headers.get("x-tavonel-text-layer-sha256") !== textLayerSha256) {
    return base("unusable", "text_layer_digest_mismatch", { ocrJsonSha256 });
  }
  let layer: unknown = null;
  try { layer = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); } catch { /* below */ }
  if (!isRecord(layer) || layer.schemaVersion !== CDR_TEXT_LAYER_SCHEMA || layer.inputSha256 !== input.inputSha256
    || !Array.isArray(layer.pages)) {
    return base("unusable", "text_layer_contract_invalid", { ocrJsonSha256, textLayerSha256 });
  }
  if (layer.status === "refused") {
    return base("unusable", `layer_refused: ${boundedReason(layer.reason)}`, { ocrJsonSha256, textLayerSha256 });
  }
  if (layer.status !== "extracted" || layer.pages.length !== ocrText.length) {
    return base("unusable", layer.status !== "extracted" ? "text_layer_contract_invalid" : "text_layer_page_count_mismatch",
      { ocrJsonSha256, textLayerSha256 });
  }

  const pages: ShadowPage[] = [];
  const summary = { ...base("compared", null).summary, pages: ocrText.length };
  for (const [index, page] of (layer.pages as unknown[]).entries()) {
    if (!isRecord(page) || page.pageNumber1 !== index + 1 || typeof page.path !== "string" || !PATHS.has(page.path)) {
      return base("unusable", "text_layer_contract_invalid", { ocrJsonSha256, textLayerSha256 });
    }
    const ocr = ocrText[index];
    if (page.path !== "textlayer" || typeof page.text !== "string") {
      pages.push({ pageNumber1: index + 1, path: page.path, layerChars: null, ocrChars: charAgreement("", ocr).ocrChars, charDice: null });
      continue;
    }
    const agreement = charAgreement(page.text, ocr);
    summary.textlayerPages += 1;
    if (agreement.dice !== null) {
      summary.comparedPages += 1;
      summary.layerChars += agreement.layerChars;
      summary.ocrChars += agreement.ocrChars;
      summary.matchedChars += agreement.matched;
    }
    pages.push({ pageNumber1: index + 1, path: page.path, layerChars: agreement.layerChars, ocrChars: agreement.ocrChars, charDice: agreement.dice });
  }
  const total = summary.layerChars + summary.ocrChars;
  summary.microDice = summary.comparedPages > 0 && total > 0 ? (2 * summary.matchedChars) / total : null;

  await input.env.FOUNDATION_QUARANTINE.put(textLayerSiblingKey(input.immutablePdfKey, "text-layer.json"), new Uint8Array(body), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { stage: "text-layer" },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  return base("compared", null, { ocrJsonSha256, textLayerSha256, pages, summary });
}
