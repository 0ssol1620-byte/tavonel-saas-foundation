-- Catalog v2 (PB-2026-11-V22): plan identity in the billing database. WO-CAT-3.
--
-- The four v2 offers (`personal`, `developer`, `team`, `business`) need offer codes the database
-- accepts. The entitlement level does not change: `foundation_billing_accounts.access_plan` stays
-- `observer_access` / `studio_access`, which every reservation, allowance, expiry and admission
-- function already understands, so none of those is touched. The plan a customer bought is
-- recorded beside it in the new nullable `plan_code` (null = a legacy plan, whose code IS its level).
--
-- One function names the codes. `foundation_offer_access_plan` maps personal/developer to
-- observer_access, team/business to studio_access, each legacy code to itself, and raises for
-- anything else (null included). Every place that compared an offer-code literal now asks it:
--   * the `offer_code` checks of foundation_checkout_intents (so issue_foundation_checkout_intent)
--     and foundation_checkout_binding_consumptions (the binding v6 consumes);
--   * apply_foundation_billing_event_v6, the entry point: an unknown code is still the durable
--     rejection row `checkout_binding_contract_invalid`, never a silent drop;
--   * apply_foundation_billing_event_v4's allowance branch: the grant row keeps the plan's own code,
--     so the FD-03 expiry floor (20260911130000) is per plan and a legacy month is not expired by
--     the first v2 grant;
--   * apply_foundation_billing_event (the 0005 base under v2/v3), the only writer of access_plan
--     for a paid subscription: access_plan = the mapped level, plan_code = the v2 code or null;
--   * apply_foundation_billing_event_v3, the 0010/0011 replacement of a subscription whose
--     cancellation is scheduled: unchanged for legacy Developer -> legacy Team, and widened so any
--     holder moves to a v2 plan it does not already hold. A retired code is never a target.
-- So v6 sets access_plan = foundation_offer_access_plan(p_offer_code) through the functions it
-- already delegates to; its signature and grants are unchanged.
--
-- Not touched, with the reason (the WO-CAT-3 receipt carries the full grep):
--   * every comparison of `access_plan` with a level (0009, 0033, 0036, 0045, 0047,
--     20261110040000, the founder reset grants): the level stays two-valued;
--   * the credit-pack codes of 0005's purchase branch: packs are retired and never plan codes;
--   * apply_foundation_billing_event_v5: not callable since 20260927120000 and refuses v2 codes.
--
-- Nothing becomes purchasable here: the checkout route refuses every v2 offer until WO-CAT-7.
-- Rollback: supabase/drafts/rollback-20261117140000-catalog-v2-offer-codes.sql (refuses while any
-- row holds a v2 code).
begin;

