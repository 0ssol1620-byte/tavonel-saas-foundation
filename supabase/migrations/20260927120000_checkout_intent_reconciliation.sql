-- Durable checkout intents, so a paid Paddle event is judged by what was authorized when the
-- buyer was sent to checkout rather than by whatever the deployment says when the webhook lands.
--
-- v5 recomputed the public checkout gate and resolved price ids from current configuration at
-- webhook time. A buyer who paid after the gate closed, or after a price id rotated, was answered
-- `binding_rejected` with HTTP 200 and nothing durable: Paddle kept the money and nothing here
-- remembered it. Now:
--   * the checkout route records one intent per signed binding while the gate is open, with the
--     price id and credit amount it offered (issue_foundation_checkout_intent);
--   * v6 bootstraps a new binding only from a matching unexpired intent, and settles credits from
--     that snapshot, never from current configuration;
--   * a consumed binding keeps the snapshot, so renewals and cancellations of an established
--     subscription survive later price rotation and gate closure;
--   * every rejection is written to foundation_billing_event_rejections in the same transaction,
--     so a paid event that cannot be applied is a reviewable row instead of a log line.
-- Billing-exempt owners are still refused at both issuance and application.
begin;

create table public.foundation_checkout_intents (
  nonce uuid primary key,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  user_id uuid not null,
  offer_code text not null check (offer_code in ('observer_access', 'studio_access')),
  policy_version text not null check (policy_version ~ '^checkout-v[1-9][0-9]*$'),
  price_id text not null check (price_id ~ '^pri_[a-z0-9]{26}$'),
  credit_delta integer not null check (credit_delta > 0),
  issued_at timestamptz not null,
  -- A fixed 24-hour checkout window covers a buyer returning from card authentication.
  -- Delayed payment methods need a separate policy and reconciliation path before activation.
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > issued_at)
);

alter table public.foundation_checkout_intents enable row level security;
revoke all on public.foundation_checkout_intents from public, anon, authenticated, service_role;

alter table public.foundation_checkout_binding_consumptions
  add column price_id text check (price_id ~ '^pri_[a-z0-9]{26}$'),
  add column credit_delta integer check (credit_delta > 0);

-- Paddle can deliver subscription.created before transaction.completed. A verified subscription
-- from a recorded checkout intent may establish the association before the allowance arrives.
alter table public.foundation_checkout_binding_consumptions
  drop constraint foundation_checkout_binding_consumptions_initial_action_check;
alter table public.foundation_checkout_binding_consumptions
  add constraint foundation_checkout_binding_consumptions_initial_action_check
  check (initial_action in ('purchase', 'allowance', 'subscription', 'legacy'));

create table public.foundation_billing_event_rejections (
  event_id text primary key check (event_id ~ '^evt_[a-z0-9]{26}$'),
  event_type text not null,
  occurred_at timestamptz not null,
  payload_sha256 text not null,
  action text not null,
  reason text not null,
  workspace_key text,
  user_id uuid,
  offer_code text,
  transaction_id text,
  customer_id text,
  subscription_id text,
  price_id text,
  binding_nonce text,
  resolved_at timestamptz,
  resolution_status text,
  recorded_at timestamptz not null default now()
);

alter table public.foundation_billing_event_rejections enable row level security;
revoke all on public.foundation_billing_event_rejections from public, anon, authenticated, service_role;

