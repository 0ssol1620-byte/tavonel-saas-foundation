import { afterEach, describe, expect, it, vi } from "vitest";
import { FOUNDATION_R2_BUCKET } from "./r2-synthetic-canary";
import {
  assertFoundationListPrefix,
  getWorkspaceCollectionCandidate,
  getWorkspaceOcrJson,
  listImmutableWorkspaceObjects,
  MAX_COLLECTION_JSON_BYTES,
  MAX_DERIVED_JSON_BYTES,
  putWorkspaceCollectionCandidate,
} from "./r2-objects";

const WS = "pilot-abc";

afterEach(() => vi.unstubAllGlobals());

describe("R2 document listing prefix", () => {
  it("refuses production buckets and mismatched prefixes", () => {
    expect(assertFoundationListPrefix("tavonel-prod-quarantine", WS, `immutable/${WS}/${WS}/`)).toBe(
      "BUCKET_NOT_FOUNDATION",
    );
    expect(assertFoundationListPrefix(FOUNDATION_R2_BUCKET, WS, "immutable/other/other/")).toBe(
      "WORKSPACE_PREFIX_REQUIRED",
    );
    expect(assertFoundationListPrefix(FOUNDATION_R2_BUCKET, WS, `immutable/${WS}/${WS}/`)).toBeNull();
  });

  it("refuses candidate reads that leave the workspace or target a PDF", async () => {
    const env = {
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    const escaped = await getWorkspaceOcrJson(
      env,
      WS,
      `immutable/other/other/doc/${"ab".repeat(32)}/ocr.json`,
    );
    expect(escaped).toEqual({ ok: false, code: "OCR_JSON_PREFIX_REQUIRED" });
    const pdf = await getWorkspaceOcrJson(
      env,
      WS,
      `immutable/${WS}/${WS}/doc/${"ab".repeat(32)}/sanitized.pdf`,
    );
    expect(pdf).toEqual({ ok: false, code: "OCR_JSON_PREFIX_REQUIRED" });
  });

  it("refuses collection candidate reads and writes outside the workspace", async () => {
    const env = {
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    const foreign = `immutable/other/other/collections/collection-${"ab".repeat(16)}/${"cd".repeat(32)}/candidate-world.json`;
    await expect(getWorkspaceCollectionCandidate(env, WS, foreign)).resolves.toEqual({ ok: false, code: "COLLECTION_JSON_PREFIX_REQUIRED" });
    await expect(putWorkspaceCollectionCandidate(env, WS, foreign, {})).resolves.toEqual({ ok: false, code: "COLLECTION_JSON_PREFIX_REQUIRED" });
  });

  it("lists 1,000-key pages and follows a continuation token", async () => {
    const env = {
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    const prefix = `immutable/${WS}/${WS}/`;
    const firstKey = `${prefix}doc-a/${"ab".repeat(32)}/sanitized.pdf`;
    const secondKey = `${prefix}doc-b/${"cd".repeat(32)}/ocr.json`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next page</NextContinuationToken><Contents><Key>${firstKey}</Key><LastModified>2026-09-09T00:00:00.000Z</LastModified><Size>12</Size></Contents></ListBucketResult>`,
        { status: 200 },
      ))
      .mockResolvedValueOnce(new Response(
        `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${secondKey}</Key><LastModified>2026-09-10T00:00:00.000Z</LastModified><Size>34</Size></Contents></ListBucketResult>`,
        { status: 200 },
      ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listImmutableWorkspaceObjects(env, WS)).resolves.toEqual({
      ok: true,
      objects: [
        { key: firstKey, size: 12, lastModified: "2026-09-09T00:00:00.000Z" },
        { key: secondKey, size: 34, lastModified: "2026-09-10T00:00:00.000Z" },
      ],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("max-keys=1000");
    expect(String(fetchMock.mock.calls[1][0])).toContain("continuation-token=next%20page");
  });

  it("refuses an inventory that is still truncated after the eighth page", async () => {
    const env = {
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    const prefix = `immutable/${WS}/${WS}/`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>more</NextContinuationToken><Contents><Key>${prefix}doc-a/${"ab".repeat(32)}/sanitized.pdf</Key><Size>12</Size></Contents></ListBucketResult>`,
      { status: 200 },
    )));

    await expect(listImmutableWorkspaceObjects(env, WS)).resolves.toEqual({
      ok: false,
      code: "LIST_LIMIT_EXCEEDED",
    });
  });

  it("refuses a truncated response without a continuation token", async () => {
    const env = {
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>",
      { status: 200 },
    )));

    await expect(listImmutableWorkspaceObjects(env, WS)).resolves.toEqual({ ok: false, code: "LIST_INVALID" });
  });

  it("writes a create-once collection candidate with a signed workspace key", async () => {
    const env = {
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    const key = `immutable/${WS}/${WS}/collections/collection-${"ab".repeat(16)}/${"cd".repeat(32)}/candidate-world.json`;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      expect(new Headers(init?.headers).get("if-none-match")).toBe("*");
      expect(new Headers(init?.headers).get("authorization")).toContain("AWS4-HMAC-SHA256");
      expect(Buffer.from(init?.body as Uint8Array).toString("utf8")).toBe('{"status":"candidate"}\n');
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(putWorkspaceCollectionCandidate(env, WS, key, { status: "candidate" })).resolves.toEqual({
      ok: true,
      status: "written",
      bytes: 23,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [403, "GET_FORBIDDEN"],
    [500, "GET_FAILED_500"],
    [599, "GET_TIMEOUT"],
  ])("preserves safe collection read failure detail for HTTP %s", async (status, code) => {
    const env = {
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    const key = `immutable/${WS}/${WS}/collections/collection-${"ab".repeat(16)}/${"cd".repeat(32)}/candidate-world.json`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));

    await expect(getWorkspaceCollectionCandidate(env, WS, key)).resolves.toEqual({ ok: false, code });
  });

  it("allows bounded collection candidates larger than the OCR JSON limit", async () => {
    const env = {
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    const key = `immutable/${WS}/${WS}/collections/collection-${"ab".repeat(16)}/${"cd".repeat(32)}/candidate-world.json`;
    const artifact = { payload: "x".repeat(MAX_DERIVED_JSON_BYTES + 1) };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(artifact)));

    await expect(getWorkspaceCollectionCandidate(env, WS, key)).resolves.toEqual({ ok: true, json: artifact });
  });
});

