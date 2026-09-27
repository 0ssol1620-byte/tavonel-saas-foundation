-- Read-only review of unresolved billing rejections for the operator CLI
-- (nextjs/scripts/billing/rejections-report.mjs, docs/runbooks/BILLING_REJECTION_REVIEW.md).
--
-- The table stays revoked from every API role. This definer function is the one read path: it
-- returns only unresolved rows, at most 50, and only the columns needed to find the event in
-- Paddle and decide repair versus refund. user_id, customer_id, binding_nonce and payload_sha256
-- are not returned. It writes nothing; closing a row stays a separate, explicit operator step.
begin;

create or replace function public.list_foundation_billing_event_rejections(p_limit integer default 25)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'unresolvedTotal', (
      select count(*) from public.foundation_billing_event_rejections where resolved_at is null
    ),
    'oldestRecordedAt', (
      select min(recorded_at) from public.foundation_billing_event_rejections where resolved_at is null
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventId', r.event_id,
        'eventType', left(r.event_type, 64),
        'occurredAt', r.occurred_at,
        'recordedAt', r.recorded_at,
        'action', left(r.action, 32),
        'reason', left(r.reason, 80),
        'workspaceKey', left(r.workspace_key, 32),
        'offerCode', left(r.offer_code, 32),
        'priceId', left(r.price_id, 64),
        'transactionId', left(r.transaction_id, 64),
        'subscriptionId', left(r.subscription_id, 64)
      ) order by r.recorded_at, r.event_id)
      from (
        select * from public.foundation_billing_event_rejections
        where resolved_at is null
        order by recorded_at, event_id
        limit least(greatest(coalesce(p_limit, 25), 1), 50)
      ) r
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.list_foundation_billing_event_rejections(integer)
  from public, anon, authenticated;
grant execute on function public.list_foundation_billing_event_rejections(integer) to service_role;

commit;
