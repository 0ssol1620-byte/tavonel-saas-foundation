import type { OAuthConnectorProvider } from "./connector-oauth";
import { assertSafeUrl, safeFetch, type EgressPolicy } from "./safe-url";

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
const DRIVE_ORIGIN = "https://www.googleapis.com";
const DROPBOX_API_ORIGIN = "https://api.dropboxapi.com";
const DROPBOX_CONTENT_ORIGIN = "https://content.dropboxapi.com";
export const OAUTH_SOURCE_PAGE_SIZE = 25;

/*
  Where each provider is allowed to be (blueprint §38, S-71/S-72).

  The origins were already constants in this file; what was missing was anything that checked
  the URL actually built from them, and a redirect off them was followed without a word. Every
  request below now goes through `safeFetch` with the policy for its provider, so a 302 to
  169.254.169.254 -- or to any other origin -- is a refusal rather than a request.
*/
const LIST_POLICY: Record<OAuthConnectorProvider, EgressPolicy> = {
  google_drive: { origins: [DRIVE_ORIGIN], pathPrefix: "/drive/v3/", maxUrlLength: 4_096 },
  dropbox: { origins: [DROPBOX_API_ORIGIN], pathPrefix: "/2/files/", maxUrlLength: 4_096 },
  microsoft_graph: { origins: [GRAPH_ORIGIN], pathPrefix: "/v1.0/", maxUrlLength: 4_096 },
};

const DOWNLOAD_POLICY: Record<OAuthConnectorProvider, EgressPolicy> = {
  google_drive: { origins: [DRIVE_ORIGIN], pathPrefix: "/drive/v3/", maxUrlLength: 4_096 },
  dropbox: { origins: [DROPBOX_CONTENT_ORIGIN], pathPrefix: "/2/files/", maxUrlLength: 4_096 },
  microsoft_graph: { origins: [GRAPH_ORIGIN], pathPrefix: "/v1.0/", maxUrlLength: 4_096 },
};

/**
 * A row worth trying to read.
 *
 * `Array.isArray(payload.files)` says the payload has an array; it says nothing about what is
 * in it. A single `null` entry -- which any of these APIs may emit, and which a proxy or a
 * partial response certainly can -- reached `row.id` and threw a TypeError out of the adapter.
 * The sync worker classifies failures by code and has no branch for that, so one malformed
 * entry took down a whole listing instead of being skipped like every other unreadable row.
 */
function readableRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function boundedSize(value: unknown) {
  const size = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(size) && size >= 0 && size <= 524_288_000 ? size : null;
}

/*
  A continuation, checked per provider rather than for Graph alone (S-72).

  The three providers continue in two different shapes and the check has to match the shape,
  not merely exist:

    * Microsoft Graph hands back a whole URL and the adapter fetches it. That is a destination
      supplied by a response, so it goes through the central egress policy -- origin, path
      prefix, scheme, port, address -- exactly as the first page did.

    * Google Drive and Dropbox hand back an opaque token which this adapter puts in a query
      parameter and a JSON body respectively. A token cannot become a destination there, and
      that is the property worth asserting rather than assuming, so the tests below drive a
      hostile continuation through both and check where the request actually went.

  What is refused for the opaque two is what a token has no reason to contain and a smuggled
  URL does: a scheme, whitespace, or a control character. Refusing base64's own alphabet would
  break a legitimate cursor to buy no security, so it is not refused.
*/
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function safeGraphContinuation(value: unknown) {
  if (typeof value !== "string") return null;
  return assertSafeUrl(value, LIST_POLICY.microsoft_graph).ok ? value : null;
}

function safeOpaqueContinuation(value: unknown, maximum: number) {
  const token = boundedString(value, maximum);
  if (token === null || HAS_SCHEME.test(token)) return null;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return token;
}

