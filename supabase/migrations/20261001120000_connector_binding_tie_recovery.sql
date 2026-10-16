-- Bindings recorded before the compare-and-set took `recorded_at` from now(), the transaction start.
-- Two revisions of one logical source written in one transaction therefore share an instant, and
-- record_connector_document_binding_current refuses every later import of that source ('contested'
-- forever) because equal instants have no database order. Compile selection refuses it too
-- (CONNECTOR_SOURCE_REVISION_AMBIGUOUS), so the source can never refresh again.
--
-- This variant takes the import's snapshot as the whole set of bindings at the newest instant. It
-- records only if that set is unchanged under the same per-source lock, so a provider-verified
-- current revision supersedes the tied rows together. It never picks one tied row over another: no
-- id, provider revision or provider timestamp is compared. A unique latest is the one-element case
-- and an unbound source the empty set, so it is otherwise the same decision as the 2-argument
-- function, which stays in place unchanged. Existing bindings stay immutable; the table's
-- connection, tombstone and immutability triggers still apply to the insert.
begin;

create or replace function public.record_connector_document_binding_after(
  p_binding jsonb, p_expected_latest_source_version_ids text[])
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_workspace text := p_binding->>'workspace_key';
  v_source text := p_binding->>'source_id';
  v_version text := p_binding->>'source_version_id';
  v_expected text[];
  v_top text[];
  v_top_at timestamptz := null;
  v_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(p_binding) is distinct from 'object' or v_workspace is null or v_source is null
    or v_version is null or v_version !~ '^sv-[a-f0-9]{64}$'
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
  -- Same lock as record_connector_document_binding_current: both writers serialize per source.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.connector_binding_latest.v1' || pg_catalog.chr(10) || v_workspace || pg_catalog.chr(10) || v_source, 0));
  -- A version already recorded is a replay. It never moves the latest pointer.
  if exists (select 1 from public.connector_document_bindings b where b.source_version_id = v_version) then
    return 'replay';
  end if;
  select pg_catalog.max(b.recorded_at) into v_top_at from public.connector_document_bindings b
   where b.workspace_key = v_workspace and b.source_id = v_source;
  select coalesce(pg_catalog.array_agg(b.source_version_id order by b.source_version_id), '{}') into v_top
    from public.connector_document_bindings b
   where b.workspace_key = v_workspace and b.source_id = v_source and b.recorded_at = v_top_at;
  -- The whole newest set must be what the import saw before its first provider read.
  if v_top is distinct from v_expected then
    return 'contested';
  end if;
  -- clock_timestamp() after the lock. It must be strictly after every existing observation, so the
  -- new row is a unique latest and never joins, or precedes, the set it supersedes.
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

revoke all on function public.record_connector_document_binding_after(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.record_connector_document_binding_after(jsonb, text[]) to service_role;

commit;
