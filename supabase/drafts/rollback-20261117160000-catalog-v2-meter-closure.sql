-- Rollback for migration 20261117160000_catalog_v2_meter_closure (WO-CAT-8).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117160000 was
-- applied. It undoes exactly that change and refuses to run over anything else.
--
-- Order: roll the application back FIRST. The current nextjs/lib/kqu-meter.ts calls
-- admit_foundation_knowledge_query(text, jsonb); once it is dropped, PostgREST answers that call 404 and
-- every Ask and search of a durable deployment is refused 503 READ_FAILED until the previous app is live.
--
--   1. Asserts the four functions are the ones 20261117160000 installed (md5 of pg_get_functiondef):
--        foundation_workspace_capped_plan(text)          b46f544799008ec52cbe3c34587e671d
--        foundation_workspace_seat_limit(text,jsonb)     bb45b809aaf6feaead57de00994560d7
--        reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb) 15aeef1c616a9bd36680bc7bc0e55b6f
--        admit_foundation_knowledge_query(text,jsonb)    29216601286ba470e074b645b5e6fd7d
--        settle_foundation_knowledge_query(uuid,boolean) 6df23acd9721a958da3d1447b75a0d37
--      Anything else stops here, nothing changed.
--   2. Restores the seat limit (20261117150200), the seven-argument storage wrapper (20261117150100) and
--      settle (20261117150000) with `create or replace`, which keeps owner and grants; drops the map
--      signature of admit and recreates the integer one of 20261117150000 with its grants; drops the rule.
--   3. Asserts every restored body is byte-for-byte the earlier one:
--        foundation_workspace_seat_limit(text,jsonb)     18d9709d0754b84e8492c2e5a9611a0a
--        reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb) aecf70d008885818ee00929cb5084337
--        admit_foundation_knowledge_query(text,integer)  f9895bb1b1d24bbfbb4060fd7cef49b1
--        settle_foundation_knowledge_query(uuid,boolean) 8aaf50d5cb30c942db74c76940fad127
--
-- No table changes and no row is written by the migration, so nothing else is undone. Note what the
-- rollback brings back: three exemption rules (any granted owner for seats, any granted uploader for
-- storage, the caller's account for queries) and a settle that counts an expired hold. Recording it:
-- this file does not edit supabase_migrations.schema_migrations. After it commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117160000';
-- in the same session, and writes the version, the time, the md5s above and who ran it into the
-- campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
declare
  v_expected jsonb := '{"foundation_workspace_capped_plan(text)": "b46f544799008ec52cbe3c34587e671d",
    "foundation_workspace_seat_limit(text,jsonb)": "bb45b809aaf6feaead57de00994560d7",
    "reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)": "15aeef1c616a9bd36680bc7bc0e55b6f",
    "admit_foundation_knowledge_query(text,jsonb)": "29216601286ba470e074b645b5e6fd7d",
    "settle_foundation_knowledge_query(uuid,boolean)": "6df23acd9721a958da3d1447b75a0d37"}';
  v_key text;
begin
  for v_key in select jsonb_object_keys(v_expected) loop
    if to_regprocedure('public.' || v_key) is null
      or md5(pg_get_functiondef(to_regprocedure('public.' || v_key))) <> v_expected ->> v_key then
      raise exception 'rollback-20261117160000 refused: public.% is not the function 20261117160000 installed', v_key;
    end if;
  end loop;
  if to_regprocedure('public.admit_foundation_knowledge_query(text, integer)') is not null then
    raise exception 'rollback-20261117160000 refused: the integer signature of admit already exists';
  end if;
end
$guard$;

create or replace function public.foundation_workspace_seat_limit(p_workspace_key text, p_seat_limits jsonb)
returns integer
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_limit jsonb;
begin
  select plan_code into v_plan from public.foundation_billing_accounts
   where workspace_key = p_workspace_key;
  if v_plan is null then return null; end if;
  if exists (
    select 1 from public.foundation_workspace_members m
      join public.foundation_account_access_grants g on g.user_id = m.user_id and g.active
     where m.workspace_key = p_workspace_key and m.role = 'owner' and m.state = 'active'
  ) then
    return null;
  end if;
  -- Nested, not one OR: SQL does not promise to skip the cast of a non-number.
  if jsonb_typeof(p_seat_limits) = 'object' and jsonb_typeof(p_seat_limits -> v_plan) = 'number' then
    v_limit := p_seat_limits -> v_plan;
    if v_limit::numeric = trunc(v_limit::numeric) and v_limit::numeric between 1 and 100000 then
      return v_limit::integer;
    end if;
  end if;
  raise exception 'workspace_seat_limit_unavailable';
end;
$$;

