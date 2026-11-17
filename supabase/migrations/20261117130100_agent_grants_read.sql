-- WO-AN-3 (V34 agent-native v1, workorders/agent-native.md §2.1-§2.5; lead decisions G1, G2 after
-- WO-AN-1's review): the read path for agent grants and an audit trail for the kill switch.
--
-- Ordering: directly after 20261117130000_agent_proposals, in the same serial chain (the lead renames
-- both together if a catalog migration takes an earlier slot). Applied to production with or after
-- 20261117130000 and before any code that calls the two read functions (release stage 1).
--
--   1. read_foundation_agent_grant(workspace, grant id, person): the grant's liveness, or null. An id
--      of another workspace or another person answers exactly like an id that does not exist.
--   2. list_foundation_agent_grants(workspace, person, limit): that person's own grants, live first,
--      newest first. Label, created, revoked, and from the grant's credential its expiry and last use.
--      No key material: no token, no hash, no prefix.
--   3. revoke_all_foundation_agent_grants() writes one api_key_revoked audit row per agent key it
--      revokes, in its own transaction, as revoke_foundation_agent_grant does per key. The operator is
--      no member and holds no key, and the audit table needs exactly one actor
--      (0012: (actor_user_id is null) <> (actor_key_id is null)); the row names the revoked key itself
--      as actor and says killSwitch: true, so it never claims a person did it. A second call revokes
--      nothing and writes nothing.
--
-- foundation_agent_grants keeps deny-all RLS and no table grant: the read path is these functions,
-- never a select. Both reads are stable; every function here is security definer, search_path '',
-- revoked from public, anon, authenticated and service_role, execute granted to service_role only.
-- Reversed by supabase/drafts/rollback-20261117130100-agent-grants-read.sql.
begin;

create function public.read_foundation_agent_grant(p_workspace_key text, p_grant_id uuid, p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
      'grantId', g.grant_id, 'authorizationRevision', g.authorization_revision,
      'createdAt', g.created_at, 'revokedAt', g.revoked_at)
    from public.foundation_agent_grants g
   where g.workspace_key = p_workspace_key and g.grant_id = p_grant_id and g.user_id = p_user_id;
$$;

create function public.list_foundation_agent_grants(p_workspace_key text, p_user_id uuid, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_workspace_key is null or p_user_id is null or p_limit is null or p_limit not between 1 and 101 then
    raise exception 'agent_grant_request_invalid';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'grantId', r.grant_id, 'clientLabel', r.client_label, 'createdAt', r.created_at,
        'expiresAt', r.expires_at, 'revokedAt', r.revoked_at, 'lastUsedAt', r.last_used_at)
        order by (r.revoked_at is null) desc, r.created_at desc, r.grant_id desc)
      from (
        select g.grant_id, g.client_label, g.created_at, g.revoked_at,
               (select pg_catalog.max(k.expires_at) from public.foundation_api_keys k where k.agent_grant_id = g.grant_id) as expires_at,
               (select pg_catalog.max(k.last_used_at) from public.foundation_api_keys k where k.agent_grant_id = g.grant_id) as last_used_at
          from public.foundation_agent_grants g
         where g.workspace_key = p_workspace_key and g.user_id = p_user_id
         order by (g.revoked_at is null) desc, g.created_at desc, g.grant_id desc
         limit p_limit
      ) r), '[]'::jsonb);
end; $$;

-- The 20261117130000 body plus one audit row per revoked key. Same signature, so callers are unchanged.
create or replace function public.revoke_all_foundation_agent_grants()
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '30s' as $$
declare
  v_out jsonb;
begin
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
    'public.read_foundation_agent_grant(text, uuid, uuid)',
    'public.list_foundation_agent_grants(text, uuid, integer)',
    'public.revoke_all_foundation_agent_grants()'
  ] loop
    execute 'revoke all on function ' || v_fn || ' from public, anon, authenticated, service_role';
    execute 'grant execute on function ' || v_fn || ' to service_role';
  end loop;
end $$;

commit;
