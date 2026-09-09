begin;

-- PostgreSQL regex repetition bounds cannot exceed 255. The original {3,500}
-- constraints fail at runtime on real connection inserts; keep the same 3..500
-- suffix contract with a separate length predicate.
alter table public.foundation_oauth_connections drop constraint foundation_oauth_connections_client_secret_reference_check;
alter table public.foundation_oauth_connections add constraint foundation_oauth_connections_client_secret_reference_check
  check (client_secret_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]{3,}$'
    and char_length(regexp_replace(client_secret_reference, '^[^:]+://', '')) <= 500);
alter table public.foundation_oauth_connections drop constraint foundation_oauth_connections_refresh_token_reference_check;
alter table public.foundation_oauth_connections add constraint foundation_oauth_connections_refresh_token_reference_check
  check (refresh_token_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]{3,}$'
    and char_length(regexp_replace(refresh_token_reference, '^[^:]+://', '')) <= 500);

create table public.foundation_connector_checkpoints (
  workspace_key text not null,
  oauth_connection_id uuid not null,
  target_key text not null check (target_key ~ '^[a-f0-9]{64}$'),
  reader_version text not null check (reader_version in ('dropbox-list-v2','graph-delta-v2')),
  target jsonb not null check (jsonb_typeof(target) = 'object' and octet_length(target::text) <= 4096),
  cursor_token text not null check (char_length(cursor_token) between 1 and 4096),
  completed_job_id text not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workspace_key, oauth_connection_id, target_key, reader_version)
);
alter table public.foundation_connector_checkpoints enable row level security;
revoke all on public.foundation_connector_checkpoints from public, anon, authenticated, service_role;
grant select, insert, update on public.foundation_connector_checkpoints to service_role;

-- Called by the existing completion transaction. A rollback rolls back both the success
-- state and its watermark. Legacy jobs have no version marker and cannot seed a checkpoint.
create function public.capture_connector_checkpoint() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_reader text := new.payload->>'sourceReaderVersion';
  v_provider text;
  v_target jsonb := coalesce(new.payload->'target', '{}'::jsonb);
  v_key text;
begin
  if new.job_type <> 'source_import' or new.state <> 'succeeded' or old.state = 'succeeded'
     or v_reader is null or v_reader = 'google-files-v1' then return new; end if;
  select provider::text into v_provider from public.foundation_oauth_connections
   where workspace_key = new.workspace_key and oauth_connection_id = new.oauth_connection_id
     and status = 'active' for update;
  if not found then raise exception 'connector_checkpoint_connection_inactive'; end if;
  if not ((v_provider = 'dropbox' and v_reader = 'dropbox-list-v2') or
          (v_provider = 'microsoft_graph' and v_reader = 'graph-delta-v2')) then
    raise exception 'connector_checkpoint_reader_invalid';
  end if;
  if new.cursor_token is null or new.cursor_token = '' or new.cursor_token like 'tavonel-sync-v1:%'
     or (v_provider = 'dropbox' and (new.cursor_token ~ '[[:space:][:cntrl:]]' or new.cursor_token ~ '^[A-Za-z][A-Za-z0-9+.-]*:'))
     or (v_provider = 'microsoft_graph' and new.cursor_token not like 'https://graph.microsoft.com/v1.0/%') then
    raise exception 'connector_checkpoint_cursor_invalid';
  end if;
  v_key := encode(sha256(convert_to(v_target::text, 'UTF8')), 'hex');
  insert into public.foundation_connector_checkpoints
    (workspace_key, oauth_connection_id, target_key, reader_version, target, cursor_token, completed_job_id)
  values (new.workspace_key, new.oauth_connection_id, v_key, v_reader, v_target, new.cursor_token, new.job_id)
  on conflict (workspace_key, oauth_connection_id, target_key, reader_version) do update
    set cursor_token = excluded.cursor_token, completed_job_id = excluded.completed_job_id, updated_at = clock_timestamp()
    where public.foundation_connector_checkpoints.target = excluded.target;
  if not found then raise exception 'connector_checkpoint_target_mismatch'; end if;
  return new;
end;
$$;
revoke all on function public.capture_connector_checkpoint() from public, anon, authenticated;
grant execute on function public.capture_connector_checkpoint() to service_role;
create trigger foundation_jobs_checkpoint after update of state on public.foundation_jobs
for each row execute function public.capture_connector_checkpoint();

create function public.enqueue_connector_sync(
  p_job_id text, p_workspace_key text, p_created_by uuid, p_connection_id uuid,
  p_target jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_provider text;
  v_reader text;
  v_existing public.foundation_jobs%rowtype;
  v_target jsonb := coalesce(p_target, '{}'::jsonb);
  v_key text;
  v_checkpoint public.foundation_connector_checkpoints%rowtype;
begin
  if p_job_id is null or p_job_id !~ '^job-[a-f0-9]{32}$' or p_workspace_key is null
    or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_created_by is null then
    raise exception 'connector_sync_scope_invalid';
  end if;
  if jsonb_typeof(v_target) <> 'object' or octet_length(v_target::text) > 4096 then
    raise exception 'connector_sync_target_invalid';
  end if;
  if exists (select 1 from jsonb_each(v_target) as t(k,v) where k not in ('rootPath','driveId','siteId')
    or jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 512) then
    raise exception 'connector_sync_target_invalid';
  end if;
  -- Serialize admissions and completion checkpoint writes for this connection.
  select provider::text into v_provider from public.foundation_oauth_connections
   where workspace_key = p_workspace_key and oauth_connection_id = p_connection_id
     and status = 'active' for update;
  if not found then return jsonb_build_object('code','JOB_CONNECTION_UNAVAILABLE'); end if;
  v_reader := case v_provider when 'google_drive' then 'google-files-v1'
    when 'dropbox' then 'dropbox-list-v2' when 'microsoft_graph' then 'graph-delta-v2' end;
  if v_reader is null then raise exception 'connector_sync_provider_invalid'; end if;
  select * into v_existing from public.foundation_jobs
   where workspace_key = p_workspace_key and oauth_connection_id = p_connection_id
     and job_type = 'source_import' and state in ('queued','leased') limit 1;
  if found then
    if coalesce(v_existing.payload->'target','{}'::jsonb) <> v_target
      or v_existing.payload->>'sourceReaderVersion' is distinct from v_reader then
      return jsonb_build_object('code','JOB_SYNC_CONFLICT');
    end if;
    return jsonb_build_object('job_id',v_existing.job_id,'created',false);
  end if;
  v_key := encode(sha256(convert_to(v_target::text, 'UTF8')), 'hex');
  select * into v_checkpoint from public.foundation_connector_checkpoints
    where workspace_key = p_workspace_key and oauth_connection_id = p_connection_id
      and target_key = v_key and reader_version = v_reader;
  if found and v_checkpoint.target <> v_target then raise exception 'connector_checkpoint_target_mismatch'; end if;
  insert into public.foundation_jobs (job_id, workspace_key, job_type, idempotency_key, created_by,
    oauth_connection_id, payload, cursor_token)
  values (p_job_id, p_workspace_key, 'source_import', 'source_import:' || p_connection_id::text,
    p_created_by, p_connection_id, jsonb_build_object('userId',p_created_by,'target',v_target,
      'sourceReaderVersion',v_reader), v_checkpoint.cursor_token);
  return jsonb_build_object('job_id',p_job_id,'created',true);
end;
$$;
revoke all on function public.enqueue_connector_sync(text,text,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_connector_sync(text,text,uuid,uuid,jsonb) to service_role;
commit;
