-- Gate 11: deleting a document invalidates every compiled World that was built from it.
--
-- 20260927104000 kept compiled Worlds, their R2 candidates and their shared retrieval units,
-- because a World combines several documents and one document's ownership of a shared summary
-- cannot be proven. The decision since then: a World that includes a deleted document is
-- invalidated whole -- shared summaries included. Other documents keep their own objects, and
-- Worlds that never included the document are untouched.
--
-- Which Worlds are affected is read from one persisted fact only: a foundation_compile_jobs row
-- in the tombstone's workspace whose document_ids overlap the tombstone's documents and whose
-- candidate_manifest_digest is set. A World with no such row (no job, or a job that never
-- recorded its digest) is not claimed -- neither erased nor reported as erased. Its object key
-- is the persisted foundation_world_versions.candidate_object_key, or the canonical candidate key
-- built from the job's collection and digest (0007 pins the two to the same string).
--
--   1. source_deletion_inventory_candidate hands the worker those exact keys (worldObjectKeys).
--   2. attest_source_deletion_inventory takes the key set back and re-derives it under the
--      deletion, legal-hold and quiescence checks. A different set, an unknown key or more than
--      64 Worlds is refused; there is no wildcard over a collection. Present keys are enqueued
--      for the existing purge; the manifest names the full set, so a key the worker found absent
--      is recorded as absent, never as purged. Only an R2 removal receipt says purged.
--   3. close_source_deletion_derived additionally erases every retrieval unit (and, by cascade,
--      embedding) of the affected Worlds' compile runs, and invalidates an affected active pointer
--      under the same per-collection lock transition_foundation_world_atomic takes. World
--      versions, events, transition receipts, compile jobs and compile runs stay: they carry
--      hashes, not content, and are the audit trail.
--   4. An invalidated World cannot be activated again (rollback or re-promote), and a retrieval
--      compile run can no longer be created against a version that is being superseded.
--
-- Deletions attested before this migration keep their attestation; their World objects are not
-- enqueued by this path. The closure still invalidates their pointers and units.
--
-- Create-once (drop function, create trigger): not part of the replay step in db-rehearsal.yml.
begin;

-- ---------------------------------------------------------------------------------------------
-- 1. The affected-World rule, in one place
-- ---------------------------------------------------------------------------------------------

create function public.source_deletion_affected_worlds(p_deletion_id text)
returns table (collection_id text, manifest_digest text, object_key text)
language sql stable security definer set search_path = '' as $$
  select distinct j.collection_id, j.candidate_manifest_digest,
    coalesce(v.candidate_object_key,
      'immutable/' || t.workspace_key || '/' || t.workspace_key || '/collections/' || j.collection_id
        || '/' || pg_catalog.substr(j.candidate_manifest_digest, 8) || '/candidate-world.json')
    from public.source_deletion_tombstones t
    join public.foundation_compile_jobs j on j.workspace_key = t.workspace_key
    left join public.foundation_world_versions v
      on v.workspace_key = j.workspace_key and v.collection_id = j.collection_id
     and v.manifest_digest = j.candidate_manifest_digest
   where t.deletion_id = p_deletion_id
     and j.collection_id is not null
     and j.candidate_manifest_digest is not null
     and j.document_ids && array(select d::text
           from pg_catalog.unnest(public.source_deletion_document_ids(t.deletion_id)) d);
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Candidate: body identical to 20260927102000 plus worldObjectKeys
-- ---------------------------------------------------------------------------------------------
--
-- At most 65 keys: one past the attestation limit, so an oversized set reaches the worker as
-- oversized (and is refused and rotated there) without an unbounded payload.
create or replace function public.source_deletion_inventory_candidate()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tombstone public.source_deletion_tombstones%rowtype;
  v_document_ids uuid[];
  v_document_keys text[];
