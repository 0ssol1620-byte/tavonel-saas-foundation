import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { dispatchProductCoreV2 } from "./core-runtime-v2";
import type { authorizeCompileJobSourceAccess, classifyCompileJobSources } from "./compile-job-authority";

/*
  D7-03. What the compile route does with a source that was read before regions existed.

  It used to compile it. `buildProductCoreV2Request` filled the Core's mandatory `regions` with
  one invented entry -- page 1, no bbox, the whole document as its text -- so every citation from
  that document pointed at the cover page. A customer who followed the evidence to check a fact
  landed somewhere the fact is not, and because the bbox was omitted rather than invented the UI
  drew a page with no highlight, which reads as a rendering glitch rather than as misattribution.

  These tests drive `runCollectionCompile`, which is the one body both the public route and the
  durable job worker call, so the refusal reaches both. The R2 layer is stubbed because the
  question is what the compile does with what it read, not how it read it.
*/

const listed = vi.fn();
const fetched = vi.fn();
const put = vi.fn();
const serialize = vi.fn();
const dispatched = vi.fn<(...args: Parameters<typeof dispatchProductCoreV2>) => Promise<unknown>>();
const jobAuthority = vi.fn<(...args: Parameters<typeof authorizeCompileJobSourceAccess>) => Promise<unknown>>();
const authorityEnabled = vi.fn(() => true);
const classifySources = vi.fn<(...args: Parameters<typeof classifyCompileJobSources>) => Promise<unknown>>(async () => ({ ok: true, scope: "direct_upload" }));
const customerDataGate = vi.fn();
const sourceScope = vi.fn();
const compileIdentities = vi.fn();
vi.mock("./connector-compile-identity", () => ({ readConnectorCompileIdentities: (...args: unknown[]) => compileIdentities(...args) }));
vi.mock("./customer-source-scope", () => ({ readCustomerSourceScope: (...args: unknown[]) => sourceScope(...args) }));

vi.mock("./r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "acct", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
const priorCandidate = vi.fn();
const activeWorld = vi.fn();

vi.mock("./r2-objects", () => ({
  MAX_DERIVED_JSON_BYTES: 24 * 1024 * 1024,
  listImmutableWorkspaceObjects: (...args: unknown[]) => listed(...args),
  getWorkspaceOcrJson: (...args: unknown[]) => fetched(...args),
  serializeCollectionCandidate: (...args: unknown[]) => serialize(...args),
  putSerializedCollectionCandidate: (...args: unknown[]) => put(...args),
  getWorkspaceCollectionCandidate: (...args: unknown[]) => priorCandidate(...args),
}));
vi.mock("./world-store", () => ({
  getFoundationActiveWorld: (...args: unknown[]) => activeWorld(...args),
}));
vi.mock("./core-runtime-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core-runtime-v2")>()),
  readProductCoreV2Env: () => ({ url: "https://core-v2.example", hmac: "x".repeat(32) }),
  dispatchProductCoreV2: (...args: Parameters<typeof dispatchProductCoreV2>) => dispatched(...args),
  /*
    Enough of an artifact to reach persistence, and no more: these tests are about which
    request the Core is sent, not about what the projection makes of the answer -- that is
    core-runtime-v2.test.ts, which drives the real projection.
  */
  projectProductCoreV2Candidate: () => ({
    collectionId: `collection-${"0".repeat(32)}`,
    manifestDigest: `sha256:${"a".repeat(64)}`,
    lifecycle: "candidate",
    sourceDocuments: [],
    blueprint: {},
    directoryPlan: [],
    ontology: { nodes: [], edges: [] },
    validation: { status: "passed", counts: {} },
    reviewReasons: [],
  }),
}));
vi.mock("./compile-job-authority", () => ({ authorizeCompileJobSourceAccess: (...args: Parameters<typeof authorizeCompileJobSourceAccess>) => jobAuthority(...args), compileJobAuthorityEnabled: () => authorityEnabled(), classifyCompileJobSources: (...args: Parameters<typeof classifyCompileJobSources>) => classifySources(...args) }));
vi.mock("./customer-data-admission", () => ({
  readCustomerSourceAuthorization: (...args: unknown[]) => customerDataGate(...args),
}));
const audited = vi.fn();
vi.mock("./enterprise-store", () => ({
  appendServiceAuditEvent: (...args: unknown[]) => audited(...args),
}));
const registered = vi.fn();
vi.mock("./compile-artifact-provenance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./compile-artifact-provenance")>()),
  registerCollectionArtifact: (...args: unknown[]) => registered(...args),
}));

const { runCollectionCompile, COMPILE_INPUT_MAX_OCR_BYTES } = await import("./collection-compile-run");
const { CORE_V2_MAX_REQUEST_BYTES } = await import("./core-runtime-v2");
const { verifyCompileReceipt } = await import("./compile-receipt-signing");
const { readExportTrustStoreEnv } = await import("./export-signing");

/** A real Ed25519 key and the trust store that names it: the receipt is signed, not stubbed. */
function receiptSigningEnv() {
  const pair = generateKeyPairSync("ed25519");
  const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
  return {
    TAVONEL_EXPORT_SIGNING_KEY_ID: "foundation-receipts-2026",
    TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify({
      schemaVersion: "tavonel.export_trust.v2",
      minimumSignatureVersion: 2,
      activeKeyId: "foundation-receipts-2026",
      keys: [{
        keyId: "foundation-receipts-2026", keyVersion: 1, algorithm: "Ed25519", status: "active",
        notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
        publicKeySpkiDerBase64: spki.toString("base64"),
        publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
      }],
    }),
  };
}
let signingEnv = receiptSigningEnv();

const WS = "pilot";
const VERSION = "a".repeat(64);
const JOB_ID = "cjob-00000000000000000000000000000001";
const DOCUMENT = "0c0c0c0c-0000-4000-8000-00000000000a";
const PREFIX = `immutable/${WS}/${WS}/${DOCUMENT}/${VERSION}`;
const APPROVED_GATE = {
  ok: true as const,
  decision: {
    allowed: true as const,
    schemaVersion: "tavonel.customer_data_gate.v1" as const,
    tenantId: WS,
    workspaceId: WS,
    receiptSha256: `sha256:${"f".repeat(64)}`,
    evaluatedAt: "2026-09-20T00:00:00.000Z",
  },
};

