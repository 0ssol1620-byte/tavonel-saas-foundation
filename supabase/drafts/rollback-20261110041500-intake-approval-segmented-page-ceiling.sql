-- Rollback for migration 20261110041500_intake_approval_segmented_page_ceiling.
--
-- Not a migration: run by hand, as one transaction, against the database where 20261110041500 was
-- applied. It restores the 80-page member bound and the 10,240-page set bound, and refuses to run
-- while any approval row already relies on the wider bound (removing a row is not a rollback).
--
--   1. Refuses if any member has approved_max_pages > 80 or any set has more than 10,240 pages.
--   2. Restores the two CHECKs and drops the segmented-format CHECK.
--   3. Patches create_foundation_intake_approval back from its installed definition, and refuses a
--      definition it does not recognise.
--
-- Recording it: this file does not edit supabase_migrations.schema_migrations. After it commits, the
-- operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261110041500';
-- in the same session and records the version, the time and who ran it in the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
begin
  if exists (select 1 from public.foundation_intake_approval_files where approved_max_pages > 80)
     or exists (select 1 from public.foundation_intake_approvals where aggregate_maximum_pages > 10240) then
    raise exception 'rollback_20261110041500_refused: approvals above the 80-page bound exist';
  end if;
end;
$guard$;

alter table public.foundation_intake_approval_files
  drop constraint foundation_intake_approval_files_segmented_format_check;
alter table public.foundation_intake_approval_files
  drop constraint foundation_intake_approval_files_approved_max_pages_check;
alter table public.foundation_intake_approval_files
  add constraint foundation_intake_approval_files_approved_max_pages_check
  check (approved_max_pages between 1 and 80);
alter table public.foundation_intake_approvals
  drop constraint foundation_intake_approvals_aggregate_maximum_pages_check;
alter table public.foundation_intake_approvals
  add constraint foundation_intake_approvals_aggregate_maximum_pages_check
  check (aggregate_maximum_pages between 1 and 10240);

do $restore$
declare
  v_definition text;
  v_new_bound text := $q$(v_entry->>'approvedMaxPages')::integer not between 1 and 500$q$;
  v_old_bound text := $q$(v_entry->>'approvedMaxPages')::integer not between 1 and 80$q$;
  v_new_unknown text := $q$    if (v_entry->>'approvedMaxPages')::integer > 80 and v_entry->>'mimeType' <> 'application/pdf' then
      raise exception 'foundation_intake_approval_invalid';
    end if;
    if v_entry->>'pageBasis' = 'unknown' and (v_entry->>'approvedMaxPages')::integer <> 80 then$q$;
  v_old_unknown text := $q$    if v_entry->>'pageBasis' = 'unknown' and (v_entry->>'approvedMaxPages')::integer <> 80 then$q$;
begin
  v_definition := pg_get_functiondef(
    'public.create_foundation_intake_approval(text,uuid,text,text,text,integer,jsonb)'::regprocedure
  );
  if position(v_new_bound in v_definition) = 0 or position(v_new_unknown in v_definition) = 0 then
    raise exception 'rollback_20261110041500_refused: create_foundation_intake_approval is not the 20261110041500 body';
  end if;
  execute replace(replace(v_definition, v_new_bound, v_old_bound), v_new_unknown, v_old_unknown);
end;
$restore$;

commit;
