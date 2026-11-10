import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { RetryableError } from "./errors";
import { LARGE_SOURCE_MAX_BYTES, segmentManifestKey } from "./keys";
import { presignedGet, presignedSourceUrl, remoteSourceTransport, streamedSha256, SOURCE_URL_TTL_SECONDS } from "./remote-source";
import { SegmentContinuation, asSourceRefusal, sanitizeObject, type R2BucketLike, type R2ObjectLike, type SanitizeEnv } from "./sanitize";

/*
  Large-source bytes (docs/adr/0006-segmented-large-sources.md, "Large-source bytes"): with
  FOUNDATION_SOURCE_TRANSPORT=presigned the worker hashes the source as a stream, never holds it,
  and sends the CDR a presigned GET for the one object instead of the bytes.
*/

const SECRET = "foundation-cdr-hmac-fixture-secret-ok";
const CDR_URL = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/v1/disarm";
const REMOTE_URL = `${CDR_URL}-remote`;
const OCR_URL = "https://tavonel-foundation-ocr.example/v1/ocr";
const BUCKET = "tavonel-saas-foundation-quarantine";
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const SOURCE_KEY = "quarantine/ws_pilot/doc_1/source";
const MIB = 1024 * 1024;

/** The Workers runtime's incremental hash, for Node. Production has no such fallback. */
class NodeDigestStream extends WritableStream<Uint8Array> {
  readonly digest: Promise<ArrayBuffer>;
  constructor(algorithm: string) {
    assert.equal(algorithm, "SHA-256");
    const hash = createHash("sha256");
    let resolve!: (value: ArrayBuffer) => void;
    const digest = new Promise<ArrayBuffer>((done) => { resolve = done; });
    super({
      write(chunk) { hash.update(chunk); },
      close() { const bytes = hash.digest(); resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); },
    });
    this.digest = digest;
  }
}
const withDigestStream = () => Object.defineProperty(globalThis.crypto, "DigestStream", { value: NodeDigestStream, configurable: true });
const withoutDigestStream = () => delete (globalThis.crypto as unknown as { DigestStream?: unknown }).DigestStream;

/** `size` bytes of a repeating 1 MiB chunk, made as they are read: nothing holds the whole source. */
function lazySource(size: number) {
  const chunk = new Uint8Array(MIB).map((_, index) => index % 251);
  const hash = createHash("sha256");
  for (let sent = 0; sent < size; sent += MIB) hash.update(chunk.subarray(0, Math.min(MIB, size - sent)));
  return {
    sha256: `sha256:${hash.digest("hex")}`,
    stream(): ReadableStream<Uint8Array> {
      let sent = 0;
      return new ReadableStream({
        pull(controller) {
          if (sent >= size) return controller.close();
          const next = chunk.subarray(0, Math.min(MIB, size - sent));
          sent += next.byteLength;
          controller.enqueue(next);
        },
      });
    },
  };
}

class FakeR2 implements R2BucketLike {
  readonly objects = new Map<string, Uint8Array>();
  sourceReads = 0;
  constructor(readonly size: number, readonly source = lazySource(size)) {}
  async list({ prefix }: { prefix: string }) {
    return { objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
  }
  async get(key: string): Promise<R2ObjectLike | null> {
    if (key === SOURCE_KEY) {
      const bucket = this;
      let body: ReadableStream<Uint8Array> | undefined;
      return {
        size: this.size,
        httpMetadata: { contentType: "application/pdf", contentDisposition: 'attachment; filename="manual.pdf"' },
        arrayBuffer: async () => { throw new Error("the presigned transport must never hold the source"); },
        // One stream per get, as R2 gives, counted when first read.
        get body() {
          body ??= bucket.sourceStream();
          return body;
        },
      };
    }
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer } : null;
  }
  sourceStream() {
    this.sourceReads += 1;
    return this.source.stream();
  }
  async put(key: string, value: ArrayBuffer | Uint8Array, options: { onlyIf: { etagDoesNotMatch: string } }) {
    if (this.objects.has(key) && options.onlyIf.etagDoesNotMatch === "*") return null;
    this.objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
    return { etag: "new" };
  }
}
function envFor(r2: FakeR2, overrides: Partial<SanitizeEnv> = {}): SanitizeEnv {
  return {
    FOUNDATION_QUARANTINE: r2,
    TAVONEL_CDR_URL: CDR_URL,
    TAVONEL_CDR_PROVIDER: "tavonel_pdf_raster",
    FOUNDATION_R2_BUCKET: BUCKET,
    TAVONEL_CDR_HMAC: SECRET,
    FOUNDATION_OCR_URL: OCR_URL,
    FOUNDATION_SOURCE_TRANSPORT: "presigned",
    FOUNDATION_R2_ACCOUNT_ID: ACCOUNT,
    FOUNDATION_R2_READ_ACCESS_KEY_ID: "read-key-id",
    FOUNDATION_R2_READ_SECRET_ACCESS_KEY: "read-secret",
    ...overrides,
  };
}

