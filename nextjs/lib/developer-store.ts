import type { ConnectionBatchInput, ConnectionInput, DeveloperScope } from "./developer-contracts";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const API_KEY_PATTERN = /^tvnl_live_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/;

export type DeveloperApiKey = {
  keyId: string;
  name: string;
  prefix: string;
  scopes: DeveloperScope[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type FoundationConnection = {
  connectionId: string;
  provider: ConnectionInput["provider"];
  mode: ConnectionInput["mode"];
  displayName: string;
  configuration: Record<string, unknown>;
  secretReference: string | null;
  status: "pending" | "active" | "paused" | "error" | "revoked";
  cursorSha256: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

function bytesToBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

async function tokenSha256(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseApiKey(row: Record<string, unknown>): DeveloperApiKey | null {
  if (typeof row.key_id !== "string" || typeof row.name !== "string" || typeof row.key_prefix !== "string" || !Array.isArray(row.scopes) || typeof row.created_at !== "string") return null;
  return {
    keyId: row.key_id,
    name: row.name,
    prefix: row.key_prefix,
    scopes: row.scopes as DeveloperScope[],
    createdAt: row.created_at,
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null,
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
  };
}

function parseConnection(row: Record<string, unknown>): FoundationConnection | null {
  if (typeof row.connection_id !== "string" || typeof row.provider !== "string" || typeof row.mode !== "string" || typeof row.display_name !== "string" || typeof row.status !== "string" || typeof row.created_at !== "string" || typeof row.updated_at !== "string") return null;
  return {
    connectionId: row.connection_id,
    provider: row.provider as FoundationConnection["provider"],
    mode: row.mode as FoundationConnection["mode"],
    displayName: row.display_name,
    configuration: row.configuration && typeof row.configuration === "object" ? row.configuration as Record<string, unknown> : {},
    secretReference: typeof row.secret_reference === "string" ? row.secret_reference : null,
    status: row.status as FoundationConnection["status"],
    cursorSha256: typeof row.cursor_sha256 === "string" ? row.cursor_sha256 : null,
    lastSyncAt: typeof row.last_sync_at === "string" ? row.last_sync_at : null,
    lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertAudit(workspaceKey: string, action: string, targetId: string, actor: { userId?: string; keyId?: string }, details: Record<string, unknown> = {}) {
  const config = readSupabaseAdminConfig();
  if (!config) return false;
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/foundation_developer_audit_events", {
      method: "POST",
      body: JSON.stringify({
        workspace_key: workspaceKey,
        action,
        target_id: targetId,
        actor_user_id: actor.keyId ? null : actor.userId ?? null,
        actor_key_id: actor.keyId ?? null,
        details,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listDeveloperApiKeys(workspaceKey: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "DEVELOPER_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "key_id,name,key_prefix,scopes,created_at,expires_at,last_used_at,revoked_at",
    workspace_key: `eq.${workspaceKey}`,
    order: "created_at.desc",
    limit: "100",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_api_keys?${query}`);
    if (!response.ok) return { ok: false as const, code: "DEVELOPER_STORE_READ_FAILED" };
    const parsed = ((await response.json()) as Array<Record<string, unknown>>).map(parseApiKey);
    if (parsed.some((key) => key === null)) return { ok: false as const, code: "DEVELOPER_STORE_BINDING_INVALID" };
    return { ok: true as const, keys: parsed as DeveloperApiKey[] };
  } catch {
    return { ok: false as const, code: "DEVELOPER_STORE_READ_FAILED" };
  }
}

export async function createDeveloperApiKey(input: { workspaceKey: string; userId: string; name: string; scopes: DeveloperScope[]; expiresAt: string | null }) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "DEVELOPER_STORE_NOT_CONFIGURED" };
  const prefix = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(9)));
  const secret = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const token = `tvnl_live_${prefix}_${secret}`;
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/foundation_api_keys?select=key_id,name,key_prefix,scopes,created_at,expires_at,last_used_at,revoked_at", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        workspace_key: input.workspaceKey,
        name: input.name,
        key_prefix: prefix,
        token_sha256: await tokenSha256(token),
        scopes: input.scopes,
        created_by: input.userId,
        expires_at: input.expiresAt,
      }),
    });
    if (!response.ok) return { ok: false as const, code: "API_KEY_CREATE_FAILED" };
    const key = parseApiKey(((await response.json()) as Array<Record<string, unknown>>)[0] ?? {});
    if (!key) return { ok: false as const, code: "DEVELOPER_STORE_BINDING_INVALID" };
    if (!await insertAudit(input.workspaceKey, "api_key_created", key.keyId, { userId: input.userId }, { scopes: input.scopes })) {
      await supabaseAdminRequest(config, `/rest/v1/foundation_api_keys?key_id=eq.${key.keyId}`, {
        method: "PATCH",
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      }).catch(() => undefined);
      return { ok: false as const, code: "DEVELOPER_AUDIT_WRITE_FAILED" };
    }
    return { ok: true as const, key, token };
  } catch {
    return { ok: false as const, code: "API_KEY_CREATE_FAILED" };
  }
}

export async function revokeDeveloperApiKey(workspaceKey: string, userId: string, keyId: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "DEVELOPER_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({ key_id: `eq.${keyId}`, workspace_key: `eq.${workspaceKey}`, revoked_at: "is.null" });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_api_keys?${query}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    if (!response.ok) return { ok: false as const, code: "API_KEY_REVOKE_FAILED" };
    const rows = await response.json() as Array<Record<string, unknown>>;
    if (rows.length === 0) return { ok: false as const, code: "API_KEY_NOT_FOUND" };
    if (!await insertAudit(workspaceKey, "api_key_revoked", keyId, { userId })) return { ok: false as const, code: "DEVELOPER_AUDIT_WRITE_FAILED" };
    return { ok: true as const };
  } catch {
    return { ok: false as const, code: "API_KEY_REVOKE_FAILED" };
  }
}

export async function authenticateDeveloperApiKey(token: string) {
  const match = API_KEY_PATTERN.exec(token);
  const config = readSupabaseAdminConfig();
  if (!match || !config) return { ok: false as const, code: "API_KEY_INVALID" };
  const query = new URLSearchParams({
    select: "key_id,workspace_key,created_by,scopes,expires_at,revoked_at",
    key_prefix: `eq.${match[1]}`,
    token_sha256: `eq.${await tokenSha256(token)}`,
    limit: "1",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_api_keys?${query}`);
    if (!response.ok) return { ok: false as const, code: "API_KEY_INVALID" };
    const row = ((await response.json()) as Array<Record<string, unknown>>)[0];
    if (!row || row.revoked_at || typeof row.key_id !== "string" || typeof row.workspace_key !== "string" || typeof row.created_by !== "string" || !Array.isArray(row.scopes)) return { ok: false as const, code: "API_KEY_INVALID" };
    if (typeof row.expires_at === "string" && Date.parse(row.expires_at) <= Date.now()) return { ok: false as const, code: "API_KEY_EXPIRED" };
    void supabaseAdminRequest(config, `/rest/v1/foundation_api_keys?key_id=eq.${row.key_id}`, {
      method: "PATCH",
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    }).catch(() => undefined);
    return {
      ok: true as const,
      principal: {
        kind: "api-key" as const,
        keyId: row.key_id,
        workspaceKey: row.workspace_key,
        userId: row.created_by,
        scopes: row.scopes as DeveloperScope[],
      },
    };
  } catch {
    return { ok: false as const, code: "API_KEY_INVALID" };
  }
}

export async function consumeDeveloperApiRateLimit(input: { keyId: string; workspaceKey: string; scope: DeveloperScope; limit: number }) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "API_RATE_LIMIT_UNAVAILABLE" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/consume_foundation_api_rate_limit", {
      method: "POST",
      body: JSON.stringify({
        p_key_id: input.keyId,
        p_workspace_key: input.workspaceKey,
        p_scope: input.scope,
        p_limit: input.limit,
      }),
    });
    if (!response.ok) return { ok: false as const, code: "API_RATE_LIMIT_UNAVAILABLE" };
    const allowed = await response.json();
    return allowed === true
      ? { ok: true as const }
      : { ok: false as const, code: "API_RATE_LIMITED" };
  } catch {
    return { ok: false as const, code: "API_RATE_LIMIT_UNAVAILABLE" };
  }
}

export async function listFoundationConnections(workspaceKey: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "DEVELOPER_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "connection_id,provider,mode,display_name,configuration,secret_reference,status,cursor_sha256,last_sync_at,last_error_code,created_at,updated_at",
    workspace_key: `eq.${workspaceKey}`,
    status: "neq.revoked",
    order: "created_at.desc",
    limit: "100",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_connections?${query}`);
    if (!response.ok) return { ok: false as const, code: "DEVELOPER_STORE_READ_FAILED" };
    const parsed = ((await response.json()) as Array<Record<string, unknown>>).map(parseConnection);
    if (parsed.some((connection) => connection === null)) return { ok: false as const, code: "DEVELOPER_STORE_BINDING_INVALID" };
    return { ok: true as const, connections: parsed as FoundationConnection[] };
  } catch {
    return { ok: false as const, code: "DEVELOPER_STORE_READ_FAILED" };
  }
}

export async function createFoundationConnection(workspaceKey: string, actor: { userId?: string; keyId?: string }, input: ConnectionInput) {
  const config = readSupabaseAdminConfig();
  const userId = actor.userId;
  if (!config || !userId) return { ok: false as const, code: "DEVELOPER_STORE_NOT_CONFIGURED" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/foundation_connections?select=connection_id,provider,mode,display_name,configuration,secret_reference,status,cursor_sha256,last_sync_at,last_error_code,created_at,updated_at", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        workspace_key: workspaceKey,
        provider: input.provider,
        mode: input.mode,
        display_name: input.displayName,
        configuration: input.configuration,
        secret_reference: input.secretReference,
        created_by: userId,
        updated_by: userId,
      }),
    });
    if (!response.ok) return { ok: false as const, code: "CONNECTION_CREATE_FAILED" };
    const connection = parseConnection(((await response.json()) as Array<Record<string, unknown>>)[0] ?? {});
    if (!connection) return { ok: false as const, code: "DEVELOPER_STORE_BINDING_INVALID" };
    if (!await insertAudit(workspaceKey, "connection_created", connection.connectionId, actor, { provider: input.provider, mode: input.mode })) {
      await supabaseAdminRequest(config, `/rest/v1/foundation_connections?connection_id=eq.${connection.connectionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "revoked", updated_at: new Date().toISOString() }),
      }).catch(() => undefined);
      return { ok: false as const, code: "DEVELOPER_AUDIT_WRITE_FAILED" };
    }
    return { ok: true as const, connection };
  } catch {
    return { ok: false as const, code: "CONNECTION_CREATE_FAILED" };
  }
}

