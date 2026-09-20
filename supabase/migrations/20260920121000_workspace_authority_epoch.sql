-- B09: make membership revision the authority epoch for request and deferred OAuth work.
begin;

-- B15 backfilled users present when it ran. Keep later self-service signups on the same
-- fail-closed authority path before the application starts requiring durable membership.
create or replace function public.bootstrap_foundation_workspace_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_key text := 'pilot-' || left(pg_catalog.regexp_replace(new.id::text, '[^A-Za-z0-9]', '', 'g'), 16);
begin
  insert into public.foundation_workspaces (workspace_key, display_name, created_by)
  values (
    v_workspace_key,
    coalesce(nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''), 'Personal') || '''s workspace',
    new.id
  ) on conflict (workspace_key) do nothing;

  insert into public.foundation_workspace_members (
    workspace_key, user_id, role, state, accepted_at
  ) values (
    v_workspace_key, new.id, 'owner', 'active', coalesce(new.created_at, pg_catalog.clock_timestamp())
  ) on conflict (workspace_key, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists foundation_workspace_membership_after_auth_user on auth.users;
create trigger foundation_workspace_membership_after_auth_user
  after insert on auth.users
  for each row execute function public.bootstrap_foundation_workspace_membership();

revoke all on function public.bootstrap_foundation_workspace_membership()
  from public, anon, authenticated, service_role;

-- Close the deployment window between the original B15 backfill and this trigger.
insert into public.foundation_workspaces (workspace_key, display_name, created_by)
select
  'pilot-' || left(pg_catalog.regexp_replace(u.id::text, '[^A-Za-z0-9]', '', 'g'), 16),
  coalesce(nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''), 'Personal') || '''s workspace',
  u.id
from auth.users u
on conflict (workspace_key) do nothing;

insert into public.foundation_workspace_members (
  workspace_key, user_id, role, state, accepted_at
)
select
  'pilot-' || left(pg_catalog.regexp_replace(u.id::text, '[^A-Za-z0-9]', '', 'g'), 16),
  u.id, 'owner', 'active', coalesce(u.created_at, pg_catalog.clock_timestamp())
from auth.users u
on conflict (workspace_key, user_id) do nothing;

-- An OAuth state is a deferred authority grant. Bind it to the exact membership epoch that
-- created it; pre-migration states have NULL and are intentionally invalidated.
alter table public.foundation_oauth_authorizations
  add column authorization_revision bigint check (authorization_revision > 0);

-- API keys are durable delegated credentials. Bind each key to the exact membership
-- epoch that issued it so revoke/reinvite cannot resurrect an old bearer token.
-- Existing keys have NULL and deliberately fail authentication until reissued.
alter table public.foundation_api_keys
  add column authorization_revision bigint check (authorization_revision > 0);

create or replace function public.create_foundation_api_key_authorized(
  p_workspace_key text,
  p_name text,
  p_key_prefix text,
  p_token_sha256 text,
  p_scopes text[],
  p_expires_at timestamptz,
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
    expires_at, authorization_revision
  ) values (
    p_workspace_key, p_name, p_key_prefix, p_token_sha256, p_scopes,
    p_actor_user_id, p_expires_at, p_authorization_revision
  ) returning * into v_key;
  insert into public.foundation_developer_audit_events (
    workspace_key, action, target_id, actor_user_id, actor_key_id, details
  ) values (
    p_workspace_key, 'api_key_created', v_key.key_id::text, p_actor_user_id, null,
    pg_catalog.jsonb_build_object('scopes', p_scopes, 'authorizationRevision', p_authorization_revision)
  );
  return pg_catalog.to_jsonb(v_key);
end;
$$;

