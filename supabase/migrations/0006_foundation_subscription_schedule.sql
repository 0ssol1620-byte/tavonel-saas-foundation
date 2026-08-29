-- Preserve period-end cancellation state without revoking access before Paddle's
-- effective timestamp. Browser roles cannot read or mutate this projection.
begin;

alter table public.foundation_billing_accounts
  add column subscription_cancel_at timestamptz;

create or replace function public.apply_foundation_subscription_schedule(
  p_event_id text,
  p_workspace_key text,
  p_subscription_id text,
  p_subscription_cancel_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.foundation_billing_events%rowtype;
begin
  select * into v_event
    from public.foundation_billing_events
    where event_id = p_event_id
      and action = 'subscription'
      and workspace_key = p_workspace_key
      and subscription_id = p_subscription_id;

  if not found then
    raise exception 'billing_subscription_event_binding_invalid';
  end if;

  update public.foundation_billing_accounts
    set subscription_cancel_at = p_subscription_cancel_at,
        updated_at = now()
    where workspace_key = p_workspace_key
      and paddle_subscription_id = p_subscription_id
      and last_subscription_event_at = v_event.occurred_at;

  if not found then
    return jsonb_build_object('status', 'stale_subscription_schedule', 'eventId', p_event_id);
  end if;

  return jsonb_build_object('status', 'processed', 'eventId', p_event_id);
end;
$$;

revoke all on function public.apply_foundation_subscription_schedule(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_foundation_subscription_schedule(text, text, text, timestamptz)
  to service_role;

commit;
