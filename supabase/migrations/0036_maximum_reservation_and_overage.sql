-- Separate included standard usage from maximum reservation capacity. Standard units are held
-- from the allowance; observed units above that hold are accrued as explicit PAYG overage and
-- can never exceed the preflight maximum.
begin;

alter table public.foundation_billing_accounts
  add column if not exists overage_enabled boolean not null default false,
  add column if not exists overage_units integer not null default 0 check (overage_units >= 0),
  add column if not exists lifetime_overage_units integer not null default 0 check (lifetime_overage_units >= 0);

alter table public.foundation_compute_reservations
  add column if not exists maximum_credits integer;
update public.foundation_compute_reservations
  set maximum_credits = reserved_credits where maximum_credits is null;
alter table public.foundation_compute_reservations
  alter column maximum_credits set not null,
  drop constraint if exists foundation_compute_reservations_settled_units_check,
  add constraint foundation_compute_reservations_maximum_units_check
    check (maximum_credits between reserved_credits and 60000),
  add constraint foundation_compute_reservations_settled_units_check
    check (settled_credits between 0 and maximum_credits);

create or replace function public.foundation_enable_subscription_overage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'allowance' then
    update public.foundation_billing_accounts
      set overage_enabled = true, updated_at = now()
      where workspace_key = new.workspace_key;
  elsif new.kind = 'reversed' and new.reversal_of_transaction_id is not null then
    update public.foundation_billing_accounts
      set overage_enabled = false, updated_at = now()
      where workspace_key = new.workspace_key;
  end if;
  return new;
end;
$$;

drop trigger if exists foundation_subscription_overage_trigger on public.foundation_credit_ledger;
create trigger foundation_subscription_overage_trigger
after insert on public.foundation_credit_ledger
for each row execute function public.foundation_enable_subscription_overage();

update public.foundation_billing_accounts account
  set overage_enabled = true, updated_at = now()
  where exists (
    select 1 from public.foundation_credit_ledger ledger
    where ledger.workspace_key = account.workspace_key and ledger.kind = 'allowance'
  ) and account.billing_hold = false;

create or replace function public.reserve_foundation_compute_v2(
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
      'idempotentReplay', true
    );
  end if;

  select * into account from public.foundation_billing_accounts
    where workspace_key = p_workspace_key for update;
  if not found or account.user_id <> p_user_id then raise exception 'foundation_billing_account_required'; end if;
  if account.access_plan not in ('observer_access', 'studio_access')
    or account.subscription_status not in ('active', 'trialing') then
    raise exception 'foundation_subscription_required';
  end if;
  if account.billing_hold then raise exception 'foundation_billing_hold'; end if;
  if account.credit_balance < p_reserved_credits then raise exception 'foundation_credits_required'; end if;

  expires_at_value := clock_timestamp() + interval '10 minutes';
  reservation_id_value := gen_random_uuid();
  insert into public.foundation_compute_reservations (
    reservation_id, workspace_key, document_id, user_id, reserved_credits, maximum_credits, expires_at
  ) values (
    reservation_id_value, p_workspace_key, p_document_id, p_user_id,
    p_reserved_credits, p_maximum_credits, expires_at_value
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
    'maximumCredits', p_maximum_credits,
    'idempotentReplay', false
  );
end;
$$;

create or replace function public.settle_foundation_compute_v2(
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
  released_units integer;
  overage_delta integer;
begin
  if p_outcome not in ('settled', 'operator_review', 'released')
    or p_actual_credits < 0 or p_actual_credits > 60000
    or (p_outcome = 'released' and p_actual_credits <> 0)
    or p_reason_code !~ '^[A-Z0-9_]{3,80}$' then
    raise exception 'foundation_compute_settlement_invalid';
  end if;
  target_state := p_outcome::public.foundation_compute_state;
  perform pg_advisory_xact_lock(hashtextextended('foundation-compute:' || p_workspace_key, 0));
  select * into reservation from public.foundation_compute_reservations
    where workspace_key = p_workspace_key and document_id = p_document_id for update;
  if not found then raise exception 'foundation_compute_reservation_not_found'; end if;
  if p_actual_credits > reservation.maximum_credits then
    raise exception 'foundation_compute_maximum_charge_exceeded';
  end if;

  if reservation.state in ('settled', 'released', 'operator_review') then
    if reservation.state = target_state and reservation.settled_credits = p_actual_credits then
      return jsonb_build_object('status', 'duplicate', 'reservationId', reservation.reservation_id);
    end if;
    raise exception 'foundation_compute_settlement_conflict';
  end if;

  select * into account from public.foundation_billing_accounts
    where workspace_key = p_workspace_key for update;
  if not found or account.user_id <> reservation.user_id then raise exception 'foundation_billing_account_required'; end if;
  overage_delta := greatest(0, p_actual_credits - reservation.reserved_credits);
  if overage_delta > 0 and (account.overage_enabled = false or account.billing_hold) then
    raise exception 'foundation_compute_overage_not_enabled';
  end if;
  released_units := greatest(0, reservation.reserved_credits - p_actual_credits);
  update public.foundation_billing_accounts
    set credit_balance = credit_balance + released_units,
        overage_units = overage_units + overage_delta,
        lifetime_overage_units = lifetime_overage_units + overage_delta,
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
    'settledCredits', p_actual_credits,
    'reservedCredits', reservation.reserved_credits,
    'maximumCredits', reservation.maximum_credits,
    'releasedCredits', released_units,
    'overageCredits', overage_delta
  );
end;
$$;

revoke all on function public.reserve_foundation_compute_v2(text, uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.settle_foundation_compute_v2(text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_foundation_compute_v2(text, uuid, uuid, integer, integer) to service_role;
grant execute on function public.settle_foundation_compute_v2(text, uuid, text, integer, text) to service_role;

commit;
