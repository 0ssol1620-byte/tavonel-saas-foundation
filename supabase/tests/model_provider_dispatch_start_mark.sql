-- Rollback-only pgTAP coverage for the K20 durable dispatch-start mark
-- (20261002130000_model_provider_dispatch_start_mark.sql). A "hard process death" is modelled as
-- the worker simply never making its next RPC: what remains is exactly the committed rows, and
-- the restarted worker and the sweep only ever see those. Every price, budget, tenant and request
-- is synthetic and the whole run is rolled back. No provider is involved at all.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

update public.model_provider_spend_budgets set enabled = false where enabled;

insert into public.model_provider_prices (
  provider, model, meter, price_version, unit_microusd, effective_from, enabled
) values ('synthetic-provider', 'synthetic/model-k20', 'gpu_second', 'synthetic-k20',
          100, now() - interval '1 day', true);

-- One global slot, so "the sweep is not blocked" is measured as "the next tenant is admitted".
insert into public.model_provider_spend_budgets (
  scope_kind, tenant_id, period_start, period_end, spend_limit_microusd, concurrency_limit, enabled
) values
  ('global', null, now() - interval '1 day', now() + interval '1 day', 1000000, 1, true),
  ('tenant', 'synthetic-k20-a', now() - interval '1 day', now() + interval '1 day', 1000000, 1, true),
  ('tenant', 'synthetic-k20-b', now() - interval '1 day', now() + interval '1 day', 1000000, 1, true);

create temp table k20_receipts (label text primary key, receipt jsonb not null) on commit drop;

create function pg_temp.reserve(p_tenant_id text, p_request_key text, p_digest_hex text)
returns jsonb language sql as $$
  select public.reserve_model_provider_spend_v1(p_tenant_id, p_request_key,
    'sha256:' || repeat(p_digest_hex, 64), 'synthetic-provider', 'synthetic/model-k20',
    'gpu_second', 10)
$$;
create function pg_temp.receipt(p_label text)
returns jsonb language sql as $$
  select receipt from k20_receipts where label = p_label
$$;
create function pg_temp.rid(p_label text)
returns uuid language sql as $$
  select (receipt->>'reservationId')::uuid from k20_receipts where label = p_label
$$;
create function pg_temp.ledger(p_label text)
returns text language sql as $$
  select coalesce(string_agg(entry_kind, ',' order by entry_id), '')
    from public.model_provider_spend_ledger where reservation_id = pg_temp.rid(p_label)
$$;

-- 0. Shape and privileges.
select has_column('public', 'model_provider_spend_reservations', 'dispatch_started_at',
  'reservations carry a durable dispatch-start mark');
select ok(has_function_privilege('service_role',
    'public.mark_model_provider_spend_dispatch_started_v1(text,uuid)', 'execute')
  and not has_function_privilege('anon',
    'public.mark_model_provider_spend_dispatch_started_v1(text,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.mark_model_provider_spend_dispatch_started_v1(text,uuid)', 'execute'),
  'the dispatch-start mark is service-role only');

-- 1. Crash after reserve, before the mark. The provider was never called, so the hold is still
--    refundable, and a restarted worker cannot start a call on the expired hold.
insert into k20_receipts values ('a1', pg_temp.reserve('synthetic-k20-a', 'synthetic-k20-a-0001', '1'));
select is(pg_temp.receipt('a1')->>'status', 'reserved', 'A1 is admitted');
-- Age the hold past its expiry without waiting for the clock.
update public.model_provider_spend_reservations
   set expires_at = clock_timestamp() - interval '1 second'
 where reservation_id = pg_temp.rid('a1');
select throws_ok(
  $$select public.mark_model_provider_spend_dispatch_started_v1('synthetic-k20-a', pg_temp.rid('a1'))$$,
  'P0001', 'model_provider_reservation_not_active',
  'an expired, unmarked hold can no longer start a provider call');
insert into k20_receipts values ('b1', pg_temp.reserve('synthetic-k20-b', 'synthetic-k20-b-0001', '2'));
select is((select state || ':' || reason_code from public.model_provider_spend_reservations
            where reservation_id = pg_temp.rid('a1')),
  'expired:RESERVATION_EXPIRED', 'an unmarked expired hold is still swept and refunded');
select is(pg_temp.ledger('a1'), 'reserve,expire', 'the unmarked refund is one expire entry');
select is(pg_temp.receipt('b1')->>'status', 'reserved', 'B1 takes the freed global slot');

-- 2. Mark B1. This is the last durable write before the provider call.
insert into k20_receipts values ('b1-mark', public.mark_model_provider_spend_dispatch_started_v1(
  'synthetic-k20-b', pg_temp.rid('b1')));
select is(pg_temp.receipt('b1-mark')->>'status', 'dispatch_started', 'B1 dispatch start is recorded');
select ok((select dispatch_started_at is not null from public.model_provider_spend_reservations
            where reservation_id = pg_temp.rid('b1')), 'the mark is durable on the row');