const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

type CdrCall = { url: string; requestId: string; inputSha256: string; fields: Record<string, string>; blobs: number };

/**
 * A CDR that reads remote sources (or answers `refusal`), rendering the range a signed id names out
 * of a `pages`-page document, and a reader that reads whatever it is sent.
 */
function fakeChain(pages: number, refusal?: { status: number; detail: string; marked: boolean }) {
  const calls: CdrCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url === OCR_URL) {
      return Response.json({
        schemaVersion: "tavonel.ocr_result.v2", status: "ok", text: "TAVONEL OCR", pageCount: 1,
        inputSha256: headers.get("x-tavonel-input-sha256"),
        regions: [{ regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
          text: "TAVONEL OCR", bbox1000: [100, 100, 900, 200], confidence: 1, authority: "informal" }],
      });
    }
    const form = init?.body as FormData;
    const fields: Record<string, string> = {};
    let blobs = 0;
    form.forEach((value, name) => {
      if (typeof value === "string") fields[name] = value;
      else blobs += 1;
    });
    const requestId = headers.get("x-tavonel-cdr-request-id") ?? "";
    calls.push({ url, requestId, inputSha256: headers.get("x-tavonel-input-sha256") ?? "", fields, blobs });
    if (refusal) {
      return Response.json({ detail: refusal.detail }, {
        status: refusal.status, headers: refusal.marked ? { "x-tavonel-cdr-remote-source": "1", "x-tavonel-cdr-ranges": "1" } : {},
      });
    }
    const match = /_p(\d+)_(\d+)$/.exec(requestId);
    const end = match ? Math.min(Number(match[2]), pages) : pages;
    const body = new TextEncoder().encode(`%PDF-1.4 sanitized ${match ? `${match[1]}-${end}` : "whole"}`);
    return new Response(body, { status: 200, headers: {
      "content-type": "application/pdf",
      "x-tavonel-cdr-status": "clean",
      "x-tavonel-input-sha256": headers.get("x-tavonel-input-sha256") ?? "",
      "x-tavonel-cdr-output-sha256": sha(body),
      ...(match ? { "x-tavonel-cdr-source-pages": String(pages), "x-tavonel-cdr-page-range": `${match[1]}-${end}` } : {}),
    } });
  };
  return { calls, fetcher };
}

