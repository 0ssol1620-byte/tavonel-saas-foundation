-- Rollback for migration 20261117150000_knowledge_query_units (WO-CAT-4).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117150000 was
-- applied, AFTER the site is reverted to a build that calls neither meter function (a build that
-- still calls them answers every Ask and search with 503 once they are gone).
--
--   1. Drops admit_foundation_knowledge_query and settle_foundation_knowledge_query.
--   2. Drops foundation_knowledge_query_holds and foundation_knowledge_query_windows.
--
-- What is lost, stated rather than hidden: the month's counted units per workspace. Nothing else
-- reads them (no bill, no ledger row is derived from them), and re-applying the migration starts
-- every workspace at zero for the rest of the month.
--
-- Recording it: after it commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117150000';
-- in the same session, and writes the version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

drop function public.admit_foundation_knowledge_query(text, integer);
drop function public.settle_foundation_knowledge_query(uuid, boolean);
drop table public.foundation_knowledge_query_holds;
drop table public.foundation_knowledge_query_windows;

commit;
