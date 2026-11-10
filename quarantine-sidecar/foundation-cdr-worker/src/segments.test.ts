import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { RetryableError } from "./errors";
import { handleQueue, type Env } from "./index";
import { immutableObjectKey, segmentManifestKey, segmentPlanKey } from "./keys";
import {
  SegmentContinuation, asSourceRefusal, sanitizeObject, sourceSegmentPages, type R2BucketLike, type R2ObjectLike,
  type SanitizeResult,
} from "./sanitize";

/*
  Segmented sources (docs/adr/0006-segmented-large-sources.md): a long source is read one page
  range per CDR request, one new range per delivery, each range is stored and read on its own, and
  the source becomes visible only through a manifest written after every range is read.
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

class FakeQueue {
  readonly sent: unknown[] = [];
  async send(body: unknown) {
    this.sent.push(body);
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
    FOUNDATION_SOURCE_SEGMENT_PAGES: "80",
    FOUNDATION_SEGMENT_CONTINUATION: new FakeQueue(),
    ...overrides,
  };
}

const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const ranges = (calls: string[]) => calls.map((id) => id.replace(/^.*_p/, "p"));

type Cdr = {
  calls: string[];
  ocrCalls: number;
  settlements: Array<Record<string, unknown>>;
  fetch: typeof fetch;
};

/**
 * A CDR that renders the range its signed request id names out of a document of `pages` pages,
 * and a reader that reads whatever it is sent. `refuseRange` answers one range with a refusal.
 * `noRangeHeaders` is a CDR revision that predates ranged requests.
 */
