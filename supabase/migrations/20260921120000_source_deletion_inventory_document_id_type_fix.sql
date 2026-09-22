-- The 20260921110000 attestation functions compare `foundation_compile_jobs.document_ids`
-- (text[], from 0038) against a uuid[] built from connector_document_bindings.document_id.
-- PostgreSQL has no `text[] && uuid[]` operator, so both functions raised
--   operator does not exist: text[] && uuid[]
-- on every call that reached the quiescence check -- which is every call that finds an eligible
-- tombstone. The gate therefore failed closed and physical deletion could never start: the
-- candidate reader always errored, no attestation could ever be recorded, and
-- claim_source_deletion_sweep had nothing to hand a worker.
--
-- Measured on a disposable PostgreSQL 17 with the whole chain applied from empty, 2026-09-21.
--
-- The fix carries the document set in both representations and compares each column against its
-- own type. Casting the job column to uuid[] instead was rejected: document_ids has no uuid
-- CHECK, so one non-uuid row in that table would turn this guard back into an error -- and an
-- error here blocks deletion for every workspace, not only that job's. `enqueueCompileJob` now
-- refuses a non-canonical document id, so the text comparison below can only miss a row that
-- predates that guard.
--
-- It also refuses an empty inventory for a source that still has bound documents. See the
-- SOURCE_DELETION_INVENTORY_EMPTY block below.
begin;

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
  select t.* into v_tombstone
    from public.source_deletion_tombstones t
   where t.eligible_at <= pg_catalog.clock_timestamp()
     and public.source_legal_hold_state(t.workspace_key) = 'inactive'
     and not exists (
       select 1 from public.source_deletion_inventory_attestations a
        where a.deletion_id = t.deletion_id
     )
   order by t.requested_at, t.deletion_id
   limit 1;
  if not found then return null; end if;

  select coalesce(pg_catalog.array_agg(distinct b.document_id order by b.document_id), '{}'::uuid[])
    into v_document_ids
    from public.connector_document_bindings b
   where b.workspace_key = v_tombstone.workspace_key
     and b.source_id = v_tombstone.source_id;
  v_document_keys := array(select d::text from pg_catalog.unnest(v_document_ids) d);

  -- Do not freeze an inventory while a producer can still write another artifact.
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
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'deletionId', v_tombstone.deletion_id,
    'workspaceKey', v_tombstone.workspace_key,
    'sourceId', v_tombstone.source_id,
    'documentIds', pg_catalog.to_jsonb(v_document_ids)
  );
end;
$$;

create or replace function public.attest_source_deletion_inventory(
  p_deletion_id text,
  p_objects jsonb
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
     or pg_catalog.jsonb_array_length(p_objects) > 512 then
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

  select coalesce(pg_catalog.array_agg(distinct b.document_id order by b.document_id), '{}'::uuid[])
    into v_document_ids
    from public.connector_document_bindings b
   where b.workspace_key = v_tombstone.workspace_key
     and b.source_id = v_tombstone.source_id;
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

    if not exists (
      select 1 from pg_catalog.unnest(v_document_ids) d(document_id)
       where pg_catalog.left(v_key, length('quarantine/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'))
               = 'quarantine/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'
          or pg_catalog.left(v_key, length('immutable/' || v_tombstone.workspace_key || '/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'))
               = 'immutable/' || v_tombstone.workspace_key || '/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'
    ) then
      raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_OUT_OF_SCOPE';
    end if;
  end loop;

  -- 20260921110000 selected `count(distinct value->>'key')` into v_size, a bigint that was still
  -- holding the last object's byte length. It happened to work because the variable was dead by
  -- then, but a duplicate-key check reading a size variable is one edit away from being wrong.
  select count(*), count(distinct value->>'key')
    into v_count, v_distinct_count
    from pg_catalog.jsonb_array_elements(p_objects);
  if v_count <> v_distinct_count then raise exception 'SOURCE_DELETION_INVENTORY_DUPLICATE_KEY'; end if;

  -- An empty listing for a source that still has bound documents seals the deletion as a
  -- complete inventory of nothing: artifact_count 0, attestation_kind
  -- 'complete_r2_prefix_inventory_v1', no object enqueued, and every later attestation of the
  -- real objects rejected as an ATTESTATION_CONFLICT for good. A worker whose R2 listing failed
  -- open, or that was handed a truncated page, submits exactly this. Refuse it: the empty array
  -- is indistinguishable from a listing that did not happen, and this row is the record that
  -- the customer's bytes were accounted for.
  --
  -- The cost is deliberate. A source whose documents genuinely hold no objects cannot be
  -- attested through this path and needs an operator, because 'there was nothing there' and
  -- 'we could not see what was there' look identical from here and only one of them is safe.
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

  v_manifest_payload := pg_catalog.jsonb_build_object(
    'schemaVersion', 'tavonel.source_deletion_inventory.v1',
    'deletionId', v_tombstone.deletion_id,
    'workspaceKey', v_tombstone.workspace_key,
    'sourceId', v_tombstone.source_id,
    'objects', v_canonical
  );
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

revoke all on function public.source_deletion_inventory_candidate(),
  public.attest_source_deletion_inventory(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.source_deletion_inventory_candidate(),
  public.attest_source_deletion_inventory(text, jsonb)
  to service_role;

commit;
