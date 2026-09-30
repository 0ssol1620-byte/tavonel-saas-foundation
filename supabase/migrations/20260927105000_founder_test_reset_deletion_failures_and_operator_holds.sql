-- The founder test reset (20260920133000) predates two tables from 20260927102000/103000:
--
--   - source_deletion_worker_failures references source_deletion_tombstones and (since
--     20260927103000) source_deletion_objects. finalize deletes both and never touched the
--     failures, so any recorded failure made finalize fail on the foreign key after R2 was
--     already purged. The rows were also outside the inventory, the fingerprint, the evidence
--     archive and the sealed write fence.
--   - source_operator_legal_holds is a hold source that founder_test_reset_assertions never read,
--     and nothing stopped a hold from being placed while a reset was sealed.
--
-- This migration changes exactly that:
--   1. worker failures are scoped by their tombstone's workspace, counted, fingerprinted, archived
--      (append-only, same archive and delete-allow path as the other deletion evidence), fenced
--      while sealed, and deleted before the objects and tombstones they reference;
--   2. an open operator hold, or any hold state other than 'inactive', refuses prepare, seal,
--      finalize and complete; placing, releasing or changing a hold waits for and refuses against a
--      sealed or finalizing reset under the same legal-hold lock the assertions take.
-- Holds are never deleted or released by the reset. No existing check is removed.
--
-- The snapshot now includes the failures, so a reset prepared before this migration fails its seal
-- with founder_test_reset_database_drift and has to be prepared again.
--
-- Create-once (create function, create trigger): not part of the replay step in db-rehearsal.yml.
begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Sealed write fence for source_deletion_worker_failures (no workspace_key column)
-- ---------------------------------------------------------------------------------------------

create function public.guard_founder_test_reset_deletion_failure_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old text; v_new text; v_blocked text;
begin
  if tg_op<>'INSERT' then
    select workspace_key into v_old from public.source_deletion_tombstones where deletion_id=old.deletion_id;
  end if;
  if tg_op<>'DELETE' then
    select workspace_key into v_new from public.source_deletion_tombstones where deletion_id=new.deletion_id;
  end if;
  perform public.founder_test_reset_lock_workspaces(v_old,v_new);
  select workspace_key into v_blocked from public.founder_test_reset_ledger
    where state in ('sealed','db_finalized_pending_object_verify') and workspace_key in (v_old,v_new) limit 1;
  if v_blocked is not null and not (tg_op='DELETE' and public.founder_test_reset_session_allows_workspace(v_blocked)) then
    raise exception 'founder_test_reset_write_fenced';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger founder_reset_fence before insert or update or delete on public.source_deletion_worker_failures
  for each row execute function public.guard_founder_test_reset_deletion_failure_write();

-- ---------------------------------------------------------------------------------------------
-- 2. Operator holds wait for, and refuse against, a sealed or finalizing reset
-- ---------------------------------------------------------------------------------------------
--
-- Same lock domain and refusal as guard_founder_test_reset_legal_hold_activation for enterprise
-- policies. The trigger name sorts before source_operator_legal_holds_guard, so the reset check
-- runs first; both take the same re-entrant lock.
create function public.guard_founder_test_reset_operator_legal_hold()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_workspace text;
begin
  for v_workspace in select distinct workspace_key
                     from pg_catalog.unnest(array[
                       case when tg_op<>'INSERT' then old.workspace_key end,
                       case when tg_op<>'DELETE' then new.workspace_key end
                     ]) as candidate(workspace_key)
                     where workspace_key is not null order by workspace_key loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'tavonel.source_legal_hold.v1'||pg_catalog.chr(10)||v_workspace,0));
    if exists(select 1 from public.founder_test_reset_ledger
              where workspace_key=v_workspace
                and state in ('sealed','db_finalized_pending_object_verify')) then
      raise exception 'founder_test_reset_operator_legal_hold_waits_for_finalize';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger founder_test_reset_blocks_operator_legal_hold
  before insert or update or delete on public.source_operator_legal_holds
  for each row execute function public.guard_founder_test_reset_operator_legal_hold();

-- ---------------------------------------------------------------------------------------------
-- 3. Assertions: body identical to 20260920133000 plus the two operator-hold checks
-- ---------------------------------------------------------------------------------------------