function validTarget(target: OAuthSourceTarget) {
  const values = [target.rootPath, target.driveId, target.siteId].filter((value): value is string => value !== undefined);
  return values.every((value) => value.length <= 512 && /^[A-Za-z0-9._~!$&'()+,;=:@/ -]*$/.test(value));
}

async function jsonRequest(
  url: string,
  accessToken: string,
  init: RequestInit,
  fetcher: typeof fetch,
  policy: EgressPolicy,
) {
  const result = await safeFetch(
    url,
    { ...init, headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", ...init.headers } },
    { ...policy, timeoutMs: 20_000 },
    fetcher,
  );
  // A refused destination is not a provider outage and must not read like one: the code names
  // the egress decision, so a listing that stopped because the URL was refused is
  // distinguishable in a log from one that stopped because the provider was down.
  if (!result.ok) throw new Error(`OAUTH_SOURCE_EGRESS_REFUSED:${result.code}`);
  if (result.status < 200 || result.status > 299) throw new Error("OAUTH_SOURCE_LIST_FAILED");
  try {
    return JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

async function listGoogleDrive(accessToken: string, cursor: string | null, fetcher: typeof fetch): Promise<OAuthSourcePage> {
  const url = new URL(`${DRIVE_ORIGIN}/drive/v3/files`);
  url.searchParams.set("pageSize", String(OAUTH_SOURCE_PAGE_SIZE));
  url.searchParams.set("q", "trashed = false");
  url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,version,md5Checksum)");
  if (cursor !== null) {
    const pageToken = safeOpaqueContinuation(cursor, 2_048);
    if (pageToken === null) throw new Error("OAUTH_SOURCE_CURSOR_INVALID");
    url.searchParams.set("pageToken", pageToken);
  }
  const payload = await jsonRequest(url.toString(), accessToken, {}, fetcher, LIST_POLICY.google_drive);
  const rows = Array.isArray(payload.files) ? payload.files as Array<Record<string, unknown>> : [];
  const items = rows.map((row): OAuthSourceItem | null => {
    if (!readableRow(row)) return null;
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
  const continuation = cursor !== null ? safeOpaqueContinuation(cursor, 4_096) : null;
  if (cursor !== null && continuation === null) throw new Error("OAUTH_SOURCE_CURSOR_INVALID");
  const url = continuation
    ? `${DROPBOX_API_ORIGIN}/2/files/list_folder/continue`
    : `${DROPBOX_API_ORIGIN}/2/files/list_folder`;
  const body = continuation
    ? { cursor: continuation }
    : { path: target.rootPath ?? "", recursive: true, include_deleted: true, limit: OAUTH_SOURCE_PAGE_SIZE };
  const payload = await jsonRequest(
    url,
    accessToken,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    fetcher,
    LIST_POLICY.dropbox,
  );
  const rows = Array.isArray(payload.entries) ? payload.entries as Array<Record<string, unknown>> : [];
  const items = rows.map((row): OAuthSourceItem | null => {
    if (!readableRow(row)) return null;
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
  const payload = await jsonRequest(url, accessToken, {}, fetcher, LIST_POLICY.microsoft_graph);
  const rows = Array.isArray(payload.value) ? payload.value as Array<Record<string, unknown>> : [];
  const items = rows.map((row): OAuthSourceItem | null => {
    if (!readableRow(row)) return null;
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

export function microsoftGraphItemUrl(nativeId: string, target: OAuthSourceTarget = {}) {
  const drive = target.driveId ? `drives/${encodeURIComponent(target.driveId)}`
    : target.siteId ? `sites/${encodeURIComponent(target.siteId)}/drive` : "me/drive";
  return `${GRAPH_ORIGIN}/v1.0/${drive}/items/${encodeURIComponent(nativeId)}`;
}

export function oauthSourceDownloadRequest(input: {
  provider: OAuthConnectorProvider;
  nativeId: string;
  revision?: string;
  mimeType?: string | null;
  target?: OAuthSourceTarget;
}) {
  if (!input.nativeId || input.nativeId.length > 512) throw new Error("OAUTH_SOURCE_INPUT_INVALID");
  /*
    The destination is built from constants and an encoded id, and it is still checked.

    `encodeURIComponent` is what makes that true today; a future edit that interpolates one more
    provider-supplied field is what makes checking it worth the line. The check is on the URL
    this function returns rather than on its parts, so it cannot be satisfied by a part that is
    safe on its own.

    Redirects on the download path stay with `fetch`, deliberately: Graph answers /content with
    a 302 to a per-request host that is not graph.microsoft.com, so pinning the hop would break
    OneDrive downloads rather than secure them. The initial destination is pinned; the redirect
    target is chosen by the provider we already authenticated to.
  */
  const checked = (url: string) => {
    if (!assertSafeUrl(url, DOWNLOAD_POLICY[input.provider]).ok) throw new Error("OAUTH_SOURCE_EGRESS_REFUSED");
    return url;
  };
  if (input.provider === "google_drive") {
    const exportMime = input.mimeType ? GOOGLE_EXPORTS[input.mimeType] : undefined;
    const path = exportMime ? "export" : "";
    const url = new URL(`${DRIVE_ORIGIN}/drive/v3/files/${encodeURIComponent(input.nativeId)}${path ? `/${path}` : ""}`);
    if (exportMime) url.searchParams.set("mimeType", exportMime);
    else { url.searchParams.set("alt", "media"); url.searchParams.set("supportsAllDrives", "true"); }
    if (input.mimeType?.startsWith("application/vnd.google-apps.") && !exportMime) throw new Error("OAUTH_SOURCE_NATIVE_TYPE_UNSUPPORTED");
    return { url: checked(url.toString()), method: "GET" as const, headers: {} };
  }
  if (input.provider === "dropbox") {
    if (!input.revision || !/^[A-Za-z0-9_-]{1,512}$/.test(input.revision)) throw new Error("SOURCE_REVISION_UNQUALIFIED");
    return {
      url: checked(`${DROPBOX_CONTENT_ORIGIN}/2/files/download`),
      method: "POST" as const,
      headers: { "Dropbox-API-Arg": JSON.stringify({ path: `rev:${input.revision}` }) },
    };
  }
  return {
    url: checked(`${microsoftGraphItemUrl(input.nativeId, input.target)}/content`),
    method: "GET" as const,
    headers: {},
  };
}
