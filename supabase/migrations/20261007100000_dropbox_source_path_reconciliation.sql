begin;

-- Dropbox DeletedMetadata names a removed path and carries no id. A path is where a source was
-- observed, never what it is, so connectorSourceIdentity still hashes only the genuine `id:`.
-- These rows remember which id each path last named, per (workspace, connection, target), so a
-- path-only removal resolves to the owner observed BEFORE the page that reports the removal.
-- ponytail: rows are never pruned (one per distinct path ever observed in a scope); prune paths
-- whose id is suspended if a scope's table size ever matters.
create table public.dropbox_source_paths (
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  oauth_connection_id uuid not null
    references public.foundation_oauth_connections(oauth_connection_id) on delete cascade,
  target jsonb not null check (jsonb_typeof(target) = 'object'),
  -- "C" makes the folder-descendant range below a byte range served by the primary key.
  path_lower text collate "C" not null check (char_length(path_lower) between 2 and 1024 and left(path_lower, 1) = '/'),
  native_id text not null check (native_id ~ '^id:' and char_length(native_id) <= 512),
  live boolean not null,
  page_key text not null check (page_key ~ '^[a-f0-9]{64}$'),
  primary key (workspace_key, oauth_connection_id, target, path_lower)
);
create index dropbox_source_paths_native_id
  on public.dropbox_source_paths (workspace_key, oauth_connection_id, target, native_id);

-- A removal is staged here, not acted on: a move may arrive as the old path's removal on one page
-- and the new path's metadata on a later one. Suspension waits for the listing boundary.
create table public.dropbox_source_pending_removals (
  workspace_key text not null,
  oauth_connection_id uuid not null
    references public.foundation_oauth_connections(oauth_connection_id) on delete cascade,
  target jsonb not null,
  native_id text not null check (native_id ~ '^id:' and char_length(native_id) <= 512),
  -- The path and page the owner was captured from, before any later reuse of that path.
  path_lower text collate "C" not null,
  page_key text not null check (page_key ~ '^[a-f0-9]{64}$'),
  primary key (workspace_key, oauth_connection_id, target, native_id)
);

-- One receipt per durable page: a restarted or replayed worker gets the same answer and the
-- page's path changes are never applied twice.
create table public.dropbox_source_reconciliation_receipts (
  workspace_key text not null,
  job_id text not null,
  page_key text not null,
  suspend jsonb not null check (jsonb_typeof(suspend) = 'array'),
  -- Removed ids that were never imported (skipped files, folders): nothing to suspend, recorded.
  unbound jsonb not null check (jsonb_typeof(unbound) = 'array'),
  recorded_at timestamptz not null default now(),
  primary key (workspace_key, job_id, page_key),
  foreign key (workspace_key, job_id, page_key)
    references public.foundation_connector_page_snapshots(workspace_key, job_id, page_key) on delete cascade
);

alter table public.dropbox_source_paths enable row level security;
alter table public.dropbox_source_pending_removals enable row level security;
alter table public.dropbox_source_reconciliation_receipts enable row level security;
revoke all on public.dropbox_source_paths from public, anon, authenticated, service_role;
revoke all on public.dropbox_source_pending_removals from public, anon, authenticated, service_role;
revoke all on public.dropbox_source_reconciliation_receipts from public, anon, authenticated, service_role;
grant select, insert, update on public.dropbox_source_paths to service_role;
grant select, insert, delete on public.dropbox_source_pending_removals to service_role;
grant select, insert on public.dropbox_source_reconciliation_receipts to service_role;

