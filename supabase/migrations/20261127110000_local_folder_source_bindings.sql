-- WO-LF-2: local-folder sources get a logical identity, an access suspension when they leave the
-- folder, and a legal-hold-gated deletion receipt -- all inside the batch transaction that already
-- advances the connection cursor.
--
-- DRAFT. Not applied by its author; the lead dispatches the hosted DB rehearsal
-- (supabase/tests/local_folder_source_bindings.sql is the proof) before this reaches any project.
-- Ordering: 20261127110000, after 20261127050000. Rollback: supabase/drafts/rollback-20261127110000-
-- local-folder-source-bindings.sql.
--
-- What was missing (receipts/WO-LOCAL-FOLDER-1/REPORT.md D2, D3, D4):
--   D2  a `deleted` event was stored in the batch manifest and nothing read it.
--   D3  a local document had no logical identity: every edit became a new, equally current document,
--       and connector_documents_blocked joined OAuth bindings only, so a local document was outside the
--       revoke/suspension check that every read, Ask and compile path calls.
--   D4  (route side, nextjs) the upload capability carried no connection id.
--
-- What this adds (expand only; no OAuth table, row or function body changes meaning):
--
--   1. foundation_connection_sources: one row per logical local source, keyed by
--      (workspace, foundation connection, native id, generation). The revision is never part of it.
--      current_source_version_id names the version the folder holds now; an edit moves it, so one
--      logical source has exactly one current document.
--   2. foundation_connection_source_versions: one immutable row per (source, revision, document).
--      The version id carries the revision and the document id: a revert to earlier bytes through the
--      per-file path (same document id) is a re-observation that moves `current` back; through the
--      approval path (a new document id) it is a new version. A document belongs to one source.
--   3. apply_foundation_connection_batch writes both, for file_server connections only, after proving
--      each bound document is a confirmed upload of this workspace with the event's byte count and
--      digest. Other connection kinds (s3/r2/minio) keep today's behaviour exactly.
--   4. A `deleted` event for a bound, unsuspended source always records an access suspension in
--      connector_source_suspensions (the OAuth table, reused). Only an event that also carries
--      `"removal": "deleted"` records deletion receipts, per document, through the existing upload
--      tombstone path with the new reason 'source_removed', under the same deletion -> intake ->
--      legal-hold lock order as every other deletion:
--        hold inactive -> 'recorded'; hold active -> 'held' (tombstoned, the sweeper waits);
--        hold unreadable -> 'deferred' (no tombstone; the suspension still blocks access).
--      `"removal": "out_of_scope"`, or no removal field (every client released before LF-1), is a
--      suspension only: bytes are kept and the customer decides in the Library. Re-adding the same
--      path later starts a new generation, i.e. a new logical source.
--   5. connector_documents_blocked gains one more `or exists`: a document of a local version is
--      blocked when its connection is revoked or paused, or its source is suspended. The OAuth and
--      upload-tombstone clauses are unchanged, so every serving path sees the same deny.
--   6. guard_connector_source_suspension accepts a local source as bound (after the unchanged OAuth
--      lookup).
--
-- Scope wording (docs/ip/TECHNOLOGY_INTAKE_REGISTER.yaml, tech_palantir_propagated_deletion,
-- DESIGN_AROUND): this is access suspension of removed sources and a legal-hold-gated deletion
-- receipt. It walks no derivation graph and rebuilds nothing downstream.
--
-- Not done here, deliberately: the founder test reset does not yet archive or delete the two new
-- tables. Their restrict foreign keys make a reset of a workspace that holds local versions fail
-- loudly instead of leaving file paths behind (the 20261002100000 precedent); the fence triggers below
-- keep them write-fenced during a sealed reset.
--
-- Create-once (create table, add constraint): not part of the replay step in db-rehearsal.yml. Every
-- statement is nevertheless guarded (if not exists / drop if exists + add / create or replace), so a
-- second application is a no-op.
--
-- predecessor-hash: public.apply_foundation_connection_batch 31e7ace391be98b46f359cdbdad20cb92944bd0464009a4394b172b62dd75a2a
-- predecessor: public.apply_foundation_connection_batch 20261004100000
-- predecessor-hash: public.connector_documents_blocked f33a37de1a2aafa90b8743bab6a2f0fa472369d5c374a80d24bca89d4508de01
-- predecessor: public.connector_documents_blocked 20260927102000
-- predecessor-hash: public.guard_connector_source_suspension 72b746e09d3def2f4d901075671443d5cca41ef0d3abaf633732830cfdbfe395
-- predecessor: public.guard_connector_source_suspension 20260920133000
begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Logical local sources and their versions
-- ---------------------------------------------------------------------------------------------

