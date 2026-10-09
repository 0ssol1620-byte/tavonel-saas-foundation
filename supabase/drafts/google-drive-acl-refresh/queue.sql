-- Draft only: bounded ACL metadata-refresh queue. Do not register/apply until the
-- application adapter, current-ACL authorization RPC, scheduler, and disposable pgTAP tests land.
begin;

-- A refresh is a new immutable observation even when the ACL content hash is unchanged. Preserve
-- the original row (including captured_at) for jobs that pinned it, and let later observations
-- coexist so the serving policy can select the latest complete capture.
do $$
declare
  v_constraint oid;
begin
  select c.oid into v_constraint
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.source_acl_snapshots'::regclass
     and c.conname = 'source_acl_snapshots_source_version_id_provider_id_snapshot_key'
     and c.contype = 'u'
     and pg_catalog.pg_get_constraintdef(c.oid) = 'UNIQUE (source_version_id, provider_id, snapshot_sha256)';
  if v_constraint is null then
    raise exception 'ACL_REFRESH_EXPECTED_SNAPSHOT_UNIQUE_CONSTRAINT_MISSING_OR_MISMATCHED';
  end if;
  alter table public.source_acl_snapshots
    drop constraint source_acl_snapshots_source_version_id_provider_id_snapshot_key;
  if exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.source_acl_snapshots'::regclass
       and c.conname = 'source_acl_snapshots_source_version_id_provider_id_snapshot_key'
  ) then
    raise exception 'ACL_REFRESH_SNAPSHOT_UNIQUE_CONSTRAINT_NOT_REMOVED';
  end if;
end;
$$;

create or replace function public.record_google_drive_source_acl_snapshot(
  p_workspace_key text, p_connection_id uuid, p_source_version_id text,
  p_principals jsonb, p_snapshot_sha256 text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_connection_id is null or p_source_version_id is null or p_source_version_id !~ '^sv-[a-f0-9]{64}$'
     or p_snapshot_sha256 is null or p_snapshot_sha256 !~ '^sha256:[a-f0-9]{64}$'
     or p_principals is null or pg_catalog.jsonb_typeof(p_principals) <> 'array'
     or pg_catalog.jsonb_array_length(p_principals) > 2000
     or pg_catalog.octet_length(p_principals::text) > 262144 then
    raise exception 'source_acl_capture_invalid';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_principals) row_value
    where pg_catalog.jsonb_typeof(row_value) <> 'object'
       or row_value->>'kind' <> 'user'
       or row_value->>'principalId' is null
       or char_length(row_value->>'principalId') not between 1 and 512
       or row_value->>'principalId' ~ '[[:cntrl:]]'
       or row_value->>'permission' not in ('read', 'write', 'owner')
       or (select count(*) from pg_catalog.jsonb_object_keys(row_value)) <> 3
  ) then raise exception 'source_acl_capture_principal_invalid'; end if;
  if not exists (
    select 1 from public.connector_document_bindings b
    join public.foundation_oauth_connections c on c.oauth_connection_id = b.oauth_connection_id
    where b.workspace_key = p_workspace_key and b.oauth_connection_id = p_connection_id
      and b.source_version_id = p_source_version_id and b.provider = 'google_drive'
      and c.workspace_key = b.workspace_key and c.provider = b.provider and c.status = 'active'
  ) then raise exception 'source_acl_capture_binding_invalid'; end if;
  insert into public.source_acl_snapshots(
    source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at, capture_complete
  ) values (
    p_source_version_id, p_workspace_key, 'google_drive', p_principals, p_snapshot_sha256, pg_catalog.clock_timestamp(), true
  );
