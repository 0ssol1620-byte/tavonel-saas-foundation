-- WO-AN-7 (V34 agent-native v1, workorders/agent-native.md §2.5, §16): the kill switch serialises with grant
-- creation.
--
-- Ordering: directly after 20261117130100_agent_grants_read, in the same serial chain (the lead renames the
-- three agent migrations together if a catalog migration takes an earlier slot). Applied to production with or
-- after 20261117130100; no caller changes, both signatures stay.
--
-- The defect: revoke_all_foundation_agent_grants took no lock that create_foundation_agent_grant also took.
-- Under READ COMMITTED each statement of revoke-all sees what had committed when that statement began, so a
-- grant whose creation committed after revoke-all's last statement began and before revoke-all committed was
-- never seen and stayed live after the kill switch returned.
--
-- The fix: one transaction-scoped advisory lock on a constant key,
-- hashtextextended('foundation_agent_grants:kill_switch', 0). Grant creation takes it SHARED (creations do not
-- wait for one another); revoke-all takes it EXCLUSIVE. Each takes it as its first lock, before anything else.
--
-- Semantics, exactly:
--   * When revoke-all commits, every grant whose creation committed before that commit is revoked, with its
--     credential. Proof: a creation holds the shared lock until it commits, so a creation that committed
--     before revoke-all's commit committed before revoke-all obtained the exclusive lock (none can commit
--     while revoke-all holds it), and every statement revoke-all runs after obtaining the lock sees it.
--   * A creation that commits after revoke-all's commit (it waited on the lock, or started later) is a new
--     grant made by a signed-in person, and it is live. The lock does not forbid new grants; the flag
--     (TAVONEL_AGENT_PROPOSALS_ENABLED unset: POST /api/agent-grants answers 404) does. Revoke-all stays
--     irreversible for every grant it saw; it is not a standing ban.
--   * Revoke-all waits for every creation already holding the lock (bounded by revoke-all's own 30 s
--     statement timeout: a creation that never finishes makes revoke-all fail loudly, it never returns with
--     a grant missed). A creation queued behind a waiting revoke-all waits for it (PostgreSQL grants a new
--     shared request behind a queued exclusive one only after it).
--
-- Lock order, extended (the 20261117130000 header gives the rest):
--   kill-switch advisory lock -> proposal-key advisory lock -> grant row -> membership row -> open-cap
--   advisory lock -> proposal row.
-- create_foundation_agent_grant: kill-switch (shared) -> workspace advisory lock -> membership row.
-- revoke_all_foundation_agent_grants: kill-switch (exclusive) -> grant rows -> key rows -> proposal rows.
-- Why it cannot deadlock: only these two functions take the kill-switch lock, and each takes it while
-- holding no other lock (it is the first statement after input validation; each is called as its own
-- PostgREST transaction). A session waiting for it therefore holds nothing anyone else waits for. decide,
-- revoke_foundation_agent_grant and create_world_change_proposal never take it, so they never wait on it;
-- revoke-all, once it holds it, waits on their grant and proposal rows exactly as before and they finish
-- without needing anything revoke-all holds.
--
-- Bodies are the 20261117130000 create body and the 20261117130100 revoke-all body with one `perform` each.
-- Both stay security definer, search_path '', revoked from public, anon, authenticated and service_role,
-- execute granted to service_role only. Reversed by supabase/drafts/rollback-20261117130200-agent-grant-kill-serial.sql.
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
