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