begin
  for v_tombstone in
    select t.*
      from public.source_deletion_tombstones t
     where t.eligible_at <= pg_catalog.clock_timestamp()
       and public.source_legal_hold_state(t.workspace_key) = 'inactive'
       and not exists (
         select 1 from public.source_deletion_inventory_attestations a
          where a.deletion_id = t.deletion_id
       )
     order by (select pg_catalog.max(f.recorded_at) from public.source_deletion_worker_failures f
                where f.deletion_id = t.deletion_id and f.stage = 'inventory') nulls first,
              t.requested_at, t.deletion_id
  loop
    v_document_ids := public.source_deletion_document_ids(v_tombstone.deletion_id);
    v_document_keys := array(select d::text from pg_catalog.unnest(v_document_ids) d);

    continue when exists (
      select 1 from public.foundation_compute_reservations r
       where r.workspace_key = v_tombstone.workspace_key
         and r.document_id = any(v_document_ids)
         and r.state::text in ('reserved', 'dispatched')
    ) or exists (
      select 1 from public.foundation_compile_jobs j
       where j.workspace_key = v_tombstone.workspace_key
         and j.document_ids && v_document_keys
         and j.state::text not in ('review_required', 'ready', 'failed', 'cancelled')
    ) or exists (
      select 1 from public.foundation_jobs j
       where j.workspace_key = v_tombstone.workspace_key
         and j.job_type::text = 'source_import'
         and j.state::text in ('queued', 'leased')
    );

    return pg_catalog.jsonb_build_object(
      'deletionId', v_tombstone.deletion_id,
      'workspaceKey', v_tombstone.workspace_key,
      'sourceId', v_tombstone.source_id,
      'documentIds', pg_catalog.to_jsonb(v_document_ids),
      'worldObjectKeys', pg_catalog.to_jsonb(array(
        select w.object_key from public.source_deletion_affected_worlds(v_tombstone.deletion_id) w
         order by w.object_key limit 65))
    );
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Attestation: body identical to 20260927102000 plus the World key set
-- ---------------------------------------------------------------------------------------------
--
-- A new trailing parameter, not an overload: two functions answering the same PostgREST name
-- with two arguments would be ambiguous. p_world_object_keys defaults to null, which is accepted
-- only when the re-derived set is empty, so a worker that predates this migration still attests a
-- deletion with no affected World and is refused for one with an affected World.
drop function public.attest_source_deletion_inventory(text, jsonb);