create function public.foundation_offer_access_plan(p_offer_code text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  case p_offer_code
    when 'personal', 'developer' then return 'observer_access';
    when 'team', 'business' then return 'studio_access';
    when 'observer_access', 'studio_access' then return p_offer_code;
    else raise exception 'foundation_offer_code_unknown' using errcode = 'invalid_parameter_value';
  end case;
end;
$$;

-- Callable by the service role because the table checks below run it on that role's direct writes
-- to foundation_billing_accounts (0005 grants them); browser roles get nothing.
revoke all on function public.foundation_offer_access_plan(text) from public, anon, authenticated;
grant execute on function public.foundation_offer_access_plan(text) to service_role;

alter table public.foundation_checkout_intents
  drop constraint foundation_checkout_intents_offer_code_check,
  add constraint foundation_checkout_intents_offer_code_check
    check (public.foundation_offer_access_plan(offer_code) is not null);

alter table public.foundation_checkout_binding_consumptions
  drop constraint foundation_checkout_binding_consumptions_offer_code_check,
  add constraint foundation_checkout_binding_consumptions_offer_code_check
    check (public.foundation_offer_access_plan(offer_code) is not null);

-- A plan code is a v2 code whose level is the account's level; a legacy account keeps null.
alter table public.foundation_billing_accounts
  add column plan_code text,
  add constraint foundation_billing_accounts_plan_code_check check (
    plan_code is null
    or (public.foundation_offer_access_plan(plan_code) <> plan_code
      and public.foundation_offer_access_plan(plan_code) = access_plan)
  );

-- The four bodies below are the latest definitions (0005, 0011, 20260911130000, 20260927120000)
-- with only the hunks named above changed. Signatures are unchanged, so their grants stand.

create or replace function public.apply_foundation_billing_event(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload_sha256 text,
  p_action text,
  p_workspace_key text default null,
  p_user_id uuid default null,
  p_offer_code text default null,
  p_transaction_id text default null,
  p_customer_id text default null,
  p_subscription_id text default null,
  p_subscription_status text default null,
  p_credit_delta integer default 0,
  p_adjustment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_owner uuid;
  v_purchase public.foundation_credit_ledger%rowtype;
  v_pending public.foundation_pending_reversals%rowtype;
  v_result text := 'processed';
  v_access_plan text;
begin
  if p_action not in ('purchase', 'subscription', 'reversal') then
    raise exception 'billing_action_invalid';
  end if;

  insert into public.foundation_billing_events (
    event_id, event_type, occurred_at, payload_sha256, action, workspace_key, user_id,
    transaction_id, subscription_id, adjustment_id
  ) values (
    p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action, p_workspace_key, p_user_id,
    p_transaction_id, p_subscription_id, p_adjustment_id
  ) on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id);
  end if;

  if p_action in ('purchase', 'subscription') then
    if p_workspace_key is null or p_user_id is null or p_offer_code is null or p_customer_id is null then
      raise exception 'billing_identity_binding_required';
    end if;
    insert into public.foundation_billing_accounts (workspace_key, user_id, paddle_customer_id)
    values (p_workspace_key, p_user_id, p_customer_id)
    on conflict (workspace_key) do nothing;
    select user_id into v_owner from public.foundation_billing_accounts where workspace_key = p_workspace_key for update;
    if v_owner is distinct from p_user_id then raise exception 'billing_workspace_owner_mismatch'; end if;
    update public.foundation_billing_accounts
      set paddle_customer_id = coalesce(paddle_customer_id, p_customer_id), updated_at = now()
      where workspace_key = p_workspace_key
        and (paddle_customer_id is null or paddle_customer_id = p_customer_id);
    if not found then raise exception 'billing_customer_mismatch'; end if;
  end if;

  if p_action = 'purchase' then
    if p_offer_code not in ('credit_starter', 'credit_builder', 'credit_scale')
      or p_transaction_id is null or p_credit_delta <= 0 then
      raise exception 'billing_purchase_contract_invalid';
    end if;
    insert into public.foundation_credit_ledger (
      workspace_key, user_id, event_id, kind, offer_code, transaction_id, credit_delta
    ) values (
      p_workspace_key, p_user_id, p_event_id, 'purchased', p_offer_code, p_transaction_id, p_credit_delta
    ) on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      update public.foundation_billing_accounts set
        credit_balance = credit_balance + p_credit_delta,
        lifetime_credits_purchased = lifetime_credits_purchased + p_credit_delta,
        updated_at = now()
      where workspace_key = p_workspace_key;
      select * into v_pending from public.foundation_pending_reversals
        where transaction_id = p_transaction_id for update;
      if found then
        insert into public.foundation_credit_ledger (
          workspace_key, user_id, event_id, kind, offer_code, reversal_of_transaction_id, credit_delta
        ) values (
          p_workspace_key, p_user_id, v_pending.event_id, 'reversed', p_offer_code, p_transaction_id, -p_credit_delta
        ) on conflict do nothing;
        if found then
          update public.foundation_billing_accounts set
            credit_balance = credit_balance - p_credit_delta,
            lifetime_credits_reversed = lifetime_credits_reversed + p_credit_delta,
            billing_hold = true,
            updated_at = now()
          where workspace_key = p_workspace_key;
          update public.foundation_billing_events set
            workspace_key = p_workspace_key, user_id = p_user_id,
            processing_result = 'reversal_applied', processed_at = now()
          where event_id = v_pending.event_id;
        end if;
        delete from public.foundation_pending_reversals where event_id = v_pending.event_id;
      end if;
    else
      v_result := 'duplicate_transaction';
    end if;
  elsif p_action = 'subscription' then
    -- 20261117140000: the offer code names a plan, access_plan stays the two-valued level.
    -- foundation_offer_access_plan raises for every code it does not name (null included).
    v_access_plan := public.foundation_offer_access_plan(p_offer_code);
    if p_subscription_id is null
      or p_subscription_status not in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'inactive') then
      raise exception 'billing_subscription_contract_invalid';
    end if;
    update public.foundation_billing_accounts set
      access_plan = v_access_plan,
      plan_code = nullif(p_offer_code, v_access_plan),
      subscription_status = p_subscription_status,
      paddle_subscription_id = p_subscription_id,
      last_subscription_event_at = p_occurred_at,
      updated_at = now()
    where workspace_key = p_workspace_key
      and (last_subscription_event_at is null or p_occurred_at >= last_subscription_event_at)
      and (paddle_subscription_id is null or paddle_subscription_id = p_subscription_id);
    if not found then v_result := 'stale_or_mismatched_subscription'; end if;
  else
    if p_transaction_id is null or p_adjustment_id is null then
      raise exception 'billing_reversal_contract_invalid';
    end if;
    select * into v_purchase from public.foundation_credit_ledger
      where transaction_id = p_transaction_id and kind = 'purchased' for update;
    if not found then
      insert into public.foundation_pending_reversals (event_id, transaction_id, adjustment_id, occurred_at)
      values (p_event_id, p_transaction_id, p_adjustment_id, p_occurred_at)
      on conflict do nothing;
      v_result := 'pending_original_transaction';
    else
      insert into public.foundation_credit_ledger (
        workspace_key, user_id, event_id, kind, offer_code, reversal_of_transaction_id, credit_delta
      ) values (
        v_purchase.workspace_key, v_purchase.user_id, p_event_id, 'reversed', v_purchase.offer_code,
        p_transaction_id, -v_purchase.credit_delta
      ) on conflict do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 1 then
        update public.foundation_billing_accounts set
          credit_balance = credit_balance - v_purchase.credit_delta,
          lifetime_credits_reversed = lifetime_credits_reversed + v_purchase.credit_delta,
          billing_hold = true,
          updated_at = now()
        where workspace_key = v_purchase.workspace_key;
        update public.foundation_billing_events set
          workspace_key = v_purchase.workspace_key, user_id = v_purchase.user_id
        where event_id = p_event_id;
      else
        v_result := 'duplicate_reversal';
      end if;
    end if;
  end if;

  update public.foundation_billing_events
    set processing_result = v_result, processed_at = now()
    where event_id = p_event_id;

  return jsonb_build_object('status', v_result, 'eventId', p_event_id);
