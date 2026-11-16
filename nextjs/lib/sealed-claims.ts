import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;
const SEALED = /^[A-Za-z0-9_-]{40,4096}$/;

/*
  AES-256-GCM sealed claim sets, the purpose bound as additional data so a token minted for one
  use can never open as another. Same construction as the remote MCP OAuth codes
  (`lib/remote-mcp.ts`); kept here so a second consumer does not copy it again.
*/

/** Null when the secret is missing or short: the caller then issues no token, never an unsigned one. */
export function pageTokenKey(env: Env = process.env): Buffer | null {
  const secret = env.TAVONEL_REMOTE_MCP_SIGNING_SECRET?.trim() ?? "";
  return secret.length >= 32 ? createHash("sha256").update(`tavonel-page-token-v1\0${secret}`).digest() : null;
}

/** Throws on a key that is not 32 bytes: a mis-sized key must stop the response, not weaken it. */
export function sealClaims(purpose: string, claims: object, key: Buffer): string {
  if (key.length !== 32) throw new Error("SEALING_KEY_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify(claims), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Null for anything that does not authenticate under this purpose and key. */
export function unsealClaims(purpose: string, token: string, key: Buffer): Record<string, unknown> | null {
  if (key.length !== 32 || !SEALED.test(token)) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(12, 28));
    const value: unknown = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
