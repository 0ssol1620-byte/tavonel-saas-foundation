-- Rollback-only pgTAP coverage for queued-reservation expiry recovery
-- (20261002110000_model_provider_queue_expiry_recovery.sql). Every price, budget, tenant, and
-- request below is synthetic, and the whole run is rolled back, so nothing survives it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- Only the synthetic accounting below may be active inside this transaction.
update public.model_provider_spend_budgets set enabled = false where enabled;

insert into public.model_provider_prices (
  provider, model, meter, price_version, unit_microusd, effective_from, enabled
) values ('synthetic-provider', 'synthetic/model-recovery', 'gpu_second', 'synthetic-2026-10',
          100, now() - interval '1 day', true);

-- One global slot. Every request below reserves 10 units = 1000 microusd. Tenant B's cap fits
-- exactly one request; tenant D's cap fits none.
insert into public.model_provider_spend_budgets (
  scope_kind, tenant_id, period_start, period_end, spend_limit_microusd, concurrency_limit, enabled
) values
  ('global', null, now() - interval '1 day', now() + interval '1 day', 1000000, 1, true),
  ('tenant', 'synthetic-tenant-a', now() - interval '1 day', now() + interval '1 day', 1000000, 1, true),
  ('tenant', 'synthetic-tenant-b', now() - interval '1 day', now() + interval '1 day', 1000, 1, true),
  ('tenant', 'synthetic-tenant-c', now() - interval '1 day', now() + interval '1 day', 1000000, 1, true),
  ('tenant', 'synthetic-tenant-d', now() - interval '1 day', now() + interval '1 day', 500, 1, true);

create temp table spend_receipts (label text primary key, receipt jsonb not null) on commit drop;

-- Thin wrappers over the real RPC; they only fix the synthetic provider, model, meter, and size.
create function pg_temp.reserve(p_tenant_id text, p_request_key text, p_digest_hex text)
returns jsonb language sql as $$
  select public.reserve_model_provider_spend_v1(p_tenant_id, p_request_key,
    'sha256:' || repeat(p_digest_hex, 64), 'synthetic-provider', 'synthetic/model-recovery',
    'gpu_second', 10)
$$;
create function pg_temp.receipt(p_label text)
returns jsonb language sql as $$
  select receipt from spend_receipts where label = p_label
$$;
create function pg_temp.reservation_id(p_label text)
returns uuid language sql as $$
  select (receipt->>'reservationId')::uuid from spend_receipts where label = p_label
$$;

select ok(exists (
  select 1 from pg_constraint
   where conrelid = 'public.model_provider_spend_reservations'::regclass
     and conname = 'model_provider_spend_reservation_lifecycle_v3'
), 'lifecycle_v3 guards reservation rows');
select ok(not exists (
  select 1 from pg_constraint
   where conrelid = 'public.model_provider_spend_reservations'::regclass
     and conname = 'model_provider_spend_reservation_lifecycle_v2'
), 'lifecycle_v2 no longer rejects queue expiry');
select is((select count(*) from public.model_provider_spend_reservations
            where state in ('queued', 'reserved')), 0::bigint,
  'no live reservation exists outside this synthetic run');

-- 1. Tenant A takes the only global slot.
insert into spend_receipts values
  ('a1', pg_temp.reserve('synthetic-tenant-a', 'synthetic-a-0001', '1'));
select is(pg_temp.receipt('a1')->>'status', 'reserved',
  'tenant A is admitted into the single global slot');

-- 2. Tenant B queues behind A, then ages past the 15 minute queue window.
insert into spend_receipts values
  ('b-stale', pg_temp.reserve('synthetic-tenant-b', 'synthetic-b-stale', '2'));
select is(pg_temp.receipt('b-stale')->>'status', 'queued',
  'tenant B queues while the global slot is held');
select ok((select state = 'queued' and admitted_at is null and expires_at is null
             from public.model_provider_spend_reservations
            where reservation_id = pg_temp.reservation_id('b-stale')),
  'the queued request was never admitted');
