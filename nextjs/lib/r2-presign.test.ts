import { describe, expect, it } from "vitest";
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

  it("keeps trial bounded while allowing ordinary technical manuals for paid and owner workspaces", () => {
    expect(FOUNDATION_TRIAL_INTAKE_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(FOUNDATION_INTAKE_MAX_BYTES).toBe(250 * 1024 * 1024);
    expect(FOUNDATION_INTAKE_MAX_BYTES).toBeGreaterThan(FOUNDATION_TRIAL_INTAKE_MAX_BYTES);
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
});