select throws_ok(
  $$select public.mark_model_provider_spend_dispatch_started_v1('synthetic-k20-a', pg_temp.rid('b1'))$$,
  'P0001', 'model_provider_reservation_not_found', 'another tenant cannot mark B1');

-- 3. Crash after the mark (before or after the provider accepted; the database cannot tell, and
--    must not need to). The restarted worker replays the same request key.
insert into k20_receipts values ('b1-replay', pg_temp.reserve('synthetic-k20-b', 'synthetic-k20-b-0001', '2'));
select ok(pg_temp.receipt('b1-replay')->>'status' = 'reserved'
          and pg_temp.receipt('b1-replay')->>'reservationId' = pg_temp.receipt('b1')->>'reservationId'
          and (pg_temp.receipt('b1-replay')->>'idempotentReplay')::boolean,
  'the replay resolves to the same live reservation');
select throws_ok(
  $$select public.mark_model_provider_spend_dispatch_started_v1('synthetic-k20-b', pg_temp.rid('b1'))$$,
  'P0001', 'model_provider_dispatch_already_started',
  'the restarted worker cannot mark B1 again, so it never calls the provider twice');
select throws_ok(
  $$select public.settle_model_provider_spend_v1('synthetic-k20-b', pg_temp.rid('b1'), 'released', 0, 'PROVIDER_NOT_CALLED')$$,
  'P0001', 'model_provider_dispatch_already_started',
  'a marked hold cannot be released as zero spend');
select is(pg_temp.ledger('b1'), 'reserve', 'neither refusal wrote a ledger entry');

-- 4. The hold expires with nobody alive to settle it. The next reserve's sweep parks it as
--    pending reconciliation instead of refunding it, and frees the slot.
-- Age the hold past its expiry without waiting for the clock.
update public.model_provider_spend_reservations
   set expires_at = clock_timestamp() - interval '1 second'
 where reservation_id = pg_temp.rid('b1');
insert into k20_receipts values ('a2', pg_temp.reserve('synthetic-k20-a', 'synthetic-k20-a-0002', '3'));
select ok((select state = 'reserved' and expires_at is null and reconciliation_pending
                  and reason_code = 'DISPATCH_OUTCOME_UNKNOWN' and admitted_at is not null
             from public.model_provider_spend_reservations
            where reservation_id = pg_temp.rid('b1')),
  'the sweep parks the marked hold as pending reconciliation, still charged');
select ok((select status = 'pending' and pending_reason_code = 'DISPATCH_OUTCOME_UNKNOWN'
                  and original_expires_at < clock_timestamp()
             from public.model_provider_spend_reconciliations
            where reservation_id = pg_temp.rid('b1')),
  'a pending reconciliation row records the original expiry');
select is(pg_temp.ledger('b1'), 'reserve', 'no expire refund was written for the marked hold');
select is(pg_temp.receipt('a2')->>'status', 'reserved',
  'the parked hold does not block the next admission');

-- 5. The sweep and every recovery call are idempotent under replay.
insert into k20_receipts values ('a2-replay', pg_temp.reserve('synthetic-k20-a', 'synthetic-k20-a-0002', '3'));
select is(pg_temp.receipt('a2-replay')->>'reservationId', pg_temp.receipt('a2')->>'reservationId',
  'a second sweep pass replays A2 unchanged');
select ok((select count(*) = 1 from public.model_provider_spend_reconciliations
            where reservation_id = pg_temp.rid('b1'))
          and pg_temp.ledger('b1') = 'reserve',
  'a second sweep pass neither re-parks nor refunds B1');
insert into k20_receipts values ('b1-late-mark', public.mark_model_provider_spend_indeterminate_v1(
  'synthetic-k20-b', pg_temp.rid('b1'), 'PROVIDER_CALL_FAILED'));
select is(pg_temp.receipt('b1-late-mark')->>'status', 'duplicate',
  'a late indeterminate mark agrees with the parked hold');
insert into k20_receipts values ('b1-replay-2', pg_temp.reserve('synthetic-k20-b', 'synthetic-k20-b-0001', '2'));
select ok(pg_temp.receipt('b1-replay-2')->>'status' = 'reserved'
          and pg_temp.receipt('b1-replay-2')->'expiresAt' = 'null'::jsonb,
  'a replay of the parked request carries no expiry, which the client refuses to dispatch');
select throws_ok(
  $$select public.mark_model_provider_spend_dispatch_started_v1('synthetic-k20-b', pg_temp.rid('b1'))$$,
  'P0001', 'model_provider_dispatch_already_started', 'the parked hold still cannot be re-marked');
select throws_ok(
  $$select public.settle_model_provider_spend_v1('synthetic-k20-b', pg_temp.rid('b1'), 'settled', 7, 'PROVIDER_COMPLETED')$$,
  'P0001', 'model_provider_reconciliation_required',
  'only reconciliation can close the parked hold');

-- 6. Reconciliation from evidence closes it once.
insert into k20_receipts values ('b1-reconcile', public.reconcile_model_provider_spend_v1(
  'synthetic-k20-b', pg_temp.rid('b1'), 'settled', 7, 'PROVIDER_INVOICE_CONFIRMED'));
