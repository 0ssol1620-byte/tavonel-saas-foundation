-- W1-A1 review R2 N1: what kind of token a foundation_api_keys row holds is a stored column, not
-- its human-editable name. 'live' is a key made in Workspace > Developers (tvnl_live_); 'mcp' is
-- one the remote MCP OAuth token route minted (tvnl_mcp_). The token form is also inside
-- token_sha256, and the application refuses a token whose form differs from its row's kind
-- (lib/developer-store.ts authenticateDeveloperApiKey), so the column cannot relabel a token.
--
-- Additive: every existing row, whatever its name, becomes 'live' -- it stays in the manual list
-- and revocable there, and the remote MCP's bulk revoke never touches it. Only the create RPC
-- below writes 'mcp'. Rotation stays a manual-key operation: an 'mcp' row is refused as a source.
begin;

alter table public.foundation_api_keys
  add column token_kind text not null default 'live'
  constraint foundation_api_keys_token_kind_check check (token_kind in ('live', 'mcp'));

-- A new trailing parameter with a default; dropping the old signature first keeps one candidate
-- for PostgREST to resolve, and every existing caller (eight named arguments) still gets 'live'.
drop function public.create_foundation_api_key_authorized(text, text, text, text, text[], timestamptz, uuid, bigint);
create function public.create_foundation_api_key_authorized(
  p_workspace_key text,
  p_name text,
  p_key_prefix text,
  p_token_sha256 text,
  p_scopes text[],
  p_expires_at timestamptz,
  p_actor_user_id uuid,
  p_authorization_revision bigint,
  p_token_kind text default 'live'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.foundation_workspace_members%rowtype;
  v_key public.foundation_api_keys%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_key, 0));
  select * into v_membership
    from public.foundation_workspace_members
    where workspace_key = p_workspace_key and user_id = p_actor_user_id
    for update;
  if not found
    or v_membership.state <> 'active'
    or v_membership.authorization_revision <> p_authorization_revision then
    raise exception 'api_key_authorization_changed';
  end if;

  insert into public.foundation_api_keys (
    workspace_key, name, key_prefix, token_sha256, scopes, created_by,
    expires_at, authorization_revision, token_kind
  ) values (
    p_workspace_key, p_name, p_key_prefix, p_token_sha256, p_scopes,
    p_actor_user_id, p_expires_at, p_authorization_revision, p_token_kind
  ) returning * into v_key;
  insert into public.foundation_developer_audit_events (
    workspace_key, action, target_id, actor_user_id, actor_key_id, details
  ) values (
    p_workspace_key, 'api_key_created', v_key.key_id::text, p_actor_user_id, null,
    pg_catalog.jsonb_build_object('scopes', p_scopes, 'authorizationRevision', p_authorization_revision, 'tokenKind', p_token_kind)
  );
  return pg_catalog.to_jsonb(v_key);
end;
$$;

create or replace function public.rotate_foundation_api_key(
  p_workspace_key text,
  p_old_key_id uuid,
  p_new_name text,
  p_new_prefix text,
  p_new_token_sha256 text,
  p_new_scopes text[],
  p_new_expires_at timestamptz,
  p_actor_user_id uuid,
  p_authorization_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.foundation_workspace_members%rowtype;
  v_old public.foundation_api_keys%rowtype;
  v_new public.foundation_api_keys%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_key, 0));
  select * into v_membership
    from public.foundation_workspace_members
    where workspace_key = p_workspace_key and user_id = p_actor_user_id
    for update;
  if not found
    or v_membership.state <> 'active'
    or v_membership.authorization_revision <> p_authorization_revision then
    raise exception 'api_key_authorization_changed';
  end if;
  select * into v_old from public.foundation_api_keys
    where key_id = p_old_key_id and workspace_key = p_workspace_key
    for update;
  if not found or v_old.revoked_at is not null
    or (v_old.expires_at is not null and v_old.expires_at <= pg_catalog.clock_timestamp())
    or v_old.created_by is distinct from p_actor_user_id
    or v_old.authorization_revision is distinct from p_authorization_revision
    or v_old.token_kind <> 'live' then
    raise exception 'api_key_rotation_source_invalid';
  end if;

  update public.foundation_api_keys set revoked_at = pg_catalog.clock_timestamp()
    where key_id = v_old.key_id;
  insert into public.foundation_api_keys (
    workspace_key, name, key_prefix, token_sha256, scopes, created_by,
    expires_at, authorization_revision
  ) values (
    p_workspace_key, p_new_name, p_new_prefix, p_new_token_sha256,
    p_new_scopes, p_actor_user_id, p_new_expires_at, p_authorization_revision
  ) returning * into v_new;
  insert into public.foundation_developer_audit_events (
    workspace_key, action, target_id, actor_user_id, details
  ) values (
    p_workspace_key, 'api_key_rotated', v_new.key_id::text, p_actor_user_id,
    pg_catalog.jsonb_build_object('replacesKeyId', v_old.key_id, 'scopes', p_new_scopes,
      'authorizationRevision', p_authorization_revision)
  );
  return pg_catalog.jsonb_build_object(
    'keyId', v_new.key_id, 'name', v_new.name, 'keyPrefix', v_new.key_prefix,
    'scopes', v_new.scopes, 'createdAt', v_new.created_at,
    'expiresAt', v_new.expires_at, 'replacedKeyId', v_old.key_id
  );
end;
$$;

revoke all on function public.create_foundation_api_key_authorized(
  text, text, text, text, text[], timestamptz, uuid, bigint, text
) from public, anon, authenticated;
grant execute on function public.create_foundation_api_key_authorized(
  text, text, text, text, text[], timestamptz, uuid, bigint, text
) to service_role;

commit;
