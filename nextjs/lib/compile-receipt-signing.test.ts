import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compileReceiptAuditDetails,
  readCompileReceiptSigner,
  signCompileReceipt,
  verifyCompileReceipt,
  type SignedCompileReceipt,
} from "./compile-receipt-signing";
import { readExportSignerEnv, readExportTrustStoreEnv, verifyExportSignatureWithTrustStore } from "./export-signing";

const NOW = new Date("2026-09-27T00:00:00.000Z");

function signingEnv() {
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
        keyId: "foundation-receipts-2026",
        keyVersion: 1,
        algorithm: "Ed25519",
        status: "active",
        notBefore: "2026-09-01T00:00:00.000Z",
        expiresAt: "2027-09-01T00:00:00.000Z",
        publicKeySpkiDerBase64: spki.toString("base64"),
        publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
      }],
    }),
  };
}

const INPUT = {
  tenantId: "tenant-a",
  workspaceId: "tenant-a",
  collectionId: `collection-${"0".repeat(32)}`,
  manifestDigest: `sha256:${"a".repeat(64)}`,
  lifecycle: "candidate",
  coreRuntime: "tavonel-python-core-v2",
  worldStateId: "world-1",
  coreRequestId: "core-11111111-2222-4333-8444-555555555555",
  coreOutputSha256: `sha256:${"b".repeat(64)}`,
  customerDataGateReceiptSha256: `sha256:${"c".repeat(64)}`,
  sourceDocuments: [{ documentId: "doc-1", versionKey: "d".repeat(64) }],
  compiledAt: NOW.toISOString(),
};

function signed(env = signingEnv(), input: Record<string, unknown> = INPUT) {
  const signer = readCompileReceiptSigner(env, NOW)!;
  const result = signCompileReceipt(signer, input as typeof INPUT)!;
  return { env, trust: readExportTrustStoreEnv(env)!, ...result };
}

describe("signed compile receipts (gate precondition 8)", () => {
  it("signs a receipt that verifies against the trust store for its own tenant", () => {
    const { receipt, trust } = signed();

    const verified = verifyCompileReceipt(receipt, { tenantId: "tenant-a", workspaceId: "tenant-a" }, trust, NOW);

    expect(verified).toEqual({ ok: true, payload: { schemaVersion: "tavonel.compile_receipt.v1", ...INPUT } });
    expect(receipt.signature).toMatchObject({
      schemaVersion: "tavonel.export_signature.v2",
      signatureScope: "tavonel.signed_compile_receipt.v1",
      keyVersion: 1,
    });
  });

  it("refuses a tampered payload, a tampered signature and a re-keyed signature", () => {
    const { receipt, trust } = signed();
    const subject = { tenantId: "tenant-a", workspaceId: "tenant-a" };
    const payloadTampered: SignedCompileReceipt = {
      ...receipt,
      payloadJson: receipt.payloadJson.replace(`"lifecycle":"candidate"`, `"lifecycle":"promoted"`),
    };
    const signatureTampered: SignedCompileReceipt = {
      ...receipt,
      signature: { ...receipt.signature, signatureBase64: signed().receipt.signature.signatureBase64 },
    };
    // A valid signature by a key the trust store does not know.
    const foreign = signed(signingEnv()).receipt;

    for (const candidate of [payloadTampered, signatureTampered, foreign]) {
      expect(verifyCompileReceipt(candidate, subject, trust, NOW)).toEqual({ ok: false, code: "COMPILE_RECEIPT_SIGNATURE_INVALID" });
    }
  });

  it("keeps compile receipts and export manifests in separate signature scopes", () => {
    const env = signingEnv();
    const { receipt, trust } = signed(env);
    const bytes = Buffer.from(receipt.payloadJson, "utf8");
    // A compile receipt is not an export manifest ...
    expect(verifyExportSignatureWithTrustStore(bytes, receipt.signature, trust, NOW)).toBe(false);
    // ... and an export-scope signature over the same bytes is not a compile receipt.
    const exportSignature = readExportSignerEnv(env, NOW)!.signPayload(bytes);
    expect(verifyCompileReceipt({ payloadJson: receipt.payloadJson, signature: exportSignature as SignedCompileReceipt["signature"] },
      { tenantId: "tenant-a", workspaceId: "tenant-a" }, trust, NOW)).toEqual({ ok: false, code: "COMPILE_RECEIPT_SIGNATURE_INVALID" });
  });

  it("refuses a genuine receipt presented for another tenant or workspace", () => {
    const { receipt, trust } = signed();

    expect(verifyCompileReceipt(receipt, { tenantId: "tenant-b", workspaceId: "tenant-a" }, trust, NOW))
      .toEqual({ ok: false, code: "COMPILE_RECEIPT_SUBJECT_MISMATCH" });
    expect(verifyCompileReceipt(receipt, { tenantId: "tenant-a", workspaceId: "tenant-b" }, trust, NOW))
      .toEqual({ ok: false, code: "COMPILE_RECEIPT_SUBJECT_MISMATCH" });
  });

  it("has no signer without a key, without a trust store, or with a trust store that does not match", () => {
    const env = signingEnv();
    expect(readCompileReceiptSigner({}, NOW)).toBeNull();
    expect(readCompileReceiptSigner({ ...env, TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: undefined }, NOW)).toBeNull();
    // A v1 signer could sign, but nobody could verify it against a trust store later.
    expect(readCompileReceiptSigner({ ...env, TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: undefined }, NOW)).toBeNull();
    expect(readCompileReceiptSigner({ ...env, TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: signingEnv().TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON }, NOW)).toBeNull();
  });

  it("carries no document text, secret or unlisted field into the receipt or the audit row", () => {
    const { receipt, payload } = signed(signingEnv(), {
      ...INPUT,
      text: "The pump was inspected and the reading stayed inside the policy limits.",
      secretAccessKey: "r2-secret",
      sourceDocuments: [{ ...INPUT.sourceDocuments[0], text: "page one", ocrJsonKey: "immutable/x/ocr.json" }],
    });

    expect(receipt.payloadJson).not.toMatch(/pump|r2-secret|page one|ocr\.json|"text"/);
    const details = JSON.stringify(compileReceiptAuditDetails(receipt, payload));
    // The same guard `enterprise_audit_events.details` enforces in migration 0014.
    expect(details).not.toMatch(/"(content|text|secret|password|token|credential|private[_-]?key)"\s*:/i);
    expect(details).not.toMatch(/doc-1|d{64}/);
  });

  it("refuses to sign a value that does not fit its shape rather than dropping it", () => {
    const signer = readCompileReceiptSigner(signingEnv(), NOW)!;
    expect(signCompileReceipt(signer, { ...INPUT, coreRequestId: "has spaces and / slashes" })).toBeNull();
    expect(signCompileReceipt(signer, { ...INPUT, manifestDigest: "a".repeat(64) })).toBeNull();
    expect(signCompileReceipt(signer, { ...INPUT, sourceDocuments: [] })).toBeNull();
    expect(signCompileReceipt(signer, { ...INPUT, compiledAt: "2026-02-30T00:00:00.000Z" })).toBeNull();
    expect(signCompileReceipt(signer, { ...INPUT, compiledAt: "2026-13-45T00:00:00.000Z" })).toBeNull();
  });
});