function fakeChain(pages: number, options: {
  refuseRange?: string;
  ocrRefuseRange?: string;
  ocrColdRange?: string;
  noRangeHeaders?: boolean;
  pagesFor?: (range: string) => number;
} = {}): Cdr {
  const chain: Cdr = { calls: [], ocrCalls: 0, settlements: [], fetch: undefined as never };
  const sanitizedRange = new Map<string, string>();
  const cold = new Set(options.ocrColdRange ? [options.ocrColdRange] : []);
  const refusal = (detail: string, ranged: boolean) => Response.json({ detail }, {
    status: 422, headers: ranged && !options.noRangeHeaders ? { "x-tavonel-cdr-ranges": "1" } : {},
  });
  chain.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url === SETTLEMENT_URL) {
      chain.settlements.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ code: "SETTLEMENT_APPLIED" });
    }
    if (url === OCR_URL) {
      const inputSha256 = headers.get("x-tavonel-input-sha256") ?? "";
      const range = sanitizedRange.get(inputSha256);
      if (range && cold.delete(range)) throw new TypeError("network connection lost");
      chain.ocrCalls += 1;
      if (options.ocrRefuseRange && range === options.ocrRefuseRange) {
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
    if (options.refuseRange === range) return refusal("CDR source could not be rasterized safely", Boolean(match));
    const documentPages = options.pagesFor ? options.pagesFor(range) : pages;
    // A revision that predates ranges renders the whole document and refuses past 80 pages.
    if (match && options.noRangeHeaders && documentPages > 80) {
      return refusal("CDR source page count is not qualified", true);
    }
    if (match && Number(match[1]) >= documentPages) {
      return refusal("CDR page range starts past the end of the document", true);
    }
    const end = match ? Math.min(Number(match[2]), documentPages) : documentPages;
    const body = new TextEncoder().encode(`%PDF-1.4 sanitized ${match ? `${match[1]}-${end}` : "whole"}`);
    sanitizedRange.set(sha(body), match ? `${match[1]}-${end}` : "whole");
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

/** Deliver the source until it stops continuing: what the queue does with each continuation. */
async function readToEnd(env: Env, fetcher: typeof fetch): Promise<{ result: SanitizeResult; deliveries: number }> {
  for (let deliveries = 1; deliveries <= 20; deliveries += 1) {
    try {
      return { result: await sanitizeObject(env, SOURCE_KEY, fetcher), deliveries };
    } catch (error) {
      if (!(error instanceof SegmentContinuation)) throw error;
    }
  }
  throw new Error("the source never finished");
}

type Delivery = { acks: number; retries: number; delays: Array<number | undefined> };

async function deliver(env: Env, fetcher: typeof fetch, attempts: number): Promise<Delivery> {
  const run: Delivery = { acks: 0, retries: 0, delays: [] };
  await handleQueue({ messages: [{
    attempts, body: { object: { key: SOURCE_KEY } },
    ack: () => { run.acks += 1; },
    retry: (options?: { delaySeconds?: number }) => { run.retries += 1; run.delays.push(options?.delaySeconds); },
  }] } as never, env, fetcher);
  return run;
}

const SEGMENTS = "immutable/ws_pilot/ws_pilot/doc_1/segments/";

describe("segmented sources", () => {
  it("is off unless configured, takes only 80, and refuses a configuration it cannot honour", () => {
    const queue = new FakeQueue();
    assert.equal(sourceSegmentPages({}), null);
    assert.equal(sourceSegmentPages({ FOUNDATION_SOURCE_SEGMENT_PAGES: " " }), null);
    assert.equal(sourceSegmentPages({ FOUNDATION_SOURCE_SEGMENT_PAGES: "80", FOUNDATION_SEGMENT_CONTINUATION: queue }), 80);
    // Pinned (REVIEW-PR231-R1 E2): a smaller range multiplies deliveries and objects per source.
    for (const value of ["1", "2", "8", "79", "0", "81", "080", "2.5", "all", "-1"]) {
      assert.throws(() => sourceSegmentPages({ FOUNDATION_SOURCE_SEGMENT_PAGES: value, FOUNDATION_SEGMENT_CONTINUATION: queue }),
        RetryableError, value);
    }
    assert.throws(() => sourceSegmentPages({ FOUNDATION_SOURCE_SEGMENT_PAGES: "80" }), /FOUNDATION_SEGMENT_CONTINUATION/);
    assert.throws(() => sourceSegmentPages({
      FOUNDATION_SOURCE_SEGMENT_PAGES: "80", FOUNDATION_SEGMENT_CONTINUATION: queue, FOUNDATION_COMPLETED_READ_ENABLED: "true",
    }), /FOUNDATION_COMPLETED_READ_ENABLED/);
  });

  it("refuses segmentation with completed-read on before any CDR request is paid for", async () => {
    // REVIEW-PR231-R1 E3: the check used to run after the first ranged request.
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(240);
    await assert.rejects(sanitizeObject(envFor(r2, { FOUNDATION_COMPLETED_READ_ENABLED: "true" }), SOURCE_KEY, chain.fetch),
      /FOUNDATION_COMPLETED_READ_ENABLED/);
    assert.equal(chain.calls.length, 0);
    assert.deepEqual(r2.keys("immutable/"), []);
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
    const chain = fakeChain(80);
    const result = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch);
    assert.equal(chain.calls.length, 1);
    assert.match(chain.calls[0], /_p0_80$/);
    assert.equal(result.immutableKey, immutableObjectKey("ws_pilot", "doc_1", sha(new TextEncoder().encode("%PDF-1.4 sanitized 0-80"))));
    assert.equal(result.ocr.status, "written");
    assert.deepEqual(r2.keys(SEGMENTS), []);
  });

  it("reads one new range per delivery and writes the manifest only once every range is read", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(200);
    const { result, deliveries } = await readToEnd(envFor(r2), chain.fetch);
    assert.equal(deliveries, 3, "one range per delivery");
    assert.deepEqual(ranges(chain.calls), ["p0_80", "p80_160", "p160_240"]);
    assert.equal(chain.ocrCalls, 3, "no range is read twice across deliveries");
    const manifestKey = segmentManifestKey("ws_pilot", "doc_1");
    assert.equal(result.immutableKey, manifestKey);
    assert.equal(result.ocr.status, "written");
    assert.equal(result.ocr.computeCredits, 2, "one source settles the per-document charge, as a whole document does");
    assert.equal(result.ocr.observedPageCount, 200);
    const manifest = JSON.parse(new TextDecoder().decode(r2.objects.get(manifestKey)));
    assert.equal(manifest.schemaVersion, "tavonel.source_segments.v1");
    assert.equal(manifest.totalPages, 200);
    assert.deepEqual(manifest.segments.map((segment: { start0: number; end0: number }) => [segment.start0, segment.end0]),
      [[0, 80], [80, 160], [160, 200]]);
    for (const segment of manifest.segments as Array<{ immutableKey: string; ocrKey: string }>) {
      assert.ok(segment.immutableKey.startsWith(SEGMENTS), "every range stays under the source's own prefix");
      assert.ok(r2.objects.has(segment.immutableKey));
      assert.ok(r2.objects.has(segment.ocrKey));
    }
    // No object of a segmented source has the <doc>/<version>/<file> shape the site lists.
    assert.deepEqual(r2.keys("immutable/ws_pilot/ws_pilot/doc_1/").filter((key) => !key.startsWith(SEGMENTS)), []);
  });

  it("reads a source at the 500-page ceiling to its last page", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(500);
    const { result, deliveries } = await readToEnd(envFor(r2), chain.fetch);
    assert.equal(deliveries, 7);
    assert.equal(result.ocr.observedPageCount, 500);
    const manifest = JSON.parse(new TextDecoder().decode(r2.objects.get(segmentManifestKey("ws_pilot", "doc_1"))));
    assert.equal(manifest.totalPages, 500);
    assert.deepEqual(manifest.segments.at(-1).start0, 480);
    assert.deepEqual(manifest.segments.at(-1).end0, 500);
    assert.equal(manifest.segments.length, 7);
  });

  it("continues a source as a new queue message, so a later range keeps the cold-start grace", async () => {
    // REVIEW-PR231-R1 E2: continuing by message.retry() spent attempts, and a cold GPU on attempt 3
    // parked the whole source. A continuation is a new message, which Cloudflare starts at attempt 1.
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const queue = new FakeQueue();
    const env = envFor(r2, { FOUNDATION_SEGMENT_CONTINUATION: queue });
    const chain = fakeChain(240, { ocrColdRange: "80-160" });

    assert.deepEqual(await deliver(env, chain.fetch, 1), { acks: 1, retries: 0, delays: [] });
    assert.deepEqual(queue.sent, [{ object: { key: SOURCE_KEY } }], "continued as a new message with the same body");

    // The continuation: its range meets a cold reader. It is deferred, not recorded.
    assert.deepEqual(await deliver(env, chain.fetch, 1), { acks: 0, retries: 1, delays: [60] });
    assert.deepEqual(r2.keys(SEGMENTS).filter((key) => key.endsWith("/ocr-review.json")), []);
    assert.equal(chain.settlements.length, 0);

    // The redelivery reads that range (no second CDR call) and continues again.
    assert.deepEqual(await deliver(env, chain.fetch, 2), { acks: 1, retries: 0, delays: [] });
    assert.deepEqual(await deliver(env, chain.fetch, 1), { acks: 1, retries: 0, delays: [] });
    assert.deepEqual(ranges(chain.calls), ["p0_80", "p80_160", "p160_240"]);
    assert.equal(queue.sent.length, 2);
    assert.equal(chain.settlements.length, 1);
    assert.equal(chain.settlements[0].outcome, "settled");
  });

  it("refuses the whole source, naming the pages, when one range has a page that cannot be rendered", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(240, { refuseRange: "80-160" });
    let caught: unknown;
    await readToEnd(envFor(r2), chain.fetch).catch((error) => { caught = error; });
    const refusal = asSourceRefusal(caught);
    assert.ok(refusal, "a refusal, not a retry");
    assert.equal(refusal.failureClass, "CORRUPT_SOURCE");
    assert.match(refusal.message, /pages 81-160/);
    assert.equal(r2.objects.has(segmentManifestKey("ws_pilot", "doc_1")), false);
    assert.deepEqual(ranges(chain.calls), ["p0_80", "p80_160"], "no range after the refused one");
  });

  it("parks the whole source, with no manifest, when the reader refuses one range", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(240, { ocrRefuseRange: "80-160" });
    const { result } = await readToEnd(envFor(r2), chain.fetch);
    assert.equal(result.ocr.status, "failed");
    assert.equal(result.ocr.computeCredits, 2);
    assert.ok(result.ocrReview && result.immutableKey.startsWith(`${SEGMENTS}80-160/`));
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
      ? (chain.calls.push("refused"), Response.json({ detail: "CDR source page count is not qualified" },
        { status: 422, headers: { "x-tavonel-cdr-ranges": "1" } }))
      : chain.fetch(input, init);
    let caught: unknown;
    await sanitizeObject(envFor(r2), SOURCE_KEY, tooLong).catch((error) => { caught = error; });
    assert.equal(asSourceRefusal(caught)?.failureClass, "PARSER_OOM");
    assert.deepEqual(r2.keys("immutable/"), []);
  });

  it("retries rather than refusing when a CDR revision that predates ranges answers a long source", async () => {
    // REVIEW-PR231-R1 E4: an old CDR renders the whole source and refuses past 80 pages. That is the
    // deploy order, not the document, so it must not become a permanent refusal.
    for (const pages of [6, 240]) {
      const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
      const chain = fakeChain(pages, { noRangeHeaders: true });
      let caught: unknown;
      await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch).catch((error) => { caught = error; });
      assert.ok(caught instanceof RetryableError, `${pages} pages: a retry`);
      assert.equal(asSourceRefusal(caught), null, `${pages} pages: not a refusal`);
      assert.deepEqual(r2.keys("immutable/"), []);
    }
  });

  it("refuses a source whose page count changes between ranges", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(240, { pagesFor: (range) => (range === "0-80" ? 240 : 280) });
    let caught: unknown;
    await readToEnd(envFor(r2), chain.fetch).catch((error) => { caught = error; });
    assert.equal(asSourceRefusal(caught)?.failureClass, "RECEIPT_MISMATCH");
    assert.equal(r2.objects.has(segmentManifestKey("ws_pilot", "doc_1")), false);
  });

  it("does not trust a stored plan that belongs to other bytes", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    r2.objects.set(segmentPlanKey("ws_pilot", "doc_1"), new TextEncoder().encode(JSON.stringify({
      schemaVersion: "tavonel.source_segment_plan.v1", sourceKey: SOURCE_KEY, inputSha256: `sha256:${"0".repeat(64)}`,
      totalPages: 240, segmentPages: 80,
    })));
    const chain = fakeChain(240);
    await assert.rejects(sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch), RetryableError);
    assert.equal(chain.calls.length, 0);
  });

  it("answers a redelivery from the manifest without touching a range, even when a range has two versions", async () => {
    // REVIEW-PR231-R1 E6: re-verifying every range picked whichever version was listed first, which
    // could disagree with the manifest and loop to the dead-letter queue.
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const chain = fakeChain(240);
    const first = await readToEnd(envFor(r2), chain.fetch);
    r2.objects.set(`${SEGMENTS}80-160/${"f".repeat(64)}/sanitized.pdf`, new TextEncoder().encode("%PDF-1.4 a second version"));
    const reads = r2.keys().length;
    const replay = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetch);
    assert.equal(replay.ocr.status, "exists");
    assert.equal(replay.immutableKey, first.result.immutableKey);
    assert.equal(replay.outputSha256, first.result.outputSha256);
    assert.equal(chain.calls.length, 3);
    assert.equal(chain.ocrCalls, 3);
    assert.equal(r2.keys().length, reads, "nothing was written");
  });

  it("settles a long source once, after its last range, and retries without settling until then", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE });
    const env = envFor(r2);
    const chain = fakeChain(240);
    let cdrDown = true;
    // The CDR goes away before the last range: an operational failure.
    const fetcher: typeof fetch = async (input, init) => {
      const id = new Headers(init?.headers).get("x-tavonel-cdr-request-id") ?? "";
      if (String(input) === CDR_URL && id.endsWith("_p160_240") && cdrDown) return new Response("unavailable", { status: 503 });
      return chain.fetch(input, init);
    };
    assert.deepEqual(await deliver(env, fetcher, 1), { acks: 1, retries: 0, delays: [] });
    assert.deepEqual(await deliver(env, fetcher, 1), { acks: 1, retries: 0, delays: [] });
    assert.deepEqual(await deliver(env, fetcher, 1), { acks: 0, retries: 1, delays: [undefined] });
    assert.equal(chain.settlements.length, 0, "nothing settles while a range is unread");
    cdrDown = false;
    assert.deepEqual(await deliver(env, fetcher, 2), { acks: 1, retries: 0, delays: [] });
    assert.equal(chain.settlements.length, 1);
    assert.equal(chain.settlements[0].outcome, "settled");
    assert.equal(chain.settlements[0].actualCredits, 2);
    // The refused CDR call never reached the chain, so the last range is rendered once.
    assert.deepEqual(ranges(chain.calls), ["p0_80", "p80_160", "p160_240"]);
  });
});
