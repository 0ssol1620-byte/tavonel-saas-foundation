-- W1-A2.0: trial AI access entitlement -- usage counters on the rows the trial already has.
--
-- A free evaluation (`foundation_self_service_trials`, 0045) may hold one read-only API key and
-- authorize remote MCP, but only inside bounds the database owns:
--   * an AI-access window counted from the trial's own started_at (default 14 days; the trial's
--     expires_at still ends everything first);
--   * standard pages consumed by the trial, read from the same lifetime ledger the 0046 guard
--     reads (4 units = 1 standard page), default 200;
--   * World-bearing compile jobs in the workspace (not failed, not cancelled), default 1;
--   * key-authenticated queries per UTC day, default 200, counted here atomically.
--
-- The limits are columns on the one `foundation_trial_policy` row, so the founder can change the
-- package (F-2) without a deploy; the counter is two columns on the trial row, not a new table.
--
-- W1-A3 adds one table here: `foundation_operations_receipts`, internal operations receipts (the
-- end-to-end timing receipt first). It is not `enterprise_audit_events`, which customers export:
-- no role holds a table privilege on it, and the one writer is a service_role-only function that
-- keeps the first receipt per (kind, workspace, target).
--
-- Nothing reads this until TAVONEL_TRIAL_AI_ACCESS_ENABLED=true, except the flag-off shadow,
-- which calls the function with p_consume_query=false and therefore writes nothing.
--
-- Additive: existing rows take the defaults; code before this migration never selects the
-- columns or calls the function. Applied before the code that calls it (RELEASE_ORDER.md); a
-- deploy that arrives first answers 503 TRIAL_AI_ACCESS_CHECK_FAILED with the flag on, and the
-- flag-off shadow simply records nothing.
begin;

alter table public.foundation_trial_policy
  add column ai_access_days integer not null default 14 check (ai_access_days between 1 and 30),
  add column ai_page_limit integer not null default 200 check (ai_page_limit between 1 and 2000),
  add column ai_world_limit integer not null default 1 check (ai_world_limit between 1 and 10),
  add column ai_daily_query_limit integer not null default 200 check (ai_daily_query_limit between 1 and 10000);

alter table public.foundation_self_service_trials
  add column ai_query_day date,
  add column ai_query_count integer not null default 0 check (ai_query_count >= 0),
  add constraint foundation_self_service_trials_ai_query_day_set
    check (ai_query_count = 0 or ai_query_day is not null);

-- Both tables had RLS on and no policy (0045). Server-only stays the rule; the policy makes the
-- refusal explicit for the two client roles instead of an accident of missing grants.
create policy foundation_trial_policy_no_client_access
  on public.foundation_trial_policy as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy foundation_self_service_trials_no_client_access
  on public.foundation_self_service_trials as restrictive for all to anon, authenticated
  using (false) with check (false);

