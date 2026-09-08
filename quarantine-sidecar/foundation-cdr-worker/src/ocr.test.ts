import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ocrSiblingKey } from "./keys";
import {
  dispatchOcrAfterSanitize,
  isForbiddenOcrUrl,
  looksLikeFoundationOcrUrl,
  OCR_FAILURE_CATEGORY,
  OCR_REQUEST_TIMEOUT_MS,
  ocrFailureKind,
  qualifyOcrResult,
  shouldDispatchOcr,
  type OcrDispatchEnv,
  type OcrFailureCode,
} from "./ocr";

const FOUNDATION_OCR = "https://tavonel-foundation-ocr.example/v1/ocr";
const IMMUTABLE = "immutable/ws_pilot/ws_pilot/doc_1/abcdabcdabcdabcdabcdabcdabcdabcd/sanitized.pdf";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 sanitized-fixture");

function ocrPayload(inputSha256: string) {
  return {
    schemaVersion: "tavonel.ocr_result.v2",
    status: "ok",
    text: "TAVONEL OCR",
    pageCount: 1,
    inputSha256,
    regions: [{
      regionId: "native-p0001",
      pageIndex0: 0,
      pageNumber1: 1,
      order: 0,
      blockType: "paragraph",
      text: "TAVONEL OCR",
      bbox1000: [100, 100, 900, 200],
      confidence: 1,
      authority: "informal",
    }],
  };
}

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
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
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
  it("allows a cold start while staying below the approved execution ceiling", () => {
    assert.equal(OCR_REQUEST_TIMEOUT_MS, 85_000);
    assert.ok(OCR_REQUEST_TIMEOUT_MS < 90_000);
  });

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
        assert.ok(init?.signal instanceof AbortSignal);
        const body = init?.body;
        assert.ok(body instanceof FormData);
        assert.ok(body.get("source"));
        const inputSha256 = new Headers(init?.headers).get("x-tavonel-input-sha256")!;
        return new Response(
          JSON.stringify(ocrPayload(inputSha256)),
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
    assert.equal(stored.schemaVersion, "tavonel.ocr_result.v2");
    assert.equal(stored.text, "TAVONEL OCR");
    assert.equal(stored.pageCount, 1);
    assert.equal(stored.sourceImmutableKey, IMMUTABLE);
    assert.equal(typeof stored.inputSha256, "string");
    assert.deepEqual(stored.regions[0].bbox1000, [100, 100, 900, 200]);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "pdf"), false);
  });

  it("fails closed on a forged OCR digest and does not write ocr.json", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const payload = ocrPayload(`sha256:${"0".repeat(64)}`);
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async () => Response.json(payload),
    );
    assert.equal(result.status, "failed");
    assert.equal(result.reasonCode, "OCR_RESPONSE_INVALID");
    assert.equal(r2.puts.length, 0);
  });

  it("bounds an unavailable GPU request and returns an operator-review code", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async (_input, init) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(init?.signal?.aborted, true);
        throw new Error("aborted");
      },
      () => new Date("2026-08-29T00:00:00Z"),
      () => "fixture-timeout-request",
      5,
    );
    assert.equal(result.status, "failed");
    assert.equal(result.reasonCode, "OCR_TIMEOUT_OR_NETWORK");
    assert.equal(result.requestId, "fixture-timeout-request");
    assert.equal(r2.puts.length, 0);
  });
});

describe("OCR result contract", () => {
  it("rejects fabricated or degenerate region coordinates", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const valid = ocrPayload(digest);
    assert.ok(qualifyOcrResult(valid, digest));
    assert.equal(qualifyOcrResult({
      ...valid,
      regions: [{ ...valid.regions[0], bbox1000: [100, 100, 100, 200] }],
    }, digest), null);
  });
});

/*
 * The streamed read.
 *
 * The risk the stream introduces is that it becomes a second, weaker way into the same write: a
 * path where a partial or unqualified answer reaches `ocr.json`, or where the progress object --
 * which is mutable and is not evidence -- starts being treated as if it were. These tests hold
 * the boundary: the result still goes through the same qualifier, `ocr.json` is still written
 * create-once, and a stream that never delivers a result writes nothing at all.
 */
