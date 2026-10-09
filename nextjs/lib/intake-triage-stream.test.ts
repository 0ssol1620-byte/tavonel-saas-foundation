import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { hashBoundedQuarantineObject, type QuarantineRange } from "./intake-triage-stream";

function rangeReader(bytes: Uint8Array, opts: { etags?: string[]; status?: number; badContentRange?: boolean } = {}) {
  let calls = 0;
  return async (start: number, end: number): Promise<QuarantineRange> => {
    const etag = opts.etags?.[calls] ?? '"stable"';
    calls += 1;
    return {
      status: opts.status ?? 206,
      contentRange: opts.badContentRange ? "bytes 0-0/1" : `bytes ${start}-${end}/${bytes.byteLength}`,
      etag,
      bytes: bytes.slice(start, end + 1),
    };
  };
}

describe("hashBoundedQuarantineObject", () => {
  it("hashes only exact bounded 206 ranges and returns a server digest", async () => {
    const bytes = new TextEncoder().encode("server checked bytes");
    const result = await hashBoundedQuarantineObject({
      byteLength: bytes.byteLength,
      maxBytes: 128,
      chunkBytes: 7,
      readRange: rangeReader(bytes),
    });
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(result).toEqual({
      ok: true,
      value: { contentSha256: `sha256:${digest}`, byteLength: bytes.byteLength, etag: '"stable"', rangeCount: 3 },
    });
  });

  it("rejects over-limit inventory before making a range request", async () => {
    let calls = 0;
    const result = await hashBoundedQuarantineObject({
      byteLength: 129,
      maxBytes: 128,
      readRange: async () => { calls += 1; throw new Error("must not read"); },
    });
    expect(result).toEqual({ ok: false, code: "TRIAGE_BYTE_LIMIT_INVALID" });
    expect(calls).toBe(0);
  });

  it("fails closed on a full-object response or malformed range", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(hashBoundedQuarantineObject({
      byteLength: 3, maxBytes: 3, readRange: rangeReader(bytes, { status: 200 }),
    })).resolves.toEqual({ ok: false, code: "TRIAGE_BYTE_RANGE_INVALID" });
    await expect(hashBoundedQuarantineObject({
      byteLength: 3, maxBytes: 3, readRange: rangeReader(bytes, { badContentRange: true }),
    })).resolves.toEqual({ ok: false, code: "TRIAGE_BYTE_RANGE_INVALID" });
  });

  it("rejects an object whose ETag changes between ranges", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await hashBoundedQuarantineObject({
      byteLength: 4,
      maxBytes: 4,
      chunkBytes: 2,
      readRange: rangeReader(bytes, { etags: ['"first"', '"second"'] }),
    });
    expect(result).toEqual({ ok: false, code: "TRIAGE_OBJECT_CHANGED" });
  });
});
