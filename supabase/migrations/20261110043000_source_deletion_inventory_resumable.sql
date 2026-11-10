-- Migration 20261110043000: a deletion inventory is attested across runs (ADR-0006, Bound E5).
--
-- Before: the inventory worker listed every object of a tombstone, hashed all of them inside one
-- 60 s invocation and handed the whole list to attest_source_deletion_inventory, which refused more
-- than 512 objects (the worker also stopped at 1 GiB). A deletion naming several segmented
-- 500-page sources (about 100 objects and up to about 460 MiB each) was refused on every run, so it
-- could never be purged.
--
-- Now:
--   1. source_deletion_inventory_digests keeps the worker's per-object digests between runs, keyed
--      by (deletion_id, object_key) with the listed size. It is a work table, not evidence: the
--      worker discards it whenever the listing no longer matches it, and nothing is sealed from it
--      except through 4.
--   2. record_source_deletion_inventory_digest upserts one hashed object, under the deletion's
--      advisory lock. It refuses the 16,385th object and a set past 64 GiB (68,719,476,736 bytes):
--      128 documents (the candidate's own bound) x 128 objects, and x 512 MiB.
--   3. read_source_deletion_inventory_digests returns the rows ordered by key, and
--      digestSetSha256 over exactly that array. discard_source_deletion_inventory_digests empties
--      the rows of one deletion.
--   4. seal_source_deletion_inventory takes the digestSetSha256 the worker read after it checked
--      the rows against two identical listings. Under the same lock it recomputes the set; any row
--      written or discarded since (an overlapping run) is SOURCE_DELETION_INVENTORY_DIGESTS_CHANGED.
--      An equal set is handed, unchanged, to attest_source_deletion_inventory, which keeps every
--      check it had: tombstone, eligibility, legal hold, quiescence, World keys, key scope,
--      duplicates, the empty refusal, the manifest digest and idempotent replay.
--   5. attest_source_deletion_inventory accepts up to 16,384 objects (was 512). It is patched in
--      place from its installed definition (20260930013000), as 20261110041500 did, and refuses a
--      body it does not recognise. The 64 MiB per-object bound is unchanged.
--
-- The purge consumer (claim_source_deletion_sweep) claims one object at a time from
-- source_deletion_objects and has no count bound, so it needs no change.
--
-- Create-once (create table): not part of the replay step in db-rehearsal.yml.
-- Rollback: supabase/drafts/rollback-20261110043000-source-deletion-inventory-resumable.sql.

create table public.source_deletion_inventory_digests (
  deletion_id text not null references public.source_deletion_tombstones(deletion_id) on delete cascade,
  object_key text not null check (length(object_key) between 1 and 1024),
  size_bytes bigint not null check (size_bytes between 0 and 67108864),
  object_sha256 text not null check (object_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (deletion_id, object_key)
);

alter table public.source_deletion_inventory_digests enable row level security;
revoke all on public.source_deletion_inventory_digests from public, anon, authenticated, service_role;

create or replace function public.record_source_deletion_inventory_digest(
  p_deletion_id text, p_object_key text, p_size_bytes bigint, p_sha256 text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_bytes numeric;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$'
     or p_object_key is null or length(p_object_key) not between 1 and 1024
     or p_size_bytes is null or p_size_bytes not between 0 and 67108864
     or p_sha256 is null or p_sha256 !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_deletion_id, 0));
  perform 1 from public.source_deletion_tombstones where deletion_id = p_deletion_id;
  if not found then raise exception 'SOURCE_DELETION_INVENTORY_TOMBSTONE_MISSING'; end if;

  -- ponytail: one count per recorded object, O(n) each; a running total if 16,384 rows ever shows up in latency.
  select pg_catalog.count(*), coalesce(pg_catalog.sum(d.size_bytes), 0)
    into v_count, v_bytes
    from public.source_deletion_inventory_digests d
   where d.deletion_id = p_deletion_id and d.object_key <> p_object_key;
  if v_count >= 16384 then raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_LIMIT'; end if;
  if v_bytes + p_size_bytes > 68719476736 then raise exception 'SOURCE_DELETION_INVENTORY_TOTAL_TOO_LARGE'; end if;

  insert into public.source_deletion_inventory_digests (deletion_id, object_key, size_bytes, object_sha256)
  values (p_deletion_id, p_object_key, p_size_bytes, p_sha256)
  on conflict (deletion_id, object_key) do update
    set size_bytes = excluded.size_bytes,
        object_sha256 = excluded.object_sha256,
        recorded_at = pg_catalog.clock_timestamp();
end;
$$;

create or replace function public.read_source_deletion_inventory_digests(p_deletion_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_objects jsonb;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'SOURCE_DELETION_INVENTORY_INVALID';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'key', d.object_key, 'sha256', d.object_sha256, 'sizeBytes', d.size_bytes)
           order by d.object_key collate "C"), '[]'::jsonb)
    into v_objects
    from public.source_deletion_inventory_digests d
   where d.deletion_id = p_deletion_id;
  return pg_catalog.jsonb_build_object(
    'objects', v_objects,
    'digestSetSha256', 'sha256:' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_objects::text, 'UTF8'), 'sha256'), 'hex'));
end;
$$;

create or replace function public.discard_source_deletion_inventory_digests(p_deletion_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'SOURCE_DELETION_INVENTORY_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_deletion_id, 0));
  delete from public.source_deletion_inventory_digests where deletion_id = p_deletion_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.seal_source_deletion_inventory(
  p_deletion_id text,
  p_digest_set_sha256 text,
  p_world_object_keys jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set jsonb;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$'
     or p_digest_set_sha256 is null or p_digest_set_sha256 !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'SOURCE_DELETION_INVENTORY_INVALID';
  end if;
  -- The lock every digest writer takes, so the set compared here is the set attested below.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_deletion_id, 0));
  v_set := public.read_source_deletion_inventory_digests(p_deletion_id);
  if v_set->>'digestSetSha256' is distinct from p_digest_set_sha256 then
    raise exception 'SOURCE_DELETION_INVENTORY_DIGESTS_CHANGED';
  end if;
  return public.attest_source_deletion_inventory(p_deletion_id, v_set->'objects', p_world_object_keys);
end;
$$;

do $$
declare
  v_definition text;
  v_old_bound text := 'pg_catalog.jsonb_array_length(p_objects) > 512';
  v_new_bound text := 'pg_catalog.jsonb_array_length(p_objects) > 16384';
begin
  v_definition := pg_get_functiondef(
    'public.attest_source_deletion_inventory(text,jsonb,jsonb)'::regprocedure
  );
  if position(v_new_bound in v_definition) > 0 and position(v_old_bound in v_definition) = 0 then
    return;
  end if;
  -- Exactly one occurrence of the old bound, and none of the new one.
  if length(v_definition) - length(replace(v_definition, v_old_bound, '')) <> length(v_old_bound)
     or position(v_new_bound in v_definition) > 0 then
    raise exception 'source_deletion_inventory_resumable_definition_unexpected';
  end if;
  execute replace(v_definition, v_old_bound, v_new_bound);
end;
$$;

revoke all on function public.record_source_deletion_inventory_digest(text, text, bigint, text),
  public.read_source_deletion_inventory_digests(text),
  public.discard_source_deletion_inventory_digests(text),
  public.seal_source_deletion_inventory(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_source_deletion_inventory_digest(text, text, bigint, text),
  public.read_source_deletion_inventory_digests(text),
  public.discard_source_deletion_inventory_digests(text),
  public.seal_source_deletion_inventory(text, text, jsonb)
  to service_role;
