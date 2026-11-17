-- WO-AN-7B (V34 agent-native v1, workorders/agent-native.md §2.5, §16, §17): the kill switch and grant creation
-- wait a bounded time, and the kill-switch lock leaves the hashed-string advisory namespace.
--
-- Ordering: directly after 20261117130200_agent_grant_kill_serial, in the same serial chain (timestamp named by
-- the work order; the lead renames the agent migrations together if a catalog migration takes an earlier slot).
-- No caller change is needed to apply it: both signatures stay. The application maps the new refusal
-- (nextjs/lib/agent-grants.ts, AGENT_GRANTS_BUSY_RETRY); deployed code that predates that mapping reports it as
-- its existing create/revoke failure (503), which is also true.
--
-- Correction of the 20261117130200 header. It said revoke-all's wait is "bounded by revoke-all's own 30 s
-- statement timeout". That is wrong, measured by WO-AN-7's review: `set statement_timeout` on a function changes
-- the setting when the function is entered, but the timer of the statement already running (the caller's
-- `select public.revoke_all_foundation_agent_grants()`) was armed when that statement began, with the caller's
-- value, and is not re-armed. Revoke-all waited 43 s behind an open creation, and a creation queued behind
-- revoke-all waited without any bound. The same holds for the 3 s statement_timeout of the create function.
-- Both clauses bound nothing, so this migration removes them rather than leave a setting that reads as a bound.
--
-- The fix: `set lock_timeout = '2000ms'` (start value, uncalibrated) on both functions. lock_timeout, unlike
-- statement_timeout, is read each time a lock wait begins, so a function-level setting does bound the waits of
-- the statement that called it. It bounds every lock wait inside the two functions -- the kill-switch advisory
-- wait (the one that can last: behind an open creation, or behind a revoke-all), and the row waits on grants,
-- keys, memberships and proposals, which are held by single-RPC transactions. The bound is per wait, not per
-- call. Each body runs inside one exception block that turns lock_not_available (55P03, whichever wait expired)
-- into one defined refusal, `agent_grant_lock_timeout`, SQLSTATE kept at 55P03. Nothing else is caught.
--
-- No half state: the refusal is raised out of the function, so the caller's transaction is aborted and every
-- write the function made before the expired wait is rolled back with it -- a revoke-all that timed out revoked
-- nothing, wrote no audit row and withdrew no proposal; a creation that timed out made no grant, key or audit row.
-- A timeout is retryable as the same call: it changed nothing, and the holder it waited for ends with its own
-- transaction (the race harness, scenarios BOUNDA and BOUNDB, shows both and the retry succeeding).
--
-- The kill-switch key moves to the two-integer advisory form, pg_advisory_xact_lock(1414942284, 1)
-- (1414942284 = 0x54564E4C, 'TVNL'; 1 = the agent-grant kill switch). A two-integer key is a different lock tag
-- (pg_locks.objsubid = 2) from every one-bigint key (objsubid = 1), so it cannot collide with any
-- hashtextextended(<string>, 0) lock -- the workspace, proposal-key and open-cap locks hash strings that carry
-- caller input. No migration takes a two-integer advisory lock (grep at this commit; the only other two-integer
-- keys in the tree are classes 90300 and 90400 in supabase/drafts/tests/native-world-reduction-commit.sql).
-- Deploy window: a creation that began under the old body holds the old key, which a revoke-all under the new
-- body does not wait for. The window is the creations already in flight when this migration commits (each one
-- RPC long); a revoke-all run after them misses nothing.
--
-- Semantics of 20261117130200 are unchanged otherwise: when revoke-all commits, every grant whose creation
-- committed before that commit is revoked with its credential; a creation that commits after it is a new, live
-- grant (the flag, not the lock, refuses new grants). What changes is that neither side waits past the bound:
-- a revoke-all that cannot get the lock in time fails loudly and revokes nothing; it never returns with a grant
-- missed.
--
-- Lock order and deadlock freedom are those of the 20261117130200 header (kill-switch lock first, taken while
-- holding nothing; only these two functions take it); the key's namespace changes, not its place in the order.
--
-- Both stay security definer, search_path '', revoked from public, anon, authenticated and service_role, execute
-- granted to service_role only. Reversed by supabase/drafts/rollback-20261117130300-agent-grant-lock-timeout.sql.
begin;

create or replace function public.create_foundation_agent_grant(
  p_workspace_key text, p_actor_user_id uuid, p_authorization_revision bigint, p_client_label text,
  p_grantor_email text, p_key_prefix text, p_token_sha256 text, p_scopes text[], p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2000ms' as $$
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

  begin
    -- First lock, shared: a concurrent revoke-all (exclusive) either sees this grant or runs before it exists.
    perform pg_catalog.pg_advisory_xact_lock_shared(1414942284, 1);
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
  exception when lock_not_available then
    raise exception 'agent_grant_lock_timeout' using errcode = 'lock_not_available';
  end;
  return pg_catalog.jsonb_build_object('grantId', v_grant.grant_id, 'keyId', v_key.key_id, 'keyPrefix', v_key.key_prefix,
    'scopes', v_key.scopes, 'createdAt', v_key.created_at, 'expiresAt', v_key.expires_at);
end; $$;

create or replace function public.revoke_all_foundation_agent_grants()
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2000ms' as $$
declare
  v_out jsonb;
begin
  begin
    -- First lock, exclusive: waits for every grant creation in flight to commit, and holds off new ones until
    -- this transaction commits, so every statement below sees every grant whose creation committed before it.
    perform pg_catalog.pg_advisory_xact_lock(1414942284, 1);
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
  exception when lock_not_available then
    raise exception 'agent_grant_lock_timeout' using errcode = 'lock_not_available';
  end;
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
