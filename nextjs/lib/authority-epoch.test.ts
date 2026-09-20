import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { config, request } = vi.hoisted(() => ({
  config: vi.fn(() => ({ url: "https://tenant.test", serviceRoleKey: "x".repeat(40) })),
  request: vi.fn(),
}));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: config, supabaseAdminRequest: request }));

import { createOAuthConnection } from "./connector-oauth-store";

const migrationUrl = new URL("../../supabase/migrations/20260920121000_workspace_authority_epoch.sql", import.meta.url);

describe("B09 authority epoch", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("binds deferred OAuth consume and connection creation to a locked membership revision", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(/foundation_oauth_authorizations[\s\S]+authorization_revision bigint/);
    expect(sql).toMatch(/consume_foundation_oauth_authorization[\s\S]+from public\.foundation_workspace_members[\s\S]+for update/);
    expect(sql).toMatch(/v_membership\.authorization_revision <> v_authorization\.authorization_revision/);
    expect(sql).toMatch(/create_foundation_oauth_connection_authorized[\s\S]+from public\.foundation_workspace_members[\s\S]+for update/);
    expect(sql).toMatch(/v_membership\.authorization_revision <> p_authorization_revision/);
    expect(sql).toMatch(/insert into public\.foundation_developer_audit_events/);
  });

  it("keeps person-owned API-key revocation scoped to the issuing user", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(/revoke_foundation_api_key_authorized[\s\S]+created_by = p_actor_user_id[\s\S]+for update/);
    expect(sql).toMatch(/rotate_foundation_api_key[\s\S]+v_old\.created_by is distinct from p_actor_user_id/);
  });

  it("sends the consumed epoch into the atomic connection RPC", async () => {
    request.mockResolvedValue(Response.json({
      oauth_connection_id: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
      provider: "google_drive", display_name: "Drive", provider_account_id: "account",
      provider_account_label: null, granted_scopes: ["openid"], status: "active",
      cursor_sha256: null, last_sync_at: null, last_error_code: null,
      created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z",
    }));
    const result = await createOAuthConnection({
      workspaceKey: "pilot-1234567890abcdef",
      userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
      authorizationRevision: 23,
      provider: "google_drive", displayName: "Drive", providerAccountId: "account",
      providerAccountLabel: null, grantedScopes: ["openid"],
      clientSecretReference: "gcp-sm://project/client", refreshTokenReference: "gcp-sm://project/refresh",
    });
    expect(result.ok).toBe(true);
    expect(request.mock.calls[0]?.[1]).toBe("/rest/v1/rpc/create_foundation_oauth_connection_authorized");
    const body = JSON.parse(String((request.mock.calls[0]?.[2] as RequestInit).body));
    expect(body.p_authorization_revision).toBe(23);
  });

  it("maps a transaction-local epoch refusal without reporting a successful connection", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ message: "oauth_authorization_changed" }), { status: 400 }));
    const result = await createOAuthConnection({
      workspaceKey: "pilot-1234567890abcdef",
      userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
      authorizationRevision: 23,
      provider: "google_drive", displayName: "Drive", providerAccountId: "account",
      providerAccountLabel: null, grantedScopes: ["openid"],
      clientSecretReference: "gcp-sm://project/client", refreshTokenReference: "gcp-sm://project/refresh",
    });
    expect(result).toEqual({ ok: false, code: "OAUTH_AUTHORIZATION_CHANGED" });
  });
});
