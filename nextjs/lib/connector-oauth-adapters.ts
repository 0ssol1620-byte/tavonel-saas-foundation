import type { OAuthConnectorProvider } from "./connector-oauth";

export type OAuthSourceTarget = {
  rootPath?: string;
  driveId?: string;
  siteId?: string;
};

export type OAuthSourceItem = {
  nativeId: string;
  name: string;
  revision: string;
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  kind: "file" | "folder" | "deleted";
};

export type OAuthSourcePage = {
  items: OAuthSourceItem[];
  cursor: string | null;
  complete: boolean;
};

const GRAPH_ORIGIN = "https://graph.microsoft.com";
export const OAUTH_SOURCE_PAGE_SIZE = 25;

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function boundedSize(value: unknown) {
  const size = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(size) && size >= 0 && size <= 524_288_000 ? size : null;
}

function safeGraphContinuation(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === GRAPH_ORIGIN && url.pathname.startsWith("/v1.0/") && value.length <= 4_096 ? value : null;
  } catch {
    return null;
  }
}

function validTarget(target: OAuthSourceTarget) {
  const values = [target.rootPath, target.driveId, target.siteId].filter((value): value is string => value !== undefined);
  return values.every((value) => value.length <= 512 && /^[A-Za-z0-9._~!$&'()+,;=:@/ -]*$/.test(value));
}

async function jsonRequest(url: string, accessToken: string, init: RequestInit, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error("OAUTH_SOURCE_LIST_FAILED");
  return payload;
}

async function listGoogleDrive(accessToken: string, cursor: string | null, fetcher: typeof fetch): Promise<OAuthSourcePage> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", String(OAUTH_SOURCE_PAGE_SIZE));
  url.searchParams.set("q", "trashed = false");
  url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,version,md5Checksum)");
  if (cursor) url.searchParams.set("pageToken", cursor);
  const payload = await jsonRequest(url.toString(), accessToken, {}, fetcher);
  const rows = Array.isArray(payload.files) ? payload.files as Array<Record<string, unknown>> : [];
  const items = rows.map((row): OAuthSourceItem | null => {
    const nativeId = boundedString(row.id, 512);
    const name = boundedString(row.name, 512);
    if (!nativeId || !name) return null;
    const mimeType = boundedString(row.mimeType, 127);
    const folder = mimeType === "application/vnd.google-apps.folder";
    const revision = boundedString(row.md5Checksum, 512) ?? boundedString(row.version, 512) ?? boundedString(row.modifiedTime, 512);
    if (!revision) return null;
    return { nativeId, name, revision, mimeType, sizeBytes: folder ? null : boundedSize(row.size), modifiedAt: boundedString(row.modifiedTime, 64), kind: folder ? "folder" : "file" };
  }).filter((item): item is OAuthSourceItem => item !== null);
  const next = boundedString(payload.nextPageToken, 2_048);
  return { items, cursor: next, complete: next === null };
}

async function listDropbox(accessToken: string, cursor: string | null, target: OAuthSourceTarget, fetcher: typeof fetch): Promise<OAuthSourcePage> {
  const continuation = cursor !== null;
  const url = continuation ? "https://api.dropboxapi.com/2/files/list_folder/continue" : "https://api.dropboxapi.com/2/files/list_folder";
  const body = continuation
    ? { cursor }
    : { path: target.rootPath ?? "", recursive: true, include_deleted: true, limit: OAUTH_SOURCE_PAGE_SIZE };
  const payload = await jsonRequest(url, accessToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, fetcher);
  const rows = Array.isArray(payload.entries) ? payload.entries as Array<Record<string, unknown>> : [];
  const items = rows.map((row): OAuthSourceItem | null => {
    const tag = row[".tag"];
    const nativeId = boundedString(row.id, 512) ?? boundedString(row.path_lower, 1_024);
    const name = boundedString(row.name, 512);
    if (!nativeId || !name || !["file", "folder", "deleted"].includes(String(tag))) return null;
    const deleted = tag === "deleted";
    const revision = deleted ? `deleted:${boundedString(row.path_lower, 1_024) ?? nativeId}` : boundedString(row.rev, 512) ?? `folder:${nativeId}`;
    return { nativeId, name, revision, mimeType: null, sizeBytes: tag === "file" ? boundedSize(row.size) : null, modifiedAt: boundedString(row.server_modified, 64), kind: tag as OAuthSourceItem["kind"] };
  }).filter((item): item is OAuthSourceItem => item !== null);
  const next = boundedString(payload.cursor, 4_096);
  const hasMore = payload.has_more === true;
  if (hasMore && !next) throw new Error("OAUTH_SOURCE_CURSOR_INVALID");
  return { items, cursor: next, complete: !hasMore };
}

