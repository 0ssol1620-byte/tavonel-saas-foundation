-- Gate 11: physically erase the derived rows a deleted document provably owns, and nothing else.
--
-- 20260927102000 denies every serving path for a tombstoned document but left its derived rows
-- stored. This migration erases exactly the rows whose ownership the schema and the producer
-- prove, records one append-only `derived_purged` receipt per deletion, and reports what stays.
--
-- Provably exclusive (erased):
--   - foundation_retrieval_units of type section, claim or entity naming the document. Each is
--     built from exactly one chunk of exactly one document (nextjs/lib/retrieval-units.ts:
--     compileSectionViewUnits / compileClaimViewUnits / compileEntityViewUnits), so erasing it
--     removes no other document's content. A shared entity keeps its units in the other documents.
--     Their embeddings go with them (0020: on delete cascade).
--   - expired foundation_operation_leases rows (Ask/export replay cache) of the workspace. A cached
--     response carries no document id, so ownership is not provable; time is. A response is
--     completed at most 75 s after its lease was acquired and expires 10 minutes later (0055), so
--     every response that could hold this document's content expired before eligible_at
--     (>= requested_at + 15 minutes). Rows completed later were produced behind the serving deny.
--     Expired rows are never replayable, so erasing them changes no behaviour.
--
-- Not provably exclusive (kept, counted in the receipt, still denied at serving):
--   - retrieval units of any other type naming the document. None is produced today; if one ever
--     is, it may summarise several documents, so it is counted as retained, not guessed at.
--   - Compiled World candidates in R2 (immutable/<ws>/<ws>/collections/...), foundation_world_*
--     rows, compile runs and receipts. A World can combine several documents, is provenance for
--     every one of them, and its R2 object sits under the bucket's 365-day object lock. The
--     receipt counts the World versions whose retrieval index named this document; Worlds with
--     no retrieval index cannot be enumerated from the database and are not claimed either way.
--
-- Preconditions, all re-read under the deletion lock and the legal-hold lock: the tombstone is
-- eligible, its inventory is attested (the attestation proved the producers quiescent), no
-- retrieval compile is pending or running in the workspace, and the hold is readable and inactive.
--
-- Create-once (named constraints, add column): not part of the replay step in db-rehearsal.yml.
begin;

-- ---------------------------------------------------------------------------------------------
-- 1. One more receipt action on the existing append-only table
-- ---------------------------------------------------------------------------------------------
--
-- The existing table, not a new one: the founder test reset archives and removes every
-- source_deletion_receipts row by workspace, so this evidence follows the same path.
-- Constraint names are PostgreSQL's defaults for 20260920132000's unnamed checks; deliberately not
-- `if exists`, so a different name fails the migration instead of leaving the old check behind.
alter table public.source_deletion_receipts drop constraint source_deletion_receipts_action_check;
alter table public.source_deletion_receipts add constraint source_deletion_receipts_action_check
  check (action in ('tombstoned', 'object_purged', 'derived_purged'));
alter table public.source_deletion_receipts drop constraint source_deletion_receipts_check;
alter table public.source_deletion_receipts add constraint source_deletion_receipts_check check (
  (action in ('tombstoned', 'derived_purged')
    and object_key is null and object_sha256 is null and object_already_absent is null)
  or (action = 'object_purged'
    and object_key is not null and object_sha256 is not null and object_already_absent is not null));

alter table public.source_deletion_receipts add column derived_summary jsonb;
alter table public.source_deletion_receipts add constraint source_deletion_receipts_derived_shape
  check ((action = 'derived_purged') = (derived_summary is not null)
    and (derived_summary is null or pg_catalog.jsonb_typeof(derived_summary) = 'object'));

create unique index source_deletion_receipts_derived_once_idx
  on public.source_deletion_receipts (deletion_id) where action = 'derived_purged';

-- Only the unit types whose producer binds them to a single chunk of a single document.
create function public.source_deletion_exclusive_unit_types()
returns text[] language sql immutable set search_path = '' as $$
  select array['section', 'claim', 'entity']::text[];
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. The closure: one deletion per call, one transaction
-- ---------------------------------------------------------------------------------------------

