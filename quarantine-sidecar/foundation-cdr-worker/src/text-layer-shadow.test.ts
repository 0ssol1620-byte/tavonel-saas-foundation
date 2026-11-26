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

describe("table-reader shadow store (WO-E-TBL-P2, ADR-2026-11-23 §7 step 2)", () => {
  const REVISION = `sha256:${"c".repeat(64)}`;
  const BINDING = `sha256:${"d".repeat(64)}`;
  const TABLE_KEY = textLayerSiblingKey(IMMUTABLE, "table-read.json");
  const cell = (row: number, column: number, text: string, bbox1000: number[]) => ({
    cellId: `p1-t1-r${row}-c${column}`, rowIndex0: row, columnIndex0: column, rowSpan: 1, columnSpan: 1, text, bbox1000, confirmedBy: [],
  });
  const placedPage = () => ({
    pageNumber1: 1, path: "textlayer", read: true,
    tables: [{ tableId: "p1-t1", state: "placed", signal: null }, { tableId: null, state: "not_placed", signal: "column_split_ambiguous" }],
    document: {
      schemaVersion: "tavonel.table_read.v1", inputSha256: INPUT, readerRevision: REVISION, readerBindingSha256: BINDING,
      pageIndex0: 0, pageNumber1: 1, pageStatus: "read", formulas: [],
      refusals: [{ bbox1000: null, reasonCode: "TABLE_GRID_INVALID" }],
      tables: [{
        tableId: "p1-t1", bbox1000: [100, 100, 600, 140], rowCount: 2, columnCount: 2, headerRowCount: 0, qualityFlags: [],
        cells: [cell(0, 0, "Total net sales", [100, 100, 300, 115]), cell(0, 1, "391,035", [500, 100, 600, 115]),
          cell(1, 0, "Cost of sales", [100, 125, 300, 140]), cell(1, 1, "210,352", [500, 125, 600, 140])],
      }],
    },
  });
  const section = (pages: unknown[], extra: Record<string, unknown> = {}) => ({
    schemaVersion: "tavonel.cdr_table_read.v1", mode: "shadow", status: "read", reason: null, servedPages: 0,
    reader: { revision: REVISION, bindingSha256: BINDING, pypdfium2: "5.13.0", constants: {}, calibrated: false }, pages, ...extra,
  });
  const notRead = { pageNumber1: 2, path: "ocr:image-content", read: false, tables: [], document: null };
  const layerPages = [
    { pageNumber1: 1, path: "textlayer", text: PAGE_ONE }, { pageNumber1: 2, path: "ocr:image-content" },
  ];
  const withTables = (tableRead: unknown) => ({ ...extracted(layerPages), tableRead });

  it("stores a qualified section create-once as table-read.json, bound to this object and this layer", async () => {
    const { bucket, env } = setup();
    const receipt = await run(env, async () => layerResponse(withTables(section([placedPage(), notRead]))));
    assert.equal(receipt?.status, "compared");
    const stored = JSON.parse(new TextDecoder().decode(bucket.objects.get(TABLE_KEY)));
    assert.equal(stored.sourceImmutableKey, IMMUTABLE);
    assert.equal(stored.inputSha256, INPUT);
    assert.equal(stored.textLayerSha256, receipt?.textLayerSha256);
    assert.equal(stored.servedPages, 0);
    assert.equal(stored.pages[0].document.sourceImmutableKey, IMMUTABLE, "each page is a complete table_read.v1 document");
    assert.equal(stored.pages[1].document, null);
    // Create-once: a second write to the same key does not replace it.
    assert.equal(await bucket.put(TABLE_KEY, new Uint8Array([1]), { onlyIf: { etagDoesNotMatch: "*" } }), null);
  });

  it("stores nothing when the CDR's table reader is off (no section)", async () => {
    const { bucket, env } = setup();
    const receipt = await run(env, async () => layerResponse(extracted(layerPages)));
    assert.equal(receipt?.status, "compared");
    assert.equal(bucket.objects.has(TABLE_KEY), false);
    assert.equal(bucket.puts.includes(TABLE_KEY), false);
  });

  it("stores the CDR's operational failure as what it is", async () => {
    const { bucket, env } = setup();
    await run(env, async () => layerResponse(withTables(section([], { status: "unavailable", reason: "pdfium_error" }))));
    const stored = JSON.parse(new TextDecoder().decode(bucket.objects.get(TABLE_KEY)));
    assert.deepEqual([stored.status, stored.reason, stored.pages], ["unavailable", "pdfium_error", []]);
  });

  const refused: Array<[string, () => unknown, string]> = [
    ["a page read that the layer did not class textlayer", () => section([placedPage(), { ...placedPage(), pageNumber1: 2, path: "ocr:image-content" }]), "table_read_page_2_invalid"],
    ["a document on a page that is not textlayer", () => section([placedPage(), { ...notRead, document: placedPage().document }]), "table_read_page_2_not_textlayer"],
    ["a page count that differs from the layer", () => section([placedPage()]), "table_read_contract_invalid"],
    ["another reader's binding", () => {
      const page = placedPage();
      return section([{ ...page, document: { ...page.document, readerRevision: `sha256:${"e".repeat(64)}` } }, notRead]);
    }, "table_read_page_1_TABLE_BINDING_MISMATCH"],
    ["another input's document", () => {
      const page = placedPage();
      return section([{ ...page, document: { ...page.document, inputSha256: `sha256:${"b".repeat(64)}` } }, notRead]);
    }, "table_read_page_1_TABLE_BINDING_MISMATCH"],
    ["a cell outside its table", () => {
      const page = placedPage();
      const table = { ...page.document.tables[0], cells: [cell(0, 0, "x", [0, 0, 50, 50])] };
      return section([{ ...page, document: { ...page.document, tables: [table] } }, notRead]);
    }, "table_read_page_1_receipt_mismatch"],
    ["a receipt entry missing for a refusal", () => {
      const page = placedPage();
      return section([{ ...page, tables: page.tables.slice(0, 1) }, notRead]);
    }, "table_read_page_1_receipt_mismatch"],
    ["an unknown mode", () => section([placedPage(), notRead], { mode: "on" }), "table_read_contract_invalid"],
    ["served pages", () => section([placedPage(), notRead], { servedPages: 1 }), "table_read_contract_invalid"],
    ["an unknown status", () => section([placedPage(), notRead], { status: "partial" }), "table_read_contract_invalid"],
  ];
  for (const [name, build, reason] of refused) {
    it(`does not store ${name}, and keeps the text-layer receipt`, async () => {
      const { bucket, env } = setup();
      const logs: string[] = [];
      const original = console.log;
      console.log = (line: string) => { logs.push(line); };
      try {
        const receipt = await run(env, async () => layerResponse(withTables(build())));
        assert.equal(receipt?.status, "compared");
      } finally {
        console.log = original;
      }
      assert.equal(bucket.objects.has(TABLE_KEY), false);
      assert.ok(bucket.objects.has(textLayerSiblingKey(IMMUTABLE, "text-layer.json")));
      assert.ok(logs.some((line) => line.includes(`"reason":"${reason}"`)), logs.join("\n"));
    });
  }
});
