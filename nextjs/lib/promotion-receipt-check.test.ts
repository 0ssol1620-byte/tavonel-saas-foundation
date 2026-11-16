import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate } from "./collection-compiler";
import { readCompileReceiptSigner, signCompileReceipt } from "./compile-receipt-signing";
import { readExportTrustStoreEnv } from "./export-signing";
import { checkCandidateCompileReceipt } from "./promotion-receipt-check";

const m = vi.hoisted(() => ({
  getUser: vi.fn(), pilotAccess: vi.fn(), productAccess: vi.fn(), getCandidate: vi.fn(),
  listObjects: vi.fn(), promote: vi.fn(), sourceAccess: vi.fn(), ensureIndex: vi.fn(),
}));
vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: m.getUser, foundationPilotAccess: m.pilotAccess }));
vi.mock("@/lib/billing-product-access", () => ({ authorizeFoundationProduct: m.productAccess }));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  getWorkspaceCollectionCandidate: m.getCandidate,
  listImmutableWorkspaceObjects: m.listObjects,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
vi.mock("@/lib/world-store", async (original) => ({
  ...(await original<typeof import("./world-store")>()), promoteFoundationCandidate: m.promote,
}));
vi.mock("@/lib/activation-rate-limit", () => ({ checkActivationRateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/connector-source-access", () => ({
  checkConnectorSourceAccess: m.sourceAccess, checkConnectorSourceAccessForViewer: m.sourceAccess,
}));
vi.mock("@/lib/retrieval-index-status", () => ({ ensureRetrievalIndexForActiveWorld: m.ensureIndex }));

import { POST } from "../app/api/collections/[id]/promote/route";
import { checkRollbackSourceAccess } from "./world-rollback-source-access";

const NOW = new Date("2026-09-27T00:00:00.000Z");
const workspaceId = "pilot-download";
const userId = "969dc192-daa2-4119-a5d9-9a7621f171a1";