-- ponytail: linear scan of attested tombstones without a derived receipt; index if that set grows.
-- ponytail: lower(document_id) cannot use the (workspace_key, document_id) index; bounded by workspace.
create function public.close_source_deletion_derived()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tombstone public.source_deletion_tombstones%rowtype;
  v_document_keys text[];
  v_units integer;
  v_embeddings integer;
  v_unproven integer;
  v_worlds integer;
  v_cache integer;
  v_summary jsonb;
  v_payload jsonb;
  v_receipt_id text;
begin
  for v_tombstone in
    select t.* from public.source_deletion_tombstones t
     where t.eligible_at <= pg_catalog.clock_timestamp()
       and exists (select 1 from public.source_deletion_inventory_attestations a
                    where a.deletion_id = t.deletion_id)
       and not exists (select 1 from public.source_deletion_receipts r
                        where r.deletion_id = t.deletion_id and r.action = 'derived_purged')
       and public.source_legal_hold_state(t.workspace_key) = 'inactive'
     order by t.requested_at, t.deletion_id
  loop
    -- A retrieval compile in flight could write a unit after the erase. Pass over the workspace
    -- for this run; it is retried on the next one. A run stuck in 'running' keeps it pending.
    continue when exists (
      select 1 from public.foundation_retrieval_compile_runs r
       where r.workspace_key = v_tombstone.workspace_key and r.status in ('pending', 'running'));

    -- Same order as request_connector_source_deletion: deletion lock, then legal-hold lock.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tombstone.deletion_id, 0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || v_tombstone.workspace_key, 0));
    if public.source_legal_hold_state(v_tombstone.workspace_key) <> 'inactive' then
      return pg_catalog.jsonb_build_object('status', 'held', 'deletionId', v_tombstone.deletion_id);
    end if;
    if exists (select 1 from public.source_deletion_receipts r
                where r.deletion_id = v_tombstone.deletion_id and r.action = 'derived_purged') then
      return pg_catalog.jsonb_build_object('status', 'raced', 'deletionId', v_tombstone.deletion_id);
    end if;

    v_document_keys := array(select d::text from pg_catalog.unnest(
      public.source_deletion_document_ids(v_tombstone.deletion_id)) d);

    -- Evidence first, from the rows about to change.
    select pg_catalog.count(distinct (r.collection_id, r.world_manifest_digest))::integer into v_worlds
      from public.foundation_retrieval_units u
      join public.foundation_retrieval_compile_runs r
        on r.workspace_key = u.workspace_key and r.run_id = u.compile_run_id
     where u.workspace_key = v_tombstone.workspace_key
       and pg_catalog.lower(u.document_id) = any(v_document_keys);
    select pg_catalog.count(*)::integer into v_unproven
      from public.foundation_retrieval_units u
     where u.workspace_key = v_tombstone.workspace_key
       and pg_catalog.lower(u.document_id) = any(v_document_keys)
       and u.unit_type <> all(public.source_deletion_exclusive_unit_types());
    select pg_catalog.count(*)::integer into v_embeddings
      from public.foundation_retrieval_embeddings e
      join public.foundation_retrieval_units u on u.workspace_key = e.workspace_key and u.unit_id = e.unit_id
     where u.workspace_key = v_tombstone.workspace_key
       and pg_catalog.lower(u.document_id) = any(v_document_keys)
       and u.unit_type = any(public.source_deletion_exclusive_unit_types());

    delete from public.foundation_retrieval_units u
     where u.workspace_key = v_tombstone.workspace_key
       and pg_catalog.lower(u.document_id) = any(v_document_keys)
       and u.unit_type = any(public.source_deletion_exclusive_unit_types());
    get diagnostics v_units = row_count;

    delete from public.foundation_operation_leases l
     where l.workspace_key = v_tombstone.workspace_key and l.expires_at <= pg_catalog.clock_timestamp();
    get diagnostics v_cache = row_count;

    v_summary := pg_catalog.jsonb_build_object(
      'retrievalUnitsErased', v_units,
      'retrievalEmbeddingsErased', v_embeddings,
      'expiredWorkspaceCacheRowsErased', v_cache,
      'retrievalUnitsRetainedUnproven', v_unproven,
      'indexedWorldVersionsRetained', v_worlds);
    v_payload := pg_catalog.jsonb_build_object('schemaVersion', 'tavonel.source_deletion_receipt.v1',
      'deletionId', v_tombstone.deletion_id, 'workspaceKey', v_tombstone.workspace_key,
      'sourceId', v_tombstone.source_id, 'action', 'derived_purged',
      'documentIds', pg_catalog.to_jsonb(v_document_keys), 'summary', v_summary);
    v_receipt_id := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'tavonel.source_deletion_receipt.v1' || pg_catalog.chr(10) || v_tombstone.deletion_id
        || pg_catalog.chr(10) || 'derived_purged', 'UTF8'), 'sha256'), 'hex');
    insert into public.source_deletion_receipts
      (receipt_id, deletion_id, workspace_key, source_id, action, payload_sha256, derived_summary)
    values (v_receipt_id, v_tombstone.deletion_id, v_tombstone.workspace_key, v_tombstone.source_id,
      'derived_purged',
      'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
      v_summary);

    return pg_catalog.jsonb_build_object('status', 'recorded', 'deletionId', v_tombstone.deletion_id,
      'receiptId', v_receipt_id) || v_summary;
  end loop;
  return pg_catalog.jsonb_build_object('status', 'idle');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Status: body identical to 20260927103000 plus `derived`
