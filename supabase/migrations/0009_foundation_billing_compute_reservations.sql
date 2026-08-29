-- Apply only to the dedicated Foundation Supabase project after target confirmation.
begin;

create type public.foundation_compute_state as enum (
  'reserved',
  'settled',
  'released',
  'operator_review',
  'expired'
);

create table public.foundation_compute_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  workspace_key text not null references public.foundation_billing_accounts(workspace_key) on delete restrict,
  document_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  reserved_credits integer not null check (reserved_credits = 2),
  settled_credits integer check (settled_credits between 0 and 2),
  state public.foundation_compute_state not null default 'reserved',
  reason_code text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index foundation_compute_reservations_workspace_created_idx
  on public.foundation_compute_reservations (workspace_key, created_at desc);

alter table public.foundation_compute_reservations enable row level security;
revoke all on public.foundation_compute_reservations from public, anon, authenticated;
grant select, insert, update on public.foundation_compute_reservations to service_role;

create or replace function public.reserve_foundation_compute(
  p_workspace_key text,
  p_document_id uuid,
  p_user_id uuid,
  p_reserved_credits integer default 2
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
  expires_at_value timestamptz;
  reservation_id_value uuid;
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_reserved_credits <> 2 then
    raise exception 'foundation_compute_reservation_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('foundation-compute:' || p_workspace_key, 0));

  for expired in
    select * from public.foundation_compute_reservations
    where workspace_key = p_workspace_key and state = 'reserved' and expires_at <= clock_timestamp()
    for update
  loop
    update public.foundation_billing_accounts
      set credit_balance = credit_balance + expired.reserved_credits, updated_at = now()
      where workspace_key = p_workspace_key;
    update public.foundation_compute_reservations
      set state = 'expired', settled_credits = 0, settled_at = now(), updated_at = now(),
          reason_code = 'CAPABILITY_EXPIRED'
      where reservation_id = expired.reservation_id;
  end loop;

  select * into existing from public.foundation_compute_reservations where document_id = p_document_id;
  if found then
    if existing.workspace_key <> p_workspace_key or existing.user_id <> p_user_id
      or existing.reserved_credits <> p_reserved_credits then
      raise exception 'foundation_compute_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'reservationId', existing.reservation_id,
      'documentId', existing.document_id,
      'state', existing.state,
      'expiresAt', existing.expires_at,
      'reservedCredits', existing.reserved_credits,
      'idempotentReplay', true
    );
  end if;

  select * into account from public.foundation_billing_accounts
    where workspace_key = p_workspace_key for update;
  if not found or account.user_id <> p_user_id then raise exception 'foundation_billing_account_required'; end if;
  if account.access_plan <> 'studio_access' or account.subscription_status not in ('active', 'trialing') then
    raise exception 'foundation_studio_subscription_required';
  end if;
  if account.billing_hold then raise exception 'foundation_billing_hold'; end if;
  if account.credit_balance < p_reserved_credits then raise exception 'foundation_credits_required'; end if;

  expires_at_value := clock_timestamp() + interval '10 minutes';
  reservation_id_value := gen_random_uuid();
  insert into public.foundation_compute_reservations (
    reservation_id, workspace_key, document_id, user_id, reserved_credits, expires_at
  ) values (
    reservation_id_value, p_workspace_key, p_document_id, p_user_id, p_reserved_credits, expires_at_value
  );
  update public.foundation_billing_accounts
    set credit_balance = credit_balance - p_reserved_credits, updated_at = now()
    where workspace_key = p_workspace_key;

  return jsonb_build_object(
    'reservationId', reservation_id_value,
    'documentId', p_document_id,
    'state', 'reserved',
    'expiresAt', expires_at_value,
    'reservedCredits', p_reserved_credits,
    'idempotentReplay', false
  );
end;
$$;

create or replace function public.settle_foundation_compute(
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
  target_state public.foundation_compute_state;
  balance_delta integer;
begin
  if p_outcome not in ('settled', 'operator_review', 'released')
    or p_actual_credits < 0 or p_actual_credits > 2
    or (p_outcome = 'released' and p_actual_credits <> 0)
    or (p_outcome <> 'released' and p_actual_credits = 0)
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
      return jsonb_build_object('status', 'duplicate', 'reservationId', reservation.reservation_id);
    end if;
    raise exception 'foundation_compute_settlement_conflict';
  end if;

  select * into account from public.foundation_billing_accounts
    where workspace_key = p_workspace_key for update;
  if not found or account.user_id <> reservation.user_id then raise exception 'foundation_billing_account_required'; end if;

  balance_delta := case
    when reservation.state = 'reserved' then reservation.reserved_credits - p_actual_credits
    else -p_actual_credits
  end;
  update public.foundation_billing_accounts
    set credit_balance = credit_balance + balance_delta,
        billing_hold = billing_hold or credit_balance + balance_delta < 0,
        updated_at = now()
    where workspace_key = p_workspace_key;
  update public.foundation_compute_reservations
    set state = target_state, settled_credits = p_actual_credits, reason_code = p_reason_code,
        settled_at = now(), updated_at = now()
    where reservation_id = reservation.reservation_id;

  return jsonb_build_object(
    'status', 'processed',
    'reservationId', reservation.reservation_id,
    'state', target_state,
    'settledCredits', p_actual_credits
  );
end;
$$;

create or replace function public.apply_foundation_billing_event_v2(
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
declare existing public.foundation_billing_events%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('foundation-billing-event:' || p_event_id, 0));
  select * into existing from public.foundation_billing_events where event_id = p_event_id;
  if found then
    if existing.event_type <> p_event_type or existing.occurred_at <> p_occurred_at
      or existing.payload_sha256 <> p_payload_sha256 or existing.action <> p_action then
      raise exception 'foundation_billing_event_id_conflict';
    end if;
    return jsonb_build_object('status', 'duplicate', 'eventId', p_event_id);
  end if;
  return public.apply_foundation_billing_event(
    p_event_id, p_event_type, p_occurred_at, p_payload_sha256, p_action,
    p_workspace_key, p_user_id, p_offer_code, p_transaction_id, p_customer_id,
    p_subscription_id, p_subscription_status, p_credit_delta, p_adjustment_id
  );
end;
$$;

revoke execute on function public.apply_foundation_billing_event(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) from service_role;
revoke all on function public.reserve_foundation_compute(text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.settle_foundation_compute(text, uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.apply_foundation_billing_event_v2(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.reserve_foundation_compute(text, uuid, uuid, integer) to service_role;
grant execute on function public.settle_foundation_compute(text, uuid, text, integer, text) to service_role;
grant execute on function public.apply_foundation_billing_event_v2(
  text, text, timestamptz, text, text, text, uuid, text, text, text, text, text, integer, text
) to service_role;

commit;