create or replace function public.founder_test_reset_assertions(
  p_email text, p_user_id uuid, p_workspace_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_legacy uuid; v_expected text;
begin
  v_expected := 'pilot-' || substring(pg_catalog.replace(p_user_id::text, '-', '') from 1 for 16);
  if p_email is distinct from '0ssol1620@gmail.com' or p_workspace_key is distinct from v_expected then
    raise exception 'founder_test_reset_target_invalid';
  end if;
  -- Share the write-fence lock domain before checking live work. A compile writer that won the
  -- lock must commit before this check, and a writer that lost it cannot race the reset state.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('founder-test-reset:'||p_workspace_key,0));
  if (select count(*) from auth.users where id=p_user_id and lower(email)=p_email) <> 1 then
    raise exception 'founder_test_reset_auth_identity_mismatch';
  end if;
  if (select count(*) from public.foundation_account_access_grants
      where user_id=p_user_id and grant_kind='owner' and active and access_plan='studio_access') <> 1 then
    raise exception 'founder_test_reset_active_owner_grant_required';
  end if;
  if (select count(*) from public.foundation_workspaces where workspace_key=p_workspace_key and created_by=p_user_id) <> 1
     or (select count(*) from public.foundation_workspace_members
         where workspace_key=p_workspace_key and user_id=p_user_id and role='owner' and state='active') <> 1
     or (select count(*) from public.foundation_workspace_members
         where workspace_key=p_workspace_key and role='owner' and state='active') <> 1 then
    raise exception 'founder_test_reset_foundation_owner_mismatch';
  end if;
  select ew.organization_id into v_org from public.enterprise_workspaces ew
   join public.enterprise_workspace_memberships ewm on ewm.workspace_key=ew.workspace_key
   join public.enterprise_organization_memberships eom on eom.organization_id=ew.organization_id
   where ew.workspace_key=p_workspace_key and ewm.user_id=p_user_id and ewm.role='owner'
     and eom.user_id=p_user_id and eom.role='owner';
  if v_org is null then raise exception 'founder_test_reset_enterprise_owner_mismatch'; end if;
  -- Exact lock domain shared with guard_legal_hold_against_source_deletion in 20260920132000.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1'||pg_catalog.chr(10)||p_workspace_key,0));
  if (select count(*) from public.enterprise_governance_policies where organization_id=v_org) <> 1 then
    raise exception 'founder_test_reset_legal_hold_state_invalid';
  end if;
  if exists(select 1 from public.enterprise_governance_policies
             where organization_id=v_org and legal_hold_enabled) then
    raise exception 'founder_test_reset_legal_hold_active';
  end if;
  -- 20260927105000: operator holds (20260927102000), read under the same legal-hold lock that
  -- guard_founder_test_reset_operator_legal_hold takes. Then every hold source the deletion
  -- machinery honours must read 'inactive'; 'unknown' refuses too.
  if exists(select 1 from public.source_operator_legal_holds
             where workspace_key=p_workspace_key and released_at is null) then
    raise exception 'founder_test_reset_operator_legal_hold_active';
  end if;
  if public.source_legal_hold_state(p_workspace_key) is distinct from 'inactive' then
    raise exception 'founder_test_reset_legal_hold_state_invalid';
  end if;
  -- Every non-terminal compile is active regardless of heartbeat age. Lock the matching rows so
  -- they cannot transition underneath the assertion before the caller seals/finalizes the reset.
  perform 1 from public.foundation_compile_jobs
    where workspace_key=p_workspace_key
      and state not in ('ready','failed','cancelled')
    for update;
  if found then raise exception 'founder_test_reset_active_work_refused'; end if;
  if exists(select 1 from public.foundation_operation_leases
             where workspace_key=p_workspace_key and state='running' and expires_at>clock_timestamp())
     or exists(select 1 from public.foundation_jobs
             where workspace_key=p_workspace_key and state in ('queued','leased'))
     or exists(select 1 from public.foundation_intake_admissions
             where workspace_key=p_workspace_key and expires_at>clock_timestamp())
     or exists(select 1 from public.foundation_retrieval_compile_runs
            where workspace_key=p_workspace_key and status in ('pending','running'))
     or exists(select 1 from public.foundation_compute_reservations
            where workspace_key=p_workspace_key and state='reserved' and expires_at>clock_timestamp())
     or exists(select 1 from public.gpu_job_reservations
            where workspace_id in (select id from public.workspaces where owner_id=p_user_id)
              and state in ('reserved','dispatched'))
     or exists(select 1 from public.model_provider_spend_reservations
            where tenant_id=p_workspace_key and state in ('queued','reserved')) then
    raise exception 'founder_test_reset_active_work_refused';
  end if;
  select id into v_legacy from public.workspaces where owner_id=p_user_id;
  if v_legacy is null or (select count(*) from public.workspaces where owner_id=p_user_id) <> 1
     or not exists(select 1 from public.workspace_memberships
                   where workspace_id=v_legacy and user_id=p_user_id and role='owner') then
    raise exception 'founder_test_reset_legacy_owner_mismatch';
  end if;
  return v_legacy;
