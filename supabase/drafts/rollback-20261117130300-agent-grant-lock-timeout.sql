-- Rollback for migration 20261117130300_agent_grant_lock_timeout (WO-AN-7B).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117130300 was
-- applied. The site needs no revert first: nextjs/lib/agent-grants.ts maps only the token
-- agent_grant_lock_timeout, which the restored bodies never raise; both signatures are unchanged.
-- Run it before the rollback of 20261117130200 (reverse chain order).
--
--   1. Restores create_foundation_agent_grant with the 20261117130200 body (kill-switch lock on the hashed key,
--      function-level statement_timeout 3s, no lock_timeout).
--   2. Restores revoke_all_foundation_agent_grants with the 20261117130200 body (same key, statement_timeout 30s,
--      no lock_timeout).
--
-- Afterwards the catalog fingerprint (scripts/db/catalog-fingerprints.sql) equals the one of the chain ending
-- at 20261117130200. The waits are unbounded again: a revoke-all behind an open creation, and a creation behind
-- a revoke-all, wait for as long as the holder's transaction stays open (the statement_timeout clauses do not
-- bound the calling statement; see the 20261117130300 header).
--
-- Nothing to refuse: the migration added no table, column, constraint or row.
--
-- Recording it: after it commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117130300';
-- in the same session, and writes the version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

create or replace function public.create_foundation_agent_grant(
  p_workspace_key text, p_actor_user_id uuid, p_authorization_revision bigint, p_client_label text,
  p_grantor_email text, p_key_prefix text, p_token_sha256 text, p_scopes text[], p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_membership public.foundation_workspace_members%rowtype;
  v_grant public.foundation_agent_grants%rowtype;
  v_key public.foundation_api_keys%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_actor_user_id is null or p_authorization_revision is null
    or p_scopes is null or p_expires_at is null or p_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'agent_grant_request_invalid';
  end if;

  -- First lock, shared: a concurrent revoke-all (exclusive) either sees this grant or runs before it exists.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('foundation_agent_grants:kill_switch', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_key, 0));
  select * into v_membership from public.foundation_workspace_members
    where workspace_key = p_workspace_key and user_id = p_actor_user_id
    for update;
  if not found or v_membership.state <> 'active'
    or v_membership.authorization_revision <> p_authorization_revision then
    raise exception 'api_key_authorization_changed';
  end if;

  insert into public.foundation_agent_grants (workspace_key, user_id, client_label, grantor_email, authorization_revision)
    values (p_workspace_key, p_actor_user_id, p_client_label, p_grantor_email, p_authorization_revision)
    returning * into v_grant;
  insert into public.foundation_api_keys (
    workspace_key, name, key_prefix, token_sha256, scopes, created_by,
    expires_at, authorization_revision, token_kind, agent_grant_id
  ) values (
    p_workspace_key, 'Agent access', p_key_prefix, p_token_sha256, p_scopes, p_actor_user_id,
    p_expires_at, p_authorization_revision, 'agent', v_grant.grant_id
  ) returning * into v_key;
  insert into public.foundation_developer_audit_events (
    workspace_key, action, target_id, actor_user_id, actor_key_id, details
  ) values (
    p_workspace_key, 'api_key_created', v_key.key_id::text, p_actor_user_id, null,
    pg_catalog.jsonb_build_object('tokenKind', 'agent', 'grantId', v_grant.grant_id, 'scopes', p_scopes,
      'authorizationRevision', p_authorization_revision)
  );
  return pg_catalog.jsonb_build_object('grantId', v_grant.grant_id, 'keyId', v_key.key_id, 'keyPrefix', v_key.key_prefix,
    'scopes', v_key.scopes, 'createdAt', v_key.created_at, 'expiresAt', v_key.expires_at);
end; $$;

create or replace function public.revoke_all_foundation_agent_grants()
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '30s' as $$
declare
  v_out jsonb;
begin
  -- First lock, exclusive: waits for every grant creation in flight to commit, and holds off new ones until
  -- this transaction commits, so every statement below sees every grant whose creation committed before it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation_agent_grants:kill_switch', 0));
  -- Grants first (the lock order every other function uses), then keys, then proposals.
  perform 1 from public.foundation_agent_grants where revoked_at is null for update;
  with g as (
    update public.foundation_agent_grants set revoked_at = pg_catalog.clock_timestamp()
      where revoked_at is null returning workspace_key, 'grants'::text as kind
  ), k as (
    update public.foundation_api_keys set revoked_at = pg_catalog.clock_timestamp()
      where token_kind = 'agent' and revoked_at is null returning key_id, workspace_key, agent_grant_id
  ), audit as (
    insert into public.foundation_developer_audit_events (workspace_key, action, target_id, actor_key_id, details)
    select k.workspace_key, 'api_key_revoked', k.key_id::text, k.key_id,
      pg_catalog.jsonb_build_object('tokenKind', 'agent', 'grantId', k.agent_grant_id, 'killSwitch', true)
      from k
    returning workspace_key
  ), p as (
    update public.world_change_proposals set state = 'withdrawn', decided_at = pg_catalog.clock_timestamp(), decided_by = null
      where principal_kind = 'agent' and state = 'proposed' returning workspace_key, 'proposals'::text as kind
  ), changed as (
    select * from g
    union all select a.workspace_key, 'keys'::text from audit a
    union all select * from p
  ), per_kind as (
    select workspace_key, kind, pg_catalog.count(*)::integer as n from changed group by workspace_key, kind
  )
  select pg_catalog.jsonb_build_object(
      'grants', (select pg_catalog.count(*)::integer from changed where kind = 'grants'),
      'keys', (select pg_catalog.count(*)::integer from changed where kind = 'keys'),
      'proposals', (select pg_catalog.count(*)::integer from changed where kind = 'proposals'),
      'byWorkspace', coalesce((select pg_catalog.jsonb_object_agg(w.workspace_key, w.counts)
        from (select workspace_key, pg_catalog.jsonb_object_agg(kind, n) as counts from per_kind group by workspace_key) w),
        '{}'::jsonb))
    into v_out;
  return v_out;
end; $$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.create_foundation_agent_grant(text, uuid, bigint, text, text, text, text, text[], timestamptz)',
    'public.revoke_all_foundation_agent_grants()'
  ] loop
    execute 'revoke all on function ' || v_fn || ' from public, anon, authenticated, service_role';
    execute 'grant execute on function ' || v_fn || ' to service_role';
  end loop;
end $$;

commit;
