import { connectorSourceIdentity } from "./connector-source-identity";
import type { OAuthConnectorProvider } from "./connector-oauth";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/** Resolve immutable upload UUIDs to durable logical sources; never replace quarantine IDs. */
export async function readConnectorCompileIdentities(workspaceKey: string, documentIds: readonly string[]): Promise<
  { ok: true; identities: Map<string, string> } | { ok: false; code: string }
> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "CONNECTOR_IDENTITY_UNAVAILABLE" };
  const identities = new Map<string, string>();
  try {
    for (const documentId of documentIds) {
      const response = await supabaseAdminRequest(config,
        `/rest/v1/connector_document_bindings?workspace_key=eq.${encodeURIComponent(workspaceKey)}&document_id=eq.${encodeURIComponent(documentId)}&limit=2`);
      if (!response.ok) return { ok: false, code: "CONNECTOR_IDENTITY_UNAVAILABLE" };
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") {
        return { ok: false, code: "CONNECTOR_IDENTITY_UNRESOLVED" };
      }
      const row = rows[0] as Record<string, unknown>;
      const expected = await connectorSourceIdentity({ workspaceKey,
        connectionId: row.oauth_connection_id as string, provider: row.provider as OAuthConnectorProvider,
        nativeId: row.native_id as string, revision: row.provider_revision as string });
      if (row.workspace_key !== workspaceKey || row.document_id !== documentId || expected.documentId !== documentId ||
          row.source_id !== expected.sourceId || row.source_version_id !== expected.sourceVersionId) {
        return { ok: false, code: "CONNECTOR_IDENTITY_CONFLICT" };
      }
      if ([...identities.values()].includes(expected.sourceId)) {
        return { ok: false, code: "CONNECTOR_SOURCE_REVISION_AMBIGUOUS" };
      }
      identities.set(documentId, expected.sourceId);
    }
    return { ok: true, identities };
  } catch { return { ok: false, code: "CONNECTOR_IDENTITY_UNAVAILABLE" }; }
}
