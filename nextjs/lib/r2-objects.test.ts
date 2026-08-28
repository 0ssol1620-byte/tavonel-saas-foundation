import { describe, expect, it } from "vitest";
import { FOUNDATION_R2_BUCKET } from "./r2-synthetic-canary";
import { assertFoundationListPrefix, getWorkspaceOcrJson } from "./r2-objects";

const WS = "pilot-abc";

describe("R2 document listing prefix", () => {
  it("refuses production buckets and mismatched prefixes", () => {
    expect(assertFoundationListPrefix("tavonel-prod-quarantine", WS, `immutable/${WS}/${WS}/`)).toBe(
      "BUCKET_NOT_FOUNDATION",
    );
    expect(assertFoundationListPrefix(FOUNDATION_R2_BUCKET, WS, "immutable/other/other/")).toBe(
      "WORKSPACE_PREFIX_REQUIRED",
    );
    expect(assertFoundationListPrefix(FOUNDATION_R2_BUCKET, WS, `immutable/${WS}/${WS}/`)).toBeNull();
  });

  it("refuses candidate reads that leave the workspace or target a PDF", async () => {
    const env = {
      accountId: "acct",
      bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    const escaped = await getWorkspaceOcrJson(
      env,
      WS,
      `immutable/other/other/doc/${"ab".repeat(32)}/ocr.json`,
    );
    expect(escaped).toEqual({ ok: false, code: "OCR_JSON_PREFIX_REQUIRED" });
    const pdf = await getWorkspaceOcrJson(
      env,
      WS,
      `immutable/${WS}/${WS}/doc/${"ab".repeat(32)}/sanitized.pdf`,
    );
    expect(pdf).toEqual({ ok: false, code: "OCR_JSON_PREFIX_REQUIRED" });
  });
});