create table if not exists public.foundation_connection_sources (
  source_id text primary key check (source_id ~ '^src-[a-f0-9]{64}$'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  connection_id uuid not null references public.foundation_connections(connection_id) on delete restrict,
  native_id text not null check (char_length(native_id) between 1 and 1024 and native_id !~ '[\x01-\x1f\x7f]'),
  generation integer not null check (generation between 0 and 1000000),
  current_source_version_id text not null check (current_source_version_id ~ '^sv-[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (connection_id, native_id, generation)
);

create table if not exists public.foundation_connection_source_versions (
  source_version_id text primary key check (source_version_id ~ '^sv-[a-f0-9]{64}$'),
  source_id text not null references public.foundation_connection_sources(source_id) on delete restrict,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  connection_id uuid not null references public.foundation_connections(connection_id) on delete restrict,
  revision text not null check (char_length(revision) between 1 and 512 and revision !~ '[\x01-\x1f\x7f]'),
  document_id uuid not null,
  content_sha256 text not null check (content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  byte_length bigint not null check (byte_length > 0),
  mime_type text not null check (char_length(mime_type) between 3 and 160),
  batch_id uuid not null references public.foundation_connection_batches(batch_id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (workspace_key, document_id)
);
create index if not exists foundation_connection_source_versions_source_idx
  on public.foundation_connection_source_versions (source_id);

-- The source row is written first and names its version in the same transaction.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conname = 'foundation_connection_sources_current_version_fkey') then
    alter table public.foundation_connection_sources
      add constraint foundation_connection_sources_current_version_fkey
      foreign key (current_source_version_id)
      references public.foundation_connection_source_versions(source_version_id)
      on delete restrict deferrable initially deferred;
  end if;
end;
$$;

-- Identity is immutable; only the current pointer moves. Versions are append-only.
create or replace function public.guard_foundation_connection_source() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'CONNECTION_SOURCE_IMMUTABLE'; end if;
  if tg_op = 'UPDATE' and (new.source_id is distinct from old.source_id
      or new.workspace_key is distinct from old.workspace_key or new.connection_id is distinct from old.connection_id
      or new.native_id is distinct from old.native_id or new.generation is distinct from old.generation
      or new.created_at is distinct from old.created_at) then
    raise exception 'CONNECTION_SOURCE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create or replace function public.guard_foundation_connection_source_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'CONNECTION_SOURCE_VERSION_IMMUTABLE';
end;
$$;

drop trigger if exists foundation_connection_source_guard on public.foundation_connection_sources;
create trigger foundation_connection_source_guard before update or delete
  on public.foundation_connection_sources for each row execute function public.guard_foundation_connection_source();
drop trigger if exists foundation_connection_source_version_guard on public.foundation_connection_source_versions;
create trigger foundation_connection_source_version_guard before update or delete
  on public.foundation_connection_source_versions for each row
  execute function public.guard_foundation_connection_source_version();

-- The founder test reset's write fence (20260920133000), as every other workspace table has.
drop trigger if exists founder_reset_fence on public.foundation_connection_sources;
create trigger founder_reset_fence before insert or update or delete on public.foundation_connection_sources
  for each row execute function public.guard_founder_test_reset_workspace_write();
drop trigger if exists founder_reset_fence on public.foundation_connection_source_versions;
create trigger founder_reset_fence before insert or update or delete on public.foundation_connection_source_versions
  for each row execute function public.guard_founder_test_reset_workspace_write();

alter table public.foundation_connection_sources enable row level security;
alter table public.foundation_connection_source_versions enable row level security;
revoke all on public.foundation_connection_sources, public.foundation_connection_source_versions
  from public, anon, authenticated, service_role;
-- Read-only to the server (the change inbox and Library read `current` from here, LF-3). Every
-- write is the batch function's, as its owner.
grant select on public.foundation_connection_sources, public.foundation_connection_source_versions to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Identity. Spelled exactly as nextjs/lib/connector-source-identity.ts localFolderSourceIdentity
--    spells it (JSON.stringify of an array; to_json escapes the same way, control characters are
--    refused by the table checks). Generation 0 has no fifth element.
-- ---------------------------------------------------------------------------------------------

create or replace function public.local_folder_source_identity(
  p_workspace_key text, p_connection_id uuid, p_native_id text, p_generation integer,
  p_revision text, p_document_id uuid, out source_id text, out source_version_id text)
language plpgsql immutable set search_path = '' as $$
begin
  source_id := 'src-' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    '["connector.v1",' || pg_catalog.to_json(p_workspace_key)::text || ',' || pg_catalog.to_json(p_connection_id::text)::text
      || ',"local_folder",' || pg_catalog.to_json(p_native_id)::text
      || case when p_generation = 0 then '' else ',' || p_generation::text end || ']', 'UTF8'), 'sha256'), 'hex');
  source_version_id := 'sv-' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    '[' || pg_catalog.to_json(source_id)::text || ',' || pg_catalog.to_json(p_revision)::text || ','
      || pg_catalog.to_json(p_document_id::text)::text || ']', 'UTF8'), 'sha256'), 'hex');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. A local source's removal: suspension always, deletion receipts only when asked
