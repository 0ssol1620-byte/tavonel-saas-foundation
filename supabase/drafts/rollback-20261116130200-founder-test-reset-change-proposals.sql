-- Rollback for migration 20261116130200_founder_test_reset_change_proposals.
--
-- Not a migration: run by hand, as one transaction, against the database where 20261116130200 was
-- applied, AFTER the site is reverted, and BEFORE the rollback of 20261116130100 (that one refuses
-- while this one has not run). Rehearsed by WO-REL-3 on throwaway PostgreSQL 17.2 clusters: apply,
-- refusals, rollback, schema fingerprint back to origin/main's.
--
--   1. Asserts the three live reset functions are the definitions 20261116130200 installed
--      (md5(pg_get_functiondef), read from a local apply of the migration; md5 of the prosrc alone in
--      brackets):
--        founder_test_reset_rows_fingerprint b5a54ae369f3b16df94856f5bef7a677 [4e0284d4...]
--        founder_test_reset_table_counts     2672d0430dcb8658a9be9f6654db183d [32e68052...]
--        finalize_founder_test_reset         d636d066dd26c4ca32fb87c6f01f0be5 [99d798ad...]
--      and that the founder_reset_fence trigger exists on public.world_change_proposals. Anything else,
--      a missing function included, stops here, nothing changed.
--   2. Drops that trigger, then restores the three functions with the bodies of
--      20261107100100_founder_test_reset_library_organize.sql as it stands at origin/main (dbf52077,
--      blob 4a2a5350a334e2fd1103e659356664be48d0f228, last changed by cdefeec6). That file is the last
--      definition of all three on origin/main: of the seven origin/main migrations that define them
--      (20260920133000, 20260927105000, 20261002120000, 20261002140000, 20261104091000, 20261105010000,
--      20261107100100) it is the latest, and 20261110040000 does not touch them. The statements below are
--      copied from that blob byte for byte (generated, not retyped). The migration's own header says
--      its bodies are 20261107100100's plus one line each; a diff confirms exactly that (three
--      `world_change_proposals` lines, one comment line inside finalize, and the trigger's table).
--   3. Asserts the restored definitions are origin/main's (md5(pg_get_functiondef), read from a local
--      apply of origin/main's chain; md5 of the prosrc alone in brackets):
--        founder_test_reset_rows_fingerprint 45fc3422c35e92aead6b33adeaeb37b3 [95cec81d...]
--        founder_test_reset_table_counts     fc3fb2738644db53e6c551baae939718 [79426a47...]
--        finalize_founder_test_reset         f410328eab24a873c7fcb3ab37dfb10f [fff21046...]
--      and that no founder_reset_fence trigger is left on world_change_proposals while the one on
--      document_labels (20261107100100's) is still there.
--
-- `create or replace` keeps each function's owner, ACL, language, security mode and
-- `set search_path = ''`, as the migration's did, so no grant needs restoring.
--
-- Statements in the migration: 4 (three create or replace function, one create trigger).
-- Reversed here: 4.
--
-- DATA LOSS ON ROLLBACK: none. No row is read into or deleted by this file. Two consequences, neither
-- a loss:
--   * A founder test reset prepared while 20261116130200 was live sealed a snapshot that counts and
--     fingerprints world_change_proposals; after this rollback the snapshot no longer has that key, so
--     finalize refuses it with founder_test_reset_database_drift and it has to be prepared again (the
--     same thing the migration did to resets prepared before it).
--   * Between this file and the rollback of 20261116130100 the proposal table still exists but is
--     neither fenced nor deleted by a reset. The 20261116130100 rollback refuses unless the table is
--     empty, so run no founder reset in between.
--
-- Dependencies: no later migration of the 16 redefines these three functions or the trigger
-- (`grep -n founder_test_reset supabase/migrations/202611171*` is empty at 8e7a593c). The rollback of
-- 20261116130100 depends on this one.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261116130200';
-- in the same session, and writes the version, the time, the md5 values above and who ran it into
-- the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
declare
  v_fp text;
  v_counts text;
  v_finalize text;
begin
  select md5(pg_get_functiondef('public.founder_test_reset_rows_fingerprint(text, uuid)'::regprocedure))
    into v_fp;
  select md5(pg_get_functiondef('public.founder_test_reset_table_counts(text, uuid)'::regprocedure))
    into v_counts;
  select md5(pg_get_functiondef('public.finalize_founder_test_reset(uuid, text, uuid, text, text)'::regprocedure))
    into v_finalize;
  if v_fp is distinct from 'b5a54ae369f3b16df94856f5bef7a677'
    or v_counts is distinct from '2672d0430dcb8658a9be9f6654db183d'
    or v_finalize is distinct from 'd636d066dd26c4ca32fb87c6f01f0be5' then
    raise exception 'rollback_20261116130200_refused: live definitions % / % / % are not the 20261116130200 definitions',
      v_fp, v_counts, v_finalize;
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
                  where tgname = 'founder_reset_fence' and tgrelid = to_regclass('public.world_change_proposals')
                    and tgfoid = to_regprocedure('public.guard_founder_test_reset_workspace_write()')) then
    raise exception 'rollback_20261116130200_refused: founder_reset_fence is not on public.world_change_proposals';
  end if;
