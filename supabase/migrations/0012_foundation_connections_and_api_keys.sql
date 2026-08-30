-- Tenant-scoped developer access and connector control plane. This migration stores
-- metadata only: source bytes stay browser/agent-direct to R2 and credential values stay
-- in an external secret manager or the operating-system mount configuration.
begin;

create table public.foundation_api_keys (
  key_id uuid primary key default gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  name text not null check (char_length(name) between 1 and 80),
  key_prefix text not null unique check (key_prefix ~ '^[A-Za-z0-9_-]{12}$'),
  token_sha256 text not null unique check (token_sha256 ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (
    cardinality(scopes) between 1 and 12
    and scopes <@ array[
      'documents:read', 'documents:intake', 'collections:read', 'collections:compile',
      'collections:download', 'worlds:read', 'ask:read',
      'connections:read', 'connections:write', 'connections:sync'
    ]::text[]
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  check (expires_at is null or expires_at > created_at)
);
create index foundation_api_keys_workspace_idx
  on public.foundation_api_keys (workspace_key, created_at desc);
create index foundation_api_keys_active_prefix_idx
  on public.foundation_api_keys (key_prefix) where revoked_at is null;

create table public.foundation_api_rate_windows (
  key_id uuid not null references public.foundation_api_keys(key_id) on delete cascade,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  scope text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (key_id, scope, window_started_at)
);
create index foundation_api_rate_windows_expiry_idx
  on public.foundation_api_rate_windows (window_started_at);

create table public.foundation_connections (
  connection_id uuid primary key default gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  provider text not null check (provider in ('file_server', 's3', 'r2', 'minio')),
  mode text not null check (mode in ('local_agent', 'cloud_pull')),
  display_name text not null check (char_length(display_name) between 1 and 100),
  configuration jsonb not null default '{}'::jsonb check (
    jsonb_typeof(configuration) = 'object'
    and octet_length(configuration::text) <= 8192
    and configuration::text !~* '"(secret|password|token|credential|access[_-]?key|private[_-]?key)"[[:space:]]*:'
  ),
  secret_reference text check (
    secret_reference is null or secret_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]{3,500}$'
  ),
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'error', 'revoked')),
  cursor_sha256 text check (cursor_sha256 is null or cursor_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  last_sync_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (provider = 'file_server' and mode = 'local_agent' and secret_reference is null)
    or (provider in ('s3', 'r2', 'minio') and (
      (mode = 'local_agent' and secret_reference is null)
      or (mode = 'cloud_pull' and secret_reference is not null)
    ))
  )
);
create index foundation_connections_workspace_idx
  on public.foundation_connections (workspace_key, created_at desc);