async function listMicrosoftGraph(accessToken: string, cursor: string | null, target: OAuthSourceTarget, fetcher: typeof fetch): Promise<OAuthSourcePage> {
  let url = cursor ? safeGraphContinuation(cursor) : null;
  if (cursor && !url) throw new Error("OAUTH_SOURCE_CURSOR_INVALID");
  if (!url) {
    if (target.driveId) url = `${GRAPH_ORIGIN}/v1.0/drives/${encodeURIComponent(target.driveId)}/root/delta`;
    else if (target.siteId) url = `${GRAPH_ORIGIN}/v1.0/sites/${encodeURIComponent(target.siteId)}/drive/root/delta`;
    else url = `${GRAPH_ORIGIN}/v1.0/me/drive/root/delta`;
    const firstPage = new URL(url);
    firstPage.searchParams.set("$top", String(OAUTH_SOURCE_PAGE_SIZE));
    url = firstPage.toString();
  }
  const payload = await jsonRequest(url, accessToken, {}, fetcher);
  const rows = Array.isArray(payload.value) ? payload.value as Array<Record<string, unknown>> : [];
  const items = rows.map((row): OAuthSourceItem | null => {
    const nativeId = boundedString(row.id, 512);
    const name = boundedString(row.name, 512) ?? nativeId;
    if (!nativeId || !name) return null;
    const deleted = Boolean(row.deleted);
    const folder = Boolean(row.folder);
    const file = row.file && typeof row.file === "object" ? row.file as Record<string, unknown> : {};
    const eTag = boundedString(row.eTag, 512) ?? boundedString(row.cTag, 512) ?? boundedString(row.lastModifiedDateTime, 64);
    if (!eTag && !deleted) return null;
    return {
      nativeId,
      name,
      revision: deleted ? `deleted:${nativeId}` : eTag!,
      mimeType: boundedString(file.mimeType, 127),
      sizeBytes: folder || deleted ? null : boundedSize(row.size),
      modifiedAt: boundedString(row.lastModifiedDateTime, 64),
      kind: deleted ? "deleted" : folder ? "folder" : "file",
    };
  }).filter((item): item is OAuthSourceItem => item !== null);
  const next = safeGraphContinuation(payload["@odata.nextLink"] ?? payload["@odata.deltaLink"]);
  if ((payload["@odata.nextLink"] || payload["@odata.deltaLink"]) && !next) throw new Error("OAUTH_SOURCE_CURSOR_INVALID");
  return { items, cursor: next, complete: !payload["@odata.nextLink"] };
}

export async function listOAuthSourcePage(input: {
  provider: OAuthConnectorProvider;
  accessToken: string;
  cursor: string | null;
  target?: OAuthSourceTarget;
  fetcher?: typeof fetch;
}) {
  const target = input.target ?? {};
  if (!input.accessToken || !validTarget(target)) throw new Error("OAUTH_SOURCE_INPUT_INVALID");
  const fetcher = input.fetcher ?? fetch;
  if (input.provider === "google_drive") return listGoogleDrive(input.accessToken, input.cursor, fetcher);
  if (input.provider === "dropbox") return listDropbox(input.accessToken, input.cursor, target, fetcher);
  return listMicrosoftGraph(input.accessToken, input.cursor, target, fetcher);
}

const GOOGLE_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.presentation": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.google-apps.drawing": "image/png",
};

export function oauthSourceDownloadRequest(input: {
  provider: OAuthConnectorProvider;
  nativeId: string;
  mimeType?: string | null;
  target?: OAuthSourceTarget;
}) {
  if (!input.nativeId || input.nativeId.length > 512) throw new Error("OAUTH_SOURCE_INPUT_INVALID");
  if (input.provider === "google_drive") {
    const exportMime = input.mimeType ? GOOGLE_EXPORTS[input.mimeType] : undefined;
    const path = exportMime ? "export" : "";
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.nativeId)}${path ? `/${path}` : ""}`);
    if (exportMime) url.searchParams.set("mimeType", exportMime);
    else url.searchParams.set("alt", "media");
    if (input.mimeType?.startsWith("application/vnd.google-apps.") && !exportMime) throw new Error("OAUTH_SOURCE_NATIVE_TYPE_UNSUPPORTED");
    return { url: url.toString(), method: "GET" as const, headers: {} };
  }
  if (input.provider === "dropbox") return {
    url: "https://content.dropboxapi.com/2/files/download",
    method: "POST" as const,
    headers: { "Dropbox-API-Arg": JSON.stringify({ path: input.nativeId }) },
  };
  const drive = input.target?.driveId ? `drives/${encodeURIComponent(input.target.driveId)}` : "me/drive";
  return { url: `${GRAPH_ORIGIN}/v1.0/${drive}/items/${encodeURIComponent(input.nativeId)}/content`, method: "GET" as const, headers: {} };
}
