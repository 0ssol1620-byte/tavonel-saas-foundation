-- Rollback for migration 20261123130000_router_shadow_traces (WO-RTR-2). The timestamp is
-- provisional, like the migration's: the lead renames both at merge.
--
-- Not a migration: run by hand, as one transaction, against the database where the migration was
-- applied. The ordinary rollback of the router shadow is NOT this file: it is unsetting
-- TAVONEL_ROUTER_SHADOW_ENABLED and redeploying (ADR-012 section 5), which stops every write and
-- keeps the rows. Run this only after the site is on a build that no longer calls
-- record_router_shadow_traces; a build that still calls it finds no function, logs
-- ROUTER_SHADOW_MIGRATION_ABSENT and compiles exactly as before.
--
-- It refuses, and changes nothing, while the table holds any row: the rows are append-only
-- evidence for the Phase 6 shadow report (WO-RTR-4), and dropping them is a destructive action
-- that needs a recorded backup first. The operator exports them, records the backup in the
-- campaign ledger, and only then deletes them and runs this file.
--
-- Otherwise it drops the function and the table. A missing object stops the rollback (no
-- `if exists`). Afterwards the catalog fingerprint (nextjs/scripts/db/catalog-fingerprints.sql)
-- equals the one of the chain ending before this migration.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator deletes the migration's version row in the same session and writes the
-- version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if exists (select 1 from public.foundation_router_shadow_traces) then
    raise exception 'rollback_refused_router_shadow_traces_exist';
  end if;
end;
$$;

drop function public.record_router_shadow_traces(text, jsonb);
drop table public.foundation_router_shadow_traces;

commit;