-- Applies the stored page snapshot (never a caller-supplied page) under the same lease the
-- snapshot RPC requires.
--
-- Entries apply in listing order, as Dropbox's list_folder contract requires (files.stone,
-- list_folder `recursive`): a DeletedMetadata removes whatever occupies its path at that point
-- in the stream, plus children. So [file B at /a, delete /a] removes B, and [delete /a, file B
-- at /a] leaves B live. Each later page resolves against the ownership earlier pages left.
--
-- Returns the ids to suspend: empty until the page that ends the listing (complete), then every
-- staged id with no live in-scope path AND a connector_document_bindings row for this workspace,
-- connection and provider -- the suspension guard refuses an unbound source forever, and a source
-- never imported has nothing to suspend. Those ids are returned and kept as `unbound`. Path rows
-- are written on observation regardless, so move detection does not depend on import outcome.
-- Any refusal rolls the whole page back and writes no receipt, so the worker cannot acknowledge it.
-- Pending removals and paths are per scope, so only the one canonical stream per connection may
-- apply pages: enqueue_connector_sync resumes a failed/dead stream in place, and the insert guard
-- below refuses any other source_import for a Dropbox connection.
create function public.reconcile_dropbox_source_page(
  p_workspace_key text, p_job_id text, p_worker_id text, p_page_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.foundation_jobs%rowtype;
  v_target jsonb;
  v_page jsonb;
  v_item jsonb;
  v_id text;
  v_path text;
  v_resolved integer;
  v_suspend jsonb;
  v_unbound jsonb;
begin
  select * into v_job from public.foundation_jobs
    where job_id = p_job_id and workspace_key = p_workspace_key for update;
  if not found or v_job.job_type <> 'source_import' or v_job.state <> 'leased'
    or v_job.leased_by is distinct from p_worker_id
    or v_job.lease_expires_at <= clock_timestamp() then
    raise exception 'CONNECTOR_PAGE_LEASE_INVALID';
  end if;
  perform 1 from public.foundation_oauth_connections
    where oauth_connection_id = v_job.oauth_connection_id and workspace_key = p_workspace_key
      and status = 'active' and provider = 'dropbox' for share;
  if not found or not exists (select 1 from public.foundation_workspaces w where w.workspace_key = p_workspace_key) then
    raise exception 'CONNECTOR_PAGE_CONNECTION_INVALID';
  end if;
  v_target := coalesce(v_job.payload->'target', '{}'::jsonb);
  -- Only the canonical stream applies pages; a second live stream would interleave path history.
  if v_job.payload->>'sourceReaderVersion' is distinct from 'dropbox-list-v2'
    or v_job.idempotency_key <> 'source_import:' || v_job.oauth_connection_id::text
    or jsonb_typeof(v_target) <> 'object'
    or exists (select 1 from public.foundation_connector_checkpoints c
      where c.workspace_key = p_workspace_key and c.oauth_connection_id = v_job.oauth_connection_id
        and c.reader_version = 'dropbox-list-v2'
        and c.target_key = encode(sha256(convert_to(v_target::text, 'UTF8')), 'hex') and c.target <> v_target)
    or exists (select 1 from public.foundation_jobs j
      where j.oauth_connection_id = v_job.oauth_connection_id and j.job_type = 'source_import'
        and j.state in ('queued','leased') and (j.workspace_key, j.job_id) <> (p_workspace_key, p_job_id)) then
    raise exception 'DROPBOX_SOURCE_STREAM_INVALID';
  end if;
  select page into v_page from public.foundation_connector_page_snapshots
    where workspace_key = p_workspace_key and job_id = p_job_id and page_key = p_page_key;
  if not found then raise exception 'DROPBOX_SOURCE_PAGE_MISSING'; end if;
  -- Path knowledge is shared by every job on this scope; one page applies at a time.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dropbox-source-paths'
    || pg_catalog.chr(10) || p_workspace_key || pg_catalog.chr(10) || v_job.oauth_connection_id::text
    || pg_catalog.chr(10) || v_target::text, 0));
  select suspend, unbound into v_suspend, v_unbound from public.dropbox_source_reconciliation_receipts
    where workspace_key = p_workspace_key and job_id = p_job_id and page_key = p_page_key;
  if found then return jsonb_build_object('suspend', v_suspend, 'unbound', v_unbound, 'replayed', true); end if;
  v_suspend := '[]'::jsonb;
  v_unbound := '[]'::jsonb;

  for v_item in select e.value from jsonb_array_elements(v_page->'items') with ordinality as e(value, n)
      order by e.n loop
    v_id := v_item->>'nativeId';
    v_path := v_item->>'providerPath';
    -- A pre-fix snapshot used path_lower as nativeId and stored no path. It names no stable source.
    if (v_id is not null and v_id !~ '^id:') or v_path is null or v_path !~ '^/' then
      raise exception 'DROPBOX_SOURCE_IDENTITY_LEGACY';
    end if;
    if v_item->>'kind' = 'deleted' then
      -- Capture the prior owner(s): the path itself and, for a folder, every known descendant.
      insert into public.dropbox_source_pending_removals
          (workspace_key, oauth_connection_id, target, native_id, path_lower, page_key)
        select distinct on (p.native_id) p.workspace_key, p.oauth_connection_id, p.target, p.native_id, p.path_lower, p_page_key
          from public.dropbox_source_paths p
          where p.workspace_key = p_workspace_key and p.oauth_connection_id = v_job.oauth_connection_id
            and p.target = v_target and (p.path_lower = v_path
              or (p.path_lower >= v_path || '/' and p.path_lower < v_path || '0'))
          order by p.native_id, p.path_lower
        on conflict (workspace_key, oauth_connection_id, target, native_id) do nothing;
      update public.dropbox_source_paths p set live = false, page_key = p_page_key
        where p.workspace_key = p_workspace_key and p.oauth_connection_id = v_job.oauth_connection_id
          and p.target = v_target and (p.path_lower = v_path
            or (p.path_lower >= v_path || '/' and p.path_lower < v_path || '0'));
      get diagnostics v_resolved = row_count;
      if v_id is not null then
        insert into public.dropbox_source_pending_removals
            (workspace_key, oauth_connection_id, target, native_id, path_lower, page_key)
          values (p_workspace_key, v_job.oauth_connection_id, v_target, v_id, v_path, p_page_key)
          on conflict (workspace_key, oauth_connection_id, target, native_id) do nothing;
      elsif v_resolved = 0 then
        -- Never observed here: no id to stage, and acknowledging it would lose the removal.
        raise exception 'DROPBOX_SOURCE_PATH_UNRESOLVED';
      end if;
    elsif v_id is null then
      raise exception 'DROPBOX_SOURCE_IDENTITY_LEGACY';
    else
      -- A different id still live at this path (overwritten, no removal) is staged, never redirected.
      insert into public.dropbox_source_pending_removals
          (workspace_key, oauth_connection_id, target, native_id, path_lower, page_key)
        select p.workspace_key, p.oauth_connection_id, p.target, p.native_id, p.path_lower, p_page_key
          from public.dropbox_source_paths p
          where p.workspace_key = p_workspace_key and p.oauth_connection_id = v_job.oauth_connection_id
            and p.target = v_target and p.path_lower = v_path and p.native_id <> v_id and p.live
        on conflict (workspace_key, oauth_connection_id, target, native_id) do nothing;
      -- An id is live at one path; its former paths stay as history for a late removal.
      update public.dropbox_source_paths p set live = false
        where p.workspace_key = p_workspace_key and p.oauth_connection_id = v_job.oauth_connection_id
          and p.target = v_target and p.native_id = v_id and p.path_lower <> v_path;
      insert into public.dropbox_source_paths
          (workspace_key, oauth_connection_id, target, path_lower, native_id, live, page_key)
        values (p_workspace_key, v_job.oauth_connection_id, v_target, v_path, v_id, true, p_page_key)
        on conflict (workspace_key, oauth_connection_id, target, path_lower)
        do update set native_id = excluded.native_id, live = true, page_key = excluded.page_key;
    end if;
  end loop;

  if (v_page->>'complete')::boolean then
    -- The listing boundary: an id live at any in-scope path is retained, however it got there.
    select coalesce(jsonb_agg(r.native_id order by r.native_id) filter (where r.bound), '[]'::jsonb),
        coalesce(jsonb_agg(r.native_id order by r.native_id) filter (where not r.bound), '[]'::jsonb)
      into v_suspend, v_unbound
      from (select pr.native_id, exists (select 1 from public.connector_document_bindings b
              where b.workspace_key = pr.workspace_key and b.oauth_connection_id = pr.oauth_connection_id
                and b.provider = 'dropbox' and b.native_id = pr.native_id) as bound
            from public.dropbox_source_pending_removals pr
            where pr.workspace_key = p_workspace_key and pr.oauth_connection_id = v_job.oauth_connection_id
              and pr.target = v_target and not exists (select 1 from public.dropbox_source_paths p
                where p.workspace_key = pr.workspace_key and p.oauth_connection_id = pr.oauth_connection_id
                  and p.target = pr.target and p.native_id = pr.native_id and p.live)) r;
    delete from public.dropbox_source_pending_removals r
      where r.workspace_key = p_workspace_key and r.oauth_connection_id = v_job.oauth_connection_id
        and r.target = v_target;
  end if;
  insert into public.dropbox_source_reconciliation_receipts (workspace_key, job_id, page_key, suspend, unbound)
    values (p_workspace_key, p_job_id, p_page_key, v_suspend, v_unbound);
  return jsonb_build_object('suspend', v_suspend, 'unbound', v_unbound, 'replayed', false);