function ocrResult(schemaVersion: string, regions: unknown) {
  const text = "The pump was inspected and the reading stayed inside the policy limits.";
  return {
    schemaVersion,
    pageCount: 1,
    text,
    inputSha256: `sha256:${VERSION}`,
    sourceImmutableKey: `${PREFIX}/sanitized.pdf`,
    ...(regions === undefined ? {} : { regions }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  jobAuthority.mockReset().mockResolvedValue({ ok: true });
  authorityEnabled.mockReset().mockReturnValue(true);
  classifySources.mockReset().mockResolvedValue({ ok: true, scope: "direct_upload" });
  compileIdentities.mockReset();
  customerDataGate.mockReset().mockResolvedValue(APPROVED_GATE);
  audited.mockReset().mockResolvedValue({ ok: true, eventId: "00000000-0000-4000-8000-000000000000" });
  registered.mockReset().mockImplementation(async () => ({ ok: true, publishBy: Date.now() + 60_000 }));
  serialize.mockReset().mockImplementation((value: unknown) => ({ ok: true, body: Buffer.from(JSON.stringify(value), "utf8") }));
  signingEnv = receiptSigningEnv();
  for (const [name, value] of Object.entries(signingEnv)) vi.stubEnv(name, value);
});

function readyWorkspace() {
  listed.mockResolvedValue({
    ok: true,
    objects: [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024 },
      { key: `${PREFIX}/ocr.json`, size: 512 },
    ],
  });
}

describe("default-off compatibility with the authority SQL absent", () => {
  it("continues the prior direct-upload path without calling the new authority RPC", async () => {
    vi.stubEnv("TAVONEL_COMPILE_JOB_AUTHORITY_VERSION", "");
    authorityEnabled.mockReturnValue(false);
    listed.mockResolvedValueOnce({ ok: false, code: "LEGACY_LIST_RESULT" });
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    expect(jobAuthority).not.toHaveBeenCalled();
    expect(listed).toHaveBeenCalled();
    expect(run).toMatchObject({ ok: false, code: "LEGACY_LIST_RESULT" });
  });

  it("denies connector sources while the new actor-bound mode is off", async () => {
    vi.stubEnv("TAVONEL_COMPILE_JOB_AUTHORITY_VERSION", "");
    authorityEnabled.mockReturnValue(false);
    classifySources.mockResolvedValue({ ok: true, scope: "connector" });
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    expect(run).toMatchObject({ ok: false, status: 403, code: "CONNECTOR_SOURCE_AUTHORITY_DISABLED" });
    expect(jobAuthority).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
  });
});