-- ---------------------------------------------------------------------------------------------

alter table public.source_deletion_tombstones drop constraint if exists source_deletion_tombstones_reason_check;
alter table public.source_deletion_tombstones add constraint source_deletion_tombstones_reason_check
  check (reason in ('provider_deleted', 'provider_inaccessible', 'customer_requested', 'retention_expired',
    'source_removed'));
alter table public.source_deletion_tombstones drop constraint if exists source_deletion_tombstones_kind_shape;
alter table public.source_deletion_tombstones add constraint source_deletion_tombstones_kind_shape check (
  (reason in ('provider_deleted', 'provider_inaccessible')
    and oauth_connection_id is not null and provider is not null
    and document_id is null and requested_by_user_id is null and request_manifest_sha256 is null)
  or (reason = 'customer_requested'
    and oauth_connection_id is null and provider is null
    and document_id is not null and source_id = document_id::text
    and requested_by_user_id is not null and request_manifest_sha256 is not null)
  or (reason in ('retention_expired', 'source_removed')
    and oauth_connection_id is null and provider is null
    and document_id is not null and source_id = document_id::text
    and requested_by_user_id is null and request_manifest_sha256 is null)
);

-- Internal: called by apply_foundation_connection_batch only, which already holds, in order, the
-- deletion lock of every document named here, the workspace intake lock and the legal-hold lock.
-- Returns 'suspended' | 'recorded' | 'held' | 'deferred' for the one logical source.
create or replace function public.record_connection_source_removal(
  p_workspace_key text, p_source_id text, p_request_deletion boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_hold text;
  v_grace integer;
  v_now timestamptz;
  v_version record;
begin
  insert into public.connector_source_suspensions (source_id, workspace_key, reason)
  values (p_source_id, p_workspace_key, 'removed_or_inaccessible')
  on conflict (source_id) do nothing;
  if not p_request_deletion then return 'suspended'; end if;

  v_hold := public.source_legal_hold_state(p_workspace_key);
  v_grace := public.source_deletion_grace_days(p_workspace_key);
  -- Never a purgeable intent from an unreadable policy. The suspension above still blocks access.
  if v_hold not in ('active', 'inactive') or v_grace is null or v_grace < 0 then return 'deferred'; end if;

  v_now := pg_catalog.clock_timestamp();
  for v_version in
    select v.document_id, a.expires_at
      from public.foundation_connection_source_versions v
      left join public.foundation_intake_admissions a
        on a.workspace_key = v.workspace_key and a.document_id = v.document_id
     where v.source_id = p_source_id and v.workspace_key = p_workspace_key
     order by v.document_id
  loop
    continue when exists (select 1 from public.source_deletion_tombstones t
                           where t.workspace_key = p_workspace_key and t.document_id = v_version.document_id);
    -- Same eligibility floor as a customer request: never before an outstanding PUT has expired.
    perform public.record_upload_source_tombstone(p_workspace_key, v_version.document_id, 'source_removed',
      null, null, greatest(v_now + pg_catalog.make_interval(days => v_grace), v_now + interval '15 minutes',
        coalesce(v_version.expires_at, v_now) + interval '15 minutes'));
  end loop;
  return case when v_hold = 'active' then 'held' else 'recorded' end;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. A suspension may name a local source (OAuth lookup first, unchanged)
-- ---------------------------------------------------------------------------------------------

create or replace function public.guard_connector_source_suspension()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and public.founder_test_reset_archive_allows_delete(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_op<>'INSERT' then raise exception 'CONNECTOR_SUSPENSION_IMMUTABLE'; end if;
  perform 1 from public.connector_document_bindings where source_id=new.source_id and workspace_key=new.workspace_key;
  if not found then
    perform 1 from public.foundation_connection_sources where source_id=new.source_id and workspace_key=new.workspace_key;
    if not found then raise exception 'CONNECTOR_SUSPENSION_UNBOUND'; end if;
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Serving deny: local documents join the same check
-- ---------------------------------------------------------------------------------------------
--
-- 20260927102000's body, unchanged, plus the last `or exists`. A local version's document is blocked
-- while its connection is revoked or paused (the states the batch refuses as not syncable) or its
-- logical source is suspended. Revoking takes effect on the next call; nothing is cached.
create or replace function public.connector_documents_blocked(
  p_workspace_key text,
  p_document_ids text[]
) returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_workspace_key is null
    or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_document_ids is null
    or cardinality(p_document_ids) > 2000
    or array_position(p_document_ids, null) is not null then
    raise exception 'CONNECTOR_AUTH_SCOPE_INVALID';
  end if;

  return exists (
    select 1
    from public.connector_document_bindings b
    join public.foundation_oauth_connections c
      on c.oauth_connection_id = b.oauth_connection_id
    left join public.source_versions sv
      on sv.source_version_id = b.source_version_id
    left join public.sources s
      on s.source_id = b.source_id
    where b.workspace_key = p_workspace_key
      and b.document_id::text = any(p_document_ids)
      and (
        c.status <> 'active'
        or c.workspace_key <> b.workspace_key
        or c.provider <> b.provider
        or exists (
          select 1
          from public.connector_source_suspensions css
          where css.source_id = b.source_id
            and css.workspace_key = b.workspace_key
        )
        or sv.tombstoned is true
        or s.tombstoned_at is not null
        or not public.source_version_acl_admits(b.workspace_key, b.source_version_id, b.provider, '[]'::jsonb)
      )
  ) or exists (
    select 1
    from public.source_deletion_tombstones t
    where t.workspace_key = p_workspace_key
      and t.document_id is not null
      and t.document_id::text = any(array(select pg_catalog.lower(d) from pg_catalog.unnest(p_document_ids) d))
  ) or exists (
    select 1
    from public.foundation_connection_source_versions v
    join public.foundation_connections fc
      on fc.connection_id = v.connection_id
    where v.workspace_key = p_workspace_key
      and v.document_id = any(array(
        select pg_catalog.lower(d)::uuid from pg_catalog.unnest(p_document_ids) d
         where d ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      and (
        fc.status in ('revoked', 'paused')
        or fc.workspace_key <> v.workspace_key
        or exists (
          select 1
          from public.connector_source_suspensions css
          where css.source_id = v.source_id
            and css.workspace_key = v.workspace_key
        )
      )
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. The batch writes the sources in the transaction that advances the cursor
-- ---------------------------------------------------------------------------------------------
--
-- 20261004100000's body with four changes, marked LF-2 below:
--   a. after the replay check (so a stored batch always replays): every nativeId at most once, and a
--      `removal` field only on a deleted event, valued 'deleted' or 'out_of_scope';
--   b. the documents a `removal: deleted` event will tombstone are locked with the approved documents,
--      in one sorted pass, before the intake and legal-hold locks (the order every deletion takes);
--   c. after the batch row exists, file_server events bind or remove their logical sources;
--   d. the result of a file_server batch carries a `sources` summary (counts of logical sources).
create or replace function public.apply_foundation_connection_batch(
  p_batch_id uuid,
  p_workspace_key text,
  p_connection_id uuid,
  p_previous_cursor_sha256 text,
  p_next_cursor_sha256 text,
  p_manifest_sha256 text,
  p_event_count integer,
  p_event_manifest jsonb,
  p_actor_user_id uuid,
  p_actor_key_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.foundation_connections%rowtype;
  v_existing public.foundation_connection_batches%rowtype;
  v_principal_user_id uuid;
  v_event jsonb;
  v_document_id uuid;
  v_digest bytea;
  v_uuid_bytes bytea;
  v_expected_id uuid;
  v_uuid_hex text;
  v_content_sha256 text;
  v_source_key text;
  v_native_id text;
  v_size_bytes bigint;
  v_mime_type text;
  v_derived_file_key text;
  v_approved_document_ids uuid[] := '{}';
  v_approved_file_key text;
  v_attempt_key text;
  v_has_approved_identity boolean := false;
  -- LF-2
  v_local boolean;
  v_removal_document_ids uuid[] := '{}';
  v_source public.foundation_connection_sources%rowtype;
  v_suspended boolean;
  v_generation integer;
  v_identity record;
  v_admission public.foundation_intake_admissions%rowtype;
  v_version public.foundation_connection_source_versions%rowtype;
  v_removal_status text;
  v_bound integer := 0;
  v_suspended_only integer := 0;
  v_recorded integer := 0;
  v_held integer := 0;
  v_deferred integer := 0;
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_next_cursor_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_manifest_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or (p_previous_cursor_sha256 is not null and p_previous_cursor_sha256 !~ '^sha256:[a-f0-9]{64}$')
    or p_event_count not between 0 and 5000
    or jsonb_typeof(p_event_manifest) is distinct from 'array'
    or jsonb_array_length(p_event_manifest) is distinct from p_event_count
    or ((p_actor_user_id is null) = (p_actor_key_id is null)) then
    raise exception 'connection_batch_contract_invalid';
  end if;

  if p_actor_key_id is not null then
    select k.created_by into v_principal_user_id
      from public.foundation_api_keys k
     where k.key_id = p_actor_key_id and k.workspace_key = p_workspace_key
       and k.revoked_at is null and (k.expires_at is null or k.expires_at > clock_timestamp())
       and 'connections:sync' = any(k.scopes)
     for share;
    if not found then raise exception 'connection_batch_actor_invalid'; end if;
  else
    if p_workspace_key is distinct from
      'pilot-' || substring(replace(p_actor_user_id::text, '-', '') from 1 for 16) then
      raise exception 'connection_batch_actor_invalid';
    end if;
    v_principal_user_id := p_actor_user_id;
  end if;

  select * into v_connection from public.foundation_connections
    where connection_id = p_connection_id and workspace_key = p_workspace_key for update;
  if not found or v_connection.status in ('revoked', 'paused') then
    raise exception 'connection_not_syncable';
  end if;

  select * into v_existing from public.foundation_connection_batches where batch_id = p_batch_id;
  if found then
    if v_existing.workspace_key is distinct from p_workspace_key
      or v_existing.connection_id is distinct from p_connection_id
      or v_existing.manifest_sha256 is distinct from p_manifest_sha256
      or v_existing.previous_cursor_sha256 is distinct from p_previous_cursor_sha256
      or v_existing.next_cursor_sha256 is distinct from p_next_cursor_sha256 then
      raise exception 'connection_batch_idempotency_conflict';
    end if;
    return jsonb_build_object('status', 'replayed', 'batchId', p_batch_id);
  end if;

  if v_connection.cursor_sha256 is distinct from p_previous_cursor_sha256 then
    raise exception 'connection_cursor_conflict';
  end if;

  -- LF-2 (a): one event per source, and a removal marker only where it means something.
  if (select count(distinct item.value->>'nativeId') from jsonb_array_elements(p_event_manifest) as item(value))
       is distinct from p_event_count
    or exists (select 1 from jsonb_array_elements(p_event_manifest) as item(value)
                where item.value ? 'removal'
                  and (item.value->>'kind' is distinct from 'deleted'
                    or jsonb_typeof(item.value->'removal') is distinct from 'string'
                    or item.value->>'removal' not in ('deleted', 'out_of_scope'))) then
    raise exception 'connection_batch_contract_invalid';
  end if;

  -- LF-2 (b): documents the batch will tombstone. Stable under the connection row lock above: every
  -- writer of a connection's sources holds it.
  v_local := v_connection.provider = 'file_server';
  if v_local then
    select coalesce(pg_catalog.array_agg(distinct v.document_id), '{}') into v_removal_document_ids
      from jsonb_array_elements(p_event_manifest) as item(value)
      cross join lateral (
        select s.source_id from public.foundation_connection_sources s
         where s.connection_id = p_connection_id and s.native_id = item.value->>'nativeId'
         order by s.generation desc limit 1
      ) latest
      join public.foundation_connection_source_versions v on v.source_id = latest.source_id
     where item.value->>'kind' = 'deleted' and item.value->>'removal' = 'deleted'
       and not exists (select 1 from public.connector_source_suspensions css where css.source_id = latest.source_id);
  end if;

  -- Identify only non-legacy document IDs first. UUIDv5 derivation remains byte-identical to
  -- source-intake.ts; every mismatch must prove a database-owned approved member below.
  for v_event in select value from jsonb_array_elements(p_event_manifest) as item(value)
  loop
    if nullif(v_event->>'documentId', '') is null then continue; end if;
    v_document_id := (v_event->>'documentId')::uuid;
    v_source_key := v_event->>'sourceIdempotencyKey';
    v_digest := extensions.digest(pg_catalog.convert_to(
      'tavonel-source-intake' || pg_catalog.chr(31) || p_workspace_key || pg_catalog.chr(31) || v_source_key,
      'UTF8'), 'sha256');
    v_uuid_bytes := pg_catalog.substr(v_digest, 1, 16);
    v_uuid_bytes := pg_catalog.set_byte(v_uuid_bytes, 6, (pg_catalog.get_byte(v_uuid_bytes, 6) & 15) | 80);
    v_uuid_bytes := pg_catalog.set_byte(v_uuid_bytes, 8, (pg_catalog.get_byte(v_uuid_bytes, 8) & 63) | 128);
    v_uuid_hex := pg_catalog.encode(v_uuid_bytes, 'hex');
    v_expected_id := (pg_catalog.substring(v_uuid_hex, 1, 8) || '-' || pg_catalog.substring(v_uuid_hex, 9, 4)
      || '-' || pg_catalog.substring(v_uuid_hex, 13, 4) || '-' || pg_catalog.substring(v_uuid_hex, 17, 4)
      || '-' || pg_catalog.substring(v_uuid_hex, 21, 12))::uuid;
    if v_document_id is distinct from v_expected_id then
      v_approved_document_ids := pg_catalog.array_append(v_approved_document_ids, v_document_id);
      v_has_approved_identity := true;
    end if;
  end loop;

  if v_has_approved_identity or pg_catalog.cardinality(v_removal_document_ids) > 0 then
    -- Match confirmation/cancellation and source-deletion serialization. A cancellation or
    -- deletion therefore commits wholly before this batch (which then refuses), or after it.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'foundation-intake-approval:' || p_workspace_key, 0));
    -- LF-2 (b): approved and to-be-tombstoned documents in one sorted pass.
    for v_document_id in
      select distinct document_id from pg_catalog.unnest(v_approved_document_ids || v_removal_document_ids) as ids(document_id)
       order by document_id
    loop
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          'tavonel.source_deletion.v1' || pg_catalog.chr(10) || p_workspace_key || pg_catalog.chr(10) || v_document_id::text,
          'UTF8'), 'sha256'), 'hex'), 0));
    end loop;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || p_workspace_key, 0));
  end if;

  if v_has_approved_identity then
    for v_event in select value from jsonb_array_elements(p_event_manifest) as item(value)
    loop
      if nullif(v_event->>'documentId', '') is null then continue; end if;
      v_document_id := (v_event->>'documentId')::uuid;
      v_source_key := v_event->>'sourceIdempotencyKey';
      v_digest := extensions.digest(pg_catalog.convert_to(
        'tavonel-source-intake' || pg_catalog.chr(31) || p_workspace_key || pg_catalog.chr(31) || v_source_key,
        'UTF8'), 'sha256');
      v_uuid_bytes := pg_catalog.substr(v_digest, 1, 16);
      v_uuid_bytes := pg_catalog.set_byte(v_uuid_bytes, 6, (pg_catalog.get_byte(v_uuid_bytes, 6) & 15) | 80);
      v_uuid_bytes := pg_catalog.set_byte(v_uuid_bytes, 8, (pg_catalog.get_byte(v_uuid_bytes, 8) & 63) | 128);
      v_uuid_hex := pg_catalog.encode(v_uuid_bytes, 'hex');
      v_expected_id := (pg_catalog.substring(v_uuid_hex, 1, 8) || '-' || pg_catalog.substring(v_uuid_hex, 9, 4)
        || '-' || pg_catalog.substring(v_uuid_hex, 13, 4) || '-' || pg_catalog.substring(v_uuid_hex, 17, 4)
        || '-' || pg_catalog.substring(v_uuid_hex, 21, 12))::uuid;
      if v_document_id = v_expected_id then continue; end if;

      v_native_id := v_event->>'nativeId';
      v_content_sha256 := v_event->>'contentSha256';
      v_size_bytes := (v_event->>'sizeBytes')::bigint;
      v_mime_type := v_event->>'mimeType';
      v_derived_file_key := 'fk_' || pg_catalog.substring(pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to('tavonel-intake-file-v1' || pg_catalog.chr(31) || v_native_id || pg_catalog.chr(31)
          || v_content_sha256 || pg_catalog.chr(31) || v_size_bytes::text || pg_catalog.chr(31) || v_mime_type,
          'UTF8'), 'sha256'), 'hex'), 1, 40);

      select a.attempt_key, f.file_key into v_attempt_key, v_approved_file_key
        from public.foundation_intake_approval_files f
        join public.foundation_intake_approvals a on a.approval_id = f.approval_id
       where f.document_id = v_document_id
         and f.file_key = v_derived_file_key
         and f.content_sha256 = 'sha256:' || v_content_sha256
         and f.byte_length = v_size_bytes
         and f.declared_mime_type = v_mime_type
         and f.state = 'confirmed'
         and a.workspace_key = p_workspace_key
         and a.user_id = v_principal_user_id
         and a.state = 'approved'
       for update of a, f;
      if not found or pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'tavonel-approved-source-v1' || pg_catalog.chr(31) || v_attempt_key || pg_catalog.chr(31) || v_approved_file_key,
        'UTF8'), 'sha256'), 'hex') is distinct from v_source_key then
        raise exception 'connection_batch_approved_source_invalid';
      end if;
      if exists (select 1 from public.source_deletion_tombstones t
                  where t.workspace_key = p_workspace_key and t.document_id = v_document_id)
        or exists (select 1 from public.sources s
                    where s.source_id = v_document_id::text and s.tombstoned_at is not null)
        or exists (select 1 from public.source_versions sv join public.sources s using (source_id)
                    where s.source_id = v_document_id::text and sv.tombstoned) then
        raise exception 'connection_batch_approved_source_unavailable';
      end if;
    end loop;
  end if;

  insert into public.foundation_connection_batches (
    batch_id, workspace_key, connection_id, previous_cursor_sha256,
    next_cursor_sha256, manifest_sha256, event_count, event_manifest,
    actor_user_id, actor_key_id
  ) values (
    p_batch_id, p_workspace_key, p_connection_id, p_previous_cursor_sha256,
    p_next_cursor_sha256, p_manifest_sha256, p_event_count, p_event_manifest,
    p_actor_user_id, p_actor_key_id
  );

  -- LF-2 (c): bind or remove each file_server event's logical source, in manifest order.
  if v_local then
    for v_event in select value from jsonb_array_elements(p_event_manifest) as item(value)
    loop
      v_native_id := v_event->>'nativeId';
      select * into v_source from public.foundation_connection_sources s
       where s.connection_id = p_connection_id and s.native_id = v_native_id
       order by s.generation desc limit 1;
      v_suspended := found and exists (select 1 from public.connector_source_suspensions css
                                        where css.source_id = v_source.source_id);
      if v_source.source_id is null then v_suspended := false; end if;

      if v_event->>'kind' = 'deleted' then
        -- Nothing was ever bound for this path, or it is already suspended: nothing to do.
        if v_source.source_id is null or v_suspended then continue; end if;
        v_removal_status := public.record_connection_source_removal(
          p_workspace_key, v_source.source_id, v_event->>'removal' = 'deleted');
        case v_removal_status
          when 'suspended' then v_suspended_only := v_suspended_only + 1;
          when 'recorded' then v_recorded := v_recorded + 1;
          when 'held' then v_held := v_held + 1;
          else v_deferred := v_deferred + 1;
        end case;
        continue;
      end if;

      -- An added or changed path without an uploaded document (unsupported or skipped) binds nothing.
      if nullif(v_event->>'documentId', '') is null then continue; end if;
      v_document_id := (v_event->>'documentId')::uuid;

      -- The document must be a confirmed upload of this workspace with this event's bytes.
      select * into v_admission from public.foundation_intake_admissions a
       where a.workspace_key = p_workspace_key and a.document_id = v_document_id;
      if not found or v_admission.confirmed_at is null then
        raise exception 'connection_batch_source_unadmitted';
      end if;
      if jsonb_typeof(v_event->'revision') is distinct from 'string'
        or char_length(v_event->>'revision') not between 1 and 512 or (v_event->>'revision') ~ '[\x01-\x1f\x7f]'
        or jsonb_typeof(v_event->'contentSha256') is distinct from 'string'
        or (v_event->>'contentSha256') !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(v_event->'sizeBytes') is distinct from 'number'
        or v_admission.requested_bytes::bigint is distinct from (v_event->>'sizeBytes')::bigint
        or (v_admission.source_sha256 is not null
          and v_admission.source_sha256 is distinct from 'sha256:' || (v_event->>'contentSha256')) then
        raise exception 'connection_batch_source_invalid';
      end if;
      if exists (select 1 from public.source_deletion_tombstones t
                  where t.workspace_key = p_workspace_key and t.document_id = v_document_id) then
        raise exception 'connection_batch_source_unavailable';
      end if;

      -- A path whose previous source was removed starts a new logical source.
      v_generation := case when v_source.source_id is null then 0
                           when v_suspended then v_source.generation + 1
                           else v_source.generation end;
      select * into v_identity from public.local_folder_source_identity(
        p_workspace_key, p_connection_id, v_native_id, v_generation, v_event->>'revision', v_document_id);

      select * into v_version from public.foundation_connection_source_versions
       where source_version_id = v_identity.source_version_id;
      if found then
        -- A re-observation (a revert through the per-file path). Its row must be this exact one.
        if v_version.source_id is distinct from v_identity.source_id or v_version.workspace_key is distinct from p_workspace_key
          or v_version.document_id is distinct from v_document_id then
          raise exception 'connection_batch_source_conflict';
        end if;
      elsif exists (select 1 from public.foundation_connection_source_versions v
                     where v.workspace_key = p_workspace_key and v.document_id = v_document_id) then
        -- One document is one version of one source.
        raise exception 'connection_batch_source_conflict';
      end if;

      insert into public.foundation_connection_sources
        (source_id, workspace_key, connection_id, native_id, generation, current_source_version_id)
      values (v_identity.source_id, p_workspace_key, p_connection_id, v_native_id, v_generation,
        v_identity.source_version_id)
      on conflict (source_id) do update
        set current_source_version_id = excluded.current_source_version_id,
            updated_at = pg_catalog.clock_timestamp();
      if v_version.source_version_id is null then
        insert into public.foundation_connection_source_versions
          (source_version_id, source_id, workspace_key, connection_id, revision, document_id,
           content_sha256, byte_length, mime_type, batch_id)
        values (v_identity.source_version_id, v_identity.source_id, p_workspace_key, p_connection_id,
          v_event->>'revision', v_document_id, 'sha256:' || (v_event->>'contentSha256'),
          v_admission.requested_bytes, v_admission.declared_mime_type, p_batch_id);
      end if;
      v_bound := v_bound + 1;
    end loop;
  end if;

  update public.foundation_connections set
    cursor_sha256 = p_next_cursor_sha256,
    status = 'active',
    last_sync_at = now(),
    last_error_code = null,
    updated_at = now()
    where connection_id = p_connection_id;
  insert into public.foundation_developer_audit_events (
    workspace_key, action, target_id, actor_user_id, actor_key_id, details
  ) values (
    p_workspace_key, 'connection_batch_applied', p_connection_id::text,
    p_actor_user_id, p_actor_key_id,
    jsonb_build_object('batchId', p_batch_id, 'manifestSha256', p_manifest_sha256, 'eventCount', p_event_count)
  );
  -- LF-2 (d): counts of logical sources, file_server batches only; other kinds answer as before.
  return jsonb_build_object('status', 'applied', 'batchId', p_batch_id)
    || case when v_local then jsonb_build_object('sources', jsonb_build_object(
         'bound', v_bound, 'suspended', v_suspended_only, 'deletionRecorded', v_recorded,
         'deletionHeld', v_held, 'deletionDeferred', v_deferred)) else '{}'::jsonb end;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------------------------

revoke all on function public.guard_foundation_connection_source(),
  public.guard_foundation_connection_source_version(),
  public.record_connection_source_removal(text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.local_folder_source_identity(text, uuid, text, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.local_folder_source_identity(text, uuid, text, integer, text, uuid) to service_role;
-- connector_documents_blocked, guard_connector_source_suspension and apply_foundation_connection_batch
-- keep the grants of their earlier migrations (create or replace preserves them); stated again here.
revoke all on function public.connector_documents_blocked(text, text[]) from public, anon, authenticated;
grant execute on function public.connector_documents_blocked(text, text[]) to service_role;
revoke all on function public.guard_connector_source_suspension() from public, anon, authenticated;
revoke all on function public.apply_foundation_connection_batch(
  uuid, text, uuid, text, text, text, integer, jsonb, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.apply_foundation_connection_batch(
  uuid, text, uuid, text, text, text, integer, jsonb, uuid, uuid
) to service_role;

commit;