-- ---------------------------------------------------------------------------------------------
--
-- `derived` is null until the closure ran. `retrievalUnitsRemaining` is read live, not from the
-- receipt, so a unit written after the closure (which the serving deny should make impossible)
-- is visible instead of hidden behind an old count.
create or replace function public.customer_source_deletion_status(p_workspace_key text, p_document_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'deletionId', t.deletion_id, 'workspaceKey', t.workspace_key, 'documentId', t.document_id,
    'reason', t.reason, 'requestedAt', t.requested_at, 'eligibleAt', t.eligible_at,
    'requestManifestSha256', t.request_manifest_sha256,
    'tombstoneReceiptId', (select r.receipt_id from public.source_deletion_receipts r
                            where r.deletion_id = t.deletion_id and r.action = 'tombstoned'),
    'inventoryManifestSha256', a.inventory_manifest_sha256,
    'artifactCount', a.artifact_count,
    'attestedAt', a.attested_at,
    'objects', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'objectKey', o.object_key, 'objectSha256', o.object_sha256, 'purgedAt', o.purged_at,
        'receiptId', r.receipt_id, 'objectAlreadyAbsent', r.object_already_absent,
        'purgeFailureCount', case when r.receipt_id is null then f.failures else 0 end,
        'lastPurgeFailureCode', case when r.receipt_id is null then f.last_code end,
        'lastPurgeFailureAt', case when r.receipt_id is null then f.last_at end) order by o.object_key)
        from public.source_deletion_objects o
        left join public.source_deletion_receipts r
          on r.deletion_id = o.deletion_id and r.action = 'object_purged' and r.object_key = o.object_key
        left join lateral (
          select pg_catalog.count(*)::integer as failures,
                 (pg_catalog.array_agg(w.code order by w.recorded_at desc, w.failure_id desc))[1] as last_code,
                 pg_catalog.max(w.recorded_at) as last_at
            from public.source_deletion_worker_failures w
           where w.deletion_id = o.deletion_id and w.stage = 'purge' and w.object_key = o.object_key
        ) f on true
       where o.deletion_id = t.deletion_id), '[]'::jsonb),
    'derived', (
      select pg_catalog.jsonb_build_object('receiptId', d.receipt_id, 'closedAt', d.recorded_at,
        'retrievalUnitsRemaining', (select pg_catalog.count(*)::integer from public.foundation_retrieval_units u
                                     where u.workspace_key = t.workspace_key
                                       and pg_catalog.lower(u.document_id) = t.document_id::text))
        || d.derived_summary
        from public.source_deletion_receipts d
       where d.deletion_id = t.deletion_id and d.action = 'derived_purged'))
  from public.source_deletion_tombstones t
  left join public.source_deletion_inventory_attestations a on a.deletion_id = t.deletion_id
  where t.workspace_key = p_workspace_key and t.document_id = p_document_id;
$$;

revoke all on function public.source_deletion_exclusive_unit_types(),
  public.close_source_deletion_derived(),
  public.customer_source_deletion_status(text, uuid)
  from public, anon, authenticated;
revoke all on function public.source_deletion_exclusive_unit_types() from service_role;
grant execute on function public.close_source_deletion_derived(),
  public.customer_source_deletion_status(text, uuid)
  to service_role;

commit;
