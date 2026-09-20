import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOUNDATION_R2_BUCKET,
  assertFoundationDeletionKey,
  deleteFoundationSourceObject,
  inspectFoundationSourceObject,
  assertFoundationSyntheticKey,
  authorizeSyntheticCanary,
  foundationQuarantineRejectKey,
  readR2SignerEnv,
  validateCdrRejectReceipt,
} from "./r2-synthetic-canary";

afterEach(() => vi.unstubAllGlobals());

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

  it("allows deletion only inside the named workspace quarantine or immutable prefix", () => {
    const workspace = "pilot-969dc192daa24119";
    expect(assertFoundationDeletionKey(FOUNDATION_R2_BUCKET, workspace,
      `quarantine/${workspace}/doc-1/source`)).toBeNull();
    expect(assertFoundationDeletionKey(FOUNDATION_R2_BUCKET, workspace,
      `immutable/${workspace}/${workspace}/doc-1/${"a".repeat(64)}/sanitized.pdf`)).toBeNull();
    expect(assertFoundationDeletionKey(FOUNDATION_R2_BUCKET, workspace,
      "quarantine/another-workspace/doc-1/source")).toBe("SOURCE_DELETION_KEY_OUTSIDE_WORKSPACE");
    expect(assertFoundationDeletionKey(FOUNDATION_R2_BUCKET, workspace,
      `quarantine/${workspace}/../other/source`)).toBe("SOURCE_DELETION_KEY_INVALID");
  });

  it("HEADs before deletion and treats a missing object as an idempotent success", async () => {
    const workspace = "pilot-969dc192daa24119";
    const key = `quarantine/${workspace}/doc-1/source`;
    const env = { accountId: "account", bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "access", secretAccessKey: "secret" };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(inspectFoundationSourceObject(env, workspace, key))
      .resolves.toEqual({ ok: true, exists: false });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "HEAD" });
  });

  it.each([204, 404])("accepts DELETE %s after the durable begin transition", async deleteStatus => {
    const workspace = "pilot-969dc192daa24119";
    const key = `quarantine/${workspace}/doc-1/source`;
    const env = { accountId: "account", bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "access", secretAccessKey: "secret" };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: deleteStatus }));
    vi.stubGlobal("fetch", fetcher);
    await expect(deleteFoundationSourceObject(env, workspace, key)).resolves.toEqual({
      ok: true, alreadyAbsent: deleteStatus === 404,
    });
    expect(fetcher.mock.calls.map(call => call[1]?.method)).toEqual(["DELETE"]);
  });

  it("does not issue DELETE when HEAD is ambiguous", async () => {
    const workspace = "pilot-969dc192daa24119";
    const key = `quarantine/${workspace}/doc-1/source`;
    const env = { accountId: "account", bucket: FOUNDATION_R2_BUCKET,
      accessKeyId: "access", secretAccessKey: "secret" };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(inspectFoundationSourceObject(env, workspace, key)).resolves.toEqual({
      ok: false, code: "SOURCE_DELETE_HEAD_FAILED",
    });
    expect(fetcher).toHaveBeenCalledOnce();
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
