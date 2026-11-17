-- Rollback for migration 20261117140100_catalog_v2_plan_code_guards (WO-CAT-3B).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117140100 was
-- applied, and before the rollback of 20261117140000 (reverse chain order). The site needs no revert
-- first: it calls only apply_foundation_billing_event_v6, and its resolver refuses the null-level row
-- on its own.
--
--   1. Restores foundation_billing_accounts_plan_code_check with the 20261117140000 expression (which
--      passes a plan_code whose access_plan is null). It only widens, so it cannot fail on any row.
--   2. Grants EXECUTE on apply_foundation_billing_event_v3 to service_role again, as 0011 did.
--
-- Afterwards the catalog fingerprint (scripts/db/catalog-fingerprints.sql) equals the one of the chain
-- ending at 20261117140000.
--
-- Nothing to refuse: the migration added no table, column or row, and the restored check is weaker.
--
-- Recording it: after it commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117140100';
-- in the same session, and writes the version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

alter table public.foundation_billing_accounts
  drop constraint foundation_billing_accounts_plan_code_check,
  add constraint foundation_billing_accounts_plan_code_check check (
    plan_code is null
    or (public.foundation_offer_access_plan(plan_code) <> plan_code
      and public.foundation_offer_access_plan(plan_code) = access_plan)
  );

grant execute on function public.apply_foundation_billing_event_v3(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) to service_role;

commit;
