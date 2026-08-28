import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ocrSiblingKey } from "./keys";
import {
  dispatchOcrAfterSanitize,
  isForbiddenOcrUrl,
  looksLikeFoundationOcrUrl,
  shouldDispatchOcr,
  type OcrDispatchEnv,
} from "./ocr";

const FOUNDATION_OCR = "https://tavonel-foundation-ocr.example/v1/ocr";
const IMMUTABLE = "immutable/ws_pilot/ws_pilot/doc_1/abcdabcdabcdabcdabcdabcdabcdabcd/sanitized.pdf";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 sanitized-fixture");

class FakeR2 {
  readonly objects = new Map<string, Uint8Array>();
  readonly puts: string[] = [];

  constructor(initial?: Record<string, Uint8Array>) {
    for (const [key, bytes] of Object.entries(initial || {})) {
      this.objects.set(key, bytes);
    }
  }

  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }

  async put(key: string, value: ArrayBuffer | Uint8Array) {
    this.puts.push(key);
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    this.objects.set(key, bytes);
    return { etag: "new" };
  }
}

function envFor(r2: FakeR2, overrides: Partial<OcrDispatchEnv> = {}): OcrDispatchEnv {
  return {
    FOUNDATION_QUARANTINE: r2,
    FOUNDATION_R2_BUCKET: "tavonel-saas-foundation-quarantine",
    FOUNDATION_OCR_URL: "",
    ...overrides,
  };
}

describe("OCR sibling key shape", () => {
  it("replaces sanitized.pdf with ocr.json under the same immutable prefix", () => {
    assert.equal(
      ocrSiblingKey(IMMUTABLE),
      "immutable/ws_pilot/ws_pilot/doc_1/abcdabcdabcdabcdabcdabcdabcdabcd/ocr.json",
    );
  });
});

describe("Foundation OCR URL guards", () => {
  it("refuses production CDR and prod buckets in the URL", () => {
    assert.equal(isForbiddenOcrUrl("https://tavonel-pdf-cdr.example.run.app/v1/ocr"), true);
    assert.equal(looksLikeFoundationOcrUrl("https://tavonel-pdf-cdr.example.run.app/v1/ocr"), false);
    assert.equal(looksLikeFoundationOcrUrl("https://tavonel-prod-quarantine.example/v1/ocr"), false);
    assert.equal(looksLikeFoundationOcrUrl(FOUNDATION_OCR), true);
    assert.equal(shouldDispatchOcr(""), false);
    assert.equal(shouldDispatchOcr(undefined), false);
  });
});

describe("dispatchOcrAfterSanitize", () => {
  it("skips OCR when FOUNDATION_OCR_URL is unset and does not PUT ocr.json", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    let fetched = 0;
    const result = await dispatchOcrAfterSanitize(envFor(r2), IMMUTABLE, async () => {
      fetched += 1;
      return new Response("no");
    });
    assert.equal(result.status, "skipped");
    assert.equal(fetched, 0);
    assert.equal(r2.puts.length, 0);
    assert.equal(r2.objects.has(ocrSiblingKey(IMMUTABLE)), false);
  });

  it("refuses a production OCR URL without fetching it", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    let fetched = 0;
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: "https://tavonel-pdf-cdr.example/v1/ocr" }),
      IMMUTABLE,
      async () => {
        fetched += 1;
        return new Response("no");
      },
    );
    assert.equal(result.status, "skipped");
    assert.equal(fetched, 0);
  });

  it("POSTs the immutable PDF and writes sibling ocr.json create-once", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, {
        FOUNDATION_OCR_URL: FOUNDATION_OCR,
        TAVONEL_OCR_HMAC: "foundation-ocr-hmac-fixture-secret-ok",
      }),
      IMMUTABLE,
      async (input, init) => {
        assert.equal(String(input), FOUNDATION_OCR);
        assert.equal(init?.method, "POST");
        const body = init?.body;
        assert.ok(body instanceof FormData);
        assert.ok(body.get("source"));
        return new Response(
          JSON.stringify({
            status: "ok",
            text: "TAVONEL OCR",
            pageCount: 1,
            inputSha256: "sha256:abc",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const expectedKey = ocrSiblingKey(IMMUTABLE);
    assert.equal(result.status, "written");
    assert.equal(result.key, expectedKey);
    assert.equal(r2.puts[0], expectedKey);
    const stored = JSON.parse(new TextDecoder().decode(r2.objects.get(expectedKey)));
    assert.equal(stored.status, "ok");
    assert.equal(stored.text, "TAVONEL OCR");
    assert.equal(stored.pageCount, 1);
    assert.equal(stored.sourceImmutableKey, IMMUTABLE);
    assert.equal(typeof stored.inputSha256, "string");
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "pdf"), false);
  });
});
