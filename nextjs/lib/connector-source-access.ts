import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { connectorSourceIdentity } from "./connector-source-identity";
import { googleDriveViewerLinkEnabled } from "./connector-oauth";
import type { OAuthConnectorProvider } from "./connector-oauth";

export async function suspendConnectorSource(input: {
  workspaceKey: string; connectionId: string; provider: OAuthConnectorProvider; nativeId: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" };
  try {
    const { sourceId } = await connectorSourceIdentity({ ...input, revision: "suspension-identity-only" });
    const row = { source_id: sourceId, workspace_key: input.workspaceKey, reason: "removed_or_inaccessible" };
    const response = await supabaseAdminRequest(config, "/rest/v1/connector_source_suspensions", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify([row]),
    });
    if (!response.ok) return { ok: false, code: "CONNECTOR_SOURCE_SUSPENSION_UNRESOLVED" };
    const verify = await supabaseAdminRequest(config, `/rest/v1/connector_source_suspensions?source_id=eq.${sourceId}&workspace_key=eq.${input.workspaceKey}&limit=1`);
    const rows: unknown = verify.ok ? await verify.json() : null;
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.source_id !== sourceId || rows[0]?.workspace_key !== input.workspaceKey) {
      return { ok: false, code: "CONNECTOR_SOURCE_SUSPENSION_UNRESOLVED" };
    }
    return { ok: true };
  } catch { return { ok: false, code: "CONNECTOR_SOURCE_SUSPENSION_UNRESOLVED" }; }
}

/**
 * Records a provider deletion through the database's legal-hold gate.
 *
 * The source suspension is deliberately separate and should be written first: an active legal
 * hold preserves bytes but must not leave the source queryable. This call never treats an
 * unreadable policy as inactive. The database returns the same receipt on an identical retry.
 */
export async function requestConnectorSourceDeletion(input: {
  workspaceKey: string; connectionId: string; provider: OAuthConnectorProvider; nativeId: string;
  reason: "provider_deleted" | "provider_inaccessible";
}): Promise<{ ok: true; receiptId: string; replayed: boolean; held: boolean } | { ok: false; code: string }> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "SOURCE_DELETION_STORE_UNAVAILABLE" };
  try {
    const { sourceId } = await connectorSourceIdentity({ ...input, revision: "deletion-identity-only" });
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/request_connector_source_deletion", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: input.workspaceKey,
        p_source_id: sourceId,
        p_oauth_connection_id: input.connectionId,
        p_provider: input.provider,
        p_reason: input.reason,
      }),
    });
    if (!response.ok) {
      let code = "SOURCE_DELETION_WRITE_FAILED";
      try {
        const body = await response.json() as { message?: unknown };
        if (typeof body.message === "string" && /^(SOURCE_LEGAL_HOLD_ACTIVE|SOURCE_LEGAL_HOLD_STATE_UNKNOWN)$/.test(body.message)) code = body.message;
      } catch { /* stable fallback */ }
      return { ok: false, code };
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return { ok: false, code: "SOURCE_DELETION_RECEIPT_INVALID" };
    const receiptId = (value as Record<string, unknown>).receiptId;
    const status = (value as Record<string, unknown>).status;
    if (typeof receiptId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(receiptId) ||
        (status !== "recorded" && status !== "replayed" && status !== "held")) {
      return { ok: false, code: "SOURCE_DELETION_RECEIPT_INVALID" };
    }
    return { ok: true, receiptId, replayed: status === "replayed", held: status === "held" };
  } catch { return { ok: false, code: "SOURCE_DELETION_WRITE_FAILED" }; }
}

