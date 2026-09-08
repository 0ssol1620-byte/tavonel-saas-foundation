import { describe, expect, it } from "vitest";
import {
  FOUNDATION_R2_BUCKET,
  assertFoundationSyntheticKey,
  authorizeSyntheticCanary,
  foundationQuarantineRejectKey,
  readR2SignerEnv,
  validateCdrRejectReceipt,
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

/*
 * A refusal receipt is the only record a refused source leaves, so it is checked like one.
 *
 * Two things could go wrong if it were trusted as written. An object dropped into the bucket
 * under a plausible name could make one workspace display another's refusal, so the receipt has
 * to name the source key this workspace and document actually own. And a reason code outside the
 * frozen `FailureClass` set would put an invented failure vocabulary on a customer's screen, so
 * only the frozen values are accepted.
 */
describe("CDR refusal receipt", () => {
  const workspaceKey = "pilot-969dc192daa24119";
  const documentId = "969dc192-daa2-4119-a5d9-9a7621f171a1";
  const receipt = {
    schemaVersion: "tavonel.cdr_reject_receipt.v1",
    sourceKey: `quarantine/${workspaceKey}/${documentId}/source`,
    observedBytes: 6291456,
    declaredBytes: null,
    reasonCode: "PARSER_OOM",
    provider: "tavonel_pdf_raster",
    occurredAt: "2026-09-06T00:00:00.000Z",
  };

  it("sits beside the source it refused, never under the immutable prefix", () => {
    expect(foundationQuarantineRejectKey(workspaceKey, documentId))
      .toBe(`quarantine/${workspaceKey}/${documentId}/cdr-reject.json`);
  });

  it("accepts a complete receipt", () => {
    expect(validateCdrRejectReceipt(receipt, workspaceKey, documentId)).toMatchObject({
      reasonCode: "PARSER_OOM",
      observedBytes: 6291456,
      declaredBytes: null,
    });
  });

  it("refuses a receipt that names another workspace or another document", () => {
    expect(validateCdrRejectReceipt(receipt, "pilot-someoneelse00000", documentId)).toBeNull();
    expect(validateCdrRejectReceipt(receipt, workspaceKey, "969dc192-daa2-4119-a5d9-9a7621f171a2")).toBeNull();
  });

  it("refuses a reason code that is not in the frozen failure vocabulary", () => {
    expect(validateCdrRejectReceipt({ ...receipt, reasonCode: "TOO_BIG" }, workspaceKey, documentId)).toBeNull();
    expect(validateCdrRejectReceipt({ ...receipt, reasonCode: "" }, workspaceKey, documentId)).toBeNull();
  });

  it("refuses a receipt that is missing or malformed rather than showing half of it", () => {
    expect(validateCdrRejectReceipt(null, workspaceKey, documentId)).toBeNull();
    expect(validateCdrRejectReceipt({ ...receipt, schemaVersion: "v2" }, workspaceKey, documentId)).toBeNull();
    expect(validateCdrRejectReceipt({ ...receipt, occurredAt: "whenever" }, workspaceKey, documentId)).toBeNull();
    expect(validateCdrRejectReceipt({ ...receipt, observedBytes: -1 }, workspaceKey, documentId)).toBeNull();
    expect(validateCdrRejectReceipt({ ...receipt, observedBytes: "6291456" }, workspaceKey, documentId)).toBeNull();
  });
});
