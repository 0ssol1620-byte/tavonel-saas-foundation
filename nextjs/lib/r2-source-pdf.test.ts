import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { getWorkspaceSanitizedPdf } from "./r2-objects";
import { FOUNDATION_R2_BUCKET } from "./r2-synthetic-canary";
const env = { bucket: FOUNDATION_R2_BUCKET, accountId: "account", accessKeyId: "test", secretAccessKey: "test" };
const workspace = "pilot-acme01";
const bytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
const digest = createHash("sha256").update(bytes).digest("hex");
const key = `immutable/${workspace}/${workspace}/document/${digest}/sanitized.pdf`;
afterEach(() => vi.unstubAllGlobals());
it("returns exact binary bytes only when they match the immutable digest", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes)); vi.stubGlobal("fetch", fetcher);
  expect(await getWorkspaceSanitizedPdf(env, workspace, key)).toEqual({ ok: true, bytes });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
});
it("refuses substituted bytes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))));
  expect(await getWorkspaceSanitizedPdf(env, workspace, key)).toEqual({ ok: false, code: "SOURCE_DIGEST_MISMATCH" });
});
it("refuses foreign workspace keys before network", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect((await getWorkspaceSanitizedPdf(env, "pilot-other01", key)).ok).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});
