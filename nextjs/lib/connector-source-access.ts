import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { connectorSourceIdentity } from "./connector-source-identity";
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
