import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ACTION_RECEIPT_SCHEMA, readActionReceiptSigner, signActionReceipt, type ActionReceiptPayload } from "./action-receipt-signing";
import {
  ACTION_RECEIPT_SIGNATURE_SCOPE, ANSWER_RECEIPT_SIGNATURE_SCOPE, COMPILE_RECEIPT_SIGNATURE_SCOPE, readExportSignerEnv,
  readExportTrustStoreEnv, verifyExportSignatureWithTrustStore, type ExportSignature,
} from "./export-signing";

/*
  WO-AN-2, I-27: the receipt of an agent-originated proposal is signed under its own scope. Proved here: it
  verifies with the trust store under tavonel.signed_action_receipt.v1 and under no other scope; an answer
  or compile receipt signature does not verify as an action receipt; a signer without a trust store (v1) is
  not an action-receipt signer; an off-shape payload is not signed.
*/

function keyEnv(withTrust = true) {
  const pair = generateKeyPairSync("ed25519");
  const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
  const trust = {
    schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: "foundation-actions-2026",
    keys: [{
      keyId: "foundation-actions-2026", keyVersion: 1, algorithm: "Ed25519", status: "active",
      notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2030-01-01T00:00:00.000Z", publicKeySpkiDerBase64: spki.toString("base64"),
      publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
    }],
  };
  return {
    TAVONEL_EXPORT_SIGNING_KEY_ID: "foundation-actions-2026",
    TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    ...(withTrust ? { TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify(trust) } : {}),
  };
}

const ENV = keyEnv();
const NOW = new Date("2026-11-17T10:00:00.000Z");
const payload: ActionReceiptPayload = {
  schemaVersion: ACTION_RECEIPT_SCHEMA, proposalId: "00000000-0000-4000-8000-000000000001", actionType: "library_label",
  inputSha256: `sha256:${"a".repeat(64)}`, outcome: "executed", executedAt: "2026-11-17T10:00:00.000Z", resultRef: { replayed: false },
  confirmedIn: "signed_in_session",
};
const verify = (bytes: Buffer, signature: ExportSignature, scope: Parameters<typeof verifyExportSignatureWithTrustStore>[4]) =>
  verifyExportSignatureWithTrustStore(bytes, signature, readExportTrustStoreEnv(ENV)!, NOW, scope);

describe("action receipt signing (I-27)", () => {
  it("verifies under the action-receipt scope and under no other", () => {
    const signer = readActionReceiptSigner(ENV, NOW)!;
    const signed = signActionReceipt(signer, payload)!;
    expect(JSON.parse(signed.payloadJson)).toEqual(payload);
    expect(signed.signature.signatureScope).toBe(ACTION_RECEIPT_SIGNATURE_SCOPE);
    const bytes = Buffer.from(signed.payloadJson, "utf8");
    expect(verify(bytes, signed.signature, ACTION_RECEIPT_SIGNATURE_SCOPE)).toBe(true);
    expect(verify(bytes, signed.signature, ANSWER_RECEIPT_SIGNATURE_SCOPE)).toBe(false);
    expect(verify(bytes, signed.signature, COMPILE_RECEIPT_SIGNATURE_SCOPE)).toBe(false);
    expect(verify(Buffer.from(signed.payloadJson.replace("executed", "failed")), signed.signature, ACTION_RECEIPT_SIGNATURE_SCOPE)).toBe(false);
  });

  it("an answer-receipt signature over the same bytes does not verify as an action receipt", () => {
    const answerSigner = readExportSignerEnv(ENV, NOW, ANSWER_RECEIPT_SIGNATURE_SCOPE)!;
    const bytes = Buffer.from(JSON.stringify(payload), "utf8");
    const signature = answerSigner.signPayload(bytes);
    expect(verify(bytes, signature, ANSWER_RECEIPT_SIGNATURE_SCOPE)).toBe(true);
    expect(verify(bytes, signature, ACTION_RECEIPT_SIGNATURE_SCOPE)).toBe(false);
    // A signer for another scope is refused by signActionReceipt rather than mislabelled.
    expect(signActionReceipt(answerSigner, payload)).toBeNull();
  });

  it("no trust store, no key, or a broken key: no action-receipt signer", () => {
    expect(readActionReceiptSigner(keyEnv(false), NOW)).toBeNull();
    expect(readActionReceiptSigner({}, NOW)).toBeNull();
    expect(readActionReceiptSigner({ ...ENV, TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: "{" }, NOW)).toBeNull();
  });

  it.each([
    ["another schema", { schemaVersion: "tavonel.answer_receipt.v1" }],
    ["a proposal id that is not a uuid", { proposalId: "p1" }],
    ["an input digest that is not sha256", { inputSha256: "sha256:abc" }],
    ["an unknown outcome", { outcome: "undone" }],
    ["a time that is not canonical ISO", { executedAt: "2026-11-17" }],
    ["a result reference that is not an object", { resultRef: [] }],
    ["a confirmation that is not a session", { confirmedIn: "agent" }],
  ])("refuses to sign %s", (_name, fields) => {
    expect(signActionReceipt(readActionReceiptSigner(ENV, NOW)!, { ...payload, ...fields } as unknown as ActionReceiptPayload)).toBeNull();
  });
});
