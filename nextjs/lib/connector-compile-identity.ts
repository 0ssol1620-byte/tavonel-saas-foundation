import { connectorSourceIdentity } from "./connector-source-identity";
import type { OAuthConnectorProvider } from "./connector-oauth";
import { databaseInstantMicros } from "./database-instant";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

type SupabaseAdminConfig = NonNullable<ReturnType<typeof readSupabaseAdminConfig>>;

/** Resolve immutable upload UUIDs to durable logical sources; never replace quarantine IDs. */
export async function readConnectorCompileIdentities(workspaceKey: string, documentIds: readonly string[]): Promise<
  { ok: true; identities: Map<string, string> } | { ok: false; code: string }
> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "CONNECTOR_IDENTITY_UNAVAILABLE" };
  const identities = new Map<string, string>();
  const versions = new Map<string, string>();
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
      versions.set(expected.sourceId, expected.sourceVersionId);
    }
    for (const [sourceId, sourceVersionId] of versions) {
      const latest = await readLatestBoundRevision(config, workspaceKey, sourceId);
      if (!latest.ok) return latest;
      if (latest.sourceVersionId !== sourceVersionId) return { ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" };
    }
    return { ok: true, identities };
  } catch { return { ok: false, code: "CONNECTOR_IDENTITY_UNAVAILABLE" }; }
}

/*
  The latest immutable revision of one logical source, as the database first observed it.

  A continuous source keeps every revision it ever bound, and each revision is its own immutable
  upload UUID. Resolving a selected UUID to its logical source is not enough on its own: a
  refresh that still names revision 1 after revision 2 was bound would compile, and publish,
  content the provider has already replaced. "Latest" is `recorded_at`, the database's first
  successful observation -- provider revision strings are not orderable across providers, and
  this code does not invent an order for them. Two revisions observed at the same instant are
  not a latest, so they are refused rather than tie-broken by id.
*/
async function readLatestBoundRevision(config: SupabaseAdminConfig, workspaceKey: string, sourceId: string): Promise<
  { ok: true; sourceVersionId: string } | { ok: false; code: string }
> {
  const response = await supabaseAdminRequest(config,
    `/rest/v1/connector_document_bindings?workspace_key=eq.${encodeURIComponent(workspaceKey)}&source_id=eq.${encodeURIComponent(sourceId)}` +
    "&select=source_version_id,source_id,workspace_key,recorded_at&order=recorded_at.desc&limit=2");
  if (!response.ok) return { ok: false, code: "CONNECTOR_IDENTITY_UNAVAILABLE" };
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, code: "CONNECTOR_IDENTITY_UNRESOLVED" };
  const [latest, previous] = rows as Record<string, unknown>[];
  // Microsecond comparison: Date.parse would merge distinct instants within one millisecond.
  const latestAt = databaseInstantMicros(latest?.recorded_at);
  if (!latest || latest.workspace_key !== workspaceKey || latest.source_id !== sourceId ||
      typeof latest.source_version_id !== "string" || latestAt === null) {
    return { ok: false, code: "CONNECTOR_IDENTITY_CONFLICT" };
  }
  if (previous !== undefined) {
    const previousAt = databaseInstantMicros(previous?.recorded_at);
    if (!previous || previousAt === null) return { ok: false, code: "CONNECTOR_IDENTITY_CONFLICT" };
    if (latestAt < previousAt) return { ok: false, code: "CONNECTOR_IDENTITY_CONFLICT" };
    if (latestAt === previousAt) return { ok: false, code: "CONNECTOR_SOURCE_REVISION_AMBIGUOUS" };
  }
  return { ok: true, sourceVersionId: latest.source_version_id };
}
