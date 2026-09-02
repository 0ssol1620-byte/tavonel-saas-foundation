import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPreferredCollectionCandidate } from "./collection-storage";
import { FOUNDATION_R2_BUCKET } from "./r2-synthetic-canary";

afterEach(() => vi.unstubAllGlobals());

describe("collection candidate storage", () => {
  it("loads the exact digest-bound candidate without collection preference ambiguity", async () => {
    const workspaceId = "pilot-abc";
    const collectionId = `collection-${"ab".repeat(16)}`;
    const manifestDigest = `sha256:${"ef".repeat(32)}`;
    const artifact = { collectionId, manifestDigest, lifecycle: "review_required" };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).not.toContain("list-type=2");
      expect(String(url)).toContain(`/collections/${collectionId}/${"ef".repeat(32)}/candidate-world.json`);
      return Response.json(artifact);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadPreferredCollectionCandidate({
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    }, workspaceId, collectionId, manifestDigest);

    expect(result).toMatchObject({ ok: true, value: { artifact } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an invalid requested manifest before reading R2", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPreferredCollectionCandidate({
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    }, "pilot-abc", `collection-${"ab".repeat(16)}`, "sha256:not-a-digest"))
      .resolves.toEqual({ ok: false, code: "MANIFEST_DIGEST_INVALID" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves a safe R2 candidate read failure code", async () => {
    const workspaceId = "pilot-abc";
    const collectionId = `collection-${"ab".repeat(16)}`;
    const key = `immutable/${workspaceId}/${workspaceId}/collections/${collectionId}/${"cd".repeat(32)}/candidate-world.json`;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("list-type=2")) {
        return new Response(
          `<ListBucketResult><Contents><Key>${key}</Key><Size>1024</Size></Contents><IsTruncated>false</IsTruncated></ListBucketResult>`,
          { status: 200 },
        );
      }
      return new Response(null, { status: 403 });
    }));

    await expect(loadPreferredCollectionCandidate({
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    }, workspaceId, collectionId)).resolves.toEqual({ ok: false, code: "GET_FORBIDDEN" });
  });
});
