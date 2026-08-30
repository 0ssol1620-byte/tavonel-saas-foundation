import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import type { OAuthConnectorProvider } from "./connector-oauth";

export type OAuthAuthorizationRecord = {
  authorizationId: string;
  workspaceKey: string;
  displayName: string;
  pkceVerifierReference: string;
  redirectUri: string;
  requestedScopes: string[];
};

export type OAuthConnection = {
  oauthConnectionId: string;
  provider: OAuthConnectorProvider;
  displayName: string;
  providerAccountId: string;
  providerAccountLabel: string | null;
  grantedScopes: string[];
  status: "active" | "reauthorization_required" | "paused" | "error" | "revoked";
  cursorSha256: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseOAuthConnection(row: Record<string, unknown>): OAuthConnection | null {
  if (typeof row.oauth_connection_id !== "string" || typeof row.provider !== "string" || typeof row.display_name !== "string" || typeof row.provider_account_id !== "string" || !Array.isArray(row.granted_scopes) || typeof row.status !== "string" || typeof row.created_at !== "string" || typeof row.updated_at !== "string") return null;
  return {
    oauthConnectionId: row.oauth_connection_id,
    provider: row.provider as OAuthConnectorProvider,
    displayName: row.display_name,
    providerAccountId: row.provider_account_id,
    providerAccountLabel: typeof row.provider_account_label === "string" ? row.provider_account_label : null,
    grantedScopes: row.granted_scopes as string[],
    status: row.status as OAuthConnection["status"],
    cursorSha256: typeof row.cursor_sha256 === "string" ? row.cursor_sha256 : null,
    lastSyncAt: typeof row.last_sync_at === "string" ? row.last_sync_at : null,
    lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertOAuthAudit(workspaceKey: string, userId: string, action: string, targetId: string, details: Record<string, unknown>) {
  const config = readSupabaseAdminConfig();
  if (!config) return false;
  const response = await supabaseAdminRequest(config, "/rest/v1/foundation_developer_audit_events", {
    method: "POST",
    body: JSON.stringify({
      workspace_key: workspaceKey,
      action,
      target_id: targetId,
      actor_user_id: userId,
      actor_key_id: null,
      details,
    }),
  }).catch(() => null);
  return response?.ok === true;
}

export async function createOAuthAuthorization(input: {
  workspaceKey: string;
  userId: string;
  provider: OAuthConnectorProvider;
  displayName: string;
  stateSha256: string;
  pkceVerifierReference: string;
  redirectUri: string;
  requestedScopes: readonly string[];
}) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "OAUTH_STORE_NOT_CONFIGURED" };
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/foundation_oauth_authorizations?select=authorization_id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        workspace_key: input.workspaceKey,
        provider: input.provider,
        display_name: input.displayName,
        state_sha256: input.stateSha256,
        pkce_verifier_reference: input.pkceVerifierReference,
        redirect_uri: input.redirectUri,
        requested_scopes: input.requestedScopes,
        created_by: input.userId,
        expires_at: expiresAt,
      }),
    });
    const payload = await response.json().catch(() => []);
    const row = (Array.isArray(payload) ? payload : [])[0] as Record<string, unknown> | undefined;
    if (!response.ok || typeof row?.authorization_id !== "string") {
      const databaseCode = !Array.isArray(payload) && payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string"
        ? payload.code
        : "UNKNOWN";
      console.error("OAuth authorization insert failed", { status: response.status, databaseCode });
      return { ok: false as const, code: "OAUTH_AUTHORIZATION_CREATE_FAILED" };
    }
    const audited = await insertOAuthAudit(input.workspaceKey, input.userId, "oauth_authorization_started", row.authorization_id, { provider: input.provider });
    if (!audited) {
      await supabaseAdminRequest(config, `/rest/v1/foundation_oauth_authorizations?authorization_id=eq.${row.authorization_id}`, { method: "DELETE" }).catch(() => undefined);
      return { ok: false as const, code: "DEVELOPER_AUDIT_WRITE_FAILED" };
    }
    return { ok: true as const, authorizationId: row.authorization_id, expiresAt };
  } catch {
    return { ok: false as const, code: "OAUTH_AUTHORIZATION_CREATE_FAILED" };
  }
}

export async function consumeOAuthAuthorization(stateSha256: string, provider: OAuthConnectorProvider, userId: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "OAUTH_STORE_NOT_CONFIGURED" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/consume_foundation_oauth_authorization", {
      method: "POST",
      body: JSON.stringify({ p_state_sha256: stateSha256, p_provider: provider, p_user_id: userId }),
    });
    const row = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || typeof row.authorizationId !== "string" || typeof row.workspaceKey !== "string" || typeof row.displayName !== "string" || typeof row.pkceVerifierReference !== "string" || typeof row.redirectUri !== "string" || !Array.isArray(row.requestedScopes)) {
      return { ok: false as const, code: "OAUTH_AUTHORIZATION_INVALID" };
    }
    return { ok: true as const, authorization: row as unknown as OAuthAuthorizationRecord };
  } catch {
    return { ok: false as const, code: "OAUTH_AUTHORIZATION_INVALID" };
  }
}

