-- Billing follows the customer-data gate: a subscription whose workspace may not process customer
-- sources is paused at Paddle before it can be charged again.
--
-- A consumed checkout binding settles renewals without reading the gate (v6), so nothing stopped
-- Paddle from renewing a subscription for a product the workspace can no longer use. The sweeper
-- in nextjs/lib/billing-gate-enforcement.ts reads the gate, verifies the provider subscription
-- against this account, and pauses it. This migration holds only its durable state:
--   * foundation_billing_gate_enforcements -- one row per subscription: a lease so concurrent runs
--     cannot both act, the last outcome, `checked_at` (which orders the next run, oldest first),
--     and the pause intent written *before* the provider is called;
--   * foundation_billing_gate_enforcement_events -- append-only audit of outcome changes, every
--     intent and every pause attempt. Codes and provider status only; no content, card, email or
--     secret;
--   * foundation_billing_notices -- one in-product notice per pause this sweeper caused, keyed by
--     Paddle's `paused_at`, for the workspace UI. No email is sent from here.
--
-- A notice is created only from this sweeper's own recorded intent, and only when Paddle's
-- `paused_at` falls in that intent's window. A subscription the customer paused themselves is
-- never attributed to enforcement. An intent that has not been resolved keeps its subscription a
-- candidate even after the webhook projects `paused`, so a lost acknowledgement after a real pause
-- is replayed from Paddle's own state instead of losing the notice.
--
-- The account projection is never written here: `paused` reaches foundation_billing_accounts only
-- through the signed Paddle webhook, exactly as any other status change does.
begin;

