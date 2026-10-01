import { connectorSourceIdentity } from "./connector-source-identity";
import type { OAuthConnectorProvider } from "./connector-oauth";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

type SourceInput = { workspaceKey: string; connectionId: string; provider: OAuthConnectorProvider; nativeId: string; revision: string };

/*
  The latest binding of a logical source as the database ordered it, read before an import's first
  provider read. The import later records only if this is still the latest (see
  `record_connector_document_binding_current`), so an older revision cannot overtake a newer one
  that was bound while its download ran. No provider timestamp or revision ordering is involved.
*/
export async function readConnectorLatestBinding(input: SourceInput): Promise<{ ok: true; sourceVersionId: string | null } | { ok: false; code: string }> {
  let sourceId: string;
  try { sourceId = (await connectorSourceIdentity(input)).sourceId; }
  catch { return { ok: false, code: "SOURCE_IDENTITY_INVALID" }; }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "CONNECTOR_BINDING_STORE_NOT_CONFIGURED" };
  try {
    const read = await supabaseAdminRequest(config, `/rest/v1/connector_document_bindings?workspace_key=eq.${encodeURIComponent(input.workspaceKey)}&source_id=eq.${sourceId}&select=source_version_id,workspace_key,source_id&order=recorded_at.desc,source_version_id.desc&limit=1`);
    if (!read.ok) return { ok: false, code: "CONNECTOR_BINDING_READ_FAILED" };
    const rows: unknown = await read.json();
    if (!Array.isArray(rows) || rows.length > 1) return { ok: false, code: "CONNECTOR_BINDING_READ_FAILED" };
    if (rows.length === 0) return { ok: true, sourceVersionId: null };
    const row = rows[0] as Record<string, unknown> | null;
    if (!row || typeof row.source_version_id !== "string" || !/^sv-[a-f0-9]{64}$/.test(row.source_version_id)
      || row.workspace_key !== input.workspaceKey || row.source_id !== sourceId) return { ok: false, code: "CONNECTOR_BINDING_READ_FAILED" };
    return { ok: true, sourceVersionId: row.source_version_id };
  } catch { return { ok: false, code: "CONNECTOR_BINDING_STORE_FAILED" }; }
}

export async function recordConnectorDocumentBinding(input: SourceInput & {
  contentSha256: string; byteLength: number; mimeType: string;
  /** The `readConnectorLatestBinding` result taken before the import's first provider read. */
  expectedLatestSourceVersionId: string | null;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  let identity: Awaited<ReturnType<typeof connectorSourceIdentity>>;
  try { identity = await connectorSourceIdentity(input); }
  catch { return { ok: false, code: "SOURCE_IDENTITY_INVALID" }; }
  if (!/^sha256:[a-f0-9]{64}$/.test(input.contentSha256) || !Number.isSafeInteger(input.byteLength) ||
      input.byteLength <= 0 || typeof input.mimeType !== "string" || input.mimeType.length < 3 || input.mimeType.length > 160 ||
      (input.expectedLatestSourceVersionId !== null && !/^sv-[a-f0-9]{64}$/.test(input.expectedLatestSourceVersionId))) {
    return { ok: false, code: "CONNECTOR_BINDING_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "CONNECTOR_BINDING_STORE_NOT_CONFIGURED" };
  const row = { source_version_id: identity.sourceVersionId, source_id: identity.sourceId,
    workspace_key: input.workspaceKey, oauth_connection_id: input.connectionId, provider: input.provider,
    native_id: input.nativeId, provider_revision: input.revision, document_id: identity.documentId,
    content_sha256: input.contentSha256, byte_length: input.byteLength, mime_type: input.mimeType };
  try {
    // The database keeps logical-source tombstones forever. Check before attempting an
    // insert so a provider re-listing cannot recreate a deleted source under a new revision.
    // A trigger in the deletion migration repeats this check in the same transaction; this
    // RPC is the early, stable product error rather than the only enforcement boundary.
    const allowed = await supabaseAdminRequest(config, "/rest/v1/rpc/connector_source_import_allowed", {
      method: "POST",
      body: JSON.stringify({ p_workspace_key: input.workspaceKey, p_source_id: identity.sourceId }),
    });
    if (!allowed.ok) return { ok: false, code: "CONNECTOR_BINDING_GUARD_UNAVAILABLE" };
    const decision: unknown = await allowed.json();
    if (decision !== true) {
      return { ok: false, code: decision === false ? "SOURCE_TOMBSTONED" : "CONNECTOR_BINDING_GUARD_UNAVAILABLE" };
    }
    const write = await supabaseAdminRequest(config, "/rest/v1/rpc/record_connector_document_binding_current", {
      method: "POST", body: JSON.stringify({ p_binding: row, p_expected_latest_source_version_id: input.expectedLatestSourceVersionId }),
    });
    if (!write.ok) return { ok: false, code: "CONNECTOR_BINDING_WRITE_FAILED" };
    const outcome: unknown = await write.json();
    // Another revision of this source was bound after this import's snapshot. Retrying re-reads the
    // latest binding and the provider's current revision; nothing was written.
    if (outcome === "contested") return { ok: false, code: "CONNECTOR_SOURCE_REVISION_CONTESTED" };
    if (outcome !== "recorded" && outcome !== "replay") return { ok: false, code: "CONNECTOR_BINDING_WRITE_FAILED" };
    // Read the actual winner even when the RPC recorded a row. No timestamp is invented
    // on replay: recorded_at belongs to the database's first successful observation.
    const read = await supabaseAdminRequest(config, `/rest/v1/connector_document_bindings?source_version_id=eq.${identity.sourceVersionId}&workspace_key=eq.${input.workspaceKey}&limit=1`);
    if (!read.ok) return { ok: false, code: "CONNECTOR_BINDING_READ_FAILED" };
    const rows: unknown = await read.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") return { ok: false, code: "CONNECTOR_BINDING_READ_FAILED" };
    if (Object.entries(row).some(([key, value]) => rows[0][key] !== value)) return { ok: false, code: "CONNECTOR_BINDING_CONFLICT" };
    return { ok: true };
  } catch { return { ok: false, code: "CONNECTOR_BINDING_STORE_FAILED" }; }
}
