import { createHash } from "node:crypto";
import type { OAuthSourceItem } from "./connector-oauth-adapters";

// Dropbox's documented content hash is SHA256 over binary SHA256 hashes of 4 MiB blocks.
export function dropboxContentHash(bytes: Uint8Array): string {
  const aggregate = createHash("sha256");
  for (let offset = 0; offset < bytes.byteLength; offset += 4 * 1024 * 1024) {
    aggregate.update(createHash("sha256").update(bytes.subarray(offset, offset + 4 * 1024 * 1024)).digest());
  }
  return aggregate.digest("hex");
}

export function verifyDropboxSource(response: Response, bytes: Uint8Array, item: OAuthSourceItem): string | null {
  const header = response.headers.get("dropbox-api-result");
  if (!header || header.length > 32768) return "SOURCE_REVISION_UNQUALIFIED";
  let metadata: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(header);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "SOURCE_REVISION_UNQUALIFIED";
    metadata = parsed as Record<string, unknown>;
  } catch { return "SOURCE_REVISION_UNQUALIFIED"; }
  if (!item.nativeId.startsWith("id:") || metadata.id !== item.nativeId || metadata.rev !== item.revision) return "SOURCE_REVISION_MISMATCH";
  if (typeof metadata.content_hash !== "string" || !/^[a-f0-9]{64}$/.test(metadata.content_hash)
    || !Number.isSafeInteger(metadata.size)) return "SOURCE_REVISION_UNQUALIFIED";
  if (metadata.size !== bytes.byteLength || (item.sizeBytes !== null && item.sizeBytes !== bytes.byteLength)
    || dropboxContentHash(bytes) !== metadata.content_hash) return "SOURCE_CONTENT_HASH_MISMATCH";
  return null;
}
