-- Rollback for migration 20261123120000_workspace_payer_for_members (WO-C-T2). Moved here from receipts/WO-C-T2/rollback.sql by the lead (train review blocker, 2026-11-26): content unchanged below this note. If the migration is renamed at merge, rename this file with it.
--
-- Not a migration: run by hand, as one transaction, against the database where 20261123120000 was
-- applied. It undoes exactly that change and refuses to run over anything else, including itself:
-- a second run finds the restored bodies, not the ones it guards on, and stops.
--
--   1. Asserts the functions are the ones 20261123120000 left. The md5 is of
--      pg_get_functiondef(...) with carriage returns removed, so a body applied from a CRLF file
--      (production) and one applied from LF (the local proof) hash alike; nothing else is relaxed:
--        reserve_foundation_compute_v3(text,uuid,uuid,integer,integer)  6fc3b7a3847d0dd19fa97ddd3636f246
--        reserve_foundation_intake_admission_unchecked(text,uuid,uuid,text,integer,text)  1bd2c9f6d4c8e2fb64fa6d846ae69185
--        foundation_workspace_payer(text,uuid)  43064fab908d75f8d2298b3fae4bc556
--   2. Restores reserve_foundation_compute_v3 (0045) and reserve_foundation_intake_admission_unchecked
--      (20261117160200) with `create or replace`, which keeps owner, grants and comments, and drops
--      foundation_workspace_payer.
--   3. Asserts the restored bodies are the earlier ones, as measured on a cluster built from main a632a374:
--        reserve_foundation_compute_v3(text,uuid,uuid,integer,integer)  a852b21af76dca97802f8c41705092bb
--        reserve_foundation_intake_admission_unchecked(text,uuid,uuid,text,integer,text)  240678b7f388b6e4b6f75dbe3cf0191e
--
-- Kept on purpose: the column foundation_compute_reservations.actor_user_id (and its foreign key).
-- Dropping it would erase who asked for every hold taken since 20261123120000; the restored 0045
-- function never writes it, and every reader ignores it. A member's hold taken before the rollback
-- keeps the owner in user_id, which is what every settlement function compares to the account, so
-- it settles or releases after the rollback exactly as before it. After the rollback a member is
-- answered as a stranger again (their own plan, none in someone else's workspace).
--
-- Recording it: this file does not edit supabase_migrations.schema_migrations. After it commits, the
-- operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261123120000';
-- in the same session, and writes the version, the time, the md5s above and who ran it into the
-- campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
declare
  v_expected jsonb := '{"reserve_foundation_compute_v3(text,uuid,uuid,integer,integer)": "6fc3b7a3847d0dd19fa97ddd3636f246",
    "reserve_foundation_intake_admission_unchecked(text,uuid,uuid,text,integer,text)": "1bd2c9f6d4c8e2fb64fa6d846ae69185",
    "foundation_workspace_payer(text,uuid)": "43064fab908d75f8d2298b3fae4bc556"}';
  v_key text;
begin
  for v_key in select jsonb_object_keys(v_expected) loop
    if to_regprocedure('public.' || v_key) is null
      or md5(replace(pg_get_functiondef(to_regprocedure('public.' || v_key)), E'\r', '')) <> v_expected ->> v_key then
      raise exception 'rollback-20261123120000 refused: public.% is not the function 20261123120000 left', v_key;
    end if;
  end loop;
end
$guard$;

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