create function public.attest_source_deletion_inventory(
  p_deletion_id text,
  p_objects jsonb,
  p_world_object_keys jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tombstone public.source_deletion_tombstones%rowtype;
  v_existing public.source_deletion_inventory_attestations%rowtype;
  v_document_ids uuid[];
  v_document_keys text[];
  v_world_keys text[];
  v_submitted_world_keys text[];
  v_item jsonb;
  v_key text;
  v_sha text;
  v_size_text text;
  v_size bigint;
  v_count integer;
  v_distinct_count integer;
  v_canonical jsonb;
  v_manifest_payload jsonb;
  v_manifest_sha text;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$'
     or p_objects is null or pg_catalog.jsonb_typeof(p_objects) <> 'array'
     or pg_catalog.jsonb_array_length(p_objects) > 512
     or (p_world_object_keys is not null and (
       pg_catalog.jsonb_typeof(p_world_object_keys) <> 'array'
       or pg_catalog.jsonb_array_length(p_world_object_keys) > 64
       or exists (select 1 from pg_catalog.jsonb_array_elements(p_world_object_keys) k
                   where pg_catalog.jsonb_typeof(k.value) <> 'string'))) then
    raise exception 'SOURCE_DELETION_INVENTORY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_deletion_id, 0));
  select * into v_tombstone
    from public.source_deletion_tombstones
   where deletion_id = p_deletion_id
   for share;
  if not found then raise exception 'SOURCE_DELETION_INVENTORY_TOMBSTONE_MISSING'; end if;
  if v_tombstone.eligible_at > pg_catalog.clock_timestamp() then
    raise exception 'SOURCE_DELETION_INVENTORY_NOT_ELIGIBLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || v_tombstone.workspace_key, 0));
  if public.source_legal_hold_state(v_tombstone.workspace_key) = 'active' then
    raise exception 'SOURCE_LEGAL_HOLD_ACTIVE';
  elsif public.source_legal_hold_state(v_tombstone.workspace_key) <> 'inactive' then
    raise exception 'SOURCE_LEGAL_HOLD_STATE_UNKNOWN';
  end if;

  v_document_ids := public.source_deletion_document_ids(v_tombstone.deletion_id);
  v_document_keys := array(select d::text from pg_catalog.unnest(v_document_ids) d);

  if exists (
    select 1 from public.foundation_compute_reservations r
     where r.workspace_key = v_tombstone.workspace_key
       and r.document_id = any(v_document_ids)
       and r.state::text in ('reserved', 'dispatched')
  ) or exists (
    select 1 from public.foundation_compile_jobs j
     where j.workspace_key = v_tombstone.workspace_key
       and j.document_ids && v_document_keys
       and j.state::text not in ('review_required', 'ready', 'failed', 'cancelled')
  ) or exists (
    select 1 from public.foundation_jobs j
     where j.workspace_key = v_tombstone.workspace_key
       and j.job_type::text = 'source_import'
       and j.state::text in ('queued', 'leased')
  ) then
    raise exception 'SOURCE_DELETION_INVENTORY_NOT_QUIESCENT';
  end if;

  -- Re-derived here, after the quiescence check, never taken from the caller.
  v_world_keys := array(select w.object_key
    from public.source_deletion_affected_worlds(v_tombstone.deletion_id) w order by w.object_key);
  if coalesce(pg_catalog.array_length(v_world_keys, 1), 0) > 64 then
    raise exception 'SOURCE_DELETION_INVENTORY_WORLD_LIMIT';
  end if;
  v_submitted_world_keys := array(select k.value #>> '{}'
    from pg_catalog.jsonb_array_elements(coalesce(p_world_object_keys, '[]'::jsonb)) k
   order by 1);
  if v_submitted_world_keys is distinct from v_world_keys then
    raise exception 'SOURCE_DELETION_INVENTORY_WORLD_KEYS_MISMATCH';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_objects)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or pg_catalog.jsonb_typeof(v_item->'key') <> 'string'
       or pg_catalog.jsonb_typeof(v_item->'sha256') <> 'string'
       or pg_catalog.jsonb_typeof(v_item->'sizeBytes') <> 'number' then
      raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_INVALID';
    end if;
    v_key := v_item->>'key';
    v_sha := v_item->>'sha256';
    v_size_text := v_item->>'sizeBytes';
    if length(v_key) not between 1 and 1024
       or v_key like '/%' or position('..' in v_key) > 0
       or position('\\' in v_key) > 0 or position('//' in v_key) > 0
       or v_sha !~ '^sha256:[a-f0-9]{64}$'
       or v_size_text !~ '^[0-9]+$' then
      raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_INVALID';
    end if;
    v_size := v_size_text::bigint;
    if v_size > 67108864 then raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_TOO_LARGE'; end if;

    if v_key <> all(v_world_keys) and not exists (
      select 1 from pg_catalog.unnest(v_document_ids) d(document_id)
       where pg_catalog.left(v_key, length('quarantine/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'))
               = 'quarantine/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'
          or pg_catalog.left(v_key, length('immutable/' || v_tombstone.workspace_key || '/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'))
               = 'immutable/' || v_tombstone.workspace_key || '/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'
    ) then
      raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_OUT_OF_SCOPE';
    end if;
  end loop;

  select count(*), count(distinct value->>'key')
    into v_count, v_distinct_count
    from pg_catalog.jsonb_array_elements(p_objects);
  if v_count <> v_distinct_count then raise exception 'SOURCE_DELETION_INVENTORY_DUPLICATE_KEY'; end if;

  if v_count = 0 and coalesce(pg_catalog.array_length(v_document_ids, 1), 0) > 0 then
    raise exception 'SOURCE_DELETION_INVENTORY_EMPTY';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'key', value->>'key',
        'sha256', value->>'sha256',
        'sizeBytes', (value->>'sizeBytes')::bigint
      ) order by value->>'key'
    ),
    '[]'::jsonb
  ) into v_canonical
  from pg_catalog.jsonb_array_elements(p_objects);

  -- worldObjectKeys only when there is one, so a deletion with no affected World hashes exactly as
  -- it did before this migration and an earlier attestation still replays.
  v_manifest_payload := pg_catalog.jsonb_build_object(
    'schemaVersion', 'tavonel.source_deletion_inventory.v1',
    'deletionId', v_tombstone.deletion_id,
    'workspaceKey', v_tombstone.workspace_key,
    'sourceId', v_tombstone.source_id,
    'objects', v_canonical
  );
  if coalesce(pg_catalog.array_length(v_world_keys, 1), 0) > 0 then
    v_manifest_payload := v_manifest_payload
      || pg_catalog.jsonb_build_object('worldObjectKeys', pg_catalog.to_jsonb(v_world_keys));
  end if;
  v_manifest_sha := 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_manifest_payload::text, 'UTF8'), 'sha256'), 'hex');

  select * into v_existing from public.source_deletion_inventory_attestations
   where deletion_id = p_deletion_id;
  if found then
    if v_existing.inventory_manifest_sha256 is distinct from v_manifest_sha
       or v_existing.artifact_count is distinct from v_count then
      raise exception 'SOURCE_DELETION_INVENTORY_ATTESTATION_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'replayed', 'manifestSha256', v_manifest_sha, 'artifactCount', v_count);
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(v_canonical)
  loop
    perform public.enqueue_source_deletion_object(
      v_tombstone.workspace_key,
      v_tombstone.source_id,
      v_item->>'key',
      v_item->>'sha256'
    );
  end loop;

  insert into public.source_deletion_inventory_attestations
    (deletion_id, workspace_key, source_id, inventory_manifest_sha256, artifact_count, attestation_kind)
  values
    (v_tombstone.deletion_id, v_tombstone.workspace_key, v_tombstone.source_id,
     v_manifest_sha, v_count, 'complete_r2_prefix_inventory_v1');

  return pg_catalog.jsonb_build_object(
    'status', 'recorded', 'manifestSha256', v_manifest_sha, 'artifactCount', v_count);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. An invalidated World stays invalidated