create or replace function public.revoke_foundation_api_key_authorized(
  p_workspace_key text,
  p_key_id uuid,
  p_actor_user_id uuid,
  p_authorization_revision bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.foundation_workspace_members%rowtype;
  v_key public.foundation_api_keys%rowtype;
begin
  select * into v_membership
    from public.foundation_workspace_members
    where workspace_key = p_workspace_key and user_id = p_actor_user_id
    for update;
  if not found
    or v_membership.state <> 'active'
    or v_membership.authorization_revision <> p_authorization_revision then
    raise exception 'api_key_authorization_changed';
  end if;
  select * into v_key from public.foundation_api_keys
    where key_id = p_key_id
      and workspace_key = p_workspace_key
      and created_by = p_actor_user_id
      and revoked_at is null
    for update;
  if not found then raise exception 'api_key_not_found'; end if;
  update public.foundation_api_keys set revoked_at = pg_catalog.clock_timestamp()
    where key_id = p_key_id;
  insert into public.foundation_developer_audit_events (
    workspace_key, action, target_id, actor_user_id, actor_key_id, details
  ) values (p_workspace_key, 'api_key_revoked', p_key_id::text, p_actor_user_id, null, '{}'::jsonb);
  return true;
end;
$$;

drop function if exists public.rotate_foundation_api_key(text, uuid, text, text, text, text[], timestamptz, uuid);
create function public.rotate_foundation_api_key(
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
    or v_old.authorization_revision is distinct from p_authorization_revision then
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

create or replace function public.consume_foundation_oauth_authorization(
  p_state_sha256 text,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.foundation_oauth_authorizations%rowtype;
  v_membership public.foundation_workspace_members%rowtype;
begin
  delete from public.foundation_oauth_authorizations
    where expires_at < pg_catalog.clock_timestamp() - interval '1 day';
  select * into v_authorization
    from public.foundation_oauth_authorizations
    where state_sha256 = p_state_sha256
    for update;
  if not found
    or v_authorization.provider is distinct from p_provider
    or v_authorization.consumed_at is not null
    or v_authorization.expires_at <= pg_catalog.clock_timestamp()
    or v_authorization.authorization_revision is null then
    raise exception 'oauth_authorization_invalid';
  end if;

  select * into v_membership
    from public.foundation_workspace_members
    where workspace_key = v_authorization.workspace_key
      and user_id = v_authorization.created_by
    for update;
  if not found
    or v_membership.state <> 'active'
    or v_membership.authorization_revision <> v_authorization.authorization_revision then
    raise exception 'oauth_authorization_changed';
  end if;

  update public.foundation_oauth_authorizations
    set consumed_at = pg_catalog.clock_timestamp()
    where authorization_id = v_authorization.authorization_id;
  return pg_catalog.jsonb_build_object(
    'authorizationId', v_authorization.authorization_id,
    'workspaceKey', v_authorization.workspace_key,
    'userId', v_authorization.created_by,
    'authorizationRevision', v_authorization.authorization_revision,
    'displayName', v_authorization.display_name,
    'pkceVerifierReference', v_authorization.pkce_verifier_reference,
    'redirectUri', v_authorization.redirect_uri,
    'requestedScopes', v_authorization.requested_scopes
  );
end;
$$;

create or replace function public.create_foundation_oauth_connection_authorized(
  p_workspace_key text,
  p_actor_user_id uuid,
  p_authorization_revision bigint,
  p_provider text,
  p_display_name text,
  p_provider_account_id text,
  p_provider_account_label text,
  p_granted_scopes text[],
  p_client_secret_reference text,
  p_refresh_token_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.foundation_workspace_members%rowtype;
  v_connection public.foundation_oauth_connections%rowtype;
begin
  select * into v_membership
    from public.foundation_workspace_members
    where workspace_key = p_workspace_key and user_id = p_actor_user_id
    for update;
  if not found
    or v_membership.state <> 'active'
    or v_membership.authorization_revision <> p_authorization_revision then
    raise exception 'oauth_authorization_changed';
  end if;

  insert into public.foundation_oauth_connections (
    workspace_key, provider, display_name, provider_account_id, provider_account_label,
    granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by
  ) values (
    p_workspace_key, p_provider, p_display_name, p_provider_account_id, p_provider_account_label,
    p_granted_scopes, p_client_secret_reference, p_refresh_token_reference,
    p_actor_user_id, p_actor_user_id
  ) returning * into v_connection;

  insert into public.foundation_developer_audit_events (
    workspace_key, action, target_id, actor_user_id, actor_key_id, details
  ) values (
    p_workspace_key, 'oauth_connection_created', v_connection.oauth_connection_id::text,
    p_actor_user_id, null, pg_catalog.jsonb_build_object('provider', p_provider)
  );
  return pg_catalog.to_jsonb(v_connection);
end;
$$;

revoke all on function public.consume_foundation_oauth_authorization(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_foundation_oauth_authorization(text, text)
  to service_role;
revoke all on function public.create_foundation_oauth_connection_authorized(
  text, uuid, bigint, text, text, text, text, text[], text, text
) from public, anon, authenticated;
grant execute on function public.create_foundation_oauth_connection_authorized(
  text, uuid, bigint, text, text, text, text, text[], text, text
) to service_role;
revoke all on function public.create_foundation_api_key_authorized(
  text, text, text, text, text[], timestamptz, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.create_foundation_api_key_authorized(
  text, text, text, text, text[], timestamptz, uuid, bigint
) to service_role;
revoke all on function public.revoke_foundation_api_key_authorized(text, uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.revoke_foundation_api_key_authorized(text, uuid, uuid, bigint)
  to service_role;
revoke all on function public.rotate_foundation_api_key(
  text, uuid, text, text, text, text[], timestamptz, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.rotate_foundation_api_key(
  text, uuid, text, text, text, text[], timestamptz, uuid, bigint
) to service_role;

commit;