describe("customer-data approval before source access", () => {
  it("denies a job before any source listing when durable authority is revoked", async () => {
    jobAuthority.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_AUTHORITY_DENIED" });
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    expect(run).toMatchObject({ ok: false, status: 403, code: "COMPILE_JOB_AUTHORITY_DENIED" });
    expect(listed).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
  });
  it("requires connector scope for a collection with a durable connector origin", async () => {
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    sourceScope.mockResolvedValue({ ok: true, scope: "connector" });
    customerDataGate.mockResolvedValue({ ok: false, code: "SCOPED_WORKSPACE_NOT_FOUND" });
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    expect(run).toMatchObject({ ok: false, code: "SCOPED_WORKSPACE_NOT_FOUND" });
    expect(customerDataGate).toHaveBeenCalledWith(WS, "connector");
    expect(listed).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("refuses an unprovable origin before reading any source content", async () => {
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    sourceScope.mockResolvedValue({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
    expect(await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).toMatchObject({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
    expect(customerDataGate).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
  });
  it("fails closed with the durable gate code before reading customer objects", async () => {
    customerDataGate.mockResolvedValue({ ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND" });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run).toEqual({
      ok: false,
      status: 503,
      code: "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND",
      payload: {},
    });
    expect(listed).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("rechecks the durable gate immediately before Core dispatch", async () => {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001",
      pageIndex0: 0,
      pageNumber1: 1,
      order: 0,
      blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000],
      text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1,
      authority: "official",
    }]) });
    customerDataGate
      .mockResolvedValueOnce(APPROVED_GATE)
      .mockResolvedValueOnce({ ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_REFUSED" });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run).toEqual({
      ok: false,
      status: 503,
      code: "CUSTOMER_DATA_GATE_RECEIPT_REFUSED",
      payload: {},
    });
    expect(customerDataGate).toHaveBeenCalledTimes(2);
    expect(dispatched).not.toHaveBeenCalled();
  });
});

describe("signed and audited compile receipts (gate preconditions 8 and 12)", () => {
  it("refuses unresolved connector lineage before Core dispatch", async () => {
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    sourceScope.mockResolvedValue({ ok: true, scope: "connector" });
    compileIdentities.mockResolvedValue({ ok: false, code: "CONNECTOR_IDENTITY_UNRESOLVED" });
    compilableSource();
    expect(await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).toMatchObject({ ok: false, code: "CONNECTOR_IDENTITY_UNRESOLVED" });
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("uses the durable logical connector ID for Core while retaining upload UUIDs for source authorization", async () => {
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    sourceScope.mockResolvedValue({ ok: true, scope: "connector" });
    const logical = `src-${"e".repeat(64)}`;
    compileIdentities.mockResolvedValue({ ok: true, identities: new Map([[DOCUMENT, logical]]) });
    compilableSource();
    await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    expect((dispatched.mock.calls[0] as unknown as [unknown, string, Array<Record<string, unknown>>])[2][0])
      .toMatchObject({ documentId: DOCUMENT, logicalSourceId: logical });
    expect(jobAuthority).toHaveBeenCalledWith(expect.objectContaining({
      jobId: JOB_ID, workspaceKey: WS, documentIds: [DOCUMENT], phase: "before_core",
    }));
  });

  it("refuses a superseded connector revision before Core dispatch", async () => {
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    sourceScope.mockResolvedValue({ ok: true, scope: "connector" });
    compileIdentities.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
    compilableSource();
    expect(await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).toEqual({ ok: false, status: 409, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED", payload: {} });
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("does not persist a candidate when a newer revision is bound while Core runs", async () => {
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    sourceScope.mockResolvedValue({ ok: true, scope: "connector" });
    const resolved = { ok: true, identities: new Map([[DOCUMENT, `src-${"e".repeat(64)}`]]) };
    // Selection resolve, pre-dispatch revalidation, then the post-dispatch revalidation observes r2.
    compileIdentities.mockResolvedValueOnce(resolved).mockResolvedValueOnce(resolved)
      .mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
    compilableSource();
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    expect(run).toMatchObject({ ok: false, status: 409, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
    expect(dispatched).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
    expect(registered).not.toHaveBeenCalled();
  });
  function compilableSource() {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]) });
    dispatched.mockResolvedValue({
      ok: true,
      result: {
        status: "completed",
        runtime: "tavonel-python-core-v2",
        candidate: { worldStateId: "world-1", reviewReasons: [] },
        receipt: { requestId: "request-1", outputSha256: `sha256:${"f".repeat(64)}`, candidatePromotion: false },
      },
    });
    put.mockResolvedValue({ ok: true, status: "written", bytes: 1 });
  }

  it("gives Core no more than the tick has left minus the settlement reserve", async () => {
    // REVIEW-PR192-R1 MINOR-10: a near-timeout Core call must not outlive the scheduler tick.
    compilableSource();
    await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID, undefined, Date.now() + 30_000);
    const budget = dispatched.mock.calls[0]?.[8] as number;
    expect(budget).toBeLessThanOrEqual(30_000 - 8_000);
    expect(budget).toBeGreaterThan(30_000 - 8_000 - 2_000);

    dispatched.mockClear();
    await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    expect(dispatched.mock.calls[0]?.[8]).toBe(52_000);
  });

  it("refuses a Core request over its bound by name before anything is persisted", async () => {
    compilableSource();
    const sizeLimit = { object: "core-request", bytes: 4_500_001, bound: 4_500_000 };
    dispatched.mockResolvedValue({ ok: false, code: "COMPILE_INPUT_TOO_LARGE", sizeLimit });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run).toEqual({ ok: false, status: 413, code: "COMPILE_INPUT_TOO_LARGE", payload: { sizeLimit } });
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses an oversized candidate, with its attribution, before any audit, provenance or PUT", async () => {
    compilableSource();
    const sizeLimit = { object: "candidate-world.json", bytes: 134_576_916, bound: 32 * 1024 * 1024,
      largestPackageFiles: [{ path: "rag/chunks.jsonl", sizeBytes: 90_000_000 }] };
    serialize.mockReturnValueOnce({ ok: false, code: "JSON_TOO_LARGE", sizeLimit });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run).toEqual({ ok: false, status: 503, code: "JSON_TOO_LARGE", payload: { sizeLimit } });
    // cjob-157f2f23: provenance #8/#9 and two succeeded receipt audits named an object never written.
    expect(audited).not.toHaveBeenCalled();
    expect(registered).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("fails an oversized Core response by name before any receipt, audit or provenance", async () => {
    compilableSource();
    for (const sizeLimit of [
      { object: "core-response", bytes: 134_576_916, bound: 80 * 1024 * 1024, coreRequestId: "core-test" },
      // Core's own pre-receipt refusal: its numbers reach the payload the worker writes to the job event.
      { object: "core-output", bytes: 52_600_000, bound: 33_554_432, counts: { regions: 3_600, contradictionPairs: 719_400 } },
    ]) {
      dispatched.mockResolvedValue({ ok: false, code: "CORE_OUTPUT_TOO_LARGE", sizeLimit });

      const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

      expect(run).toEqual({ ok: false, status: 422, code: "CORE_OUTPUT_TOO_LARGE", payload: { sizeLimit } });
    }
    expect(serialize).not.toHaveBeenCalled();
    expect(audited).not.toHaveBeenCalled();
    expect(registered).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("puts exactly the bytes that passed the size check", async () => {
    compilableSource();
    expect((await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).ok).toBe(true);
    expect(serialize).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]?.[3]).toBe((serialize.mock.results[0]?.value as { body: Buffer }).body);
  });

  it("signs the receipt, audits it, then persists it -- in that order", async () => {
    compilableSource();

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const receipt = run.payload.signedReceipt;
    const verified = verifyCompileReceipt(receipt, { tenantId: WS, workspaceId: WS }, readExportTrustStoreEnv(signingEnv)!);
    expect(verified).toMatchObject({ ok: true, payload: {
      tenantId: WS,
      workspaceId: WS,
      manifestDigest: `sha256:${"a".repeat(64)}`,
      coreRequestId: "request-1",
      customerDataGateReceiptSha256: APPROVED_GATE.decision.receiptSha256,
      sourceDocuments: [{ documentId: DOCUMENT, versionKey: VERSION }],
    } });
    expect(receipt.payloadJson).not.toContain("pump");

    expect(audited).toHaveBeenCalledOnce();
    const event = audited.mock.calls[0]![0] as { details: Record<string, unknown> };
    expect(event).toMatchObject({
      workspaceKey: WS,
      action: "compile.receipt_signed",
      targetType: "compile_receipt",
      targetId: receipt.signature.signedPayloadSha256,
      outcome: "succeeded",
    });
    expect(JSON.stringify(event.details)).not.toMatch(/"(content|text|secret|password|token|credential|private[_-]?key)"\s*:|pump/i);
    expect(audited.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]!);
    expect(JSON.parse(String(put.mock.calls[0]?.[3]))).toMatchObject({ signedReceipt: receipt });
  });

  it("carries a qualification grant from admission through dispatch into the signed, audited receipt", async () => {
    const { evaluateQualificationRelease, requiredReleaseEvidence, workspaceGrantSha256, QUALIFICATION_PENDING } =
      await import("../../shared/scopedCustomerDataGate");
    const at = new Date().toISOString();
    const release = evaluateQualificationRelease({ releaseRevision: "a".repeat(40), workspaceId: "pilot-qual01",
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), now: at,
      evidence: requiredReleaseEvidence("direct_upload").filter((p) => p !== QUALIFICATION_PENDING)
        .map((precondition) => ({ precondition, satisfied: true, evidence: "test-only", checkedAt: at })) });
    const unsigned = { tenantId: WS, workspaceId: WS, userId: "user-a", scope: "direct_upload" as const,
      stage: "qualification" as const, releaseRevision: release.releaseRevision, releaseReceiptSha256: release.receiptSha256!,
      termsVersion: "t", termsReceiptSha256: `sha256:${"1".repeat(64)}`,
      processingTermsReceiptSha256: `sha256:${"2".repeat(64)}`, grantedAt: at, expiresAt: release.qualification!.expiresAt,
      revokedAt: null };
    const grant = { ...unsigned, grantReceiptSha256: workspaceGrantSha256(unsigned) };
    const decision = { allowed: true as const, schemaVersion: "tavonel.customer_data_gate.v2" as const,
      stage: "qualification" as const, tenantId: WS, workspaceId: WS, receiptSha256: grant.grantReceiptSha256,
      evaluatedAt: at, release, grant };
    customerDataGate.mockResolvedValue({ ok: true, decision });
    compilableSource();

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(dispatched.mock.calls[0]).toContain(decision);
    expect(run.payload.customerDataGateStage).toBe("qualification");
    const verified = verifyCompileReceipt(run.payload.signedReceipt, { tenantId: WS, workspaceId: WS },
      readExportTrustStoreEnv(signingEnv)!);
    expect(verified).toMatchObject({ ok: true, payload: { customerDataGateReceiptSha256: grant.grantReceiptSha256 } });
    expect((audited.mock.calls[0]![0] as { details: Record<string, unknown> }).details).toMatchObject({
      customerDataGateStage: "qualification", customerDataGateReceiptSha256: grant.grantReceiptSha256 });
  });

  it("labels a v1-receipt compile as production", async () => {
    compilableSource();
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    expect(run.ok && run.payload.customerDataGateStage).toBe("production");
    expect((audited.mock.calls[0]![0] as { details: Record<string, unknown> }).details.customerDataGateStage)
      .toBe("production");
  });

  it("does not publish an in-flight result after approval is revoked", async () => {
    compilableSource();
    customerDataGate.mockResolvedValueOnce(APPROVED_GATE).mockResolvedValueOnce(APPROVED_GATE)
      .mockResolvedValueOnce({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
    expect(await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).toMatchObject({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" });
    expect(dispatched).toHaveBeenCalledOnce();
    expect(audited).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("persists nothing when the audit row cannot be written", async () => {
    compilableSource();
    audited.mockResolvedValue({ ok: false, code: "ENTERPRISE_AUDIT_WRITE_FAILED" });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run).toEqual({ ok: false, status: 503, code: "ENTERPRISE_AUDIT_WRITE_FAILED", payload: {} });
    expect(put).not.toHaveBeenCalled();
  });

  it("registers the exact artifact provenance after the audit and before the PUT", async () => {
    compilableSource();
    expect((await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).ok).toBe(true);
    expect(registered).toHaveBeenCalledWith({
      workspaceKey: WS,
      collectionId: `collection-${"0".repeat(32)}`,
      manifestDigest: `sha256:${"a".repeat(64)}`,
      documentIds: [DOCUMENT],
    });
    expect(audited.mock.invocationCallOrder[0]).toBeLessThan(registered.mock.invocationCallOrder[0]!);
    expect(registered.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]!);
  });

  it("stores nothing when the registry refuses a deleted source", async () => {
    compilableSource();
    registered.mockResolvedValue({ ok: false, code: "COLLECTION_ARTIFACT_SOURCE_DELETED", refused: true });
    expect(await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).toEqual({
      ok: false, status: 409, code: "COLLECTION_ARTIFACT_SOURCE_DELETED", payload: {},
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("stores nothing when the registry cannot be reached", async () => {
    compilableSource();
    registered.mockResolvedValue({ ok: false, code: "COLLECTION_ARTIFACT_PROVENANCE_FAILED", refused: false });
    expect(await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).toMatchObject({ ok: false, status: 503 });
    expect(put).not.toHaveBeenCalled();
  });

  it("does not start the PUT once the publication lease has run out", async () => {
    compilableSource();
    registered.mockResolvedValue({ ok: true, publishBy: Date.now() - 1 });
    expect(await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).toEqual({
      ok: false, status: 503, code: "COLLECTION_ARTIFACT_PUBLICATION_LEASE_EXPIRED", payload: {},
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses a document id deletion could never name before touching anything", async () => {
    compilableSource();
    expect(await runCollectionCompile(WS, ["doc-legacy-ocr"], undefined, JOB_ID)).toEqual({
      ok: false, status: 400, code: "DOCUMENT_SET_UNQUALIFIED", payload: {},
    });
    expect(customerDataGate).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
    expect(registered).not.toHaveBeenCalled();
  });

  it("refuses before the gate, R2 or the Core when no receipt signer is configured", async () => {
    vi.stubEnv("TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64", "");
    vi.stubEnv("TAVONEL_EXPORT_SIGNING_KEY_ID", "");
    compilableSource();

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run).toEqual({ ok: false, status: 503, code: "COMPILE_RECEIPT_SIGNER_NOT_CONFIGURED", payload: {} });
    expect(customerDataGate).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
    expect(audited).not.toHaveBeenCalled();
  });
});

describe("a source read before region capture", () => {
  it("is refused with OCR_REGIONS_REQUIRED and never dispatched to the Core", async () => {
    readyWorkspace();
    // A v1 OCR result: real text, no record of where any of it was on the page.
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v1", undefined) });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(422);
      expect(run.code).toBe("OCR_REGIONS_REQUIRED");
      expect(run.payload).toEqual({ documentIds: [DOCUMENT] });
    }
    // Nothing was compiled, nothing was charged for, and nothing was written.
    expect(dispatched).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("reads within the compile's input budget and refuses a set that exceeds it, naming the document", async () => {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: false, code: "JSON_TOO_LARGE",
      sizeLimit: { object: "ocr.json", bytes: COMPILE_INPUT_MAX_OCR_BYTES + 1, bound: COMPILE_INPUT_MAX_OCR_BYTES } });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(fetched.mock.calls[0]?.[4]).toBe(COMPILE_INPUT_MAX_OCR_BYTES);
    expect(COMPILE_INPUT_MAX_OCR_BYTES).toBe(2 * CORE_V2_MAX_REQUEST_BYTES);
    expect(run).toEqual({ ok: false, status: 413, code: "COMPILE_INPUT_TOO_LARGE", payload: { sizeLimit: {
      object: "compile-input", bytes: COMPILE_INPUT_MAX_OCR_BYTES + 1, bound: COMPILE_INPUT_MAX_OCR_BYTES, documentId: DOCUMENT,
    } } });
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("calls an empty ocr.json a malformed binding, not a size", async () => {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: false, code: "NOT_JSON" });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run).toMatchObject({ ok: false, status: 422, code: "OCR_BINDING_INVALID" });
  });

  it("names the document, object and bytes when an ocr.json is over the read bound", async () => {
    // A size refusal used to collapse into OCR_BINDING_INVALID, which says the binding is malformed.
    readyWorkspace();
    const sizeLimit = { object: "ocr.json", bytes: 24 * 1024 * 1024 + 1, bound: 24 * 1024 * 1024 };
    fetched.mockResolvedValue({ ok: false, code: "JSON_TOO_LARGE", sizeLimit });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(413);
      expect(run.code).toBe("JSON_TOO_LARGE");
      expect(run.payload).toEqual({ sizeLimit: { ...sizeLimit, documentId: DOCUMENT } });
    }
    expect(dispatched).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("is refused the same way when a v1 result carries regions it never read, and no bbox is passed on", async () => {
    readyWorkspace();
    // Well-formed v2-shaped geometry inside a v1 body. v1 records no regions, so these are not
    // evidence of where anything was; they must not reach the Core as if they were.
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v1", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]) });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(422);
      expect(run.code).toBe("OCR_REGIONS_REQUIRED");
      expect(run.payload).toEqual({ documentIds: [DOCUMENT] });
    }
    expect(dispatched).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("is refused the same way when the result is v2 but carries an empty region list", async () => {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", []) });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.code).toBe("OCR_REGIONS_REQUIRED");
    expect(dispatched).not.toHaveBeenCalled();
  });

  /*
    The two refusals stay distinguishable.

    A malformed OCR result is ours to fix; a document with no regions is "re-read the source".
    Collapsing both into OCR_BINDING_INVALID would leave the customer with one message for two
    different actions.
  */
  it("is told apart from a malformed OCR binding", async () => {
    readyWorkspace();
    fetched.mockResolvedValue({
      ok: true,
      json: { ...ocrResult("tavonel.ocr_result.v2", [{ regionId: "native-p0001" }]), inputSha256: "sha256:not-the-version-key" },
    });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.code).toBe("OCR_BINDING_INVALID");
      expect(run.status).toBe(422);
    }
  });

  it("still waits rather than failing when the reading has not finished", async () => {
    listed.mockResolvedValue({ ok: true, objects: [{ key: `${PREFIX}/sanitized.pdf`, size: 1024 }] });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.code).toBe("OCR_NOT_READY");
      expect(run.status).toBe(409);
    }
  });

  it("does not compile an older OCR result when a newer sanitized version is still being read", async () => {
    const newer = "b".repeat(64);
    listed.mockResolvedValue({ ok: true, objects: [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024, lastModified: "2026-09-09T00:00:00.000Z" },
      { key: `${PREFIX}/ocr.json`, size: 512, lastModified: "2026-09-09T00:01:00.000Z" },
      { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/sanitized.pdf`, size: 2048,
        lastModified: "2026-09-10T00:00:00.000Z" },
    ] });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.code).toBe("OCR_NOT_READY");
    expect(fetched).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("refuses a multi-version source whose current version cannot be ordered", async () => {
    const newer = "c".repeat(64);
    listed.mockResolvedValue({ ok: true, objects: [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024 },
      { key: `${PREFIX}/ocr.json`, size: 512 },
      { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/sanitized.pdf`, size: 2048 },
      { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/ocr.json`, size: 512 },
    ] });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.code).toBe("SOURCE_VERSION_AMBIGUOUS");
      expect(run.payload).toEqual({ documentIds: [DOCUMENT] });
    }
    expect(fetched).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("revalidates source versions after OCR load and before Core dispatch", async () => {
    const newer = "d".repeat(64);
    const first = [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024, lastModified: "2026-09-09T00:00:00.000Z" },
      { key: `${PREFIX}/ocr.json`, size: 512, lastModified: "2026-09-09T00:01:00.000Z" },
    ];
    listed.mockResolvedValueOnce({ ok: true, objects: first }).mockResolvedValueOnce({ ok: true, objects: [
      ...first,
      { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/sanitized.pdf`, size: 2048,
        lastModified: "2026-09-10T00:00:00.000Z" },
    ] });
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [
      {
        regionId: "native-p0001",
        pageIndex0: 0,
        pageNumber1: 1,
        order: 0,
        blockType: "paragraph",
        bbox1000: [0, 0, 1000, 1000],
        text: "The pump was inspected and the reading stayed inside the policy limits.",
        confidence: 1,
        authority: "official",
      },
    ]) });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.code).toBe("SOURCE_VERSION_CHANGED");
      expect(run.payload).toEqual({ documentIds: [DOCUMENT] });
    }
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("refuses persistence when a source changes during Core execution", async () => {
    const newer = "e".repeat(64);
    const first = [
      { key: `${PREFIX}/sanitized.pdf`, size: 1024, lastModified: "2026-09-09T00:00:00.000Z" },
      { key: `${PREFIX}/ocr.json`, size: 512, lastModified: "2026-09-09T00:01:00.000Z" },
    ];
    listed
      .mockResolvedValueOnce({ ok: true, objects: first })
      .mockResolvedValueOnce({ ok: true, objects: first })
      .mockResolvedValueOnce({ ok: true, objects: [
        ...first,
        { key: `immutable/${WS}/${WS}/${DOCUMENT}/${newer}/sanitized.pdf`, size: 2048,
          lastModified: "2026-09-10T00:00:00.000Z" },
      ] });
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [
      {
        regionId: "native-p0001",
        pageIndex0: 0,
        pageNumber1: 1,
        order: 0,
        blockType: "paragraph",
        bbox1000: [0, 0, 1000, 1000],
        text: "The pump was inspected and the reading stayed inside the policy limits.",
        confidence: 1,
        authority: "official",
      },
    ]) });
    dispatched.mockResolvedValue({
      ok: true,
      result: {
        status: "completed",
        runtime: "tavonel-python-core-v2",
        candidate: { worldStateId: "world-1", reviewReasons: [] },
        receipt: { requestId: "request-1", outputSha256: `sha256:${"f".repeat(64)}`, candidatePromotion: false },
      },
    });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.code).toBe("SOURCE_VERSION_CHANGED");
    expect(dispatched).toHaveBeenCalledOnce();
    expect(dispatched.mock.calls[0]?.[5]).toEqual(expect.objectContaining({
      allowed: true,
      tenantId: WS,
      workspaceId: WS,
    }));
    expect(put).not.toHaveBeenCalled();
  });

  it("does not dispatch a source whose job-bound connector authority was revoked", async () => {
    readyWorkspace();
    jobAuthority.mockResolvedValueOnce({ ok: true });
    jobAuthority.mockResolvedValueOnce({ ok: true });
    jobAuthority.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_AUTHORITY_DENIED" });
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]) });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.code).toBe("COMPILE_JOB_AUTHORITY_DENIED");
    expect(dispatched).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

