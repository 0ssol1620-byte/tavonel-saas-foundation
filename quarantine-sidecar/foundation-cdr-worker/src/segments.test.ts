import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { RetryableError } from "./errors";
import { handleQueue, type Env } from "./index";
import { immutableObjectKey, segmentManifestKey, segmentPlanKey } from "./keys";
import { asSourceRefusal, sanitizeObject, sourceSegmentPages, type R2BucketLike, type R2ObjectLike } from "./sanitize";

/*
  Segmented sources (docs/adr/0006-segmented-large-sources.md): a long source is read one page
  range per CDR request, each range is stored and read on its own, and the source becomes visible
  only through a manifest written after every range is read.
*/

const SECRET = "foundation-cdr-hmac-fixture-secret-ok";
const CDR_URL = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/v1/disarm";
const OCR_URL = "https://tavonel-foundation-ocr.example/v1/ocr";
const SETTLEMENT_URL = "https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle";
const SOURCE_KEY = "quarantine/ws_pilot/doc_1/source";
const SOURCE = new TextEncoder().encode("%PDF-1.4 long manual");

class FakeR2 implements R2BucketLike {
  readonly objects = new Map<string, Uint8Array>();
  constructor(initial: Record<string, Uint8Array> = {}) {
    for (const [key, bytes] of Object.entries(initial)) this.objects.set(key, bytes);
  }
  async list({ prefix }: { prefix: string }) {
    return { objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
  }
  async get(key: string): Promise<R2ObjectLike | null> {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      size: bytes.byteLength,
      httpMetadata: { contentType: "application/pdf" },
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
    };
  }
  async put(key: string, value: ArrayBuffer | Uint8Array, options: { onlyIf: { etagDoesNotMatch: string } }) {
    if (this.objects.has(key) && options.onlyIf.etagDoesNotMatch === "*") return null;
    this.objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
    return { etag: "new" };
  }
  keys(prefix = "") {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

function envFor(r2: FakeR2, overrides: Partial<Env> = {}): Env {
  return {
    FOUNDATION_QUARANTINE: r2 as unknown as Env["FOUNDATION_QUARANTINE"],
    TAVONEL_CDR_URL: CDR_URL,
    TAVONEL_CDR_HEALTH_URL: CDR_URL.replace("/v1/disarm", "/health"),
    TAVONEL_CDR_PROVIDER: "tavonel_pdf_raster",
    FOUNDATION_R2_BUCKET: "tavonel-saas-foundation-quarantine",
    TAVONEL_CDR_HMAC: SECRET,
    FOUNDATION_OCR_URL: OCR_URL,
    FOUNDATION_BILLING_SETTLEMENT_URL: SETTLEMENT_URL,
    FOUNDATION_BILLING_SETTLEMENT_HMAC: "foundation-settlement-hmac-fixture-secret-ok",
    FOUNDATION_SOURCE_SEGMENT_PAGES: "2",
    ...overrides,
  };
}

const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

type Cdr = {
  calls: string[];
  ocrCalls: number;
  settlements: Array<Record<string, unknown>>;
  fetch: typeof fetch;
};

/**
 * A CDR that renders the range its signed request id names out of a document of `pages` pages,
 * and a reader that reads whatever it is sent. `refuseRange` answers one range with a refusal.
 */
function fakeChain(pages: number, options: {
  refuseRange?: string;
  ocrRefuseRange?: string;
  noRangeHeaders?: boolean;
  pagesFor?: (range: string) => number;
} = {}): Cdr {
  const chain: Cdr = { calls: [], ocrCalls: 0, settlements: [], fetch: undefined as never };
  const sanitizedRange = new Map<string, string>();
  chain.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url === SETTLEMENT_URL) {
      chain.settlements.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ code: "SETTLEMENT_APPLIED" });
    }
    if (url === OCR_URL) {
      chain.ocrCalls += 1;
      const inputSha256 = headers.get("x-tavonel-input-sha256") ?? "";
      if (options.ocrRefuseRange && sanitizedRange.get(inputSha256) === options.ocrRefuseRange) {
        return new Response("this range was refused", { status: 422 });
      }
      return Response.json({
        schemaVersion: "tavonel.ocr_result.v2", status: "ok", text: "TAVONEL OCR", pageCount: 1, inputSha256,
        regions: [{ regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
          text: "TAVONEL OCR", bbox1000: [100, 100, 900, 200], confidence: 1, authority: "informal" }],
      });
    }
    assert.equal(url, CDR_URL);
    const requestId = headers.get("x-tavonel-cdr-request-id") ?? "";
    chain.calls.push(requestId);
    const match = /_p(\d+)_(\d+)$/.exec(requestId);
    const range = match ? `${match[1]}-${match[2]}` : "whole";
    if (options.refuseRange === range) {
      return Response.json({ detail: "CDR source could not be rasterized safely" }, { status: 422 });
    }
    const documentPages = options.pagesFor ? options.pagesFor(range) : pages;
    if (match && Number(match[1]) >= documentPages) {
      return Response.json({ detail: "CDR page range starts past the end of the document" }, { status: 422 });
    }
    const end = match ? Math.min(Number(match[2]), documentPages) : documentPages;
    const body = new TextEncoder().encode(`%PDF-1.4 sanitized ${match ? `${match[1]}-${end}` : "whole"}`);
    sanitizedRange.set(sha(body), range);
    return new Response(body, { status: 200, headers: {
      "content-type": "application/pdf",
      "x-tavonel-cdr-status": "clean",
      "x-tavonel-input-sha256": headers.get("x-tavonel-input-sha256") ?? "",
      "x-tavonel-cdr-output-sha256": sha(body),
      ...(match && !options.noRangeHeaders
        ? { "x-tavonel-cdr-source-pages": String(documentPages), "x-tavonel-cdr-page-range": `${match[1]}-${end}` }
        : {}),
    } });
  };
  return chain;
}

