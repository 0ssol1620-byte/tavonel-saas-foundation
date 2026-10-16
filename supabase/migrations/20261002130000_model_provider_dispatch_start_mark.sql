-- K20: a durable "dispatch started" mark for paid-provider reservations.
--
-- Before this, the only proof that a provider call might have happened lived in the worker's
-- memory between `call()` and `mark_model_provider_spend_indeterminate_v1`. A hard process death
-- in that window left an ordinary `reserved` row, and the next sweep refunded it with an
-- `expire` ledger entry as if the provider had never been called. A replay of the same request
-- key also re-received `status: reserved` and could dispatch the same reservation again.
--
-- The worker now commits `dispatch_started_at` through
-- `mark_model_provider_spend_dispatch_started_v1` immediately before the provider call, and calls
-- the provider only on a fresh mark. Consequences, all enforced here rather than in the client:
--   * the mark is set at most once, so a replayed or concurrent worker is refused and never
--     dispatches the same reservation twice;
--   * the sweep in `reserve_model_provider_spend_v1` never refunds a marked hold: a marked hold
--     past its expiry is parked as pending reconciliation (`DISPATCH_OUTCOME_UNKNOWN`), keeping
--     the full hold charged but freeing its concurrency slot, so it cannot block admission;
--   * `settle_model_provider_spend_v1` never expires a marked hold (a late measured settlement
--     is recorded as measured) and never releases one as zero spend.
-- An unmarked hold keeps every earlier behaviour, including the expiry refund.
-- Rerunnable: `add column if not exists`, `drop constraint if exists` + `add`,
-- `create or replace function`, and the grants are re-stated.
begin;

alter table public.model_provider_spend_reservations
  add column if not exists dispatch_started_at timestamptz;
alter table public.model_provider_spend_reservations
  drop constraint if exists model_provider_spend_dispatch_mark_admitted;
alter table public.model_provider_spend_reservations
  add constraint model_provider_spend_dispatch_mark_admitted
  check (dispatch_started_at is null or admitted_at is not null);

create or replace function public.mark_model_provider_spend_dispatch_started_v1(
  p_tenant_id text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_reservation public.model_provider_spend_reservations%rowtype;
begin
  if p_tenant_id is null or p_tenant_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or p_reservation_id is null then
    raise exception 'model_provider_reservation_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('model_provider_spend:tenant:' || p_tenant_id, 0));

  select * into v_reservation from public.model_provider_spend_reservations
   where reservation_id = p_reservation_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'model_provider_reservation_not_found'; end if;
  -- Set once. A second mark, from a replay or a concurrent worker, is refused: only the first
  -- marker may call the provider for this reservation.
  if v_reservation.dispatch_started_at is not null then
    raise exception 'model_provider_dispatch_already_started';
  end if;
  -- Only a live, admitted, unpending hold may start a paid call. A hold past its expiry is
  -- refused even before a sweep has closed it, so the sweep's refund stays correct.
  if v_reservation.state <> 'reserved' or v_reservation.reconciliation_pending
    or v_reservation.expires_at is null or v_reservation.expires_at <= v_now then
    raise exception 'model_provider_reservation_not_active';
  end if;

  update public.model_provider_spend_reservations
     set dispatch_started_at = v_now
   where reservation_id = p_reservation_id;
  return jsonb_build_object('status', 'dispatch_started', 'reservationId', p_reservation_id,
    'tenantId', p_tenant_id, 'dispatchStartedAt', v_now,
    'expiresAt', v_reservation.expires_at);
end;
$$;

create or replace function public.reserve_model_provider_spend_v1(
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

  -- K20: a marked hold may have reached the provider, so time alone never refunds it. Park it as
  -- pending reconciliation first: the hold stays charged (state reserved) but a null expiry
  -- frees its concurrency slot, and the refund sweep below can no longer select it. Both
  -- statements see the same v_now under the global lock, so they select the same rows.
  insert into public.model_provider_spend_reconciliations (
    reservation_id, tenant_id, status, pending_reason_code, original_expires_at
  ) select reservation_id, tenant_id, 'pending', 'DISPATCH_OUTCOME_UNKNOWN', expires_at
      from public.model_provider_spend_reservations
     where state = 'reserved' and expires_at <= v_now and dispatch_started_at is not null;
  update public.model_provider_spend_reservations
     set expires_at = null, reconciliation_pending = true,
         reason_code = 'DISPATCH_OUTCOME_UNKNOWN'
   where state = 'reserved' and expires_at <= v_now and dispatch_started_at is not null;

  -- Release expired holds before measuring either breaker. The negative ledger entry is the
  -- refund receipt; no in-place balance can drift away from the append-only accounting history.
  with expired as (
    update public.model_provider_spend_reservations
       set state = 'expired', reason_code = 'RESERVATION_EXPIRED', settled_at = v_now
     where state = 'reserved' and expires_at <= v_now and dispatch_started_at is null
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

create or replace function public.settle_model_provider_spend_v1(
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
  -- K20: once dispatch has started, zero spend is not proven. Only reconciliation with evidence
  -- may release such a hold.
  if p_outcome = 'released' and v_reservation.dispatch_started_at is not null then
    raise exception 'model_provider_dispatch_already_started';
  end if;
  -- K20: a late measured settlement of a marked hold is recorded as measured. Only an unmarked
  -- hold, which never reached a provider, is refunded by expiry.
  if v_reservation.expires_at <= v_now and v_reservation.dispatch_started_at is null then
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

revoke all on function public.mark_model_provider_spend_dispatch_started_v1(text, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_model_provider_spend_dispatch_started_v1(text, uuid)
  to service_role;
revoke all on function public.reserve_model_provider_spend_v1(text, text, text, text, text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_model_provider_spend_v1(text, text, text, text, text, text, bigint, integer)
  to service_role;
revoke all on function public.settle_model_provider_spend_v1(text, uuid, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.settle_model_provider_spend_v1(text, uuid, text, bigint, text)
  to service_role;

commit;
