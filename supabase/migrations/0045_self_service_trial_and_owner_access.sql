-- Owner billing bypass + abuse-resistant self-service evaluation.
--
-- Design goals:
--   * an explicit owner grant is independent of Paddle state and never consumes paid credits;
--   * a new Google user may receive one bounded 7-day evaluation (3 files / 50 standard pages /
--     one World) without a card;
--   * trial abuse signals are stored only as HMAC digests -- never raw IP addresses or browser
--     identifiers;
--   * the database, not the browser, owns file/page/global-budget races;
--   * paid billing behaviour remains unchanged for everyone who is not an owner or evaluation.
begin;

create table if not exists public.foundation_account_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  grant_kind text not null check (grant_kind in ('owner')),
  access_plan text not null default 'studio_access'
    check (access_plan in ('observer_access', 'studio_access')),
  billing_exempt boolean not null default false,
  trial_exempt boolean not null default false,
  active boolean not null default true,
  note text check (note is null or char_length(note) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.foundation_trial_policy (
  policy_key text primary key check (policy_key = 'default'),
  enabled boolean not null default true,
  trial_days integer not null check (trial_days between 1 and 30),
  file_limit integer not null check (file_limit between 1 and 20),
  page_limit integer not null check (page_limit between 1 and 500),
  world_limit integer not null check (world_limit between 1 and 10),
  daily_standard_unit_limit integer not null check (daily_standard_unit_limit between 100 and 1000000),
  device_reuse_window_days integer not null check (device_reuse_window_days between 1 and 180),
  ip_fresh_account_velocity_limit integer not null check (ip_fresh_account_velocity_limit between 2 and 100),
  updated_at timestamptz not null default now()
);

insert into public.foundation_trial_policy (
  policy_key, enabled, trial_days, file_limit, page_limit, world_limit,
  daily_standard_unit_limit, device_reuse_window_days, ip_fresh_account_velocity_limit
) values ('default', true, 7, 3, 50, 1, 5000, 30, 4)
on conflict (policy_key) do nothing;

create table if not exists public.foundation_self_service_trials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_key text not null unique check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  status text not null default 'trialing'
    check (status in ('trialing', 'converted', 'expired', 'blocked')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_reason text check (ended_reason is null or ended_reason ~ '^[A-Z0-9_]{3,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > started_at)
);
create index if not exists foundation_self_service_trials_workspace_idx
  on public.foundation_self_service_trials (workspace_key, status, expires_at);

create table if not exists public.foundation_trial_risk_events (
  event_id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  device_hash text not null check (device_hash ~ '^hmac256:[a-f0-9]{64}$'),
  ip_prefix_hash text not null check (ip_prefix_hash ~ '^hmac256:[a-f0-9]{64}$'),
  provider text not null check (provider in ('google')),
  decision text not null check (decision in ('allow', 'review', 'deny')),
  reason_code text not null check (reason_code ~ '^[A-Z0-9_]{3,80}$'),
  observed_at timestamptz not null default now()
);
create index if not exists foundation_trial_risk_device_idx
  on public.foundation_trial_risk_events (device_hash, observed_at desc);
create index if not exists foundation_trial_risk_ip_idx
  on public.foundation_trial_risk_events (ip_prefix_hash, observed_at desc);
create index if not exists foundation_trial_risk_user_idx
  on public.foundation_trial_risk_events (user_id, observed_at desc);

create table if not exists public.foundation_trial_daily_budget (
  budget_day date primary key,
  reserved_standard_units integer not null default 0 check (reserved_standard_units >= 0),
  observed_overage_units integer not null default 0 check (observed_overage_units >= 0),
  updated_at timestamptz not null default now()
);

alter table public.foundation_compute_reservations
  add column if not exists billing_source text not null default 'paid';
alter table public.foundation_compute_reservations
  drop constraint if exists foundation_compute_reservations_billing_source_check;
alter table public.foundation_compute_reservations
  add constraint foundation_compute_reservations_billing_source_check
    check (billing_source in ('paid', 'trial', 'owner'));

alter table public.foundation_account_access_grants enable row level security;
alter table public.foundation_trial_policy enable row level security;
alter table public.foundation_self_service_trials enable row level security;
alter table public.foundation_trial_risk_events enable row level security;
alter table public.foundation_trial_daily_budget enable row level security;

revoke all on public.foundation_account_access_grants, public.foundation_trial_policy,
  public.foundation_self_service_trials, public.foundation_trial_risk_events,
  public.foundation_trial_daily_budget from public, anon, authenticated;
grant select, insert, update, delete on public.foundation_account_access_grants,
  public.foundation_trial_policy, public.foundation_self_service_trials,
  public.foundation_trial_risk_events, public.foundation_trial_daily_budget to service_role;
grant usage, select on sequence public.foundation_trial_risk_events_event_id_seq to service_role;

-- Create/read one evaluation. A same-device second account is denied. IP alone is never enough:
-- the IP velocity gate also requires a fresh Google account and several distinct fresh accounts
-- in the same 24-hour window. This avoids treating a household or office NAT as identity.
create or replace function public.bootstrap_foundation_self_service_trial(
  p_user_id uuid,
  p_workspace_key text,
  p_device_hash text,
  p_ip_prefix_hash text,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_policy public.foundation_trial_policy%rowtype;
  v_grant public.foundation_account_access_grants%rowtype;
  v_account public.foundation_billing_accounts%rowtype;
  v_trial public.foundation_self_service_trials%rowtype;
  v_user_created_at timestamptz;
  v_device_other_users integer := 0;
  v_ip_fresh_users integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_device_hash !~ '^hmac256:[a-f0-9]{64}$'
    or p_ip_prefix_hash !~ '^hmac256:[a-f0-9]{64}$'
    or p_provider <> 'google' then
    raise exception 'foundation_trial_bootstrap_invalid';
  end if;

  select * into v_grant from public.foundation_account_access_grants
   where user_id = p_user_id and active = true;
  if found then
    return jsonb_build_object(
      'status', 'owner', 'accessPlan', v_grant.access_plan,
      'billingExempt', v_grant.billing_exempt, 'trialExempt', v_grant.trial_exempt
    );
  end if;

  select * into v_account from public.foundation_billing_accounts
   where workspace_key = p_workspace_key and user_id = p_user_id;
  if found and v_account.billing_hold = false
    and v_account.access_plan in ('observer_access', 'studio_access')
    and v_account.subscription_status in ('active', 'trialing') then
    update public.foundation_self_service_trials
       set status = 'converted', ended_reason = 'PAID_ACCESS_ACTIVE', updated_at = v_now
     where user_id = p_user_id and status = 'trialing';
    return jsonb_build_object('status', 'paid', 'accessPlan', v_account.access_plan);
  end if;

  select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
  if not found or v_policy.enabled = false then
    return jsonb_build_object('status', 'denied', 'code', 'TRIAL_DISABLED');
  end if;

  select created_at into v_user_created_at from auth.users where id = p_user_id;
  if not found then raise exception 'foundation_trial_user_not_found'; end if;

  -- Lock shared risk keys in one fixed order so concurrent signups behind the same NAT cannot
  -- all observe a pre-limit count and grant themselves simultaneously.
  perform pg_advisory_xact_lock(hashtextextended('foundation-trial-ip:' || p_ip_prefix_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('foundation-trial-device:' || p_device_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('foundation-trial-user:' || p_user_id::text, 0));

  select * into v_trial from public.foundation_self_service_trials where user_id = p_user_id for update;
  if found then
    if v_trial.status = 'trialing' and v_trial.expires_at <= v_now then
      update public.foundation_self_service_trials
         set status = 'expired', ended_reason = 'TRIAL_TIME_EXPIRED', updated_at = v_now
       where user_id = p_user_id;
      v_trial.status := 'expired';
    end if;
    insert into public.foundation_trial_risk_events (
      user_id, workspace_key, device_hash, ip_prefix_hash, provider, decision, reason_code
    ) values (
      p_user_id, p_workspace_key, p_device_hash, p_ip_prefix_hash, p_provider,
      case when v_trial.status = 'trialing' then 'allow' else 'deny' end,
      case when v_trial.status = 'trialing' then 'EXISTING_TRIAL' else 'TRIAL_NOT_ACTIVE' end
    );
    if v_trial.status = 'trialing' then
      return jsonb_build_object(
        'status', 'trial', 'accessPlan', 'observer_access', 'expiresAt', v_trial.expires_at,
        'fileLimit', v_policy.file_limit, 'pageLimit', v_policy.page_limit,
        'worldLimit', v_policy.world_limit
      );
    end if;
    return jsonb_build_object('status', 'denied', 'code', 'TRIAL_NOT_ACTIVE');
  end if;

  select count(distinct user_id) into v_device_other_users
    from public.foundation_trial_risk_events
   where device_hash = p_device_hash
     and user_id <> p_user_id
     and decision = 'allow'
     and observed_at >= v_now - make_interval(days => v_policy.device_reuse_window_days);
  if v_device_other_users > 0 then
    insert into public.foundation_trial_risk_events (
      user_id, workspace_key, device_hash, ip_prefix_hash, provider, decision, reason_code
    ) values (p_user_id, p_workspace_key, p_device_hash, p_ip_prefix_hash, p_provider,
      'deny', 'DEVICE_ALREADY_USED_FOR_TRIAL');
    return jsonb_build_object('status', 'denied', 'code', 'TRIAL_DEVICE_ALREADY_USED');
  end if;

  select count(distinct e.user_id) into v_ip_fresh_users
    from public.foundation_trial_risk_events e
    join auth.users u on u.id = e.user_id
   where e.ip_prefix_hash = p_ip_prefix_hash
     and e.decision = 'allow'
     and e.observed_at >= v_now - interval '24 hours'
     and u.created_at >= v_now - interval '7 days';
  if v_user_created_at >= v_now - interval '7 days'
    and v_ip_fresh_users >= v_policy.ip_fresh_account_velocity_limit then
    insert into public.foundation_trial_risk_events (
      user_id, workspace_key, device_hash, ip_prefix_hash, provider, decision, reason_code
    ) values (p_user_id, p_workspace_key, p_device_hash, p_ip_prefix_hash, p_provider,
      'review', 'FRESH_ACCOUNT_IP_VELOCITY');
    return jsonb_build_object('status', 'denied', 'code', 'TRIAL_REVIEW_REQUIRED');
  end if;

  insert into public.foundation_self_service_trials (
    user_id, workspace_key, status, started_at, expires_at
  ) values (
    p_user_id, p_workspace_key, 'trialing', v_now,
    v_now + make_interval(days => v_policy.trial_days)
  ) returning * into v_trial;

  insert into public.foundation_trial_risk_events (
    user_id, workspace_key, device_hash, ip_prefix_hash, provider, decision, reason_code
  ) values (p_user_id, p_workspace_key, p_device_hash, p_ip_prefix_hash, p_provider,
    'allow', 'NEW_TRIAL_GRANTED');

  return jsonb_build_object(
    'status', 'trial', 'accessPlan', 'observer_access', 'expiresAt', v_trial.expires_at,
    'fileLimit', v_policy.file_limit, 'pageLimit', v_policy.page_limit,
    'worldLimit', v_policy.world_limit
  );
end;
$$;

-- Trial-aware intake. The existing paid/pilot velocity ceilings remain in force for everyone.
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
  v_trial public.foundation_self_service_trials%rowtype;
  v_policy public.foundation_trial_policy%rowtype;
  v_owner boolean := false;
  minute_count integer;
  minute_bytes bigint;
  day_count integer;
  day_bytes bigint;
  trial_file_count integer;
  expires_at_value timestamptz;
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_object_key <> ('quarantine/' || p_workspace_key || '/' || p_document_id::text || '/source')
    or p_requested_bytes < 1 or p_requested_bytes > 5242880
    or char_length(p_declared_mime_type) < 3 or char_length(p_declared_mime_type) > 160 then
    raise exception 'foundation_intake_admission_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('foundation-intake:' || p_workspace_key, 0));

  select * into existing from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and document_id = p_document_id for update;
  if found then
    if existing.user_id <> p_user_id or existing.object_key <> p_object_key
      or existing.declared_mime_type <> p_declared_mime_type then
      raise exception 'foundation_intake_idempotency_conflict';
    end if;
    if existing.confirmed_at is not null then
      return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
        'expiresAt', existing.expires_at, 'idempotentReplay', true, 'confirmed', true);
    end if;
    if existing.expires_at <= clock_timestamp() then
      expires_at_value := clock_timestamp() + interval '10 minutes';
      update public.foundation_intake_admissions
      set requested_bytes = p_requested_bytes, expires_at = expires_at_value
      where workspace_key = p_workspace_key and document_id = p_document_id
      returning * into existing;
    end if;
    return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
      'expiresAt', existing.expires_at, 'idempotentReplay', false, 'confirmed', false);
  end if;

  select exists(
    select 1 from public.foundation_account_access_grants
     where user_id = p_user_id and active = true and trial_exempt = true
  ) into v_owner;

  if not v_owner then
    select * into v_trial from public.foundation_self_service_trials
     where user_id = p_user_id and workspace_key = p_workspace_key for update;
    if found then
      if v_trial.status <> 'trialing' or v_trial.expires_at <= clock_timestamp() then
        raise exception 'foundation_trial_not_active';
      end if;
      select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
      select count(*) into trial_file_count
        from public.foundation_intake_admissions
       where workspace_key = p_workspace_key
         and (confirmed_at is not null or expires_at > clock_timestamp());
      if trial_file_count >= v_policy.file_limit then
        raise exception 'foundation_trial_file_limit_exceeded';
      end if;
    end if;
  end if;

  select count(*), coalesce(sum(requested_bytes), 0) into minute_count, minute_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '1 minute'
    and (confirmed_at is not null or expires_at > clock_timestamp());
  if minute_count >= 5 or minute_bytes + p_requested_bytes > 26214400 then
    raise exception 'foundation_intake_rate_limited';
  end if;

  select count(*), coalesce(sum(requested_bytes), 0) into day_count, day_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '24 hours'
    and (confirmed_at is not null or expires_at > clock_timestamp());
  if day_count >= 30 or day_bytes + p_requested_bytes > 104857600 then
    raise exception 'foundation_intake_daily_quota_exceeded';
  end if;

  expires_at_value := clock_timestamp() + interval '10 minutes';
  insert into public.foundation_intake_admissions (
    workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type, expires_at
  ) values (
    p_workspace_key, p_document_id, p_user_id, p_object_key, p_requested_bytes, p_declared_mime_type, expires_at_value
  );
  return jsonb_build_object('documentId', p_document_id, 'objectKey', p_object_key,
    'expiresAt', expires_at_value, 'idempotentReplay', false, 'confirmed', false);
end;
$$;

-- Owner/trial aware compute reservation. Paid behaviour is copied from v2 unchanged.
create or replace function public.reserve_foundation_compute_v3(
  p_workspace_key text,
  p_document_id uuid,
  p_user_id uuid,
  p_reserved_credits integer,
  p_maximum_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  account public.foundation_billing_accounts%rowtype;
  existing public.foundation_compute_reservations%rowtype;
  expired public.foundation_compute_reservations%rowtype;
  v_grant public.foundation_account_access_grants%rowtype;
  v_trial public.foundation_self_service_trials%rowtype;
  v_policy public.foundation_trial_policy%rowtype;
  v_trial_reserved bigint := 0;
  v_trial_settled bigint := 0;
  v_daily_total integer := 0;
  expires_at_value timestamptz;
  reservation_id_value uuid;
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_reserved_credits < 1 or p_reserved_credits > 60000
    or p_maximum_credits < p_reserved_credits or p_maximum_credits > 60000 then
    raise exception 'foundation_compute_reservation_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('foundation-compute:' || p_workspace_key, 0));

  for expired in
    select * from public.foundation_compute_reservations
    where workspace_key = p_workspace_key and state = 'reserved' and expires_at <= clock_timestamp()
    for update
  loop
    if expired.billing_source = 'paid' then
      update public.foundation_billing_accounts
        set credit_balance = credit_balance + expired.reserved_credits, updated_at = now()
        where workspace_key = p_workspace_key;
    end if;
    update public.foundation_compute_reservations
      set state = 'expired', settled_credits = 0, settled_at = now(), updated_at = now(),
          reason_code = 'CAPABILITY_EXPIRED'
      where reservation_id = expired.reservation_id;
  end loop;

  select * into existing from public.foundation_compute_reservations where document_id = p_document_id;
  if found then
    if existing.workspace_key <> p_workspace_key or existing.user_id <> p_user_id
      or existing.reserved_credits <> p_reserved_credits
      or existing.maximum_credits <> p_maximum_credits then
      raise exception 'foundation_compute_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'reservationId', existing.reservation_id,
      'documentId', existing.document_id,
      'state', existing.state,
      'expiresAt', existing.expires_at,
      'reservedCredits', existing.reserved_credits,
      'maximumCredits', existing.maximum_credits,
      'billingSource', existing.billing_source,
      'idempotentReplay', true
    );
  end if;

  select * into v_grant from public.foundation_account_access_grants
   where user_id = p_user_id and active = true and billing_exempt = true;
  if found then
    expires_at_value := clock_timestamp() + interval '10 minutes';
    reservation_id_value := gen_random_uuid();
    insert into public.foundation_compute_reservations (
      reservation_id, workspace_key, document_id, user_id, reserved_credits,
      maximum_credits, expires_at, billing_source
    ) values (
      reservation_id_value, p_workspace_key, p_document_id, p_user_id,
      p_reserved_credits, p_maximum_credits, expires_at_value, 'owner'
    );
    return jsonb_build_object(
      'reservationId', reservation_id_value, 'documentId', p_document_id,
      'state', 'reserved', 'expiresAt', expires_at_value,
      'reservedCredits', p_reserved_credits, 'maximumCredits', p_maximum_credits,
      'billingSource', 'owner', 'idempotentReplay', false
    );
  end if;

  select * into account from public.foundation_billing_accounts
    where workspace_key = p_workspace_key for update;
  if found and account.user_id = p_user_id
    and account.access_plan in ('observer_access', 'studio_access')
    and account.subscription_status in ('active', 'trialing')
    and account.billing_hold = false then
    if account.credit_balance < p_reserved_credits then raise exception 'foundation_credits_required'; end if;
    expires_at_value := clock_timestamp() + interval '10 minutes';
    reservation_id_value := gen_random_uuid();
    insert into public.foundation_compute_reservations (
      reservation_id, workspace_key, document_id, user_id, reserved_credits,
      maximum_credits, expires_at, billing_source
    ) values (
      reservation_id_value, p_workspace_key, p_document_id, p_user_id,
      p_reserved_credits, p_maximum_credits, expires_at_value, 'paid'
    );
    update public.foundation_billing_accounts
      set credit_balance = credit_balance - p_reserved_credits, updated_at = now()
      where workspace_key = p_workspace_key;
    return jsonb_build_object(
      'reservationId', reservation_id_value, 'documentId', p_document_id,
      'state', 'reserved', 'expiresAt', expires_at_value,
      'reservedCredits', p_reserved_credits, 'maximumCredits', p_maximum_credits,
      'billingSource', 'paid', 'idempotentReplay', false
    );
  elsif found and account.billing_hold then
    raise exception 'foundation_billing_hold';
  end if;

  select * into v_trial from public.foundation_self_service_trials
   where user_id = p_user_id and workspace_key = p_workspace_key for update;
  if not found then raise exception 'foundation_subscription_required'; end if;
  if v_trial.status <> 'trialing' or v_trial.expires_at <= clock_timestamp() then
    raise exception 'foundation_trial_not_active';
  end if;
  select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
  if not found or v_policy.enabled = false then raise exception 'foundation_trial_disabled'; end if;

  select coalesce(sum(reserved_credits), 0) into v_trial_reserved
    from public.foundation_compute_reservations
   where user_id = p_user_id and billing_source = 'trial'
     and state = 'reserved' and expires_at > clock_timestamp();
  select coalesce(sum(settled_credits), 0) into v_trial_settled
    from public.foundation_compute_reservations
   where user_id = p_user_id and billing_source = 'trial'
     and state in ('settled', 'operator_review');
  if v_trial_reserved + v_trial_settled + p_reserved_credits > v_policy.page_limit * 4 then
    raise exception 'foundation_trial_page_limit_exceeded';
  end if;

  insert into public.foundation_trial_daily_budget (budget_day, reserved_standard_units)
  values (current_date, p_reserved_credits)
  on conflict (budget_day) do update
    set reserved_standard_units = public.foundation_trial_daily_budget.reserved_standard_units + excluded.reserved_standard_units,
        updated_at = now()
  returning reserved_standard_units + observed_overage_units into v_daily_total;
  if v_daily_total > v_policy.daily_standard_unit_limit then
    raise exception 'foundation_trial_global_budget_exceeded';
  end if;

  expires_at_value := clock_timestamp() + interval '10 minutes';
  reservation_id_value := gen_random_uuid();
  insert into public.foundation_compute_reservations (
    reservation_id, workspace_key, document_id, user_id, reserved_credits,
    maximum_credits, expires_at, billing_source
  ) values (
    reservation_id_value, p_workspace_key, p_document_id, p_user_id,
    p_reserved_credits, p_maximum_credits, expires_at_value, 'trial'
  );
  return jsonb_build_object(
    'reservationId', reservation_id_value, 'documentId', p_document_id,
    'state', 'reserved', 'expiresAt', expires_at_value,
    'reservedCredits', p_reserved_credits, 'maximumCredits', p_maximum_credits,
    'billingSource', 'trial', 'idempotentReplay', false
  );
end;
$$;

create or replace function public.settle_foundation_compute_v3(
  p_workspace_key text,
  p_document_id uuid,
  p_outcome text,
  p_actual_credits integer,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reservation public.foundation_compute_reservations%rowtype;
  account public.foundation_billing_accounts%rowtype;
  v_policy public.foundation_trial_policy%rowtype;
  target_state public.foundation_compute_state;
  released_units integer;
  overage_delta integer;
  v_trial_total bigint := 0;
begin
  if p_outcome not in ('settled', 'operator_review', 'released')
    or p_actual_credits < 0 or p_actual_credits > 60000
    or (p_outcome = 'released' and p_actual_credits <> 0)
    or p_reason_code !~ '^[A-Z0-9_]{3,80}$' then
    raise exception 'foundation_compute_settlement_invalid';
  end if;
  target_state := p_outcome::public.foundation_compute_state;
  perform pg_advisory_xact_lock(hashtextextended('foundation-compute:' || p_workspace_key, 0));
  select * into reservation from public.foundation_compute_reservations
    where workspace_key = p_workspace_key and document_id = p_document_id for update;
  if not found then raise exception 'foundation_compute_reservation_not_found'; end if;

  if reservation.state in ('settled', 'released', 'operator_review') then
    if reservation.state = target_state and reservation.settled_credits = p_actual_credits then
      return jsonb_build_object('status', 'duplicate', 'reservationId', reservation.reservation_id,
        'billingSource', reservation.billing_source);
    end if;
    raise exception 'foundation_compute_settlement_conflict';
  end if;

  if reservation.billing_source in ('owner', 'trial') then
    -- Free access is never turned into an overage charge. If observed work exceeds the
    -- preflight maximum we preserve the observed amount for accounting and close the run;
    -- future trial reservations see the consumed budget and stop there.
    if p_actual_credits > reservation.maximum_credits then
      update public.foundation_compute_reservations
         set maximum_credits = p_actual_credits
       where reservation_id = reservation.reservation_id;
      reservation.maximum_credits := p_actual_credits;
    end if;
    update public.foundation_compute_reservations
       set state = target_state, settled_credits = p_actual_credits, reason_code = p_reason_code,
           settled_at = now(), updated_at = now()
     where reservation_id = reservation.reservation_id;

    if reservation.billing_source = 'trial' then
      if p_actual_credits > reservation.reserved_credits then
        insert into public.foundation_trial_daily_budget (budget_day, observed_overage_units)
        values (reservation.created_at::date, p_actual_credits - reservation.reserved_credits)
        on conflict (budget_day) do update
          set observed_overage_units = public.foundation_trial_daily_budget.observed_overage_units + excluded.observed_overage_units,
              updated_at = now();
      end if;
      select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
      select coalesce(sum(settled_credits), 0) into v_trial_total
        from public.foundation_compute_reservations
       where user_id = reservation.user_id and billing_source = 'trial'
         and state in ('settled', 'operator_review');
      if found and v_trial_total >= v_policy.page_limit * 4 then
        update public.foundation_self_service_trials
           set status = 'expired', ended_reason = 'TRIAL_PAGE_QUOTA_EXHAUSTED', updated_at = now()
         where user_id = reservation.user_id and status = 'trialing';
      end if;
    end if;

    return jsonb_build_object(
      'status', 'processed', 'reservationId', reservation.reservation_id,
      'state', target_state, 'settledCredits', p_actual_credits,
      'reservedCredits', reservation.reserved_credits,
      'maximumCredits', reservation.maximum_credits,
      'releasedCredits', greatest(0, reservation.reserved_credits - p_actual_credits),
      'overageCredits', 0, 'billingSource', reservation.billing_source
    );
  end if;

  if p_actual_credits > reservation.maximum_credits then
    raise exception 'foundation_compute_maximum_charge_exceeded';
  end if;
  select * into account from public.foundation_billing_accounts
    where workspace_key = p_workspace_key for update;
  if not found or account.user_id <> reservation.user_id then raise exception 'foundation_billing_account_required'; end if;
  overage_delta := greatest(0, p_actual_credits - reservation.reserved_credits);
  if overage_delta > 0 and (account.overage_enabled = false or account.billing_hold) then
    raise exception 'foundation_compute_overage_not_enabled';
  end if;
  released_units := greatest(0, reservation.reserved_credits - p_actual_credits);
  update public.foundation_billing_accounts
    set credit_balance = credit_balance + released_units,
        overage_units = overage_units + overage_delta,
        lifetime_overage_units = lifetime_overage_units + overage_delta,
        updated_at = now()
    where workspace_key = p_workspace_key;
  update public.foundation_compute_reservations
    set state = target_state, settled_credits = p_actual_credits, reason_code = p_reason_code,
        settled_at = now(), updated_at = now()
    where reservation_id = reservation.reservation_id;

  return jsonb_build_object(
    'status', 'processed', 'reservationId', reservation.reservation_id,
    'state', target_state, 'settledCredits', p_actual_credits,
    'reservedCredits', reservation.reserved_credits,
    'maximumCredits', reservation.maximum_credits,
    'releasedCredits', released_units, 'overageCredits', overage_delta,
    'billingSource', 'paid'
  );
end;
$$;

revoke all on function public.bootstrap_foundation_self_service_trial(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.reserve_foundation_compute_v3(text, uuid, uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.settle_foundation_compute_v3(text, uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text)
  from public, anon, authenticated;

grant execute on function public.bootstrap_foundation_self_service_trial(uuid, text, text, text, text) to service_role;
grant execute on function public.reserve_foundation_compute_v3(text, uuid, uuid, integer, integer) to service_role;
grant execute on function public.settle_foundation_compute_v3(text, uuid, text, integer, text) to service_role;
grant execute on function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text) to service_role;

commit;
