import type { OAuthSourceItem, OAuthSourcePage } from "./connector-oauth-adapters";
import { createHash } from "node:crypto";
import { safeFetch } from "./safe-url";

// Selected only by versioned source jobs. Legacy listing cursors cannot enter this reader.
// Real provider qualification and full ACL lifecycle remain separate release gates.
const ORIGIN = "https://www.googleapis.com";
const PREFIX = "tv-drive-v2:";
const MAX_CURSOR = 3800; // Leave room for the worker's bounded in-page checkpoint wrapper.
type Cursor = { phase: "snapshot" | "changes"; drive: string | null; start: string; page: string | null };
export type GoogleDriveLifecycleItem = OAuthSourceItem & {
  removalReason?: "trashed" | "removed_or_inaccessible";
  changedAt?: string | null;
};
export type GoogleDriveLifecyclePage = Omit<OAuthSourcePage, "items"> & { items: GoogleDriveLifecycleItem[] };

function token(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\s\u0000-\u001f\u007f]/.test(value) && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function encode(value: Cursor) {
  const result = PREFIX + Buffer.from(JSON.stringify(value)).toString("base64url");
  if (result.length > MAX_CURSOR) throw new Error("DRIVE_CURSOR_TOO_LARGE");
  return result;
}
function decode(value: string, drive: string | null): Cursor {
  if (!value.startsWith(PREFIX) || value.length > MAX_CURSOR) throw new Error("DRIVE_CURSOR_INVALID");
  let parsed: unknown;
  try {
    const encoded = value.slice(PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch { throw new Error("DRIVE_CURSOR_INVALID"); }
  if (!record(parsed) || (parsed.phase !== "snapshot" && parsed.phase !== "changes") || parsed.drive !== drive ||
      !token(parsed.start) || (parsed.page !== null && !token(parsed.page)) || Object.keys(parsed).length !== 4) {
    throw new Error("DRIVE_CURSOR_INVALID");
  }
  return parsed as Cursor;
}
function file(row: unknown): OAuthSourceItem {
  if (!record(row) || typeof row.id !== "string" || !row.id || row.id.length > 512 ||
      typeof row.name !== "string" || !row.name || row.name.length > 512 ||
      typeof row.mimeType !== "string" || row.mimeType.length > 127 || !row.mimeType) throw new Error("DRIVE_FILE_INVALID");
  // Drive version tracks metadata changes as well as content changes (including rename).
  if (!token(row.version) || row.version.length > 512) throw new Error("DRIVE_FILE_VERSION_MISSING");
  if (row.trashed !== undefined && typeof row.trashed !== "boolean") throw new Error("DRIVE_FILE_INVALID");
  if (row.modifiedTime !== undefined && (typeof row.modifiedTime !== "string" || row.modifiedTime.length > 64 || !Number.isFinite(Date.parse(row.modifiedTime)))) throw new Error("DRIVE_FILE_INVALID");
  const folder = row.mimeType === "application/vnd.google-apps.folder";
  if (row.size !== undefined && row.size !== null && typeof row.size !== "number" &&
      !(typeof row.size === "string" && /^[0-9]{1,16}$/.test(row.size))) throw new Error("DRIVE_FILE_SIZE_INVALID");
  const size = row.size === undefined || row.size === null ? null : Number(row.size);
  if (size !== null && (!Number.isSafeInteger(size) || size < 0)) throw new Error("DRIVE_FILE_SIZE_INVALID");
  return { nativeId: row.id, name: row.name, revision: row.version, mimeType: row.mimeType,
    sizeBytes: folder ? null : size, modifiedAt: typeof row.modifiedTime === "string" ? row.modifiedTime : null,
    kind: folder ? "folder" : "file" };
}

export async function listGoogleDriveLifecyclePage(input: {
  accessToken: string; cursor: string | null; driveId?: string; fetcher?: typeof fetch;
}): Promise<GoogleDriveLifecyclePage> {
  const drive = input.driveId ?? null;
  if (!input.accessToken || (drive !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(drive))) throw new Error("DRIVE_INPUT_INVALID");
  async function request(endpoint: string, params: Record<string, string>) {
    const url = new URL(`/drive/v3/${endpoint}`, ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (drive) url.searchParams.set("driveId", drive);
    const result = await safeFetch(url.toString(), { headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/json" } },
      { origins: [ORIGIN], pathPrefix: "/drive/v3/", maxUrlLength: 4096, timeoutMs: 20_000 }, input.fetcher ?? fetch);
    if (!result.ok) throw new Error(`DRIVE_EGRESS_REFUSED:${result.code}`);
    if (result.status < 200 || result.status > 299) throw new Error("DRIVE_REQUEST_FAILED");
    let value: unknown;
    try { value = JSON.parse(result.text); } catch { throw new Error("DRIVE_RESPONSE_INVALID"); }
    if (!record(value)) throw new Error("DRIVE_RESPONSE_INVALID");
    return value;
  }
  let state: Cursor;
  if (input.cursor === null) {
    // Take the change watermark BEFORE enumerating. Changes during the snapshot are replayed.
    const start = await request("changes/startPageToken", { supportsAllDrives: "true" });
    if (!token(start.startPageToken)) throw new Error("DRIVE_START_TOKEN_MISSING");
    state = { phase: "snapshot", drive, start: start.startPageToken, page: null };
    // A separate zero-item checkpoint makes this watermark durable before any import.
    // Retrying a partially imported first page must not take a later watermark.
    return { items: [], cursor: encode(state), complete: false };
  } else state = decode(input.cursor, drive);

  const fields = "id,name,mimeType,size,modifiedTime,version,trashed";
  if (state.phase === "snapshot") {
    const payload = await request("files", { pageSize: "25", q: "trashed = false", supportsAllDrives: "true",
      includeItemsFromAllDrives: "true", ...(drive ? { corpora: "drive" } : {}),
      fields: `nextPageToken,incompleteSearch,files(${fields})`, ...(state.page ? { pageToken: state.page } : {}) });
    if (!Array.isArray(payload.files) || payload.files.length > 25 ||
        (payload.incompleteSearch !== undefined && payload.incompleteSearch !== false)) throw new Error("DRIVE_SNAPSHOT_INCOMPLETE");
    if (payload.nextPageToken != null && !token(payload.nextPageToken)) throw new Error("DRIVE_CURSOR_INVALID");
    const next = payload.nextPageToken as string | undefined;
    if (next && next === state.page) throw new Error("DRIVE_CURSOR_STALLED");
    if (payload.files.some(row => record(row) && row.trashed === true)) throw new Error("DRIVE_SNAPSHOT_CONFLICT");
    return { items: payload.files.map(file), complete: false,
      cursor: encode(next ? { ...state, page: next } : { ...state, phase: "changes", page: null }) };
  }

  const pageToken = state.page ?? state.start;
  const payload = await request("changes", { pageSize: "25", pageToken, includeRemoved: "true",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
    fields: `nextPageToken,newStartPageToken,changes(fileId,removed,changeType,time,file(${fields}))` });
  if (!Array.isArray(payload.changes) || payload.changes.length > 25) throw new Error("DRIVE_CHANGES_INVALID");
  const next = payload.nextPageToken ?? undefined, checkpoint = payload.newStartPageToken;
  if (next !== undefined ? !token(next) || checkpoint !== undefined || next === pageToken : !token(checkpoint)) throw new Error("DRIVE_CURSOR_INVALID");
  const items = payload.changes.map((change): GoogleDriveLifecycleItem => {
    if (!record(change) || typeof change.fileId !== "string" || !change.fileId || change.fileId.length > 512 ||
        (change.removed !== undefined && typeof change.removed !== "boolean") ||
        (change.changeType !== undefined && change.changeType !== "file")) throw new Error("DRIVE_CHANGE_REQUIRES_REVIEW");
    if (change.time !== undefined && (typeof change.time !== "string" || change.time.length > 64 || !Number.isFinite(Date.parse(change.time)))) throw new Error("DRIVE_CHANGE_TIME_INVALID");
    const changedAt = typeof change.time === "string" ? change.time : null;
    if (change.removed === true || (record(change.file) && change.file.trashed === true)) {
      return { nativeId: change.fileId, name: change.fileId, revision: `removed:${createHash("sha256").update(JSON.stringify([pageToken, change.fileId, changedAt])).digest("hex")}`,
        mimeType: null, sizeBytes: null, modifiedAt: null, kind: "deleted",
        changedAt, removalReason: record(change.file) && change.file.trashed === true ? "trashed" : "removed_or_inaccessible" };
    }
    const item = file(change.file);
    if (item.nativeId !== change.fileId) throw new Error("DRIVE_CHANGE_ID_MISMATCH");
    return { ...item, changedAt };
  });
  return { items, complete: next === undefined,
    cursor: encode(next ? { ...state, page: next as string } : { ...state, start: checkpoint as string, page: null }) };
}
