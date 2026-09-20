import { connectorSourceIdentity } from "./connector-source-identity";
import type { OAuthConnectorProvider } from "./connector-oauth";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export async function recordConnectorDocumentBinding(input: {
  workspaceKey: string; connectionId: string; provider: OAuthConnectorProvider;
  nativeId: string; revision: string; contentSha256: string; byteLength: number; mimeType: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  let identity: Awaited<ReturnType<typeof connectorSourceIdentity>>;
  try { identity = await connectorSourceIdentity(input); }
  catch { return { ok: false, code: "SOURCE_IDENTITY_INVALID" }; }
  if (!/^sha256:[a-f0-9]{64}$/.test(input.contentSha256) || !Number.isSafeInteger(input.byteLength) ||
      input.byteLength <= 0 || typeof input.mimeType !== "string" || input.mimeType.length < 3 || input.mimeType.length > 160) {
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
    const write = await supabaseAdminRequest(config, "/rest/v1/connector_document_bindings", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify([row]),
    });
    if (!write.ok) return { ok: false, code: "CONNECTOR_BINDING_WRITE_FAILED" };
    // Read the actual winner even when INSERT returned a row. No timestamp is invented
    // on replay: recorded_at belongs to the database's first successful observation.
    const read = await supabaseAdminRequest(config, `/rest/v1/connector_document_bindings?source_version_id=eq.${identity.sourceVersionId}&workspace_key=eq.${input.workspaceKey}&limit=1`);
    if (!read.ok) return { ok: false, code: "CONNECTOR_BINDING_READ_FAILED" };
    const rows: unknown = await read.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") return { ok: false, code: "CONNECTOR_BINDING_READ_FAILED" };
    if (Object.entries(row).some(([key, value]) => rows[0][key] !== value)) return { ok: false, code: "CONNECTOR_BINDING_CONFLICT" };
    return { ok: true };
  } catch { return { ok: false, code: "CONNECTOR_BINDING_STORE_FAILED" }; }
}
