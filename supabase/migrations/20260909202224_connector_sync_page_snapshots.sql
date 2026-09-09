begin;

create table public.foundation_connector_page_snapshots (
  job_id text not null,
  workspace_key text not null,
  page_key text not null check (page_key ~ '^[a-f0-9]{64}$'),
  page jsonb not null check (
    octet_length(page::text) <= 131072
    and page ?& array['items', 'complete', 'cursor']
    and jsonb_typeof(page) = 'object'
    and jsonb_typeof(page->'items') = 'array'
    and jsonb_array_length(page->'items') <= 25
    and jsonb_typeof(page->'complete') = 'boolean'
    and (page->'cursor' = 'null'::jsonb or
      (jsonb_typeof(page->'cursor') = 'string' and char_length(page->>'cursor') <= 4096))
  ),
  recorded_at timestamptz not null default now(),
  primary key (workspace_key, job_id, page_key),
  foreign key (workspace_key, job_id) references public.foundation_jobs(workspace_key, job_id) on delete cascade
);
alter table public.foundation_connector_page_snapshots enable row level security;
revoke all on public.foundation_connector_page_snapshots from public, anon, authenticated, service_role;
grant select, insert on public.foundation_connector_page_snapshots to service_role;

-- Only the current lease holder can create or retrieve a checkpoint through this RPC.
-- The job lock serializes replacement workers; first observed page wins, never upsert.
create function public.connector_sync_page(
  p_workspace_key text, p_job_id text, p_worker_id text, p_page_key text, p_page jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.foundation_jobs%rowtype;
  v_page jsonb;
begin
  select * into v_job from public.foundation_jobs
    where job_id = p_job_id and workspace_key = p_workspace_key for update;
  if not found or v_job.job_type <> 'source_import' or v_job.state <> 'leased'
    or v_job.leased_by is distinct from p_worker_id
    or v_job.lease_expires_at <= clock_timestamp() then
    raise exception 'CONNECTOR_PAGE_LEASE_INVALID';
  end if;
  perform 1 from public.foundation_oauth_connections
    where oauth_connection_id = v_job.oauth_connection_id and workspace_key = p_workspace_key and status = 'active' for share;
  if not found then raise exception 'CONNECTOR_PAGE_CONNECTION_INVALID'; end if;
  if p_page_key is null or p_page_key !~ '^[a-f0-9]{64}$' then
    raise exception 'CONNECTOR_PAGE_KEY_INVALID';
  end if;
  select page into v_page from public.foundation_connector_page_snapshots
    where job_id = p_job_id and page_key = p_page_key and workspace_key = p_workspace_key;
  if found then return v_page; end if;
  if p_page is null then return null; end if;
  insert into public.foundation_connector_page_snapshots(job_id, workspace_key, page_key, page)
    values (p_job_id, p_workspace_key, p_page_key, p_page);
  return p_page;
end;
$$;
revoke all on function public.connector_sync_page(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.connector_sync_page(text,text,text,text,jsonb) to service_role;

commit;