describe("bounded streaming OCR reads", () => {
  const env = { accountId: "acct", bucket: FOUNDATION_R2_BUCKET, accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" };
  const key = `immutable/${WS}/${WS}/doc/${"ab".repeat(32)}/ocr.json`;
  it("returns the actual streamed byte length for the collection budget", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"ok":true}'));
    expect(await getWorkspaceOcrJson(env, WS, key, new Date(), 20)).toEqual({ ok: true, json: { ok: true }, byteLength: 11 });
  });
  it.each([undefined, "1", "-1", "999999"])("does not trust declared length %s and cancels overflow", async (length) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(40))); }, cancel,
    }), { headers: length === undefined ? {} : { "content-length": length } });
    vi.stubGlobal("fetch", async () => response);
    expect(await getWorkspaceOcrJson(env, WS, key, new Date(), 20)).toEqual({
      ok: false, code: "JSON_TOO_LARGE",
      sizeLimit: { object: "ocr.json", bytes: length === undefined || length === "-1" ? null : Number(length), bound: 20 },
    });
    expect(cancel).toHaveBeenCalled();
  });
  it("measures fetched decompressed body bytes rather than a compressed content-length", async () => {
    vi.stubGlobal("fetch", async () => new Response("x".repeat(40), { headers: { "content-encoding": "gzip", "content-length": "1" } }));
    expect(await getWorkspaceOcrJson(env, WS, key, new Date(), 20)).toEqual({
      ok: false, code: "JSON_TOO_LARGE", sizeLimit: { object: "ocr.json", bytes: 1, bound: 20 },
    });
  });
});

