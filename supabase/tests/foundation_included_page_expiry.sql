-- FD-03 — included pages do not roll over, and the ledger is what says so.
--
-- `20260911130000_included_page_expiry_at_renewal.sql` expires the remainder of a billing month's
-- included pages when the next month's grant lands. Every assertion below is an arithmetic
-- statement about one account, and the two numbers that matter are 2,000 included pages per
-- Developer month and a 300-unit credit pack the customer bought outright. The pack is the point
-- of the fixture: it is the credit that must survive every expiry, because the customer paid for
-- it separately and no included-page term covers it.
--
-- It runs in the db-rehearsal workflow (`supabase test db`) against a disposable Postgres built
-- from 0001 to head, and every row it writes is rolled back.
--
-- The credit pack is granted through v1 `apply_foundation_billing_event`, which is the only
-- function that writes `kind = 'purchased'` -- no offer in `billing-catalog.ts` is a credit pack
-- today, so the webhook parser cannot produce one and the live path cannot be used to create the
-- case. EXECUTE on v1 is revoked from every role including service_role (0009); this fixture runs
-- as the database owner, which is also why nothing here proves anything about who may call it.
begin;
select plan(34);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88888888-8888-8888-8888-888888888888',
  'authenticated', 'authenticated', 'expiry-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

-- ---------------------------------------------------------------------------
-- Month 1. The first grant has no predecessor, so it expires nothing: an
-- account's opening balance is not somebody's unused allowance.
-- ---------------------------------------------------------------------------

select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('exp1', 26, 'a'), 'transaction.completed', '2026-08-11T07:00:00Z',
    'sha256:' || repeat('1', 64), 'allowance',
    'pilot-expiry01', '88888888-8888-8888-8888-888888888888',
    'observer_access', 'txn_' || rpad('exp1', 26, 'a'), 'ctm_' || rpad('exp1', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'allowance_granted',
  'the first month of a subscription grants its included pages'
);
select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('exp1', 26, 'a'), 'transaction.completed', '2026-08-11T07:00:00Z',
    'sha256:' || repeat('1', 64), 'allowance',
    'pilot-expiry01', '88888888-8888-8888-8888-888888888888',
    'observer_access', 'txn_' || rpad('exp1', 26, 'a'), 'ctm_' || rpad('exp1', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'duplicate',
  'the same grant redelivered grants nothing a second time'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  2000,
  'the first month opens at exactly its included pages'
);
select is(
  (select count(*)::integer from public.foundation_credit_ledger
    where workspace_key = 'pilot-expiry01' and kind = 'allowance_expired'),
  0,
  'a first grant writes no expiry row'
);

-- A credit pack, bought outright. This is not an included page and no expiry may touch it.
select is(
  public.apply_foundation_billing_event(
    'evt_' || rpad('prc1', 26, 'b'), 'transaction.paid', '2026-08-11T07:05:00Z',
    'sha256:' || repeat('2', 64), 'purchase',
    'pilot-expiry01', '88888888-8888-8888-8888-888888888888',
    'credit_starter', 'txn_' || rpad('prc1', 26, 'b'), 'ctm_' || rpad('exp1', 26, 'a'),
    null, null, 300, null
  )->>'status',
  'processed',
  'a purchased credit pack is projected into the same balance'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  2300,
  'purchased credit and included pages share one balance -- which is the whole difficulty'
);

-- ---------------------------------------------------------------------------
-- Month 1, partial use. The plan state is set directly: this fixture is about
-- the ledger, not about how a subscription is projected.
-- ---------------------------------------------------------------------------

update public.foundation_billing_accounts
   set access_plan = 'observer_access', subscription_status = 'active'
 where workspace_key = 'pilot-expiry01';

