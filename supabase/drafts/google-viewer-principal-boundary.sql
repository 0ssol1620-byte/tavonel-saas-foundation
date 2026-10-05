-- Draft only. Do not register or apply until the disposable pgTAP suite passes.
-- Extends 0013, 0018, 20260920121000 and 20260927101000.
begin;

alter table public.foundation_oauth_authorizations
  add column authorization_purpose text not null default 'connector_connection'
    check (authorization_purpose in ('connector_connection', 'viewer_acl_link'));
alter table public.source_acl_snapshots
  add column capture_complete boolean not null default true;

create table public.foundation_provider_principal_links (
  link_id uuid primary key default gen_random_uuid(),
  workspace_key text not null references public.foundation_workspaces(workspace_key) on delete cascade,
  foundation_user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null check (provider = 'google_drive'),
  principal_kind text not null default 'user' check (principal_kind = 'user'),
  principal_id text not null check (char_length(principal_id) between 1 and 512 and principal_id !~ '[[:cntrl:]]'),
  authorization_id uuid not null unique references public.foundation_oauth_authorizations(authorization_id) on delete restrict,
  authorization_revision bigint not null check (authorization_revision > 0),
  verified_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (revoked_at is null or revoked_at >= verified_at)
);
create unique index foundation_provider_principal_links_active_idx
  on public.foundation_provider_principal_links(workspace_key, foundation_user_id, provider, principal_kind, principal_id)
  where revoked_at is null;
create index foundation_provider_principal_links_viewer_idx
  on public.foundation_provider_principal_links(workspace_key, foundation_user_id, provider, verified_at desc)
  where revoked_at is null;
alter table public.foundation_provider_principal_links enable row level security;
revoke all on public.foundation_provider_principal_links from public, anon, authenticated;
grant select, insert, update on public.foundation_provider_principal_links to service_role;
create policy foundation_provider_principal_links_no_client_access
  on public.foundation_provider_principal_links as restrictive for all to anon, authenticated
  using (false) with check (false);