/*
  TM01. Whether a compile asks the Core for a revision of an existing World, and when it will
  not.

  `route.operationClass` was the literal "initial_compile" on every call and
  `previousActiveWorld` was never sent, so the selective-recompile branch in `compiler.py` --
  `plan_recompilation`, then `verify_equivalence` -- has never run in production and
  `receipt.equivalence` has always been "not_run". This drives the four states that matter: the
  flag off, the flag on with a usable prior World, the flag on with no prior World at all, and
  the flag on with a prior World this code cannot faithfully describe.

  The last one is the one worth reading. It refuses. Compiling from scratch there would look
  like success and produce a diff claiming every unit in the corpus is new, which is a false
  record of what changed rather than a missing optimisation.
*/
describe("a re-compile of a collection that already has an active World", () => {
  const SNAPSHOT = {
    worldStateId: "ws_previous_1",
    manifestDigest: `sha256:${"b".repeat(64)}`,
    artifactHashes: { "canonical/model": `sha256:${"c".repeat(64)}` },
    units: [{
      logicalId: "unit-1",
      sourceId: "src-1",
      sourceVersionId: "srcv-1",
      sourceContentSha256: `sha256:${"d".repeat(64)}`,
      text: "The pump was inspected and the reading stayed inside the policy limits.",
      documentPath: ["Sources", DOCUMENT],
      anchor: `${DOCUMENT}#p1`,
      neighbourAnchors: [],
      evidenceId: "ev-1",
      pageNumber1: 1,
      authority: "official",
      identityState: "matched",
    }],
  };

  function readableSource() {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]) });
    dispatched.mockResolvedValue({
      ok: true,
      result: {
        status: "completed",
        runtime: "tavonel-python-core-v2",
        candidate: { worldStateId: "world-2", reviewReasons: [] },
        receipt: { requestId: "request-2", outputSha256: `sha256:${"f".repeat(64)}`, candidatePromotion: false },
      },
    });
    put.mockResolvedValue({ ok: true, status: "written", bytes: 1 });
  }

  /** What the world store returns for a collection that has been promoted once. */
  function promotedOnce() {
    activeWorld.mockResolvedValue({
      ok: true,
      world: {
        workspaceKey: WS,
        collectionId: "collection-unused-by-this-assertion",
        manifestDigest: SNAPSHOT.manifestDigest,
        revision: 1,
        updatedAt: "2026-09-10T00:00:00.000Z",
        candidateObjectKey: "immutable/pilot/pilot/collections/c/x/candidate-world.json",
        worldStateId: SNAPSHOT.worldStateId,
        coreOutputSha256: `sha256:${"e".repeat(64)}`,
      },
    });
  }

  it("never looks for a prior World while the flag is unset", async () => {
    readableSource();
    promotedOnce();

    await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(activeWorld).not.toHaveBeenCalled();
    expect(priorCandidate).not.toHaveBeenCalled();
    expect(dispatched.mock.calls[0]?.[4] ?? null).toBeNull();
  });

  it("sends the prior World to the Core when the flag is on and the snapshot is complete", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    promotedOnce();
    priorCandidate.mockResolvedValue({ ok: true, json: { collectionId: "collection-unused-by-this-assertion", revisionCompile: SNAPSHOT } });

    await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(dispatched.mock.calls[0]?.[4]).toEqual(SNAPSHOT);
    vi.unstubAllEnvs();
  });

  it("looks up the same active collection after a source revision", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    promotedOnce();
    priorCandidate.mockResolvedValue({ ok: true, json: { collectionId: "collection-unused-by-this-assertion", revisionCompile: SNAPSHOT } });
    await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    const firstLookup = activeWorld.mock.calls[0];
    const newer = "e".repeat(64);
    listed.mockResolvedValue({ ok: true, objects: [
      { key: `${PREFIX.replace(VERSION, newer)}/sanitized.pdf`, size: 1024 },
      { key: `${PREFIX.replace(VERSION, newer)}/ocr.json`, size: 512 },
    ] });
    const updated = ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]);
    fetched.mockResolvedValue({ ok: true, json: { ...updated, inputSha256: `sha256:${newer}`, sourceImmutableKey: `${PREFIX.replace(VERSION, newer)}/sanitized.pdf` } });
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    expect(run.ok).toBe(true);
    expect(activeWorld.mock.calls[1]).toEqual(firstLookup);
    expect(dispatched.mock.calls[1]?.[4]).toEqual(SNAPSHOT);
  });

  it("refuses a parent snapshot stored under another collection", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    promotedOnce();
    priorCandidate.mockResolvedValue({ ok: true, json: { collectionId: "collection-wrong", revisionCompile: SNAPSHOT } });
    expect(await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).toMatchObject({ ok: false, code: "REVISION_COMPILE_PRIOR_WORLD_UNREADABLE" });
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("compiles from scratch when this binding has no active World", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    activeWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });

    await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(priorCandidate).not.toHaveBeenCalled();
    expect(dispatched.mock.calls[0]?.[4] ?? null).toBeNull();
    vi.unstubAllEnvs();
  });

  it("requires explicit migration for an exact legacy active binding", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    activeWorld.mockResolvedValueOnce({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" })
      .mockResolvedValueOnce({ ok: true, world: { collectionId: "collection-legacy" } });
    expect(await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID)).toMatchObject({ ok: false, status: 409, code: "COLLECTION_IDENTITY_MIGRATION_REQUIRED" });
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("refuses instead of compiling from scratch when the prior World cannot be described", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    promotedOnce();
    // A candidate promoted before the flag existed: no snapshot was persisted with it.
    priorCandidate.mockResolvedValue({ ok: true, json: { collectionId: "collection-old" } });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(409);
      expect(run.code).toBe("REVISION_COMPILE_PRIOR_WORLD_UNREADABLE");
      expect(run.payload).toEqual({ manifestDigest: SNAPSHOT.manifestDigest });
    }
    expect(dispatched).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("surfaces a world-store failure rather than treating it as no prior World", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    activeWorld.mockResolvedValue({ ok: false, code: "WORLD_STORE_READ_FAILED" });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(503);
      expect(run.code).toBe("WORLD_STORE_READ_FAILED");
    }
    expect(dispatched).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("forwards a Core refusal of the revision compile without persisting anything", async () => {
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    readableSource();
    promotedOnce();
    priorCandidate.mockResolvedValue({ ok: true, json: { collectionId: "collection-unused-by-this-assertion", revisionCompile: SNAPSHOT } });
    // What a Core built before the incremental contract answers: a named refusal, not a World.
    dispatched.mockResolvedValue({ ok: false, code: "CORE_REQUEST_INVALID" });

    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.status).toBe(503);
      expect(run.code).toBe("CORE_REQUEST_INVALID");
    }
    expect(put).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("private global compile admission and release binding", () => {
  const key = `global-corpus/corpus-${"a".repeat(32)}`;
  function qualifySource(releaseDigest: string) {
    vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_COMPILE", "1");
    vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
    vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256", `sha256:${"a".repeat(64)}`);
    readyWorkspace();
    activeWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]) });
    dispatched.mockResolvedValue({ ok: true, result: {
      status: "completed", runtime: "tavonel-python-core-v2", candidate: { worldStateId: "world-global", reviewReasons: [] },
      receipt: { requestId: "request-global", outputSha256: `sha256:${"f".repeat(64)}`, coreReleaseDigest: releaseDigest, candidatePromotion: false },
    } });
    put.mockResolvedValue({ ok: true, status: "written", bytes: 1 });
  }
  it("refuses a global call before source reads when qualification is closed", async () => {
    expect(await runCollectionCompile(WS, [DOCUMENT], key, JOB_ID)).toMatchObject({ ok: false, code: "GLOBAL_COLLECTION_COMPILE_DISABLED" });
    expect(fetched).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
  });
  it("refuses output from an unqualified Core release before persistence", async () => {
    qualifySource(`sha256:${"b".repeat(64)}`);
    expect(await runCollectionCompile(WS, [DOCUMENT], key, JOB_ID)).toMatchObject({ ok: false, code: "GLOBAL_COLLECTION_CORE_RELEASE_MISMATCH" });
    expect(put).not.toHaveBeenCalled();
  });
  it("preserves all existing signed-receipt gates on a qualified global compile", async () => {
    qualifySource(`sha256:${"a".repeat(64)}`);
    expect((await runCollectionCompile(WS, [DOCUMENT], key, JOB_ID)).ok).toBe(true);
    expect(dispatched.mock.calls[0][7]).toBe(key);
    expect(dispatched.mock.calls[0][8]).toBeGreaterThanOrEqual(1000);
    expect(dispatched.mock.calls[0][8]).toBeLessThanOrEqual(52000);
    expect(audited).toHaveBeenCalledOnce();
    expect(registered).toHaveBeenCalledOnce();
  });
  it("bounds aggregate OCR bytes before dispatch", async () => {
    qualifySource(`sha256:${"a".repeat(64)}`);
    fetched.mockResolvedValue({ ok: true, json: { text: "x".repeat(4 * 1024 * 1024 + 1) } });
    expect(await runCollectionCompile(WS, [DOCUMENT], key, JOB_ID)).toMatchObject({ ok: false, code: "GLOBAL_COLLECTION_RESOURCE_LIMIT" });
    expect(dispatched).not.toHaveBeenCalled();
  });
});

