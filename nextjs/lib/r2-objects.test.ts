import { afterEach, describe, expect, it, vi } from "vitest";
import { FOUNDATION_R2_BUCKET } from "./r2-synthetic-canary";
import { assertFoundationListPrefix, getWorkspaceCollectionCandidate, getWorkspaceOcrJson, listImmutableWorkspaceObjects, putWorkspaceCollectionCandidate } from "./r2-objects";

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
        `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next page</NextContinuationToken><Contents><Key>${firstKey}</Key><Size>12</Size></Contents></ListBucketResult>`,
        { status: 200 },
      ))
      .mockResolvedValueOnce(new Response(
        `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${secondKey}</Key><Size>34</Size></Contents></ListBucketResult>`,
        { status: 200 },
      ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listImmutableWorkspaceObjects(env, WS)).resolves.toEqual({
      ok: true,
      objects: [{ key: firstKey, size: 12 }, { key: secondKey, size: 34 }],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("max-keys=1000");
    expect(String(fetchMock.mock.calls[1][0])).toContain("continuation-token=next%20page");
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
    const artifact = { payload: "x".repeat(4 * 1024 * 1024) };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(artifact)));

    await expect(getWorkspaceCollectionCandidate(env, WS, key)).resolves.toEqual({ ok: true, json: artifact });
  });
});