export async function revokeFoundationConnection(workspaceKey: string, connectionId: string, actor: { userId?: string; keyId?: string }) {
  const config = readSupabaseAdminConfig();
  if (!config || !actor.userId) return { ok: false as const, code: "DEVELOPER_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({ connection_id: `eq.${connectionId}`, workspace_key: `eq.${workspaceKey}`, status: "neq.revoked" });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_connections?${query}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "revoked", updated_by: actor.userId, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) return { ok: false as const, code: "CONNECTION_REVOKE_FAILED" };
    const rows = await response.json() as Array<Record<string, unknown>>;
    if (rows.length === 0) return { ok: false as const, code: "CONNECTION_NOT_FOUND" };
    if (!await insertAudit(workspaceKey, "connection_revoked", connectionId, actor)) return { ok: false as const, code: "DEVELOPER_AUDIT_WRITE_FAILED" };
    return { ok: true as const };
  } catch {
    return { ok: false as const, code: "CONNECTION_REVOKE_FAILED" };
  }
}

export async function applyFoundationConnectionBatch(workspaceKey: string, connectionId: string, actor: { userId?: string; keyId?: string }, batch: ConnectionBatchInput) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "DEVELOPER_STORE_NOT_CONFIGURED" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/apply_foundation_connection_batch", {
      method: "POST",
      body: JSON.stringify({
        p_batch_id: batch.batchId,
        p_workspace_key: workspaceKey,
        p_connection_id: connectionId,
        p_previous_cursor_sha256: batch.previousCursorSha256,
        p_next_cursor_sha256: batch.nextCursorSha256,
        p_manifest_sha256: batch.manifestSha256,
        p_event_count: batch.events.length,
        p_event_manifest: batch.events,
        p_actor_user_id: actor.keyId ? null : actor.userId ?? null,
        p_actor_key_id: actor.keyId ?? null,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: unknown };
      const message = typeof body.message === "string" ? body.message : "";
      if (message.includes("connection_cursor_conflict")) return { ok: false as const, code: "CONNECTION_CURSOR_CONFLICT" };
      if (message.includes("connection_batch_idempotency_conflict")) return { ok: false as const, code: "CONNECTION_BATCH_CONFLICT" };
      if (message.includes("connection_not_syncable")) return { ok: false as const, code: "CONNECTION_NOT_SYNCABLE" };
      return { ok: false as const, code: "CONNECTION_BATCH_FAILED" };
    }
    return { ok: true as const, result: await response.json() as Record<string, unknown> };
  } catch {
    return { ok: false as const, code: "CONNECTION_BATCH_FAILED" };
  }
}