end;
$guard$;

-- Reverses `create trigger founder_reset_fence ... on public.world_change_proposals`. The trigger of
-- the same name on public.document_labels belongs to 20261107100100 and stays.
drop trigger founder_reset_fence on public.world_change_proposals;

-- Reverses `create or replace function public.finalize_founder_test_reset`: the origin/main body
-- (20261107100100), which deletes no world_change_proposals rows.
create or replace function public.finalize_founder_test_reset(
  p_reset_id uuid, p_email text, p_user_id uuid, p_workspace_key text, p_manifest_digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reset public.founder_test_reset_ledger%rowtype; v_legacy uuid; v_snapshot jsonb; v_digest text; v_oauth_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder-test-reset:'||p_workspace_key,0));
  v_legacy:=public.founder_test_reset_assertions(p_email,p_user_id,p_workspace_key);
  select * into v_reset from public.founder_test_reset_ledger where reset_id=p_reset_id for update;
  if not found or v_reset.state<>'sealed' or v_reset.user_id<>p_user_id
     or v_reset.workspace_key<>p_workspace_key or v_reset.manifest_digest<>p_manifest_digest then
    raise exception 'founder_test_reset_seal_mismatch';
  end if;
  v_snapshot:=public.founder_test_reset_snapshot(p_workspace_key,v_legacy);
  v_digest:='sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  if v_digest<>v_reset.db_manifest_digest then raise exception 'founder_test_reset_database_drift'; end if;

  perform public.archive_founder_test_reset_evidence(p_reset_id,p_workspace_key,v_legacy);

  select array_agg(distinct id) into v_oauth_ids from (
    select substring(client_secret_reference from '([0-9a-fA-F-]{36})$')::uuid id
      from public.foundation_oauth_connections where workspace_key=p_workspace_key and client_secret_reference like 'vercel://oauth/%'
    union all select substring(refresh_token_reference from '([0-9a-fA-F-]{36})$')::uuid
      from public.foundation_oauth_connections where workspace_key=p_workspace_key and refresh_token_reference like 'vercel://oauth/%'
    union all select substring(pkce_verifier_reference from '([0-9a-fA-F-]{36})$')::uuid
      from public.foundation_oauth_authorizations where workspace_key=p_workspace_key and pkce_verifier_reference like 'vercel://oauth/%'
  ) s where id is not null;
  perform pg_catalog.set_config('tavonel.founder_reset_id',p_reset_id::text,true);
  -- 20261104091000: a relation names two fingerprints; it goes first.
  -- 20261107100100: a label names a fingerprint; it goes ahead of it.
  delete from public.document_labels where workspace_key=p_workspace_key;
  delete from public.document_relations where workspace_key=p_workspace_key;
  delete from public.source_fingerprints where workspace_key=p_workspace_key;

  delete from public.source_deletion_worker_failures
    where deletion_id in (select deletion_id from public.source_deletion_tombstones where workspace_key=p_workspace_key);
  delete from public.source_deletion_receipts where workspace_key=p_workspace_key;
  delete from public.source_deletion_inventory_attestations where workspace_key=p_workspace_key;
  delete from public.source_deletion_objects where workspace_key=p_workspace_key;
  delete from public.source_deletion_tombstones where workspace_key=p_workspace_key;
  delete from public.foundation_connector_page_snapshots where workspace_key=p_workspace_key;
  delete from public.foundation_connector_checkpoints where workspace_key=p_workspace_key;
  delete from public.foundation_job_events where workspace_key=p_workspace_key;
  delete from public.foundation_jobs where workspace_key=p_workspace_key;
  delete from public.foundation_compile_job_events where workspace_key=p_workspace_key;
  delete from public.foundation_compile_jobs where workspace_key=p_workspace_key;
  delete from public.foundation_review_decisions where workspace_key=p_workspace_key;
  delete from public.foundation_retrieval_embeddings where workspace_key=p_workspace_key;
  delete from public.foundation_retrieval_units where workspace_key=p_workspace_key;
  delete from public.foundation_retrieval_compile_runs where workspace_key=p_workspace_key;
  delete from public.foundation_retrieval_profiles where workspace_key=p_workspace_key;
  delete from public.foundation_active_worlds where workspace_key=p_workspace_key;
  delete from public.foundation_world_transition_receipts where workspace_key=p_workspace_key;
  -- 20261105010000: W1-A3's internal receipts name this workspace's Worlds.
  delete from public.foundation_operations_receipts where workspace_key=p_workspace_key;
  delete from public.foundation_world_events where workspace_key=p_workspace_key;
  delete from public.foundation_world_versions where workspace_key=p_workspace_key;
  delete from public.connector_source_suspensions where workspace_key=p_workspace_key;
  -- 20261002140000: a tie resolution names bindings of the same source; it goes ahead of them.
  delete from public.connector_binding_tie_resolutions where workspace_key=p_workspace_key;
  delete from public.connector_document_bindings where workspace_key=p_workspace_key;
  delete from public.source_acl_snapshots where source_version_id in
    (select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key);
  delete from public.source_representations where source_version_id in
    (select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key);
  delete from public.source_versions where source_id in (select source_id from public.sources where workspace_id=p_workspace_key);
  delete from public.sources where workspace_id=p_workspace_key;
  delete from public.knowledge_graph_candidates where workspace_id=v_legacy;
  delete from public.gpu_job_reservations where workspace_id=v_legacy;
  delete from public.sanitization_proofs where document_id in (select id from public.documents where workspace_id=v_legacy);
  delete from public.documents where workspace_id=v_legacy;
  delete from public.foundation_trial_source_digests where workspace_key=p_workspace_key;
  delete from public.foundation_intake_admissions where workspace_key=p_workspace_key;
  delete from public.foundation_connection_batches where workspace_key=p_workspace_key;
  -- 20261002120000: items and heads reference the connection, the head references its scan,
  -- pages cascade from their scan (deleted explicitly so the order does not lean on it).
  delete from public.foundation_connection_inventory_items where workspace_key=p_workspace_key;
  delete from public.foundation_connection_inventory_heads where workspace_key=p_workspace_key;
  delete from public.foundation_connection_inventory_pages where scan_id in
    (select scan_id from public.foundation_connection_inventory_scans where workspace_key=p_workspace_key);
  delete from public.foundation_connection_inventory_scans where workspace_key=p_workspace_key;
  delete from public.foundation_connections where workspace_key=p_workspace_key;
  delete from public.foundation_oauth_authorizations where workspace_key=p_workspace_key;
  delete from public.foundation_oauth_connections where workspace_key=p_workspace_key;
  delete from public.foundation_oauth_secret_envelopes e
    where e.secret_id=any(coalesce(v_oauth_ids,'{}'::uuid[]))
      and not exists(select 1 from public.foundation_oauth_connections c where
        c.client_secret_reference='vercel://oauth/'||e.secret_id::text
        or c.refresh_token_reference='vercel://oauth/'||e.secret_id::text)
      and not exists(select 1 from public.foundation_oauth_authorizations a where
        a.pkce_verifier_reference='vercel://oauth/'||e.secret_id::text);

  update public.founder_test_reset_ledger
    set state='db_finalized_pending_object_verify',finalized_at=clock_timestamp()
    where reset_id=p_reset_id;
  return jsonb_build_object('status','db_finalized_pending_object_verify','resetId',p_reset_id);
exception when others then raise;
end; $$;

-- Reverses `create or replace function public.founder_test_reset_table_counts`: the origin/main body
-- (20261107100100), which does not count world_change_proposals.
create or replace function public.founder_test_reset_table_counts(p_workspace_key text, p_legacy_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with target_versions as (
    select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key
  ), counts(name,n) as (
    select 'documents',count(*) from public.documents where workspace_id=p_legacy_workspace_id
    union all select 'sanitization_proofs',count(*) from public.sanitization_proofs where document_id in (select id from public.documents where workspace_id=p_legacy_workspace_id)
    union all select 'knowledge_graph_candidates',count(*) from public.knowledge_graph_candidates where workspace_id=p_legacy_workspace_id
    union all select 'gpu_job_reservations',count(*) from public.gpu_job_reservations where workspace_id=p_legacy_workspace_id
    union all select 'foundation_intake_admissions',count(*) from public.foundation_intake_admissions where workspace_key=p_workspace_key
    union all select 'foundation_trial_source_digests',count(*) from public.foundation_trial_source_digests where workspace_key=p_workspace_key
    union all select 'foundation_compile_jobs',count(*) from public.foundation_compile_jobs where workspace_key=p_workspace_key
    union all select 'foundation_compile_job_events',count(*) from public.foundation_compile_job_events where workspace_key=p_workspace_key
    union all select 'foundation_jobs',count(*) from public.foundation_jobs where workspace_key=p_workspace_key
    union all select 'foundation_job_events',count(*) from public.foundation_job_events where workspace_key=p_workspace_key
    union all select 'foundation_connector_page_snapshots',count(*) from public.foundation_connector_page_snapshots where workspace_key=p_workspace_key
    union all select 'foundation_connector_checkpoints',count(*) from public.foundation_connector_checkpoints where workspace_key=p_workspace_key
    union all select 'foundation_review_decisions',count(*) from public.foundation_review_decisions where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_profiles',count(*) from public.foundation_retrieval_profiles where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_compile_runs',count(*) from public.foundation_retrieval_compile_runs where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_units',count(*) from public.foundation_retrieval_units where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_embeddings',count(*) from public.foundation_retrieval_embeddings where workspace_key=p_workspace_key
    union all select 'foundation_world_versions',count(*) from public.foundation_world_versions where workspace_key=p_workspace_key
    union all select 'foundation_active_worlds',count(*) from public.foundation_active_worlds where workspace_key=p_workspace_key
    union all select 'foundation_world_events',count(*) from public.foundation_world_events where workspace_key=p_workspace_key
    union all select 'foundation_world_transition_receipts',count(*) from public.foundation_world_transition_receipts where workspace_key=p_workspace_key
    union all select 'foundation_operations_receipts',count(*) from public.foundation_operations_receipts where workspace_key=p_workspace_key
    union all select 'connector_document_bindings',count(*) from public.connector_document_bindings where workspace_key=p_workspace_key
    union all select 'connector_binding_tie_resolutions',count(*) from public.connector_binding_tie_resolutions where workspace_key=p_workspace_key
    union all select 'source_fingerprints',count(*) from public.source_fingerprints where workspace_key=p_workspace_key
    union all select 'document_relations',count(*) from public.document_relations where workspace_key=p_workspace_key
    union all select 'document_labels',count(*) from public.document_labels where workspace_key=p_workspace_key
    union all select 'connector_source_suspensions',count(*) from public.connector_source_suspensions where workspace_key=p_workspace_key
    union all select 'sources',count(*) from public.sources where workspace_id=p_workspace_key
    union all select 'source_versions',count(*) from public.source_versions where source_version_id in (select source_version_id from target_versions)
    union all select 'source_representations',count(*) from public.source_representations where source_version_id in (select source_version_id from target_versions)
    union all select 'source_acl_snapshots',count(*) from public.source_acl_snapshots where source_version_id in (select source_version_id from target_versions)
    union all select 'source_deletion_tombstones',count(*) from public.source_deletion_tombstones where workspace_key=p_workspace_key
    union all select 'source_deletion_objects',count(*) from public.source_deletion_objects where workspace_key=p_workspace_key
    union all select 'source_deletion_receipts',count(*) from public.source_deletion_receipts where workspace_key=p_workspace_key
    union all select 'source_deletion_inventory_attestations',count(*) from public.source_deletion_inventory_attestations where workspace_key=p_workspace_key
    union all select 'source_deletion_worker_failures',count(*) from public.source_deletion_worker_failures
      where deletion_id in (select deletion_id from public.source_deletion_tombstones where workspace_key=p_workspace_key)
    union all select 'foundation_connections',count(*) from public.foundation_connections where workspace_key=p_workspace_key
    union all select 'foundation_connection_batches',count(*) from public.foundation_connection_batches where workspace_key=p_workspace_key
    union all select 'foundation_connection_inventory_heads',count(*) from public.foundation_connection_inventory_heads where workspace_key=p_workspace_key
    union all select 'foundation_connection_inventory_scans',count(*) from public.foundation_connection_inventory_scans where workspace_key=p_workspace_key
    union all select 'foundation_connection_inventory_pages',count(*) from public.foundation_connection_inventory_pages
      where scan_id in (select scan_id from public.foundation_connection_inventory_scans where workspace_key=p_workspace_key)
    union all select 'foundation_connection_inventory_items',count(*) from public.foundation_connection_inventory_items where workspace_key=p_workspace_key
    union all select 'foundation_oauth_authorizations',count(*) from public.foundation_oauth_authorizations where workspace_key=p_workspace_key
    union all select 'foundation_oauth_connections',count(*) from public.foundation_oauth_connections where workspace_key=p_workspace_key
    union all select 'foundation_oauth_secret_envelopes',count(*) from public.foundation_oauth_secret_envelopes
      where secret_id in (select public.founder_test_reset_orphan_oauth_secret_ids(p_workspace_key))
  ) select coalesce(jsonb_object_agg(name,n),'{}'::jsonb) from counts;
$$;

-- Reverses `create or replace function public.founder_test_reset_rows_fingerprint`: the origin/main
-- body (20261107100100), which does not fingerprint world_change_proposals.
create or replace function public.founder_test_reset_rows_fingerprint(p_workspace_key text, p_legacy_workspace_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    coalesce(pg_catalog.string_agg(q.table_name || ':' || q.row_value, E'\n'
      order by q.table_name, q.row_value), ''), 'UTF8'), 'sha256'), 'hex')
  from (
    select 'documents' table_name, to_jsonb(x)::text row_value from public.documents x where workspace_id=p_legacy_workspace_id
    union all select 'gpu_job_reservations',to_jsonb(x)::text from public.gpu_job_reservations x where workspace_id=p_legacy_workspace_id
    union all select 'sanitization_proofs',to_jsonb(x)::text from public.sanitization_proofs x where document_id in (select id from public.documents where workspace_id=p_legacy_workspace_id)
    union all select 'knowledge_graph_candidates',to_jsonb(x)::text from public.knowledge_graph_candidates x where workspace_id=p_legacy_workspace_id
    union all select 'foundation_intake_admissions',to_jsonb(x)::text from public.foundation_intake_admissions x where workspace_key=p_workspace_key
    union all select 'foundation_trial_source_digests',to_jsonb(x)::text from public.foundation_trial_source_digests x where workspace_key=p_workspace_key
    union all select 'foundation_compile_jobs',to_jsonb(x)::text from public.foundation_compile_jobs x where workspace_key=p_workspace_key
    union all select 'foundation_compile_job_events',to_jsonb(x)::text from public.foundation_compile_job_events x where workspace_key=p_workspace_key
    union all select 'foundation_jobs',to_jsonb(x)::text from public.foundation_jobs x where workspace_key=p_workspace_key
    union all select 'foundation_job_events',to_jsonb(x)::text from public.foundation_job_events x where workspace_key=p_workspace_key
    union all select 'foundation_connector_page_snapshots',to_jsonb(x)::text from public.foundation_connector_page_snapshots x where workspace_key=p_workspace_key
    union all select 'foundation_connector_checkpoints',to_jsonb(x)::text from public.foundation_connector_checkpoints x where workspace_key=p_workspace_key
    union all select 'foundation_review_decisions',to_jsonb(x)::text from public.foundation_review_decisions x where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_profiles',to_jsonb(x)::text from public.foundation_retrieval_profiles x where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_compile_runs',to_jsonb(x)::text from public.foundation_retrieval_compile_runs x where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_units',to_jsonb(x)::text from public.foundation_retrieval_units x where workspace_key=p_workspace_key
    union all select 'foundation_retrieval_embeddings',to_jsonb(x)::text from public.foundation_retrieval_embeddings x where workspace_key=p_workspace_key
    union all select 'foundation_world_versions',to_jsonb(x)::text from public.foundation_world_versions x where workspace_key=p_workspace_key
    union all select 'foundation_active_worlds',to_jsonb(x)::text from public.foundation_active_worlds x where workspace_key=p_workspace_key
    union all select 'foundation_world_events',to_jsonb(x)::text from public.foundation_world_events x where workspace_key=p_workspace_key
    union all select 'foundation_world_transition_receipts',to_jsonb(x)::text from public.foundation_world_transition_receipts x where workspace_key=p_workspace_key
    union all select 'foundation_operations_receipts',to_jsonb(x)::text from public.foundation_operations_receipts x where workspace_key=p_workspace_key
    union all select 'connector_document_bindings',to_jsonb(x)::text from public.connector_document_bindings x where workspace_key=p_workspace_key
    union all select 'connector_binding_tie_resolutions',to_jsonb(x)::text from public.connector_binding_tie_resolutions x where workspace_key=p_workspace_key
    union all select 'source_fingerprints',to_jsonb(x)::text from public.source_fingerprints x where workspace_key=p_workspace_key
    union all select 'document_relations',to_jsonb(x)::text from public.document_relations x where workspace_key=p_workspace_key
    union all select 'document_labels',to_jsonb(x)::text from public.document_labels x where workspace_key=p_workspace_key
    union all select 'connector_source_suspensions',to_jsonb(x)::text from public.connector_source_suspensions x where workspace_key=p_workspace_key
    union all select 'sources',to_jsonb(x)::text from public.sources x where workspace_id=p_workspace_key
    union all select 'source_versions',to_jsonb(x)::text from public.source_versions x where source_id in (select source_id from public.sources where workspace_id=p_workspace_key)
    union all select 'source_representations',to_jsonb(x)::text from public.source_representations x where source_version_id in
      (select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key)
    union all select 'source_acl_snapshots',to_jsonb(x)::text from public.source_acl_snapshots x where source_version_id in
      (select sv.source_version_id from public.source_versions sv join public.sources s on s.source_id=sv.source_id where s.workspace_id=p_workspace_key)
    union all select 'source_deletion_tombstones',to_jsonb(x)::text from public.source_deletion_tombstones x where workspace_key=p_workspace_key
    union all select 'source_deletion_objects',to_jsonb(x)::text from public.source_deletion_objects x where workspace_key=p_workspace_key
    union all select 'source_deletion_receipts',to_jsonb(x)::text from public.source_deletion_receipts x where workspace_key=p_workspace_key
    union all select 'source_deletion_inventory_attestations',to_jsonb(x)::text from public.source_deletion_inventory_attestations x where workspace_key=p_workspace_key
    union all select 'source_deletion_worker_failures',to_jsonb(x)::text from public.source_deletion_worker_failures x
      where x.deletion_id in (select deletion_id from public.source_deletion_tombstones where workspace_key=p_workspace_key)
    union all select 'foundation_connections',to_jsonb(x)::text from public.foundation_connections x where workspace_key=p_workspace_key
    union all select 'foundation_connection_batches',to_jsonb(x)::text from public.foundation_connection_batches x where workspace_key=p_workspace_key
    union all select 'foundation_connection_inventory_heads',to_jsonb(x)::text from public.foundation_connection_inventory_heads x where workspace_key=p_workspace_key
    union all select 'foundation_connection_inventory_scans',to_jsonb(x)::text from public.foundation_connection_inventory_scans x where workspace_key=p_workspace_key
    union all select 'foundation_connection_inventory_pages',to_jsonb(x)::text from public.foundation_connection_inventory_pages x
      where x.scan_id in (select scan_id from public.foundation_connection_inventory_scans where workspace_key=p_workspace_key)
    union all select 'foundation_connection_inventory_items',to_jsonb(x)::text from public.foundation_connection_inventory_items x where workspace_key=p_workspace_key
    union all select 'foundation_oauth_authorizations',to_jsonb(x)::text from public.foundation_oauth_authorizations x where workspace_key=p_workspace_key
    union all select 'foundation_oauth_connections',to_jsonb(x)::text from public.foundation_oauth_connections x where workspace_key=p_workspace_key
    union all select 'foundation_oauth_secret_envelopes',to_jsonb(x)::text from public.foundation_oauth_secret_envelopes x
      where x.secret_id in (select public.founder_test_reset_orphan_oauth_secret_ids(p_workspace_key))
  ) q;
