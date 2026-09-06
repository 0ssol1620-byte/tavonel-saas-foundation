import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { failureClasses } from "../../../shared/uskcEnums";
import { PermanentReject, RetryableError } from "./errors";
import { cdrRequestSignature, sha256DigestHeader } from "./hmac";
import { handleQueue, handleRequest, type Env } from "./index";
import { cdrReceiptSiblingKey, immutableObjectKey, ocrReviewSiblingKey, ocrSiblingKey } from "./keys";
import {
  CDR_DETAIL_FAILURE_CLASS,
  cdrRefusalFailureClass,
  cdrRejectSiblingKey,
  sanitizeObject,
  type R2BucketLike,
  type R2ObjectLike,
} from "./sanitize";

const FIXTURE_SECRET = "foundation-cdr-hmac-fixture-secret-ok";
const SYNTHETIC_URL = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/v1/disarm";
const SYNTHETIC_HEALTH = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/health";
const PROD_URL = "https://tavonel-pdf-cdr.example.run.app/v1/disarm";
const FOUNDATION_OCR = "https://tavonel-foundation-ocr.example/v1/ocr";
const SETTLEMENT_URL = "https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle";
const MANUAL_TRIGGER_TOKEN = "foundation-manual-trigger-fixture-token";
const SOURCE_KEY = "quarantine/ws_pilot/doc_1/source";
const SOURCE_BYTES = new TextEncoder().encode("%PDF-1.4 fixture");
const SANITIZED_BYTES = new TextEncoder().encode("%PDF-1.4 sanitized-fixture");

class FakeR2 implements R2BucketLike {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly puts: Array<{ key: string; options: { onlyIf?: { etagDoesNotMatch?: string }; customMetadata?: { stage: string } } }> = [];
  deleted: string[] = [];

  constructor(initial?: Record<string, Uint8Array>) {
    for (const [key, bytes] of Object.entries(initial || {})) {
      this.objects.set(key, { bytes, contentType: "application/pdf" });
    }
  }

  async get(key: string): Promise<R2ObjectLike | null> {
    const found = this.objects.get(key);
    if (!found) {
      return null;
    }
    return {
      size: found.bytes.byteLength,
      httpMetadata: { contentType: found.contentType },
      arrayBuffer: async () => found.bytes.slice().buffer as ArrayBuffer,
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: { stage: string };
      onlyIf: { etagDoesNotMatch: string };
    },
  ): Promise<unknown> {
    this.puts.push({ key, options });
    if (this.objects.has(key) && options.onlyIf.etagDoesNotMatch === "*") {
      return null;
    }
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    this.objects.set(key, { bytes, contentType: options.httpMetadata.contentType });
    return { etag: "new" };
  }
}

function envFor(r2: FakeR2, overrides: Partial<Env> = {}): Env {
  return {
    FOUNDATION_QUARANTINE: r2 as unknown as Env["FOUNDATION_QUARANTINE"],
    TAVONEL_CDR_URL: SYNTHETIC_URL,
    TAVONEL_CDR_HEALTH_URL: SYNTHETIC_HEALTH,
    TAVONEL_CDR_PROVIDER: "tavonel_pdf_raster",
    FOUNDATION_R2_BUCKET: "tavonel-saas-foundation-quarantine",
    TAVONEL_CDR_HMAC: FIXTURE_SECRET,
    FOUNDATION_OCR_URL: "",
    FOUNDATION_BILLING_SETTLEMENT_URL: SETTLEMENT_URL,
    FOUNDATION_BILLING_SETTLEMENT_HMAC: "foundation-settlement-hmac-fixture-secret-ok",
    FOUNDATION_MANUAL_TRIGGER_TOKEN: MANUAL_TRIGGER_TOKEN,
    ...overrides,
  };
}

function outputSha256(): string {
  return `sha256:${createHash("sha256").update(SANITIZED_BYTES).digest("hex")}`;
}

