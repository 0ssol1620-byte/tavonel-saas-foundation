-- Rollback for migration 20261117130100_agent_grants_read (WO-AN-3).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117130100 was
-- applied, AFTER the site is reverted to a build that calls neither read function. Run it before the
-- rollback of 20261117130000 (reverse chain order).
--
--   1. Drops read_foundation_agent_grant and list_foundation_agent_grants.
--   2. Restores revoke_all_foundation_agent_grants with the 20261117130000 body (no audit rows).
--
-- Nothing to refuse: the migration added no column, constraint or table, and the audit rows the kill
-- switch wrote are ordinary api_key_revoked rows the previous schema already allows. They are kept.
--
-- Recording it: after it commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117130100';
-- in the same session, and writes the version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

drop function public.read_foundation_agent_grant(text, uuid, uuid);
drop function public.list_foundation_agent_grants(text, uuid, integer);

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
      where token_kind = 'agent' and revoked_at is null returning workspace_key, 'keys'::text as kind
  ), p as (
    update public.world_change_proposals set state = 'withdrawn', decided_at = pg_catalog.clock_timestamp(), decided_by = null
      where principal_kind = 'agent' and state = 'proposed' returning workspace_key, 'proposals'::text as kind
  ), changed as (
    select * from g union all select * from k union all select * from p
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

revoke all on function public.revoke_all_foundation_agent_grants() from public, anon, authenticated, service_role;
grant execute on function public.revoke_all_foundation_agent_grants() to service_role;

commit;