/*
  B1 (TAVONEL_SOURCE_DEDUP_MODE). The annotation is computed at intake, before the paid dispatch, and
  in no mode does it change what is dispatched, signed or stored: the three modes are compared on
  the Core request, the audited receipt payload and the persisted candidate. Under `on` the note
  names only documents the compiling principal may read, through the live source-access check.
*/
describe("exact-duplicate annotation at compile intake", () => {
  const OTHER = "0d0d0d0d-0000-4000-8000-00000000000d";
  // A connector-bound copy the compiling user may not read (connector_documents_blocked answers true).
  const HIDDEN = "0e0e0e0e-0000-4000-8000-00000000000e";
  const VIEWER = { userId: "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a", provenance: "authenticated_request" } as const;
  const rpc = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/rpc/connector_documents_blocked")) {
      const ids = (JSON.parse(String(init?.body)) as { p_document_ids: string[] }).p_document_ids;
      return new Response(JSON.stringify(ids.includes(HIDDEN)), { status: 200 });
    }
    return new Response(JSON.stringify({
      schemaVersion: "tavonel.source_fingerprints.v1", fingerprints: 1, newRelations: 2,
      sourceDigestReuseCandidateDocumentIds: [DOCUMENT], sanitizedDigestReuseDocumentIds: [DOCUMENT],
      relations: [{ documentId: DOCUMENT, relatedDocumentId: OTHER, kind: "exact_bytes", matchedOn: ["sanitized_sha256"] },
        { documentId: DOCUMENT, relatedDocumentId: HIDDEN, kind: "exact_bytes", matchedOn: ["sanitized_sha256"] }],
    }), { status: 200 });
  });
  const fingerprintCalls = () => rpc.mock.calls.filter(([url]) => String(url).endsWith("/rpc/record_source_fingerprints"));
  function compilable() {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]) });
    dispatched.mockResolvedValue({ ok: true, result: {
      status: "completed", runtime: "tavonel-python-core-v2",
      candidate: { worldStateId: "world-1", reviewReasons: [] },
      receipt: { requestId: "request-1", outputSha256: `sha256:${"f".repeat(64)}`, candidatePromotion: false },
    } });
    put.mockResolvedValue({ ok: true, status: "written", bytes: 1 });
  }
  async function compileWith(mode: string | undefined, principal: typeof VIEWER | null = VIEWER) {
    vi.clearAllMocks();
    rpc.mockClear();
    vi.stubGlobal("fetch", rpc);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://store.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
    if (mode !== undefined) vi.stubEnv("TAVONEL_SOURCE_DEDUP_MODE", mode);
    compilable();
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID, principal ?? undefined);
    const audit = audited.mock.calls[0]?.[0] as { details: { sourceProcessingObservations: unknown } } | undefined;
    return {
      run,
      core: JSON.stringify(dispatched.mock.calls[0]?.slice(0, 3)),
      stored: put.mock.calls[0]?.[3] as Record<string, unknown> | undefined,
      auditSources: JSON.stringify((audit?.details.sourceProcessingObservations as { sources?: unknown } | undefined)?.sources),
    };
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("off (unset): no store call, and the response has no duplicate field", async () => {
    const off = await compileWith(undefined);
    expect(off.run.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(off.run.ok && "libraryDuplicates" in off.run.payload).toBe(false);
  });

  it("shadow records, and the compile is the same compile as with the flag off", async () => {
    const off = await compileWith("off");
    const shadow = await compileWith("shadow");
    expect(rpc).toHaveBeenCalledOnce();
    expect(fingerprintCalls()).toHaveLength(1);
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(dispatched.mock.invocationCallOrder[0]!);
    expect(shadow.run.ok && "libraryDuplicates" in shadow.run.payload).toBe(false);
    expect(shadow.core).toBe(off.core);
    expect(shadow.auditSources).toBe(off.auditSources);
    expect(Object.keys(shadow.stored ?? {})).toEqual(Object.keys(off.stored ?? {}));
    expect(shadow.stored).not.toHaveProperty("libraryDuplicates");
  });

  it("on: the response names the copy the viewer may read and not the one it may not; the stored World names neither", async () => {
    const off = await compileWith("off");
    const on = await compileWith("on");
    expect(on.run.ok && on.run.payload.libraryDuplicates).toEqual([
      { documentId: DOCUMENT, kind: "exact", duplicateOfDocumentIds: [OTHER] },
    ]);
    expect(JSON.stringify(on.run.ok && on.run.payload)).not.toContain(HIDDEN);
    expect(on.core).toBe(off.core);
    expect(on.stored).not.toHaveProperty("libraryDuplicates");
  });

  it("on without an authenticated principal names nothing", async () => {
    const on = await compileWith("on", null);
    expect(on.run.ok).toBe(true);
    expect(fingerprintCalls()).toHaveLength(1);
    expect(on.run.ok && "libraryDuplicates" in on.run.payload).toBe(false);
  });

  it("a store that is down never stops the compile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    vi.stubEnv("TAVONEL_SOURCE_DEDUP_MODE", "on");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://store.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    compilable();
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID, VIEWER);
    expect(run.ok).toBe(true);
    expect(run.ok && "libraryDuplicates" in run.payload).toBe(false);
    expect(put).toHaveBeenCalledOnce();
  });
});