exception when others then
  raise;
end;
$$;

create or replace function public.apply_foundation_billing_event_v3(
  p_event_id text, p_event_type text, p_occurred_at timestamptz, p_payload_sha256 text,
  p_action text, p_workspace_key text default null, p_user_id uuid default null,
  p_offer_code text default null, p_transaction_id text default null, p_customer_id text default null,
  p_subscription_id text default null, p_subscription_status text default null,
  p_credit_delta integer default 0, p_adjustment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.foundation_billing_events%rowtype;
  projected jsonb;
  projected_status text;
  upgraded integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('foundation-billing-event:' || p_event_id, 0));
  select * into existing from public.foundation_billing_events where event_id = p_event_id;

  if found then
    if existing.event_type <> p_event_type
      or existing.occurred_at <> p_occurred_at
      or existing.action <> p_action
      or existing.workspace_key is distinct from p_workspace_key
      or existing.user_id is distinct from p_user_id
      or existing.subscription_id is distinct from p_subscription_id then
      raise exception 'foundation_billing_event_id_conflict';
    end if;
    if existing.processing_result <> 'stale_or_mismatched_subscription' then
      if existing.payload_sha256 <> p_payload_sha256 then
        raise exception 'foundation_billing_event_id_conflict';
      end if;
      return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id);
    end if;
    if p_action <> 'subscription' then
      return jsonb_build_object('status', existing.processing_result, 'eventId', p_event_id);
    end if;
    projected_status := existing.processing_result;
  else
    projected := public.apply_foundation_billing_event_v2(
      p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
      p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
      p_subscription_id, p_subscription_status, p_credit_delta, p_adjustment_id
    );
    projected_status := projected->>'status';
    if p_action <> 'subscription'
      or projected_status <> 'stale_or_mismatched_subscription' then
      return projected;
    end if;
  end if;

  if p_event_type not in ('subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.trialing')
    or p_subscription_status not in ('active', 'trialing')
    or p_workspace_key is null
    or p_user_id is null
    or p_customer_id is null
    or p_subscription_id is null then
    return jsonb_build_object('status', projected_status, 'eventId', p_event_id);
  end if;

  update public.foundation_billing_accounts set
    access_plan = public.foundation_offer_access_plan(p_offer_code),
    plan_code = nullif(p_offer_code, public.foundation_offer_access_plan(p_offer_code)),
    subscription_status = p_subscription_status,
    paddle_subscription_id = p_subscription_id,
    subscription_cancel_at = null,
    last_subscription_event_at = p_occurred_at,
    updated_at = now()
  where workspace_key = p_workspace_key
    and user_id = p_user_id
    and paddle_customer_id = p_customer_id
    and (
      -- 0010/0011 unchanged: a legacy Developer subscription replaced by the legacy Team one.
      (p_offer_code = 'studio_access' and access_plan = 'observer_access' and plan_code is null)
      -- 20261117140000: any holder moves to a v2 plan it does not hold. A v2 code is one the
      -- mapping does not send to itself; a retired code is never a replacement target.
      or (public.foundation_offer_access_plan(p_offer_code) <> p_offer_code
        and p_offer_code <> coalesce(plan_code, access_plan))
    )
    and subscription_status in ('active', 'trialing')
    and subscription_cancel_at is not null
    and paddle_subscription_id is distinct from p_subscription_id
    and (last_subscription_event_at is null or p_occurred_at >= last_subscription_event_at);
  get diagnostics upgraded = row_count;

  if upgraded <> 1 then
    return jsonb_build_object('status', projected_status, 'eventId', p_event_id);
  end if;

  update public.foundation_billing_events set
    processing_result = 'processed_subscription_upgrade',
    processed_at = now()
  where event_id = p_event_id;

  return jsonb_build_object('status', 'processed_subscription_upgrade', 'eventId', p_event_id);
