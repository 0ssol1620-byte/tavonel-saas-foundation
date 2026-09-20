import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,80}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SIGNATURE_SCOPE = "tavonel.signed_export_manifest.v1" as const;

export type ExportSignatureV1 = {
  schemaVersion: "tavonel.export_signature.v1";
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpkiDerBase64: string;
  publicKeySpkiSha256: string;
  signedPayloadSha256: string;
  signatureBase64: string;
};

export type ExportSignatureV2 = {
  schemaVersion: "tavonel.export_signature.v2";
  algorithm: "Ed25519";
  signatureScope: typeof SIGNATURE_SCOPE;
  keyId: string;
  keyVersion: number;
  issuedAt: string;
  expiresAt: string;
  publicKeySpkiDerBase64: string;
  publicKeySpkiSha256: string;
  signedPayloadSha256: string;
  signatureBase64: string;
};

export type ExportSignature = ExportSignatureV1 | ExportSignatureV2;

export type ExportSigner = {
  keyId: string;
  keyVersion?: number;
  publicKeySpkiDerBase64: string;
  publicKeySpkiSha256: string;
  signPayload: (payload: Uint8Array) => ExportSignature;
};

export type ExportTrustRecord = {
  schemaVersion: "tavonel.export_trust.v1";
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpkiDerBase64: string;
  publicKeySpkiSha256: string;
};

export type ExportTrustKey = {
  keyId: string;
  keyVersion: number;
  algorithm: "Ed25519";
  status: "active" | "retired" | "revoked";
  notBefore: string;
  expiresAt: string;
  publicKeySpkiDerBase64: string;
  publicKeySpkiSha256: string;
};

export type ExportTrustStore = {
  schemaVersion: "tavonel.export_trust.v2";
  minimumSignatureVersion: 2;
  activeKeyId: string;
  keys: ExportTrustKey[];
};

type LifecycleSignerInput = {
  keyId: string;
  keyVersion: number;
  privateKeyPkcs8DerBase64: string;
  notBefore: string;
  expiresAt: string;
  issuedAt?: string;
};

function sha256(value: Uint8Array) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseInstant(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}

function decodeCanonicalBase64(value: string, expectedBytes?: number) {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)) return null;
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
  return { publicKey, publicKeySpkiDerBase64: der.toString("base64"), fingerprint: sha256(der) };
}

function v2SignatureInput(payload: Uint8Array, signature: Pick<ExportSignatureV2,
  "signatureScope" | "keyId" | "keyVersion" | "issuedAt" | "expiresAt" | "signedPayloadSha256">) {
  const protectedHeader = `${JSON.stringify({
    schemaVersion: "tavonel.export_signature.v2",
    algorithm: "Ed25519",
    signatureScope: signature.signatureScope,
    keyId: signature.keyId,
    keyVersion: signature.keyVersion,
    issuedAt: signature.issuedAt,
    expiresAt: signature.expiresAt,
    signedPayloadSha256: signature.signedPayloadSha256,
  })}\n`;
  return Buffer.concat([Buffer.from(protectedHeader, "utf8"), Buffer.from(payload)]);
}