$$;

do $verify$
declare
  v_fp text;
  v_counts text;
  v_finalize text;
begin
  select md5(pg_get_functiondef('public.founder_test_reset_rows_fingerprint(text, uuid)'::regprocedure))
    into v_fp;
  select md5(pg_get_functiondef('public.founder_test_reset_table_counts(text, uuid)'::regprocedure))
    into v_counts;
  select md5(pg_get_functiondef('public.finalize_founder_test_reset(uuid, text, uuid, text, text)'::regprocedure))
    into v_finalize;
  if v_fp is distinct from '45fc3422c35e92aead6b33adeaeb37b3'
    or v_counts is distinct from 'fc3fb2738644db53e6c551baae939718'
    or v_finalize is distinct from 'f410328eab24a873c7fcb3ab37dfb10f' then
    raise exception 'rollback_20261116130200_mismatch: restored definitions % / % / % are not the origin/main definitions',
      v_fp, v_counts, v_finalize;
  end if;
  if exists (select 1 from pg_catalog.pg_trigger
              where tgname = 'founder_reset_fence' and tgrelid = to_regclass('public.world_change_proposals'))
    or not exists (select 1 from pg_catalog.pg_trigger
                    where tgname = 'founder_reset_fence' and tgrelid = to_regclass('public.document_labels')) then
    raise exception 'rollback_20261116130200_mismatch: founder_reset_fence triggers are not in the origin/main state';
  end if;
end;
$verify$;

commit;
