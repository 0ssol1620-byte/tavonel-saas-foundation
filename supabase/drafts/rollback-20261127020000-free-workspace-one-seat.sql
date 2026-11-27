-- Rollback for migration 20261127020000_free_workspace_one_seat (WO-SINGLE-USER-2).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261127020000 was
-- applied. It undoes exactly that change and refuses to run over anything else, including itself:
-- a second run finds the restored body, not the one it guards on, and stops.
--
--   1. Asserts public.foundation_workspace_seat_limit(text,jsonb) is the body 20261127020000 installed,
--      by the line only that body carries ("A Free workspace: the owner is the one seat"). An md5 of
--      the new body is not pinned here: it was not measured on a cluster when this draft was written.
--   2. Restores the body 20261117160000 installed, with `create or replace`, which keeps owner and grants.
--      The migration redefinition guard's hash of that body is
--        4c136b6acf354013e2c6b28d562e9f2798766edcbea0983a18374a478f457467
--      (the predecessor-hash 20261127020000 carries); the migration's own hash is
--        f86f04d897b2d346e9e85a4ffe9cfe8128aac1f5553989c4897e450d96fa4ec4.
--   3. Asserts the restored body is byte-for-byte the earlier one: md5 of pg_get_functiondef with carriage
--      returns removed, bb45b809aaf6feaead57de00994560d7, the value rollback-20261117160000 guards on.
--
-- What the rollback brings back: a workspace with no billing account and no operator-granted owner is
-- uncapped again, so a Free owner can invite more than one person. Members and invitations written while
-- the Free cap was in force are not touched (the migration wrote no row).
--
-- Recording it: this file does not edit supabase_migrations.schema_migrations. After it commits, the
-- operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261127020000';
-- in the same session, and writes the version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
begin
  if to_regprocedure('public.foundation_workspace_seat_limit(text,jsonb)') is null
    or position('A Free workspace: the owner is the one seat'
      in pg_get_functiondef(to_regprocedure('public.foundation_workspace_seat_limit(text,jsonb)'))) = 0 then
    raise exception 'rollback-20261127020000 refused: public.foundation_workspace_seat_limit is not the function 20261127020000 installed';
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
  if v_plan is null then return null; end if;
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
    <> 'bb45b809aaf6feaead57de00994560d7' then
    raise exception 'rollback-20261127020000: the restored public.foundation_workspace_seat_limit differs from the 20261117160000 definition';
  end if;
end
$verify$;

commit;
