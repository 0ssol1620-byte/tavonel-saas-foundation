import { describe, expect, it } from "vitest";
import { PROCESSING_CEILING } from "../../shared/intakeCeiling";
import { FOUNDATION_R2_BUCKET } from "./r2-synthetic-canary";
import {
  FOUNDATION_INTAKE_MAX_BYTES,
  FOUNDATION_TRIAL_INTAKE_MAX_BYTES,
  assertFoundationQuarantineKey,
  presignFoundationQuarantinePut,
} from "./r2-presign";

describe("foundation quarantine presign guards", () => {
  it("refuses production buckets and synthetic keys", () => {
    expect(assertFoundationQuarantineKey("tavonel-prod-quarantine", "quarantine/a/b/source")).toBe("BUCKET_NOT_FOUNDATION");
    expect(assertFoundationQuarantineKey(FOUNDATION_R2_BUCKET, "synthetic/x.txt")).toBe("QUARANTINE_PREFIX_REQUIRED");
    expect(assertFoundationQuarantineKey(FOUNDATION_R2_BUCKET, "quarantine/pilot/abc/source")).toBeNull();
  });

  /*
   * The invariant that was missing when 250 MiB was admitted against a 5 MiB reader.
   *
   * Nothing in CI related the three constants, and grepping the site tree for MAX_SOURCE_BYTES
   * returned only the worker's own lines. This is that relation, asserted rather than assumed:
   * intake never admits more than the smallest thing downstream will read.
   */
  it("never admits more than the deployment can process", () => {
    expect(FOUNDATION_INTAKE_MAX_BYTES).toBe(PROCESSING_CEILING.maxSourceBytes);
    expect(FOUNDATION_INTAKE_MAX_BYTES).toBeLessThanOrEqual(PROCESSING_CEILING.maxSourceBytes);
    expect(FOUNDATION_TRIAL_INTAKE_MAX_BYTES).toBeLessThanOrEqual(FOUNDATION_INTAKE_MAX_BYTES);
    expect(FOUNDATION_TRIAL_INTAKE_MAX_BYTES).toBeGreaterThan(0);
  });

  it("mints a PUT url only for the Foundation quarantine prefix", () => {
    const result = presignFoundationQuarantinePut(
      { accountId: "acct", bucket: FOUNDATION_R2_BUCKET, accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
      { key: "quarantine/pilot/doc/source", contentType: "application/pdf", contentLength: 12, expiresInSeconds: 300, now: new Date("2026-08-29T00:00:00Z") },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.uploadUrl).toContain("acct.r2.cloudflarestorage.com/tavonel-saas-foundation-quarantine/quarantine/pilot/doc/source");
      expect(result.uploadUrl).toContain("X-Amz-Signature=");
    }
  });

  /*
   * The capability grants one object of one size, and the signature has to say so.
   *
   * A golden canonical request is the only way to test this without a bucket: SigV4 is verified by
   * recomputing the signature from the headers the client actually sent, so if `content-length`
   * is in `X-Amz-SignedHeaders` and in the canonical header block, a body of a different length
   * cannot verify. These two assertions are what stops that pair being silently dropped later.
   */
  const signer = { accountId: "acct", bucket: FOUNDATION_R2_BUCKET, accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" };
  const put = (contentLength: number) => presignFoundationQuarantinePut(signer, {
    key: "quarantine/pilot/doc/source",
    contentType: "application/pdf",
    contentLength,
    expiresInSeconds: 300,
    now: new Date("2026-08-29T00:00:00Z"),
  });

  it("binds the reserved byte count into the signature", () => {
    const result = put(1_048_576);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = new URL(result.uploadUrl);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    // A different length is a different signature, which is the whole point.
    const other = put(1_048_577);
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(new URL(other.uploadUrl).searchParams.get("X-Amz-Signature"))
      .not.toBe(url.searchParams.get("X-Amz-Signature"));
  });

  it("refuses to sign a byte count that is not one", () => {
    expect(put(0)).toEqual({ ok: false, code: "CONTENT_LENGTH_INVALID" });
    expect(put(-1)).toEqual({ ok: false, code: "CONTENT_LENGTH_INVALID" });
    expect(put(1.5)).toEqual({ ok: false, code: "CONTENT_LENGTH_INVALID" });
    expect(put(FOUNDATION_INTAKE_MAX_BYTES + 1)).toEqual({ ok: false, code: "CONTENT_LENGTH_INVALID" });
  });
});
