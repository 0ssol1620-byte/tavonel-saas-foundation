-- Rollback for migration 20261127100000_product_measurement (WO-AN-RUM-1). The timestamp is
-- provisional, like the migration's: the lead renames both at merge.
--
-- Not a migration: run by hand, as one transaction, against the database where the migration was
-- applied. The ordinary rollback of product measurement and field vitals is NOT this file: it is
-- unsetting NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED and redeploying, which stops every write (the
-- routes answer 404, the record calls are skipped) and keeps the rows. Run this only after the site
-- is on a build that calls none of the six functions.
--
-- It refuses, and changes nothing, while any of the four tables holds a row: the consents are
-- people's recorded choices and the counters are the U19/D26 measurement window, so dropping them is
-- a destructive action that needs a recorded backup first. The operator exports them, records the
-- backup in the campaign ledger, deletes them, and only then runs this file.
--
-- A missing object stops the rollback (no `if exists`). Afterwards the catalog fingerprint
-- (nextjs/scripts/db/catalog-fingerprints.sql) equals the one of the chain ending before this migration.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator deletes the migration's version row in the same session and writes the
-- version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if exists (select 1 from public.foundation_product_measurement_consents)
     or exists (select 1 from public.foundation_product_milestones)
     or exists (select 1 from public.foundation_product_active_days)
     or exists (select 1 from public.foundation_field_vitals_daily) then
    raise exception 'rollback_refused_product_measurement_rows_exist';
  end if;
end;
$$;

drop function public.field_vitals_summary(date, date);
drop function public.product_measurement_summary(timestamptz);
drop function public.record_field_vitals(text, smallint, smallint, smallint);
drop function public.record_product_measurement(uuid, text[]);
drop function public.read_product_measurement_consent(uuid);
drop function public.set_product_measurement_consent(uuid, boolean, text, text, text);
drop table public.foundation_field_vitals_daily;
drop table public.foundation_product_active_days;
drop table public.foundation_product_milestones;
drop table public.foundation_product_measurement_consents;

commit;
