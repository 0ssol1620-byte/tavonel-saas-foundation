import { describe, expect, it } from "vitest";
import {
  authorizeOAuthVaultRequest,
  openOAuthSecret,
  parseOAuthVaultReference,
  readOAuthVaultConfig,
  sealOAuthSecret,
} from "./connector-oauth-vault";

const id = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const token = "a".repeat(43);
const key = Buffer.alloc(32, 7);

describe("OAuth secret vault", () => {
  it("requires a 256-bit canonical key and a non-trivial broker token", () => {
    expect(readOAuthVaultConfig({ TAVONEL_OAUTH_SECRET_BROKER_TOKEN: token, TAVONEL_OAUTH_SECRET_ENCRYPTION_KEY_B64: key.toString("base64") })).not.toBeNull();
    expect(readOAuthVaultConfig({ TAVONEL_OAUTH_SECRET_BROKER_TOKEN: "short", TAVONEL_OAUTH_SECRET_ENCRYPTION_KEY_B64: key.toString("base64") })).toBeNull();
    expect(readOAuthVaultConfig({ TAVONEL_OAUTH_SECRET_BROKER_TOKEN: token, TAVONEL_OAUTH_SECRET_ENCRYPTION_KEY_B64: Buffer.alloc(16).toString("base64") })).toBeNull();
  });

  it("authenticates in constant-length form and rejects malformed references", () => {
    const config = readOAuthVaultConfig({ TAVONEL_OAUTH_SECRET_BROKER_TOKEN: token, TAVONEL_OAUTH_SECRET_ENCRYPTION_KEY_B64: key.toString("base64") })!;
    expect(authorizeOAuthVaultRequest(`Bearer ${token}`, config)).toBe(true);
    expect(authorizeOAuthVaultRequest(`Bearer ${"b".repeat(43)}`, config)).toBe(false);
    expect(parseOAuthVaultReference(`vercel://oauth/${id}`)).toBe(id);
    expect(parseOAuthVaultReference("https://attacker.test/secret")).toBeNull();
  });

  it("round-trips AES-256-GCM and fails closed after ciphertext tampering", () => {
    const envelope = sealOAuthSecret(id, "oauth/google/client", "provider-secret", key);
    expect(JSON.stringify(envelope)).not.toContain("provider-secret");
    expect(openOAuthSecret(envelope, key)).toBe("provider-secret");
    expect(() => openOAuthSecret({ ...envelope, ciphertext_b64: Buffer.from("tampered").toString("base64") }, key)).toThrow();
  });
});
