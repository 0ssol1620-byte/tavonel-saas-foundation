import { afterEach, describe, expect, it, vi } from "vitest";
import { FOUNDATION_R2_BUCKET, readFoundationQuarantineObject } from "./r2-synthetic-canary";

const signer = {
  accountId: "account-id",
  bucket: FOUNDATION_R2_BUCKET,
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
};
const workspaceKey = "pilot-4444444444444444";
const documentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("bounded quarantine source read", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns only a source object within the intake ceiling", async () => {
    const bytes = Buffer.from("customer source", "utf8");
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: { "content-length": String(bytes.length) },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readFoundationQuarantineObject(signer, workspaceKey, documentId))
      .resolves.toEqual({ ok: true, bytes });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/quarantine/${workspaceKey}/${documentId}/source`),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("refuses a declared object larger than the five MiB intake ceiling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: { "content-length": String(5 * 1024 * 1024 + 1) },
    })));
    await expect(readFoundationQuarantineObject(signer, workspaceKey, documentId))
      .resolves.toEqual({ ok: false, code: "QUARANTINE_OBJECT_TOO_LARGE" });
  });
});