insert into k20_receipts values ('b1-reconcile-dup', public.reconcile_model_provider_spend_v1(
  'synthetic-k20-b', pg_temp.rid('b1'), 'settled', 7, 'PROVIDER_INVOICE_CONFIRMED'));
select is(pg_temp.receipt('b1-reconcile')->>'status', 'processed', 'reconciliation settles B1');
select is(pg_temp.receipt('b1-reconcile-dup')->>'status', 'duplicate',
  'replaying the reconciliation is acknowledged as a duplicate');
select is((select string_agg(entry_kind || ':' || spent_delta_microusd, ',' order by entry_id)
             from public.model_provider_spend_ledger where reservation_id = pg_temp.rid('b1')),
  'reserve:0,settle:700', 'B1 is charged once, at the reconciled usage');

-- 7. Crash after settle. Nothing can start the call again or change the charge.
insert into k20_receipts values ('a2-mark', public.mark_model_provider_spend_dispatch_started_v1(
  'synthetic-k20-a', pg_temp.rid('a2')));
insert into k20_receipts values ('a2-settle', public.settle_model_provider_spend_v1(
  'synthetic-k20-a', pg_temp.rid('a2'), 'settled', 3, 'PROVIDER_COMPLETED'));
select is(pg_temp.receipt('a2-settle')->>'status', 'processed', 'A2 settles its measured usage');
select throws_ok(
  $$select public.mark_model_provider_spend_dispatch_started_v1('synthetic-k20-a', pg_temp.rid('a2'))$$,
  'P0001', 'model_provider_dispatch_already_started', 'a settled reservation cannot be re-marked');
insert into k20_receipts values ('a2-replay-settled', pg_temp.reserve('synthetic-k20-a', 'synthetic-k20-a-0002', '3'));
select is(pg_temp.receipt('a2-replay-settled')->>'status', 'settled',
  'a replay after settlement returns the terminal state, never a dispatchable one');
insert into k20_receipts values ('a2-settle-dup', public.settle_model_provider_spend_v1(
  'synthetic-k20-a', pg_temp.rid('a2'), 'settled', 3, 'PROVIDER_COMPLETED'));
select ok(pg_temp.receipt('a2-settle-dup')->>'status' = 'duplicate'
          and pg_temp.ledger('a2') = 'reserve,settle',
  'a replayed settlement writes nothing');

-- 8. A live worker whose settlement arrives after expiry but before any sweep is recorded as
--    measured, not refunded.
insert into k20_receipts values ('a3', pg_temp.reserve('synthetic-k20-a', 'synthetic-k20-a-0003', '4'));
insert into k20_receipts values ('a3-mark', public.mark_model_provider_spend_dispatch_started_v1(
  'synthetic-k20-a', pg_temp.rid('a3')));
-- Age the hold past its expiry without waiting for the clock.
update public.model_provider_spend_reservations
   set expires_at = clock_timestamp() - interval '1 second'
 where reservation_id = pg_temp.rid('a3');
insert into k20_receipts values ('a3-settle', public.settle_model_provider_spend_v1(
  'synthetic-k20-a', pg_temp.rid('a3'), 'settled', 5, 'PROVIDER_COMPLETED'));
select ok(pg_temp.receipt('a3-settle')->>'status' = 'processed'
          and (pg_temp.receipt('a3-settle')->>'actualUnits')::bigint = 5,
  'a late measured settlement of a marked hold is recorded as measured');
select is(pg_temp.ledger('a3'), 'reserve,settle', 'the late settlement wrote no expire refund');

-- 9. A queued request can neither be marked nor carry a mark.
insert into k20_receipts values ('a4', pg_temp.reserve('synthetic-k20-a', 'synthetic-k20-a-0004', '5'));
insert into k20_receipts values ('b2', pg_temp.reserve('synthetic-k20-b', 'synthetic-k20-b-0002', '6'));
select ok(pg_temp.receipt('a4')->>'status' = 'reserved' and pg_temp.receipt('b2')->>'status' = 'queued',
  'B2 queues behind A4 in the single global slot');
select throws_ok(
  $$select public.mark_model_provider_spend_dispatch_started_v1('synthetic-k20-b', pg_temp.rid('b2'))$$,
  'P0001', 'model_provider_reservation_not_active', 'a queued request cannot start a provider call');
select throws_ok(
  $$update public.model_provider_spend_reservations set dispatch_started_at = clock_timestamp()
     where reservation_id = pg_temp.rid('b2')$$,
  '23514', null, 'an unadmitted row cannot carry a dispatch mark');

-- 10. Whole-run invariants.
select is((select count(*) from public.model_provider_spend_ledger l
             join public.model_provider_spend_reservations r using (reservation_id)
            where r.dispatch_started_at is not null and l.entry_kind in ('expire', 'release')),
  0::bigint, 'no marked reservation was ever refunded or released');
select is((select count(*) from public.model_provider_spend_reservations
            where tenant_id like 'synthetic-k20-%' and dispatch_started_at is not null),
  3::bigint, 'exactly the three dispatched reservations carry a mark');

select * from finish();
rollback;