create or replace function public.reserve_foundation_intake_admission_unchecked(
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
  v_rearm boolean := false;
  v_trial public.foundation_self_service_trials%rowtype;
  v_policy public.foundation_trial_policy%rowtype;
  v_owner boolean := false;
  v_paid boolean := false;
  v_is_trial boolean := false;
  minute_count integer;
  minute_bytes bigint;
  day_count integer;
  day_bytes bigint;
  trial_file_count integer;
  expires_at_value timestamptz;
  v_minute_count_limit integer := 20;
  v_minute_byte_limit bigint := 524288000; -- 500 MiB
  v_day_count_limit integer := 200;
  v_day_byte_limit bigint := 2147483648; -- 2 GiB
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_object_key <> ('quarantine/' || p_workspace_key || '/' || p_document_id::text || '/source')
    or p_requested_bytes < 1
    or char_length(p_declared_mime_type) < 3 or char_length(p_declared_mime_type) > 160 then
    raise exception 'foundation_intake_admission_invalid';
  end if;
  -- The processing ceiling, not an application preference. Admitting more than the CDR worker and
  -- the rasterizer will read is not a larger limit, it is a refusal the customer cannot see.
  if p_requested_bytes > 5242880 then -- 5 MiB
    raise exception 'foundation_intake_file_too_large';
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
    if existing.expires_at > clock_timestamp() then
      return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
        'expiresAt', existing.expires_at, 'idempotentReplay', false, 'confirmed', false);
    end if;
    -- Expired and unconfirmed: re-armed below, only after every check a first reservation passes.
    -- It is the candidate, counted once: the counts below skip it (neither confirmed nor live).
    v_rearm := true;
  end if;

  select exists(
    select 1 from public.foundation_account_access_grants
     where user_id = p_user_id and active = true and trial_exempt = true
  ) into v_owner;

  -- An active paid plan is this workspace's entitlement, whatever trial row it also carries. Every
  -- trial that converts keeps its row ('converted', 0045) and every lapsed one keeps 'expired', so
  -- reading the trial first refused every paying customer who had ever evaluated. The paid test is
  -- the one billingProductDecision (nextjs/lib/billing-product-access.ts) and
  -- reserve_foundation_compute_v3 (0045) already apply. Without it the trial branch below is
  -- unchanged: an expired or converted trial and no plan is still refused.
  if not v_owner then
    select exists(
      select 1 from public.foundation_billing_accounts a
       where a.workspace_key = p_workspace_key and a.user_id = p_user_id
         and a.billing_hold = false
         and a.access_plan in ('observer_access', 'studio_access')
         and a.subscription_status in ('active', 'trialing')
         and (a.subscription_cancel_at is null or a.subscription_cancel_at > clock_timestamp())
    ) into v_paid;
  end if;

  if not v_owner and not v_paid then
    select * into v_trial from public.foundation_self_service_trials
     where user_id = p_user_id and workspace_key = p_workspace_key for update;
    if found then
      v_is_trial := true;
      if v_trial.status <> 'trialing' or v_trial.expires_at <= clock_timestamp() then
        raise exception 'foundation_trial_not_active';
      end if;
      -- Free evaluation is bounded independently, and never above the processing ceiling. The
      -- guard above already refuses everything this one would; it stays so the trial bound is
      -- still stated here if the two numbers ever diverge again.
      if p_requested_bytes > 5242880 then -- min(50 MiB trial bound, 5 MiB processing ceiling)
        raise exception 'foundation_trial_file_too_large';
      end if;
      select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
      select count(*) into trial_file_count
        from public.foundation_intake_admissions
       where workspace_key = p_workspace_key
         and (confirmed_at is not null or expires_at > clock_timestamp());
      if trial_file_count >= v_policy.file_limit then
        raise exception 'foundation_trial_file_limit_exceeded';
      end if;
      -- Trial already has a three-file / fifty-page contract; keep transfer velocity modest too.
      v_minute_count_limit := 5;
      v_minute_byte_limit := 104857600; -- 100 MiB
      v_day_count_limit := 10;
      v_day_byte_limit := 157286400; -- 150 MiB
    end if;
  end if;

  select count(*), coalesce(sum(requested_bytes), 0) into minute_count, minute_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '1 minute'
    and (confirmed_at is not null or expires_at > clock_timestamp());
  if minute_count >= v_minute_count_limit or minute_bytes + p_requested_bytes > v_minute_byte_limit then
    raise exception 'foundation_intake_rate_limited';
  end if;

  select count(*), coalesce(sum(requested_bytes), 0) into day_count, day_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '24 hours'
    and (confirmed_at is not null or expires_at > clock_timestamp());
  if day_count >= v_day_count_limit or day_bytes + p_requested_bytes > v_day_byte_limit then
    raise exception 'foundation_intake_daily_quota_exceeded';
  end if;

  expires_at_value := clock_timestamp() + interval '10 minutes';
  if v_rearm then
    -- A re-arm opens a new window, so created_at moves with expires_at: the table's check
    -- (expires_at <= created_at + 15 minutes, 0008) cannot hold for an expired row otherwise.
    update public.foundation_intake_admissions
    set requested_bytes = p_requested_bytes, created_at = expires_at_value - interval '10 minutes',
      expires_at = expires_at_value
    where workspace_key = p_workspace_key and document_id = p_document_id
    returning * into existing;
    return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
      'expiresAt', existing.expires_at, 'idempotentReplay', false, 'confirmed', false);
  end if;
  insert into public.foundation_intake_admissions (
    workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type, expires_at
  ) values (
    p_workspace_key, p_document_id, p_user_id, p_object_key, p_requested_bytes, p_declared_mime_type, expires_at_value
  );
  return jsonb_build_object('documentId', p_document_id, 'objectKey', p_object_key,
    'expiresAt', expires_at_value, 'idempotentReplay', false, 'confirmed', false,
    'intakeClass', case when v_is_trial then 'trial' when v_owner then 'owner' else 'paid' end);
end;
$$;

drop function public.foundation_workspace_payer(text, uuid);

do $verify$
declare
  v_expected jsonb := '{"reserve_foundation_compute_v3(text,uuid,uuid,integer,integer)": "a852b21af76dca97802f8c41705092bb",
    "reserve_foundation_intake_admission_unchecked(text,uuid,uuid,text,integer,text)": "240678b7f388b6e4b6f75dbe3cf0191e"}';
  v_key text;
begin
  for v_key in select jsonb_object_keys(v_expected) loop
    if md5(replace(pg_get_functiondef(to_regprocedure('public.' || v_key)), E'\r', '')) <> v_expected ->> v_key then
      raise exception 'rollback-20261123120000 verify failed: public.% is not the earlier body', v_key;
    end if;
  end loop;
  if to_regprocedure('public.foundation_workspace_payer(text,uuid)') is not null then
    raise exception 'rollback-20261123120000 verify failed: foundation_workspace_payer still exists';
  end if;
end
$verify$;

commit;
