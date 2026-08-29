import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createExportSigner,
  readExportSignerEnv,
  verifyExportSignature,
} from "./export-signing";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKeyPkcs8DerBase64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKeySpkiDer: createPublicKey(pair.privateKey).export({ format: "der", type: "spki" }),
  };
}

describe("Foundation signed exports", () => {
  it("signs exact bytes with Ed25519 and rejects tampering", () => {
    const material = keys();
    const signer = createExportSigner({ keyId: "foundation-export-2026", ...material });
    expect(signer).not.toBeNull();
    const payload = Buffer.from("exact export manifest bytes\n");
    const signature = signer!.signPayload(payload);

    expect(verifyExportSignature(payload, signature, material.publicKeySpkiDer)).toBe(true);
    expect(verifyExportSignature(Buffer.from("tampered\n"), signature, material.publicKeySpkiDer)).toBe(false);
    expect(verifyExportSignature(payload, { ...signature, signatureBase64: "AAAA" }, material.publicKeySpkiDer)).toBe(false);
    expect(verifyExportSignature(payload, { ...signature, signatureBase64: `${signature.signatureBase64}=` }, material.publicKeySpkiDer)).toBe(false);
  });

  it("fails closed for absent, malformed and non-Ed25519 environment keys", () => {
    expect(readExportSignerEnv({})).toBeNull();
    expect(readExportSignerEnv({
      TAVONEL_EXPORT_SIGNING_KEY_ID: "bad key id",
      TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: "not-base64",
    })).toBeNull();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(createExportSigner({
      keyId: "foundation-export-rsa",
      privateKeyPkcs8DerBase64: rsa.export({ format: "der", type: "pkcs8" }).toString("base64"),
    })).toBeNull();
  });
});
