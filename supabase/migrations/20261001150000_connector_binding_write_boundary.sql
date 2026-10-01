-- One guarded write boundary for connector source bindings.
--
-- 1. Direct API-role inserts bypassed the latest compare-and-set. service_role keeps its existing
--    table privileges (the grant matrix is unchanged), but the binding guard now refuses an insert
--    whose effective role is an API role. Supported writes run inside the security-definer writer
--    below, where the effective role is the function owner. Owner-level SQL (migrations, fixtures)
--    is unaffected.
-- 2. The writer recomputes the deterministic identity (logical source, version, quarantine
--    document) from the binding's own fields, exactly as nextjs/lib/connector-source-identity.ts
--    does, and refuses any row that does not match it.
-- 3. A legacy equal-instant tie whose provider-current revision is itself one of the tied rows was
--    an unrecoverable replay. The writer now records an immutable resolution naming that row when
--    the import's snapshot still equals the whole newest set. It is a later database observation
--    of the provider's current revision, never a pick among tied rows by id or provider value.
-- 4. "Newest" is computed in one place, in SQL, at the database's own microsecond precision, and
--    read by the writer, the import snapshot and compile selection alike.
--
-- Bindings stay immutable; tombstone, connection and ACL-snapshot guards are unchanged.
begin;

create or replace function public.guard_connector_document_binding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'CONNECTOR_BINDING_IMMUTABLE'; end if;
  -- Trigger functions run as the role performing the insert. Inside the security-definer writer
  -- that is the function owner; a direct REST insert is service_role (or another API role).
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'CONNECTOR_BINDING_WRITE_PATH';
  end if;
  perform 1 from public.foundation_oauth_connections
    where oauth_connection_id = new.oauth_connection_id and workspace_key = new.workspace_key
      and provider = new.provider and status = 'active' for share;
  if not found then raise exception 'CONNECTOR_BINDING_CONNECTION_INVALID'; end if;
  return new;
end;
$$;

-- The identity nextjs/lib/connector-source-identity.ts derives. JSON arrays are spelled exactly as
-- JavaScript's JSON.stringify spells them (no spaces; to_json escapes quotes and backslashes the
-- same way, and control characters are refused by the table's checks).
create or replace function public.connector_binding_identity(
  p_workspace_key text, p_connection_id text, p_provider text, p_native_id text, p_revision text,
  out source_id text, out source_version_id text, out document_id uuid)
language plpgsql immutable set search_path = '' as $$
declare
  v_legacy text;
  v_bytes bytea;
  v_hex text;
begin
  source_id := 'src-' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    '["connector.v1",' || pg_catalog.to_json(p_workspace_key)::text || ',' || pg_catalog.to_json(p_connection_id)::text || ','
      || pg_catalog.to_json(p_provider)::text || ',' || pg_catalog.to_json(p_native_id)::text || ']', 'UTF8'), 'sha256'), 'hex');
  source_version_id := 'sv-' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    '[' || pg_catalog.to_json(source_id)::text || ',' || pg_catalog.to_json(p_revision)::text || ']', 'UTF8'), 'sha256'), 'hex');
  v_legacy := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    p_connection_id || pg_catalog.chr(31) || p_native_id || pg_catalog.chr(31) || p_revision, 'UTF8'), 'sha256'), 'hex');
  v_bytes := pg_catalog.substring(extensions.digest(pg_catalog.convert_to(
    'tavonel-source-intake' || pg_catalog.chr(31) || p_workspace_key || pg_catalog.chr(31) || v_legacy, 'UTF8'), 'sha256') from 1 for 16);
  v_bytes := pg_catalog.set_byte(v_bytes, 6, (pg_catalog.get_byte(v_bytes, 6) & 15) | 80);
  v_bytes := pg_catalog.set_byte(v_bytes, 8, (pg_catalog.get_byte(v_bytes, 8) & 63) | 128);
  v_hex := pg_catalog.encode(v_bytes, 'hex');
  document_id := (pg_catalog.substr(v_hex, 1, 8) || '-' || pg_catalog.substr(v_hex, 9, 4) || '-' || pg_catalog.substr(v_hex, 13, 4)
    || '-' || pg_catalog.substr(v_hex, 17, 4) || '-' || pg_catalog.substr(v_hex, 21, 12))::uuid;
end;
$$;