end;
$$;
revoke all on function public.reconcile_dropbox_source_page(text,text,text,text) from public, anon, authenticated;
grant execute on function public.reconcile_dropbox_source_page(text,text,text,text) to service_role;

-- A Dropbox stream that failed or died mid-listing has already applied pages to path history and
-- holds receipts (suspend ids) keyed by its job id. A fresh job would restart at the last
-- successful checkpoint against path ownership that no longer matches it, so the stream is
-- uncommitted until that same job succeeds: the latest source_import for the connection, if it
-- is a failed/dead dropbox-list-v2 job. Only canceling it (an operator act) releases the connection.
create function public.dropbox_uncommitted_source_stream(p_workspace_key text, p_connection_id uuid)
returns public.foundation_jobs language sql stable security invoker set search_path = '' as $$
  select j.* from (select * from public.foundation_jobs
      where workspace_key = p_workspace_key and oauth_connection_id = p_connection_id and job_type = 'source_import'
      order by created_at desc, job_id desc limit 1) j
    where j.state in ('failed','dead') and j.payload->>'sourceReaderVersion' = 'dropbox-list-v2';
$$;
revoke all on function public.dropbox_uncommitted_source_stream(text,uuid) from public, anon, authenticated;
grant execute on function public.dropbox_uncommitted_source_stream(text,uuid) to service_role;

