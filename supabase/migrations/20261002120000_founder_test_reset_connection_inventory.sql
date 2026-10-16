-- The founder test reset (20260920133000, last replaced by 20260927105000) predates the connection
-- source inventory tables of 20261002100000. Their foreign keys to foundation_connections are
-- on delete restrict, so finalize failed on `delete from foundation_connections` for any workspace
-- that had ever begun an inventory scan -- after R2 had already been purged.
--
-- This migration changes exactly that. The four inventory tables of the reset workspace are
-- counted, fingerprinted (so the sealed manifest covers them and a scan that moves between prepare
-- and seal is founder_test_reset_database_drift) and deleted in finalize, ahead of the connections
-- they reference. Pages carry no workspace_key and are scoped through their scan.
--
-- Archive vs delete follows the existing reset design: the evidence archive holds the append-only
-- and immutable evidence tables (events, receipts, deletion evidence, bindings, suspensions) and
-- GPU reservations. Mutable per-connection sync state -- foundation_connections,
-- foundation_connection_batches, foundation_connector_checkpoints, foundation_connector_page_snapshots
-- -- is counted, fingerprinted and deleted without archiving, and so is the inventory: heads, scans
-- (their receipt is a column of a mutable row, not an append-only table), staged pages and items.
-- archive_founder_test_reset_evidence is therefore not replaced.
--
-- Write fence: unchanged. 20261002100000 put the heads and scans behind
-- guard_founder_test_reset_workspace_write, and every inventory RPC writes one of them in the same
-- transaction as any page or item write, so begin, stage and finalize are fenced while sealed and
-- finalize's own deletes pass through the sealed-session delete allowance. Pages and items have no
-- client or service_role table privilege and no per-row trigger (deliberately: finalize upserts up
-- to 100000 items).
--
-- The snapshot now includes the inventory, so a reset prepared before this migration fails its
-- seal with founder_test_reset_database_drift and has to be prepared again.
--
-- create or replace keeps the owner, `set search_path = ''` (restated below) and the grants of
-- 20260920133000 on the replaced functions; none is revoked or granted here.
--
-- Not part of the replay step in db-rehearsal.yml.
begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Inventory and fingerprint: bodies identical to 20260927105000 plus the four inventory tables
-- ---------------------------------------------------------------------------------------------

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
    union all select 'connector_document_bindings',to_jsonb(x)::text from public.connector_document_bindings x where workspace_key=p_workspace_key
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
    union all select 'connector_document_bindings',count(*) from public.connector_document_bindings where workspace_key=p_workspace_key
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

-- ---------------------------------------------------------------------------------------------
-- 2. Finalize: body identical to 20260927105000 plus four deletes, ahead of foundation_connections
-- ---------------------------------------------------------------------------------------------

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
  delete from public.foundation_world_events where workspace_key=p_workspace_key;
  delete from public.foundation_world_versions where workspace_key=p_workspace_key;
  delete from public.connector_source_suspensions where workspace_key=p_workspace_key;
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

commit;