select is(
  public.reserve_foundation_compute_v3(
    'pilot-expiry01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '88888888-8888-8888-8888-888888888888', 800, 900
  )->>'state',
  'reserved',
  'the account holds compute for a document'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  1500,
  'the hold leaves the balance at the moment it is taken'
);
select is(
  public.settle_foundation_compute_v3(
    'pilot-expiry01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'settled', 850, 'OCR_COMPLETED'
  )->>'overageCredits',
  '50',
  'work above the hold is accrued as overage rather than taken from the balance'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  1500,
  '850 units of work leave 1500 of the 2300 that were granted'
);
select is(
  (select overage_units from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  50,
  'the overage is a debt on its own column, not a credit in the balance'
);

-- ---------------------------------------------------------------------------
-- Month 2. The renewal grant expires what is left of month 1 -- and only the
-- included-page part of it.
-- ---------------------------------------------------------------------------

select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('exp2', 26, 'c'), 'transaction.completed', '2026-09-11T07:00:00Z',
    'sha256:' || repeat('3', 64), 'allowance',
    'pilot-expiry01', '88888888-8888-8888-8888-888888888888',
    'observer_access', 'txn_' || rpad('exp2', 26, 'c'), 'ctm_' || rpad('exp1', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'allowance_granted',
  'the renewal transaction grants the next month'
);
select is(
  (select credit_delta from public.foundation_credit_ledger
    where event_id = 'evt_' || rpad('exp2', 26, 'c') and kind = 'allowance_expired'),
  -1200,
  'the expiry is a ledger row of its own: 1500 held, less the 300 purchased floor'
);
select is(
  (select count(*)::integer from public.foundation_credit_ledger
    where workspace_key = 'pilot-expiry01' and kind = 'allowance_expired'),
  1,
  'one expiry row, written by the grant that caused it'
);
select is(
  (select transaction_id from public.foundation_credit_ledger
    where event_id = 'evt_' || rpad('exp2', 26, 'c') and kind = 'allowance_expired'),
  'txn_' || rpad('exp2', 26, 'c'),
  'the expiry row records the transaction whose grant triggered it'
);
select is(
  (select offer_code from public.foundation_credit_ledger
    where event_id = 'evt_' || rpad('exp2', 26, 'c') and kind = 'allowance_expired'),
  'observer_access',
  'and the plan whose included pages expired'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  2300,
  'the balance after the renewal is the new month plus the purchased pack, and nothing else'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01')
    - (select coalesce(sum(credit_delta), 0)::integer from public.foundation_credit_ledger
        where workspace_key = 'pilot-expiry01' and kind = 'purchased'),
  2000,
  'net of every purchased credit, exactly one month of included pages remains'
);
select is(
  (select lifetime_credits_purchased from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  300,
  'the expiry did not touch the purchased lifetime'
);
select is(
  (select overage_units from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  50,
  'nor the accrued overage'
);
select is(
  (select lifetime_allowance_units from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  4000,
  'two months of included pages were granted in total, whatever survives of them'
);
select is(
  (select count(*)::integer from public.foundation_credit_ledger where workspace_key = 'pilot-expiry01'),
  4,
  'four ledger rows: two grants, one purchase, one expiry -- nothing was rewritten in place'
);

-- ---------------------------------------------------------------------------
-- At-least-once delivery. Paddle retries until it gets a 2xx, and an expiry
-- that ran twice would take a month of pages the customer never had.
-- ---------------------------------------------------------------------------

select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('exp2', 26, 'c'), 'transaction.completed', '2026-09-11T07:00:00Z',
    'sha256:' || repeat('3', 64), 'allowance',
    'pilot-expiry01', '88888888-8888-8888-8888-888888888888',
    'observer_access', 'txn_' || rpad('exp2', 26, 'c'), 'ctm_' || rpad('exp1', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'duplicate',
  'the renewal event redelivered is answered as a duplicate'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  2300,
  'a redelivered renewal neither grants nor expires a second time'
);
select is(
  (select count(*)::integer from public.foundation_credit_ledger
    where workspace_key = 'pilot-expiry01' and kind = 'allowance_expired'),
  1,
  'still one expiry row after the redelivery'
);

-- A second event id for a transaction already granted: the case an event-id-only dedupe misses.
select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('exp3', 26, 'd'), 'transaction.completed', '2026-09-11T07:10:00Z',
    'sha256:' || repeat('4', 64), 'allowance',
    'pilot-expiry01', '88888888-8888-8888-8888-888888888888',
    'observer_access', 'txn_' || rpad('exp2', 26, 'c'), 'ctm_' || rpad('exp1', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'duplicate_transaction',
  'a new event id for an already-granted transaction grants nothing'
);
select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('exp3', 26, 'd'), 'transaction.completed', '2026-09-11T07:10:00Z',
    'sha256:' || repeat('4', 64), 'allowance',
    'pilot-expiry01', '88888888-8888-8888-8888-888888888888',
    'observer_access', 'txn_' || rpad('exp2', 26, 'c'), 'ctm_' || rpad('exp1', 26, 'a'),
    null, null, 2000, null
  )->>'expiredIncludedUnits',
  '0',
  'and expires nothing either -- no grant, no expiry'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  2300,
  'the duplicate transaction leaves the balance where it was'
);
select is(
  (select count(*)::integer from public.foundation_credit_ledger
    where workspace_key = 'pilot-expiry01' and kind = 'allowance_expired'),
  1,
  'and writes no second expiry row'
);

-- A refused event expires nothing: the conflict is raised before any write.
select throws_ok(
  $$select public.apply_foundation_billing_event_v4(
    'evt_' || rpad('exp2', 26, 'c'), 'transaction.completed', '2026-09-11T07:00:00Z',
    'sha256:' || repeat('9', 64), 'allowance',
    'pilot-expiry01', '88888888-8888-8888-8888-888888888888',
    'observer_access', 'txn_' || rpad('exp2', 26, 'c'), 'ctm_' || rpad('exp1', 26, 'a'),
    null, null, 2000, null
  )$$,
  'foundation_billing_event_id_conflict',
  'one event id may not describe two different payloads'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  2300,
  'the refused event expired nothing'
);

-- ---------------------------------------------------------------------------
-- A plan change is not a period end. The observer -> studio replacement (0010)
-- lands mid-month, while the Developer month it replaces is still paid for, so
-- its remainder must survive. This is also the documented ceiling: the floor
-- keeps the pre-upgrade grants, so a later Team renewal may expire less than
-- the true remainder. Under-expiring is the direction this is allowed to fail.
-- ---------------------------------------------------------------------------

select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('exp4', 26, 'e'), 'transaction.completed', '2026-09-20T07:00:00Z',
    'sha256:' || repeat('5', 64), 'allowance',
    'pilot-expiry01', '88888888-8888-8888-8888-888888888888',
    'studio_access', 'txn_' || rpad('exp4', 26, 'e'), 'ctm_' || rpad('exp1', 26, 'a'),
    null, null, 10000, null
  )->>'expiredIncludedUnits',
  '0',
  'a grant for a different plan expires none of the plan it replaces'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-expiry01'),
  12300,
  'the upgraded account keeps the month it paid for, plus the plan it just bought'
);
select is(
  (select count(*)::integer from public.foundation_credit_ledger
    where workspace_key = 'pilot-expiry01' and kind = 'allowance_expired'),
  1,
  'the upgrade wrote no expiry row'
);

select * from finish();
rollback;