end;
$$;

create or replace function public.apply_foundation_billing_event_v4(
  p_event_id text, p_event_type text, p_occurred_at timestamptz, p_payload_sha256 text,
  p_action text, p_workspace_key text default null, p_user_id uuid default null,
  p_offer_code text default null, p_transaction_id text default null, p_customer_id text default null,
  p_subscription_id text default null, p_subscription_status text default null,
  p_credit_delta integer default 0, p_adjustment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
  owner_id uuid;
  existing public.foundation_billing_events%rowtype;
  allowance public.foundation_credit_ledger%rowtype;
  pending public.foundation_pending_reversals%rowtype;
  reversal_inserted integer := 0;
  balance_before integer := 0;
  other_offer_credits integer := 0;
  expired_units integer := 0;
  expiry_inserted integer := 0;
begin
  if p_action not in ('allowance', 'reversal') then
    return public.apply_foundation_billing_event_v3(
      p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
      p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
      p_subscription_id, p_subscription_status, p_credit_delta, p_adjustment_id
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('foundation-billing-event:' || p_event_id, 0));
  select * into existing from public.foundation_billing_events where event_id = p_event_id;
  if found then
    if existing.payload_sha256 <> p_payload_sha256 or existing.action <> p_action then
      raise exception 'foundation_billing_event_id_conflict';
    end if;
    -- No ledger or balance change occurred in this invocation. Keep the same explicit
    -- receipt field as the grant/duplicate-transaction path, including repeat delivery.
    return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id, 'expiredIncludedUnits', 0);
  end if;

  if p_action = 'reversal' then
    select * into allowance from public.foundation_credit_ledger
      where transaction_id = p_transaction_id and kind = 'allowance' for update;
    if not found then
      return public.apply_foundation_billing_event_v3(
        p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
        p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
        p_subscription_id, p_subscription_status, p_credit_delta, p_adjustment_id
      );
    end if;
    insert into public.foundation_billing_events
      (event_id, event_type, occurred_at, payload_sha256, action, workspace_key, user_id, transaction_id, adjustment_id, processing_result, processed_at)
    values
      (p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action, allowance.workspace_key, allowance.user_id, p_transaction_id, p_adjustment_id, 'reversal_applied', now());
    insert into public.foundation_credit_ledger
      (workspace_key, user_id, event_id, kind, offer_code, reversal_of_transaction_id, credit_delta)
    values
      (allowance.workspace_key, allowance.user_id, p_event_id, 'reversed', allowance.offer_code, p_transaction_id, -allowance.credit_delta)
    on conflict do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count = 1 then
      update public.foundation_billing_accounts set
        credit_balance = greatest(0, credit_balance - allowance.credit_delta),
        lifetime_credits_reversed = lifetime_credits_reversed + allowance.credit_delta,
        billing_hold = true,
        updated_at = now()
      where workspace_key = allowance.workspace_key;
    end if;
    return jsonb_build_object('status', 'reversal_applied', 'eventId', p_event_id);
  end if;

  if p_event_type <> 'transaction.completed'
    or public.foundation_offer_access_plan(p_offer_code) is null
    or p_workspace_key is null or p_user_id is null or p_customer_id is null
    or p_transaction_id is null or p_credit_delta <= 0 then
    raise exception 'billing_allowance_contract_invalid';
  end if;
  insert into public.foundation_billing_events
    (event_id, event_type, occurred_at, payload_sha256, action, workspace_key, user_id, transaction_id)
  values
    (p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action, p_workspace_key, p_user_id, p_transaction_id);
  insert into public.foundation_billing_accounts (workspace_key, user_id, paddle_customer_id)
  values (p_workspace_key, p_user_id, p_customer_id)
  on conflict (workspace_key) do nothing;
  select user_id into owner_id from public.foundation_billing_accounts where workspace_key = p_workspace_key for update;
  if owner_id is distinct from p_user_id then raise exception 'billing_workspace_owner_mismatch'; end if;
  update public.foundation_billing_accounts set paddle_customer_id = coalesce(paddle_customer_id, p_customer_id), updated_at = now()
    where workspace_key = p_workspace_key and (paddle_customer_id is null or paddle_customer_id = p_customer_id);
  if not found then raise exception 'billing_customer_mismatch'; end if;
  insert into public.foundation_credit_ledger
    (workspace_key, user_id, event_id, kind, offer_code, transaction_id, credit_delta)
  values
    (p_workspace_key, p_user_id, p_event_id, 'allowance', p_offer_code, p_transaction_id, p_credit_delta)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then
    -- FD-03. This period's pages replace what is left of the last period's, they do not add to
    -- it. The account row is already locked by the `for update` above, and the grant row inserted
    -- immediately above carries this offer_code, so it falls outside the floor by construction.
    select credit_balance into balance_before from public.foundation_billing_accounts
      where workspace_key = p_workspace_key;
    select greatest(0, coalesce(sum(credit_delta), 0)) into other_offer_credits
      from public.foundation_credit_ledger
      where workspace_key = p_workspace_key and offer_code is distinct from p_offer_code;
    expired_units := greatest(0, balance_before - other_offer_credits);
    if expired_units > 0 then
      insert into public.foundation_credit_ledger
        (workspace_key, user_id, event_id, kind, offer_code, transaction_id, credit_delta)
      values
        (p_workspace_key, p_user_id, p_event_id, 'allowance_expired', p_offer_code, p_transaction_id, -expired_units)
      on conflict do nothing;
      get diagnostics expiry_inserted = row_count;
      -- The balance follows the ledger row and never the intention: if the row did not land
      -- because this event has already expired its predecessor, nothing is taken a second time.
      if expiry_inserted <> 1 then expired_units := 0; end if;
    end if;
    update public.foundation_billing_accounts set
      credit_balance = credit_balance - expired_units + p_credit_delta,
      lifetime_allowance_units = lifetime_allowance_units + p_credit_delta,
      updated_at = now()
    where workspace_key = p_workspace_key;

    -- Paddle can deliver an adjustment before its transaction. V3 stores that adjustment in
    -- the pending ledger; connect it here so delivery order cannot resurrect refunded usage.
    select * into pending from public.foundation_pending_reversals
      where transaction_id = p_transaction_id for update;
    if found then
      insert into public.foundation_credit_ledger
        (workspace_key, user_id, event_id, kind, offer_code, reversal_of_transaction_id, credit_delta)
      values
        (p_workspace_key, p_user_id, pending.event_id, 'reversed', p_offer_code, p_transaction_id, -p_credit_delta)
      on conflict do nothing;
      get diagnostics reversal_inserted = row_count;
      if reversal_inserted = 1 then
        update public.foundation_billing_accounts set
          credit_balance = greatest(0, credit_balance - p_credit_delta),
          lifetime_credits_reversed = lifetime_credits_reversed + p_credit_delta,
          billing_hold = true,
          updated_at = now()
        where workspace_key = p_workspace_key;
        update public.foundation_billing_events set
          workspace_key = p_workspace_key,
          user_id = p_user_id,
          processing_result = 'reversal_applied',
          processed_at = now()
        where event_id = pending.event_id;
      end if;
      delete from public.foundation_pending_reversals where event_id = pending.event_id;
    end if;
  end if;
  update public.foundation_billing_events set processing_result = case when inserted_count = 1 then 'allowance_granted' else 'duplicate_transaction' end, processed_at = now()
    where event_id = p_event_id;
  return jsonb_build_object(
    'status', case when inserted_count = 1 then 'allowance_granted' else 'duplicate_transaction' end,
    'eventId', p_event_id,
    'expiredIncludedUnits', expired_units
  );
