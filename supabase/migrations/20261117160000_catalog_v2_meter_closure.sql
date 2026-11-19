-- WO-CAT-8 (workorders/catalog-v2.md §15): the three meters agree on whose plan governs a workspace,
-- a query unit is never counted after its hold expired, and the storage meter's input guards run
-- before its allowance.
--
-- Ordering: 20261117160000, assigned by the lead, after 20261117150200_workspace_seat_allowance.
-- Every function below is redefined from its latest definition, with its grants and callers kept:
--   foundation_workspace_seat_limit(text, jsonb)          20261117150200
--   reserve_foundation_intake_admission(... , jsonb)       20261117150100 (the 7-argument wrapper)
--   admit_foundation_knowledge_query                       20261117150000 (signature changes, see 3)
--   settle_foundation_knowledge_query(uuid, boolean)       20261117150000
-- Rollback: supabase/drafts/rollback-20261117160000-catalog-v2-meter-closure.sql.
--
-- 1. One rule (CAT-D13, CAT-D10). foundation_workspace_capped_plan(workspace) is the plan that caps
--    a workspace: the plan_code of its billing account (one per workspace, 0005), or null -- no
--    account, a legacy plan (plan_code null), or an active operator grant (0045) held by THE USER OF
--    THAT ACCOUNT. Before this file the seat meter exempted a workspace with any active owner who held
--    a grant, the storage meter exempted any uploader who held one, and the query meter took the
--    caller's own account in TypeScript, so one workspace could carry three answers. An operator who
--    is an owner, member or uploader of a customer workspace now leaves the customer's plan in force.
-- 2. The query meter resolves its limit the way the other two do: by workspace, in SQL, under the
--    window row's lock, from the catalog map the server passes ({"personal": 1000, ...}). The
--    integer signature, whose limit the caller chose, is dropped.
-- 3. settle_foundation_knowledge_query refuses to count a hold that expired: once a hold stops
--    reserving, another request may hold its unit, so counting the slow one would let "limit N"
--    count N+1. The server withholds that answer (503), as it does any unit it cannot record.
-- 4. The storage wrapper runs the inner function first -- its input guards (size, contract), its
--    idempotency check and its rate and trial bounds -- and checks the allowance after, over the
--    row the inner function just wrote. A refusal raises, so the whole admission rolls back. An
--    over-size file into a full workspace is therefore refused as too large, as it is anywhere.
begin;

create function public.foundation_workspace_capped_plan(p_workspace_key text)
returns text
language sql
stable
set search_path = ''
as $$
  select a.plan_code from public.foundation_billing_accounts a
   where a.workspace_key = p_workspace_key
     and a.plan_code is not null
     and not exists (select 1 from public.foundation_account_access_grants g
                      where g.user_id = a.user_id and g.active)
$$;
revoke all on function public.foundation_workspace_capped_plan(text) from public, anon, authenticated, service_role;
comment on function public.foundation_workspace_capped_plan(text) is
  'The plan that caps a workspace''s query, storage and seat meters, or null (WO-CAT-8). Reached only through those meters.';

-- Seats (20261117150200): the same lines, with the plan and the exemption read through the rule.
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
  v_plan := public.foundation_workspace_capped_plan(p_workspace_key);
  if v_plan is null then return null; end if;
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