-- Immutable resolutions of a legacy tie by the provider's current revision. No API-role access;
-- written only by the writer, read only through connector_source_newest_versions.
create table public.connector_binding_tie_resolutions (
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  source_id text not null check (source_id ~ '^src-[a-f0-9]{64}$'),
  tied_source_version_ids text[] not null check (pg_catalog.cardinality(tied_source_version_ids) between 2 and 16),
  current_source_version_id text not null check (current_source_version_id ~ '^sv-[a-f0-9]{64}$'),
  resolved_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (workspace_key, source_id, tied_source_version_ids),
  check (current_source_version_id = any (tied_source_version_ids))
);

create function public.guard_connector_binding_tie_resolution() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then raise exception 'CONNECTOR_TIE_RESOLUTION_IMMUTABLE'; end if;
  return new;
end;
$$;
create trigger connector_binding_tie_resolution_guard before update
  on public.connector_binding_tie_resolutions for each row execute function public.guard_connector_binding_tie_resolution();
alter table public.connector_binding_tie_resolutions enable row level security;
revoke all on public.connector_binding_tie_resolutions from public, anon, authenticated, service_role;
revoke all on function public.guard_connector_binding_tie_resolution() from public, anon, authenticated;

-- The effective newest bindings of one logical source: every binding at the newest observation
-- instant, compared at full microsecond precision, unless an immutable resolution names the current
-- revision of exactly that tied set. One element is a unique latest, none an unbound source, several
-- an unresolved tie. Sorted, so callers compare sets.
create or replace function public.connector_source_newest_versions(p_workspace_key text, p_source_id text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_top_at timestamptz;
  v_set text[];
  v_current text;
begin
  if p_workspace_key is null or p_source_id is null or p_source_id !~ '^src-[a-f0-9]{64}$' then
    raise exception 'CONNECTOR_SOURCE_SCOPE_INVALID';
  end if;
  select pg_catalog.max(b.recorded_at) into v_top_at from public.connector_document_bindings b
   where b.workspace_key = p_workspace_key and b.source_id = p_source_id;
  select coalesce(pg_catalog.array_agg(b.source_version_id order by b.source_version_id), '{}') into v_set
    from public.connector_document_bindings b
   where b.workspace_key = p_workspace_key and b.source_id = p_source_id and b.recorded_at = v_top_at;
  if pg_catalog.cardinality(v_set) > 1 then
    select r.current_source_version_id into v_current from public.connector_binding_tie_resolutions r
     where r.workspace_key = p_workspace_key and r.source_id = p_source_id and r.tied_source_version_ids = v_set;
    if v_current is not null then return array[v_current]; end if;
  end if;
  return v_set;
end;
$$;

create or replace function public.record_connector_document_binding_after(
  p_binding jsonb, p_expected_latest_source_version_ids text[])
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_workspace text := p_binding->>'workspace_key';
  v_source text := p_binding->>'source_id';
  v_version text := p_binding->>'source_version_id';
  v_identity record;
  v_expected text[];
  v_newest text[];
  v_existing record;
  v_top_at timestamptz;
  v_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(p_binding) is distinct from 'object' or v_workspace is null or v_source is null
    or v_version is null or v_version !~ '^sv-[a-f0-9]{64}$'
    or p_binding->>'oauth_connection_id' is null or p_binding->>'provider' is null
    or p_binding->>'native_id' is null or p_binding->>'provider_revision' is null or p_binding->>'document_id' is null
    or p_expected_latest_source_version_ids is null
    or pg_catalog.cardinality(p_expected_latest_source_version_ids) > 16
    or exists (select 1 from pg_catalog.unnest(p_expected_latest_source_version_ids) e(id) where e.id is null or e.id !~ '^sv-[a-f0-9]{64}$') then
    raise exception 'CONNECTOR_BINDING_INVALID';
  end if;
  select coalesce(pg_catalog.array_agg(distinct e.id order by e.id), '{}') into v_expected
    from pg_catalog.unnest(p_expected_latest_source_version_ids) e(id);
  if pg_catalog.cardinality(v_expected) <> pg_catalog.cardinality(p_expected_latest_source_version_ids) then
    raise exception 'CONNECTOR_BINDING_INVALID';
  end if;
  -- Version constraint: the row must carry the identity its own fields derive.
  select * into v_identity from public.connector_binding_identity(v_workspace, p_binding->>'oauth_connection_id',
    p_binding->>'provider', p_binding->>'native_id', p_binding->>'provider_revision');
  if v_identity.source_id is distinct from v_source or v_identity.source_version_id is distinct from v_version
    or v_identity.document_id is distinct from (p_binding->>'document_id')::uuid then
    raise exception 'CONNECTOR_BINDING_IDENTITY_MISMATCH';
  end if;
  -- Same lock as record_connector_document_binding_current: one writer per logical source.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.connector_binding_latest.v1' || pg_catalog.chr(10) || v_workspace || pg_catalog.chr(10) || v_source, 0));
  v_newest := public.connector_source_newest_versions(v_workspace, v_source);
  select b.* into v_existing from public.connector_document_bindings b where b.source_version_id = v_version;
  if found then
    -- Replay. It moves latest only to resolve an unresolved tie of which it is a member, and only
    -- when the import's snapshot was exactly that tie: the provider named this revision current
    -- after the tie existed. The caller reads the stored binding back and refuses any difference.
    if pg_catalog.cardinality(v_newest) > 1 and v_version = any (v_newest) and v_newest = v_expected
      and v_existing.workspace_key = v_workspace and v_existing.source_id = v_source then
      -- The same serialization and refusals a new binding gets from the table triggers.
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sha256:' || pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to('tavonel.source_deletion.v1' || pg_catalog.chr(10) || v_workspace || pg_catalog.chr(10) || v_source, 'UTF8'),
        'sha256'), 'hex'), 0));
      if not public.connector_source_import_allowed(v_workspace, v_source) then raise exception 'SOURCE_TOMBSTONED'; end if;
      perform 1 from public.foundation_oauth_connections
        where oauth_connection_id = v_existing.oauth_connection_id and workspace_key = v_workspace
          and provider = v_existing.provider and status = 'active' for share;
      if not found then raise exception 'CONNECTOR_BINDING_CONNECTION_INVALID'; end if;
      insert into public.connector_binding_tie_resolutions (workspace_key, source_id, tied_source_version_ids, current_source_version_id)
      values (v_workspace, v_source, v_newest, v_version);
      return 'resolved';
    end if;
    return 'replay';
  end if;
  -- The whole effective newest set must be what the import saw before its first provider read.
  if v_newest is distinct from v_expected then
    return 'contested';
  end if;
  select pg_catalog.max(b.recorded_at) into v_top_at from public.connector_document_bindings b
   where b.workspace_key = v_workspace and b.source_id = v_source;
  -- Strictly after every existing observation: the new row is a unique latest.
  v_now := pg_catalog.clock_timestamp();
  if v_top_at is not null and v_now <= v_top_at then
    return 'contested';
  end if;
  insert into public.connector_document_bindings (source_version_id, source_id, workspace_key, oauth_connection_id,
    provider, native_id, provider_revision, document_id, content_sha256, byte_length, mime_type, recorded_at)
  values (v_version, v_source, v_workspace, (p_binding->>'oauth_connection_id')::uuid, p_binding->>'provider',
    p_binding->>'native_id', p_binding->>'provider_revision', (p_binding->>'document_id')::uuid,
    p_binding->>'content_sha256', (p_binding->>'byte_length')::bigint, p_binding->>'mime_type', v_now);
  return 'recorded';
end;
$$;

-- The earlier writer delegates, so every supported write takes the same decisions.
create or replace function public.record_connector_document_binding_current(
  p_binding jsonb, p_expected_latest_source_version_id text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return public.record_connector_document_binding_after(p_binding,
    case when p_expected_latest_source_version_id is null then '{}'::text[] else array[p_expected_latest_source_version_id] end);
end;
$$;

revoke all on function public.connector_binding_identity(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.connector_binding_identity(text, text, text, text, text) to service_role;
revoke all on function public.connector_source_newest_versions(text, text) from public, anon, authenticated;
grant execute on function public.connector_source_newest_versions(text, text) to service_role;
revoke all on function public.record_connector_document_binding_after(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.record_connector_document_binding_after(jsonb, text[]) to service_role;
revoke all on function public.record_connector_document_binding_current(jsonb, text) from public, anon, authenticated;
grant execute on function public.record_connector_document_binding_current(jsonb, text) to service_role;

commit;
