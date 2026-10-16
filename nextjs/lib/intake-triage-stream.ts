import { createHash } from "node:crypto";

/** One bounded R2 byte range. Implementations must not silently turn a range request into a full GET. */
export type QuarantineRange = {
  status: number;
  contentRange: string | null;
  etag: string | null;
  bytes: Uint8Array;
};

export type QuarantineRangeReader = (start: number, end: number) => Promise<QuarantineRange>;

export type VerifiedQuarantineDigest = {
  contentSha256: `sha256:${string}`;
  byteLength: number;
  etag: string;
  rangeCount: number;
};

/**
 * Hash an already-uploaded quarantine object in small exact ranges. It never buffers the whole
 * object, decompresses archives, or invokes a classifier/provider. The caller must bind the
 * reader to the authenticated workspace and server-minted object key, and compare this result
 * with the authenticated admission's expected length before issuing a triage receipt.
 */
export async function hashBoundedQuarantineObject(input: {
  byteLength: number;
  maxBytes: number;
  readRange: QuarantineRangeReader;
  chunkBytes?: number;
}): Promise<{ ok: true; value: VerifiedQuarantineDigest } | { ok: false; code: string }> {
  const chunkBytes = input.chunkBytes ?? 256 * 1024;
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1
    || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1
    || input.byteLength > input.maxBytes
    || !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 1024 * 1024) {
    return { ok: false, code: "TRIAGE_BYTE_LIMIT_INVALID" };
  }

  const hash = createHash("sha256");
  let etag: string | null = null;
  let rangeCount = 0;
  for (let start = 0; start < input.byteLength; start += chunkBytes) {
    const end = Math.min(input.byteLength - 1, start + chunkBytes - 1);
    let range: QuarantineRange;
    try {
      range = await input.readRange(start, end);
    } catch {
      return { ok: false, code: "TRIAGE_BYTE_READ_FAILED" };
    }
    const expectedBytes = end - start + 1;
    const expectedRange = `bytes ${start}-${end}/${input.byteLength}`;
    if (range.status !== 206 || range.contentRange !== expectedRange || range.bytes.byteLength !== expectedBytes
      || typeof range.etag !== "string" || range.etag.length < 1) {
      return { ok: false, code: "TRIAGE_BYTE_RANGE_INVALID" };
    }
    if (etag !== null && etag !== range.etag) return { ok: false, code: "TRIAGE_OBJECT_CHANGED" };
    etag = range.etag;
    hash.update(range.bytes);
    rangeCount += 1;
  }
  if (etag === null) return { ok: false, code: "TRIAGE_BYTE_READ_FAILED" };
  return {
    ok: true,
    value: {
      contentSha256: `sha256:${hash.digest("hex")}`,
      byteLength: input.byteLength,
      etag,
      rangeCount,
    },
  };
}