-- Storage (20261117150100): the rule, then the inner function, then the allowance.
create or replace function public.reserve_foundation_intake_admission(
  p_workspace_key text, p_document_id uuid, p_user_id uuid, p_object_key text,
  p_requested_bytes integer, p_declared_mime_type text, p_storage_limits jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan_code text;
  v_limit bigint;
  v_retained bigint;
  v_replay boolean;
  v_result jsonb;
begin
  -- The same lock the inner function takes first; re-entrant within this transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = p_workspace_key and t.document_id = p_document_id) then
    raise exception 'foundation_intake_source_deleted';
  end if;
  v_plan_code := public.foundation_workspace_capped_plan(p_workspace_key);
  if v_plan_code is not null then
    v_limit := (p_storage_limits ->> v_plan_code)::bigint;
    if v_limit is null or v_limit < 0 then
      raise exception 'foundation_storage_limit_missing';
    end if;
  end if;
  -- A replay of a live or confirmed admission is answered by the inner function and not checked again.
  v_replay := exists (select 1 from public.foundation_intake_admissions a
                       where a.workspace_key = p_workspace_key and a.document_id = p_document_id
                         and (a.confirmed_at is not null or a.expires_at > pg_catalog.clock_timestamp()));
  v_result := public.reserve_foundation_intake_admission_unchecked(p_workspace_key, p_document_id, p_user_id,
    p_object_key, p_requested_bytes, p_declared_mime_type);
  if v_limit is not null and not v_replay then
    -- ponytail: sums the workspace's admissions on every capped admission; keep a running total if this shows up in latency.
    -- The row just written (or re-armed) is live, so it is in the sum.
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
    if v_retained > v_limit then
      raise exception 'foundation_storage_allowance_exhausted';
    end if;
  end if;
  return v_result;
end;
$$;

-- Queries (20261117150000): the limit by workspace, read under the window row's lock.
drop function public.admit_foundation_knowledge_query(text, integer);

create function public.admit_foundation_knowledge_query(p_workspace_key text, p_limits jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window timestamptz := pg_catalog.date_trunc('month', v_now, 'UTC');
  v_used integer;
  v_held integer;
  v_hold uuid;
  v_plan text;
  v_entry numeric;
  v_limit integer;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' then
    raise exception 'knowledge_query_meter_contract_invalid';
  end if;

  insert into public.foundation_knowledge_query_windows (workspace_key, window_started_at)
    values (p_workspace_key, v_window)
    on conflict do nothing;
  -- The lock every admission and settlement of this window queues on.
  select used_units into v_used from public.foundation_knowledge_query_windows
    where workspace_key = p_workspace_key and window_started_at = v_window
    for update;

  -- Whose plan governs: the workspace's, read under that lock. Null counts without a cap.
  v_plan := public.foundation_workspace_capped_plan(p_workspace_key);
  if v_plan is not null then
    -- Nested, not one AND: SQL does not promise to skip the cast of a non-number.
    if pg_catalog.jsonb_typeof(p_limits) = 'object' and pg_catalog.jsonb_typeof(p_limits -> v_plan) = 'number' then
      v_entry := (p_limits ->> v_plan)::numeric;
      if v_entry = pg_catalog.trunc(v_entry) and v_entry between 1 and 2147483647 then
        v_limit := v_entry::integer;
      end if;
    end if;
    if v_limit is null then
      raise exception 'knowledge_query_meter_contract_invalid';
    end if;
  end if;

  -- Holds no settlement will ever claim (expired a day ago) are dropped; they never counted.
  delete from public.foundation_knowledge_query_holds
    where workspace_key = p_workspace_key and expires_at < v_now - interval '1 day';
  select pg_catalog.count(*)::integer into v_held from public.foundation_knowledge_query_holds
    where workspace_key = p_workspace_key and window_started_at = v_window and expires_at > v_now;

  if v_limit is not null and v_used + v_held >= v_limit then
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
  v_expires timestamptz;
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
  delete from public.foundation_knowledge_query_holds where hold_id = p_hold_id
    returning expires_at into v_expires;
  if not found then return false; end if;
  -- An expired hold stopped reserving its unit, which another request may now hold: not counted.
  if p_answered and v_expires <= pg_catalog.clock_timestamp() then return false; end if;
  if p_answered then
    update public.foundation_knowledge_query_windows set used_units = used_units + 1
      where workspace_key = v_workspace and window_started_at = v_window;
  end if;
  return true;
end;
$$;

revoke all on function public.admit_foundation_knowledge_query(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admit_foundation_knowledge_query(text, jsonb) to service_role;

commit;
