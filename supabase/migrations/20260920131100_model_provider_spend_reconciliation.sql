-- Preserve paid-provider reservations whose outcome is unknown until durable evidence can
-- reconcile the actual usage. Pending rows retain the full hold and cannot expire or dispatch
-- again; reconciliation is atomic and idempotent.
begin;

create table public.model_provider_spend_reconciliations (
  reservation_id uuid primary key
    references public.model_provider_spend_reservations(reservation_id),
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  status text not null check (status in ('pending', 'resolved')),
  pending_reason_code text not null check (pending_reason_code ~ '^[A-Z0-9_]{3,80}$'),
  original_expires_at timestamptz not null,
  requested_at timestamptz not null default clock_timestamp(),
  resolved_outcome text check (resolved_outcome in ('settled', 'released')),
  actual_units bigint check (actual_units between 0 and 1000000000),
  resolution_reason_code text check (resolution_reason_code ~ '^[A-Z0-9_]{3,80}$'),
  resolved_at timestamptz,
  check ((status = 'pending' and resolved_outcome is null and actual_units is null
          and resolution_reason_code is null and resolved_at is null) or
         (status = 'resolved' and resolved_outcome is not null and actual_units is not null
          and resolution_reason_code is not null and resolved_at is not null)),
  check (resolved_outcome <> 'released' or actual_units = 0)
);

alter table public.model_provider_spend_reservations
  add column reconciliation_pending boolean not null default false;

-- A pending reservation still counts toward spend because its state remains reserved, but a null
-- expiry removes it from running-provider concurrency and from automatic expiry. Reconciliation
-- restores the original expiry while atomically entering a terminal state.
do $$
declare
  v_constraint_name text;
begin
  select c.conname into v_constraint_name
    from pg_constraint c
   where c.conrelid = 'public.model_provider_spend_reservations'::regclass
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%admitted_at%'
     and pg_get_constraintdef(c.oid) like '%expires_at%'
     and pg_get_constraintdef(c.oid) like '%queued%';
  if v_constraint_name is null then
    raise exception 'model_provider_reservation_lifecycle_constraint_not_found';
  end if;
  execute format('alter table public.model_provider_spend_reservations drop constraint %I',
    v_constraint_name);
end;
$$;
alter table public.model_provider_spend_reservations
  add constraint model_provider_spend_reservation_lifecycle_v2 check (
    (state in ('queued', 'rejected') and admitted_at is null and expires_at is null
      and not reconciliation_pending) or
    (state not in ('queued', 'rejected') and admitted_at is not null and
      ((expires_at is not null and not reconciliation_pending) or
       (state = 'reserved' and expires_at is null and reconciliation_pending)))
  );

alter table public.model_provider_spend_reconciliations enable row level security;
revoke all on public.model_provider_spend_reconciliations from public, anon, authenticated;
grant select on public.model_provider_spend_reconciliations to service_role;

create function public.guard_pending_model_provider_reconciliation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.state = 'reserved' and new.state in ('settled', 'released', 'expired')
    and exists (
      select 1 from public.model_provider_spend_reconciliations r
       where r.reservation_id = old.reservation_id and r.status = 'pending'
    )
    and current_setting('app.model_provider_reconciliation', true)
          is distinct from old.reservation_id::text then
    raise exception 'model_provider_reconciliation_required';
  end if;
  return new;
end;
$$;

create trigger model_provider_spend_pending_reconciliation_guard
  before update on public.model_provider_spend_reservations
  for each row execute function public.guard_pending_model_provider_reconciliation();

create function public.mark_model_provider_spend_indeterminate_v1(
  p_tenant_id text,
  p_reservation_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_reservation public.model_provider_spend_reservations%rowtype;
  v_reconciliation public.model_provider_spend_reconciliations%rowtype;
  v_restored boolean := false;
begin
  if p_tenant_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or p_reason_code !~ '^[A-Z0-9_]{3,80}$' then
    raise exception 'model_provider_reconciliation_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:tenant:' || p_tenant_id, 0));

  select * into v_reservation from public.model_provider_spend_reservations
   where reservation_id = p_reservation_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'model_provider_reservation_not_found'; end if;

  select * into v_reconciliation from public.model_provider_spend_reconciliations
   where reservation_id = p_reservation_id for update;
  if found then
    if v_reconciliation.status = 'pending' then
      return jsonb_build_object('status', 'duplicate', 'reservationId', p_reservation_id,
        'state', v_reservation.state, 'reconciliationStatus', 'pending',
        'reservedUnits', v_reservation.reserved_units,
        'reservedMicrousd', v_reservation.reserved_microusd);
    end if;
    raise exception 'model_provider_reconciliation_conflict';
  end if;

  -- A sweeper can race the callback exception. Restore its released hold because provider spend
  -- may already exist; accounting truth takes priority over staying below the configured breaker.
  if v_reservation.state = 'expired' then
    v_restored := true;
  elsif v_reservation.state <> 'reserved' then
    raise exception 'model_provider_reservation_not_active';
  end if;

  insert into public.model_provider_spend_reconciliations (
    reservation_id, tenant_id, status, pending_reason_code, original_expires_at
  ) values (p_reservation_id, p_tenant_id, 'pending', p_reason_code,
            v_reservation.expires_at);

  update public.model_provider_spend_reservations
     set state = 'reserved', expires_at = null, reconciliation_pending = true, settled_at = null,
         actual_units = null, actual_microusd = null, reason_code = p_reason_code
   where reservation_id = p_reservation_id;
  if v_restored then
    insert into public.model_provider_spend_ledger (
      reservation_id, tenant_id, entry_kind, reserved_delta_microusd,
      spent_delta_microusd, reason_code
    ) values (p_reservation_id, p_tenant_id, 'reserve', v_reservation.reserved_microusd,
              0, 'PROVIDER_OUTCOME_INDETERMINATE');
  end if;

  return jsonb_build_object('status', 'pending_reconciliation',
    'reservationId', p_reservation_id, 'state', 'reserved',
    'reconciliationStatus', 'pending', 'reservedUnits', v_reservation.reserved_units,
    'reservedMicrousd', v_reservation.reserved_microusd);