create table public.foundation_billing_gate_enforcements (
  paddle_subscription_id text primary key check (paddle_subscription_id ~ '^sub_[a-z0-9]{26}$'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  user_id uuid not null,
  claim_token uuid,
  lease_until timestamptz,
  checked_at timestamptz not null,
  last_outcome text,
  last_gate_code text,
  last_error_code text,
  next_billed_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  pause_intent_at timestamptz,
  pause_intent_reason text
    check (pause_intent_reason in ('processing_authorization_refused', 'processing_authorization_lapsed')),
  -- Set when the pause lands in the subscription's first, fresh billing period. It asks an
  -- operator to review a refund; it is not a statement that one was issued.
  pause_intent_refund_review boolean not null default false,
  refund_review_required boolean not null default false,
  updated_at timestamptz not null default now(),
  check ((claim_token is null) = (lease_until is null)),
  check ((pause_intent_at is null) = (pause_intent_reason is null))
);

create table public.foundation_billing_gate_enforcement_events (
  id bigint generated always as identity primary key,
  paddle_subscription_id text not null,
  workspace_key text not null,
  outcome text not null,
  gate_code text,
  provider_status text,
  error_code text,
  next_billed_at timestamptz,
  refund_review_required boolean not null default false,
  recorded_at timestamptz not null default now()
);

create table public.foundation_billing_notices (
  id uuid primary key default gen_random_uuid(),
  receipt_key text not null unique,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  user_id uuid not null,
  kind text not null check (kind = 'subscription_paused_processing_gate'),
  reason text not null check (reason in ('processing_authorization_refused', 'processing_authorization_lapsed')),
  paddle_subscription_id text not null,
  refund_review_required boolean not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index foundation_billing_notices_account_idx
  on public.foundation_billing_notices (workspace_key, user_id, created_at desc);

alter table public.foundation_billing_gate_enforcements enable row level security;
alter table public.foundation_billing_gate_enforcement_events enable row level security;
alter table public.foundation_billing_notices enable row level security;
revoke all on public.foundation_billing_gate_enforcements from public, anon, authenticated, service_role;
revoke all on public.foundation_billing_gate_enforcement_events from public, anon, authenticated, service_role;
revoke all on public.foundation_billing_notices from public, anon, authenticated, service_role;

-- Subscriptions that can still be charged, plus any whose pause intent is unresolved (whatever the
-- projection now says), least recently checked first, excluding held leases.
create or replace function public.list_foundation_billing_gate_candidates(p_limit integer)
returns table (
  workspace_key text, user_id uuid, paddle_subscription_id text,
  paddle_customer_id text, subscription_status text, pause_intent_pending boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select account.workspace_key, account.user_id, account.paddle_subscription_id,
    account.paddle_customer_id, account.subscription_status,
    coalesce(enforcement.pause_intent_at is not null, false)
  from public.foundation_billing_accounts account
  left join public.foundation_billing_gate_enforcements enforcement
    on enforcement.paddle_subscription_id = account.paddle_subscription_id
  where account.paddle_subscription_id ~ '^sub_[a-z0-9]{26}$'
    and account.paddle_customer_id ~ '^ctm_[a-z0-9]{26}$'
    and (account.subscription_status in ('active', 'trialing', 'past_due')
      or enforcement.pause_intent_at is not null)
    and (enforcement.lease_until is null or enforcement.lease_until < now())
  order by enforcement.checked_at asc nulls first, account.workspace_key asc
  limit least(greatest(coalesce(p_limit, 1), 1), 50);
$$;

create or replace function public.claim_foundation_billing_gate_enforcement(
  p_subscription_id text, p_workspace_key text, p_user_id uuid, p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_token uuid := gen_random_uuid();
begin
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'billing_gate_claim_invalid';
  end if;
  -- The account must still hold this subscription; a stale candidate is simply not claimed.
  perform 1 from public.foundation_billing_accounts account
    where account.workspace_key = p_workspace_key
      and account.user_id = p_user_id
      and account.paddle_subscription_id = p_subscription_id;
  if not found then
    return jsonb_build_object('status', 'not_candidate');
  end if;
  insert into public.foundation_billing_gate_enforcements as enforcement (
    paddle_subscription_id, workspace_key, user_id, claim_token, lease_until, checked_at
  ) values (
    p_subscription_id, p_workspace_key, p_user_id, v_token,
    v_now + make_interval(secs => p_lease_seconds), v_now
  )
  on conflict (paddle_subscription_id) do update
    set claim_token = excluded.claim_token,
        lease_until = excluded.lease_until,
        checked_at = excluded.checked_at,
        updated_at = v_now
    where enforcement.workspace_key = excluded.workspace_key
      and enforcement.user_id = excluded.user_id
      and (enforcement.lease_until is null or enforcement.lease_until < v_now);
  if not found then
    return jsonb_build_object('status', 'held');
  end if;
  return jsonb_build_object('status', 'claimed', 'claimToken', v_token);
end;
$$;

-- Written before the provider is called. Refused unless the caller still holds a live lease, so
-- the sweeper never pauses without a durable record that it is about to.
create or replace function public.mark_foundation_billing_gate_pause_intent(
  p_subscription_id text, p_claim_token uuid, p_reason text, p_refund_review boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.foundation_billing_gate_enforcements%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_reason is null
    or p_reason not in ('processing_authorization_refused', 'processing_authorization_lapsed')
    or p_refund_review is null then
    raise exception 'billing_gate_intent_invalid';
  end if;
  select * into v_row from public.foundation_billing_gate_enforcements
    where paddle_subscription_id = p_subscription_id for update;
  if not found or v_row.claim_token is distinct from p_claim_token or v_row.lease_until <= v_now then
    return jsonb_build_object('status', 'lease_lost');
  end if;
  update public.foundation_billing_gate_enforcements
    set pause_intent_at = v_now, pause_intent_reason = p_reason,
        pause_intent_refund_review = p_refund_review, updated_at = v_now
    where paddle_subscription_id = p_subscription_id;
  insert into public.foundation_billing_gate_enforcement_events (
    paddle_subscription_id, workspace_key, outcome, refund_review_required
  ) values (p_subscription_id, v_row.workspace_key, 'pause_intent', p_refund_review);
  return jsonb_build_object('status', 'intent_recorded');
end;
$$;

create or replace function public.record_foundation_billing_gate_enforcement(
  p_subscription_id text, p_claim_token uuid, p_outcome text, p_gate_code text,
  p_provider_status text, p_error_code text, p_next_billed_at timestamptz,
  p_provider_paused_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.foundation_billing_gate_enforcements%rowtype;
  v_now timestamptz := clock_timestamp();
  v_ours boolean;
  v_notice boolean := false;
  v_keep_intent boolean;
begin
  if p_outcome is null or p_outcome not in (
      'admitted', 'deferred_until_near_billing', 'paused', 'pause_failed', 'provider_not_found',
      'provider_read_failed', 'identity_mismatch', 'environment_mismatch', 'provider_paused',
      'provider_canceled', 'no_future_charge')
    or (p_gate_code is not null and p_gate_code !~ '^[A-Z0-9_]{1,64}$')
    or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{1,64}$')
    or (p_provider_status is not null
      and p_provider_status not in ('active', 'trialing', 'past_due', 'paused', 'canceled'))
    or (p_outcome = 'paused' and (p_provider_paused_at is null or p_provider_status is distinct from 'paused')) then
    raise exception 'billing_gate_record_invalid';
  end if;

  select * into v_row from public.foundation_billing_gate_enforcements
    where paddle_subscription_id = p_subscription_id for update;
  if not found or v_row.claim_token is distinct from p_claim_token then
    return jsonb_build_object('status', 'lease_lost');
  end if;
  if p_outcome = 'paused' and v_row.pause_intent_at is null then
    raise exception 'billing_gate_pause_without_intent';
  end if;

  -- Ours only if Paddle's own pause time falls inside the window our intent opened: a customer's
  -- pause, before or long after, is not enforcement and gets no enforcement notice.
  v_ours := p_outcome in ('paused', 'provider_paused')
    and v_row.pause_intent_at is not null
    and p_provider_paused_at >= v_row.pause_intent_at - interval '1 minute'
    and p_provider_paused_at <= v_row.pause_intent_at + interval '10 minutes';
  -- A failed or ambiguous pause keeps its intent, so a pause that did land is still found later.
  v_keep_intent := p_outcome in ('pause_failed', 'provider_read_failed') and v_row.pause_intent_at is not null;

  if p_outcome is distinct from v_row.last_outcome
    or p_outcome in ('paused', 'pause_failed', 'identity_mismatch') or v_ours then
    insert into public.foundation_billing_gate_enforcement_events (
      paddle_subscription_id, workspace_key, outcome, gate_code, provider_status, error_code,
      next_billed_at, refund_review_required
    ) values (
      p_subscription_id, v_row.workspace_key, p_outcome, p_gate_code, p_provider_status,
      p_error_code, p_next_billed_at, v_ours and v_row.pause_intent_refund_review
    );
  end if;

  if v_ours then
    insert into public.foundation_billing_notices (
      receipt_key, workspace_key, user_id, kind, reason, paddle_subscription_id, refund_review_required
    ) values (
      'gate-pause:' || p_subscription_id || ':'
        || to_char(p_provider_paused_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      v_row.workspace_key, v_row.user_id, 'subscription_paused_processing_gate',
      v_row.pause_intent_reason, p_subscription_id, v_row.pause_intent_refund_review
    ) on conflict (receipt_key) do nothing;
    v_notice := found;
  end if;

  update public.foundation_billing_gate_enforcements
    set claim_token = null,
        lease_until = null,
        last_outcome = p_outcome,
        last_gate_code = p_gate_code,
        last_error_code = p_error_code,
        next_billed_at = p_next_billed_at,
        failed_attempts = case when p_outcome in ('pause_failed', 'provider_read_failed')
          then failed_attempts + 1 else 0 end,
        refund_review_required = refund_review_required or (v_ours and pause_intent_refund_review),
        pause_intent_at = case when v_keep_intent then pause_intent_at end,
        pause_intent_reason = case when v_keep_intent then pause_intent_reason end,
        pause_intent_refund_review = v_keep_intent and pause_intent_refund_review,
        updated_at = v_now
    where paddle_subscription_id = p_subscription_id;

  return jsonb_build_object('status', 'recorded', 'noticeCreated', v_notice, 'attributed', v_ours);
end;
$$;

-- For the workspace UI: the caller's own notices, newest first. Codes only; copy lives in the UI.
create or replace function public.list_foundation_billing_notices(p_workspace_key text, p_user_id uuid)
returns table (
  id uuid, kind text, reason text, refund_review_required boolean,
  created_at timestamptz, acknowledged_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select notice.id, notice.kind, notice.reason, notice.refund_review_required,
    notice.created_at, notice.acknowledged_at
  from public.foundation_billing_notices notice
  where notice.workspace_key = p_workspace_key and notice.user_id = p_user_id
  order by notice.created_at desc
  limit 10;
$$;

revoke all on function public.list_foundation_billing_gate_candidates(integer) from public, anon, authenticated;
revoke all on function public.claim_foundation_billing_gate_enforcement(text, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.mark_foundation_billing_gate_pause_intent(text, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.record_foundation_billing_gate_enforcement(
  text, uuid, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.list_foundation_billing_notices(text, uuid) from public, anon, authenticated;
grant execute on function public.list_foundation_billing_gate_candidates(integer) to service_role;
grant execute on function public.claim_foundation_billing_gate_enforcement(text, text, uuid, integer)
  to service_role;
grant execute on function public.mark_foundation_billing_gate_pause_intent(text, uuid, text, boolean)
  to service_role;
grant execute on function public.record_foundation_billing_gate_enforcement(
  text, uuid, text, text, text, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.list_foundation_billing_notices(text, uuid) to service_role;

commit;
