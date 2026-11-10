-- Rollback for migration 20261110043000_source_deletion_inventory_resumable.
--
-- Not a migration: run by hand, as one transaction, against the database where 20261110043000 was
-- applied, and only after the site that calls seal_source_deletion_inventory has been rolled back
-- (the earlier site calls attest_source_deletion_inventory directly and never reads the work table).
--
--   1. Patches attest_source_deletion_inventory back to the 512-object bound from its installed
--      definition, and refuses a definition it does not recognise.
--   2. Drops the four digest functions and the digest work table. The table holds per-object
--      digests of deletions not yet attested and nothing else: an attestation already recorded is
--      untouched, and a deletion in progress is hashed again from the start by the earlier worker
--      (which refuses it again if it is past 512 objects or 1 GiB -- the bound this migration lifted).
--
-- Recording it: this file does not edit supabase_migrations.schema_migrations. After it commits, the
-- operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261110043000';
-- in the same session and records the version, the time and who ran it in the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $restore$
declare
  v_definition text;
  v_new_bound text := 'pg_catalog.jsonb_array_length(p_objects) > 16384';
  v_old_bound text := 'pg_catalog.jsonb_array_length(p_objects) > 512';
begin
  v_definition := pg_get_functiondef(
    'public.attest_source_deletion_inventory(text,jsonb,jsonb)'::regprocedure
  );
  if position(v_new_bound in v_definition) = 0 or position(v_old_bound in v_definition) > 0 then
    raise exception 'rollback_20261110043000_refused: attest_source_deletion_inventory is not the 20261110043000 body';
  end if;
  execute replace(v_definition, v_new_bound, v_old_bound);
end;
$restore$;

drop function public.seal_source_deletion_inventory(text, text, jsonb);
drop function public.discard_source_deletion_inventory_digests(text);
drop function public.read_source_deletion_inventory_digests(text);
drop function public.record_source_deletion_inventory_digest(text, text, bigint, text, text);
drop table public.source_deletion_inventory_digests;

commit;
