import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("product authorization resolves durable membership and compares its epoch", async () => {
  const [auth, membership] = await Promise.all([
    read("nextjs/lib/developer-auth.ts"),
    read("nextjs/lib/workspace-membership.ts"),
  ]);
  assert.match(auth, /getWorkspaceMembership/);
  assert.match(auth, /principal\.authorizationRevision/);
  assert.match(membership, /authorization_revision/);
  assert.match(membership, /current\.principal\.authorizationRevision !== expected\.authorizationRevision/);
});

test("Ask replay identity includes the authority epoch", async () => {
  const route = await read("nextjs/app/api/collections/[id]/ask/route.ts");
  const identity = route.match(/const identity = JSON\.stringify\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
  assert.match(identity, /auth\.principal\.authorizationRevision/);
  assert.match(identity, /active\.world\.revision/);
  assert.ok((route.match(/revalidateFoundationAuthorization\(/g) ?? []).length >= 2,
    "Ask must revalidate again after cache completion and lease cleanup");
});

test("API keys are issued and authenticated against one immutable authority epoch", async () => {
  const [migration, store, auth] = await Promise.all([
    read("supabase/migrations/20260920121000_workspace_authority_epoch.sql"),
    read("nextjs/lib/developer-store.ts"),
    read("nextjs/lib/developer-auth.ts"),
  ]);
  assert.match(migration, /alter table public\.foundation_api_keys[\s\S]+authorization_revision/);
  assert.match(migration, /create_foundation_api_key_authorized[\s\S]+for update/);
  assert.match(migration, /v_membership\.authorization_revision <> p_authorization_revision/);
  assert.match(migration, /v_old\.authorization_revision is distinct from p_authorization_revision/);
  assert.match(store, /select: "key_id,workspace_key,created_by,scopes,expires_at,revoked_at,authorization_revision"/);
  assert.match(store, /authorizationRevision: Number\(row\.authorization_revision\)/);
  assert.match(auth, /authenticated\.principal\.authorizationRevision !== authority\.authorizationRevision/);
});

test("deferred OAuth state and connection commit are transactionally epoch-bound", async () => {
  const [migration, store, start, callback] = await Promise.all([
    read("supabase/migrations/20260920121000_workspace_authority_epoch.sql"),
    read("nextjs/lib/connector-oauth-store.ts"),
    read("nextjs/app/api/v1/oauth-connectors/authorize/route.ts"),
    read("nextjs/app/api/v1/oauth-connectors/callback/[provider]/route.ts"),
  ]);
  assert.match(migration, /consume_foundation_oauth_authorization[\s\S]+foundation_workspace_members[\s\S]+for update/);
  assert.match(migration, /authorization_revision <> v_authorization\.authorization_revision/);
  assert.match(migration, /create_foundation_oauth_connection_authorized[\s\S]+foundation_workspace_members[\s\S]+for update/);
  assert.match(migration, /authorization_revision <> p_authorization_revision/);
  assert.match(migration, /insert into public\.foundation_developer_audit_events/);
  assert.match(store, /p_authorization_revision: input\.authorizationRevision/);
  assert.match(start, /authorizationRevision: auth\.principal\.authorizationRevision/);
  assert.match(callback, /authorizationRevision: authorization\.authorizationRevision/);
});

test("new and between-migration users receive the durable personal workspace authority row", async () => {
  const migration = await read("supabase/migrations/20260920121000_workspace_authority_epoch.sql");
  assert.match(migration, /after insert on auth\.users/);
  assert.match(migration, /insert into public\.foundation_workspaces/);
  assert.match(migration, /insert into public\.foundation_workspace_members/);
  assert.match(migration, /from auth\.users u[\s\S]+on conflict \(workspace_key, user_id\) do nothing/);
});