export function createExportSigner(input: {
  keyId: string;
  privateKeyPkcs8DerBase64: string;
} | LifecycleSignerInput): ExportSigner | null {
  if (!KEY_ID.test(input.keyId)) return null;
  const privateKey = decodePrivateKey(input.privateKeyPkcs8DerBase64);
  if (!privateKey) return null;
  const lifecycle = "keyVersion" in input ? input : null;
  const issuedAt = lifecycle?.issuedAt ?? new Date().toISOString();
  const issued = lifecycle ? parseInstant(issuedAt) : null;
  const notBefore = lifecycle ? parseInstant(lifecycle.notBefore) : null;
  const expires = lifecycle ? parseInstant(lifecycle.expiresAt) : null;
  if (lifecycle && (!Number.isSafeInteger(lifecycle.keyVersion) || lifecycle.keyVersion < 1
    || issued === null || notBefore === null || expires === null || issued < notBefore || issued >= expires)) return null;
  const { publicKey, publicKeySpkiDerBase64, fingerprint } = publicKeyFingerprint(privateKey);
  return {
    keyId: input.keyId,
    ...(lifecycle ? { keyVersion: lifecycle.keyVersion } : {}),
    publicKeySpkiDerBase64,
    publicKeySpkiSha256: fingerprint,
    signPayload(payload) {
      const bytes = Buffer.from(payload);
      const protectedFields = lifecycle ? {
        signatureScope: SIGNATURE_SCOPE,
        keyId: input.keyId,
        keyVersion: lifecycle.keyVersion,
        issuedAt,
        expiresAt: lifecycle.expiresAt,
        signedPayloadSha256: sha256(bytes),
      } : null;
      const signedBytes = protectedFields ? v2SignatureInput(bytes, protectedFields) : bytes;
      const signature = sign(null, signedBytes, privateKey);
      if (!verify(null, signedBytes, publicKey, signature)) throw new Error("export_signature_self_verification_failed");
      const common = {
        algorithm: "Ed25519" as const,
        keyId: input.keyId,
        publicKeySpkiDerBase64,
        publicKeySpkiSha256: fingerprint,
        signedPayloadSha256: protectedFields?.signedPayloadSha256 ?? sha256(bytes),
        signatureBase64: signature.toString("base64"),
      };
      return lifecycle ? {
        schemaVersion: "tavonel.export_signature.v2",
        signatureScope: SIGNATURE_SCOPE,
        keyVersion: lifecycle.keyVersion,
        issuedAt,
        expiresAt: lifecycle.expiresAt,
        ...common,
      } : { schemaVersion: "tavonel.export_signature.v1", ...common };
    },
  };
}

function parseTrustStore(value: string): ExportTrustStore | null {
  try {
    const parsed = JSON.parse(value) as Partial<ExportTrustStore>;
    if (parsed.schemaVersion !== "tavonel.export_trust.v2" || parsed.minimumSignatureVersion !== 2
      || !KEY_ID.test(parsed.activeKeyId ?? "") || !Array.isArray(parsed.keys) || parsed.keys.length === 0) return null;
    const identities = new Set<string>();
    for (const key of parsed.keys) {
      const publicKey = decodeCanonicalBase64(key?.publicKeySpkiDerBase64 ?? "");
      const identity = `${key?.keyId}:${key?.keyVersion}`;
      if (!key || !KEY_ID.test(key.keyId) || !Number.isSafeInteger(key.keyVersion) || key.keyVersion < 1
        || identities.has(identity) || key.algorithm !== "Ed25519" || !["active", "retired", "revoked"].includes(key.status)
        || parseInstant(key.notBefore) === null || parseInstant(key.expiresAt) === null
        || Date.parse(key.notBefore) >= Date.parse(key.expiresAt) || !publicKey
        || !SHA256.test(key.publicKeySpkiSha256) || sha256(publicKey) !== key.publicKeySpkiSha256) return null;
      try {
        if (createPublicKey({ key: publicKey, format: "der", type: "spki" }).asymmetricKeyType !== "ed25519") return null;
      } catch {
        return null;
      }
      identities.add(identity);
    }
    if (parsed.keys.filter((key) => key.keyId === parsed.activeKeyId && key.status === "active").length !== 1) return null;
    return parsed as ExportTrustStore;
  } catch {
    return null;
  }
}

export function readExportTrustStoreEnv(env: Readonly<Record<string, string | undefined>> = process.env) {
  const value = env.TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON?.trim();
  return value ? parseTrustStore(value) : null;
}

