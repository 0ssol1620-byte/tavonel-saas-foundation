-- B12: durable, fail-closed model-provider spend control.
-- Prices, global and tenant budgets, reservations, refunds, and fair admission are committed in
-- one database transaction before a paid provider call may begin. No seed price or budget is
-- supplied: an unpriced model or an unconfigured accounting window must remain unavailable.
begin;

create table public.model_provider_prices (
  price_id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$'),
  meter text not null check (meter ~ '^[a-z][a-z0-9_]{1,47}$'),
  price_version text not null check (price_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$'),
  unit_microusd bigint not null check (unit_microusd between 1 and 1000000000),
  currency text not null default 'USD' check (currency = 'USD'),
  effective_from timestamptz not null,
  effective_until timestamptz,
  enabled boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  check (effective_until is null or effective_until > effective_from),
  unique (provider, model, meter, price_version)
);

create index model_provider_prices_lookup_idx
  on public.model_provider_prices (provider, model, meter, effective_from desc)
  where enabled;

create table public.model_provider_spend_budgets (
  budget_id uuid primary key default gen_random_uuid(),
  scope_kind text not null check (scope_kind in ('global', 'tenant')),
  tenant_id text,
  period_start timestamptz not null,
  period_end timestamptz not null,
  spend_limit_microusd bigint not null check (spend_limit_microusd > 0),
  concurrency_limit integer not null check (concurrency_limit between 1 and 10000),
  enabled boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  check (period_end > period_start),
  check ((scope_kind = 'global' and tenant_id is null) or
         (scope_kind = 'tenant' and tenant_id ~ '^[A-Za-z0-9_-]{1,80}$'))
);

create index model_provider_spend_budgets_active_idx
  on public.model_provider_spend_budgets (scope_kind, tenant_id, period_start, period_end)
  where enabled;

create table public.model_provider_spend_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  request_key text not null check (request_key ~ '^[A-Za-z0-9._~-]{8,128}$'),
  request_digest text not null check (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  provider text not null,
  model text not null,
  meter text not null,
  price_id uuid not null references public.model_provider_prices(price_id),
  price_version text not null,
  unit_microusd bigint not null check (unit_microusd > 0),
  reserved_units bigint not null check (reserved_units > 0),
  reserved_microusd bigint not null check (reserved_microusd > 0),
  actual_units bigint check (actual_units is null or actual_units >= 0),
  actual_microusd bigint check (actual_microusd is null or actual_microusd >= 0),
  state text not null check (state in ('queued', 'reserved', 'settled', 'released', 'expired', 'rejected')),
  reason_code text,
  requested_at timestamptz not null default clock_timestamp(),
  admitted_at timestamptz,
  expires_at timestamptz,
  settled_at timestamptz,
  unique (tenant_id, request_key),
  check ((state in ('queued', 'rejected') and admitted_at is null and expires_at is null) or
         (state not in ('queued', 'rejected') and admitted_at is not null and expires_at is not null)),
  check (reserved_microusd = reserved_units * unit_microusd),
  check (actual_microusd is null or actual_microusd = actual_units * unit_microusd),
  check (actual_units is null or actual_units <= reserved_units)
);

create index model_provider_spend_reservations_active_idx
  on public.model_provider_spend_reservations (tenant_id, state, expires_at);
create index model_provider_spend_reservations_queue_idx
  on public.model_provider_spend_reservations (state, requested_at, reservation_id);

create table public.model_provider_spend_ledger (
  entry_id bigint generated always as identity primary key,
  reservation_id uuid not null references public.model_provider_spend_reservations(reservation_id),
  tenant_id text not null,
  entry_kind text not null check (entry_kind in ('reserve', 'settle', 'release', 'expire')),
  reserved_delta_microusd bigint not null,
  spent_delta_microusd bigint not null,
  reason_code text not null check (reason_code ~ '^[A-Z0-9_]{3,80}$'),
  created_at timestamptz not null default clock_timestamp(),
  check ((entry_kind = 'reserve' and reserved_delta_microusd > 0 and spent_delta_microusd = 0) or
         (entry_kind in ('release', 'expire') and reserved_delta_microusd < 0 and spent_delta_microusd = 0) or
         (entry_kind = 'settle' and reserved_delta_microusd < 0 and spent_delta_microusd >= 0))
);

create index model_provider_spend_ledger_window_idx
  on public.model_provider_spend_ledger (created_at, tenant_id);

create table public.model_provider_tenant_turns (
  tenant_id text primary key check (tenant_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  last_admitted_at timestamptz not null
);

alter table public.model_provider_prices enable row level security;
alter table public.model_provider_spend_budgets enable row level security;
alter table public.model_provider_spend_reservations enable row level security;
alter table public.model_provider_spend_ledger enable row level security;
alter table public.model_provider_tenant_turns enable row level security;
revoke all on public.model_provider_prices, public.model_provider_spend_budgets,
  public.model_provider_spend_reservations, public.model_provider_spend_ledger,
  public.model_provider_tenant_turns from public, anon, authenticated;
grant select on public.model_provider_prices, public.model_provider_spend_budgets,
  public.model_provider_spend_reservations, public.model_provider_spend_ledger,
  public.model_provider_tenant_turns to service_role;

create function public.reject_model_provider_ledger_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'model_provider_ledger_immutable';
end;
$$;
create trigger model_provider_spend_ledger_immutable
  before update or delete on public.model_provider_spend_ledger
  for each row execute function public.reject_model_provider_ledger_mutation();

create function public.reserve_model_provider_spend_v1(
  p_tenant_id text,
  p_request_key text,
  p_request_digest text,
  p_provider text,
  p_model text,
  p_meter text,
  p_reserved_units bigint,
  p_reservation_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_price public.model_provider_prices%rowtype;
  v_global public.model_provider_spend_budgets%rowtype;
  v_tenant public.model_provider_spend_budgets%rowtype;
  v_existing public.model_provider_spend_reservations%rowtype;
  v_reservation public.model_provider_spend_reservations%rowtype;
  v_price_count integer;
  v_global_count integer;
  v_tenant_count integer;
  v_reserved_cost bigint;
  v_global_committed bigint;
  v_tenant_committed bigint;
  v_global_running integer;
  v_tenant_running integer;
  v_next_tenant text;
  v_replay boolean := false;
begin
  if p_tenant_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or p_request_key !~ '^[A-Za-z0-9._~-]{8,128}$'
    or p_request_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_provider !~ '^[a-z0-9][a-z0-9._-]{1,63}$'
    or p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$'
    or p_meter !~ '^[a-z][a-z0-9_]{1,47}$'
    or p_reserved_units not between 1 and 1000000000
    or p_reservation_seconds not between 1 and 900 then
    raise exception 'model_provider_reservation_invalid';
  end if;

  -- One lock orders every global spend/concurrency decision. The tenant lock keeps replays and
  -- tenant totals deterministic without relying on application-process state.
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:tenant:' || p_tenant_id, 0));

  -- Release expired holds before measuring either breaker. The negative ledger entry is the
  -- refund receipt; no in-place balance can drift away from the append-only accounting history.
  with expired as (
    update public.model_provider_spend_reservations
       set state = 'expired', reason_code = 'RESERVATION_EXPIRED', settled_at = v_now
     where state = 'reserved' and expires_at <= v_now
     returning reservation_id, tenant_id, reserved_microusd
  )
  insert into public.model_provider_spend_ledger (
    reservation_id, tenant_id, entry_kind, reserved_delta_microusd,
    spent_delta_microusd, reason_code
  ) select reservation_id, tenant_id, 'expire', -reserved_microusd, 0,
           'RESERVATION_EXPIRED' from expired;

  update public.model_provider_spend_reservations
     set state = 'expired', reason_code = 'QUEUE_EXPIRED', settled_at = v_now
   where state = 'queued' and requested_at <= v_now - interval '15 minutes';

  select * into v_existing
    from public.model_provider_spend_reservations
   where tenant_id = p_tenant_id and request_key = p_request_key
   for update;
  if found then
    if v_existing.request_digest <> p_request_digest or v_existing.provider <> p_provider
      or v_existing.model <> p_model or v_existing.meter <> p_meter
      or v_existing.reserved_units <> p_reserved_units then
      raise exception 'model_provider_idempotency_conflict';
    end if;
    if v_existing.state <> 'queued' then
      return jsonb_build_object(
        'status', v_existing.state, 'reservationId', v_existing.reservation_id,
        'tenantId', v_existing.tenant_id, 'requestKey', v_existing.request_key,
        'requestDigest', v_existing.request_digest, 'provider', v_existing.provider,
        'model', v_existing.model, 'meter', v_existing.meter,
        'priceVersion', v_existing.price_version, 'unitMicrousd', v_existing.unit_microusd,
        'reservedUnits', v_existing.reserved_units,
        'reservedMicrousd', v_existing.reserved_microusd,
        'expiresAt', v_existing.expires_at, 'idempotentReplay', true
      );
    end if;
    -- A queued replay must re-enter admission. Returning it immediately would create a queue
    -- whose members can never advance when a slot or a fair tenant turn becomes available.
    v_reservation := v_existing;
    v_replay := true;
  end if;

  select count(*) into v_price_count from public.model_provider_prices
   where provider = p_provider and model = p_model and meter = p_meter and enabled
     and effective_from <= v_now and (effective_until is null or effective_until > v_now);
  if v_price_count <> 1 then raise exception 'model_provider_price_unavailable'; end if;
  select * into v_price from public.model_provider_prices
   where provider = p_provider and model = p_model and meter = p_meter and enabled
     and effective_from <= v_now and (effective_until is null or effective_until > v_now);
  if v_replay and v_price.price_id <> v_reservation.price_id then
    raise exception 'model_provider_price_unavailable';
  end if;

  select count(*) into v_global_count from public.model_provider_spend_budgets
   where scope_kind = 'global' and tenant_id is null and enabled
     and period_start <= v_now and period_end > v_now;
  select count(*) into v_tenant_count from public.model_provider_spend_budgets
   where scope_kind = 'tenant' and tenant_id = p_tenant_id and enabled
     and period_start <= v_now and period_end > v_now;
  if v_global_count <> 1 or v_tenant_count <> 1 then
    raise exception 'model_provider_accounting_unavailable';
  end if;
  select * into v_global from public.model_provider_spend_budgets
   where scope_kind = 'global' and tenant_id is null and enabled
     and period_start <= v_now and period_end > v_now;
  select * into v_tenant from public.model_provider_spend_budgets
   where scope_kind = 'tenant' and tenant_id = p_tenant_id and enabled
     and period_start <= v_now and period_end > v_now;

  if p_reserved_units > 9223372036854775807 / v_price.unit_microusd then
    raise exception 'model_provider_reservation_invalid';
  end if;
  v_reserved_cost := p_reserved_units * v_price.unit_microusd;

  if not v_replay then
    insert into public.model_provider_spend_reservations (
      tenant_id, request_key, request_digest, provider, model, meter, price_id,
      price_version, unit_microusd, reserved_units, reserved_microusd, state
    ) values (
      p_tenant_id, p_request_key, p_request_digest, p_provider, p_model, p_meter,
      v_price.price_id, v_price.price_version, v_price.unit_microusd,
      p_reserved_units, v_reserved_cost, 'queued'
    ) returning * into v_reservation;
  end if;

  -- Fair queue: only each tenant's oldest request competes, and the tenant least recently
  -- admitted gets the next turn. A busy tenant therefore cannot occupy every newly freed slot.
  with tenant_heads as (
    select distinct on (r.tenant_id) r.tenant_id, r.requested_at, r.reservation_id
      from public.model_provider_spend_reservations r
     where r.state = 'queued'
     order by r.tenant_id, r.requested_at, r.reservation_id
  )
  select h.tenant_id into v_next_tenant
    from tenant_heads h
    left join public.model_provider_tenant_turns t on t.tenant_id = h.tenant_id
   order by t.last_admitted_at nulls first, h.requested_at, h.reservation_id
   limit 1;
  if v_next_tenant is distinct from p_tenant_id then
    return jsonb_build_object('status', 'queued', 'reservationId', v_reservation.reservation_id,
      'tenantId', p_tenant_id, 'requestKey', p_request_key, 'requestDigest', p_request_digest,
      'provider', p_provider, 'model', p_model, 'meter', p_meter,
      'priceVersion', v_price.price_version, 'unitMicrousd', v_price.unit_microusd,
      'reservedUnits', p_reserved_units, 'reservedMicrousd', v_reserved_cost,
      'expiresAt', null, 'idempotentReplay', v_replay);
  end if;

  -- Attribute cost to the period in which dispatch was admitted. Summing ledger entry timestamps
  -- would let a reservation near a boundary release in the next period and create a false
  -- negative balance there.
  select coalesce(sum(case when state = 'reserved' then reserved_microusd
                           when state = 'settled' then actual_microusd else 0 end), 0)
    into v_global_committed from public.model_provider_spend_reservations
   where admitted_at >= v_global.period_start and admitted_at < v_global.period_end;
  select coalesce(sum(case when state = 'reserved' then reserved_microusd
                           when state = 'settled' then actual_microusd else 0 end), 0)
    into v_tenant_committed from public.model_provider_spend_reservations
   where tenant_id = p_tenant_id and admitted_at >= v_tenant.period_start
     and admitted_at < v_tenant.period_end;
  if v_global_committed + v_reserved_cost > v_global.spend_limit_microusd then
    if v_replay then
      update public.model_provider_spend_reservations set state = 'rejected',
        reason_code = 'GLOBAL_SPEND_BREAKER_OPEN', settled_at = v_now
       where reservation_id = v_reservation.reservation_id;
      return jsonb_build_object('status', 'rejected',
        'code', 'MODEL_PROVIDER_GLOBAL_SPEND_BREAKER_OPEN',
        'reservationId', v_reservation.reservation_id, 'tenantId', p_tenant_id,
        'requestKey', p_request_key, 'requestDigest', p_request_digest);
    end if;
    raise exception 'model_provider_global_spend_breaker_open';
  end if;
  if v_tenant_committed + v_reserved_cost > v_tenant.spend_limit_microusd then
    if v_replay then
      update public.model_provider_spend_reservations set state = 'rejected',
        reason_code = 'TENANT_SPEND_BREAKER_OPEN', settled_at = v_now
       where reservation_id = v_reservation.reservation_id;
      return jsonb_build_object('status', 'rejected',
        'code', 'MODEL_PROVIDER_TENANT_SPEND_BREAKER_OPEN',
        'reservationId', v_reservation.reservation_id, 'tenantId', p_tenant_id,
        'requestKey', p_request_key, 'requestDigest', p_request_digest);
    end if;
    raise exception 'model_provider_tenant_spend_breaker_open';
  end if;

  select count(*) into v_global_running from public.model_provider_spend_reservations
   where state = 'reserved' and expires_at > v_now;
  select count(*) into v_tenant_running from public.model_provider_spend_reservations
   where tenant_id = p_tenant_id and state = 'reserved' and expires_at > v_now;
  if v_global_running >= v_global.concurrency_limit
    or v_tenant_running >= v_tenant.concurrency_limit then
    return jsonb_build_object('status', 'queued', 'reservationId', v_reservation.reservation_id,
      'tenantId', p_tenant_id, 'requestKey', p_request_key, 'requestDigest', p_request_digest,
      'provider', p_provider, 'model', p_model, 'meter', p_meter,
      'priceVersion', v_price.price_version, 'unitMicrousd', v_price.unit_microusd,
      'reservedUnits', p_reserved_units, 'reservedMicrousd', v_reserved_cost,
      'expiresAt', null, 'idempotentReplay', v_replay);
  end if;

  update public.model_provider_spend_reservations
     set state = 'reserved', admitted_at = v_now,
         expires_at = v_now + make_interval(secs => p_reservation_seconds)
   where reservation_id = v_reservation.reservation_id returning * into v_reservation;
  insert into public.model_provider_spend_ledger (
    reservation_id, tenant_id, entry_kind, reserved_delta_microusd,
    spent_delta_microusd, reason_code
  ) values (v_reservation.reservation_id, p_tenant_id, 'reserve', v_reserved_cost, 0,
            'PROVIDER_DISPATCH_RESERVED');
  insert into public.model_provider_tenant_turns (tenant_id, last_admitted_at)
    values (p_tenant_id, v_now)
    on conflict (tenant_id) do update set last_admitted_at = excluded.last_admitted_at;

  return jsonb_build_object(
    'status', 'reserved', 'reservationId', v_reservation.reservation_id,
    'tenantId', p_tenant_id, 'requestKey', p_request_key, 'requestDigest', p_request_digest,
    'provider', p_provider, 'model', p_model, 'meter', p_meter,
    'priceVersion', v_price.price_version, 'unitMicrousd', v_price.unit_microusd,
    'reservedUnits', p_reserved_units, 'reservedMicrousd', v_reserved_cost,
    'expiresAt', v_reservation.expires_at, 'idempotentReplay', v_replay
  );
end;
$$;

create function public.settle_model_provider_spend_v1(
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
  v_actual_cost bigint;
begin
  if p_tenant_id !~ '^[A-Za-z0-9_-]{1,80}$' or p_outcome not in ('settled', 'released')
    or p_actual_units not between 0 and 1000000000
    or p_reason_code !~ '^[A-Z0-9_]{3,80}$'
    or (p_outcome = 'released' and p_actual_units <> 0) then
    raise exception 'model_provider_settlement_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:tenant:' || p_tenant_id, 0));
  select * into v_reservation from public.model_provider_spend_reservations
   where reservation_id = p_reservation_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'model_provider_reservation_not_found'; end if;
  if v_reservation.state in ('settled', 'released') then
    if v_reservation.state = p_outcome and v_reservation.actual_units = p_actual_units then
      return jsonb_build_object('status', 'duplicate', 'reservationId', p_reservation_id,
        'state', v_reservation.state, 'actualUnits', v_reservation.actual_units,
        'actualMicrousd', v_reservation.actual_microusd);
    end if;
    raise exception 'model_provider_settlement_conflict';
  end if;
  if v_reservation.state <> 'reserved' then raise exception 'model_provider_reservation_not_active'; end if;
  if v_reservation.expires_at <= v_now then
    update public.model_provider_spend_reservations set state = 'expired',
      reason_code = 'RESERVATION_EXPIRED', settled_at = v_now
     where reservation_id = p_reservation_id;
    insert into public.model_provider_spend_ledger (
      reservation_id, tenant_id, entry_kind, reserved_delta_microusd,
      spent_delta_microusd, reason_code
    ) values (p_reservation_id, p_tenant_id, 'expire', -v_reservation.reserved_microusd,
              0, 'RESERVATION_EXPIRED');
    return jsonb_build_object('status', 'expired', 'reservationId', p_reservation_id,
      'state', 'expired', 'actualUnits', 0, 'actualMicrousd', 0,
      'refundedMicrousd', v_reservation.reserved_microusd);
  end if;
  if p_actual_units > v_reservation.reserved_units then
    raise exception 'model_provider_reserved_cost_exceeded';
  end if;
  v_actual_cost := p_actual_units * v_reservation.unit_microusd;
  update public.model_provider_spend_reservations
     set state = p_outcome, actual_units = p_actual_units, actual_microusd = v_actual_cost,
         reason_code = p_reason_code, settled_at = v_now
   where reservation_id = p_reservation_id;
  insert into public.model_provider_spend_ledger (
    reservation_id, tenant_id, entry_kind, reserved_delta_microusd,
    spent_delta_microusd, reason_code
  ) values (p_reservation_id, p_tenant_id,
    case when p_outcome = 'settled' then 'settle' else 'release' end,
    -v_reservation.reserved_microusd, v_actual_cost, p_reason_code);
  return jsonb_build_object('status', 'processed', 'reservationId', p_reservation_id,
    'state', p_outcome, 'actualUnits', p_actual_units, 'actualMicrousd', v_actual_cost,
    'refundedMicrousd', v_reservation.reserved_microusd - v_actual_cost);
end;
$$;

revoke all on function public.reserve_model_provider_spend_v1(text, text, text, text, text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_model_provider_spend_v1(text, text, text, text, text, text, bigint, integer)
  to service_role;
revoke all on function public.settle_model_provider_spend_v1(text, uuid, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.settle_model_provider_spend_v1(text, uuid, text, bigint, text)
  to service_role;
revoke execute on function public.reject_model_provider_ledger_mutation()
  from public, anon, authenticated;

commit;