-- Same contract as before, plus: under the connection lock, an uncommitted Dropbox stream is
-- requeued in place -- cursor, progress, page snapshots and receipts kept -- instead of replaced.
create or replace function public.enqueue_connector_sync(
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
  v_reader := case v_provider when 'google_drive' then 'google-lifecycle-v2'
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
  if v_provider = 'dropbox' then
    v_existing := public.dropbox_uncommitted_source_stream(p_workspace_key, p_connection_id);
    if v_existing.job_id is not null then
      if coalesce(v_existing.payload->'target','{}'::jsonb) <> v_target then
        return jsonb_build_object('code','JOB_SYNC_CONFLICT');
      end if;
      update public.foundation_jobs set state = 'queued', attempt = 0, error_code = null, error_detail = null,
          completed_at = null, available_at = now(), updated_at = now()
        where workspace_key = p_workspace_key and job_id = v_existing.job_id;
      return jsonb_build_object('job_id',v_existing.job_id,'created',false);
    end if;
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

-- Any path into foundation_jobs (enqueue_foundation_job, a direct insert) must meet the same
-- contract for a Dropbox connection: one canonical, live-free, committed stream.
create function public.guard_dropbox_source_import_insert() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_provider text;
begin
  if new.job_type <> 'source_import' or new.oauth_connection_id is null then return new; end if;
  select provider::text into v_provider from public.foundation_oauth_connections
    where oauth_connection_id = new.oauth_connection_id for update;
  if not found or v_provider <> 'dropbox' then return new; end if;
  if new.state <> 'queued'
    or new.idempotency_key <> 'source_import:' || new.oauth_connection_id::text
    or new.payload->>'sourceReaderVersion' is distinct from 'dropbox-list-v2'
    or not exists (select 1 from public.foundation_oauth_connections c
      where c.oauth_connection_id = new.oauth_connection_id and c.workspace_key = new.workspace_key and c.status = 'active')
    or not exists (select 1 from public.foundation_workspaces w where w.workspace_key = new.workspace_key) then
    raise exception 'DROPBOX_SOURCE_STREAM_INVALID';
  end if;
  if exists (select 1 from public.foundation_jobs j where j.oauth_connection_id = new.oauth_connection_id
      and j.job_type = 'source_import' and j.state in ('queued','leased'))
    or (public.dropbox_uncommitted_source_stream(new.workspace_key, new.oauth_connection_id)).job_id is not null then
    raise exception 'DROPBOX_SOURCE_STREAM_CONFLICT';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_dropbox_source_import_insert() from public, anon, authenticated;
create trigger foundation_jobs_dropbox_stream_guard before insert on public.foundation_jobs
for each row execute function public.guard_dropbox_source_import_insert();

commit;