/*
  The read bound must admit every ocr.json the worker can store for a source the product accepts.

  The densest one the worker's own caps allow (src/ocr.ts: 80 pages, 50,000 regions, 4,000,000
  text characters) is 625 regions a page of 79 characters each. cjob-1e8b7a0e (2026-11-04) is the
  incident that asked the question; its 12-page scan is a few hundred kilobytes of this.
*/
describe("the ocr.json read bound against the intake ceiling", () => {
  const env = { accountId: "acct", bucket: FOUNDATION_R2_BUCKET, accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" };
  const key = `immutable/${WS}/${WS}/doc/${"ab".repeat(32)}/ocr.json`;
  const sha = "ab".repeat(32);
  const densest80Pages = () => {
    const line = "Line of a scanned ledger 2026-11-04 amount 1,234.56 KRW ref ".padEnd(79, "x");
    const regions = Array.from({ length: 80 * 625 }, (_, index) => ({
      regionId: `ocr-${sha.slice(0, 16)}-p${String(Math.floor(index / 625) + 1).padStart(4, "0")}-r${String(index % 625).padStart(4, "0")}`,
      pageIndex0: Math.floor(index / 625), pageNumber1: Math.floor(index / 625) + 1, order: index % 625,
      blockType: "text", text: line, bbox1000: [123, 456, 789, 512], confidence: 0.9876543210123456, authority: "ocr_primary",
    }));
    return { schemaVersion: "tavonel.ocr_result.v2", status: "ok", text: regions.map((region) => region.text).join("\n"),
      pageCount: 80, inputSha256: `sha256:${sha}`, sourceImmutableKey: `immutable/${WS}/${WS}/doc/${sha}/sanitized.pdf`, regions };
  };
  const serve = (body: string) => vi.stubGlobal("fetch", async () =>
    new Response(body, { headers: { "content-length": String(Buffer.byteLength(body, "utf8")) } }));

  it("is the worker's persisted-OCR bound, not a sixth of it", () => {
    expect(MAX_DERIVED_JSON_BYTES).toBe(24 * 1024 * 1024);
    expect(MAX_DERIVED_JSON_BYTES).toBeLessThan(MAX_COLLECTION_JSON_BYTES);
  });

  it("reads the densest 80-page ocr.json the worker can produce", async () => {
    const body = JSON.stringify(densest80Pages());
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(4 * 1024 * 1024);
    serve(body);
    const read = await getWorkspaceOcrJson(env, WS, key);
    expect(read.ok).toBe(true);
    if (read.ok) expect((read.json as { regions: unknown[] }).regions).toHaveLength(50_000);
  });

  it("reads a body of exactly the bound and refuses one byte more, naming the object and its size", async () => {
    const json = JSON.stringify(densest80Pages());
    const exact = json.padEnd(MAX_DERIVED_JSON_BYTES, " ");
    serve(exact);
    expect((await getWorkspaceOcrJson(env, WS, key)).ok).toBe(true);
    serve(`${exact} `);
    expect(await getWorkspaceOcrJson(env, WS, key)).toEqual({
      ok: false, code: "JSON_TOO_LARGE",
      sizeLimit: { object: "ocr.json", bytes: MAX_DERIVED_JSON_BYTES + 1, bound: MAX_DERIVED_JSON_BYTES },
    });
  });

  it("refuses a candidate over its bound with the exact byte count", async () => {
    const candidateKey = `immutable/${WS}/${WS}/collections/collection-${"ab".repeat(16)}/${"cd".repeat(32)}/candidate-world.json`;
    const value = { payload: "x".repeat(MAX_COLLECTION_JSON_BYTES) };
    const put = vi.fn();
    vi.stubGlobal("fetch", put);
    const bytes = Buffer.byteLength(`${JSON.stringify(value)}\n`, "utf8");
    expect(await putWorkspaceCollectionCandidate(env, WS, candidateKey, value)).toEqual({
      ok: false, code: "JSON_TOO_LARGE", sizeLimit: { object: "candidate-world.json", bytes, bound: MAX_COLLECTION_JSON_BYTES },
    });
    expect(put).not.toHaveBeenCalled();
  });
});