const SEGMENTS = "immutable/ws_pilot/ws_pilot/doc_1/segments/";

describe("segmented sources", () => {
  it("is off unless configured, and refuses a value it cannot use rather than guessing", () => {
    assert.equal(sourceSegmentPages({}), null);
    assert.equal(sourceSegmentPages({ FOUNDATION_SOURCE_SEGMENT_PAGES: " " }), null);
    assert.equal(sourceSegmentPages({ FOUNDATION_SOURCE_SEGMENT_PAGES: "80" }), 80);
    for (const value of ["0", "81", "08", "2.5", "all", "-1"]) {
      assert.throws(() => sourceSegmentPages({ FOUNDATION_SOURCE_SEGMENT_PAGES: value }), RetryableError, value);
    }
  });

  it("sends an unranged request exactly as before when it is off", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(1);
    await sanitizeObject(envFor(r2, { FOUNDATION_SOURCE_SEGMENT_PAGES: undefined }), SOURCE_KEY, chain.fetch);
    assert.equal(chain.calls.length, 1);
    assert.doesNotMatch(chain.calls[0], /_p\d+_\d+$/);
    assert.deepEqual(r2.keys(SEGMENTS), []);
  });

  it("stores a source that fits one range where a whole document goes, and nothing under segments/", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(2);
    const result = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch);
    assert.equal(chain.calls.length, 1);
    assert.match(chain.calls[0], /_p0_2$/);
    assert.equal(result.immutableKey, immutableObjectKey("ws_pilot", "doc_1", sha(new TextEncoder().encode("%PDF-1.4 sanitized 0-2"))));
    assert.equal(result.ocr.status, "written");
    assert.deepEqual(r2.keys(SEGMENTS), []);
  });

  it("reads a long source range by range and writes the manifest only once every range is read", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(5);
    const result = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch);
    assert.deepEqual(chain.calls.map((id) => id.replace(/^.*_p/, "p")), ["p0_2", "p2_4", "p4_6"]);
    assert.equal(chain.ocrCalls, 3);
    const manifestKey = segmentManifestKey("ws_pilot", "doc_1");
    assert.equal(result.immutableKey, manifestKey);
    assert.equal(result.ocr.status, "written");
    assert.equal(result.ocr.computeCredits, 2, "one source settles the per-document charge, as a whole document does");
    assert.equal(result.ocr.observedPageCount, 5);
    const manifest = JSON.parse(new TextDecoder().decode(r2.objects.get(manifestKey)));
    assert.equal(manifest.schemaVersion, "tavonel.source_segments.v1");
    assert.equal(manifest.totalPages, 5);
    assert.deepEqual(manifest.segments.map((segment: { start0: number; end0: number }) => [segment.start0, segment.end0]),
      [[0, 2], [2, 4], [4, 5]]);
    for (const segment of manifest.segments as Array<{ immutableKey: string; ocrKey: string }>) {
      assert.ok(segment.immutableKey.startsWith(SEGMENTS), "every range stays under the source's own prefix");
      assert.ok(r2.objects.has(segment.immutableKey));
      assert.ok(r2.objects.has(segment.ocrKey));
    }
    // No object of a segmented source has the <doc>/<version>/<file> shape the site lists.
    assert.deepEqual(r2.keys("immutable/ws_pilot/ws_pilot/doc_1/").filter((key) => !key.startsWith(SEGMENTS)), []);
  });

  it("continues on the next delivery from the first range not yet read, and pays for no range twice", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(6);
    let clock = Date.parse("2026-11-10T00:00:00Z");
    // Each CDR call takes four minutes, so the budget runs out before the third range.
    const slowFetch: typeof fetch = async (input, init) => {
      if (String(input) === CDR_URL) clock += 4 * 60 * 1000;
      return chain.fetch(input, init);
    };
    await assert.rejects(sanitizeObject(envFor(r2), SOURCE_KEY, slowFetch, () => new Date(clock)), (error: unknown) =>
      error instanceof RetryableError && /continues from page 5/.test(error.message));
    assert.equal(r2.objects.has(segmentManifestKey("ws_pilot", "doc_1")), false, "no manifest for a source in part");
    assert.equal(chain.calls.length, 2);

    const result = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch);
    assert.deepEqual(chain.calls.map((id) => id.replace(/^.*_p/, "p")), ["p0_2", "p2_4", "p4_6"]);
    assert.equal(chain.ocrCalls, 3);
    assert.equal(result.ocr.status, "written");

    // A third delivery (a redelivered message after settlement) reads nothing again.
    const replay = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch);
    assert.equal(chain.calls.length, 3);
    assert.equal(chain.ocrCalls, 3);
    assert.equal(replay.ocr.status, "exists");
  });

  it("refuses the whole source, naming the pages, when one range has a page that cannot be rendered", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(6, { refuseRange: "2-4" });
    let caught: unknown;
    await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch).catch((error) => { caught = error; });
    const refusal = asSourceRefusal(caught);
    assert.ok(refusal, "a refusal, not a retry");
    assert.equal(refusal.failureClass, "CORRUPT_SOURCE");
    assert.match(refusal.message, /pages 3-4/);
    assert.equal(r2.objects.has(segmentManifestKey("ws_pilot", "doc_1")), false);
    assert.deepEqual(chain.calls.map((id) => id.replace(/^.*_p/, "p")), ["p0_2", "p2_4"], "no range after the refused one");
  });

  it("parks the whole source, with no manifest, when the reader refuses one range", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(6, { ocrRefuseRange: "2-4" });
    const result = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch);
    assert.equal(result.ocr.status, "failed");
    assert.equal(result.ocr.computeCredits, 2);
    assert.ok(result.ocrReview && result.immutableKey.startsWith(`${SEGMENTS}2-4/`));
    assert.equal(r2.objects.has(segmentManifestKey("ws_pilot", "doc_1")), false);

    // The recorded failure is replayed, never read again.
    const replay = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch);
    assert.equal(replay.ocr.status, "failed");
    assert.equal(chain.ocrCalls, 2);
  });

  it("refuses a source over the segmented page ceiling as too large, before anything is stored", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(501);
    const tooLong: typeof fetch = async (input, init) => String(input) === CDR_URL
      ? (chain.calls.push("refused"), Response.json({ detail: "CDR source page count is not qualified" }, { status: 422 }))
      : chain.fetch(input, init);
    let caught: unknown;
    await sanitizeObject(envFor(r2), SOURCE_KEY, tooLong).catch((error) => { caught = error; });
    assert.equal(asSourceRefusal(caught)?.failureClass, "PARSER_OOM");
    assert.deepEqual(r2.keys("immutable/"), []);
  });

  it("retries rather than refusing when the CDR revision does not answer ranges", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(6, { noRangeHeaders: true });
    await assert.rejects(sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch), (error: unknown) =>
      error instanceof RetryableError && asSourceRefusal(error) === null);
    assert.deepEqual(r2.keys("immutable/"), []);
  });

  it("refuses a source whose page count changes between ranges", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(6, { pagesFor: (range) => (range === "0-2" ? 6 : 7) });
    let caught: unknown;
    await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch).catch((error) => { caught = error; });
    assert.equal(asSourceRefusal(caught)?.failureClass, "RECEIPT_MISMATCH");
    assert.equal(r2.objects.has(segmentManifestKey("ws_pilot", "doc_1")), false);
  });

  it("does not trust a stored plan that belongs to other bytes", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    r2.objects.set(segmentPlanKey("ws_pilot", "doc_1"), new TextEncoder().encode(JSON.stringify({
      schemaVersion: "tavonel.source_segment_plan.v1", sourceKey: SOURCE_KEY, inputSha256: `sha256:${"0".repeat(64)}`,
      totalPages: 6, segmentPages: 2,
    })));
    const chain = fakeChain(6);
    await assert.rejects(sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch), RetryableError);
    assert.equal(chain.calls.length, 0);
  });

  it("settles a long source once, after its last range, and retries without settling until then", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(6);
    let cdrDown = true;
    // The CDR goes away before the last range on the first delivery: an operational failure.
    const fetcher: typeof fetch = async (input, init) => {
      const id = new Headers(init?.headers).get("x-tavonel-cdr-request-id") ?? "";
      if (String(input) === CDR_URL && id.endsWith("_p4_6") && cdrDown) return new Response("unavailable", { status: 503 });
      return chain.fetch(input, init);
    };
    const deliver = async (attempts: number) => {
      const run = { acks: 0, retries: 0 };
      await handleQueue({ messages: [{
        attempts, body: { object: { key: SOURCE_KEY } },
        ack: () => { run.acks += 1; }, retry: () => { run.retries += 1; },
      }] } as never, envFor(r2), fetcher);
      return run;
    };
    assert.deepEqual(await deliver(1), { acks: 0, retries: 1 });
    assert.equal(chain.settlements.length, 0, "nothing settles while a range is unread");
    cdrDown = false;
    assert.deepEqual(await deliver(2), { acks: 1, retries: 0 });
    assert.equal(chain.settlements.length, 1);
    assert.equal(chain.settlements[0].outcome, "settled");
    assert.equal(chain.settlements[0].actualCredits, 2);
    assert.deepEqual(chain.calls.map((id) => id.replace(/^.*_p/, "p")), ["p0_2", "p2_4", "p4_6"]);
  });
});
