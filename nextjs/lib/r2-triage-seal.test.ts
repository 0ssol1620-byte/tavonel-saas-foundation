import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FOUNDATION_R2_BUCKET, readFoundationTriageStagingObject, sealFoundationTriageSource } from "./r2-synthetic-canary";

const env = {
  accountId: "0123456789abcdef0123456789abcdef",
  bucket: FOUNDATION_R2_BUCKET,
  accessKeyId: "fixture-access-key",
  secretAccessKey: "fixture-secret-key",
};
const workspaceKey = "pilot-abc123";
const documentId = "44444444-4444-4444-8444-444444444444";
const mimeType = "application/pdf";
const bytes = Buffer.from("%PDF");
const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("sealFoundationTriageSource", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("refuses an overwrite attempt when the final key already contains different bytes", async () => {
    const existing = Buffer.from("NOPE");
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(existing, {
      status: 200,
      headers: { "content-length": String(existing.length), "content-type": mimeType, etag: '"old-version"' },
    }));
    vi.stubGlobal("fetch", fetch);
    const result = await sealFoundationTriageSource(env, { workspaceKey, documentId, bytes, sha256, mimeType });
    expect(result).toEqual({ ok: false, code: "TRIAGE_SEAL_CONFLICT" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("treats a retry with the same final bytes as an idempotent replay", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(bytes, {
      status: 200,
      headers: { "content-length": String(bytes.length), "content-type": mimeType, etag: '"same-version"' },
    }));
    vi.stubGlobal("fetch", fetch);
    const result = await sealFoundationTriageSource(env, { workspaceKey, documentId, bytes, sha256, mimeType });
    expect(result).toMatchObject({ ok: true, replay: true, key: `quarantine/${workspaceKey}/${documentId}/source`, sha256 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a late staging overwrite out of the accepted final bytes", async () => {
    const lateBytes = Buffer.from("LATE");
    let staging = bytes;
    let sealed: Buffer | null = null;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (url.pathname.includes("triage-staging")) {
        return new Response(staging, { status: 200, headers: {
          "content-length": String(staging.length), "content-type": mimeType, etag: '"stage-v1"',
        } });
      }
      if (method === "PUT") {
        sealed = Buffer.from(init?.body as Uint8Array);
        return new Response(null, { status: 200 });
      }
      if (sealed === null) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(sealed), { status: 200, headers: {
        "content-length": String(sealed.length), "content-type": mimeType, etag: '"final-v1"',
      } });
    });
    vi.stubGlobal("fetch", fetch);
    const observed = await readFoundationTriageStagingObject(env, {
      workspaceKey, stageId: "55555555-5555-4555-8555-555555555555", expectedBytes: bytes.length, mimeType,
    });
    expect(observed).toMatchObject({ ok: true, sha256 });
    if (!observed.ok) return;
    staging = lateBytes;
    const result = await sealFoundationTriageSource(env, {
      workspaceKey, documentId, bytes: observed.bytes, sha256: observed.sha256, mimeType,
    });
    expect(result).toMatchObject({ ok: true, replay: false, sha256 });
    expect(staging).toEqual(lateBytes);
    expect(sealed).toEqual(bytes);
  });
});
