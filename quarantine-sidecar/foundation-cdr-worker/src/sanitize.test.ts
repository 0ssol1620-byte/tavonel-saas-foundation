import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { PermanentReject, RetryableError } from "./errors";
import { cdrRequestSignature, sha256DigestHeader } from "./hmac";
import { handleQueue, handleRequest, type Env } from "./index";
import { immutableObjectKey } from "./keys";
import { sanitizeObject, type R2BucketLike, type R2ObjectLike } from "./sanitize";

const FIXTURE_SECRET = "foundation-cdr-hmac-fixture-secret-ok";
const SYNTHETIC_URL = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/v1/disarm";
const SYNTHETIC_HEALTH = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/health";
const PROD_URL = "https://tavonel-pdf-cdr.example.run.app/v1/disarm";
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
      arrayBuffer: async () => found.bytes.buffer.slice(found.bytes.byteOffset, found.bytes.byteOffset + found.bytes.byteLength),
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
    assert.equal(r2.objects.has(SOURCE_KEY), true);
    assert.equal(r2.deleted.length, 0);
    assert.equal(r2.puts[0]?.key, expectedImmutable);
    assert.equal(r2.puts[0]?.options.onlyIf?.etagDoesNotMatch, "*");
    assert.equal(r2.puts[0]?.options.customMetadata?.stage, "immutable-approved");
    assert.equal(sawLiveHost, false);
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
        headers: { "content-type": "application/json" },
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
      },
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
      },
      envFor(r2),
      async () => new Response("no", { status: 502 }),
    );
    assert.equal(failed.retryCount, 1);
    assert.equal(failed.ackCount, 0);
  });
});