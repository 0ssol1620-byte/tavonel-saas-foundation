-- Consume each signed checkout bootstrap once, then bind later Paddle lifecycle events to the
-- exact customer and subscription established by that bootstrap. Current checkout policy applies
-- when the association is first created; an existing paid subscription can still reconcile its
-- renewals and cancellation after self-service sales close.
begin;

create table public.foundation_checkout_binding_consumptions (
  nonce uuid primary key,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  user_id uuid not null,
  offer_code text not null check (offer_code in ('observer_access', 'studio_access')),
  policy_version text not null check (policy_version = 'legacy-v2' or policy_version ~ '^checkout-v[1-9][0-9]*$'),
  initial_action text not null check (initial_action in ('purchase', 'allowance', 'legacy')),
  issued_at timestamptz not null,
  paddle_customer_id text not null check (paddle_customer_id ~ '^ctm_[a-z0-9]{26}$'),
  paddle_subscription_id text check (paddle_subscription_id ~ '^sub_[a-z0-9]{26}$'),
  first_event_id text not null check (first_event_id ~ '^evt_[a-z0-9]{26}$'),
  consumed_at timestamptz not null default now()
);

create unique index foundation_checkout_binding_subscription_unique
  on public.foundation_checkout_binding_consumptions (paddle_subscription_id)
  where paddle_subscription_id is not null;

alter table public.foundation_checkout_binding_consumptions enable row level security;
revoke all on public.foundation_checkout_binding_consumptions from public, anon, authenticated, service_role;

create or replace function public.apply_foundation_billing_event_v5(
  p_event_id text, p_event_type text, p_occurred_at timestamptz, p_payload_sha256 text,
  p_action text, p_workspace_key text default null, p_user_id uuid default null,
  p_offer_code text default null, p_transaction_id text default null, p_customer_id text default null,
  p_subscription_id text default null, p_subscription_status text default null,
  p_credit_delta integer default 0, p_adjustment_id text default null,
  p_binding_nonce text default null, p_binding_issued_at timestamptz default null,
  p_binding_policy_version text default null, p_binding_fresh boolean default false,
  p_bootstrap_allowed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  consumed public.foundation_checkout_binding_consumptions%rowtype;
  bound_nonce uuid;
  billing_exempt boolean := false;
  has_consumption boolean := false;
  legacy_existing boolean := false;
begin
  if p_action = 'reversal' then
    return public.apply_foundation_billing_event_v4(
      p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
      p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
      p_subscription_id, p_subscription_status, p_credit_delta, p_adjustment_id
    );
  end if;

  if p_action not in ('purchase', 'allowance', 'subscription')
    or p_binding_nonce is null
    or p_binding_nonce !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_binding_issued_at is null
    or p_binding_policy_version is null
    or (p_binding_policy_version <> 'legacy-v2' and p_binding_policy_version !~ '^checkout-v[1-9][0-9]*$')
    or p_workspace_key is null
    or p_user_id is null
    or p_offer_code not in ('observer_access', 'studio_access')
    or p_customer_id is null then
    return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_binding_contract_invalid');
  end if;

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

  if has_consumption then
    if consumed.workspace_key <> p_workspace_key
      or consumed.user_id <> p_user_id
      or consumed.offer_code <> p_offer_code
      or consumed.policy_version <> p_binding_policy_version
      or consumed.issued_at <> p_binding_issued_at
      or consumed.paddle_customer_id <> p_customer_id
      or consumed.paddle_subscription_id is distinct from p_subscription_id then
      return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_binding_reuse_conflict');
    end if;

    if billing_exempt and (
      p_action in ('purchase', 'allowance')
      or (p_action = 'subscription' and p_subscription_status in ('active', 'trialing'))
    ) then
      return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_account_billing_exempt');
    end if;
  else
    if p_binding_policy_version = 'legacy-v2' then
      if p_subscription_id is null then
        return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_legacy_binding_unassociated');
      end if;
      perform 1
        from public.foundation_billing_accounts account
        where account.workspace_key = p_workspace_key
          and account.user_id = p_user_id
          and account.paddle_customer_id = p_customer_id
          and account.paddle_subscription_id = p_subscription_id
        for update;
      legacy_existing := found;
      if not legacy_existing then
        return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_legacy_binding_unassociated');
      end if;
    else
      if p_action not in ('purchase', 'allowance') then
        return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_binding_bootstrap_event_invalid');
      end if;
      if not p_binding_fresh then
        return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_binding_expired');
      end if;
      if not p_bootstrap_allowed then
        return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_policy_closed');
      end if;
      if p_action = 'allowance' and p_subscription_id is null then
        return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_subscription_binding_required');
      end if;
    end if;
    if billing_exempt and (
      p_action in ('purchase', 'allowance')
      or (p_action = 'subscription' and p_subscription_status in ('active', 'trialing'))
    ) then
      return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_account_billing_exempt');
    end if;

    select nonce into bound_nonce
      from public.foundation_checkout_binding_consumptions
      where paddle_subscription_id = p_subscription_id;
    if found then
      return jsonb_build_object('status', 'binding_rejected', 'eventId', p_event_id, 'reason', 'checkout_subscription_reuse_conflict');
    end if;

    insert into public.foundation_checkout_binding_consumptions (
      nonce, workspace_key, user_id, offer_code, policy_version, initial_action, issued_at,
      paddle_customer_id, paddle_subscription_id, first_event_id
    ) values (
      p_binding_nonce::uuid, p_workspace_key, p_user_id, p_offer_code, p_binding_policy_version,
      case when p_binding_policy_version = 'legacy-v2' then 'legacy' else p_action end,
      p_binding_issued_at, p_customer_id, p_subscription_id, p_event_id
    );
  end if;

  return public.apply_foundation_billing_event_v4(
    p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
    p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
    p_subscription_id, p_subscription_status, p_credit_delta, p_adjustment_id
  );
end;
$$;

revoke all on function public.apply_foundation_billing_event_v5(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text,
  integer, text, text, timestamptz, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.apply_foundation_billing_event_v5(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text,
  integer, text, text, timestamptz, text, boolean, boolean
) to service_role;

-- All server-side billing mutations now enter through v5. The SECURITY DEFINER owner can still
-- delegate to v4 internally, while a service-role caller cannot skip binding consumption.
revoke execute on function public.apply_foundation_billing_event_v4(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) from service_role;

commit;
