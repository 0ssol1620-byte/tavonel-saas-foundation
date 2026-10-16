-- Concurrent connector imports could each pass their provider currency checks and then commit in
-- the wrong order: an import of rev1 whose post-download read passed, followed by rev2 appearing
-- and binding, followed by rev1's insert, made rev1 the latest binding by recorded_at. Compile
-- selection then treated the older provider revision as current.
--
-- This records a binding only if the source's latest binding is still the one the import read
-- before its first provider read (an optimistic compare-and-set ordered by the database alone).
-- No provider timestamp or revision ordering is consulted. Existing bindings stay immutable; the
-- tombstone and connection triggers on the table still apply to the insert.
begin;

create or replace function public.record_connector_document_binding_current(
  p_binding jsonb, p_expected_latest_source_version_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_workspace text := p_binding->>'workspace_key';
  v_source text := p_binding->>'source_id';
  v_version text := p_binding->>'source_version_id';
  v_top_id text := null;
  v_top_at timestamptz := null;
  v_next_at timestamptz := null;
begin
  if pg_catalog.jsonb_typeof(p_binding) is distinct from 'object' or v_workspace is null or v_source is null
    or v_version is null or v_version !~ '^sv-[a-f0-9]{64}$'
    or (p_expected_latest_source_version_id is not null and p_expected_latest_source_version_id !~ '^sv-[a-f0-9]{64}$') then
    raise exception 'CONNECTOR_BINDING_INVALID';
  end if;
  -- One writer per logical source at a time, so the latest read and the insert are one decision.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.connector_binding_latest.v1' || pg_catalog.chr(10) || v_workspace || pg_catalog.chr(10) || v_source, 0));
  -- A version already recorded is a replay. It never moves the latest pointer; the caller reads the
  -- stored row back and refuses any difference.
  if exists (select 1 from public.connector_document_bindings b where b.source_version_id = v_version) then
    return 'replay';
  end if;
  select b.source_version_id, b.recorded_at into v_top_id, v_top_at from public.connector_document_bindings b
   where b.workspace_key = v_workspace and b.source_id = v_source
   order by b.recorded_at desc, b.source_version_id desc limit 1;
  if v_top_id is not null then
    select b.recorded_at into v_next_at from public.connector_document_bindings b
     where b.workspace_key = v_workspace and b.source_id = v_source and b.source_version_id <> v_top_id
     order by b.recorded_at desc limit 1;
    -- Equal observation instants have no database order; never pick one by id.
    if v_next_at is not null and v_next_at = v_top_at then return 'contested'; end if;
  end if;
  if v_top_id is distinct from p_expected_latest_source_version_id then
    return 'contested';
  end if;
  -- clock_timestamp() after the lock: database order equals lock order, not transaction start order.
  insert into public.connector_document_bindings (source_version_id, source_id, workspace_key, oauth_connection_id,
    provider, native_id, provider_revision, document_id, content_sha256, byte_length, mime_type, recorded_at)
  values (v_version, v_source, v_workspace, (p_binding->>'oauth_connection_id')::uuid, p_binding->>'provider',
    p_binding->>'native_id', p_binding->>'provider_revision', (p_binding->>'document_id')::uuid,
    p_binding->>'content_sha256', (p_binding->>'byte_length')::bigint, p_binding->>'mime_type', pg_catalog.clock_timestamp());
  return 'recorded';
end;
$$;

revoke all on function public.record_connector_document_binding_current(jsonb, text) from public, anon, authenticated;
grant execute on function public.record_connector_document_binding_current(jsonb, text) to service_role;

commit;