-- ---------------------------------------------------------------------------------------------
--
-- transition_foundation_world_atomic (activate and rollback) and promote_foundation_candidate
-- both end in a foundation_world_versions row with lifecycle_status 'active'. Both hold the
-- per-collection pointer lock the closure takes, so this check and the closure are serialized.
-- ponytail: scans the workspace's derived receipts per activation; index derived_summary if that grows.
create function public.refuse_source_deleted_world_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lifecycle_status = 'active' and exists (
    select 1 from public.source_deletion_receipts r
     where r.workspace_key = new.workspace_key and r.action = 'derived_purged'
       and r.derived_summary->'affectedWorlds' @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
             'collectionId', new.collection_id, 'manifestDigest', new.manifest_digest))
  ) then
    raise exception 'world_source_deleted';
  end if;
  return new;
end;
$$;

create trigger foundation_world_versions_refuse_source_deleted
  before insert or update of lifecycle_status on public.foundation_world_versions
  for each row execute function public.refuse_source_deleted_world_activation();

-- 0021's guard read the version without a lock, so a run could be created against a version the
-- closure was superseding in a concurrent transaction and then write units the closure never saw.
-- FOR SHARE waits for that transaction and re-reads the committed lifecycle_status. Same check,
-- same error.
create or replace function public.enforce_foundation_retrieval_compile_run_active_world()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.foundation_world_versions
   where workspace_key = new.workspace_key
     and collection_id = new.collection_id
     and manifest_digest = new.world_manifest_digest
     and lifecycle_status = 'active'
   for share;
  if not found then
    raise exception 'retrieval_compile_run_requires_active_world';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. The closure: body of 20260927104000 plus the affected Worlds
-- ---------------------------------------------------------------------------------------------