end; $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Inventory and fingerprint: bodies identical to 20260920133000 plus worker failures
-- ---------------------------------------------------------------------------------------------
--
-- Failures carry no workspace_key. Their tombstone's does, and deletion_id is the tombstone's
-- primary key, so this scope is exact (an object failure's object is FK-bound to the same
-- tombstone, deletion_id, workspace_key and source_id).

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
    union all select 'foundation_oauth_authorizations',count(*) from public.foundation_oauth_authorizations where workspace_key=p_workspace_key
    union all select 'foundation_oauth_connections',count(*) from public.foundation_oauth_connections where workspace_key=p_workspace_key
    union all select 'foundation_oauth_secret_envelopes',count(*) from public.foundation_oauth_secret_envelopes
      where secret_id in (select public.founder_test_reset_orphan_oauth_secret_ids(p_workspace_key))
  ) select coalesce(jsonb_object_agg(name,n),'{}'::jsonb) from counts;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Archive: body identical to 20260920133000 plus worker failures
-- ---------------------------------------------------------------------------------------------
--
-- The table's append-only trigger (prevent_source_deletion_evidence_mutation) already admits a
-- delete only for a row archived byte-for-byte under the sealed reset in this session.
create or replace function public.archive_founder_test_reset_evidence(
  p_reset_id uuid, p_workspace_key text, p_legacy_workspace_id uuid
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_count bigint;
begin
  with evidence(source_table,source_row_key,payload) as (
    select 'gpu_job_reservations',x.id::text,to_jsonb(x) from public.gpu_job_reservations x where workspace_id=p_legacy_workspace_id
    union all select 'foundation_job_events',x.job_id||':'||x.event_sequence,to_jsonb(x) from public.foundation_job_events x where workspace_key=p_workspace_key
    union all select 'foundation_compile_job_events',x.job_id||':'||x.event_sequence,to_jsonb(x) from public.foundation_compile_job_events x where workspace_key=p_workspace_key
    union all select 'foundation_world_events',x.event_id::text,to_jsonb(x) from public.foundation_world_events x where workspace_key=p_workspace_key
    union all select 'foundation_world_transition_receipts',x.operation_id::text,to_jsonb(x) from public.foundation_world_transition_receipts x where workspace_key=p_workspace_key
    union all select 'foundation_review_decisions',x.decision_id::text,to_jsonb(x) from public.foundation_review_decisions x where workspace_key=p_workspace_key
    union all select 'source_deletion_tombstones',x.deletion_id,to_jsonb(x) from public.source_deletion_tombstones x where workspace_key=p_workspace_key
    union all select 'source_deletion_objects',x.deletion_id||':sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(x.object_key,'UTF8'),'sha256'),'hex'),to_jsonb(x) from public.source_deletion_objects x where workspace_key=p_workspace_key
    union all select 'source_deletion_receipts',x.receipt_id::text,to_jsonb(x) from public.source_deletion_receipts x where workspace_key=p_workspace_key
    union all select 'source_deletion_inventory_attestations',x.deletion_id,to_jsonb(x) from public.source_deletion_inventory_attestations x where workspace_key=p_workspace_key
    union all select 'source_deletion_worker_failures',x.failure_id::text,to_jsonb(x) from public.source_deletion_worker_failures x
      where x.deletion_id in (select deletion_id from public.source_deletion_tombstones where workspace_key=p_workspace_key)
    union all select 'connector_document_bindings',x.source_version_id,to_jsonb(x) from public.connector_document_bindings x where workspace_key=p_workspace_key
    union all select 'connector_source_suspensions',x.source_id,to_jsonb(x) from public.connector_source_suspensions x where workspace_key=p_workspace_key
  )
  insert into public.founder_test_reset_evidence_archive(reset_id,source_table,source_row_key,row_sha256,payload)
  select p_reset_id,source_table,source_row_key,
    public.founder_test_reset_row_sha256(payload),payload
    from evidence on conflict (reset_id,source_table,source_row_key) do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end; $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Finalize: body identical to 20260920133000 plus one delete, ahead of everything the
--    failures reference (receipts, attestations, objects, tombstones)
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

-- create or replace keeps the grants of 20260920133000 on the replaced functions.
revoke all on function public.guard_founder_test_reset_deletion_failure_write(),
  public.guard_founder_test_reset_operator_legal_hold()
  from public, anon, authenticated, service_role;

commit;