create or replace function public.issue_foundation_checkout_intent(
  p_nonce uuid, p_workspace_key text, p_user_id uuid, p_offer_code text,
  p_policy_version text, p_price_id text, p_credit_delta integer, p_issued_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_issued_at is null or abs(extract(epoch from (now() - p_issued_at))) > 300 then
    return jsonb_build_object('status', 'rejected', 'reason', 'checkout_intent_clock_skew');
  end if;
  -- Match the webhook's grant lock: an owner exemption cannot race this issuance check.
  lock table public.foundation_account_access_grants in share mode;
  if exists (
    select 1
    from public.foundation_account_access_grants grant_row
    where grant_row.user_id = p_user_id
      and grant_row.active
      and grant_row.billing_exempt
  ) then
    return jsonb_build_object('status', 'rejected', 'reason', 'checkout_account_billing_exempt');
  end if;
  insert into public.foundation_checkout_intents (
    nonce, workspace_key, user_id, offer_code, policy_version, price_id, credit_delta,
    issued_at, expires_at
  ) values (
    p_nonce, p_workspace_key, p_user_id, p_offer_code, p_policy_version, p_price_id, p_credit_delta,
    p_issued_at, p_issued_at + interval '24 hours'
  );
  return jsonb_build_object('status', 'issued', 'nonce', p_nonce);
end;
$$;

revoke all on function public.issue_foundation_checkout_intent(
  uuid, text, uuid, text, text, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.issue_foundation_checkout_intent(
  uuid, text, uuid, text, text, text, integer, timestamptz
) to service_role;

-- Private to v6: records the refusal in v6's transaction and returns v6's answer.
create or replace function public.reject_foundation_billing_event(
  p_event_id text, p_event_type text, p_occurred_at timestamptz, p_payload_sha256 text,
  p_action text, p_reason text, p_workspace_key text, p_user_id uuid, p_offer_code text,
  p_transaction_id text, p_customer_id text, p_subscription_id text, p_price_id text,
  p_binding_nonce text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.foundation_billing_event_rejections (
    event_id, event_type, occurred_at, payload_sha256, action, reason, workspace_key, user_id,
    offer_code, transaction_id, customer_id, subscription_id, price_id, binding_nonce
  ) values (
    p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action, p_reason, p_workspace_key,
    p_user_id, p_offer_code, p_transaction_id, p_customer_id, p_subscription_id, p_price_id,
    p_binding_nonce
  ) on conflict (event_id) do nothing;
  return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', p_reason);
end;
$$;

revoke all on function public.reject_foundation_billing_event(
  text, text, timestamptz, text, text, text, text, uuid, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

-- A signed Paddle payment with malformed or missing TAVONEL binding cannot be projected, but
-- it must still be durably visible to billing reconciliation before the webhook acknowledges it.
create or replace function public.quarantine_foundation_billing_envelope(
  p_event_id text, p_event_type text, p_occurred_at timestamptz,
  p_payload_sha256 text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_event_id !~ '^evt_[a-z0-9]{26}$'
    or (p_event_type <> 'transaction.completed' and p_event_type not like 'subscription.%')
    or p_occurred_at is null
    or p_payload_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_reason is null or length(p_reason) > 80 then
    raise exception 'billing_quarantine_contract_invalid';
  end if;
  return public.reject_foundation_billing_event(
    p_event_id, p_event_type, p_occurred_at, p_payload_sha256,
    'ignored', p_reason, null, null, null, null, null, null, null, null
  );
end;
$$;

revoke all on function public.quarantine_foundation_billing_envelope(
  text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.quarantine_foundation_billing_envelope(
  text, text, timestamptz, text, text
) to service_role;

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
    if previously_applied.payload_sha256 <> p_payload_sha256
      or previously_applied.action <> p_action then
      raise exception 'foundation_billing_event_id_conflict';
    end if;
    update public.foundation_billing_event_rejections
      set resolved_at = now(), resolution_status = 'duplicate'
      where event_id = p_event_id and resolved_at is null;
    return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id);
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
    or p_offer_code not in ('observer_access', 'studio_access')
    or p_customer_id is null
    or (p_price_id is not null and p_price_id !~ '^pri_[a-z0-9]{26}$')
    or (p_configured_credit_delta is not null and p_configured_credit_delta <= 0) then
    reason := 'checkout_binding_contract_invalid';
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

revoke all on function public.apply_foundation_billing_event_v6(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text,
  text, text, timestamptz, text, text, integer
) from public, anon, authenticated;
grant execute on function public.apply_foundation_billing_event_v6(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text,
  text, text, timestamptz, text, text, integer
) to service_role;

-- All server-side billing mutations now enter through v6. v5 re-read the live checkout gate at
-- webhook time; leaving it callable would let a stale deployment drop paid events again.
revoke execute on function public.apply_foundation_billing_event_v5(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text,
  integer, text, text, timestamptz, text, boolean, boolean
) from service_role;

commit;