-- ponytail: linear scan of attested tombstones without a derived receipt; index if that set grows.
-- ponytail: lower(document_id) cannot use the (workspace_key, document_id) index; bounded by workspace.
create or replace function public.close_source_deletion_derived()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tombstone public.source_deletion_tombstones%rowtype;
  v_document_keys text[];
  v_affected jsonb;
  v_collection text;
  v_world_units integer;
  v_pointers integer;
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
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'collectionId', w.collection_id, 'manifestDigest', w.manifest_digest)
             order by w.collection_id, w.manifest_digest), '[]'::jsonb)
      into v_affected
      from public.source_deletion_affected_worlds(v_tombstone.deletion_id) w;

    -- The pointer lock transition_foundation_world_atomic takes, collection by collection in one
    -- order, then the version rows: an activation, rollback or new retrieval run on an affected
    -- World either committed before this point or waits for this transaction.
    for v_collection in
      select distinct a.value->>'collectionId' from pg_catalog.jsonb_array_elements(v_affected) a order by 1
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_tombstone.workspace_key || pg_catalog.chr(31) || v_collection, 0));
    end loop;
    perform 1 from public.foundation_world_versions v
      join pg_catalog.jsonb_array_elements(v_affected) a
        on v.collection_id = a.value->>'collectionId' and v.manifest_digest = a.value->>'manifestDigest'
     where v.workspace_key = v_tombstone.workspace_key
       for update of v;
    -- Re-read after the locks: a run created while this transaction waited is visible now.
    continue when exists (
      select 1 from public.foundation_retrieval_compile_runs r
       where r.workspace_key = v_tombstone.workspace_key and r.status in ('pending', 'running'));

    -- Evidence first, from the rows about to change.
    select pg_catalog.count(*)::integer into v_embeddings
      from public.foundation_retrieval_embeddings e
      join public.foundation_retrieval_units u on u.workspace_key = e.workspace_key and u.unit_id = e.unit_id
      join public.foundation_retrieval_compile_runs r
        on r.workspace_key = u.workspace_key and r.run_id = u.compile_run_id
     where u.workspace_key = v_tombstone.workspace_key
       and ((pg_catalog.lower(u.document_id) = any(v_document_keys)
             and u.unit_type = any(public.source_deletion_exclusive_unit_types()))
         or exists (select 1 from pg_catalog.jsonb_array_elements(v_affected) a
                     where a.value->>'collectionId' = r.collection_id
                       and a.value->>'manifestDigest' = r.world_manifest_digest));

    -- The whole affected World: every unit of its runs, shared summaries included.
    delete from public.foundation_retrieval_units u
     using public.foundation_retrieval_compile_runs r
     where r.workspace_key = u.workspace_key and r.run_id = u.compile_run_id
       and u.workspace_key = v_tombstone.workspace_key
       and exists (select 1 from pg_catalog.jsonb_array_elements(v_affected) a
                    where a.value->>'collectionId' = r.collection_id
                      and a.value->>'manifestDigest' = r.world_manifest_digest);
    get diagnostics v_world_units = row_count;

    delete from public.foundation_active_worlds p
     where p.workspace_key = v_tombstone.workspace_key
       and exists (select 1 from pg_catalog.jsonb_array_elements(v_affected) a
                    where a.value->>'collectionId' = p.collection_id
                      and a.value->>'manifestDigest' = p.manifest_digest);
    get diagnostics v_pointers = row_count;
    update public.foundation_world_versions v
       set lifecycle_status = 'superseded'
     where v.workspace_key = v_tombstone.workspace_key and v.lifecycle_status = 'active'
       and exists (select 1 from pg_catalog.jsonb_array_elements(v_affected) a
                    where a.value->>'collectionId' = v.collection_id
                      and a.value->>'manifestDigest' = v.manifest_digest);

    -- What remains naming the document belongs to a World with no persisted compile association.
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

    delete from public.foundation_retrieval_units u
     where u.workspace_key = v_tombstone.workspace_key
       and pg_catalog.lower(u.document_id) = any(v_document_keys)
       and u.unit_type = any(public.source_deletion_exclusive_unit_types());
    get diagnostics v_units = row_count;

    delete from public.foundation_operation_leases l
     where l.workspace_key = v_tombstone.workspace_key and l.expires_at <= pg_catalog.clock_timestamp();
    get diagnostics v_cache = row_count;

    v_summary := pg_catalog.jsonb_build_object(
      'retrievalUnitsErased', v_world_units + v_units,
      'worldRetrievalUnitsErased', v_world_units,
      'retrievalEmbeddingsErased', v_embeddings,
      'expiredWorkspaceCacheRowsErased', v_cache,
      'retrievalUnitsRetainedUnproven', v_unproven,
      'indexedWorldVersionsRetained', v_worlds,
      'affectedWorlds', v_affected,
      'activeWorldPointersInvalidated', v_pointers);
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

revoke all on function public.source_deletion_affected_worlds(text),
  public.refuse_source_deleted_world_activation(),
  public.source_deletion_inventory_candidate(),
  public.attest_source_deletion_inventory(text, jsonb, jsonb),
  public.close_source_deletion_derived()
  from public, anon, authenticated;
revoke all on function public.source_deletion_affected_worlds(text),
  public.refuse_source_deleted_world_activation()
  from service_role;
grant execute on function public.source_deletion_inventory_candidate(),
  public.attest_source_deletion_inventory(text, jsonb, jsonb),
  public.close_source_deletion_derived()
  to service_role;

commit;