async function cleanCdrFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url.includes("tavonel-pdf-cdr")) {
    throw new Error("unit tests must not call production CDR");
  }
  if (url.includes("/health")) {
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  }
  if (url === SETTLEMENT_URL) {
    return new Response(JSON.stringify({ code: "SETTLEMENT_APPLIED" }), { status: 200 });
  }
  if (url.includes("/v1/ocr")) {
    const inputSha256 = new Headers(init?.headers).get("x-tavonel-input-sha256");
    return new Response(
      JSON.stringify({
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
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  const headers = new Headers(init?.headers);
  const inputSha = headers.get("x-tavonel-input-sha256") || "";
  return new Response(SANITIZED_BYTES, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "x-tavonel-cdr-status": "clean",
      "x-tavonel-input-sha256": inputSha,
      "x-tavonel-cdr-output-sha256": outputSha256(),
    },
  });
}

describe("sanitizeObject", () => {
  it("writes a create-once immutable PDF and leaves the source object in place", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    const timestamp = "2026-08-29T00:00:00.000Z";
    const requestId = "fixture-request-01";
    let sawLiveHost = false;
    const result = await sanitizeObject(
      envFor(r2),
      SOURCE_KEY,
      async (input, init) => {
        const url = String(input);
        sawLiveHost = sawLiveHost || url.includes("asia-northeast3.run.app") === false;
        assert.equal(url, SYNTHETIC_URL);
        const headers = new Headers(init?.headers);
        const inputSha256 = await sha256DigestHeader(SOURCE_BYTES);
        assert.equal(headers.get("x-tavonel-input-sha256"), inputSha256);
        assert.equal(
          headers.get("x-tavonel-cdr-signature"),
          await cdrRequestSignature(FIXTURE_SECRET, timestamp, requestId, inputSha256),
        );
        const body = init?.body;
        assert.ok(body instanceof FormData);
        assert.ok(body.get("source"));
        return cleanCdrFetch(input, init);
      },
      () => new Date(timestamp),
      () => requestId,
    );
    const expectedImmutable = immutableObjectKey("ws_pilot", "doc_1", outputSha256());
    assert.equal(result.status, "clean");
    assert.equal(result.sourceKey, SOURCE_KEY);
    assert.equal(result.immutableKey, expectedImmutable);
    assert.equal(result.outputSha256, outputSha256());
    assert.equal(result.ocr.status, "skipped");
    assert.equal(r2.objects.has(SOURCE_KEY), true);
    assert.equal(r2.deleted.length, 0);
    assert.equal(r2.puts[0]?.key, expectedImmutable);
    assert.equal(r2.puts[0]?.options.onlyIf?.etagDoesNotMatch, "*");
    assert.equal(r2.puts[0]?.options.customMetadata?.stage, "immutable-approved");
    assert.equal(result.cdrReceipt.key, cdrReceiptSiblingKey(expectedImmutable));
    assert.equal(r2.objects.has(cdrReceiptSiblingKey(expectedImmutable)), true);
    const receipt = JSON.parse(new TextDecoder().decode(r2.objects.get(cdrReceiptSiblingKey(expectedImmutable))?.bytes));
    assert.equal(receipt.schemaVersion, "tavonel.cdr_receipt.v1");
    assert.equal(receipt.candidatePromotion, false);
    assert.equal(receipt.outputSha256, outputSha256());
    assert.equal(sawLiveHost, false);
    assert.equal(r2.objects.has(ocrSiblingKey(expectedImmutable)), false);
  });

  it("treats an already-present immutable object as success", async () => {
    const immutableKey = immutableObjectKey("ws_pilot", "doc_1", outputSha256());
    const r2 = new FakeR2({
      [SOURCE_KEY]: SOURCE_BYTES,
      [immutableKey]: SANITIZED_BYTES,
    });
    const result = await sanitizeObject(envFor(r2), SOURCE_KEY, cleanCdrFetch);
    assert.equal(result.status, "clean");
    assert.equal(result.immutableKey, immutableKey);
    assert.equal(result.ocr.status, "skipped");
  });

  it("skips OCR when FOUNDATION_OCR_URL is empty and still returns CDR clean", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    const result = await sanitizeObject(envFor(r2, { FOUNDATION_OCR_URL: "" }), SOURCE_KEY, cleanCdrFetch);
    assert.equal(result.status, "clean");
    assert.equal(result.ocr.status, "skipped");
    assert.equal(r2.puts.some((entry) => entry.key.endsWith("cdr-receipt.json")), true);
    assert.equal(r2.puts.some((entry) => entry.key.endsWith("ocr.json")), false);
    assert.equal(r2.puts.some((entry) => entry.key.endsWith("ocr-review.json")), false);
  });

  it("writes sibling ocr.json after CDR when FOUNDATION_OCR_URL is a Foundation target", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    const result = await sanitizeObject(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR, TAVONEL_OCR_HMAC: "foundation-ocr-hmac-fixture-secret-ok" }),
      SOURCE_KEY,
      cleanCdrFetch,
    );
    const expectedImmutable = immutableObjectKey("ws_pilot", "doc_1", outputSha256());
    const expectedOcr = ocrSiblingKey(expectedImmutable);
    assert.equal(result.status, "clean");
    assert.equal(result.ocr.status, "written");
    assert.equal(result.ocr.key, expectedOcr);
    assert.equal(r2.puts.some((entry) => entry.key === expectedOcr), true);
    assert.equal(r2.puts.find((entry) => entry.key === expectedOcr)?.options.onlyIf?.etagDoesNotMatch, "*");
  });

  it("persists OCR failure for explicit operator review without an automatic paid retry", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    const result = await sanitizeObject(
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      SOURCE_KEY,
      // 422, not 503: a reader that refused this document is a verdict and earns the receipt.
      // An unavailable endpoint is covered separately, and now earns nothing.
      async (input, init) => String(input).includes("/v1/ocr")
        ? new Response("this document was refused", { status: 422 })
        : cleanCdrFetch(input, init),
      () => new Date("2026-08-29T00:00:00Z"),
      () => "fixture-review-request",
    );
    const immutableKey = immutableObjectKey("ws_pilot", "doc_1", outputSha256());
    const reviewKey = ocrReviewSiblingKey(immutableKey);
    assert.equal(result.ocr.status, "failed");
    assert.equal(result.ocr.reasonCode, "OCR_HTTP_REJECTED");
    assert.equal(result.ocrReview?.key, reviewKey);
    const review = JSON.parse(new TextDecoder().decode(r2.objects.get(reviewKey)?.bytes));
    assert.equal(review.status, "operator_review");
    assert.equal(review.retryPolicy, "explicit_operator_only");
    assert.equal(review.candidatePromotion, false);

    const message = { ackCount: 0, retryCount: 0, body: { object: { key: SOURCE_KEY } } };
    let retriedOcrCalls = 0;
    await handleQueue(
      { messages: [{
        body: message.body,
        ack: () => { message.ackCount += 1; },
        retry: () => { message.retryCount += 1; },
      }] } as never,
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      async (input, init) => {
        if (String(input).includes("/v1/ocr")) {
          retriedOcrCalls += 1;
          return new Response("this document was refused", { status: 422 });
        }
        return cleanCdrFetch(input, init);
      },
    );
    assert.equal(message.ackCount, 1);
    assert.equal(message.retryCount, 0);
    assert.equal(retriedOcrCalls, 0);
  });

  it("charges nothing and writes no review receipt when OCR is merely unavailable", async () => {
    for (const unavailable of [
      async () => { throw new TypeError("socket closed"); },
      async () => new Response("capacity unavailable", { status: 503 }),
      async () => new Response("slow down", { status: 429 }),
    ]) {
      const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
      await assert.rejects(
        () => sanitizeObject(
          envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
          SOURCE_KEY,
          async (input, init) => String(input).includes("/v1/ocr")
            ? await unavailable()
            : cleanCdrFetch(input, init),
        ),
        RetryableError,
      );
      // The CDR half is done and stays done; only the reading is unfinished.
      const immutableKey = immutableObjectKey("ws_pilot", "doc_1", outputSha256());
      assert.equal(r2.objects.has(immutableKey), true);
      assert.equal(r2.objects.has(ocrReviewSiblingKey(immutableKey)), false);
      assert.equal(r2.puts.some((entry) => entry.key.endsWith("ocr-review.json")), false);
    }
  });

  it("leaves an unavailable OCR on the queue instead of settling it", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    const message = { ackCount: 0, retryCount: 0, body: { object: { key: SOURCE_KEY } } };
    const settlements: unknown[] = [];
    await handleQueue(
      { messages: [{
        body: message.body,
        ack: () => { message.ackCount += 1; },
        retry: () => { message.retryCount += 1; },
      }] } as never,
      envFor(r2, { FOUNDATION_OCR_URL: FOUNDATION_OCR }),
      async (input, init) => {
        if (String(input) === SETTLEMENT_URL) settlements.push(init?.body);
        if (String(input).includes("/v1/ocr")) return new Response("capacity unavailable", { status: 503 });
        return cleanCdrFetch(input, init);
      },
    );
    assert.equal(message.retryCount, 1);
    assert.equal(message.ackCount, 0);
    // Nothing was charged, released or parked: the attempt simply has not finished yet.
    assert.deepEqual(settlements, []);
  });

  it("refuses oversized objects before calling CDR", async () => {
    const r2 = new FakeR2();
    r2.objects.set(SOURCE_KEY, { bytes: SOURCE_BYTES, contentType: "application/pdf" });
    const originalGet = r2.get.bind(r2);
    r2.get = async (key: string) => {
      const object = await originalGet(key);
      if (!object) return null;
      return { ...object, size: 5 * 1024 * 1024 + 1 };
    };
    let fetched = 0;
    await assert.rejects(
      () =>
        sanitizeObject(envFor(r2), SOURCE_KEY, async () => {
          fetched += 1;
          return new Response("no", { status: 200 });
        }),
      PermanentReject,
    );
    assert.equal(fetched, 0);
  });

  it("refuses a production CDR URL without fetching it", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    let fetched = 0;
    await assert.rejects(
      () =>
        sanitizeObject(envFor(r2, { TAVONEL_CDR_URL: PROD_URL }), SOURCE_KEY, async () => {
          fetched += 1;
          return new Response("no", { status: 200 });
        }),
      PermanentReject,
    );
    assert.equal(fetched, 0);
  });

  it("surfaces only a bounded static CDR rejection detail", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    await assert.rejects(
      () => sanitizeObject(
        envFor(r2),
        SOURCE_KEY,
        async () => Response.json({ detail: "CDR Office package is invalid or encrypted" }, { status: 422 }),
      ),
      (error: unknown) => error instanceof PermanentReject
        && error.message === "synthetic CDR rejected the source (422): CDR Office package is invalid or encrypted",
    );

    await assert.rejects(
      () => sanitizeObject(
        envFor(r2),
        SOURCE_KEY,
        async () => Response.json({ detail: "customer filename and arbitrary provider output" }, { status: 422 }),
      ),
      (error: unknown) => error instanceof PermanentReject
        && error.message === "synthetic CDR rejected the source (422)",
    );
  });

  it("retries on CDR 5xx", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    await assert.rejects(
      () =>
        sanitizeObject(envFor(r2), SOURCE_KEY, async () => new Response("unavailable", { status: 503 })),
      RetryableError,
    );
  });
});

