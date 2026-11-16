-- Rollback for migration 20261117120000_page_meter_settlement (WO-D27-4, PR #209 renumbered).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117120000 was
-- applied, AFTER the site is reverted to the build whose settle route calls only
-- settle_foundation_compute_v3 (a v4 call after this rollback fails as a retryable 503 and the
-- worker keeps the read queued; it is never settled at a guessed length).
--
--   1. Asserts the live v4 settlement and both compile-job trigger functions are the bodies
--      20261117120000 installed (md5(pg_get_functiondef), read from a local apply of that file;
--      the bodies carry no header comment, so a renumbered file keeps them). Anything else stops
--      here, nothing changed.
--   2. Drops the two triggers on foundation_compile_jobs, the three functions behind them and the
--      v4 settlement, its receipt helper and the unchanged-source index.
--   3. Asserts settle_foundation_compute_v3 is the body the migration left untouched
--      (20260911120000's), so v3 is again the only settlement callee.
--
-- Rows are not touched. The columns 20261117120000 added (metered_pages ... recharged_at) and their
-- check constraints stay: they hold what was metered, reversed and charged again, and dropping
-- them would rewrite every reservation row and lose that record. No balance is re-booked: a
-- reversal or recharge that already ran stands as booked, and v3 never reads those columns.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117120000';
-- in the same session, and writes the version, the time, the md5 values below and who ran it into
-- the campaign ledger. Re-applying the meter later is a new migration version that must expect the
-- kept columns and constraints (`add column if not exists`, constraints guarded by name).
\set ON_ERROR_STOP on
begin;

do $guard$
declare
  v_v4 text;
  v_reverse text;
  v_recharge text;
begin
  select md5(pg_get_functiondef('public.settle_foundation_compute_v4(text, uuid, text, integer, integer, text, text)'::regprocedure))
    into v_v4;
  select md5(pg_get_functiondef('public.reverse_foundation_compute_for_failed_compile()'::regprocedure))
    into v_reverse;
  select md5(pg_get_functiondef('public.recharge_foundation_compute_for_ready_compile()'::regprocedure))
    into v_recharge;
  if v_v4 is distinct from '48ad2f401fcdbe19645260d4c0890a22'
    or v_reverse is distinct from 'c3e920b5f47bbd98860b9439a3ca6213'
    or v_recharge is distinct from 'd6db0fa8769c012878fa4cb81d832d3b' then
    raise exception 'rollback_20261117120000_refused: live bodies % / % / % are not the 20261117120000 bodies',
      v_v4, v_reverse, v_recharge;
  end if;
end;
$guard$;

drop trigger foundation_compile_jobs_recharge_ready_compute on public.foundation_compile_jobs;
drop trigger foundation_compile_jobs_reverse_failed_compute on public.foundation_compile_jobs;
drop function public.recharge_foundation_compute_for_ready_compile();
drop function public.reverse_foundation_compute_for_failed_compile();
drop function public.settle_foundation_compute_v4(text, uuid, text, integer, integer, text, text);
drop function public.foundation_compute_settlement_receipt(public.foundation_compute_reservations, text, integer, integer);
drop index public.foundation_compute_reservations_settled_source_idx;

do $after$
declare v_v3 text;
begin
  select md5(pg_get_functiondef('public.settle_foundation_compute_v3(text, uuid, text, integer, text)'::regprocedure))
    into v_v3;
  if v_v3 is distinct from '964d1d61652ff3c863cdf7b95a53b984' then
    raise exception 'rollback_20261117120000_refused: settle_foundation_compute_v3 md5 % is not the body 20261117120000 left in place', v_v3;
  end if;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'foundation_compile_jobs'
                and t.tgname in ('foundation_compile_jobs_reverse_failed_compute', 'foundation_compile_jobs_recharge_ready_compute')) then
    raise exception 'rollback_20261117120000_refused: a page-meter trigger is still installed';
  end if;
end;
$after$;

commit;