create table public.foundation_connection_batches (
  batch_id uuid primary key,
  workspace_key text not null,
  connection_id uuid not null references public.foundation_connections(connection_id) on delete restrict,
  previous_cursor_sha256 text check (previous_cursor_sha256 is null or previous_cursor_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  next_cursor_sha256 text not null check (next_cursor_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  event_count integer not null check (event_count between 0 and 5000),
  event_manifest jsonb not null check (
    jsonb_typeof(event_manifest) = 'array'
    and jsonb_array_length(event_manifest) = event_count
    and octet_length(event_manifest::text) <= 1048576
    and event_manifest::text !~* '"(content|text|secret|password|token|credential|access[_-]?key|private[_-]?key)"[[:space:]]*:'
  ),
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_key_id uuid references public.foundation_api_keys(key_id) on delete restrict,
  received_at timestamptz not null default now(),
  unique (workspace_key, connection_id, manifest_sha256),
  check ((actor_user_id is null) <> (actor_key_id is null))
);
create index foundation_connection_batches_connection_idx
  on public.foundation_connection_batches (workspace_key, connection_id, received_at desc);

create table public.foundation_developer_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  action text not null check (action in (
    'api_key_created', 'api_key_revoked', 'connection_created',
    'connection_updated', 'connection_revoked', 'connection_batch_applied'
  )),
  target_id text not null check (char_length(target_id) between 1 and 128),
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_key_id uuid references public.foundation_api_keys(key_id) on delete restrict,
  details jsonb not null default '{}'::jsonb check (
    jsonb_typeof(details) = 'object'
    and octet_length(details::text) <= 8192
    and details::text !~* '"(content|text|secret|password|token|credential|access[_-]?key|private[_-]?key)"[[:space:]]*:'
  ),
  created_at timestamptz not null default now(),
  check ((actor_user_id is null) <> (actor_key_id is null))
);
create index foundation_developer_audit_workspace_idx
  on public.foundation_developer_audit_events (workspace_key, created_at desc);

alter table public.foundation_api_keys enable row level security;
alter table public.foundation_api_rate_windows enable row level security;
alter table public.foundation_connections enable row level security;
alter table public.foundation_connection_batches enable row level security;
alter table public.foundation_developer_audit_events enable row level security;

revoke all on public.foundation_api_keys, public.foundation_api_rate_windows, public.foundation_connections,
  public.foundation_connection_batches, public.foundation_developer_audit_events
  from public, anon, authenticated;
grant select, insert, update, delete on public.foundation_api_rate_windows to service_role;
grant select, insert, update on public.foundation_api_keys, public.foundation_connections,
  public.foundation_connection_batches, public.foundation_developer_audit_events to service_role;

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

  select * into v_connection from public.foundation_connections
    where connection_id = p_connection_id and workspace_key = p_workspace_key for update;
  if not found or v_connection.status in ('revoked', 'paused') then
    raise exception 'connection_not_syncable';
  end if;

  select * into v_existing from public.foundation_connection_batches where batch_id = p_batch_id;
  if found then
    if v_existing.workspace_key is distinct from p_workspace_key
      or v_existing.connection_id is distinct from p_connection_id
      or v_existing.manifest_sha256 is distinct from p_manifest_sha256 then
      raise exception 'connection_batch_idempotency_conflict';
    end if;
    return jsonb_build_object('status', 'replayed', 'batchId', p_batch_id);
  end if;

  if v_connection.cursor_sha256 is distinct from p_previous_cursor_sha256 then
    raise exception 'connection_cursor_conflict';
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

create or replace function public.consume_foundation_api_rate_limit(
  p_key_id uuid,
  p_workspace_key text,
  p_scope text,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  v_count integer;
begin
  delete from public.foundation_api_rate_windows
    where key_id = p_key_id and window_started_at < v_window - interval '1 day';
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_scope not in (
      'documents:read', 'documents:intake', 'collections:read', 'collections:compile',
      'collections:download', 'worlds:read', 'ask:read',
      'connections:read', 'connections:write', 'connections:sync'
    )
    or p_limit not between 1 and 1000
    or not exists (
      select 1 from public.foundation_api_keys
      where key_id = p_key_id and workspace_key = p_workspace_key
        and revoked_at is null and (expires_at is null or expires_at > clock_timestamp())
    ) then
    return false;
  end if;

  insert into public.foundation_api_rate_windows (
    key_id, workspace_key, scope, window_started_at, request_count
  ) values (p_key_id, p_workspace_key, p_scope, v_window, 1)
  on conflict (key_id, scope, window_started_at) do update
    set request_count = public.foundation_api_rate_windows.request_count + 1
    where public.foundation_api_rate_windows.request_count < p_limit
  returning request_count into v_count;
  return v_count is not null and v_count <= p_limit;
end;
$$;

revoke all on function public.apply_foundation_connection_batch(
  uuid, text, uuid, text, text, text, integer, jsonb, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.apply_foundation_connection_batch(
  uuid, text, uuid, text, text, text, integer, jsonb, uuid, uuid
) to service_role;
revoke all on function public.consume_foundation_api_rate_limit(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_foundation_api_rate_limit(uuid, text, text, integer)
  to service_role;

commit;