create or replace function public.reserve_foundation_intake_admission(
  p_workspace_key text, p_document_id uuid, p_user_id uuid, p_object_key text,
  p_requested_bytes integer, p_declared_mime_type text, p_storage_limits jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan_code text;
  v_limit bigint;
  v_retained bigint;
begin
  -- The same lock the inner function takes first; re-entrant within this transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = p_workspace_key and t.document_id = p_document_id) then
    raise exception 'foundation_intake_source_deleted';
  end if;
  select a.plan_code into v_plan_code
    from public.foundation_billing_accounts a where a.workspace_key = p_workspace_key;
  if v_plan_code is not null
    and not exists (select 1 from public.foundation_account_access_grants g
                     where g.user_id = p_user_id and g.active = true and g.trial_exempt = true)
    and not exists (select 1 from public.foundation_intake_admissions a
                     where a.workspace_key = p_workspace_key and a.document_id = p_document_id
                       and (a.confirmed_at is not null or a.expires_at > pg_catalog.clock_timestamp())) then
    v_limit := (p_storage_limits ->> v_plan_code)::bigint;
    if v_limit is null or v_limit < 0 then
      raise exception 'foundation_storage_limit_missing';
    end if;
    -- ponytail: sums the workspace's admissions on every capped admission; keep a running total if this shows up in latency.
    select coalesce(pg_catalog.sum(a.requested_bytes), 0) into v_retained
      from public.foundation_intake_admissions a
     where a.workspace_key = p_workspace_key
       and (a.confirmed_at is not null or a.expires_at > pg_catalog.clock_timestamp())
       and not exists (select 1 from public.source_deletion_tombstones t
                        where t.workspace_key = a.workspace_key and t.document_id = a.document_id)
       and not exists (select 1 from public.connector_document_bindings b
                         join public.source_deletion_tombstones t
                           on t.workspace_key = b.workspace_key and t.source_id = b.source_id
                        where b.workspace_key = a.workspace_key and b.document_id = a.document_id);
    if v_retained + p_requested_bytes > v_limit then
      raise exception 'foundation_storage_allowance_exhausted';
    end if;
  end if;
  return public.reserve_foundation_intake_admission_unchecked(p_workspace_key, p_document_id, p_user_id,
    p_object_key, p_requested_bytes, p_declared_mime_type);
end;
$$;

drop function public.admit_foundation_knowledge_query(text, jsonb);

create function public.admit_foundation_knowledge_query(p_workspace_key text, p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window timestamptz := pg_catalog.date_trunc('month', v_now, 'UTC');
  v_used integer;
  v_held integer;
  v_hold uuid;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or (p_limit is not null and p_limit < 1) then
    raise exception 'knowledge_query_meter_contract_invalid';
  end if;

  insert into public.foundation_knowledge_query_windows (workspace_key, window_started_at)
    values (p_workspace_key, v_window)
    on conflict do nothing;
  -- The lock every admission and settlement of this window queues on.
  select used_units into v_used from public.foundation_knowledge_query_windows
    where workspace_key = p_workspace_key and window_started_at = v_window
    for update;

  -- Holds no settlement will ever claim (expired a day ago) are dropped; they never counted.
  delete from public.foundation_knowledge_query_holds
    where workspace_key = p_workspace_key and expires_at < v_now - interval '1 day';
  select pg_catalog.count(*)::integer into v_held from public.foundation_knowledge_query_holds
    where workspace_key = p_workspace_key and window_started_at = v_window and expires_at > v_now;

  if p_limit is not null and v_used + v_held >= p_limit then
    return pg_catalog.jsonb_build_object('status', 'exhausted');
  end if;

  insert into public.foundation_knowledge_query_holds (workspace_key, window_started_at, expires_at)
    values (p_workspace_key, v_window, v_now + interval '5 minutes')
    returning hold_id into v_hold;
  return pg_catalog.jsonb_build_object('status', 'admitted', 'hold_id', v_hold);
end;
$$;

create or replace function public.settle_foundation_knowledge_query(p_hold_id uuid, p_answered boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_workspace text;
  v_window timestamptz;
begin
  if p_hold_id is null or p_answered is null then
    raise exception 'knowledge_query_meter_contract_invalid';
  end if;
  -- The window row first, the lock order admission takes, so a settle never waits on a hold row
  -- while an admission of the same window holds the window and waits on it.
  select h.workspace_key, h.window_started_at into v_workspace, v_window
    from public.foundation_knowledge_query_holds h where h.hold_id = p_hold_id;
  if not found then return false; end if;
  perform 1 from public.foundation_knowledge_query_windows
    where workspace_key = v_workspace and window_started_at = v_window
    for update;
  delete from public.foundation_knowledge_query_holds where hold_id = p_hold_id;
  if not found then return false; end if;
  if p_answered then
    update public.foundation_knowledge_query_windows set used_units = used_units + 1
      where workspace_key = v_workspace and window_started_at = v_window;
  end if;
  return true;
end;
$$;

revoke all on function public.admit_foundation_knowledge_query(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.admit_foundation_knowledge_query(text, integer) to service_role;

drop function public.foundation_workspace_capped_plan(text);

do $verify$
declare
  v_expected jsonb := '{"foundation_workspace_seat_limit(text,jsonb)": "18d9709d0754b84e8492c2e5a9611a0a",
    "reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)": "aecf70d008885818ee00929cb5084337",
    "admit_foundation_knowledge_query(text,integer)": "f9895bb1b1d24bbfbb4060fd7cef49b1",
    "settle_foundation_knowledge_query(uuid,boolean)": "8aaf50d5cb30c942db74c76940fad127"}';
  v_key text;
begin
  for v_key in select jsonb_object_keys(v_expected) loop
    if md5(pg_get_functiondef(to_regprocedure('public.' || v_key))) <> v_expected ->> v_key then
      raise exception 'rollback-20261117160000: restored public.% differs from its earlier definition', v_key;
    end if;
  end loop;
end
$verify$;

commit;
