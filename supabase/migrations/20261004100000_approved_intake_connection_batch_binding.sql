-- Approved direct-upload documents may carry database-minted UUIDv4 IDs into a local-agent
-- connection batch. Keep the legacy UUIDv5 identity and bind the new identity to its confirmed
-- approval member inside the transaction that inserts the batch and advances the cursor.
begin;

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

  if v_has_approved_identity then
    -- Match confirmation/cancellation and source-deletion serialization. A cancellation or
    -- deletion therefore commits wholly before this batch (which then refuses), or after it.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'foundation-intake-approval:' || p_workspace_key, 0));
    for v_document_id in
      select distinct document_id from pg_catalog.unnest(v_approved_document_ids) as ids(document_id)
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
  return jsonb_build_object('status', 'applied', 'batchId', p_batch_id);
end;
$$;

revoke all on function public.apply_foundation_connection_batch(
  uuid, text, uuid, text, text, text, integer, jsonb, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.apply_foundation_connection_batch(
  uuid, text, uuid, text, text, text, integer, jsonb, uuid, uuid
) to service_role;

commit;