update public.model_provider_spend_reservations
   set requested_at = clock_timestamp() - interval '16 minutes'
 where reservation_id = pg_temp.reservation_id('b-stale');

-- 3. Settling A frees the slot. A duplicate settlement must not write a second ledger entry, and
--    another tenant cannot settle A's reservation at all.
insert into spend_receipts values
  ('a1-settle', public.settle_model_provider_spend_v1('synthetic-tenant-a',
     pg_temp.reservation_id('a1'), 'settled', 4, 'PROVIDER_COMPLETED'));
insert into spend_receipts values
  ('a1-settle-dup', public.settle_model_provider_spend_v1('synthetic-tenant-a',
     pg_temp.reservation_id('a1'), 'settled', 4, 'PROVIDER_COMPLETED'));
select is(pg_temp.receipt('a1-settle')->>'status', 'processed',
  'settling tenant A frees the global slot');
select is(pg_temp.receipt('a1-settle-dup')->>'status', 'duplicate',
  'a repeated identical settlement is acknowledged as a duplicate');
select is((select count(*) from public.model_provider_spend_ledger
            where reservation_id = pg_temp.reservation_id('a1') and entry_kind = 'settle'),
  1::bigint, 'the duplicate settlement wrote no second settle entry');
select is((select count(*) from public.model_provider_spend_ledger
            where reservation_id = pg_temp.reservation_id('a1')),
  2::bigint, 'tenant A has exactly one reserve and one settle entry');
select throws_ok(
  $$select public.settle_model_provider_spend_v1('synthetic-tenant-c',
      pg_temp.reservation_id('a1'), 'settled', 4, 'PROVIDER_COMPLETED')$$,
  'P0001', 'model_provider_reservation_not_found',
  'another tenant cannot settle tenant A''s reservation');

-- 4. A new, different tenant arrives while B's stale queued row is still present. The sweep inside
--    reserve_model_provider_spend_v1 expires B's row first; under lifecycle_v2 that raised a check
--    violation and no tenant could be admitted at all.
select lives_ok(
  $$insert into spend_receipts values
      ('c1', pg_temp.reserve('synthetic-tenant-c', 'synthetic-c-0001', '3'))$$,
  'a reservation succeeds while a stale queued row is swept');
select is(pg_temp.receipt('c1')->>'status', 'reserved',
  'tenant C is admitted into the freed slot');

-- 5. Replaying B's stale request returns the same terminal receipt every time.
insert into spend_receipts values
  ('b-replay-1', pg_temp.reserve('synthetic-tenant-b', 'synthetic-b-stale', '2'));
insert into spend_receipts values
  ('b-replay-2', pg_temp.reserve('synthetic-tenant-b', 'synthetic-b-stale', '2'));
select is(pg_temp.receipt('b-replay-1')->>'status', 'expired',
  'the stale request replays as expired');
select is(pg_temp.receipt('b-replay-1')->>'reservationId',
  pg_temp.receipt('b-stale')->>'reservationId',
  'the replay resolves to the original queued reservation');
select ok(pg_temp.receipt('b-replay-1')->'expiresAt' = 'null'::jsonb
          and (pg_temp.receipt('b-replay-1')->>'idempotentReplay')::boolean,
  'the replay carries no expiry and is marked idempotent');
select is(pg_temp.receipt('b-replay-2'), pg_temp.receipt('b-replay-1'),
  'a second replay returns an identical terminal receipt');
select is((select state || ':' || reason_code from public.model_provider_spend_reservations
            where reservation_id = pg_temp.reservation_id('b-stale')),
  'expired:QUEUE_EXPIRED', 'the stale queued row is terminal as QUEUE_EXPIRED');
select ok((select admitted_at is null and expires_at is null and not reconciliation_pending
                  and settled_at is not null
             from public.model_provider_spend_reservations
            where reservation_id = pg_temp.reservation_id('b-stale')),
  'the queue-expired row keeps a null admission and expiry and is closed');
select is((select count(*) from public.model_provider_spend_ledger
            where reservation_id = pg_temp.reservation_id('b-stale')),
  0::bigint, 'never-admitted queued work has no ledger entries');