end;
$$;
revoke all on function public.record_google_drive_source_acl_snapshot(text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_google_drive_source_acl_snapshot(text, uuid, text, jsonb, text) to service_role;

create table public.foundation_google_drive_acl_refresh_queue (
  refresh_id uuid primary key default gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  oauth_connection_id uuid not null,
  source_version_id text not null references public.connector_document_bindings(source_version_id) on delete cascade,
  state text not null default 'queued' check (state in ('queued','leased','done','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (workspace_key, oauth_connection_id, source_version_id),
  check ((state = 'leased') = (lease_token is not null and lease_expires_at is not null))
);
create index foundation_google_drive_acl_refresh_due_idx
  on public.foundation_google_drive_acl_refresh_queue(next_attempt_at, updated_at)
  where state in ('queued','leased');
create index foundation_google_drive_acl_refresh_cleanup_idx
  on public.foundation_google_drive_acl_refresh_queue(refresh_id)
  where state in ('queued','leased');
alter table public.foundation_google_drive_acl_refresh_queue enable row level security;
revoke all on public.foundation_google_drive_acl_refresh_queue from public, anon, authenticated, service_role;

create table public.foundation_google_drive_acl_refresh_scan_cursor (
  singleton boolean primary key default true check (singleton),
  last_source_version_id text,
  last_cleanup_refresh_id uuid,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
insert into public.foundation_google_drive_acl_refresh_scan_cursor(singleton) values (true);
alter table public.foundation_google_drive_acl_refresh_scan_cursor enable row level security;
revoke all on public.foundation_google_drive_acl_refresh_scan_cursor from public, anon, authenticated, service_role;

create table public.foundation_google_drive_acl_refresh_connection_cooldowns (
  oauth_connection_id uuid primary key,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  cooldown_until timestamptz not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table public.foundation_google_drive_acl_refresh_connection_cooldowns enable row level security;
revoke all on public.foundation_google_drive_acl_refresh_connection_cooldowns from public, anon, authenticated, service_role;

create function public.cooldown_google_drive_acl_refresh_connection(
  p_workspace_key text, p_oauth_connection_id uuid, p_delay_seconds integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_oauth_connection_id is null or p_delay_seconds is null
     or p_delay_seconds < 1 or p_delay_seconds > 900 then
    raise exception 'ACL_REFRESH_COOLDOWN_INPUT_INVALID';
  end if;
  insert into public.foundation_google_drive_acl_refresh_connection_cooldowns(
    oauth_connection_id, workspace_key, cooldown_until, updated_at
  ) values (
    p_oauth_connection_id, p_workspace_key,
    pg_catalog.clock_timestamp() + p_delay_seconds * interval '1 second', pg_catalog.clock_timestamp()
  ) on conflict (oauth_connection_id) do update
    set cooldown_until = greatest(
          public.foundation_google_drive_acl_refresh_connection_cooldowns.cooldown_until,
          excluded.cooldown_until
        ),
        updated_at = pg_catalog.clock_timestamp()
    where public.foundation_google_drive_acl_refresh_connection_cooldowns.workspace_key = excluded.workspace_key;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'ACL_REFRESH_COOLDOWN_SCOPE_INVALID'; end if;
  return true;
end;
$$;

create function public.enqueue_stale_google_drive_acl_refreshes(p_max_age_seconds integer, p_limit integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  v_cursor text;
  v_scan_last text;
  v_wrap_last text;
  v_scan_count integer := 0;
  v_cleanup_cursor_id uuid;
  v_cleanup_scan_id uuid;
  v_cleanup_wrap_id uuid;
  v_cleanup_scan_count integer := 0;
begin
  if p_max_age_seconds is null or p_max_age_seconds < 60 or p_max_age_seconds > 900
     or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'ACL_REFRESH_QUEUE_INPUT_INVALID';
  end if;

  select last_source_version_id, last_cleanup_refresh_id
    into v_cursor, v_cleanup_cursor_id
    from public.foundation_google_drive_acl_refresh_scan_cursor
   where singleton for update;

  select pg_catalog.count(*)::integer into v_cleanup_scan_count
    from (
      select q.refresh_id from public.foundation_google_drive_acl_refresh_queue q
       where q.state in ('queued','leased')
         and (v_cleanup_cursor_id is null or q.refresh_id > v_cleanup_cursor_id)
       order by q.refresh_id limit p_limit
    ) cleanup_scan;
  select q.refresh_id into v_cleanup_scan_id
    from (
      select q.refresh_id from public.foundation_google_drive_acl_refresh_queue q
       where q.state in ('queued','leased')
         and (v_cleanup_cursor_id is null or q.refresh_id > v_cleanup_cursor_id)
       order by q.refresh_id limit p_limit
    ) q order by q.refresh_id desc limit 1;
  if v_cleanup_cursor_id is not null and v_cleanup_scan_count < p_limit then
    select q.refresh_id into v_cleanup_wrap_id
      from (
        select q.refresh_id from public.foundation_google_drive_acl_refresh_queue q
         where q.state in ('queued','leased')
           and q.refresh_id <= v_cleanup_cursor_id
         order by q.refresh_id limit (p_limit - v_cleanup_scan_count)
      ) q order by q.refresh_id desc limit 1;
  end if;

  -- Bound cleanup work separately from inventory discovery and lock rows without waiting.
  with cleanup_scan as (
    select q.refresh_id
      from public.foundation_google_drive_acl_refresh_queue q
     where q.state in ('queued','leased')
       and (v_cleanup_cursor_id is null or q.refresh_id > v_cleanup_cursor_id)
     order by q.refresh_id
     limit p_limit
  ), cleanup_wrap as (
    select q.refresh_id
      from public.foundation_google_drive_acl_refresh_queue q
     where q.state in ('queued','leased')
       and v_cleanup_cursor_id is not null and q.refresh_id <= v_cleanup_cursor_id
       and (select count(*) from cleanup_scan) < p_limit
     order by q.refresh_id
     limit greatest(0, p_limit - (select count(*)::integer from cleanup_scan))
  ), cleanup_page as (
    select refresh_id from cleanup_scan
    union all
    select refresh_id from cleanup_wrap
  ), cleanup as (
    select q.refresh_id
      from cleanup_page p
      join public.foundation_google_drive_acl_refresh_queue q on q.refresh_id = p.refresh_id
     for update of q skip locked
  ), stale as (
    select q.refresh_id
      from cleanup x
      join public.foundation_google_drive_acl_refresh_queue q on q.refresh_id = x.refresh_id
     where not exists (
       select 1 from public.connector_document_bindings b
       join public.foundation_oauth_connections c on c.oauth_connection_id = b.oauth_connection_id
         and c.workspace_key = b.workspace_key and c.provider = 'google_drive' and c.status = 'active'
       where b.workspace_key = q.workspace_key and b.oauth_connection_id = q.oauth_connection_id
         and b.source_version_id = q.source_version_id and b.provider = 'google_drive'
         and public.connector_source_newest_versions(b.workspace_key, b.source_id) = array[b.source_version_id]
         and public.connector_source_import_allowed(b.workspace_key, b.source_id)
     )
  )
  update public.foundation_google_drive_acl_refresh_queue q
     set state = 'cancelled', lease_token = null, lease_expires_at = null,
         last_error_code = 'ACL_REFRESH_AUTHORITY_CHANGED', updated_at = pg_catalog.clock_timestamp()
    from stale s where q.refresh_id = s.refresh_id;
  update public.foundation_google_drive_acl_refresh_scan_cursor
     set last_cleanup_refresh_id = coalesce(v_cleanup_wrap_id, v_cleanup_scan_id),
         updated_at = pg_catalog.clock_timestamp()
   where singleton;

  select pg_catalog.count(*)::integer, pg_catalog.max(source_version_id)
    into v_scan_count, v_scan_last
    from (
      select b.source_version_id from public.connector_document_bindings b
       where v_cursor is null or b.source_version_id > v_cursor
       order by b.source_version_id limit p_limit
    ) scan_page;
  if v_cursor is not null and v_scan_count < p_limit then
    select pg_catalog.max(source_version_id) into v_wrap_last
      from (
        select b.source_version_id from public.connector_document_bindings b
         where b.source_version_id <= v_cursor
         order by b.source_version_id
         limit (p_limit - v_scan_count)
      ) wrap_page;
  end if;

  with scan_page as (
    select b.source_version_id
      from public.connector_document_bindings b
     where v_cursor is null or b.source_version_id > v_cursor
     order by b.source_version_id
     limit p_limit
  ), wrap_page as (
    select b.source_version_id
      from public.connector_document_bindings b
     where v_cursor is not null and b.source_version_id <= v_cursor
       and (select count(*) from scan_page) < p_limit
     order by b.source_version_id
     limit greatest(0, p_limit - (select count(*)::integer from scan_page))
  ), page as (
    select source_version_id, 1 as segment from scan_page
    union all
    select source_version_id, 2 as segment from wrap_page
  ), due as (
    select b.workspace_key, b.oauth_connection_id, b.source_version_id, p.segment
      from page p
      join public.connector_document_bindings b on b.source_version_id = p.source_version_id
      join public.foundation_oauth_connections c
        on c.oauth_connection_id = b.oauth_connection_id and c.workspace_key = b.workspace_key
       and c.provider = 'google_drive' and c.status = 'active'
      left join lateral (
        select newest.captured_at, pg_catalog.bool_and(a.capture_complete) as capture_complete
          from (
            select pg_catalog.max(a2.captured_at) as captured_at
              from public.source_acl_snapshots a2
             where a2.workspace_key = b.workspace_key and a2.source_version_id = b.source_version_id
               and a2.provider_id = 'google_drive'
          ) newest
          left join public.source_acl_snapshots a
            on a.workspace_key = b.workspace_key and a.source_version_id = b.source_version_id
           and a.provider_id = 'google_drive' and a.captured_at = newest.captured_at
         group by newest.captured_at
      ) latest on true
     where b.provider = 'google_drive'
       and public.connector_source_newest_versions(b.workspace_key, b.source_id) = array[b.source_version_id]
       and public.connector_source_import_allowed(b.workspace_key, b.source_id)
       and (latest.captured_at is null or latest.capture_complete is distinct from true
         or latest.captured_at > pg_catalog.clock_timestamp()
         or latest.captured_at <= pg_catalog.clock_timestamp() -
           (p_max_age_seconds * 2 / 3) * interval '1 second')
       and not exists (
         select 1 from public.foundation_google_drive_acl_refresh_queue q
          where q.workspace_key = b.workspace_key and q.oauth_connection_id = b.oauth_connection_id
            and q.source_version_id = b.source_version_id and q.state in ('queued','leased')
       )
     order by p.segment, b.source_version_id
  ), inserted as (
    insert into public.foundation_google_drive_acl_refresh_queue
      (workspace_key, oauth_connection_id, source_version_id)
    select d.workspace_key, d.oauth_connection_id, d.source_version_id from due d
    on conflict (workspace_key, oauth_connection_id, source_version_id) do update
      set state = 'queued', attempt_count = 0, next_attempt_at = pg_catalog.clock_timestamp(),
          lease_token = null, lease_expires_at = null, last_error_code = null,
          updated_at = pg_catalog.clock_timestamp()
      where foundation_google_drive_acl_refresh_queue.state in ('done','cancelled')
    returning 1
  ) select pg_catalog.count(*)::integer into v_count from inserted;
  update public.foundation_google_drive_acl_refresh_scan_cursor
     set last_source_version_id = coalesce(v_wrap_last, v_scan_last),
         updated_at = pg_catalog.clock_timestamp()
   where singleton;
  return v_count;
end;
$$;

create function public.claim_google_drive_acl_refresh_batch(p_limit integer)
returns table (
  refresh_id uuid, lease_token uuid, workspace_key text, oauth_connection_id uuid,
  source_version_id text, native_id text, attempt_count integer
) language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 5 then raise exception 'ACL_REFRESH_BATCH_LIMIT_INVALID'; end if;
  return query
  with picked as (
    select q.refresh_id
      from public.foundation_google_drive_acl_refresh_queue q
      join public.connector_document_bindings b on b.source_version_id = q.source_version_id
        and b.workspace_key = q.workspace_key and b.oauth_connection_id = q.oauth_connection_id
      join public.foundation_oauth_connections c on c.oauth_connection_id = b.oauth_connection_id
        and c.workspace_key = b.workspace_key and c.provider = 'google_drive' and c.status = 'active'
     where ((q.state = 'queued' and q.next_attempt_at <= pg_catalog.clock_timestamp())
        or (q.state = 'leased' and q.lease_expires_at <= pg_catalog.clock_timestamp()))
       and b.provider = 'google_drive'
       and public.connector_source_newest_versions(b.workspace_key, b.source_id) = array[b.source_version_id]
       and public.connector_source_import_allowed(b.workspace_key, b.source_id)
       and not exists (
         select 1 from public.foundation_google_drive_acl_refresh_connection_cooldowns cd
          where cd.workspace_key = q.workspace_key and cd.oauth_connection_id = q.oauth_connection_id
            and cd.cooldown_until > pg_catalog.clock_timestamp()
       )
     order by case when q.state = 'queued' then 0 else 1 end, q.next_attempt_at, q.updated_at
     for update of q skip locked limit p_limit
  ), claimed as (
    update public.foundation_google_drive_acl_refresh_queue q
       set state = 'leased', attempt_count = q.attempt_count + 1,
           lease_token = gen_random_uuid(), lease_expires_at = pg_catalog.clock_timestamp() + interval '90 seconds',
           updated_at = pg_catalog.clock_timestamp()
      from picked p where q.refresh_id = p.refresh_id
    returning q.refresh_id, q.lease_token, q.workspace_key, q.oauth_connection_id,
      q.source_version_id, q.attempt_count
  )
  select c.refresh_id, c.lease_token, c.workspace_key, c.oauth_connection_id,
         c.source_version_id, b.native_id, c.attempt_count
    from claimed c join public.connector_document_bindings b on b.source_version_id = c.source_version_id;
end;
$$;

create function public.finish_google_drive_acl_refresh(
  p_refresh_id uuid, p_lease_token uuid, p_outcome text,
  p_retry_delay_seconds integer default null, p_error_code text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if p_refresh_id is null or p_lease_token is null or p_outcome is null or p_outcome not in ('done','retry','cancelled')
     or (p_outcome = 'retry' and (p_retry_delay_seconds is null or p_retry_delay_seconds < 1 or p_retry_delay_seconds > 900))
     or (p_error_code is not null and (pg_catalog.length(p_error_code) > 96 or p_error_code !~ '^[A-Z0-9_]+$')) then
    raise exception 'ACL_REFRESH_FINISH_INPUT_INVALID';
  end if;
  update public.foundation_google_drive_acl_refresh_queue q
     set state = case p_outcome when 'done' then 'done' when 'cancelled' then 'cancelled' else 'queued' end,
         next_attempt_at = case when p_outcome = 'retry'
           then pg_catalog.clock_timestamp() + p_retry_delay_seconds * interval '1 second'
           else q.next_attempt_at end,
         lease_token = null, lease_expires_at = null, last_error_code = p_error_code,
         updated_at = pg_catalog.clock_timestamp()
   where q.refresh_id = p_refresh_id and q.state = 'leased' and q.lease_token = p_lease_token;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Adapter read: one current, active Google binding only. Workspace consent is rechecked in Next.js
-- with canAdmitCustomerSource before any credential or provider call.
create function public.read_google_drive_acl_refresh_source(
  p_workspace_key text, p_oauth_connection_id uuid, p_source_version_id text
) returns table(native_id text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_oauth_connection_id is null or p_source_version_id is null
     or p_source_version_id !~ '^sv-[a-f0-9]{64}$' then
    raise exception 'ACL_REFRESH_SOURCE_SCOPE_INVALID';
  end if;
  return query
    select b.native_id from public.connector_document_bindings b
    join public.foundation_oauth_connections c on c.oauth_connection_id = b.oauth_connection_id
      and c.workspace_key = b.workspace_key and c.provider = 'google_drive' and c.status = 'active'
   where b.workspace_key = p_workspace_key and b.oauth_connection_id = p_oauth_connection_id
     and b.source_version_id = p_source_version_id and b.provider = 'google_drive'
     and public.connector_source_newest_versions(b.workspace_key, b.source_id) = array[b.source_version_id]
     and public.connector_source_import_allowed(b.workspace_key, b.source_id)
   limit 1;
end;
$$;

create function public.google_drive_acl_refresh_lease_owned(p_refresh_id uuid, p_lease_token uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.foundation_google_drive_acl_refresh_queue q
     where q.refresh_id = p_refresh_id and q.lease_token = p_lease_token
       and q.state = 'leased' and q.lease_expires_at > pg_catalog.clock_timestamp()
  );
$$;

create function public.google_drive_acl_refresh_connection_active(p_workspace_key text, p_oauth_connection_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.foundation_oauth_connections c
     where c.workspace_key = p_workspace_key and c.oauth_connection_id = p_oauth_connection_id
       and c.provider = 'google_drive' and c.status = 'active'
  );
$$;

revoke all on function public.enqueue_stale_google_drive_acl_refreshes(integer,integer) from public, anon, authenticated;
revoke all on function public.claim_google_drive_acl_refresh_batch(integer) from public, anon, authenticated;
revoke all on function public.finish_google_drive_acl_refresh(uuid,uuid,text,integer,text) from public, anon, authenticated;
revoke all on function public.read_google_drive_acl_refresh_source(text,uuid,text) from public, anon, authenticated;
revoke all on function public.google_drive_acl_refresh_lease_owned(uuid,uuid) from public, anon, authenticated;
revoke all on function public.google_drive_acl_refresh_connection_active(text,uuid) from public, anon, authenticated;
revoke all on function public.cooldown_google_drive_acl_refresh_connection(text,uuid,integer) from public, anon, authenticated;
grant execute on function public.enqueue_stale_google_drive_acl_refreshes(integer,integer) to service_role;
grant execute on function public.claim_google_drive_acl_refresh_batch(integer) to service_role;
grant execute on function public.finish_google_drive_acl_refresh(uuid,uuid,text,integer,text) to service_role;
grant execute on function public.read_google_drive_acl_refresh_source(text,uuid,text) to service_role;
grant execute on function public.google_drive_acl_refresh_lease_owned(uuid,uuid) to service_role;
grant execute on function public.google_drive_acl_refresh_connection_active(text,uuid) to service_role;
grant execute on function public.cooldown_google_drive_acl_refresh_connection(text,uuid,integer) to service_role;

commit;
