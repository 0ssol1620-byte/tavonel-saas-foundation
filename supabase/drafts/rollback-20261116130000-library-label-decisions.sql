-- Rollback for migration 20261116130000_library_label_decisions (WO-D23-4).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261116130000 was
-- applied, AFTER the site is reverted to a build that never calls decide_library_label (origin/main
-- dbf52077 does not), and AFTER the rollbacks of 20261116130200 and 20261116130100 (reverse filename
-- order: 3, 2, then this one). Rehearsed by WO-REL-3 on throwaway PostgreSQL 17.2 clusters: apply,
-- refusals, rollback, schema fingerprint back to origin/main's.
--
--   1. Refuses, changing nothing, while public.world_change_proposals exists (20261116130100 not yet
--      rolled back: its library_label executor calls this function). Asserts the live
--      public.decide_library_label is the definition 20261116130000 installed
--      (md5(pg_get_functiondef) = 2402b8bef8b308f494cee9718958a585, read from a local apply of the
--      migration; md5 of its prosrc alone is 3d171b1279e81557c20f7458b373034e). Anything else, a
--      missing function included, stops here, nothing changed.
--   2. Drops public.decide_library_label(text, uuid, text, text, text, text, uuid, text). The
--      migration's `revoke all ... from public, anon, authenticated, service_role` and
--      `grant execute ... to service_role` were ACL entries on that function; they go with it.
--   3. Asserts the function no longer exists, which is the origin/main state (no earlier migration
--      on origin/main defines it: `git grep decide_library_label origin/main -- supabase/` is empty).
--
-- Statements in the migration: 3 (create function, revoke, grant). Reversed here: 3.
--
-- DATA LOSS ON ROLLBACK: none. The migration created no table and altered none. The rows the
-- function wrote are ordinary public.document_labels rows (method 'person', method_version
-- 'person:v1' or 'person-undo:v1') that the table's constraints from 20261107100000 already allow.
-- They are kept: this file deletes no row.
--
-- READ-MODEL CAVEAT (not caused by this file, caused by the site revert): the origin/main reader
-- (nextjs/lib/library-shadow.ts toLibraryDocuments at dbf52077) does not know Undo rows or
-- "newest decision wins". It takes the first `confirmed` doc_type row it finds, shows every
-- `confirmed` topic, and an Undo row (method_version 'person-undo:v1') carries the withdrawn
-- decision's disposition, so the old build reads an Undo as one more decision. A label a person
-- confirmed and then undid shows as confirmed on the reverted site. This holds from the moment
-- the site is reverted, whether or not this file runs; removing the rows would be data loss and
-- is a lead decision with a backup first, never part of this rollback. Count them before the site
-- revert with:
--   select method_version, disposition, count(*) from public.document_labels
--    where method = 'person' group by 1, 2;
--
-- Dependencies: no later migration of the 16 references decide_library_label in SQL. The
-- application does: the library_label executor of the change-proposal store
-- (nextjs/lib/change-proposals.ts, `run` and `undo`) calls it, so with 20261116130100 still live and
-- this function gone a confirmed proposal fails on execution. That is why this file runs last, and
-- the guard below refuses while the proposal table still exists.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261116130000';
-- in the same session, and writes the version, the time, the md5 above and who ran it into the
-- campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
declare v_md5 text;
begin
  if to_regclass('public.world_change_proposals') is not null then
    raise exception 'rollback_20261116130000_refused: 20261116130100 is still applied; run its rollback first';
  end if;
  select md5(pg_get_functiondef('public.decide_library_label(text, uuid, text, text, text, text, uuid, text)'::regprocedure))
    into v_md5;
  if v_md5 is distinct from '2402b8bef8b308f494cee9718958a585' then
    raise exception 'rollback_20261116130000_refused: live decide_library_label md5 % is not the 20261116130000 definition', v_md5;
  end if;
end;
$guard$;

-- Reverses, in reverse order: grant execute ... to service_role; revoke all ... from public, anon,
-- authenticated, service_role; create function public.decide_library_label(...).
drop function public.decide_library_label(text, uuid, text, text, text, text, uuid, text);

do $verify$
begin
  if to_regprocedure('public.decide_library_label(text, uuid, text, text, text, text, uuid, text)') is not null
    or exists (select 1 from pg_catalog.pg_proc where proname = 'decide_library_label'
                and pronamespace = 'public'::regnamespace) then
    raise exception 'rollback_20261116130000_mismatch: decide_library_label still exists';
  end if;
end;
$verify$;

commit;
