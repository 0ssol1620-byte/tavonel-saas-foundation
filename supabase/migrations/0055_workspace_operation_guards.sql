-- Expand-only. Apply and rehearse before deploying the durable application guard.
-- This is resource protection, not a credit charge or a customer-data approval.
begin;

create table if not exists public.foundation_operation_leases (
  workspace_key text not null check (length(workspace_key) between 1 and 256),
  operation_scope text not null check (operation_scope in ('ask', 'export')),
  owner_token uuid not null,
  request_key text check (request_key ~ '^[a-f0-9]{64}$'),
  body_digest text check (body_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'running' check (state in ('running', 'completed')),
  response_ciphertext text check (octet_length(response_ciphertext) <= 1400000),
  expires_at timestamptz not null,
  primary key (workspace_key, operation_scope, owner_token),
  unique (workspace_key, operation_scope, request_key),
  check ((request_key is null) = (body_digest is null)),
  check ((state = 'completed') = (response_ciphertext is not null)),
  check (state <> 'completed' or request_key is not null)
);
alter table public.foundation_operation_leases enable row level security;
revoke all on public.foundation_operation_leases from public, anon, authenticated;
create index if not exists foundation_operation_lease_expiry
  on public.foundation_operation_leases (expires_at);

create or replace function public.acquire_foundation_operation(
  p_workspace_key text, p_scope text, p_owner_token uuid,
  p_request_key text default null, p_body_digest text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz;
  v_limit integer;
  v_cache_rows integer;
  v_reserved_bytes bigint;
  v_row public.foundation_operation_leases%rowtype;
begin
  if p_workspace_key is null or length(p_workspace_key) not between 1 and 256
     or p_scope is null or p_scope not in ('ask', 'export') or p_owner_token is null
     or (p_request_key is null) <> (p_body_digest is null)
     or (p_request_key is not null and p_request_key !~ '^[a-f0-9]{64}$')
     or (p_body_digest is not null and p_body_digest !~ '^[a-f0-9]{64}$') then
    raise exception 'operation_guard_invalid';
  end if;
  -- A client cannot raise the limit or choose a longer lease.
  v_limit := case p_scope when 'ask' then 4 else 2 end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'foundation-operation:' || p_workspace_key || ':' || p_scope, 0));
  v_now := pg_catalog.clock_timestamp();
  delete from public.foundation_operation_leases
    where workspace_key = p_workspace_key and operation_scope = p_scope and expires_at <= v_now;
  if p_request_key is not null then
    select * into v_row from public.foundation_operation_leases
      where workspace_key = p_workspace_key and operation_scope = p_scope and request_key = p_request_key;
    if found then
      if v_row.body_digest <> p_body_digest then
        return jsonb_build_object('code', 'IDEMPOTENCY_CONFLICT');
      elsif v_row.state = 'completed' then
        return jsonb_build_object('code', 'REPLAY', 'ciphertext', v_row.response_ciphertext);
      else
        return jsonb_build_object('code', 'IDEMPOTENCY_IN_PROGRESS');
      end if;
    end if;
  end if;
  if (select count(*) from public.foundation_operation_leases
      where workspace_key = p_workspace_key and operation_scope = p_scope and state = 'running') >= v_limit then
    return jsonb_build_object('code', 'WORKSPACE_CONCURRENCY_LIMIT');
  end if;
  if p_request_key is not null then
    -- Ten minutes at the existing Ask API allowance (30/min) is 300 key records.
    -- Reserve the maximum ciphertext for each running keyed call BEFORE work,
    -- so simultaneous completions cannot overrun the 16 MiB workspace cache.
    -- Existing keys were handled above: capacity must never evict an unexpired
    -- replay or execute it twice just to make space for a new key.
    select count(*), coalesce(sum(case when state = 'running' then 1400000
      else octet_length(response_ciphertext) end), 0)
      into v_cache_rows, v_reserved_bytes
      from public.foundation_operation_leases
      where workspace_key = p_workspace_key and operation_scope = p_scope
        and request_key is not null;
    if v_cache_rows >= 300 or v_reserved_bytes + 1400000 > 16777216 then
      return jsonb_build_object('code', 'WORKSPACE_CACHE_CAPACITY_LIMIT');
    end if;
  end if;
  insert into public.foundation_operation_leases
    (workspace_key, operation_scope, owner_token, request_key, body_digest, expires_at)
    values (p_workspace_key, p_scope, p_owner_token, p_request_key, p_body_digest, v_now + interval '75 seconds');
  return jsonb_build_object('code', 'ACQUIRED', 'ownerToken', p_owner_token);
end;
$$;

