-- Page meter (20261109080000): a read settles by its pages, an unchanged source re-read in the
-- same workspace settles at 0, and a compile that produced nothing gives its pages back.
--
-- Two accounts, 2,000 units each, granted once. Read every balance assertion as arithmetic on
-- that grant: any unit not explained by a hold, a release, a charge or a reversal is a break.
-- Every row is rolled back.
begin;
select plan(53);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'meter-a@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'meter-b@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

select public.apply_foundation_billing_event_v4(
  'evt_' || rpad('metera', 26, 'a'), 'transaction.completed', '2026-11-09T07:00:00Z',
  'sha256:' || repeat('1', 64), 'allowance', 'pilot-metera', '91000000-0000-4000-8000-00000000000a',
  'observer_access', 'txn_' || rpad('metera', 26, 'a'), 'ctm_' || rpad('metera', 26, 'a'), null, null, 2000, null);
select public.apply_foundation_billing_event_v4(
  'evt_' || rpad('meterb', 26, 'b'), 'transaction.completed', '2026-11-09T07:00:00Z',
  'sha256:' || repeat('2', 64), 'allowance', 'pilot-meterb', '91000000-0000-4000-8000-00000000000b',
  'observer_access', 'txn_' || rpad('meterb', 26, 'b'), 'ctm_' || rpad('meterb', 26, 'b'), null, null, 2000, null);
update public.foundation_billing_accounts
   set access_plan = 'observer_access', subscription_status = 'active'
 where workspace_key in ('pilot-metera', 'pilot-meterb');

create function pg_temp.balance(p_workspace text) returns integer language sql as $$
  select credit_balance from public.foundation_billing_accounts where workspace_key = p_workspace
$$;
create function pg_temp.hold(p_workspace text, p_user text, p_document text, p_reserved integer, p_maximum integer)
returns void language sql as $$
  select public.reserve_foundation_compute_v3(p_workspace, p_document::uuid, p_user::uuid, p_reserved, p_maximum);
$$;
create function pg_temp.settle(p_workspace text, p_document text, p_outcome text, p_pages integer,
  p_complex integer, p_sha text) returns jsonb language sql as $$
  select public.settle_foundation_compute_v4(p_workspace, p_document::uuid, p_outcome, p_pages, p_complex,
    case when p_sha is null then null else 'sha256:' || repeat(p_sha, 64) end, 'OCR_COMPLETED');
$$;

-- ---------------------------------------------------------------------------
-- 1. Unknown page count: refused, nothing moves.
-- ---------------------------------------------------------------------------
select pg_temp.hold('pilot-metera', '91000000-0000-4000-8000-00000000000a', '92000000-0000-4000-8000-000000000001', 12, 18);
select is(pg_temp.balance('pilot-metera'), 1988, 'a three-page hold of 12 leaves the balance');
select throws_ok(
  $$select pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000001', 'settled', null, null, 'a')$$,
  'foundation_compute_page_count_required',
  'a settled read with no page count is refused rather than guessed');
select is((select state::text from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000001'), 'reserved',
  'the refused settlement leaves the hold in place');

-- ---------------------------------------------------------------------------
-- 2. Standard pages: 3 pages settle 3 x 4.
-- ---------------------------------------------------------------------------
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000001', 'settled', 3, 0, 'a')->>'settledCredits',
  '12', 'three standard pages settle 12 credits');