end;
$$;

create function public.reconcile_model_provider_spend_v1(
  p_tenant_id text,
  p_reservation_id uuid,
  p_outcome text,
  p_actual_units bigint,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_reservation public.model_provider_spend_reservations%rowtype;
  v_reconciliation public.model_provider_spend_reconciliations%rowtype;
  v_actual_cost bigint;
begin
  if p_tenant_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or p_outcome not in ('settled', 'released')
    or p_actual_units not between 0 and 1000000000
    or p_reason_code !~ '^[A-Z0-9_]{3,80}$'
    or (p_outcome = 'released' and p_actual_units <> 0) then
    raise exception 'model_provider_reconciliation_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:tenant:' || p_tenant_id, 0));

  select * into v_reservation from public.model_provider_spend_reservations
   where reservation_id = p_reservation_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'model_provider_reservation_not_found'; end if;
  select * into v_reconciliation from public.model_provider_spend_reconciliations
   where reservation_id = p_reservation_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'model_provider_reconciliation_not_found'; end if;

  if v_reconciliation.status = 'resolved' then
    if v_reconciliation.resolved_outcome = p_outcome
      and v_reconciliation.actual_units = p_actual_units then
      return jsonb_build_object('status', 'duplicate', 'reservationId', p_reservation_id,
        'state', v_reconciliation.resolved_outcome,
        'actualUnits', v_reconciliation.actual_units,
        'actualMicrousd', v_reconciliation.actual_units * v_reservation.unit_microusd,
        'reconciliationStatus', 'resolved');
    end if;
    raise exception 'model_provider_reconciliation_conflict';
  end if;
  if v_reservation.state <> 'reserved' then
    raise exception 'model_provider_reservation_not_active';
  end if;
  if p_actual_units > v_reservation.reserved_units then
    raise exception 'model_provider_reserved_cost_exceeded';
  end if;

  v_actual_cost := p_actual_units * v_reservation.unit_microusd;
  perform set_config('app.model_provider_reconciliation', p_reservation_id::text, true);
  update public.model_provider_spend_reservations
     set state = p_outcome, actual_units = p_actual_units, actual_microusd = v_actual_cost,
         reason_code = p_reason_code, settled_at = v_now,
         expires_at = v_reconciliation.original_expires_at, reconciliation_pending = false
   where reservation_id = p_reservation_id;
  insert into public.model_provider_spend_ledger (
    reservation_id, tenant_id, entry_kind, reserved_delta_microusd,
    spent_delta_microusd, reason_code
  ) values (p_reservation_id, p_tenant_id,
    case when p_outcome = 'settled' then 'settle' else 'release' end,
    -v_reservation.reserved_microusd, v_actual_cost, p_reason_code);
  update public.model_provider_spend_reconciliations
     set status = 'resolved', resolved_outcome = p_outcome, actual_units = p_actual_units,
         resolution_reason_code = p_reason_code, resolved_at = v_now
   where reservation_id = p_reservation_id;

  return jsonb_build_object('status', 'processed', 'reservationId', p_reservation_id,
    'state', p_outcome, 'actualUnits', p_actual_units, 'actualMicrousd', v_actual_cost,
    'refundedMicrousd', v_reservation.reserved_microusd - v_actual_cost,
    'reconciliationStatus', 'resolved');
end;
$$;

revoke all on function public.mark_model_provider_spend_indeterminate_v1(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_model_provider_spend_indeterminate_v1(text, uuid, text)
  to service_role;
revoke all on function public.reconcile_model_provider_spend_v1(text, uuid, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_model_provider_spend_v1(text, uuid, text, bigint, text)
  to service_role;
revoke execute on function public.guard_pending_model_provider_reconciliation()
  from public, anon, authenticated;

commit;
