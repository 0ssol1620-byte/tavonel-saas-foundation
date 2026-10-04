import { createHash } from "node:crypto";
import { microsoftGraphItemUrl, type OAuthSourceItem, type OAuthSourceTarget } from "./connector-oauth-adapters";
import type { OAuthConnectorProvider } from "./connector-oauth";
import { safeFetch } from "./safe-url";
import { quickXorHash } from "./quick-xor-hash";
import { dropboxContentHash } from "./dropbox-source-integrity";

export type SourceVersionObservation = {
  id: string; version: string; contentTag: string | null; mimeType: string;
  size: number | null; hash: string | null; algorithm: "sha256" | "sha1" | "md5" | "quickxor" | "dropbox" | null;
};
const refused = () => new Error("SOURCE_REVISION_UNQUALIFIED");
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw refused();
  return value as Record<string, unknown>;
}
function digest(value: unknown, length: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`, "i").test(value)) throw refused();
  return value.toLowerCase();
}

export async function observeSourceVersion(provider: OAuthConnectorProvider, item: OAuthSourceItem,
  target: OAuthSourceTarget, accessToken: string, fetcher: typeof fetch): Promise<SourceVersionObservation | null> {
  if (provider === "dropbox") return observeDropboxVersion(item, accessToken, fetcher);
  if (!text(item.nativeId)) throw refused();
  const google = provider === "google_drive";
  const url = new URL(google ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.nativeId)}` : microsoftGraphItemUrl(item.nativeId, target));
  if (google) {
    url.searchParams.set("fields", "id,version,mimeType,trashed,md5Checksum,sha256Checksum,size,capabilities(canDownload)");
    url.searchParams.set("supportsAllDrives", "true");
  } else url.searchParams.set("$select", "id,eTag,cTag,file,size,deleted");
  const response = await safeFetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } }, {
    origins: [url.origin], pathPrefix: google ? "/drive/v3/files/" : "/v1.0/", maxRedirects: 0,
    maxResponseBytes: 32768, timeoutMs: 8000,
  }, fetcher);
  if (!response.ok || response.status !== 200) throw new Error("SOURCE_VERSION_READ_FAILED");
  let row: Record<string, unknown>;
  try { row = object(JSON.parse(response.text)); } catch { throw refused(); }
  if (row.id !== item.nativeId || row.trashed === true || row.deleted !== undefined) throw new Error("SOURCE_REVISION_MISMATCH");
  if (google) {
    if (!text(row.version) || !/^\d+$/.test(row.version) || !text(row.mimeType)
      || object(row.capabilities).canDownload !== true) throw refused();
    const md5 = digest(row.md5Checksum, 32);
    const sha256 = digest(row.sha256Checksum, 64);
    if (item.revision !== row.version && item.revision !== md5) throw new Error("SOURCE_REVISION_MISMATCH");
    if (item.mimeType !== null && item.mimeType !== row.mimeType) throw new Error("SOURCE_REVISION_MISMATCH");
    const native = row.mimeType.startsWith("application/vnd.google-apps.");
    const size = native ? null : Number(row.size);
    if (!native && ((!md5 && !sha256) || typeof row.size !== "string" || !/^\d{1,20}$/.test(row.size) || !Number.isSafeInteger(size) || size! < 0)) throw refused();
    return { id: item.nativeId, version: row.version, contentTag: null, mimeType: row.mimeType,
      size, hash: native ? null : sha256 ?? md5, algorithm: native ? null : sha256 ? "sha256" : "md5" };
  }
  const file = object(row.file);
  const tag = text(row.eTag) ? row.eTag : text(row.cTag) ? row.cTag : null;
  if (!tag || !text(file.mimeType) || !Number.isSafeInteger(row.size) || (row.size as number) < 0) throw refused();
  if (item.revision !== tag && item.revision !== row.cTag) throw new Error("SOURCE_REVISION_MISMATCH");
  if (item.mimeType !== null && item.mimeType !== file.mimeType) throw new Error("SOURCE_REVISION_MISMATCH");
  const hashes = file.hashes === undefined ? {} : object(file.hashes);
  const sha1 = digest(hashes.sha1Hash, 40);
  const quick = hashes.quickXorHash;
  if (quick !== undefined && (typeof quick !== "string" || !/^[A-Za-z0-9+/]{27}=$/.test(quick)
    || Buffer.from(quick, "base64").toString("base64") !== quick)) throw refused();
  if (!sha1 && !quick) throw refused();
  return { id: item.nativeId, version: tag, contentTag: text(row.cTag) ? row.cTag : null,
    mimeType: file.mimeType, size: row.size as number, hash: sha1 ?? quick as string,
    algorithm: sha1 ? "sha1" : "quickxor" };
}

