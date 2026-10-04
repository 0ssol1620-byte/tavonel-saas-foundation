import { createHash } from "node:crypto";
import { safeFetch } from "./safe-url";

const ORIGIN = "https://www.googleapis.com";
const MAX_PAGES = 20;
const MAX_PRINCIPALS = 2_000;

export type GoogleDriveAclPrincipal = {
  kind: "user";
  principalId: string;
  permission: "read" | "write" | "owner";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function drivePermission(value: unknown): GoogleDriveAclPrincipal | null {
  if (!isRecord(value) || (value.deleted !== undefined && typeof value.deleted !== "boolean") ||
      typeof value.type !== "string" || !["user", "group", "domain", "anyone"].includes(value.type) ||
      typeof value.role !== "string") {
    throw new Error("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
  }
  if (value.deleted === true) return null;
  // Group, domain, anyone, and unknown grants are not expanded to individual viewers.
  if (value.type !== "user") return null;
  const principalId = value.id;
  if (typeof principalId !== "string" || principalId.length < 1 || principalId.length > 512 || /[\u0000-\u001f\u007f]/.test(principalId)) {
    throw new Error("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
  }
  const permission = value.role === "owner" ? "owner"
    : ["writer", "fileOrganizer", "organizer", "contentManager"].includes(value.role) ? "write"
      : ["reader", "commenter"].includes(value.role) ? "read" : null;
  if (!permission) throw new Error("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
  return { kind: "user", principalId, permission };
}

/**
 * Capture a complete, bounded Drive permissions.list result. IDs are preserved verbatim from
 * Permission.id. A failed page, malformed result, or unrecognized user role produces no snapshot.
 */
export async function captureGoogleDriveUserAcl(input: {
  fileId: string;
  accessToken: string;
  fetcher?: typeof fetch;
}): Promise<{ principals: GoogleDriveAclPrincipal[]; snapshotSha256: string; capturedAt: string }> {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(input.fileId) || typeof input.accessToken !== "string" ||
      input.accessToken.length < 1 || input.accessToken.length > 8_192) {
    throw new Error("GOOGLE_DRIVE_ACL_INPUT_INVALID");
  }
  const fetcher = input.fetcher ?? fetch;
  const principals = new Map<string, GoogleDriveAclPrincipal>();
  let pageToken: string | null = null;
  let pages = 0;
  do {
    if (++pages > MAX_PAGES) throw new Error("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
    const url = new URL(`/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions`, ORIGIN);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("fields", "nextPageToken,permissions(id,type,role,deleted)");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await safeFetch(url.toString(), {
      headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/json" },
      redirect: "error",
    }, { origins: [ORIGIN], pathPrefix: "/drive/v3/", maxUrlLength: 4_096, timeoutMs: 10_000 }, fetcher);
    if (!result.ok || result.status < 200 || result.status > 299) {
      throw new Error("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
    }
    let body: unknown;
    try { body = JSON.parse(result.text); } catch { throw new Error("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE"); }
    if (!isRecord(body) || !Array.isArray(body.permissions) || body.permissions.length > 100 ||
        (body.nextPageToken !== undefined && (typeof body.nextPageToken !== "string" ||
          body.nextPageToken.length < 1 || body.nextPageToken.length > 4_096 || body.nextPageToken === pageToken))) {
      throw new Error("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
    }
    for (const row of body.permissions) {
      const principal = drivePermission(row);
      if (principal) {
        const previous = principals.get(principal.principalId);
        if (previous && previous.permission !== principal.permission) {
          throw new Error("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
        }
        principals.set(principal.principalId, principal);
      }
    }
    if (principals.size > MAX_PRINCIPALS) throw new Error("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
    pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : null;
  } while (pageToken !== null);

  const stable = [...principals.values()].sort((a, b) => a.principalId.localeCompare(b.principalId));
  const canonical = JSON.stringify(stable);
  const snapshotSha256 = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
  return { principals: stable, snapshotSha256, capturedAt: new Date().toISOString() };
}
