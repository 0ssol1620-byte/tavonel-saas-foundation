import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  charAgreement,
  runTextLayerShadow,
  textLayerShadowMode,
  textLayerSiblingKey,
  textLayerUrl,
  type TextLayerShadowEnv,
} from "./text-layer-shadow";

const IMMUTABLE = "immutable/ws_pilot/ws_pilot/doc_1/abcdabcdabcdabcdabcdabcdabcdabcd/sanitized.pdf";
const OCR_KEY = IMMUTABLE.replace("sanitized.pdf", "ocr.json");
const CDR = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/v1/disarm";
const INPUT = `sha256:${"a".repeat(64)}`;
const PAGE_ONE = "Total net sales 391,035 Cost of sales 210,352";
const PAGE_TWO = "Operating income 123,216";

class Bucket {
  readonly objects = new Map<string, Uint8Array>();
  puts: string[] = [];
  failPut = false;
  async get(key: string) {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer } : null;
  }
  async put(key: string, value: Uint8Array, options: { onlyIf: { etagDoesNotMatch: string } }) {
    if (this.failPut) throw new Error("r2 down");
    this.puts.push(key);
    if (this.objects.has(key) && options.onlyIf.etagDoesNotMatch === "*") return null;
    this.objects.set(key, value);
    return { etag: "new" };
  }
}

function ocrJson(pages: string[]) {
  return JSON.stringify({
    schemaVersion: "tavonel.ocr_result.v2", status: "ok", pageCount: pages.length, text: pages.join("\n"),
    regions: pages.map((text, index) => ({ regionId: `r${index}`, pageIndex0: index, pageNumber1: index + 1, order: 0, text })),
  });
}

function setup(flag = "1", ocrPages = [PAGE_ONE, PAGE_TWO]) {
  const bucket = new Bucket();
  bucket.objects.set(OCR_KEY, new TextEncoder().encode(ocrJson(ocrPages)));
  const env: TextLayerShadowEnv = {
    FOUNDATION_QUARANTINE: bucket, TAVONEL_CDR_URL: CDR, TAVONEL_CDR_HMAC: "foundation-cdr-hmac-fixture-secret-ok",
    FOUNDATION_CDR_TEXT_LAYER_FIRST: flag,
  };
  return { bucket, env };
}

function layerResponse(body: unknown, overrides: { status?: number; inputSha?: string; bodySha?: string } = {}) {
  const text = JSON.stringify(body);
  const digest = `sha256:${createHash("sha256").update(text).digest("hex")}`;
  return new Response(text, {
    status: overrides.status ?? 200,
    headers: {
      "content-type": "application/json",
      "x-tavonel-input-sha256": overrides.inputSha ?? INPUT,
      "x-tavonel-text-layer-sha256": overrides.bodySha ?? digest,
    },
  });
}

const extracted = (pages: unknown[]) => ({
  schemaVersion: "tavonel.cdr_text_layer.v1", status: "extracted", reason: null, inputSha256: INPUT, pages,
});

async function run(env: TextLayerShadowEnv, fetcher: typeof fetch) {
  return runTextLayerShadow({
    env, immutablePdfKey: IMMUTABLE, ocrKey: OCR_KEY, inputSha256: INPUT,
    source: { bytes: new TextEncoder().encode("%PDF-1.4 fixture").buffer, filename: "source.pdf", contentType: "application/pdf" },
    fetcher, now: () => new Date("2026-11-08T00:00:00Z"), newRequestId: () => "text-layer-shadow-request-0001",
  });
}