end;
$$;

create or replace function public.apply_foundation_billing_event_v6(
  p_event_id text, p_event_type text, p_occurred_at timestamptz, p_payload_sha256 text,
  p_action text, p_workspace_key text default null, p_user_id uuid default null,
  p_offer_code text default null, p_transaction_id text default null, p_customer_id text default null,
  p_subscription_id text default null, p_subscription_status text default null,
  p_adjustment_id text default null,
  p_binding_nonce text default null, p_binding_issued_at timestamptz default null,
  p_binding_policy_version text default null, p_price_id text default null,
  p_configured_credit_delta integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  consumed public.foundation_checkout_binding_consumptions%rowtype;
  intent public.foundation_checkout_intents%rowtype;
  reason text;
  billing_exempt boolean := false;
  has_consumption boolean := false;
  entitling boolean;
  credit integer;
  snapshot_price text;
  snapshot_credit integer;
  projected jsonb;
  previously_applied public.foundation_billing_events%rowtype;
begin
  if p_action = 'reversal' then
    return public.apply_foundation_billing_event_v4(
      p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
      null, null, null, p_transaction_id, null, null, null, 0, p_adjustment_id
    );
  end if;

  -- A redelivery of an already-applied event must remain a duplicate even if an owner grant or
  -- configured price changed meanwhile. Keep this under the same event lock as the projection.
  perform pg_advisory_xact_lock(hashtextextended('foundation-billing-event:' || p_event_id, 0));
  select * into previously_applied
    from public.foundation_billing_events where event_id = p_event_id for update;
  if found then
    if previously_applied.processing_result = 'stale_or_mismatched_subscription'
      and p_action = 'subscription' then
      -- v3 deliberately retries a stale Studio upgrade after the old subscription gains a
      -- cancellation schedule. Continue through the nonce/price checks, then let v3 decide.
      null;
    else
      if previously_applied.payload_sha256 <> p_payload_sha256
        or previously_applied.action <> p_action then
        raise exception 'foundation_billing_event_id_conflict';
      end if;
      update public.foundation_billing_event_rejections
        set resolved_at = now(), resolution_status = 'duplicate'
        where event_id = p_event_id and resolved_at is null;
      return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id);
    end if;
  end if;

  if p_action not in ('purchase', 'allowance', 'subscription')
    or p_binding_nonce is null
    or p_binding_nonce !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_binding_issued_at is null
    or p_binding_policy_version is null
    or (p_binding_policy_version <> 'legacy-v2' and p_binding_policy_version !~ '^checkout-v[1-9][0-9]*$')
    or p_workspace_key is null
    or p_user_id is null
    or p_offer_code is null
    or p_customer_id is null
    or (p_price_id is not null and p_price_id !~ '^pri_[a-z0-9]{26}$')
    or (p_configured_credit_delta is not null and p_configured_credit_delta <= 0) then
    reason := 'checkout_binding_contract_invalid';
  end if;
  -- 20261117140000: the offer codes are the ones foundation_offer_access_plan names, and no list here.
  if reason is null then
    begin
      perform public.foundation_offer_access_plan(p_offer_code);
    exception when invalid_parameter_value then
      reason := 'checkout_binding_contract_invalid';
    end;
  end if;

  if reason is null then
    perform pg_advisory_xact_lock(hashtextextended('foundation-checkout-binding:' || p_binding_nonce, 0));
    if p_subscription_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('foundation-checkout-subscription:' || p_subscription_id, 0));
    end if;

    select * into consumed
      from public.foundation_checkout_binding_consumptions
      where nonce = p_binding_nonce::uuid
      for update;
    has_consumption := found;

    -- Serialize the exemption decision with grant writes before consuming a nonce.
    lock table public.foundation_account_access_grants in share mode;
    select exists (
      select 1
      from public.foundation_account_access_grants grant_row
      where grant_row.user_id = p_user_id
        and grant_row.active
        and grant_row.billing_exempt
    ) into billing_exempt;

    entitling := p_action in ('purchase', 'allowance')
      or (p_action = 'subscription' and p_subscription_status in ('active', 'trialing'));

    if has_consumption then
      if consumed.workspace_key <> p_workspace_key
        or consumed.user_id <> p_user_id
        or consumed.offer_code <> p_offer_code
        or consumed.policy_version <> p_binding_policy_version
        or consumed.issued_at <> p_binding_issued_at
        or consumed.paddle_customer_id <> p_customer_id
        or consumed.paddle_subscription_id is distinct from p_subscription_id then
        reason := 'checkout_binding_reuse_conflict';
      end if;
      snapshot_price := consumed.price_id;
      snapshot_credit := consumed.credit_delta;
    elsif p_binding_policy_version = 'legacy-v2' then
      if p_subscription_id is null then
        reason := 'checkout_legacy_binding_unassociated';
      else
        perform 1
          from public.foundation_billing_accounts account
          where account.workspace_key = p_workspace_key
            and account.user_id = p_user_id
            and account.paddle_customer_id = p_customer_id
            and account.paddle_subscription_id = p_subscription_id
          for update;
        if not found then
          reason := 'checkout_legacy_binding_unassociated';
        end if;
      end if;
    elsif p_action not in ('purchase', 'allowance')
      and not (p_action = 'subscription'
        and p_event_type in ('subscription.created', 'subscription.activated')
        and p_subscription_status in ('active', 'trialing')
        and p_subscription_id is not null) then
      reason := 'checkout_binding_bootstrap_event_invalid';
    else
      select * into intent
        from public.foundation_checkout_intents
        where nonce = p_binding_nonce::uuid;
      if not found then
        reason := 'checkout_intent_missing';
      elsif intent.workspace_key <> p_workspace_key
        or intent.user_id <> p_user_id
        or intent.offer_code <> p_offer_code
        or intent.policy_version <> p_binding_policy_version
        or intent.issued_at <> p_binding_issued_at then
        reason := 'checkout_intent_mismatch';
      elsif p_occurred_at < intent.issued_at - interval '5 minutes'
        or p_occurred_at > intent.expires_at then
        reason := 'checkout_intent_expired';
      elsif p_price_id is distinct from intent.price_id then
        reason := 'checkout_price_not_allowed';
      elsif p_action = 'allowance' and p_subscription_id is null then
        reason := 'checkout_subscription_binding_required';
      end if;
      snapshot_price := intent.price_id;
      snapshot_credit := intent.credit_delta;
    end if;

    -- Entitling events settle from the snapshot; a price the snapshot never offered is accepted
    -- only when it is the offer's currently configured price. Non-entitling status changes
    -- (cancellation, past due, pause) always pass so access can be withdrawn.
    if reason is null and entitling then
      if billing_exempt then
        reason := 'checkout_account_billing_exempt';
      elsif snapshot_price is not null and p_price_id = snapshot_price then
        credit := snapshot_credit;
      elsif p_configured_credit_delta is not null then
        credit := p_configured_credit_delta;
      else
        reason := 'checkout_price_not_allowed';
      end if;
    end if;

    if reason is null and not has_consumption then
      if exists (
        select 1 from public.foundation_checkout_binding_consumptions
        where paddle_subscription_id = p_subscription_id
      ) then
        reason := 'checkout_subscription_reuse_conflict';
      else
        insert into public.foundation_checkout_binding_consumptions (
          nonce, workspace_key, user_id, offer_code, policy_version, initial_action, issued_at,
          paddle_customer_id, paddle_subscription_id, first_event_id, price_id, credit_delta
        ) values (
          p_binding_nonce::uuid, p_workspace_key, p_user_id, p_offer_code, p_binding_policy_version,
          case when p_binding_policy_version = 'legacy-v2' then 'legacy' else p_action end,
          p_binding_issued_at, p_customer_id, p_subscription_id, p_event_id,
          snapshot_price, snapshot_credit
        );
      end if;
    end if;
  end if;

  if reason is not null then
    return public.reject_foundation_billing_event(
      p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action, reason,
      p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
      p_subscription_id, p_price_id, p_binding_nonce
    );
  end if;

  projected := public.apply_foundation_billing_event_v4(
    p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
    p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
    p_subscription_id, p_subscription_status,
    case when p_action in ('purchase', 'allowance') then credit else 0 end,
    p_adjustment_id
  );
  update public.foundation_billing_event_rejections
    set resolved_at = now(), resolution_status = projected->>'status'
    where event_id = p_event_id and resolved_at is null;
  return projected;
end;
$$;

commit;
