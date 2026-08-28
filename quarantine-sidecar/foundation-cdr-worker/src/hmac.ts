const encoder = new TextEncoder();

export const HMAC_MIN_LENGTH = 32;

export function bytesToUnpaddedBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256DigestHeader(data: BufferSource): Promise<string> {
  return `sha256:${await sha256Hex(data)}`;
}

export async function cdrRequestSignature(
  secret: string,
  timestamp: string,
  requestId: string,
  inputSha256: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${requestId}.${inputSha256}`));
  return bytesToUnpaddedBase64Url(new Uint8Array(mac));
}

export function hmacSecretIsConfigured(secret: string | undefined | null): boolean {
  return typeof secret === "string" && secret.trim().length >= HMAC_MIN_LENGTH;
}