-- Permit one fail-closed Observer-to-Studio replacement after the existing
-- subscription is scheduled to cancel. All other subscription-id changes stay
-- rejected, and browser roles cannot invoke the projection.
begin;

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
      or existing.payload_sha256 <> p_payload_sha256
      or existing.action <> p_action
      or existing.workspace_key is distinct from p_workspace_key
      or existing.user_id is distinct from p_user_id
      or existing.subscription_id is distinct from p_subscription_id then
      raise exception 'foundation_billing_event_id_conflict';
    end if;
    if p_action <> 'subscription'
      or existing.processing_result <> 'stale_or_mismatched_subscription' then
      return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id);
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
    or p_offer_code <> 'studio_access'
    or p_subscription_status not in ('active', 'trialing')
    or p_workspace_key is null
    or p_user_id is null
    or p_customer_id is null
    or p_subscription_id is null then
    return jsonb_build_object('status', projected_status, 'eventId', p_event_id);
  end if;

  update public.foundation_billing_accounts set
    access_plan = 'studio_access',
    subscription_status = p_subscription_status,
    paddle_subscription_id = p_subscription_id,
    subscription_cancel_at = null,
    last_subscription_event_at = p_occurred_at,
    updated_at = now()
  where workspace_key = p_workspace_key
    and user_id = p_user_id
    and paddle_customer_id = p_customer_id
    and access_plan = 'observer_access'
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

revoke execute on function public.apply_foundation_billing_event_v2(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) from service_role;
revoke all on function public.apply_foundation_billing_event_v3(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.apply_foundation_billing_event_v3(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) to service_role;

commit;