export function readExportSignerEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now = new Date(),
) {
  const keyId = env.TAVONEL_EXPORT_SIGNING_KEY_ID?.trim() ?? "";
  const privateKeyPkcs8DerBase64 = env.TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64?.trim() ?? "";
  if (!keyId && !privateKeyPkcs8DerBase64) return null;
  const trustStoreConfigured = env.TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON !== undefined;
  const trust = readExportTrustStoreEnv(env);
  if (trustStoreConfigured && !trust) return null;
  if (!trust) return createExportSigner({ keyId, privateKeyPkcs8DerBase64 });
  const key = trust.keys.find((candidate) => candidate.keyId === trust.activeKeyId && candidate.status === "active");
  if (!key || key.keyId !== keyId) return null;
  const signer = createExportSigner({ keyId, keyVersion: key.keyVersion, privateKeyPkcs8DerBase64,
    notBefore: key.notBefore, expiresAt: key.expiresAt, issuedAt: now.toISOString() });
  return signer && signer.publicKeySpkiSha256 === key.publicKeySpkiSha256 ? signer : null;
}

export function exportTrustRecord(signer: ExportSigner): ExportTrustRecord {
  return { schemaVersion: "tavonel.export_trust.v1", algorithm: "Ed25519", keyId: signer.keyId,
    publicKeySpkiDerBase64: signer.publicKeySpkiDerBase64, publicKeySpkiSha256: signer.publicKeySpkiSha256 };
}

function verifyBytes(payload: Uint8Array, signature: ExportSignature, publicKeySpkiDer: Uint8Array) {
  if (signature.algorithm !== "Ed25519" || !KEY_ID.test(signature.keyId) || signature.signedPayloadSha256 !== sha256(payload)
    || signature.publicKeySpkiSha256 !== sha256(publicKeySpkiDer)
    || signature.publicKeySpkiDerBase64 !== Buffer.from(publicKeySpkiDer).toString("base64")) return false;
  try {
    const signatureBytes = decodeCanonicalBase64(signature.signatureBase64, 64);
    if (!signatureBytes) return false;
    const publicKey = createPublicKey({ key: Buffer.from(publicKeySpkiDer), format: "der", type: "spki" });
    const signedBytes = signature.schemaVersion === "tavonel.export_signature.v2"
      ? v2SignatureInput(payload, signature)
      : Buffer.from(payload);
    return publicKey.asymmetricKeyType === "ed25519" && verify(null, signedBytes, publicKey, signatureBytes);
  } catch {
    return false;
  }
}

export function verifyExportSignature(payload: Uint8Array, signature: ExportSignature, publicKeySpkiDer: Uint8Array) {
  if (signature.schemaVersion === "tavonel.export_signature.v1") return verifyBytes(payload, signature, publicKeySpkiDer);
  const issued = parseInstant(signature.issuedAt);
  const expires = parseInstant(signature.expiresAt);
  return signature.schemaVersion === "tavonel.export_signature.v2" && signature.signatureScope === SIGNATURE_SCOPE
    && Number.isSafeInteger(signature.keyVersion) && signature.keyVersion > 0
    && issued !== null && expires !== null && issued < expires && verifyBytes(payload, signature, publicKeySpkiDer);
}

export function verifyExportSignatureWithTrustStore(
  payload: Uint8Array,
  signature: ExportSignature,
  trust: ExportTrustStore,
  now = new Date(),
) {
  if (trust.minimumSignatureVersion >= 2 && signature.schemaVersion !== "tavonel.export_signature.v2") return false;
  if (signature.schemaVersion !== "tavonel.export_signature.v2") return false;
  const key = trust.keys.find((candidate) => candidate.keyId === signature.keyId && candidate.keyVersion === signature.keyVersion);
  const issued = parseInstant(signature.issuedAt);
  const signatureExpiry = parseInstant(signature.expiresAt);
  if (!key || key.status === "revoked" || issued === null || signatureExpiry === null
    || issued < Date.parse(key.notBefore) || issued >= Date.parse(key.expiresAt)
    || signatureExpiry > Date.parse(key.expiresAt) || now.getTime() >= signatureExpiry
    || key.publicKeySpkiSha256 !== signature.publicKeySpkiSha256
    || key.publicKeySpkiDerBase64 !== signature.publicKeySpkiDerBase64) return false;
  const publicKey = decodeCanonicalBase64(key.publicKeySpkiDerBase64);
  return Boolean(publicKey && verifyExportSignature(payload, signature, publicKey));
}
