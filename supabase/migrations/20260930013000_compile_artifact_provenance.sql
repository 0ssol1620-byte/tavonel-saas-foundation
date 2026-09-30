-- Gate 11: every stored World candidate names the documents it was compiled from.
--
-- 20260930010000 read "which Worlds include this document" from compile job rows only. Writers
-- put a candidate-world.json in R2 without a job row that names it: the synchronous
-- POST /api/collections/compile, a late compile turn whose digest the job row refuses
-- (20260930012000), and the review patch route's derived candidate. A deleted document stayed
-- inside those objects and nothing enqueued them.
--
-- Now:
--   1. foundation_collection_artifact_provenance is an append-only, workspace-scoped registry:
--      one row per publication attempt, holding the exact collection, digest, canonical object key
--      and the non-empty set of document UUIDs. Hashes and ids only, never content.
--   2. register_collection_artifact_provenance runs BEFORE the R2 PUT, under the per-workspace
--      lock every tombstone writer and the attestation take ('tavonel.source_legal_hold.v1').
--      It refuses a document that is tombstoned or blocked, and a key already registered with a
--      different document set. Each row carries publish_by (now + 120 s): the writer starts its
--      PUT only while at least 30 s of that remain (the PUT itself times out at 8 s).
--   3. Because a registration cannot commit after a tombstone for any of its documents, every
--      registration relevant to a deletion committed before it, and its publish window closes at
--      most 120 s later. The inventory candidate passes over a tombstone while any such window is
--      open, so the worker's R2 listing -- taken after the candidate -- starts only once no
--      further PUT can land. The attestation re-checks the same condition under its locks.
--   4. source_deletion_affected_worlds = the job rule UNION this registry. The candidate, the
--      attestation, the closure and the activation guard all read that one helper, so a registered
--      object is enqueued for purge, its World is invalidated, and it cannot be activated again.
--
-- Not covered here: founder_test_reset does not clear this registry (rows are ids and hashes; a
-- reset workspace's leftover keys are listed absent). A document id that is not a UUID cannot be
-- registered; the compile refuses such a set before dispatch instead of publishing it unregistered.
--
-- Create-once (create table): not part of the replay step in db-rehearsal.yml.
begin;

create table public.foundation_collection_artifact_provenance (
  registration_id bigint generated always as identity primary key,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  collection_id text not null check (collection_id ~ '^collection-[a-f0-9]{32}$'),
  manifest_digest text not null check (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  object_key text not null,
  document_ids uuid[] not null check (
    pg_catalog.cardinality(document_ids) between 1 and 1000
    and pg_catalog.array_position(document_ids, null) is null),
  publish_by timestamptz not null,
  registered_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (object_key = 'immutable/' || workspace_key || '/' || workspace_key || '/collections/'
    || collection_id || '/' || pg_catalog.substr(manifest_digest, 8) || '/candidate-world.json'),
  check (publish_by > registered_at and publish_by <= registered_at + interval '120 seconds')
);
-- ponytail: document_ids && scans the workspace's rows; add a GIN index if one workspace grows large.
create index foundation_collection_artifact_provenance_scope_idx
  on public.foundation_collection_artifact_provenance (workspace_key, object_key);

alter table public.foundation_collection_artifact_provenance enable row level security;
revoke all on public.foundation_collection_artifact_provenance from public, anon, authenticated, service_role;

create function public.refuse_collection_artifact_provenance_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'foundation_collection_artifact_provenance_append_only';
end;
$$;
create trigger foundation_collection_artifact_provenance_append_only
  before update or delete on public.foundation_collection_artifact_provenance
  for each row execute function public.refuse_collection_artifact_provenance_mutation();

-- ---------------------------------------------------------------------------------------------
-- 1. Registration, before the PUT
-- ---------------------------------------------------------------------------------------------
-- ponytail: one scan of the workspace's tombstones per registration.
create function public.register_collection_artifact_provenance(
  p_workspace_key text,
  p_collection_id text,
  p_manifest_digest text,
  p_document_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_documents uuid[];
  v_key text;
  v_now timestamptz;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_collection_id is null or p_collection_id !~ '^collection-[a-f0-9]{32}$'
     or p_manifest_digest is null or p_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
     or p_document_ids is null or pg_catalog.cardinality(p_document_ids) not between 1 and 1000
     or pg_catalog.array_position(p_document_ids, null) is not null then
    raise exception 'COLLECTION_ARTIFACT_PROVENANCE_INVALID';
  end if;
  v_documents := array(select distinct d from pg_catalog.unnest(p_document_ids) d order by 1);
  v_key := 'immutable/' || p_workspace_key || '/' || p_workspace_key || '/collections/' || p_collection_id
    || '/' || pg_catalog.substr(p_manifest_digest, 8) || '/candidate-world.json';

  -- The lock every tombstone writer and the attestation hold: a registration either commits
  -- before a tombstone for its documents exists, or sees it and is refused.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || p_workspace_key, 0));

  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = p_workspace_key
                and public.source_deletion_document_ids(t.deletion_id) && v_documents) then
    raise exception 'COLLECTION_ARTIFACT_SOURCE_DELETED';
  end if;
  if public.connector_documents_blocked(p_workspace_key,
       array(select d::text from pg_catalog.unnest(v_documents) d)) then
    raise exception 'COLLECTION_ARTIFACT_SOURCE_BLOCKED';
  end if;
  if exists (select 1 from public.foundation_collection_artifact_provenance p
              where p.workspace_key = p_workspace_key and p.object_key = v_key
                and p.document_ids <> v_documents) then
    raise exception 'COLLECTION_ARTIFACT_PROVENANCE_CONFLICT';
  end if;

  v_now := pg_catalog.clock_timestamp();
  insert into public.foundation_collection_artifact_provenance
    (workspace_key, collection_id, manifest_digest, object_key, document_ids, publish_by, registered_at)
  values (p_workspace_key, p_collection_id, p_manifest_digest, v_key, v_documents,
    v_now + interval '120 seconds', v_now);

  return pg_catalog.jsonb_build_object('objectKey', v_key, 'leaseSeconds', 120);