-- 6. Tenant and cap isolation: B's single-request cap and concurrency ignore its expired queued
--    row, and tenant D's own breaker neither admits D nor disturbs B.
insert into spend_receipts values
  ('c1-release', public.settle_model_provider_spend_v1('synthetic-tenant-c',
     pg_temp.reservation_id('c1'), 'released', 0, 'PROVIDER_NOT_CALLED'));
select is(pg_temp.receipt('c1-release')->>'status', 'processed',
  'releasing tenant C frees the global slot');
insert into spend_receipts values
  ('b2', pg_temp.reserve('synthetic-tenant-b', 'synthetic-b-0002', '4'));
select is(pg_temp.receipt('b2')->>'status', 'reserved',
  'tenant B''s spend cap and concurrency ignore its expired queued row');
select throws_ok(
  $$select pg_temp.reserve('synthetic-tenant-d', 'synthetic-d-0001', '5')$$,
  'P0001', 'model_provider_tenant_spend_breaker_open',
  'tenant D''s smaller cap rejects its own request');
select is((select count(*) from public.model_provider_spend_reservations
            where tenant_id = 'synthetic-tenant-d'),
  0::bigint, 'the rejected tenant D request leaves no reservation');
select is((select state from public.model_provider_spend_reservations
            where reservation_id = pg_temp.reservation_id('b2')),
  'reserved', 'tenant D''s breaker does not disturb tenant B''s admitted reservation');

-- 7. lifecycle_v3 admits exactly one new shape: never admitted, not pending, QUEUE_EXPIRED.
select throws_ok(
  $$update public.model_provider_spend_reservations set reason_code = 'RESERVATION_EXPIRED'
     where reservation_id = pg_temp.reservation_id('b-stale')$$,
  '23514', null, 'an unadmitted expiry with any other reason is rejected');
select throws_ok(
  $$update public.model_provider_spend_reservations set reason_code = null
     where reservation_id = pg_temp.reservation_id('b-stale')$$,
  '23514', null, 'an unadmitted expiry without a reason is rejected');
select throws_ok(
  $$update public.model_provider_spend_reservations set reconciliation_pending = true
     where reservation_id = pg_temp.reservation_id('b-stale')$$,
  '23514', null, 'a queue expiry cannot be pending reconciliation');
select throws_ok(
  $$update public.model_provider_spend_reservations set expires_at = clock_timestamp()
     where reservation_id = pg_temp.reservation_id('b-stale')$$,
  '23514', null, 'a queue expiry cannot carry an expiry without admission');
select throws_ok(
  $$update public.model_provider_spend_reservations set admitted_at = clock_timestamp()
     where reservation_id = pg_temp.reservation_id('b-stale')$$,
  '23514', null, 'an admitted expiry still needs its expiry timestamp');

-- 8. The admitted terminal and reserved/pending-reconciliation branches still hold.
select ok((select state = 'settled' and admitted_at is not null and expires_at is not null
                  and not reconciliation_pending
             from public.model_provider_spend_reservations
            where reservation_id = pg_temp.reservation_id('a1')),
  'an admitted terminal row keeps its admission and expiry');
select lives_ok(
  $$select public.mark_model_provider_spend_indeterminate_v1('synthetic-tenant-b',
      pg_temp.reservation_id('b2'), 'PROVIDER_CALL_FAILED')$$,
  'an admitted reservation can still be held for reconciliation');
select ok((select state = 'reserved' and admitted_at is not null and expires_at is null
                  and reconciliation_pending
             from public.model_provider_spend_reservations
            where reservation_id = pg_temp.reservation_id('b2')),
  'the pending reservation keeps its admitted hold with no expiry');

select is((select count(*) from public.model_provider_spend_ledger
            where tenant_id = 'synthetic-tenant-b'),
  1::bigint, 'tenant B has only the reserve entry of its admitted request');
select is((select count(*) from public.model_provider_spend_ledger
            where tenant_id like 'synthetic-tenant-%'),
  5::bigint, 'the run wrote one entry per admission and per terminal settlement, nothing else');

select * from finish();
rollback;
