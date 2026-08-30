import { createCipheriv, createDecipheriv, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

type OAuthVaultConfig = {
  brokerToken: string;
  encryptionKey: Buffer;
};

type SecretEnvelope = {
  secret_id: string;
  secret_name: string;
  ciphertext_b64: string;
  nonce_b64: string;
  auth_tag_b64: string;
};

const SECRET_NAME = /^[A-Za-z0-9._/-]{3,240}$/;
const SECRET_REFERENCE = /^vercel:\/\/oauth\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function readOAuthVaultConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OAuthVaultConfig | null {
  const brokerToken = env.TAVONEL_OAUTH_SECRET_BROKER_TOKEN?.trim() ?? "";
  const encodedKey = env.TAVONEL_OAUTH_SECRET_ENCRYPTION_KEY_B64?.trim() ?? "";
  if (brokerToken.length < 43 || !/^[A-Za-z0-9_-]+$/.test(brokerToken)) return null;
  try {
    const encryptionKey = Buffer.from(encodedKey, "base64");
    if (encryptionKey.length !== 32 || encryptionKey.toString("base64") !== encodedKey) return null;
    return { brokerToken, encryptionKey };
  } catch {
    return null;
  }
}

export function authorizeOAuthVaultRequest(authorization: string | null, config: OAuthVaultConfig) {
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedBytes = Buffer.from(config.brokerToken);
  const suppliedBytes = Buffer.from(supplied);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function parseOAuthVaultReference(reference: unknown) {
  return typeof reference === "string" ? SECRET_REFERENCE.exec(reference)?.[1] ?? null : null;
}

export function sealOAuthSecret(secretId: string, name: string, value: string, key: Buffer): SecretEnvelope {
  if (!SECRET_NAME.test(name) || !value || Buffer.byteLength(value) > 65_536) throw new Error("OAUTH_SECRET_INPUT_INVALID");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`tavonel:oauth-secret:v1:${secretId}:${name}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    secret_id: secretId,
    secret_name: name,
    ciphertext_b64: ciphertext.toString("base64"),
    nonce_b64: nonce.toString("base64"),
    auth_tag_b64: cipher.getAuthTag().toString("base64"),
  };
}

export function openOAuthSecret(envelope: SecretEnvelope, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce_b64, "base64"));
  decipher.setAAD(Buffer.from(`tavonel:oauth-secret:v1:${envelope.secret_id}:${envelope.secret_name}`, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.auth_tag_b64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext_b64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function writeOAuthVaultSecret(name: string, value: string, key: Buffer) {
  const admin = readSupabaseAdminConfig();
  if (!admin) throw new Error("OAUTH_SECRET_STORE_UNAVAILABLE");
  const secretId = randomUUID();
  const envelope = sealOAuthSecret(secretId, name, value, key);
  const response = await supabaseAdminRequest(admin, "/rest/v1/foundation_oauth_secret_envelopes", {
    method: "POST",
    body: JSON.stringify(envelope),
  });
  if (!response.ok) throw new Error("OAUTH_SECRET_WRITE_FAILED");
  return `vercel://oauth/${secretId}`;
}

export async function readOAuthVaultSecret(reference: string, key: Buffer) {
  const secretId = parseOAuthVaultReference(reference);
  const admin = readSupabaseAdminConfig();
  if (!secretId || !admin) throw new Error("OAUTH_SECRET_REFERENCE_INVALID");
  const query = new URLSearchParams({
    select: "secret_id,secret_name,ciphertext_b64,nonce_b64,auth_tag_b64",
    secret_id: `eq.${secretId}`,
    limit: "1",
  });
  const response = await supabaseAdminRequest(admin, `/rest/v1/foundation_oauth_secret_envelopes?${query}`);
  if (!response.ok) throw new Error("OAUTH_SECRET_READ_FAILED");
  const envelope = ((await response.json()) as SecretEnvelope[])[0];
  if (!envelope || envelope.secret_id !== secretId) throw new Error("OAUTH_SECRET_VALUE_MISSING");
  return openOAuthSecret(envelope, key);
}

export async function deleteOAuthVaultSecret(reference: string) {
  const secretId = parseOAuthVaultReference(reference);
  const admin = readSupabaseAdminConfig();
  if (!secretId || !admin) throw new Error("OAUTH_SECRET_REFERENCE_INVALID");
  const response = await supabaseAdminRequest(
    admin,
    `/rest/v1/foundation_oauth_secret_envelopes?secret_id=eq.${secretId}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("OAUTH_SECRET_DELETE_FAILED");
}
