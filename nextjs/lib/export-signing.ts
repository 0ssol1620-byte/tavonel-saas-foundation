import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,80}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type ExportSignature = {
  schemaVersion: "tavonel.export_signature.v1";
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpkiDerBase64: string;
  publicKeySpkiSha256: string;
  signedPayloadSha256: string;
  signatureBase64: string;
};

export type ExportSigner = {
  keyId: string;
  publicKeySpkiDerBase64: string;
  publicKeySpkiSha256: string;
  signPayload: (payload: Uint8Array) => ExportSignature;
};

function sha256(value: Uint8Array) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function decodeCanonicalBase64(value: string, expectedBytes?: number) {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)) {
    return null;
  }
  return decoded;
}

function decodePrivateKey(value: string) {
  if (value.length < 32 || value.length > 8_192) return null;
  try {
    const der = decodeCanonicalBase64(value);
    if (!der) return null;
    const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

function publicKeyFingerprint(privateKey: KeyObject) {
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    publicKey,
    publicKeySpkiDerBase64: der.toString("base64"),
    fingerprint: sha256(der),
  };
}

export function createExportSigner(input: { keyId: string; privateKeyPkcs8DerBase64: string }): ExportSigner | null {
  if (!KEY_ID.test(input.keyId)) return null;
  const privateKey = decodePrivateKey(input.privateKeyPkcs8DerBase64);
  if (!privateKey) return null;
  const { publicKey, publicKeySpkiDerBase64, fingerprint } = publicKeyFingerprint(privateKey);
  return {
    keyId: input.keyId,
    publicKeySpkiDerBase64,
    publicKeySpkiSha256: fingerprint,
    signPayload(payload) {
      const bytes = Buffer.from(payload);
      const signature = sign(null, bytes, privateKey);
      if (!verify(null, bytes, publicKey, signature)) {
        throw new Error("export_signature_self_verification_failed");
      }
      return {
        schemaVersion: "tavonel.export_signature.v1",
        algorithm: "Ed25519",
        keyId: input.keyId,
        publicKeySpkiDerBase64,
        publicKeySpkiSha256: fingerprint,
        signedPayloadSha256: sha256(bytes),
        signatureBase64: signature.toString("base64"),
      };
    },
  };
}

export function readExportSignerEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const keyId = env.TAVONEL_EXPORT_SIGNING_KEY_ID?.trim() ?? "";
  const privateKeyPkcs8DerBase64 = env.TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64?.trim() ?? "";
  if (!keyId && !privateKeyPkcs8DerBase64) return null;
  return createExportSigner({ keyId, privateKeyPkcs8DerBase64 });
}

export function verifyExportSignature(payload: Uint8Array, signature: ExportSignature, publicKeySpkiDer: Uint8Array) {
  if (signature.schemaVersion !== "tavonel.export_signature.v1" || signature.algorithm !== "Ed25519"
    || !KEY_ID.test(signature.keyId) || signature.signedPayloadSha256 !== sha256(payload)
    || signature.publicKeySpkiSha256 !== sha256(publicKeySpkiDer)
    || signature.publicKeySpkiDerBase64 !== Buffer.from(publicKeySpkiDer).toString("base64")) return false;
  try {
    const signatureBytes = decodeCanonicalBase64(signature.signatureBase64, 64);
    if (!signatureBytes) return false;
    const publicKey = createPublicKey({ key: Buffer.from(publicKeySpkiDer), format: "der", type: "spki" });
    return publicKey.asymmetricKeyType === "ed25519"
      && verify(null, Buffer.from(payload), publicKey, signatureBytes);
  } catch {
    return false;
  }
}