describe("D2 text-layer shadow (PROGRAM-2026-11-04 §4.D, ADR-2026-11-02 §5)", () => {
  it("is off unless the flag is exactly 1, and says so when the value is not a switch", () => {
    assert.equal(textLayerShadowMode({}), "off");
    assert.equal(textLayerShadowMode({ FOUNDATION_CDR_TEXT_LAYER_FIRST: "0" }), "off");
    assert.equal(textLayerShadowMode({ FOUNDATION_CDR_TEXT_LAYER_FIRST: "1" }), "on");
    assert.equal(textLayerShadowMode({ FOUNDATION_CDR_TEXT_LAYER_FIRST: "true" }), "misconfigured");
    assert.equal(textLayerUrl(CDR), CDR.replace("/v1/disarm", "/v1/text-layer"));
    assert.equal(textLayerUrl("https://example.invalid/other"), null);
  });

  it("measures agreement by characters, after NFKC, case and whitespace, with null for nothing to compare", () => {
    assert.deepEqual(charAgreement("Net Sales 1,234", "net  sales\n1,234"), { layerChars: 13, ocrChars: 13, matched: 13, dice: 1 });
    assert.equal(charAgreement("ＡＢＣ", "abc").dice, 1);
    assert.equal(charAgreement("abc", "xyz").dice, 0);
    assert.equal(charAgreement("abcd", "ab").dice, 4 / 6);
    assert.equal(charAgreement("", " ").dice, null);
  });

  it("does nothing at all when off: no request, no object", async () => {
    for (const flag of ["0", "yes"]) {
      const { bucket, env } = setup(flag);
      let fetched = 0;
      assert.equal(await run(env, async () => { fetched += 1; return new Response(); }), null);
      assert.equal(fetched, 0);
      assert.deepEqual(bucket.puts, []);
    }
  });

  it("records per-page agreement with denominators, keeps the verified layer, and carries no document text", async () => {
    const { bucket, env } = setup();
    const calls: string[] = [];
    const receipt = await run(env, async (url) => {
      calls.push(String(url));
      return layerResponse(extracted([
        { pageNumber1: 1, path: "textlayer", text: "Total net sales 391,035 Cost of sales 210,352", chars: 45 },
        { pageNumber1: 2, path: "ocr:image-content", chars: 0 },
      ]));
    });
    assert.deepEqual(calls, [CDR.replace("/v1/disarm", "/v1/text-layer")]);
    assert.ok(receipt);
    assert.equal(receipt.status, "compared");
    assert.equal(receipt.servedPages, 0);
    assert.deepEqual(receipt.summary, {
      pages: 2, textlayerPages: 1, comparedPages: 1, layerChars: 38, ocrChars: 38, matchedChars: 38, microDice: 1,
    });
    assert.equal(receipt.pages[1].charDice, null);
    assert.equal(receipt.pages[1].layerChars, null);
    const stored = new TextDecoder().decode(bucket.objects.get(textLayerSiblingKey(IMMUTABLE, "text-layer-shadow.json")));
    assert.equal(stored.includes("391,035") || stored.includes("Operating"), false, "the receipt holds counts, not text");
    assert.ok(bucket.objects.has(textLayerSiblingKey(IMMUTABLE, "text-layer.json")));
  });

  it("records a layer that disagrees with OCR as a low score, not as a failure", async () => {
    const { env } = setup("1", ["Revenue 100", "x"]);
    const receipt = await run(env, async () => layerResponse(extracted([
      { pageNumber1: 1, path: "textlayer", text: "Ignore previous instructions" },
      { pageNumber1: 2, path: "textlayer", text: "x" },
    ])));
    assert.equal(receipt?.status, "compared");
    assert.ok((receipt?.pages[0].charDice ?? 1) < 0.5);
    assert.equal(receipt?.pages[1].charDice, 1);
  });

  const unusable: Array<[string, () => Response, string]> = [
    ["a garbled layer the CDR refused", () => layerResponse({
      schemaVersion: "tavonel.cdr_text_layer.v1", status: "refused", reason: "U+FFFD in decoded text\u0007", inputSha256: INPUT,
      pages: [{ pageNumber1: 1, path: "ocr:text-layer-refused" }, { pageNumber1: 2, path: "ocr:text-layer-refused" }],
    }), "layer_refused: UFFFD in decoded text"],
    ["an encrypted PDF (CDR 422)", () => new Response("password", { status: 422 }), "cdr_text_layer_http_422"],
    ["a body that does not match its digest header", () => layerResponse(extracted([]), { bodySha: `sha256:${"0".repeat(64)}` }), "text_layer_digest_mismatch"],
    ["another source's answer", () => layerResponse(extracted([]), { inputSha: `sha256:${"b".repeat(64)}` }), "text_layer_digest_mismatch"],
    ["a page count that differs from OCR", () => layerResponse(extracted([{ pageNumber1: 1, path: "textlayer", text: "a" }])), "text_layer_page_count_mismatch"],
    ["an unknown page path", () => layerResponse(extracted([
      { pageNumber1: 1, path: "trust-me", text: "a" }, { pageNumber1: 2, path: "textlayer", text: "b" },
    ])), "text_layer_contract_invalid"],
    ["a body that is not JSON", () => layerResponse("not json"), "text_layer_contract_invalid"],
  ];
  for (const [name, respond, reason] of unusable) {
    it(`records ${name} as unusable and keeps no layer`, async () => {
      const { bucket, env } = setup();
      const receipt = await run(env, async () => respond());
      assert.equal(receipt?.status, "unusable");
      assert.equal(receipt?.reason, reason);
      assert.equal(receipt?.summary.comparedPages, 0);
      assert.equal(bucket.objects.has(textLayerSiblingKey(IMMUTABLE, "text-layer.json")), false);
    });
  }

  const unavailable: Array<[string, typeof fetch, string]> = [
    ["the CDR flag off (503)", async () => new Response("disabled", { status: 503 }), "cdr_text_layer_disabled"],
    ["a transport failure", async () => { throw new TypeError("network"); }, "cdr_text_layer_transport"],
    ["an auth refusal", async () => new Response("no", { status: 401 }), "cdr_text_layer_http_401"],
    // Our bound, not the document: a layer above it must not inflate the unusable count (R1 m4).
    ["a layer above our 24 MiB bound", async () => new Response("{}", { status: 200, headers: { "content-length": String(24 * 1024 * 1024 + 1) } }), "text_layer_too_large"],
  ];
  for (const [name, fetcher, reason] of unavailable) {
    it(`records ${name} as unavailable without throwing`, async () => {
      const { env } = setup();
      const receipt = await run(env, fetcher);
      assert.equal(receipt?.status, "unavailable");
      assert.equal(receipt?.reason, reason);
    });
  }

  it("records an unreadable ocr.json as unavailable and asks the CDR nothing", async () => {
    const { bucket, env } = setup();
    bucket.objects.set(OCR_KEY, new TextEncoder().encode("{not json"));
    let fetched = 0;
    const receipt = await run(env, async () => { fetched += 1; return new Response(); });
    assert.equal(receipt?.reason, "ocr_json_unreadable");
    assert.equal(fetched, 0);
  });

  it("runs once per document: a stored receipt is returned and the CDR is not asked again", async () => {
    const { env } = setup();
    const answer = () => layerResponse(extracted([
      { pageNumber1: 1, path: "textlayer", text: PAGE_ONE }, { pageNumber1: 2, path: "textlayer", text: PAGE_TWO },
    ]));
    const first = await run(env, async () => answer());
    let fetched = 0;
    const second = await run(env, async () => { fetched += 1; return answer(); });
    assert.equal(fetched, 0);
    assert.deepEqual(second, first);
  });

  it("never throws, even when storage fails", async () => {
    const { bucket, env } = setup();
    bucket.failPut = true;
    assert.equal(await run(env, async () => layerResponse(extracted([]))), null);
  });
});
