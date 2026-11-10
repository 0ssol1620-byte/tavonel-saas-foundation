import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FOUNDATION_R2_BUCKET, putFoundationSourceApproval, readFoundationTriageStagingObject, sealFoundationTriageSource } from "./r2-synthetic-canary";

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

describe("putFoundationSourceApproval (ADR-0006 F1)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  const approval = {
    schemaVersion: "tavonel.source_approval.v1" as const, documentId, approvedMaxPages: 240,
    pageBasis: "declared" as const, reservedCredits: 960, maximumCredits: 1440,
  };
  const written = Buffer.from(`${JSON.stringify(approval)}\n`);

  it("writes create-once beside the source, never at the source key", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await putFoundationSourceApproval(env, workspaceKey, approval)).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe(`/${FOUNDATION_R2_BUCKET}/quarantine/${workspaceKey}/${documentId}/approval.json`);
    expect(init?.method).toBe("PUT");
    expect((init?.headers as Record<string, string>)["if-none-match"]).toBe("*");
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(written);
  });

  it("accepts a replay that finds the same approval, and refuses a different one", async () => {
    for (const [existing, expected] of [
      [written, { ok: true }],
      [Buffer.from(JSON.stringify({ ...approval, approvedMaxPages: 80 })), { ok: false, code: "SOURCE_APPROVAL_CONFLICT" }],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT"
        ? new Response(null, { status: 412 }) : new Response(existing, { status: 200 })));
      expect(await putFoundationSourceApproval(env, workspaceKey, approval)).toEqual(expected);
    }
  });

  it("fails closed on a failed write and on an approval it would not let the worker read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    expect(await putFoundationSourceApproval(env, workspaceKey, approval)).toEqual({ ok: false, code: "SOURCE_APPROVAL_WRITE_FAILED" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const bad of [{ ...approval, approvedMaxPages: 0 }, { ...approval, documentId: "../other" }]) {
      expect(await putFoundationSourceApproval(env, workspaceKey, bad)).toEqual({ ok: false, code: "SOURCE_APPROVAL_INVALID" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
