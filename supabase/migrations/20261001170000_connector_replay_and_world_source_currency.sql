-- Two corrections to the connector source-binding boundary (independent review of a5550c4).
--
-- 1. The writer's replay branch recorded a tie resolution before comparing the replay with the
--    stored binding's immutable bytes, length and type. The application noticed the difference only
--    on read-back, after the resolution had already moved "newest". A replay is now compared field
--    for field first and raises CONNECTOR_BINDING_CONFLICT before any side effect.
--
-- 2. Promotion checked that a candidate's upload objects still existed and were accessible, not that
--    each connector-bound document was still the latest revision of its logical source. Compiling
--    revision A, binding revision B, then promoting A published content the provider had replaced.
--    The check must hold at commit, not at a precheck: assert_world_sources_current takes every
--    involved logical source's binding lock -- the lock the binding writer takes -- in a fixed
--    order and verifies currency under it, and transition_foundation_world_atomic_current runs it
--    and then the unchanged transition in one transaction. A revision bound concurrently either
--    committed first (the promotion is refused) or waits until the promotion commits (and is then
--    latest for the next compile). Rollback to a previously active World is a separate, explicit
--    historical action and keeps using the unchanged transition. An exact retry of a committed
--    promotion (same operation id) is delegated untouched so idempotent replay keeps working.
begin;

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
    -- A replay must be the stored binding, field for field, before it can have any effect. Identity
    -- already binds workspace, connection, provider, native id, revision and document; the bytes,
    -- length and type are compared here too, so a differing replay raises before a resolution is
    -- written or the newest set can change.
    if v_existing.workspace_key is distinct from v_workspace or v_existing.source_id is distinct from v_source
      or v_existing.oauth_connection_id is distinct from (p_binding->>'oauth_connection_id')::uuid
      or v_existing.provider is distinct from p_binding->>'provider' or v_existing.native_id is distinct from p_binding->>'native_id'
      or v_existing.provider_revision is distinct from p_binding->>'provider_revision'
      or v_existing.document_id is distinct from (p_binding->>'document_id')::uuid
      or v_existing.content_sha256 is distinct from p_binding->>'content_sha256'
      or v_existing.byte_length is distinct from (p_binding->>'byte_length')::bigint
      or v_existing.mime_type is distinct from p_binding->>'mime_type' then
      raise exception 'CONNECTOR_BINDING_CONFLICT';
    end if;
    -- Replay. It moves latest only to resolve an unresolved tie of which it is a member, and only
    -- when the import's snapshot was exactly that tie: the provider named this revision current
    -- after the tie existed. The caller reads the stored binding back and refuses any difference.
    if pg_catalog.cardinality(v_newest) > 1 and v_version = any (v_newest) and v_newest = v_expected then
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

create or replace function public.assert_world_sources_current(p_workspace_key text, p_document_ids text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_documents uuid[];
  v_source text;
  v_binding record;
  v_newest text[];
  v_checked integer := 0;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_document_ids is null
    or pg_catalog.cardinality(p_document_ids) not between 1 and 1000
    or exists (select 1 from pg_catalog.unnest(p_document_ids) d(id)
                where d.id is null or d.id !~ '^[A-Za-z0-9_-]{1,80}$') then
    raise exception 'world_source_scope_invalid';
  end if;
  -- Any candidate document id the promotion accepts; only UUID-shaped ones can be connector uploads.
  v_documents := array(select distinct d.id::uuid from pg_catalog.unnest(p_document_ids) d(id)
                        where d.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  -- Every involved logical source, locked in one fixed order (the writer takes one at a time).
  for v_source in
    select distinct b.source_id from public.connector_document_bindings b
     where b.workspace_key = p_workspace_key and b.document_id = any (v_documents)
     order by b.source_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'tavonel.connector_binding_latest.v1' || pg_catalog.chr(10) || p_workspace_key || pg_catalog.chr(10) || v_source, 0));
  end loop;
  -- Under the locks: each connector-bound document must be the unique effective newest revision of
  -- its source, so two revisions of one source can never pass together. Documents without a
  -- connector binding (direct uploads) have no logical-source lineage and are not refused here.
  for v_binding in
    select b.source_id, b.source_version_id from public.connector_document_bindings b
     where b.workspace_key = p_workspace_key and b.document_id = any (v_documents)
     order by b.source_id, b.source_version_id
  loop
    v_newest := public.connector_source_newest_versions(p_workspace_key, v_binding.source_id);
    if pg_catalog.cardinality(v_newest) > 1 then raise exception 'world_source_revision_ambiguous'; end if;
    if v_newest is distinct from array[v_binding.source_version_id] then raise exception 'world_source_revision_superseded'; end if;
    v_checked := v_checked + 1;
  end loop;
  return v_checked;
end;
$$;

create or replace function public.transition_foundation_world_atomic_current(
  p_operation_id uuid, p_action text, p_workspace_key text, p_collection_id text, p_target_manifest_digest text,
  p_candidate_object_key text, p_world_state_id text, p_core_output_sha256 text, p_expected_current_state text,
  p_expected_current_revision bigint, p_expected_current_manifest_digest text, p_actor_user_id uuid, p_reason text,
  p_source_document_ids text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  -- Forward promotion only; historical rollback keeps the unchanged transition.
  if p_action is distinct from 'activate' then raise exception 'world_transition_contract_invalid'; end if;
  if not exists (select 1 from public.foundation_world_transition_receipts r where r.operation_id = p_operation_id) then
    perform public.assert_world_sources_current(p_workspace_key, p_source_document_ids);
  end if;
  return public.transition_foundation_world_atomic(p_operation_id, p_action, p_workspace_key, p_collection_id,
    p_target_manifest_digest, p_candidate_object_key, p_world_state_id, p_core_output_sha256, p_expected_current_state,
    p_expected_current_revision, p_expected_current_manifest_digest, p_actor_user_id, p_reason);
end;
$$;

revoke all on function public.record_connector_document_binding_after(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.record_connector_document_binding_after(jsonb, text[]) to service_role;
revoke all on function public.assert_world_sources_current(text, text[]) from public, anon, authenticated;
grant execute on function public.assert_world_sources_current(text, text[]) to service_role;
revoke all on function public.transition_foundation_world_atomic_current(uuid, text, text, text, text, text, text, text, text, bigint, text, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.transition_foundation_world_atomic_current(uuid, text, text, text, text, text, text, text, text, bigint, text, uuid, text, text[]) to service_role;

commit;