export async function listOAuthConnections(workspaceKey: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "OAUTH_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "oauth_connection_id,provider,display_name,provider_account_id,provider_account_label,granted_scopes,status,cursor_sha256,last_sync_at,last_error_code,created_at,updated_at",
    workspace_key: `eq.${workspaceKey}`,
    status: "neq.revoked",
    order: "created_at.desc",
    limit: "100",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_oauth_connections?${query}`);
    if (!response.ok) return { ok: false as const, code: "OAUTH_CONNECTION_READ_FAILED" };
    const parsed = ((await response.json()) as Array<Record<string, unknown>>).map(parseOAuthConnection);
    if (parsed.some((item) => item === null)) return { ok: false as const, code: "OAUTH_STORE_BINDING_INVALID" };
    return { ok: true as const, connections: parsed as OAuthConnection[] };
  } catch {
    return { ok: false as const, code: "OAUTH_CONNECTION_READ_FAILED" };
  }
}

export async function createOAuthConnection(input: {
  workspaceKey: string;
  userId: string;
  provider: OAuthConnectorProvider;
  displayName: string;
  providerAccountId: string;
  providerAccountLabel: string | null;
  grantedScopes: string[];
  clientSecretReference: string;
  refreshTokenReference: string;
}) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "OAUTH_STORE_NOT_CONFIGURED" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/foundation_oauth_connections?select=oauth_connection_id,provider,display_name,provider_account_id,provider_account_label,granted_scopes,status,cursor_sha256,last_sync_at,last_error_code,created_at,updated_at", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        workspace_key: input.workspaceKey,
        provider: input.provider,
        display_name: input.displayName,
        provider_account_id: input.providerAccountId,
        provider_account_label: input.providerAccountLabel,
        granted_scopes: input.grantedScopes,
        client_secret_reference: input.clientSecretReference,
        refresh_token_reference: input.refreshTokenReference,
        created_by: input.userId,
        updated_by: input.userId,
      }),
    });
    if (!response.ok) return { ok: false as const, code: response.status === 409 ? "OAUTH_CONNECTION_EXISTS" : "OAUTH_CONNECTION_CREATE_FAILED" };
    const connection = parseOAuthConnection(((await response.json()) as Array<Record<string, unknown>>)[0] ?? {});
    if (!connection) return { ok: false as const, code: "OAUTH_STORE_BINDING_INVALID" };
    if (!await insertOAuthAudit(input.workspaceKey, input.userId, "oauth_connection_created", connection.oauthConnectionId, { provider: input.provider })) {
      await supabaseAdminRequest(config, `/rest/v1/foundation_oauth_connections?oauth_connection_id=eq.${connection.oauthConnectionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "revoked", revoked_at: new Date().toISOString(), updated_by: input.userId, updated_at: new Date().toISOString() }),
      }).catch(() => undefined);
      return { ok: false as const, code: "DEVELOPER_AUDIT_WRITE_FAILED" };
    }
    return { ok: true as const, connection };
  } catch {
    return { ok: false as const, code: "OAUTH_CONNECTION_CREATE_FAILED" };
  }
}

export async function revokeOAuthConnection(workspaceKey: string, userId: string, oauthConnectionId: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "OAUTH_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({ oauth_connection_id: `eq.${oauthConnectionId}`, workspace_key: `eq.${workspaceKey}`, status: "neq.revoked" });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_oauth_connections?${query}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "revoked", revoked_at: new Date().toISOString(), updated_by: userId, updated_at: new Date().toISOString() }),
    });
    const rows = await response.json().catch(() => []) as Array<Record<string, unknown>>;
    if (!response.ok) return { ok: false as const, code: "OAUTH_CONNECTION_REVOKE_FAILED" };
    if (rows.length === 0) return { ok: false as const, code: "OAUTH_CONNECTION_NOT_FOUND" };
    if (!await insertOAuthAudit(workspaceKey, userId, "oauth_connection_revoked", oauthConnectionId, {})) return { ok: false as const, code: "DEVELOPER_AUDIT_WRITE_FAILED" };
    return { ok: true as const };
  } catch {
    return { ok: false as const, code: "OAUTH_CONNECTION_REVOKE_FAILED" };
  }
}

export async function getOAuthConnectionSecretReference(workspaceKey: string, oauthConnectionId: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "OAUTH_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "refresh_token_reference",
    oauth_connection_id: `eq.${oauthConnectionId}`,
    workspace_key: `eq.${workspaceKey}`,
    status: "neq.revoked",
    limit: "1",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_oauth_connections?${query}`);
    const row = ((await response.json().catch(() => [])) as Array<Record<string, unknown>>)[0];
    if (!response.ok) return { ok: false as const, code: "OAUTH_CONNECTION_READ_FAILED" };
    if (!row || typeof row.refresh_token_reference !== "string") return { ok: false as const, code: "OAUTH_CONNECTION_NOT_FOUND" };
    return { ok: true as const, refreshTokenReference: row.refresh_token_reference };
  } catch {
    return { ok: false as const, code: "OAUTH_CONNECTION_READ_FAILED" };
  }
}
