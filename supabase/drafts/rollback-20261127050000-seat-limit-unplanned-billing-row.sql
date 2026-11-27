-- Rollback for migration 20261127050000_seat_limit_unplanned_billing_row (WO-SEAT-RACE-1).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261127050000 was
-- applied. It undoes exactly that change and refuses to run over anything else, including itself:
-- a second run finds the restored body, not the one it guards on, and stops.
--
--   1. Asserts public.foundation_workspace_seat_limit(text,jsonb) is the body 20261127050000 installed:
--      md5 of pg_get_functiondef with carriage returns removed, 51c3406f193fbc97b6706abf40310c1f
--      (measured on a local PG 17.2 cluster; the hosted rehearsal confirms it).
--   2. Restores the body 20261127020000 installed, with `create or replace`, which keeps owner and grants.
--      The migration redefinition guard's hash of that body is
--        f86f04d897b2d346e9e85a4ffe9cfe8128aac1f5553989c4897e450d96fa4ec4
--      (the predecessor-hash 20261127050000 carries); the migration's own hash is
--        cc413dac04ba485b8736100aa929ddf4c7243e506c451a3e4ca98e12fe66ebef.
--   3. Asserts the restored body is byte-for-byte the earlier one: md5 d97f33beed972c79df0bb71f5d746538
--      (measured the same way, on the same cluster).
--
-- What the rollback brings back: a workspace whose billing account holds no plan level (the
-- transaction.completed allowance landed before its subscription event, or that event never projected)
-- is uncapped again, so a new Personal buyer can invite members. Members and invitations written
-- while the cap was in force are not touched (the migration wrote no row).
--
-- Recording it: this file does not edit supabase_migrations.schema_migrations. After it commits, the
-- operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261127050000';
-- in the same session, and writes the version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
begin
  if to_regprocedure('public.foundation_workspace_seat_limit(text,jsonb)') is null
    or md5(replace(pg_get_functiondef(to_regprocedure('public.foundation_workspace_seat_limit(text,jsonb)')), E'\r', ''))
      <> '51c3406f193fbc97b6706abf40310c1f' then
    raise exception 'rollback-20261127050000 refused: public.foundation_workspace_seat_limit is not the function 20261127050000 installed';
  end if;
end
$guard$;

create or replace function public.foundation_workspace_seat_limit(p_workspace_key text, p_seat_limits jsonb)
returns integer
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_limit jsonb;
begin
  v_plan := public.foundation_workspace_capped_plan(p_workspace_key);
  if v_plan is null then
    -- A billing account that does not cap (a legacy plan, or its user holds an operator grant): uncapped, as before.
    if exists (select 1 from public.foundation_billing_accounts a where a.workspace_key = p_workspace_key) then
      return null;
    end if;
    -- No billing account. An operator-granted owner (the founder's workspace) stays uncapped, as before.
    if exists (
      select 1 from public.foundation_workspace_members m
        join public.foundation_account_access_grants g on g.user_id = m.user_id and g.active
       where m.workspace_key = p_workspace_key and m.role = 'owner' and m.state = 'active'
    ) then
      return null;
    end if;
    -- A Free workspace: the owner is the one seat.
    return 1;
  end if;
  -- Nested, not one OR: SQL does not promise to skip the cast of a non-number.
  if jsonb_typeof(p_seat_limits) = 'object' and jsonb_typeof(p_seat_limits -> v_plan) = 'number' then
    v_limit := p_seat_limits -> v_plan;
    if v_limit::numeric = trunc(v_limit::numeric) and v_limit::numeric between 1 and 100000 then
      return v_limit::integer;
    end if;
  end if;
  raise exception 'workspace_seat_limit_unavailable';
end;
$$;

do $verify$
begin
  if md5(replace(pg_get_functiondef(to_regprocedure('public.foundation_workspace_seat_limit(text,jsonb)')), E'\r', ''))
    <> 'd97f33beed972c79df0bb71f5d746538' then
    raise exception 'rollback-20261127050000: the restored public.foundation_workspace_seat_limit differs from the 20261127020000 definition';
  end if;
end
$verify$;

commit;