create or replace function public.finish_foundation_operation(
  p_workspace_key text, p_scope text, p_owner_token uuid, p_ciphertext text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_changed integer;
begin
  if p_scope is null or p_scope not in ('ask', 'export') or p_workspace_key is null or p_owner_token is null then
    raise exception 'operation_guard_invalid';
  end if;
  if p_ciphertext is not null and (octet_length(p_ciphertext) > 1400000 or length(p_ciphertext) < 40) then
    raise exception 'operation_response_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'foundation-operation:' || p_workspace_key || ':' || p_scope, 0));
  if p_ciphertext is null then
    delete from public.foundation_operation_leases
      where workspace_key = p_workspace_key and operation_scope = p_scope
        and owner_token = p_owner_token and state = 'running';
  else
    -- Token fencing: an expired/old worker can neither overwrite nor release its successor.
    update public.foundation_operation_leases
      set state = 'completed', response_ciphertext = p_ciphertext,
          expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
      where workspace_key = p_workspace_key and operation_scope = p_scope
        and owner_token = p_owner_token and state = 'running'
        and request_key is not null and expires_at > pg_catalog.clock_timestamp();
  end if;
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;

-- Bounded retention cleanup; schedule via the existing operational database job.
-- Expired rows are never eligible even before physical deletion.
create or replace function public.prune_foundation_operations()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_changed integer;
begin
  with expired as (
    select ctid from public.foundation_operation_leases
    where expires_at <= pg_catalog.clock_timestamp()
    order by expires_at limit 1000 for update skip locked
  ) delete from public.foundation_operation_leases l using expired e where l.ctid = e.ctid;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.acquire_foundation_operation(text,text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.finish_foundation_operation(text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.prune_foundation_operations() from public, anon, authenticated;
grant execute on function public.acquire_foundation_operation(text,text,uuid,text,text) to service_role;
grant execute on function public.finish_foundation_operation(text,text,uuid,text) to service_role;
grant execute on function public.prune_foundation_operations() to service_role;

-- Two dimensions, one transaction, exact sliding ten-minute window. Keeping at
-- most five timestamps per opaque bucket bounds row size even during rejection.
create table if not exists public.foundation_contact_windows (
  bucket_key text primary key check (bucket_key ~ '^[a-f0-9]{64}$'),
  request_times timestamptz[] not null check (cardinality(request_times) between 1 and 5),
  expires_at timestamptz not null
);
alter table public.foundation_contact_windows enable row level security;
revoke all on public.foundation_contact_windows from public, anon, authenticated;
create index if not exists foundation_contact_window_expiry
  on public.foundation_contact_windows (expires_at);

create or replace function public.consume_foundation_contact_limits(
  p_ip_key text, p_domain_key text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_bucket text;
  v_now timestamptz;
  v_times timestamptz[];
  v_allowed boolean := true;
begin
  if p_ip_key is null or p_domain_key is null or p_ip_key !~ '^[a-f0-9]{64}$'
     or p_domain_key !~ '^[a-f0-9]{64}$' or p_ip_key = p_domain_key then
    raise exception 'contact_guard_invalid';
  end if;
  -- Always lock dimensions in the same order; sharing only one dimension must
  -- neither deadlock nor allow a second instance to spend the same allowance.
  for v_bucket in select value from unnest(array[p_ip_key, p_domain_key]) value order by value loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-contact:' || v_bucket, 0));
  end loop;
  v_now := pg_catalog.clock_timestamp();
  foreach v_bucket in array array[p_ip_key, p_domain_key] loop
    select request_times into v_times from public.foundation_contact_windows where bucket_key = v_bucket;
    select coalesce(array_agg(value order by value), '{}'::timestamptz[]) into v_times
      from unnest(v_times) value where value > v_now - interval '10 minutes';
    if cardinality(v_times) >= 5 then
      v_allowed := false;
    else
      v_times := array_append(v_times, v_now);
    end if;
    insert into public.foundation_contact_windows (bucket_key, request_times, expires_at)
      values (v_bucket, v_times, v_times[cardinality(v_times)] + interval '10 minutes')
      on conflict (bucket_key) do update
        set request_times = excluded.request_times, expires_at = excluded.expires_at;
  end loop;
  return v_allowed;
end;
$$;

create or replace function public.prune_foundation_contact_limits()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_changed integer;
begin
  with expired as (
    select ctid from public.foundation_contact_windows
    where expires_at <= pg_catalog.clock_timestamp()
    order by expires_at limit 1000 for update skip locked
  ) delete from public.foundation_contact_windows w using expired e where w.ctid = e.ctid;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;
revoke all on function public.consume_foundation_contact_limits(text,text) from public, anon, authenticated;
revoke all on function public.prune_foundation_contact_limits() from public, anon, authenticated;
grant execute on function public.consume_foundation_contact_limits(text,text) to service_role;
grant execute on function public.prune_foundation_contact_limits() to service_role;

commit;
