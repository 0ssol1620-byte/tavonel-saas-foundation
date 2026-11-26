-- WO-C-T2 (workorders/all-features/C-teams-federation-creators.md): the workspace's plan and meters
-- apply to every member. A member's work draws on the workspace's allowance, never the member's own,
-- and never twice.
--
-- Ordering: 20261123120000 is provisional, after every migration on main (a632a374, last
-- 20261117160200) and after WO-C-T3's provisional 20261118120000; the lead renames it at merge.
-- Rollback draft: receipts/WO-C-T2/rollback.sql (outside the repository, proven on a local cluster).
--
-- What keyed on the acting user, and what this file changes (the full table is in the receipt):
--   reserve_foundation_compute_v3          grant, paid account and trial by p_user_id     -> by payer
--   reserve_foundation_intake_admission_unchecked  grant and paid account by p_user_id    -> by payer
-- What already keyed on the workspace and is not touched: the query meter
-- (admit/settle_foundation_knowledge_query), the storage allowance (the 7-argument
-- reserve_foundation_intake_admission) and the seat allowance (foundation_workspace_seat_limit), all
-- through foundation_workspace_capped_plan (20261117160000), i.e. the workspace's billing account and
-- the grant of THAT ACCOUNT's user. settle_foundation_compute_v3/v4 and the reversal and re-charge
-- triggers are not replaced: they compare the workspace's account to the reservation's user_id, which
-- this file makes the payer.
--
-- 1. foundation_workspace_payer(workspace, actor): for an actor holding an active admin or member row,
--    the holder of the workspace's billing account -- the user foundation_workspace_capped_plan
--    (20261117160000) already reads, so the grant that exempts is that account's user's, as CAT-D13
--    decided -- or, for a workspace with no billing account, its active owner. Every other caller
--    (an owner, anyone with no active membership) resolves to themselves, so an owner-only
--    workspace takes exactly the path it took before. Today every account holder is the owner of
--    the workspace the account was bought for (the checkout binds the buyer's own workspace).
--    No account and no active owner raises foundation_workspace_owner_missing (the deferred
--    one-owner invariant of 20260920110100 makes it unreachable short of corruption).
-- 2. foundation_compute_reservations.actor_user_id (nullable; rows before this file carry null, which
--    means "the actor is user_id"): who asked for the hold. user_id is now the payer. A replay is
--    matched on coalesce(actor_user_id, user_id), so an owner's replay is matched exactly as before.
-- 3. reserve_foundation_compute_v3, replaced whole from 0045: grant and paid account of the payer;
--    a member whose workspace has neither is refused (foundation_subscription_required) and never
--    reaches the trial branch -- a free evaluation is one person's. Its receipt is unchanged.
-- 4. reserve_foundation_intake_admission_unchecked, replaced whole from 20261117160200: grant and paid
--    account of the payer; a member of a workspace with neither is refused the same way. The row
--    still records the uploader in user_id (WO-C-T3's scope trigger reads it).
begin;

alter table public.foundation_compute_reservations
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null;
comment on column public.foundation_compute_reservations.actor_user_id is
  'Who asked for the hold (WO-C-T2). user_id is the payer; null on rows before 20261123120000, where the actor is user_id.';

create function public.foundation_workspace_payer(p_workspace_key text, p_actor_user_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role text;
  v_payer uuid;
begin
  select m.role into v_role from public.foundation_workspace_members m
   where m.workspace_key = p_workspace_key and m.user_id = p_actor_user_id and m.state = 'active';
  if not found or v_role = 'owner' then
    return p_actor_user_id;
  end if;
  -- The holder of the workspace's billing account (one per workspace, 0005), as
  -- foundation_workspace_capped_plan reads it; a workspace with none answers to its active owner.
  select a.user_id into v_payer from public.foundation_billing_accounts a where a.workspace_key = p_workspace_key;
  if found then
    return v_payer;
  end if;
  -- One active owner per workspace (foundation_workspace_one_active_owner_idx).
  select m.user_id into v_payer from public.foundation_workspace_members m
   where m.workspace_key = p_workspace_key and m.role = 'owner' and m.state = 'active';
  if v_payer is null then
    raise exception 'foundation_workspace_owner_missing';
  end if;
  return v_payer;
end;
$$;
revoke all on function public.foundation_workspace_payer(text, uuid) from public, anon, authenticated, service_role;
comment on function public.foundation_workspace_payer(text, uuid) is
  'The user whose grant and account a caller draws on in a workspace (WO-C-T2): the account holder for an admin or member, else the owner; the caller otherwise. Reached only through the compute and intake reservations.';

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
  v_payer uuid;
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
    if existing.workspace_key <> p_workspace_key or coalesce(existing.actor_user_id, existing.user_id) <> p_user_id
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

  -- Whose grant, account and trial this hold draws on: the workspace's payer for an active admin or
  -- member, the caller's own otherwise (unchanged). user_id records that payer, so every settlement,
  -- reversal and re-charge (which compare the account to user_id) treats a member's hold as the
  -- owner's; actor_user_id records who asked.
  v_payer := public.foundation_workspace_payer(p_workspace_key, p_user_id);

  select * into v_grant from public.foundation_account_access_grants
   where user_id = v_payer and active = true and billing_exempt = true;
  if found then
    expires_at_value := clock_timestamp() + interval '10 minutes';
    reservation_id_value := gen_random_uuid();
    insert into public.foundation_compute_reservations (
      reservation_id, workspace_key, document_id, user_id, reserved_credits,
      maximum_credits, expires_at, billing_source, actor_user_id
    ) values (
      reservation_id_value, p_workspace_key, p_document_id, v_payer,
      p_reserved_credits, p_maximum_credits, expires_at_value, 'owner', p_user_id
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
  if found and account.user_id = v_payer
    and account.access_plan in ('observer_access', 'studio_access')
    and account.subscription_status in ('active', 'trialing')
    and account.billing_hold = false then
    if account.credit_balance < p_reserved_credits then raise exception 'foundation_credits_required'; end if;
    expires_at_value := clock_timestamp() + interval '10 minutes';
    reservation_id_value := gen_random_uuid();
    insert into public.foundation_compute_reservations (
      reservation_id, workspace_key, document_id, user_id, reserved_credits,
      maximum_credits, expires_at, billing_source, actor_user_id
    ) values (
      reservation_id_value, p_workspace_key, p_document_id, v_payer,
      p_reserved_credits, p_maximum_credits, expires_at_value, 'paid', p_user_id
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

  -- A free evaluation is one person's (trial-ai-access.ts): a member never draws on the owner's.
  if v_payer <> p_user_id then raise exception 'foundation_subscription_required'; end if;

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
    maximum_credits, expires_at, billing_source, actor_user_id
  ) values (
    reservation_id_value, p_workspace_key, p_document_id, p_user_id,
    p_reserved_credits, p_maximum_credits, expires_at_value, 'trial', p_user_id
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
  v_payer uuid;
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

  -- The workspace payer's grant and plan for an active admin or member, the caller's own otherwise
  -- (unchanged). The admission row keeps the uploader in user_id.
  v_payer := public.foundation_workspace_payer(p_workspace_key, p_user_id);

  select exists(
    select 1 from public.foundation_account_access_grants
     where user_id = v_payer and active = true and trial_exempt = true
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
       where a.workspace_key = p_workspace_key and a.user_id = v_payer
         and a.billing_hold = false
         and a.access_plan in ('observer_access', 'studio_access')
         and a.subscription_status in ('active', 'trialing')
         and (a.subscription_cancel_at is null or a.subscription_cancel_at > clock_timestamp())
    ) into v_paid;
  end if;

  if not v_owner and not v_paid then
    -- A free evaluation is one person's: a member never draws on the owner's, nor uploads unpaid.
    if v_payer <> p_user_id then raise exception 'foundation_subscription_required'; end if;
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

commit;