/*
  B2 (TAVONEL_LIBRARY_ORGANIZE_MODE). Proposals are recorded at intake, before the paid dispatch, and
  in no mode do they change what is dispatched, signed, stored or returned: off and shadow are
  compared on the Core request, the audited sources, the persisted candidate and the response.
*/
describe("library organize proposals at compile intake", () => {
  const store = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ schemaVersion: "tavonel.library_organize.v1", documents: 1,
    newPairs: { same_text: 0, near_duplicate: 0, revision_candidate: 0 }, labelsRecorded: 2 }), { status: 200 }));
  const organizeCalls = () => store.mock.calls.filter(([url]) => String(url).endsWith("/rpc/record_library_organize"));
  function compilable() {
    readyWorkspace();
    fetched.mockResolvedValue({ ok: true, json: ocrResult("tavonel.ocr_result.v2", [{
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      bbox1000: [0, 0, 1000, 1000], text: "The pump was inspected and the reading stayed inside the policy limits.",
      confidence: 1, authority: "official",
    }]) });
    dispatched.mockResolvedValue({ ok: true, result: {
      status: "completed", runtime: "tavonel-python-core-v2",
      candidate: { worldStateId: "world-1", reviewReasons: [] },
      receipt: { requestId: "request-1", outputSha256: `sha256:${"f".repeat(64)}`, candidatePromotion: false },
    } });
    put.mockResolvedValue({ ok: true, status: "written", bytes: 1 });
  }
  async function compileWith(mode: string | undefined, fetchImpl: typeof store = store) {
    vi.clearAllMocks();
    store.mockClear();
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://store.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
    if (mode !== undefined) vi.stubEnv("TAVONEL_LIBRARY_ORGANIZE_MODE", mode);
    compilable();
    const run = await runCollectionCompile(WS, [DOCUMENT], undefined, JOB_ID);
    const audit = audited.mock.calls[0]?.[0] as { details: { sourceProcessingObservations: unknown } } | undefined;
    return {
      run: JSON.stringify(run.ok ? { ...run, payload: { ...run.payload, signedReceipt: undefined } } : run),
      ok: run.ok,
      core: JSON.stringify(dispatched.mock.calls[0]?.slice(0, 3)),
      // The whole persisted candidate, decoded, minus only the signed receipt (its time and request id differ per run).
      stored: JSON.stringify({ ...(JSON.parse(String(put.mock.calls[0]?.[3])) as Record<string, unknown>), signedReceipt: undefined }),
      auditSources: JSON.stringify((audit?.details.sourceProcessingObservations as { sources?: unknown } | undefined)?.sources),
    };
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("off (unset): no store call", async () => {
    const off = await compileWith(undefined);
    expect(off.ok).toBe(true);
    expect(store).not.toHaveBeenCalled();
  });

  it("shadow records once, before the paid dispatch, and the compile is the same compile as with the flag off", async () => {
    const off = await compileWith("off");
    expect(store).not.toHaveBeenCalled();
    const shadow = await compileWith("shadow");
    expect(organizeCalls()).toHaveLength(1);
    expect(store.mock.invocationCallOrder[0]).toBeLessThan(dispatched.mock.invocationCallOrder[0]!);
    expect([shadow.core, shadow.stored, shadow.auditSources, shadow.run]).toEqual([off.core, off.stored, off.auditSources, off.run]);
  });

  it("a store that is down never stops the compile and changes nothing in it", async () => {
    const off = await compileWith("off");
    const down = await compileWith("shadow", vi.fn(async () => { throw new TypeError("network"); }) as unknown as typeof store);
    expect(down.ok).toBe(true);
    expect([down.core, down.stored, down.run]).toEqual([off.core, off.stored, off.run]);
  });
});
