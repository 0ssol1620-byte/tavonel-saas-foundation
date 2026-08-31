-- The private-pilot corpus flow legitimately needs more than twenty small documents in one
-- validation day. Raise only the count ceiling; retain the 5 MiB object cap, 25 MiB minute
-- byte cap, 100 MiB rolling-day byte cap, and five-admissions-per-minute burst cap.
begin;

create or replace function public.reserve_foundation_intake_admission(
  p_workspace_key text,
  p_document_id uuid,
  p_user_id uuid,
  p_object_key text,
  p_requested_bytes integer,
  p_declared_mime_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.foundation_intake_admissions%rowtype;
  minute_count integer;
  minute_bytes bigint;
  day_count integer;
  day_bytes bigint;
  expires_at_value timestamptz;
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_object_key <> ('quarantine/' || p_workspace_key || '/' || p_document_id::text || '/source')
    or p_requested_bytes < 1
    or p_requested_bytes > 5242880
    or char_length(p_declared_mime_type) < 3
    or char_length(p_declared_mime_type) > 160 then
    raise exception 'foundation_intake_admission_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('foundation-intake:' || p_workspace_key, 0));

  select * into existing
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and document_id = p_document_id;
  if found then
    if existing.user_id <> p_user_id
      or existing.object_key <> p_object_key
      or existing.declared_mime_type <> p_declared_mime_type then
      raise exception 'foundation_intake_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'documentId', existing.document_id,
      'objectKey', existing.object_key,
      'expiresAt', existing.expires_at,
      'idempotentReplay', true
    );
  end if;

  select count(*), coalesce(sum(requested_bytes), 0)
  into minute_count, minute_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '1 minute';
  if minute_count >= 5 or minute_bytes + p_requested_bytes > 26214400 then
    raise exception 'foundation_intake_rate_limited';
  end if;

  select count(*), coalesce(sum(requested_bytes), 0)
  into day_count, day_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '24 hours';
  if day_count >= 25 or day_bytes + p_requested_bytes > 104857600 then
    raise exception 'foundation_intake_daily_quota_exceeded';
  end if;

  expires_at_value := clock_timestamp() + interval '10 minutes';

  insert into public.foundation_intake_admissions (
    workspace_key,
    document_id,
    user_id,
    object_key,
    requested_bytes,
    declared_mime_type,
    expires_at
  ) values (
    p_workspace_key,
    p_document_id,
    p_user_id,
    p_object_key,
    p_requested_bytes,
    p_declared_mime_type,
    expires_at_value
  );

  return jsonb_build_object(
    'documentId', p_document_id,
    'objectKey', p_object_key,
    'expiresAt', expires_at_value,
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text) to service_role;

commit;
