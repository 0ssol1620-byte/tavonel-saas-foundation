import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPreferredCollectionCandidate } from "./collection-storage";
import { FOUNDATION_R2_BUCKET } from "./r2-synthetic-canary";

afterEach(() => vi.unstubAllGlobals());

describe("collection candidate storage", () => {
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