describe("dispatchOcrAfterSanitize · streamed reading", () => {
  const PROGRESS = "immutable/ws_pilot/ws_pilot/doc_1/abcdabcdabcdabcdabcdabcdabcdabcd/ocr-progress.json";
  const OCR_JSON = ocrSiblingKey(IMMUTABLE);
  const NL = String.fromCharCode(10);

  function page(pageNumber1: number, pageCount: number, regionCount = 2) {
    return {
      schemaVersion: "tavonel.ocr_progress.v1",
      type: "page",
      pageNumber1,
      pageCount,
      path: "raster",
      regionCount,
      meanConfidence: 0.82,
      boxes: Array.from({ length: regionCount }, (_unused, index) => ({
        bbox1000: [100, 100 + index * 40, 900, 130 + index * 40],
        confidence: 0.8,
        text: `line ${index + 1} on page ${pageNumber1}`,
        regionId: `ocr-p${String(pageNumber1).padStart(4, "0")}-l${String(index + 1).padStart(5, "0")}`,
      })),
    };
  }

  function ndjson(lines: unknown[]) {
    return new Response(lines.map((line) => JSON.stringify(line)).join(NL) + NL, {
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  function readProgress(r2: FakeR2) {
    const bytes = r2.objects.get(PROGRESS);
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  }

  it("asks for the stream and still writes ocr.json from the final line", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    let sentAccept = "";
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async (_url, init) => {
        sentAccept = String((init?.headers as Record<string, string>)?.accept ?? "");
        const digest = String((init?.headers as Record<string, string>)["x-tavonel-input-sha256"]);
        return ndjson([page(1, 3), page(2, 3), page(3, 3), ocrPayload(digest)]);
      },
    );
    assert.ok(sentAccept.includes("application/x-ndjson"));
    assert.equal(result.status, "written");
    assert.equal(result.key, OCR_JSON);
    const written = JSON.parse(new TextDecoder().decode(r2.objects.get(OCR_JSON)!));
    assert.equal(written.schemaVersion, "tavonel.ocr_result.v2");
    assert.equal(written.pageCount, 1);
    assert.equal(written.sourceImmutableKey, IMMUTABLE);
  });

  it("reports the read as it happens, and marks it read only at the end", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async (_url, init) => {
        const digest = String((init?.headers as Record<string, string>)["x-tavonel-input-sha256"]);
        return ndjson([page(1, 3, 2), page(2, 3, 4), page(3, 3, 1), ocrPayload(digest)]);
      },
    );
    // One write per page, plus the final one.
    assert.equal(r2.puts.filter((key) => key === PROGRESS).length, 4);
    const progress = readProgress(r2);
    assert.equal(progress.state, "read");
    assert.equal(progress.pagesRead, 3);
    assert.equal(progress.pageCount, 3);
    assert.equal(progress.regionsFound, 7);
    assert.equal(progress.sourceImmutableKey, IMMUTABLE);
  });

  /*
   * This test replaces one that asserted the opposite.
   *
   * The first version of the progress object deliberately carried no text, on the reasoning that
   * showing the document body anywhere new was a risk. That was too broad: the object is written
   * by this worker to the bucket and read by the browser from the bucket with a signed URL, so
   * the text goes from the customer's storage to the customer's screen and the application server
   * is not on that path. The promise the product makes is about the application server, and it
   * still holds.
   *
   * So the guard moved rather than disappeared. What must stay true is that the object remains a
   * bounded view and not a second copy of the document: only a rolling window of pages is kept.
   */
  it("keeps the read text, but only a bounded window of it", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async (_url, init) => {
        const digest = String((init?.headers as Record<string, string>)["x-tavonel-input-sha256"]);
        const pages = Array.from({ length: 40 }, (_unused, index) => page(index + 1, 40, 2));
        return ndjson([...pages, ocrPayload(digest)]);
      },
    );
    const progress = readProgress(r2);
    // Every page was counted...
    assert.equal(progress.pagesRead, 40);
    assert.equal(progress.regionsFound, 80);
    // ...but the object holds only the recent window, so it cannot become the document.
    assert.ok(progress.pages.length <= 12, `retained ${progress.pages.length} pages`);
    assert.equal(progress.pages.at(-1).pageNumber1, 40);
    // The text that is retained is the text that was read.
    assert.equal(progress.pages.at(-1).boxes[0].text, "line 1 on page 40");
    assert.ok(progress.pages.at(-1).boxes[0].regionId.startsWith("ocr-p0040"));
  });

  it("truncates an unreasonably long line rather than storing it whole", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async (_url, init) => {
        const digest = String((init?.headers as Record<string, string>)["x-tavonel-input-sha256"]);
        const long = { ...page(1, 1, 1) };
        long.boxes = [{ bbox1000: [1, 1, 999, 50], confidence: 0.9, text: "x".repeat(5000), regionId: "r1" }];
        return ndjson([long, ocrPayload(digest)]);
      },
    );
    assert.equal(readProgress(r2).pages[0].boxes[0].text.length, 400);
  });

  it("writes nothing when the stream ends without a result", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async () => ndjson([page(1, 2), page(2, 2)]),
    );
    assert.equal(result.status, "failed");
    assert.equal(result.reasonCode, "OCR_RESPONSE_INVALID");
    assert.equal(r2.objects.has(OCR_JSON), false);
  });

  it("writes nothing when the final line is for a different document", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async () => ndjson([page(1, 1), ocrPayload(`sha256:${"c".repeat(64)}`)]),
    );
    assert.equal(result.status, "failed");
    assert.equal(result.reasonCode, "OCR_RESPONSE_INVALID");
    assert.equal(r2.objects.has(OCR_JSON), false);
  });

  it("ignores malformed progress lines rather than failing the read", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async (_url, init) => {
        const digest = String((init?.headers as Record<string, string>)["x-tavonel-input-sha256"]);
        const body = [
          JSON.stringify(page(1, 2)),
          "{ not json",
          JSON.stringify({ schemaVersion: "tavonel.ocr_progress.v1", type: "page", pageNumber1: 9, pageCount: 2 }),
          JSON.stringify(page(2, 2)),
          JSON.stringify(ocrPayload(digest)),
        ].join(NL);
        return new Response(body + NL, { headers: { "content-type": "application/x-ndjson" } });
      },
    );
    assert.equal(result.status, "written");
    assert.equal(readProgress(r2).pagesRead, 2);
  });

  it("still reads a worker that answers with plain JSON", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async (_url, init) => {
        const digest = String((init?.headers as Record<string, string>)["x-tavonel-input-sha256"]);
        return Response.json(ocrPayload(digest));
      },
    );
    assert.equal(result.status, "written");
    // No stream, so nothing claimed a live read.
    assert.equal(r2.objects.has(PROGRESS), false);
  });

  /*
   * The dangerous ordering. A page line arriving after the result must not become the answer --
   * and a page line must never be able to *be* an answer. Without this, a worker that flushed one
   * more page after its result would silently write nothing, or worse, write a page as a result.
   */
  it("refuses a page line as the result, whatever order it arrives in", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async (_url, init) => {
        const digest = String((init?.headers as Record<string, string>)["x-tavonel-input-sha256"]);
        return ndjson([page(1, 2), ocrPayload(digest), page(2, 2)]);
      },
    );
    // The result still stands: a page is a report, never an answer.
    assert.equal(result.status, "written");
    const written = JSON.parse(new TextDecoder().decode(r2.objects.get(OCR_JSON)!));
    assert.equal(written.schemaVersion, "tavonel.ocr_result.v2");
  });

  it("keeps ocr.json create-once even on the streamed path", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES, [OCR_JSON]: new TextEncoder().encode("{}") });
    let fetched = 0;
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async () => { fetched += 1; return ndjson([]); },
    );
    assert.equal(result.status, "exists");
    assert.equal(fetched, 0);
  });
});

