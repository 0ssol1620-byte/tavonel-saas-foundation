import { describe, expect, it } from "vitest";
import {
  FOUNDATION_R2_BUCKET,
  assertFoundationSyntheticKey,
  authorizeSyntheticCanary,
  readR2SignerEnv,
} from "./r2-synthetic-canary";

describe("r2 synthetic canary guards", () => {
  it("refuses a missing signer env", () => {
    expect(readR2SignerEnv({ NODE_ENV: "test" })).toBeNull();
  });

  it("refuses any bucket other than the Foundation quarantine", () => {
    expect(assertFoundationSyntheticKey("tavonel-prod-quarantine", "synthetic/x.txt")).toBe("BUCKET_NOT_FOUNDATION");
    expect(assertFoundationSyntheticKey(FOUNDATION_R2_BUCKET, "workspace/x.pdf")).toBe("SYNTHETIC_PREFIX_REQUIRED");
    expect(assertFoundationSyntheticKey(FOUNDATION_R2_BUCKET, "synthetic/qualification/ok.txt")).toBeNull();
  });

  it("requires a bearer token of matching length", () => {
    expect(authorizeSyntheticCanary(null, "token-value-ok")).toBe(false);
    expect(authorizeSyntheticCanary("Bearer token-value-ok", "token-value-ok")).toBe(true);
    expect(authorizeSyntheticCanary("Bearer token-value-no", "token-value-ok")).toBe(false);
  });
});