select is((select charge_basis from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000001'), 'pages', 'the ledger row says it was charged by pages');
select is((select metered_pages from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000001'), 3, 'the page count is recorded on the ledger row');
select is(pg_temp.balance('pilot-metera'), 1988, 'the whole hold was used, nothing returned');

-- ---------------------------------------------------------------------------
-- 3. Redelivery: same facts are a duplicate; different facts conflict.
-- ---------------------------------------------------------------------------
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000001', 'settled', 3, 0, 'a')->>'status',
  'duplicate', 'a retried settlement is a duplicate');
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000001', 'settled', 3, 0, 'a')->>'settledCredits',
  '12', 'the duplicate answers with the stored charge');
select is(pg_temp.balance('pilot-metera'), 1988, 'a retried settlement charges nothing twice');
select throws_ok(
  $$select pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000001', 'settled', 4, 0, 'a')$$,
  'foundation_compute_settlement_conflict',
  'a second settlement with a different page count is a conflict, not a re-charge');

-- ---------------------------------------------------------------------------
-- 4. Unchanged source, same workspace: free, and says why.
-- ---------------------------------------------------------------------------
select pg_temp.hold('pilot-metera', '91000000-0000-4000-8000-00000000000a', '92000000-0000-4000-8000-000000000002', 12, 18);
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000002', 'settled', 3, 0, 'a')->>'settledCredits',
  '0', 'the same source digest re-read in the same workspace settles 0');
select is((select charge_basis from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000002'), 'unchanged_source', 'the ledger row says why it was free');
select is((select charge_basis_reservation_id from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000002'),
  (select reservation_id from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000001'), 'and names the settled read it matched');
select is(pg_temp.balance('pilot-metera'), 1988, 'the free re-read returned its whole hold');

-- ---------------------------------------------------------------------------
-- 5. The same digest in another workspace is charged in full.
-- ---------------------------------------------------------------------------
select pg_temp.hold('pilot-meterb', '91000000-0000-4000-8000-00000000000b', '92000000-0000-4000-8000-0000000000b1', 12, 18);
select is(pg_temp.settle('pilot-meterb', '92000000-0000-4000-8000-0000000000b1', 'settled', 3, 0, 'a')->>'settledCredits',
  '12', 'a digest settled in another workspace is never free here');
select is((select charge_basis from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-0000000000b1'), 'pages', 'it is charged by its pages');
select is(pg_temp.balance('pilot-meterb'), 1988, 'workspace B paid for its own read');

-- ---------------------------------------------------------------------------
-- 6. Complex against standard: 2 standard + 1 complex = 2 x 4 + 6.
-- ---------------------------------------------------------------------------
select pg_temp.hold('pilot-metera', '91000000-0000-4000-8000-00000000000a', '92000000-0000-4000-8000-000000000003', 16, 24);
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000003', 'settled', 3, 1, 'c')->>'settledCredits',
  '14', 'one complex page of three settles 14, two more than three standard pages');
select is(pg_temp.balance('pilot-metera'), 1974, 'the unused 2 of the 16 hold came back');

-- ---------------------------------------------------------------------------
-- 7. Never above what the customer approved: the hold, when overage is off.
-- ---------------------------------------------------------------------------
-- An allowance grant turns overage on (0036); this section pins the paid account without it.
update public.foundation_billing_accounts set overage_enabled = false where workspace_key = 'pilot-metera';
select pg_temp.hold('pilot-metera', '91000000-0000-4000-8000-00000000000a', '92000000-0000-4000-8000-000000000004', 4, 6);
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000004', 'settled', 3, 0, 'd')->>'settledCredits',
  '4', 'a read longer than its approval settles at the hold when overage is off');
select is((select charge_basis from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000004'), 'pages_capped', 'and the ledger row says it was capped');
select is(pg_temp.balance('pilot-metera'), 1970, 'no overage was taken');
update public.foundation_billing_accounts set overage_enabled = true where workspace_key = 'pilot-metera';

-- ---------------------------------------------------------------------------
-- 8. A read that failed settles 0, with or without pages.
-- ---------------------------------------------------------------------------
select pg_temp.hold('pilot-metera', '91000000-0000-4000-8000-00000000000a', '92000000-0000-4000-8000-000000000005', 12, 18);
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000005', 'operator_review', null, null, 'e')->>'settledCredits',
  '0', 'operator review charges nothing');
select is((select charge_basis from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000005'), 'no_usable_output', 'and says the read produced nothing usable');
select is(pg_temp.balance('pilot-metera'), 1970, 'its hold came back');

-- ---------------------------------------------------------------------------
-- 9. A compile that failed gives back the pages no world used, once.
-- ---------------------------------------------------------------------------
insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids,
  idempotency_key, state, documents_total, collection_id, settled_at)
values
  ('cjob-' || repeat('1', 32), 'pilot-metera', '91000000-0000-4000-8000-00000000000a',
   array['92000000-0000-4000-8000-000000000001'], 'page-meter-ready', 'ready', 1,
   'collection-' || repeat('1', 32), now()),
  ('cjob-' || repeat('2', 32), 'pilot-metera', '91000000-0000-4000-8000-00000000000a',
   array['92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000003'],
   'page-meter-failed', 'structuring', 2, null, null),
  ('cjob-' || repeat('3', 32), 'pilot-meterb', '91000000-0000-4000-8000-00000000000b',
   array['92000000-0000-4000-8000-000000000003'], 'page-meter-other', 'structuring', 1, null, null);

update public.foundation_compile_jobs set state = 'failed', settled_at = now(), error_code = 'JSON_TOO_LARGE'
 where job_id = 'cjob-' || repeat('2', 32);
select is((select reversed_credits from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000003'), 14, 'the failed compile reverses the read no world used');
select is((select reversal_reason from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000003'), 'COMPILE_FAILED_NO_OUTPUT', 'and says why');
select ok((select reversed_at is null from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000001'), 'a read a ready world already used is kept');
select is(pg_temp.balance('pilot-metera'), 1984, 'the 14 credits are back in the balance');

update public.foundation_compile_jobs set error_code = 'COMPILE_RETRY_EXHAUSTED'
 where job_id = 'cjob-' || repeat('2', 32);
select is(pg_temp.balance('pilot-metera'), 1984, 'touching the failed job again reverses nothing twice');

update public.foundation_compile_jobs set state = 'failed', settled_at = now(), error_code = 'JSON_TOO_LARGE'
 where job_id = 'cjob-' || repeat('3', 32);
select is(pg_temp.balance('pilot-meterb'), 1988, 'a failed job in another workspace reverses nothing here or there');

-- ---------------------------------------------------------------------------
-- 10. A reversed read is not a paid-for source: re-reading it is charged.
-- ---------------------------------------------------------------------------
select pg_temp.hold('pilot-metera', '91000000-0000-4000-8000-00000000000a', '92000000-0000-4000-8000-000000000006', 12, 18);
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000006', 'settled', 3, 0, 'c')->>'chargeBasis',
  'pages', 'a source whose only read was reversed is charged when read again');
select is(pg_temp.balance('pilot-metera'), 1972, 'and pays for its pages');

-- ---------------------------------------------------------------------------
-- 11. Server only.
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated',
  'public.settle_foundation_compute_v4(text, uuid, text, integer, integer, text, text)', 'execute'),
  'a signed-in user cannot call the settlement');
select ok(not has_function_privilege('anon',
  'public.settle_foundation_compute_v4(text, uuid, text, integer, integer, text, text)', 'execute'),
  'an anonymous caller cannot call the settlement');

-- ---------------------------------------------------------------------------
-- 12. The ledger refuses page facts that are not a page count, whatever the caller checked.
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000001', 'settled', 0, null, 'a')$$,
  'foundation_compute_settlement_invalid', 'zero pages are refused');
select throws_ok($$select pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000001', 'settled', -1, null, 'a')$$,
  'foundation_compute_settlement_invalid', 'a negative page count is refused');
select throws_ok($$select pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000001', 'settled', 10001, null, 'a')$$,
  'foundation_compute_settlement_invalid', 'a page count above 10000 is refused');
select throws_ok($$select pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000001', 'settled', 3, 4, 'a')$$,
  'foundation_compute_settlement_invalid', 'more complex pages than pages is refused');

-- ---------------------------------------------------------------------------
-- 13. Overage on: charged up to the approved maximum, and a failed compile reverses exactly what
--     settlement booked -- the hold to the balance, the rest off the overage counters.
-- ---------------------------------------------------------------------------
select pg_temp.hold('pilot-metera', '91000000-0000-4000-8000-00000000000a', '92000000-0000-4000-8000-000000000007', 4, 12);
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000007', 'settled', 3, 0, '7')->>'settledCredits',
  '12', 'with overage on, three pages settle 12 against a hold of 4');
select pg_temp.hold('pilot-metera', '91000000-0000-4000-8000-00000000000a', '92000000-0000-4000-8000-000000000008', 4, 6);
select is(pg_temp.settle('pilot-metera', '92000000-0000-4000-8000-000000000008', 'settled', 3, 0, '8')->>'settledCredits',
  '6', 'and never above the approved maximum');
select is((select charge_basis from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000008'), 'pages_capped', 'the maximum cap says so');
select is(pg_temp.balance('pilot-metera'), 1964, 'the balance paid only the two holds of 4');
select is((select overage_units from public.foundation_billing_accounts where workspace_key = 'pilot-metera'),
  10, 'the 8 and 2 above the holds are overage');

insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids,
  idempotency_key, state, documents_total, collection_id, settled_at)
values
  ('cjob-' || repeat('4', 32), 'pilot-metera', '91000000-0000-4000-8000-00000000000a',
   array['92000000-0000-4000-8000-000000000007'], 'page-meter-overage', 'structuring', 1, null, null),
  ('cjob-' || repeat('5', 32), 'pilot-metera', '91000000-0000-4000-8000-00000000000a',
   array['92000000-0000-4000-8000-000000000008'], 'page-meter-cancel', 'structuring', 1, null, null),
  ('cjob-' || repeat('6', 32), 'pilot-metera', '91000000-0000-4000-8000-00000000000a',
   array['92000000-0000-4000-8000-000000000009'], 'page-meter-legacy', 'structuring', 1, null, null);

update public.foundation_compile_jobs set state = 'failed', settled_at = now(), error_code = 'JSON_TOO_LARGE'
 where job_id = 'cjob-' || repeat('4', 32);
select is((select reversed_credits from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000007'), 12, 'the whole 12 is reversed');
select is(pg_temp.balance('pilot-metera'), 1968, 'only the held 4 goes back to the balance');
select is((select overage_units from public.foundation_billing_accounts where workspace_key = 'pilot-metera'),
  2, 'the 8 of overage is no longer billed');
select is((select lifetime_overage_units from public.foundation_billing_accounts where workspace_key = 'pilot-metera'),
  2, 'nor counted as lifetime overage');

-- ---------------------------------------------------------------------------
-- 14. Cancelled is the customer's own stop: nothing is reversed.
-- ---------------------------------------------------------------------------
update public.foundation_compile_jobs set state = 'cancelled', settled_at = now()
 where job_id = 'cjob-' || repeat('5', 32);
select ok((select reversed_at is null from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000008'), 'a cancelled compile reverses nothing');
select is(pg_temp.balance('pilot-metera'), 1968, 'and moves no balance');

-- ---------------------------------------------------------------------------
-- 15. A pre-meter per-document charge is left as it was booked.
-- ---------------------------------------------------------------------------
select pg_temp.hold('pilot-metera', '91000000-0000-4000-8000-00000000000a', '92000000-0000-4000-8000-000000000009', 4, 6);
select public.settle_foundation_compute_v3('pilot-metera', '92000000-0000-4000-8000-000000000009'::uuid, 'settled', 4, 'OCR_COMPLETED');
update public.foundation_compile_jobs set state = 'failed', settled_at = now(), error_code = 'JSON_TOO_LARGE'
 where job_id = 'cjob-' || repeat('6', 32);
select ok((select reversed_at is null from public.foundation_compute_reservations
  where document_id = '92000000-0000-4000-8000-000000000009'), 'a read settled before the meter is not reversed');
select is(pg_temp.balance('pilot-metera'), 1964, 'and its charge stands');

select * from finish();
rollback;
