-- OAuth connector metadata and atomic developer-key rotation.
-- Provider credentials and PKCE verifiers remain in the managed secret broker;
-- this schema stores only opaque references and one-way state digests.
begin;

alter table public.foundation_developer_audit_events
  drop constraint if exists foundation_developer_audit_events_action_check;
alter table public.foundation_developer_audit_events
  add constraint foundation_developer_audit_events_action_check check (action in (
    'api_key_created', 'api_key_revoked', 'api_key_rotated',
    'connection_created', 'connection_updated', 'connection_revoked', 'connection_batch_applied',
    'oauth_authorization_started', 'oauth_connection_created', 'oauth_connection_revoked'
  ));

create table public.foundation_oauth_authorizations (
  authorization_id uuid primary key default gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  provider text not null check (provider in ('google_drive', 'dropbox', 'microsoft_graph')),
  display_name text not null check (char_length(display_name) between 1 and 100),
  state_sha256 text not null unique check (state_sha256 ~ '^[a-f0-9]{64}$'),
  pkce_verifier_reference text not null check (
    pkce_verifier_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]{3,500}$'
  ),
  redirect_uri text not null check (redirect_uri ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/api/v1/oauth-connectors/callback/[a-z_]+$'),
  requested_scopes text[] not null check (cardinality(requested_scopes) between 1 and 20),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index foundation_oauth_authorizations_expiry_idx
  on public.foundation_oauth_authorizations (expires_at) where consumed_at is null;

create table public.foundation_oauth_connections (
  oauth_connection_id uuid primary key default gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  provider text not null check (provider in ('google_drive', 'dropbox', 'microsoft_graph')),
  display_name text not null check (char_length(display_name) between 1 and 100),
  provider_account_id text not null check (char_length(provider_account_id) between 1 and 512),
  provider_account_label text check (provider_account_label is null or char_length(provider_account_label) between 1 and 512),
  granted_scopes text[] not null check (cardinality(granted_scopes) between 1 and 40),
  client_secret_reference text not null check (
    client_secret_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]{3,500}$'
  ),
  refresh_token_reference text not null check (
    refresh_token_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]{3,500}$'
  ),
  status text not null default 'active' check (status in ('active', 'reauthorization_required', 'paused', 'error', 'revoked')),
  cursor_sha256 text check (cursor_sha256 is null or cursor_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  last_sync_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (workspace_key, provider, provider_account_id),
  check ((status = 'revoked') = (revoked_at is not null))
);
create index foundation_oauth_connections_workspace_idx
  on public.foundation_oauth_connections (workspace_key, created_at desc);

alter table public.foundation_oauth_authorizations enable row level security;
alter table public.foundation_oauth_connections enable row level security;
revoke all on public.foundation_oauth_authorizations, public.foundation_oauth_connections
  from public, anon, authenticated;
grant select, insert, update, delete on public.foundation_oauth_authorizations to service_role;
grant select, insert, update on public.foundation_oauth_connections to service_role;

create or replace function public.consume_foundation_oauth_authorization(
  p_state_sha256 text,
  p_provider text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.foundation_oauth_authorizations%rowtype;
begin
  delete from public.foundation_oauth_authorizations
    where expires_at < clock_timestamp() - interval '1 day';
  select * into v_authorization
    from public.foundation_oauth_authorizations
    where state_sha256 = p_state_sha256
    for update;
  if not found
    or v_authorization.provider is distinct from p_provider
    or v_authorization.created_by is distinct from p_user_id
    or v_authorization.consumed_at is not null
    or v_authorization.expires_at <= clock_timestamp() then
    raise exception 'oauth_authorization_invalid';
  end if;
  update public.foundation_oauth_authorizations
    set consumed_at = clock_timestamp()
    where authorization_id = v_authorization.authorization_id;
  return jsonb_build_object(
    'authorizationId', v_authorization.authorization_id,
    'workspaceKey', v_authorization.workspace_key,
    'displayName', v_authorization.display_name,
    'pkceVerifierReference', v_authorization.pkce_verifier_reference,
    'redirectUri', v_authorization.redirect_uri,
    'requestedScopes', v_authorization.requested_scopes
  );
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
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.foundation_api_keys%rowtype;
  v_new public.foundation_api_keys%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_key, 0));
  select * into v_old from public.foundation_api_keys
    where key_id = p_old_key_id and workspace_key = p_workspace_key
    for update;
  if not found or v_old.revoked_at is not null
    or (v_old.expires_at is not null and v_old.expires_at <= clock_timestamp())
    or v_old.created_by is distinct from p_actor_user_id then
    raise exception 'api_key_rotation_source_invalid';
  end if;
  if p_new_name is null or char_length(p_new_name) not between 1 and 80
    or p_new_prefix !~ '^[A-Za-z0-9_-]{12}$'
    or p_new_token_sha256 !~ '^[a-f0-9]{64}$'
    or cardinality(p_new_scopes) not between 1 and 12
    or not (p_new_scopes <@ array[
      'documents:read', 'documents:intake', 'collections:read', 'collections:compile',
      'collections:download', 'worlds:read', 'ask:read',
      'connections:read', 'connections:write', 'connections:sync'
    ]::text[])
    or (p_new_expires_at is not null and p_new_expires_at <= clock_timestamp()) then
    raise exception 'api_key_rotation_contract_invalid';
  end if;

  -- Revoking first keeps rotation available at the active-key cap. Any later
  -- failure rolls the entire transaction back, so the source key stays valid.
  update public.foundation_api_keys set revoked_at = clock_timestamp()
    where key_id = v_old.key_id;
  insert into public.foundation_api_keys (
    workspace_key, name, key_prefix, token_sha256, scopes, created_by, expires_at
  ) values (
    p_workspace_key, p_new_name, p_new_prefix, p_new_token_sha256,
    p_new_scopes, p_actor_user_id, p_new_expires_at
  ) returning * into v_new;
  insert into public.foundation_developer_audit_events (
    workspace_key, action, target_id, actor_user_id, details
  ) values (
    p_workspace_key, 'api_key_rotated', v_new.key_id::text, p_actor_user_id,
    jsonb_build_object('replacesKeyId', v_old.key_id, 'scopes', p_new_scopes)
  );
  return jsonb_build_object(
    'keyId', v_new.key_id,
    'name', v_new.name,
    'keyPrefix', v_new.key_prefix,
    'scopes', v_new.scopes,
    'createdAt', v_new.created_at,
    'expiresAt', v_new.expires_at,
    'replacedKeyId', v_old.key_id
  );
end;
$$;

revoke all on function public.consume_foundation_oauth_authorization(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_foundation_oauth_authorization(text, text, uuid)
  to service_role;
revoke all on function public.rotate_foundation_api_key(text, uuid, text, text, text, text[], timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.rotate_foundation_api_key(text, uuid, text, text, text, text[], timestamptz, uuid)
  to service_role;

commit;