create or replace function public.foundation_trial_ai_access(
  p_user_id uuid,
  p_workspace_key text,
  p_consume_query boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy public.foundation_trial_policy%rowtype;
  v_trial public.foundation_self_service_trials%rowtype;
  v_now timestamptz := clock_timestamp();
  v_day date := (clock_timestamp() at time zone 'utc')::date;
  v_units bigint := 0;
  v_pages integer;
  v_worlds integer;
  v_queries integer;
  v_ends_at timestamptz;
  v_reason text;
begin
  if p_user_id is null or p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_consume_query is null then
    raise exception 'foundation_trial_ai_access_invalid';
  end if;

  select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
  if not found then
    raise exception 'foundation_trial_policy_missing';
  end if;

  -- The row lock serializes the counter: two concurrent queries cannot both take the last unit.
  -- A peek (the flag-off shadow, a late re-check) takes no lock, so it never queues behind intake
  -- or settlement on the same row.
  if p_consume_query then
    select * into v_trial from public.foundation_self_service_trials
     where user_id = p_user_id and workspace_key = p_workspace_key
     for update;
  else
    select * into v_trial from public.foundation_self_service_trials
     where user_id = p_user_id and workspace_key = p_workspace_key;
  end if;
  if not found or v_trial.status <> 'trialing' or v_trial.expires_at <= v_now then
    return jsonb_build_object('status', 'not_trial');
  end if;

  -- Same formula as guard_foundation_trial_compute_lifetime (0046): what the trial has consumed.
  select coalesce(sum(case
      when state = 'released' then 0
      when state in ('settled', 'operator_review') then coalesce(settled_credits, reserved_credits)
      else reserved_credits
    end), 0)
    into v_units
    from public.foundation_compute_reservations
   where user_id = p_user_id and billing_source = 'trial';
  v_pages := ceil(v_units / 4.0)::integer;

  select count(*)::integer into v_worlds
    from public.foundation_compile_jobs
   where workspace_key = p_workspace_key and state not in ('failed', 'cancelled');

  v_queries := case when v_trial.ai_query_day = v_day then v_trial.ai_query_count else 0 end;
  v_ends_at := least(v_trial.expires_at, v_trial.started_at + make_interval(days => v_policy.ai_access_days));

  v_reason := case
    when v_now >= v_ends_at then 'TRIAL_AI_WINDOW_ENDED'
    when v_pages > v_policy.ai_page_limit then 'TRIAL_AI_PAGE_LIMIT'
    when v_worlds > v_policy.ai_world_limit then 'TRIAL_AI_WORLD_LIMIT'
    when p_consume_query and v_queries >= v_policy.ai_daily_query_limit then 'TRIAL_AI_DAILY_QUERY_LIMIT'
  end;

  if v_reason is null and p_consume_query then
    v_queries := v_queries + 1;
    update public.foundation_self_service_trials
       set ai_query_day = v_day, ai_query_count = v_queries, updated_at = now()
     where user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'status', case when v_reason is null then 'allowed' else 'limit_reached' end,
    'reason', v_reason,
    'aiAccessEndsAt', v_ends_at,
    'usage', jsonb_build_object('pages', v_pages, 'worlds', v_worlds, 'queriesToday', v_queries),
    'limits', jsonb_build_object('days', v_policy.ai_access_days, 'pages', v_policy.ai_page_limit,
      'worlds', v_policy.ai_world_limit, 'queriesPerDay', v_policy.ai_daily_query_limit)
  );
end;
$$;

revoke all on function public.foundation_trial_ai_access(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.foundation_trial_ai_access(uuid, text, boolean) to service_role;

create table public.foundation_operations_receipts (
  receipt_kind text not null check (receipt_kind in ('e2e_timing')),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,32}$'),
  target_id text not null check (length(target_id) between 1 and 128),
  details jsonb not null check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8192),
  recorded_at timestamptz not null default now(),
  primary key (receipt_kind, workspace_key, target_id)
);
alter table public.foundation_operations_receipts enable row level security;
revoke all on public.foundation_operations_receipts from public, anon, authenticated, service_role;
create policy foundation_operations_receipts_no_client_access
  on public.foundation_operations_receipts as restrictive for all to anon, authenticated
  using (false) with check (false);

-- First receipt wins: true when this call wrote it, false when one was already there.
create or replace function public.record_foundation_operations_receipt(
  p_kind text,
  p_workspace_key text,
  p_target_id text,
  p_details jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_written integer;
begin
  insert into public.foundation_operations_receipts (receipt_kind, workspace_key, target_id, details)
  values (p_kind, p_workspace_key, p_target_id, p_details)
  on conflict (receipt_kind, workspace_key, target_id) do nothing;
  get diagnostics v_written = row_count;
  return v_written = 1;
end;
$$;

revoke all on function public.record_foundation_operations_receipt(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_foundation_operations_receipt(text, text, text, jsonb) to service_role;

commit;