describe("Worker HTTP and queue surface", () => {
  it("POST /v1/sanitize accepts metadata only and returns JSON without a PDF body", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    const response = await handleRequest(
      new Request("https://worker.example/v1/sanitize", {
        method: "POST",
        headers: {
          authorization: `Bearer ${MANUAL_TRIGGER_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ objectKey: SOURCE_KEY }),
      }),
      envFor(r2),
      cleanCdrFetch,
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as Record<string, string>;
    assert.equal(payload.status, "clean");
    assert.equal(payload.sourceKey, SOURCE_KEY);
    assert.equal(payload.immutableKey, immutableObjectKey("ws_pilot", "doc_1", outputSha256()));
    assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
  });

  it("keeps the manual sanitize endpoint disabled or authenticated", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    const request = (authorization?: string) => new Request("https://worker.example/v1/sanitize", {
      method: "POST",
      headers: {
        ...(authorization ? { authorization } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({ objectKey: SOURCE_KEY }),
    });

    const disabled = await handleRequest(
      request(`Bearer ${MANUAL_TRIGGER_TOKEN}`),
      envFor(r2, { FOUNDATION_MANUAL_TRIGGER_TOKEN: undefined }),
      cleanCdrFetch,
    );
    assert.equal(disabled.status, 404);

    const missing = await handleRequest(request(), envFor(r2), cleanCdrFetch);
    assert.equal(missing.status, 401);

    const invalid = await handleRequest(request("Bearer invalid"), envFor(r2), cleanCdrFetch);
    assert.equal(invalid.status, 401);
    assert.equal(r2.puts.length, 0);
  });

  it("queue skips non-source keys and retries CDR 5xx", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    const skipped = { ackCount: 0, retryCount: 0, body: { object: { key: "immutable/ws/ws/doc/abc/sanitized.pdf" } } };
    await handleQueue(
      {
        messages: [
          {
            body: skipped.body,
            ack: () => {
              skipped.ackCount += 1;
            },
            retry: () => {
              skipped.retryCount += 1;
            },
          },
        ],
      } as never,
      envFor(r2),
      cleanCdrFetch,
    );
    assert.equal(skipped.ackCount, 1);
    assert.equal(skipped.retryCount, 0);

    const failed = { ackCount: 0, retryCount: 0, body: { object: { key: SOURCE_KEY } } };
    await handleQueue(
      {
        messages: [
          {
            body: failed.body,
            ack: () => {
              failed.ackCount += 1;
            },
            retry: () => {
              failed.retryCount += 1;
            },
          },
        ],
      } as never,
      envFor(r2),
      async () => new Response("no", { status: 502 }),
    );
    assert.equal(failed.retryCount, 1);
    assert.equal(failed.ackCount, 0);
  });
});

/*
 * A refusal is evidence, and evidence has to exist.
 *
 * Everything below is one rule seen from four sides: a source the CDR will never process ends in
 * a durable, typed, single record -- or the message stays on the queue. Never an acknowledgement
 * with nothing written, never a second receipt, never a class somebody guessed.
 */
describe("permanent refusals leave a receipt", () => {
  function oversizedR2() {
    const r2 = new FakeR2();
    r2.objects.set(SOURCE_KEY, { bytes: SOURCE_BYTES, contentType: "application/pdf" });
    const originalGet = r2.get.bind(r2);
    r2.get = async (key: string) => {
      const object = await originalGet(key);
      return object ? { ...object, size: 6 * 1024 * 1024 } : null;
    };
    return r2;
  }

  function queueMessage() {
    const counters = { ackCount: 0, retryCount: 0 };
    return {
      counters,
      batch: { messages: [{
        body: { object: { key: SOURCE_KEY } },
        ack: () => { counters.ackCount += 1; },
        retry: () => { counters.retryCount += 1; },
      }] } as never,
    };
  }

  function readReceipt(r2: FakeR2) {
    const key = cdrRejectSiblingKey(SOURCE_KEY);
    assert.ok(key);
    const stored = r2.objects.get(key);
    return stored ? JSON.parse(new TextDecoder().decode(stored.bytes)) : null;
  }

  it("writes exactly one create-once receipt, carrying no filename and no content", async () => {
    const r2 = oversizedR2();
    const first = queueMessage();
    await handleQueue(first.batch, envFor(r2), cleanCdrFetch);
    assert.equal(first.counters.ackCount, 1);
    assert.equal(first.counters.retryCount, 0);

    const receipt = readReceipt(r2);
    assert.equal(receipt.schemaVersion, "tavonel.cdr_reject_receipt.v1");
    assert.equal(receipt.sourceKey, SOURCE_KEY);
    assert.equal(receipt.reasonCode, "PARSER_OOM");
    assert.equal(receipt.observedBytes, 6 * 1024 * 1024);
    assert.equal(receipt.declaredBytes, null);
    assert.equal(receipt.provider, "tavonel_pdf_raster");
    assert.ok(Number.isFinite(Date.parse(receipt.occurredAt)));
    assert.deepEqual(
      Object.keys(receipt).sort(),
      ["declaredBytes", "observedBytes", "occurredAt", "provider", "reasonCode", "schemaVersion", "sourceKey"],
    );
  });

  it("does not write a second receipt or change the first when the message is redelivered", async () => {
    const r2 = oversizedR2();
    await handleQueue(queueMessage().batch, envFor(r2), cleanCdrFetch);
    const first = readReceipt(r2);

    const redelivered = queueMessage();
    const settlements: string[] = [];
    await handleQueue(redelivered.batch, envFor(r2), async (input, init) => {
      if (String(input) === SETTLEMENT_URL) settlements.push(String(init?.body));
      return cleanCdrFetch(input, init);
    });
    assert.equal(redelivered.counters.ackCount, 1);
    // Byte-identical, timestamp included: the second delivery did not overwrite the first.
    assert.deepEqual(readReceipt(r2), first);
    const rejectKey = cdrRejectSiblingKey(SOURCE_KEY);
    const attempts = r2.puts.filter((entry) => entry.key === rejectKey);
    assert.equal(attempts.length, 2, "both deliveries attempt the write");
    // Create-once is what turns the second attempt into a no-op rather than a second receipt.
    assert.ok(attempts.every((entry) => entry.options.onlyIf?.etagDoesNotMatch === "*"));
    // The redelivery still settles, because the first delivery may have died between the receipt
    // and the settlement. It settles identically -- released, nothing charged -- so the ledger's
    // own idempotency has the same facts to recognise.
    const body = JSON.parse(settlements[0]);
    assert.equal(body.outcome, "released");
    assert.equal(body.actualCredits, 0);
    assert.equal(body.reasonCode, "CDR_PERMANENT_REJECT");
    assert.equal(body.failureClass, "PARSER_OOM");
    assert.equal(body.terminalReason, "quarantine source exceeds the 5 MiB Foundation CDR cap");
  });

  it("keeps the message retryable when the settlement cannot record the refusal", async () => {
    const r2 = oversizedR2();
    const message = queueMessage();
    await handleQueue(message.batch, envFor(r2), async (input, init) => String(input) === SETTLEMENT_URL
      ? new Response(JSON.stringify({ code: "INTAKE_STATE_WRITE_FAILED" }), { status: 503 })
      : cleanCdrFetch(input, init));
    assert.equal(message.counters.retryCount, 1);
    assert.equal(message.counters.ackCount, 0);
    // The receipt is still written first: it is the record, and it is create-once, so the retry
    // that follows re-uses it rather than writing a second one.
    assert.equal(readReceipt(r2)?.reasonCode, "PARSER_OOM");
  });

  it("never acknowledges a refusal it could not record", async () => {
    const r2 = oversizedR2();
    r2.put = async () => { throw new Error("r2 unavailable"); };
    const message = queueMessage();
    const settlements: string[] = [];
    await handleQueue(message.batch, envFor(r2), async (input, init) => {
      if (String(input) === SETTLEMENT_URL) settlements.push(String(init?.body));
      return cleanCdrFetch(input, init);
    });
    assert.equal(message.counters.retryCount, 1);
    assert.equal(message.counters.ackCount, 0);
    assert.deepEqual(settlements, []);
  });

  it("gives every refusal the CDR service can raise exactly one frozen failure class", () => {
    const app = readFileSync(new URL("../../cdr-cloudrun/app.py", import.meta.url), "utf8");
    const raised = [...app.matchAll(/HTTPException\(\s*(\d{3})\s*,\s*"([^"]+)"/g)]
      .map(([, status, detail]) => ({ status: Number(status), detail }));
    assert.ok(raised.length >= 15, "the CDR service raises fewer refusals than expected");

    for (const { status, detail } of raised) {
      // 401/403 is our own credential problem and 5xx is the service being down. Neither is a
      // statement about the customer's document, so neither may be recorded as one.
      if (status < 400 || status === 401 || status === 403 || status >= 500) {
        assert.equal(
          detail in CDR_DETAIL_FAILURE_CLASS,
          false,
          `${detail} is an operational failure and must not carry a source failure class`,
        );
        continue;
      }
      assert.equal(
        detail in CDR_DETAIL_FAILURE_CLASS,
        true,
        `app.py raises "${detail}" and no frozen failure class is mapped to it`,
      );
    }

    for (const value of Object.values(CDR_DETAIL_FAILURE_CLASS)) {
      assert.equal((failureClasses as readonly string[]).includes(value), true, `${value} is not a frozen FailureClass`);
    }
  });

  it("does not invent a class for a refusal it has never seen", () => {
    assert.equal(cdrRefusalFailureClass(422, "CDR something nobody has written yet"), "CORRUPT_SOURCE");
    assert.equal(cdrRefusalFailureClass(422, null), "CORRUPT_SOURCE");
    assert.equal(cdrRefusalFailureClass(413, null), "PARSER_OOM");
    assert.equal(cdrRefusalFailureClass(415, null), "UNSUPPORTED_FORMAT");
  });

  it("retries rather than refusing the source when the CDR rejects this worker's credentials", async () => {
    const r2 = new FakeR2({ [SOURCE_KEY]: SOURCE_BYTES });
    await assert.rejects(
      () => sanitizeObject(envFor(r2), SOURCE_KEY, async () => new Response("nope", { status: 401 })),
      RetryableError,
    );
    assert.equal(r2.objects.has(cdrRejectSiblingKey(SOURCE_KEY) as string), false);
  });
});