/*
  Dropbox's `rev:` download pins the bytes of the listed revision, but says nothing about whether that
  revision is still the file's current one: a stale or replayed list page would bind an older rev after
  a newer one. `files/get_metadata` on the stable `id:` path returns the current revision, so the listed
  rev must equal it. Revisions are opaque: they are compared for equality only, never ordered.
*/
async function observeDropboxVersion(item: OAuthSourceItem, accessToken: string, fetcher: typeof fetch): Promise<SourceVersionObservation> {
  if (!text(item.nativeId) || !item.nativeId.startsWith("id:")) throw refused();
  const url = "https://api.dropboxapi.com/2/files/get_metadata";
  const response = await safeFetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ path: item.nativeId, include_deleted: false }),
  }, { origins: ["https://api.dropboxapi.com"], pathPrefix: "/2/files/", maxRedirects: 0, maxResponseBytes: 32768, timeoutMs: 8000 }, fetcher);
  if (response.ok && response.status === 409) {
    // A file that no longer exists at its id is not current at any revision.
    let notFound = false;
    try {
      const error = object(object(JSON.parse(response.text)).error);
      notFound = error[".tag"] === "path" && object(error.path)[".tag"] === "not_found";
    } catch { notFound = false; }
    throw new Error(notFound ? "SOURCE_REVISION_SUPERSEDED" : "SOURCE_VERSION_READ_FAILED");
  }
  if (!response.ok || response.status !== 200) throw new Error("SOURCE_VERSION_READ_FAILED");
  let row: Record<string, unknown>;
  try { row = object(JSON.parse(response.text)); } catch { throw refused(); }
  if (row.id !== item.nativeId || row[".tag"] !== "file") throw new Error("SOURCE_REVISION_MISMATCH");
  if (!text(row.rev) || !/^[A-Za-z0-9_-]{1,512}$/.test(row.rev) || row.is_downloadable === false
    || !Number.isSafeInteger(row.size) || (row.size as number) < 0) throw refused();
  const hash = digest(row.content_hash, 64);
  if (!hash) throw refused();
  // The provider names a different current revision of the same file: the listed one is superseded.
  // Its change feed reports that newer revision (or the deletion) after this page's cursor.
  if (row.rev !== item.revision) throw new Error("SOURCE_REVISION_SUPERSEDED");
  return { id: item.nativeId, version: row.rev, contentTag: null, mimeType: "", size: row.size as number, hash, algorithm: "dropbox" };
}

export function verifySourceVersion(before: SourceVersionObservation | null, after: SourceVersionObservation | null, bytes: Uint8Array): string | null {
  if (JSON.stringify(before) !== JSON.stringify(after)) return "SOURCE_REVISION_MISMATCH";
  if (before?.size !== null && before?.size !== undefined && before.size !== bytes.byteLength) return "SOURCE_CONTENT_HASH_MISMATCH";
  if (before?.hash && before.algorithm) {
    const actual = before.algorithm === "quickxor" ? quickXorHash(bytes)
      : before.algorithm === "dropbox" ? dropboxContentHash(bytes) : createHash(before.algorithm).update(bytes).digest("hex");
    if (actual !== before.hash) return "SOURCE_CONTENT_HASH_MISMATCH";
  }
  return null;
}