describe("large-source bytes: the presigned transport", () => {
  before(withDigestStream);
  after(withoutDigestStream);

  it("is off unless set, and refuses a configuration it cannot honour", () => {
    const on = { FOUNDATION_SOURCE_TRANSPORT: "presigned", FOUNDATION_R2_ACCOUNT_ID: ACCOUNT,
      FOUNDATION_R2_READ_ACCESS_KEY_ID: "id", FOUNDATION_R2_READ_SECRET_ACCESS_KEY: "secret" };
    assert.equal(remoteSourceTransport({}), null);
    assert.equal(remoteSourceTransport({ FOUNDATION_SOURCE_TRANSPORT: " " }), null);
    assert.deepEqual(remoteSourceTransport(on), { accountId: ACCOUNT, accessKeyId: "id", secretAccessKey: "secret" });
    for (const bad of [
      { FOUNDATION_SOURCE_TRANSPORT: "multipart" }, { FOUNDATION_SOURCE_TRANSPORT: "PRESIGNED" },
      { FOUNDATION_R2_ACCOUNT_ID: "not-an-account" }, { FOUNDATION_R2_READ_ACCESS_KEY_ID: "" },
      { FOUNDATION_R2_READ_SECRET_ACCESS_KEY: undefined }, { FOUNDATION_CDR_TEXT_LAYER_FIRST: "1" },
    ]) {
      assert.throws(() => remoteSourceTransport({ ...on, ...bad }), RetryableError, JSON.stringify(bad));
    }
  });

  it("signs a presigned GET exactly as AWS's published example does", async () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html, "An Example".
    const url = await presignedGet({
      host: "examplebucket.s3.amazonaws.com", path: "/test.txt", region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      now: new Date("2013-05-24T00:00:00Z"), expiresInSeconds: 86400,
    });
    assert.equal(url, "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256"
      + "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z"
      + "&X-Amz-Expires=86400&X-Amz-SignedHeaders=host"
      + "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });

  it("presigns one quarantine object, in the shape the CDR will read", async () => {
    const url = await presignedSourceUrl({ accountId: ACCOUNT, accessKeyId: "id", secretAccessKey: "secret" },
      BUCKET, SOURCE_KEY, new Date("2026-11-10T00:00:00Z"));
    // cdr-cloudrun/app.py qualified_remote_source_url, restated.
    assert.match(url, new RegExp(`^https://${ACCOUNT}\\.r2\\.cloudflarestorage\\.com/${BUCKET}/quarantine/ws_pilot/doc_1/source\\?`));
    const query = new URL(url).searchParams;
    assert.deepEqual([...query.keys()].sort(), ["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-Signature", "X-Amz-SignedHeaders"]);
    assert.equal(query.get("X-Amz-Expires"), String(SOURCE_URL_TTL_SECONDS));
    assert.ok(SOURCE_URL_TTL_SECONDS <= 900, "the CDR refuses a URL valid for longer than 15 minutes");
  });

  it("hashes a stream of exactly its reported size, and retries anything else", async () => {
    const source = lazySource(3 * MIB + 7);
    assert.equal(await streamedSha256(source.stream(), 3 * MIB + 7), source.sha256);
    await assert.rejects(streamedSha256(source.stream(), 3 * MIB + 8), RetryableError);
    await assert.rejects(streamedSha256(source.stream(), 3 * MIB), RetryableError);
    const broken = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("socket closed")); } });
    await assert.rejects(streamedSha256(broken, 1), RetryableError);
    withoutDigestStream();
    try {
      await assert.rejects(streamedSha256(source.stream(), 3 * MIB + 7), /DigestStream is unavailable/);
    } finally {
      withDigestStream();
    }
  });

  it("admits a 50 MiB source without ever holding it, and sends the CDR a URL instead of the bytes", async () => {
    const r2 = new FakeR2(LARGE_SOURCE_MAX_BYTES);
    const chain = fakeChain(12);
    const result = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetcher);
    assert.equal(result.status, "clean");
    assert.equal(result.inputSha256, r2.source.sha256);
    assert.equal(r2.sourceReads, 1, "one streamed pass to hash it; arrayBuffer() throws if called");
    assert.equal(chain.calls.length, 1);
    const [call] = chain.calls;
    assert.equal(call.url, REMOTE_URL);
    assert.equal(call.inputSha256, r2.source.sha256, "the CDR still checks the bytes it reads against this signed digest");
    assert.equal(call.blobs, 0, "no source part: the request carries no source bytes");
    assert.deepEqual(Object.keys(call.fields).sort(), ["content_type", "filename", "source_url"]);
    assert.deepEqual([call.fields.filename, call.fields.content_type], ["manual.pdf", "application/pdf"]);
    assert.ok(call.fields.source_url.startsWith(`https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}/${SOURCE_KEY}?`));
    assert.ok(JSON.stringify(call.fields).length < 2048);
  });

  it("refuses a source over 50 MiB by name, before reading it or calling the CDR", async () => {
    const r2 = new FakeR2(LARGE_SOURCE_MAX_BYTES + 1);
    const chain = fakeChain(1);
    const error = await sanitizeObject(envFor(r2), SOURCE_KEY, chain.fetcher).catch((caught: unknown) => caught);
    const refusal = asSourceRefusal(error);
    assert.equal(refusal?.failureClass, "PARSER_OOM");
    assert.equal(refusal?.observedBytes, LARGE_SOURCE_MAX_BYTES + 1);
    assert.match(String((error as Error).message), /50 MiB/);
    assert.equal(r2.sourceReads, 0);
    assert.equal(chain.calls.length, 0);
  });

  it("records the CDR's digest refusal against the source", async () => {
    const chain = fakeChain(1, { status: 422, detail: "CDR source digest does not match the uploaded body", marked: true });
    const error = await sanitizeObject(envFor(new FakeR2(6 * MIB)), SOURCE_KEY, chain.fetcher).catch((caught: unknown) => caught);
    assert.equal(asSourceRefusal(error)?.failureClass, "RECEIPT_MISMATCH");
  });

  it("retries a store, transport or deploy-order failure, and never refuses the source for one", async () => {
    for (const answer of [
      { status: 502, detail: "CDR remote source could not be read", marked: true },
      { status: 503, detail: "CDR remote source is disabled", marked: true },
      // A CDR revision without the route: 404 with no marker is our deploy order, not the document.
      { status: 404, detail: "Not Found", marked: false },
    ]) {
      const chain = fakeChain(1, answer);
      const error = await sanitizeObject(envFor(new FakeR2(6 * MIB)), SOURCE_KEY, chain.fetcher).catch((caught: unknown) => caught);
      assert.ok(error instanceof RetryableError, JSON.stringify(answer));
      assert.equal(asSourceRefusal(error), null, JSON.stringify(answer));
    }
    const unreachable: typeof fetch = async () => { throw new TypeError("network connection lost"); };
    await assert.rejects(sanitizeObject(envFor(new FakeR2(6 * MIB)), SOURCE_KEY, unreachable), RetryableError);
  });

  it("refuses the transport beside the text-layer shadow before reading or paying for anything", async () => {
    const r2 = new FakeR2(6 * MIB);
    const chain = fakeChain(1);
    await assert.rejects(sanitizeObject(envFor(r2, { FOUNDATION_CDR_TEXT_LAYER_FIRST: "1" }), SOURCE_KEY, chain.fetcher),
      /FOUNDATION_CDR_TEXT_LAYER_FIRST/);
    assert.equal(r2.sourceReads, 0);
    assert.equal(chain.calls.length, 0);
  });

  it("reads a segmented source range by range, a fresh URL per range and never the bytes", async () => {
    const r2 = new FakeR2(40 * MIB);
    const chain = fakeChain(200);
    const env = envFor(r2, {
      FOUNDATION_SOURCE_SEGMENT_PAGES: "80",
      FOUNDATION_SEGMENT_CONTINUATION: { send: async () => undefined },
    });
    let result;
    for (let delivery = 1; !result && delivery <= 5; delivery += 1) {
      result = await sanitizeObject(env, SOURCE_KEY, chain.fetcher, undefined, () => crypto.randomUUID())
        .catch((error: unknown) => { if (error instanceof SegmentContinuation) return undefined; throw error; });
    }
    assert.equal(result?.immutableKey, segmentManifestKey("ws_pilot", "doc_1"));
    assert.deepEqual(chain.calls.map((call) => call.requestId.replace(/^.*_p/, "p")), ["p0_80", "p80_160", "p160_240"]);
    assert.ok(chain.calls.every((call) => call.url === REMOTE_URL && call.blobs === 0 && call.inputSha256 === r2.source.sha256));
    assert.equal(r2.sourceReads, 3, "hashed once per delivery as a stream, held by none");
  });
});

describe("large-source bytes: off", () => {
  it("sends the source in the multipart body, to /v1/disarm, exactly as before", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 small source");
    const calls: Array<{ url: string; blobs: number }> = [];
    const r2: R2BucketLike = {
      get: async (key) => key === SOURCE_KEY
        ? { size: bytes.byteLength, httpMetadata: { contentType: "application/pdf" }, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }
        : null,
      list: async () => ({ objects: [] }),
      put: async () => ({ etag: "new" }),
    };
    const fetcher: typeof fetch = async (input, init) => {
      const form = init?.body as FormData;
      let blobs = 0;
      form.forEach((value) => { if (typeof value !== "string") blobs += 1; });
      calls.push({ url: String(input), blobs });
      return new Response("unavailable", { status: 503 });
    };
    const env: SanitizeEnv = { ...envFor(new FakeR2(1)), FOUNDATION_QUARANTINE: r2, FOUNDATION_SOURCE_TRANSPORT: undefined };
    await assert.rejects(sanitizeObject(env, SOURCE_KEY, fetcher), RetryableError);
    assert.deepEqual(calls, [{ url: CDR_URL, blobs: 1 }]);
  });
});