end;
$$;

-- True while a registration naming any of these documents may still be followed by its PUT.
create function public.source_deletion_publication_open(p_workspace_key text, p_document_ids uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.foundation_collection_artifact_provenance p
                  where p.workspace_key = p_workspace_key
                    and p.document_ids && p_document_ids
                    and p.publish_by > pg_catalog.clock_timestamp());
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. The affected-World rule: the job rule of 20260930010000, UNION the registry
-- ---------------------------------------------------------------------------------------------
create or replace function public.source_deletion_affected_worlds(p_deletion_id text)
returns table (collection_id text, manifest_digest text, object_key text)
language sql stable security definer set search_path = '' as $$
  select distinct w.collection_id, w.manifest_digest, w.object_key from (
    select j.collection_id, j.candidate_manifest_digest as manifest_digest,
      coalesce(v.candidate_object_key,
        'immutable/' || t.workspace_key || '/' || t.workspace_key || '/collections/' || j.collection_id
          || '/' || pg_catalog.substr(j.candidate_manifest_digest, 8) || '/candidate-world.json') as object_key
      from public.source_deletion_tombstones t
      join public.foundation_compile_jobs j on j.workspace_key = t.workspace_key
      left join public.foundation_world_versions v
        on v.workspace_key = j.workspace_key and v.collection_id = j.collection_id
       and v.manifest_digest = j.candidate_manifest_digest
     where t.deletion_id = p_deletion_id
       and j.collection_id is not null
       and j.candidate_manifest_digest is not null
       and j.document_ids && array(select d::text
             from pg_catalog.unnest(public.source_deletion_document_ids(t.deletion_id)) d)
    union all
    select p.collection_id, p.manifest_digest, p.object_key
      from public.source_deletion_tombstones t
      join public.foundation_collection_artifact_provenance p on p.workspace_key = t.workspace_key
     where t.deletion_id = p_deletion_id
       and p.document_ids && public.source_deletion_document_ids(t.deletion_id)
  ) w;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Candidate and attestation: bodies identical to 20260930010000 plus the open-publication check
-- ---------------------------------------------------------------------------------------------

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
    ) or public.source_deletion_publication_open(v_tombstone.workspace_key, v_document_ids);

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

create or replace function public.attest_source_deletion_inventory(
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
  ) or public.source_deletion_publication_open(v_tombstone.workspace_key, v_document_ids) then
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

revoke all on function public.register_collection_artifact_provenance(text, text, text, uuid[]),
  public.source_deletion_publication_open(text, uuid[]),
  public.refuse_collection_artifact_provenance_mutation(),
  public.source_deletion_affected_worlds(text),
  public.source_deletion_inventory_candidate(),
  public.attest_source_deletion_inventory(text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.source_deletion_publication_open(text, uuid[]),
  public.refuse_collection_artifact_provenance_mutation(),
  public.source_deletion_affected_worlds(text)
  from service_role;
grant execute on function public.register_collection_artifact_provenance(text, text, text, uuid[]),
  public.source_deletion_inventory_candidate(),
  public.attest_source_deletion_inventory(text, jsonb, jsonb)
  to service_role;

commit;
