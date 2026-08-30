import { WORKSPACE_ID_PATTERN } from "./immutable-keys";

const SOURCE_IDEMPOTENCY_KEY = /^[a-f0-9]{64}$/;

export function validSourceIdempotencyKey(value: string | null): value is string {
  return typeof value === "string" && SOURCE_IDEMPOTENCY_KEY.test(value);
}

export async function deterministicSourceDocumentId(workspaceKey: string, sourceIdempotencyKey: string) {
  if (!WORKSPACE_ID_PATTERN.test(workspaceKey) || !validSourceIdempotencyKey(sourceIdempotencyKey)) {
    throw new TypeError("source idempotency binding is invalid");
  }
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`tavonel-source-intake\u001f${workspaceKey}\u001f${sourceIdempotencyKey}`),
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