/*
 * Operational failure and semantic failure are different problems.
 *
 * The rule under test is one sentence: a request that never produced an answer costs nothing and
 * decides nothing. Everything else here is that sentence applied to each way a request can fail.
 */
describe("OCR failure taxonomy", () => {
  it("classifies every failure code, and borrows the scheduler's category names", () => {
    const codes: OcrFailureCode[] = [
      "OCR_REVIEW_ALREADY_EXISTS",
      "OCR_SOURCE_MISSING",
      "OCR_SOURCE_EMPTY",
      "OCR_TIMEOUT_OR_NETWORK",
      "OCR_HTTP_UNAVAILABLE",
      "OCR_HTTP_REJECTED",
      "OCR_RESPONSE_NOT_JSON",
      "OCR_RESPONSE_INVALID",
      "OCR_RESULT_WRITE_FAILED",
    ];
    assert.deepEqual(Object.keys(OCR_FAILURE_CATEGORY).sort(), [...codes].sort());

    /*
     * The category names are not ours to invent.
     *
     * 'core-integration/services/scheduler/src/akc_scheduler/retry_policy.py:8-24' already names
     * every category a provider or worker failure can fall into, with a strategy and a bounded
     * backoff for each. They are transliterated here rather than read from that tree, the same
     * way 'shared/uskcEnums.ts' transliterates the frozen contract: the two repositories deploy
     * separately and this test has to run in a checkout of one of them.
     */
    const SCHEDULER_RETRY_CATEGORIES = [
      "provider_429", "provider_5xx", "download_timeout", "gpu_oom", "invalid_output",
      "unsupported_file", "default",
    ];
    for (const { retryCategory } of Object.values(OCR_FAILURE_CATEGORY)) {
      assert.equal(
        SCHEDULER_RETRY_CATEGORIES.includes(retryCategory),
        true,
        String(retryCategory) + " is not a category retry_policy.py defines",
      );
    }
  });

  it("treats an unavailable endpoint as transport: nothing charged, nothing decided", async () => {
    for (const [status, code] of [[503, "OCR_HTTP_UNAVAILABLE"], [429, "OCR_HTTP_UNAVAILABLE"], [500, "OCR_HTTP_UNAVAILABLE"]] as const) {
      const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
      const result = await dispatchOcrAfterSanitize(
        envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
        IMMUTABLE,
        async () => new Response("no", { status }),
      );
      assert.equal(result.reasonCode, code);
      assert.equal(result.computeCredits, 0);
      assert.equal(ocrFailureKind(result.reasonCode), "transport");
    }
  });

  it("charges nothing when the request never reached the reader", async () => {
    const r2 = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const result = await dispatchOcrAfterSanitize(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async () => { throw new DOMException("The operation was aborted.", "TimeoutError"); },
    );
    assert.equal(result.reasonCode, "OCR_TIMEOUT_OR_NETWORK");
    assert.equal(result.computeCredits, 0);
    assert.equal(ocrFailureKind(result.reasonCode), "transport");
  });

  it("still charges, and still stops, when the reader answered and the answer did not hold", async () => {
    const refused = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const rejected = await dispatchOcrAfterSanitize(
      envFor(refused, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async () => new Response("this document was refused", { status: 422 }),
    );
    assert.equal(rejected.reasonCode, "OCR_HTTP_REJECTED");
    assert.equal(rejected.computeCredits, 2);
    assert.equal(ocrFailureKind(rejected.reasonCode), "semantic");

    const malformed = new FakeR2({ [IMMUTABLE]: PDF_BYTES });
    const invalid = await dispatchOcrAfterSanitize(
      envFor(malformed, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      IMMUTABLE,
      async () => Response.json({ schemaVersion: "tavonel.ocr_result.v2", status: "ok" }),
    );
    assert.equal(invalid.reasonCode, "OCR_RESPONSE_INVALID");
    assert.equal(invalid.computeCredits, 2);
    assert.equal(ocrFailureKind(invalid.reasonCode), "semantic");
  });
});