export async function checkConnectorSourceAccess(workspaceKey: string, documentIds: string[]): Promise<
  { ok: true } | { ok: false; code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" | "CONNECTOR_SOURCE_ACCESS_DENIED" }
> {
  const config = readSupabaseAdminConfig();
  if (!config || !WORKSPACE_ID_PATTERN.test(workspaceKey) || documentIds.length > 2000 ||
      documentIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) {
    return { ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" };
  }
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/connector_documents_blocked", {
      method: "POST", body: JSON.stringify({ p_workspace_key: workspaceKey, p_document_ids: [...new Set(documentIds)] }),
    });
    if (!response.ok) return { ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" };
    const blocked: unknown = await response.json();
    if (blocked === false) return { ok: true };
    return { ok: false, code: blocked === true ? "CONNECTOR_SOURCE_ACCESS_DENIED" : "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" };
  } catch { return { ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" }; }
}

/**
 * ACL captures expire quickly because Google does not notify this path of per-file permission
 * removals. The default is five minutes; deployments may lower or raise it up to fifteen minutes.
 * Invalid configuration fails closed for connector sources via the legacy checker.
 */
export function googleDriveAclMaxAgeSeconds(env: Readonly<Record<string, string | undefined>> = process.env): number | null {
  const raw = env.TAVONEL_GOOGLE_DRIVE_ACL_MAX_AGE_SECONDS;
  if (raw === undefined || raw === "") return 300;
  if (!/^[0-9]{1,4}$/.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isInteger(seconds) && seconds >= 60 && seconds <= 900 ? seconds : null;
}

/** The viewer id must come from an authenticated route principal, never request JSON or JWT metadata. */
export async function checkConnectorSourceAccessForViewer(
  workspaceKey: string,
  documentIds: string[],
  viewerUserId: string,
): Promise<{ ok: true } | { ok: false; code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" | "CONNECTOR_SOURCE_ACCESS_DENIED" }> {
  if (!WORKSPACE_ID_PATTERN.test(workspaceKey) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(viewerUserId) ||
      documentIds.length > 2000 || documentIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) {
    return { ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" };
  }

  // Until both OAuth routes and this server-owned lookup are explicitly enabled, preserve the
  // existing live policy. That policy admits direct uploads and default-denies connector sources.
  if (!googleDriveViewerLinkEnabled()) return checkConnectorSourceAccess(workspaceKey, documentIds);
  const maxAgeSeconds = googleDriveAclMaxAgeSeconds();
  if (maxAgeSeconds === null) return checkConnectorSourceAccess(workspaceKey, documentIds);

  const config = readSupabaseAdminConfig();
  if (!config) return checkConnectorSourceAccess(workspaceKey, documentIds);
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/connector_documents_blocked_for_viewer", {
      method: "POST",
      body: JSON.stringify({ p_workspace_key: workspaceKey, p_document_ids: [...new Set(documentIds)],
        p_viewer_user_id: viewerUserId, p_max_age_seconds: maxAgeSeconds }),
    });
    if (response.ok) {
      const blocked: unknown = await response.json();
      if (blocked === false) return { ok: true };
      if (blocked === true) return { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" };
    }
    // The SQL remains unregistered during rollout. The old live checker is the compatibility
    // boundary: direct-upload IDs remain readable, connector-bound IDs stay denied by default.
    return checkConnectorSourceAccess(workspaceKey, documentIds);
  } catch {
    return checkConnectorSourceAccess(workspaceKey, documentIds);
  }
}

export async function recordGoogleDriveSourceAclSnapshot(input: {
  workspaceKey: string;
  connectionId: string;
  sourceVersionId: string;
  principals: Array<{ kind: "user"; principalId: string; permission: "read" | "write" | "owner" }>;
  snapshotSha256: string;
}): Promise<{ ok: true } | { ok: false; code: "CONNECTOR_SOURCE_ACL_STORE_UNAVAILABLE" }> {
  const config = readSupabaseAdminConfig();
  if (!config || !WORKSPACE_ID_PATTERN.test(input.workspaceKey) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.connectionId) ||
      !/^sv-[a-f0-9]{64}$/.test(input.sourceVersionId) || !/^sha256:[a-f0-9]{64}$/.test(input.snapshotSha256) ||
      input.principals.length > 2000 || input.principals.some(p => p.kind !== "user" ||
        typeof p.principalId !== "string" || p.principalId.length < 1 || p.principalId.length > 512 ||
        !["read", "write", "owner"].includes(p.permission))) {
    return { ok: false, code: "CONNECTOR_SOURCE_ACL_STORE_UNAVAILABLE" };
  }
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/record_google_drive_source_acl_snapshot", {
      method: "POST",
      body: JSON.stringify({ p_workspace_key: input.workspaceKey, p_connection_id: input.connectionId,
        p_source_version_id: input.sourceVersionId, p_principals: input.principals,
        p_snapshot_sha256: input.snapshotSha256 }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true } : { ok: false, code: "CONNECTOR_SOURCE_ACL_STORE_UNAVAILABLE" };
  } catch { return { ok: false, code: "CONNECTOR_SOURCE_ACL_STORE_UNAVAILABLE" }; }
}

export async function recordGoogleDriveSourceAclCaptureFailure(input: {
  workspaceKey: string;
  connectionId: string;
  sourceVersionId: string;
  markerSha256: string;
}): Promise<{ ok: true } | { ok: false; code: "CONNECTOR_SOURCE_ACL_STORE_UNAVAILABLE" }> {
  const config = readSupabaseAdminConfig();
  if (!config || !WORKSPACE_ID_PATTERN.test(input.workspaceKey) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.connectionId) ||
      !/^sv-[a-f0-9]{64}$/.test(input.sourceVersionId) || !/^sha256:[a-f0-9]{64}$/.test(input.markerSha256)) {
    return { ok: false, code: "CONNECTOR_SOURCE_ACL_STORE_UNAVAILABLE" };
  }
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/record_google_drive_source_acl_capture_failure", {
      method: "POST", body: JSON.stringify({ p_workspace_key: input.workspaceKey,
        p_connection_id: input.connectionId, p_source_version_id: input.sourceVersionId,
        p_marker_sha256: input.markerSha256 }), signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true } : { ok: false, code: "CONNECTOR_SOURCE_ACL_STORE_UNAVAILABLE" };
  } catch { return { ok: false, code: "CONNECTOR_SOURCE_ACL_STORE_UNAVAILABLE" }; }
}
