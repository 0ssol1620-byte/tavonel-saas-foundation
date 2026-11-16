import { createHash, randomUUID } from "node:crypto";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { googleDriveViewerLinkEnabled, readOAuthProviderRuntime, refreshOAuthAccessToken } from "./connector-oauth";
import { getOAuthConnectionSecretReference } from "./connector-oauth-store";
import { readOAuthSecret, readOAuthSecretBrokerConfig } from "./connector-oauth-secrets";
import { captureGoogleDriveUserAcl, GoogleDriveAclCaptureError } from "./google-drive-acl-capture";
import {
  checkConnectorSourceAccessForViewer, recordGoogleDriveSourceAclCaptureFailure, recordGoogleDriveSourceAclSnapshot,
} from "./connector-source-access";

// ponytail: per-request cap 32; batch via the refresh queue if exports grow
const MAX_CONNECTOR_DOCUMENTS = 32;
const FRESH_CHECK_DEADLINE_MS = 25_000;

export type AclFreshness =
  | { mode: "not_applicable" }
  | { mode: "provider_checked_at_delivery"; checkedAt: string };

export type CriticalReadResult =
  | { ok: true; freshness: AclFreshness }
  | { ok: false; code: "CONNECTOR_SOURCE_ACCESS_DENIED" | "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE"
      | "CONNECTOR_ACL_FRESH_CHECK_UNAVAILABLE" | "CONNECTOR_ACL_FRESH_CHECK_LIMIT" };

const UNAVAILABLE = { ok: false, code: "CONNECTOR_ACL_FRESH_CHECK_UNAVAILABLE" } as const;

/** The response header value; carries the mode and time only, never thresholds or principals. */
export function aclFreshnessHeader(f: AclFreshness): string {
  return f.mode === "provider_checked_at_delivery" ? `${f.mode};checked-at=${f.checkedAt}` : f.mode;
}

type Binding = { sourceVersionId: string; connectionId: string; nativeId: string };

async function readBindings(workspaceKey: string, documentIds: readonly string[], signal: AbortSignal): Promise<Binding[] | null> {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  const ids = [...new Set(documentIds)].sort();
  const query = new URLSearchParams({
    workspace_key: `eq.${workspaceKey}`, document_id: `in.(${ids.join(",")})`,
    select: "source_version_id,oauth_connection_id,native_id,provider", limit: String(MAX_CONNECTOR_DOCUMENTS + 1),
  });
  const response = await supabaseAdminRequest(config, `/rest/v1/connector_document_bindings?${query}`, { signal });
  if (!response.ok) return null;
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) return null;
  const out: Binding[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown> | null;
    // Only Google Drive has a fresh-capture path; any other bound provider cannot be checked, so it fails closed.
    if (!r || r.provider !== "google_drive" || typeof r.source_version_id !== "string" ||
        typeof r.oauth_connection_id !== "string" || typeof r.native_id !== "string") return null;
    out.push({ sourceVersionId: r.source_version_id, connectionId: r.oauth_connection_id, nativeId: r.native_id });
  }
  return out;
}

/**
 * Critical reads (export delivery) never trust the cached ACL snapshot: with the viewer link
 * enabled, capture the provider ACL now, store it, then run the normal viewer check against it.
 * Any failure to obtain a fresh capture refuses; there is no fallback to the cached snapshot.
 */
export async function authorizeConnectorCriticalRead(input: {
  workspaceKey: string; documentIds: readonly string[]; viewerUserId: string; signal?: AbortSignal;
}): Promise<CriticalReadResult> {
  const { workspaceKey, documentIds, viewerUserId } = input;
  if (!googleDriveViewerLinkEnabled()) {
    const legacy = await checkConnectorSourceAccessForViewer(workspaceKey, [...documentIds], viewerUserId);
    return legacy.ok ? { ok: true, freshness: { mode: "not_applicable" } } : legacy;
  }
  if (!WORKSPACE_ID_PATTERN.test(workspaceKey)) return UNAVAILABLE;
  const deadline = AbortSignal.timeout(FRESH_CHECK_DEADLINE_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  try {
    const bindings = await readBindings(workspaceKey, documentIds, signal);
    if (!bindings) return UNAVAILABLE;
    if (bindings.length > MAX_CONNECTOR_DOCUMENTS) return { ok: false, code: "CONNECTOR_ACL_FRESH_CHECK_LIMIT" };
    if (bindings.length === 0) {
      const direct = await checkConnectorSourceAccessForViewer(workspaceKey, [...documentIds], viewerUserId);
      return direct.ok ? { ok: true, freshness: { mode: "not_applicable" } } : direct;
    }
    const broker = readOAuthSecretBrokerConfig();
    const runtime = readOAuthProviderRuntime("google_drive");
    if (!broker || !runtime) return UNAVAILABLE;
    const tokens = new Map<string, string>();
    for (const b of bindings) {
      let token = tokens.get(b.connectionId);
      if (!token) {
        const ref = await getOAuthConnectionSecretReference(workspaceKey, b.connectionId);
        if (!ref.ok || ref.provider !== "google_drive") return UNAVAILABLE;
        const [refreshToken, clientSecret] = await Promise.all([
          readOAuthSecret(broker, ref.refreshTokenReference), readOAuthSecret(broker, runtime.clientSecretReference),
        ]);
        token = (await refreshOAuthAccessToken({ runtime, refreshToken, clientSecret })).accessToken;
        tokens.set(b.connectionId, token);
      }
      try {
        const captured = await captureGoogleDriveUserAcl({ fileId: b.nativeId, accessToken: token, signal });
        const stored = await recordGoogleDriveSourceAclSnapshot({ workspaceKey, connectionId: b.connectionId,
          sourceVersionId: b.sourceVersionId, principals: captured.principals, snapshotSha256: captured.snapshotSha256 });
        if (!stored.ok) return UNAVAILABLE;
      } catch (error) {
        if (error instanceof GoogleDriveAclCaptureError) {
          const markerSha256 = `sha256:${createHash("sha256").update(JSON.stringify([
            "google-drive-acl-capture-incomplete-v1", workspaceKey, b.connectionId, b.sourceVersionId, randomUUID(),
          ])).digest("hex")}`;
          await recordGoogleDriveSourceAclCaptureFailure({ workspaceKey, connectionId: b.connectionId,
            sourceVersionId: b.sourceVersionId, markerSha256 });
        }
        return UNAVAILABLE;
      }
    }
    const checkedAt = new Date().toISOString();
    const viewer = await checkConnectorSourceAccessForViewer(workspaceKey, [...documentIds], viewerUserId);
    return viewer.ok ? { ok: true, freshness: { mode: "provider_checked_at_delivery", checkedAt } } : viewer;
  } catch {
    return UNAVAILABLE;
  }
}
