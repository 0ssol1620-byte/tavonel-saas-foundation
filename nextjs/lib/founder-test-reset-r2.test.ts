import { afterEach, describe, expect, it, vi } from "vitest";
import { founderResetPrefixes, listFounderResetObjects } from "./r2-synthetic-canary";

const env = { accountId: "acct", bucket: "tavonel-saas-foundation-quarantine", accessKeyId: "key", secretAccessKey: "secret" };
const workspace = "pilot-1234567890abcd";

describe("founder reset R2 inventory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses only the exact quarantine and immutable workspace roots", () => {
    expect(founderResetPrefixes(workspace)).toEqual([
      `quarantine/${workspace}/`, `immutable/${workspace}/${workspace}/`,
    ]);
    expect(founderResetPrefixes("../other")).toBeNull();
  });

  it("paginates both roots and returns a sorted exact key manifest", async () => {
    const responses = [
      `<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>quarantine/${workspace}/b/source</Key></Contents><NextContinuationToken>next&amp;1</NextContinuationToken></ListBucketResult>`,
      `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>quarantine/${workspace}/a/source</Key></Contents></ListBucketResult>`,
      `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>immutable/${workspace}/${workspace}/d/v/ocr.json</Key></Contents></ListBucketResult>`,
    ];
    const fetchMock = vi.fn(async () => new Response(responses.shift(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await listFounderResetObjects(env, workspace, new Date("2026-09-20T00:00:00Z"));
    expect(result).toEqual({ ok: true, keys: [
      `immutable/${workspace}/${workspace}/d/v/ocr.json`,
      `quarantine/${workspace}/a/source`, `quarantine/${workspace}/b/source`,
    ] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL]>;
    expect(String(calls[1]?.[0])).toContain("continuation-token=next%261");
  });
});