-- Keep PKCE state one-time and bind its purpose, workspace member, user, and authority revision.
create or replace function public.consume_foundation_oauth_authorization(
  p_state_sha256 text, p_provider text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_auth public.foundation_oauth_authorizations%rowtype;
  v_member public.foundation_workspace_members%rowtype;
begin
  select * into v_auth from public.foundation_oauth_authorizations
    where state_sha256 = p_state_sha256 for update;
  if not found or v_auth.provider is distinct from p_provider or v_auth.consumed_at is not null
     or v_auth.expires_at <= pg_catalog.clock_timestamp() or v_auth.authorization_revision is null then
    raise exception 'oauth_authorization_invalid';
  end if;
  select * into v_member from public.foundation_workspace_members
    where workspace_key = v_auth.workspace_key and user_id = v_auth.created_by for update;
  if not found or v_member.state <> 'active'
     or v_member.authorization_revision <> v_auth.authorization_revision then
    raise exception 'oauth_authorization_changed';
  end if;
  update public.foundation_oauth_authorizations set consumed_at = pg_catalog.clock_timestamp()
    where authorization_id = v_auth.authorization_id;
  return pg_catalog.jsonb_build_object(
    'authorizationId', v_auth.authorization_id, 'workspaceKey', v_auth.workspace_key,
    'userId', v_auth.created_by, 'authorizationRevision', v_auth.authorization_revision,
    'authorizationPurpose', v_auth.authorization_purpose, 'displayName', v_auth.display_name,
    'pkceVerifierReference', v_auth.pkce_verifier_reference, 'redirectUri', v_auth.redirect_uri,
    'requestedScopes', v_auth.requested_scopes
  );
end;
$$;
revoke all on function public.consume_foundation_oauth_authorization(text, text) from public, anon, authenticated;
grant execute on function public.consume_foundation_oauth_authorization(text, text) to service_role;

create or replace function public.record_google_drive_viewer_principal(
  p_authorization_id uuid, p_permission_id text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_auth public.foundation_oauth_authorizations%rowtype;
  v_member public.foundation_workspace_members%rowtype;
  v_link_id uuid;
begin
  if p_authorization_id is null or p_permission_id is null
     or char_length(p_permission_id) not between 1 and 512 or p_permission_id ~ '[[:cntrl:]]' then
    raise exception 'provider_principal_input_invalid';
  end if;
  select * into v_auth from public.foundation_oauth_authorizations
    where authorization_id = p_authorization_id for update;
  if not found or v_auth.provider <> 'google_drive' or v_auth.authorization_purpose <> 'viewer_acl_link'
     or v_auth.consumed_at is null or v_auth.requested_scopes <> array['https://www.googleapis.com/auth/drive.metadata.readonly']::text[]
     or v_auth.authorization_revision is null then
    raise exception 'provider_principal_authorization_invalid';
  end if;
  select * into v_member from public.foundation_workspace_members
    where workspace_key = v_auth.workspace_key and user_id = v_auth.created_by for update;
  if not found or v_member.state <> 'active'
     or v_member.authorization_revision <> v_auth.authorization_revision then
    raise exception 'provider_principal_authorization_changed';
  end if;
  update public.foundation_provider_principal_links set revoked_at = pg_catalog.clock_timestamp()
    where workspace_key = v_auth.workspace_key and foundation_user_id = v_auth.created_by
      and provider = 'google_drive' and principal_id = p_permission_id and revoked_at is null;
  insert into public.foundation_provider_principal_links(
    workspace_key, foundation_user_id, provider, principal_kind, principal_id,
    authorization_id, authorization_revision, verified_at
  ) values (
    v_auth.workspace_key, v_auth.created_by, 'google_drive', 'user', p_permission_id,
    v_auth.authorization_id, v_auth.authorization_revision, pg_catalog.clock_timestamp()
  ) returning link_id into v_link_id;
  return v_link_id;
end;
$$;
revoke all on function public.record_google_drive_viewer_principal(uuid, text) from public, anon, authenticated;
grant execute on function public.record_google_drive_viewer_principal(uuid, text) to service_role;

create or replace function public.revoke_google_drive_viewer_principals(
  p_workspace_key text, p_actor_user_id uuid, p_authorization_revision bigint
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.foundation_workspace_members%rowtype;
  v_count integer;
begin
  select * into v_member from public.foundation_workspace_members
    where workspace_key = p_workspace_key and user_id = p_actor_user_id for update;
  if not found or v_member.state <> 'active'
     or v_member.authorization_revision <> p_authorization_revision then
    raise exception 'provider_principal_authorization_changed';
  end if;
  update public.foundation_provider_principal_links set revoked_at = pg_catalog.clock_timestamp()
    where workspace_key = p_workspace_key and foundation_user_id = p_actor_user_id
      and provider = 'google_drive' and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.revoke_google_drive_viewer_principals(text, uuid, bigint) from public, anon, authenticated;
grant execute on function public.revoke_google_drive_viewer_principals(text, uuid, bigint) to service_role;

-- Only a fully paginated provider capture reaches this writer. Scope it to the exact bound
-- workspace, connection, source version, and direct user principals.
create or replace function public.record_google_drive_source_acl_snapshot(
  p_workspace_key text, p_connection_id uuid, p_source_version_id text,
  p_principals jsonb, p_snapshot_sha256 text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_connection_id is null or p_source_version_id is null or p_source_version_id !~ '^sv-[a-f0-9]{64}$'
     or p_snapshot_sha256 is null or p_snapshot_sha256 !~ '^sha256:[a-f0-9]{64}$'
     or p_principals is null or pg_catalog.jsonb_typeof(p_principals) <> 'array'
     or pg_catalog.jsonb_array_length(p_principals) > 2000
     or pg_catalog.octet_length(p_principals::text) > 262144 then
    raise exception 'source_acl_capture_invalid';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_principals) row_value
    where pg_catalog.jsonb_typeof(row_value) <> 'object'
       or row_value->>'kind' <> 'user'
       or row_value->>'principalId' is null
       or char_length(row_value->>'principalId') not between 1 and 512
       or row_value->>'principalId' ~ '[[:cntrl:]]'
       or row_value->>'permission' not in ('read', 'write', 'owner')
       or (select count(*) from pg_catalog.jsonb_object_keys(row_value)) <> 3
  ) then raise exception 'source_acl_capture_principal_invalid'; end if;
  if not exists (
    select 1 from public.connector_document_bindings b
    join public.foundation_oauth_connections c on c.oauth_connection_id = b.oauth_connection_id
    where b.workspace_key = p_workspace_key and b.oauth_connection_id = p_connection_id
      and b.source_version_id = p_source_version_id and b.provider = 'google_drive'
      and c.workspace_key = b.workspace_key and c.provider = b.provider and c.status = 'active'
  ) then raise exception 'source_acl_capture_binding_invalid'; end if;
  insert into public.source_acl_snapshots(
    source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at, capture_complete
  ) values (
    p_source_version_id, p_workspace_key, 'google_drive', p_principals, p_snapshot_sha256, pg_catalog.clock_timestamp(), true
  );
end;
$$;
revoke all on function public.record_google_drive_source_acl_snapshot(text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_google_drive_source_acl_snapshot(text, uuid, text, jsonb, text) to service_role;

create or replace function public.record_google_drive_source_acl_capture_failure(
  p_workspace_key text, p_connection_id uuid, p_source_version_id text, p_marker_sha256 text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_connection_id is null or p_source_version_id is null or p_source_version_id !~ '^sv-[a-f0-9]{64}$'
     or p_marker_sha256 is null or p_marker_sha256 !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'source_acl_capture_invalid';
  end if;
  if not exists (
    select 1 from public.connector_document_bindings b
    join public.foundation_oauth_connections c on c.oauth_connection_id = b.oauth_connection_id
    where b.workspace_key = p_workspace_key and b.oauth_connection_id = p_connection_id
      and b.source_version_id = p_source_version_id and b.provider = 'google_drive'
      and c.workspace_key = b.workspace_key and c.provider = b.provider and c.status = 'active'
  ) then raise exception 'source_acl_capture_binding_invalid'; end if;
  insert into public.source_acl_snapshots(
    source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at, capture_complete
  ) values (
    p_source_version_id, p_workspace_key, 'google_drive', '[]'::jsonb, p_marker_sha256,
    pg_catalog.clock_timestamp(), false
  );
end;
$$;
revoke all on function public.record_google_drive_source_acl_capture_failure(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_google_drive_source_acl_capture_failure(text, uuid, text, text) to service_role;

-- The server passes an explicit per-request ACL max age (default 300 seconds, bounded to 60..900).
-- Use statement_timestamp as the common authorization-time boundary: it is stable for this statement,
-- but unlike transaction-start now(), it includes evidence written by earlier statements in this transaction.
-- Select the newest evidence before validating time/completeness so a future, expired, or incomplete newest
-- capture cannot be filtered out and replaced by older evidence. Tied newest rows are all evaluated.
create or replace function public.source_version_acl_admits(
  p_workspace_key text, p_source_version_id text, p_provider text, p_viewer_principals jsonb,
  p_max_age_seconds integer
) returns boolean
language sql stable set search_path = '' as $$
  with ranked as (
    select a.principals, a.capture_complete, a.captured_at,
      pg_catalog.rank() over (order by a.captured_at desc) as evidence_rank
    from public.source_acl_snapshots a
    where a.workspace_key = p_workspace_key and a.source_version_id = p_source_version_id
      and a.provider_id = p_provider
  ), latest as (
    select r.principals, r.capture_complete, r.captured_at
    from ranked r where r.evidence_rank = 1
  )
  select coalesce(bool_and(l.capture_complete
    and l.captured_at <= pg_catalog.statement_timestamp()
    and l.captured_at > pg_catalog.statement_timestamp() - pg_catalog.make_interval(secs => p_max_age_seconds::double precision)
    and exists (
      select 1 from pg_catalog.jsonb_array_elements(l.principals) grant_row,
        pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_viewer_principals) = 'array'
          then p_viewer_principals else '[]'::jsonb end) viewer
      where grant_row->>'kind' = viewer->>'kind' and grant_row->>'principalId' = viewer->>'principalId'
        and grant_row->>'permission' in ('read', 'write', 'owner')
  )), false) from latest l;
$$;
revoke all on function public.source_version_acl_admits(text, text, text, jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public.source_version_acl_admits(text, text, text, jsonb, integer) to service_role;

create or replace function public.connector_documents_blocked_for_viewer(
  p_workspace_key text, p_document_ids text[], p_viewer_user_id uuid, p_max_age_seconds integer
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_viewer_principals jsonb;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_document_ids is null or pg_catalog.cardinality(p_document_ids) > 2000
     or pg_catalog.array_position(p_document_ids, null) is not null or p_viewer_user_id is null
     or p_max_age_seconds is null or p_max_age_seconds < 60 or p_max_age_seconds > 900 then
    raise exception 'CONNECTOR_AUTH_SCOPE_INVALID';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', l.principal_kind, 'principalId', l.principal_id)), '[]'::jsonb)
    into v_viewer_principals
    from public.foundation_provider_principal_links l
    join public.foundation_workspace_members m on m.workspace_key = l.workspace_key and m.user_id = l.foundation_user_id
    where l.workspace_key = p_workspace_key and l.foundation_user_id = p_viewer_user_id
      and l.provider = 'google_drive' and l.revoked_at is null
      and l.verified_at <= pg_catalog.statement_timestamp()
      and l.verified_at > pg_catalog.statement_timestamp() - interval '24 hours'
      and m.state = 'active' and m.authorization_revision = l.authorization_revision;
  return exists (
    select 1 from public.connector_document_bindings b
    join public.foundation_oauth_connections c on c.oauth_connection_id = b.oauth_connection_id
    left join public.source_versions sv on sv.source_version_id = b.source_version_id
    left join public.sources s on s.source_id = b.source_id
    where b.workspace_key = p_workspace_key and b.document_id::text = any(p_document_ids)
      and (c.status <> 'active' or c.workspace_key <> b.workspace_key or c.provider <> b.provider
        or exists (select 1 from public.connector_source_suspensions css
          where css.source_id = b.source_id and css.workspace_key = b.workspace_key)
        or sv.tombstoned is true or s.tombstoned_at is not null
        or not public.source_version_acl_admits(b.workspace_key, b.source_version_id, b.provider, v_viewer_principals, p_max_age_seconds))
  );
end;
$$;
revoke all on function public.connector_documents_blocked_for_viewer(text, text[], uuid, integer) from public, anon, authenticated;
grant execute on function public.connector_documents_blocked_for_viewer(text, text[], uuid, integer) to service_role;

commit;