function signingEnv(expiresAt = "2027-09-01T00:00:00.000Z") {
  const pair = generateKeyPairSync("ed25519");
  const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
  return {
    TAVONEL_EXPORT_SIGNING_KEY_ID: "foundation-receipts-2026",
    TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify({
      schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: "foundation-receipts-2026",
      keys: [{ keyId: "foundation-receipts-2026", keyVersion: 1, algorithm: "Ed25519", status: "active",
        notBefore: "2026-09-01T00:00:00.000Z", expiresAt, publicKeySpkiDerBase64: spki.toString("base64"),
        publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}` }],
    }),
  };
}

const compiled = compileCollectionCandidate([{
  documentId: "doc-one", versionKey: "a".repeat(64), pageCount: 1, inputSha256: `sha256:${"a".repeat(64)}`,
  sanitizedKey: `immutable/${workspaceId}/${workspaceId}/doc-one/${"a".repeat(64)}/sanitized.pdf`,
  sourceImmutableKey: `immutable/${workspaceId}/${workspaceId}/doc-one/${"a".repeat(64)}/sanitized.pdf`,
  ocrJsonKey: `immutable/${workspaceId}/${workspaceId}/doc-one/${"a".repeat(64)}/ocr.json`,
  text: "Quarterly revenue increased after the reviewed policy change.",
  regions: [{ regionId: "doc-one-p1-b1", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
    text: "Quarterly revenue increased after the reviewed policy change.", bbox1000: [80, 120, 920, 320],
    confidence: 0.99, authority: "contractual" }],
}]);
const coreExecution = {
  status: "completed", runtime: "tavonel-python-core-v2", worldStateId: "world-state-1",
  receipt: { requestId: "core-proof", outputSha256: compiled.manifestDigest, candidatePromotion: false,
    equivalence: "not_run", totalArtifacts: 8, rebuiltArtifacts: 8, workAvoidedArtifacts: 0 },
};
const subject = { workspaceId, collectionId: compiled.collectionId, manifestDigest: compiled.manifestDigest };

function receiptFor(env: Record<string, string>, over: Record<string, unknown> = {}) {
  return signCompileReceipt(readCompileReceiptSigner(env, NOW)!, {
    tenantId: workspaceId, workspaceId, collectionId: compiled.collectionId, manifestDigest: compiled.manifestDigest,
    lifecycle: "candidate", coreRuntime: "tavonel-python-core-v2", worldStateId: "world-state-1",
    coreRequestId: "core-proof", coreOutputSha256: compiled.manifestDigest,
    customerDataGateReceiptSha256: `sha256:${"c".repeat(64)}`,
    sourceDocuments: compiled.sourceDocuments.map((d) => ({ documentId: d.documentId, versionKey: d.versionKey })),
    compiledAt: NOW.toISOString(), ...over,
  })!.receipt;
}
const env = signingEnv();
const stored = (patch: Record<string, unknown> = {}, e = env, over: Record<string, unknown> = {}) =>
  ({ ...compiled, coreExecution, signedReceipt: receiptFor(e, over), ...patch });
const check = (artifact: unknown, e: Record<string, string | undefined> = env, subj = subject) =>
  checkCandidateCompileReceipt(artifact, subj, e, NOW);

describe("checkCandidateCompileReceipt", () => {
  it("passes a receipt that verifies and describes the stored candidate", () => {
    expect(check(stored())).toEqual({ ok: true });
  });

  it("refuses a candidate with no signed receipt", () => {
    expect(check(stored({ signedReceipt: undefined }))).toEqual({ ok: false, code: "COMPILE_RECEIPT_REQUIRED", status: 409 });
  });

  it("returns 503 when no trust store is configured", () => {
    expect(check(stored(), {})).toEqual({ ok: false, code: "EXPORT_TRUST_STORE_NOT_CONFIGURED", status: 503 });
  });

  it("refuses a tampered payload, an untrusted signer and an expired key", () => {
    const good = stored();
    const tampered = { ...good, signedReceipt: { ...good.signedReceipt,
      payloadJson: good.signedReceipt.payloadJson.replace(`"lifecycle":"candidate"`, `"lifecycle":"promoted"`) } };
    const foreign = stored({}, signingEnv());
    for (const artifact of [tampered, foreign]) {
      expect(check(artifact)).toEqual({ ok: false, code: "COMPILE_RECEIPT_SIGNATURE_INVALID", status: 409 });
    }
    const shortLived = signingEnv("2026-09-28T00:00:00.000Z");
    expect(checkCandidateCompileReceipt(stored({}, shortLived), subject, shortLived, new Date("2026-10-15T00:00:00.000Z")))
      .toEqual({ ok: false, code: "COMPILE_RECEIPT_SIGNATURE_INVALID", status: 409 });
  });

  it("refuses an incompatible schema even when the signature is valid", () => {
    const signer = readCompileReceiptSigner(env, NOW)!;
    const payload = JSON.stringify({ ...JSON.parse(receiptFor(env).payloadJson), schemaVersion: "tavonel.compile_receipt.v9" });
    const signature = signer.signPayload(Buffer.from(payload, "utf8"));
    expect(check(stored({ signedReceipt: { payloadJson: payload, signature } })))
      .toEqual({ ok: false, code: "COMPILE_RECEIPT_MALFORMED", status: 409 });
  });

  it("refuses a receipt for another workspace, a swapped manifest, an extra source, another versionKey or another Core output", () => {
    const mismatch = { ok: false, code: "COMPILE_RECEIPT_SUBJECT_MISMATCH", status: 409 };
    expect(check(stored(), env, { ...subject, workspaceId: "pilot-other" })).toEqual(mismatch);
    expect(check(stored(), env, { ...subject, manifestDigest: `sha256:${"9".repeat(64)}` })).toEqual(mismatch);
    expect(check(stored({ sourceDocuments: [...compiled.sourceDocuments, { documentId: "doc-two", versionKey: "b".repeat(64) }] })))
      .toEqual(mismatch);
    expect(check(stored({ sourceDocuments: compiled.sourceDocuments.map((d) => ({ ...d, versionKey: "f".repeat(64) })) })))
      .toEqual(mismatch);
    expect(check(stored({ coreExecution: { ...coreExecution, receipt: { ...coreExecution.receipt, outputSha256: `sha256:${"8".repeat(64)}` } } })))
      .toEqual(mismatch);
    expect(check(stored({ coreExecution: { ...coreExecution, worldStateId: "world-state-2" } }))).toEqual(mismatch);
    expect(check(stored({}, env, { collectionId: `collection-${"1".repeat(32)}` }))).toEqual(mismatch);
  });
});

describe("promote and rollback enforce the receipt", () => {
  beforeEach(() => {
    m.getUser.mockReset().mockResolvedValue({ id: userId });
    m.pilotAccess.mockReset().mockReturnValue({ membership: { workspaceId, role: "owner" } });
    m.productAccess.mockReset().mockResolvedValue({ ok: true });
    m.listObjects.mockReset().mockResolvedValue({ ok: true, objects: compiled.sourceDocuments.flatMap((d) => [
      { key: d.sanitizedKey, size: 100, lastModified: "2026-09-10T00:00:00.000Z" },
      { key: d.ocrJsonKey, size: 100, lastModified: "2026-09-10T00:01:00.000Z" }]) });
    m.promote.mockReset().mockResolvedValue({ ok: true, result: { status: "active" } });
    m.sourceAccess.mockReset().mockResolvedValue({ ok: true });
    m.ensureIndex.mockReset().mockResolvedValue({ status: "compiled", runId: "rrun-1", retrievalProfileId: "rprof-1" });
    vi.stubEnv("TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON", env.TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON);
  });
  afterEach(() => vi.unstubAllEnvs());

  const promoteRequest = () => POST(new Request(`https://tavonel.com/api/collections/${compiled.collectionId}/promote`, {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer session" },
    body: JSON.stringify({ operationId: "11111111-1111-4111-8111-111111111111", manifestDigest: compiled.manifestDigest,
      expectedCurrentManifest: null, expectedCurrentRevision: 0, reason: "Reviewed exact evidence." }),
  }), { params: Promise.resolve({ id: compiled.collectionId }) });

  it("promotes a candidate whose receipt verifies", async () => {
    m.getCandidate.mockResolvedValue({ ok: true, json: stored() });
    expect((await promoteRequest()).status).toBe(200);
    expect(m.promote).toHaveBeenCalledTimes(1);
  });

  it("never calls the promotion RPC for a tampered, missing or unverifiable receipt", async () => {
    const good = stored();
    const tampered = { ...good, signedReceipt: { ...good.signedReceipt,
      payloadJson: good.signedReceipt.payloadJson.replace(`"lifecycle":"candidate"`, `"lifecycle":"promoted"`) } };
    for (const [json, status, code] of [
      [tampered, 409, "COMPILE_RECEIPT_SIGNATURE_INVALID"],
      [stored({ signedReceipt: undefined }), 409, "COMPILE_RECEIPT_REQUIRED"],
    ] as const) {
      m.getCandidate.mockResolvedValue({ ok: true, json });
      const response = await promoteRequest();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code });
    }
    vi.stubEnv("TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON", "");
    m.getCandidate.mockResolvedValue({ ok: true, json: good });
    const response = await promoteRequest();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "EXPORT_TRUST_STORE_NOT_CONFIGURED" });
    expect(m.promote).not.toHaveBeenCalled();
    expect(m.listObjects).not.toHaveBeenCalled();
  });

  it("refuses rollback to a candidate with a tampered or missing receipt", async () => {
    const good = stored();
    m.getCandidate.mockResolvedValue({ ok: true, json: good });
    expect(await checkRollbackSourceAccess(workspaceId, compiled.collectionId, compiled.manifestDigest)).toEqual({ ok: true });
    const tampered = { ...good, signedReceipt: { ...good.signedReceipt,
      payloadJson: good.signedReceipt.payloadJson.replace(`"lifecycle":"candidate"`, `"lifecycle":"promoted"`) } };
    m.getCandidate.mockResolvedValue({ ok: true, json: tampered });
    expect(await checkRollbackSourceAccess(workspaceId, compiled.collectionId, compiled.manifestDigest))
      .toEqual({ ok: false, code: "COMPILE_RECEIPT_SIGNATURE_INVALID", status: 409 });
    m.getCandidate.mockResolvedValue({ ok: true, json: stored({ signedReceipt: undefined }) });
    expect(await checkRollbackSourceAccess(workspaceId, compiled.collectionId, compiled.manifestDigest))
      .toEqual({ ok: false, code: "COMPILE_RECEIPT_REQUIRED", status: 409 });
    expect(readExportTrustStoreEnv(env)).not.toBeNull();
  });
});
