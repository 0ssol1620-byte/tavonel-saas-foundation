-- O04 — the billing ledger, reconciled against the real functions.
--
-- The audit asked for the ledger to be cross-checked across retry, duplicate webhook delivery,
-- completion-just-before-cancel, quota exhaustion and failure reprocessing. `lib/billing-
-- reconciliation.test.ts` covers what the application sends and what it does with each answer.
-- This file is the half that cannot be mocked: whether the same event applied twice moves
-- `credit_balance` twice. It runs in the db-rehearsal workflow (`supabase test db`) against a
-- disposable Postgres built from 0001 to head, and every row it writes is rolled back.
--
-- Read every assertion as an arithmetic statement about one account. 2,000 units are granted
-- once and nothing else grants anything, so any balance that is not explained by a hold, a
-- release or a charge is a reconciliation break.
--
-- The last two assertions were FINDING O04-1, written to the behaviour that existed rather
-- than the behaviour that is correct -- the same device `tenant_rls_deliberate_red.sql` uses.
-- `20260911120000_compute_settlement_expired_terminal.sql` fixed it and they now state the
-- fixed behaviour, so the file is green throughout and no deliberate-red marker is left here.
begin;
select plan(27);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '77777777-7777-7777-7777-777777777777',
  'authenticated', 'authenticated', 'reconciliation-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

-- ---------------------------------------------------------------------------
-- Duplicate webhook delivery. Paddle retries until it gets a 2xx, so the same
-- body arrives more than once by design.
-- ---------------------------------------------------------------------------

select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('recon1', 26, 'a'), 'transaction.completed', '2026-09-11T07:00:00Z',
    'sha256:' || repeat('1', 64), 'allowance',
    'pilot-recon00000000', '77777777-7777-7777-7777-777777777777',
    'observer_access', 'txn_' || rpad('recon1', 26, 'a'), 'ctm_' || rpad('recon1', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'allowance_granted',
  'the first delivery of a subscription transaction grants its allowance'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  2000,
  'the granted allowance is the whole of the balance'
);

select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('recon1', 26, 'a'), 'transaction.completed', '2026-09-11T07:00:00Z',
    'sha256:' || repeat('1', 64), 'allowance',
    'pilot-recon00000000', '77777777-7777-7777-7777-777777777777',
    'observer_access', 'txn_' || rpad('recon1', 26, 'a'), 'ctm_' || rpad('recon1', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'duplicate',
  'the same event id redelivered is answered as a duplicate'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  2000,
  'a redelivered webhook grants nothing a second time'
);

-- A different event id for a transaction already granted. This is the case an event-id-only
-- dedupe would miss: Paddle can emit a second event for one transaction.
select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('recon2', 26, 'b'), 'transaction.completed', '2026-09-11T07:05:00Z',
    'sha256:' || repeat('2', 64), 'allowance',
    'pilot-recon00000000', '77777777-7777-7777-7777-777777777777',
    'observer_access', 'txn_' || rpad('recon1', 26, 'a'), 'ctm_' || rpad('recon1', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'duplicate_transaction',
  'a new event id for an already-granted transaction cannot mint a second allowance'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  2000,
  'a duplicate transaction leaves the balance where it was'
);

select throws_ok(
  $$select public.apply_foundation_billing_event_v4(
    'evt_' || rpad('recon1', 26, 'a'), 'transaction.completed', '2026-09-11T07:00:00Z',
    'sha256:' || repeat('9', 64), 'allowance',
    'pilot-recon00000000', '77777777-7777-7777-7777-777777777777',
    'observer_access', 'txn_' || rpad('recon1', 26, 'a'), 'ctm_' || rpad('recon1', 26, 'a'),
    null, null, 2000, null
  )$$,
  'foundation_billing_event_id_conflict',
  'one event id may not describe two different payloads'
);
select is(
  (select count(*)::integer from public.foundation_billing_events where workspace_key = 'pilot-recon00000000'),
  2,
  'exactly one immutable receipt per distinct event survives'
);

-- ---------------------------------------------------------------------------
-- Reservation and settlement. The subscription state is set directly: this
-- fixture is about the compute ledger, not about how a plan is projected.
-- ---------------------------------------------------------------------------

update public.foundation_billing_accounts
   set access_plan = 'observer_access', subscription_status = 'active'
 where workspace_key = 'pilot-recon00000000';

select is(
  public.reserve_foundation_compute_v3(
    'pilot-recon00000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '77777777-7777-7777-7777-777777777777', 12, 18
  )->>'state',
  'reserved',
  'a funded workspace may hold compute for a document'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  1988,
  'the hold leaves the balance at the moment it is taken'
);

-- Retry after a transient failure: the caller cannot know whether the first attempt landed, so
-- it sends the same request again. Exactly-once is the document id, not the attempt.
select is(
  public.reserve_foundation_compute_v3(
    'pilot-recon00000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '77777777-7777-7777-7777-777777777777', 12, 18
  )->>'idempotentReplay',
  'true',
  'a retried reservation for the same document is a replay'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  1988,
  'a replayed reservation does not take the hold twice'
);

-- Cancelled after partial work: the transfer failed, nothing was computed, the hold goes back.
select is(
  public.settle_foundation_compute_v3(
    'pilot-recon00000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'released', 0, 'UPLOAD_TRANSFER_FAILED'
  )->>'releasedCredits',
  '12',
  'a release returns the whole hold'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  2000,
  'the released hold is back in the balance'
);
select is(
  public.settle_foundation_compute_v3(
    'pilot-recon00000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'released', 0, 'UPLOAD_TRANSFER_FAILED'
  )->>'status',
  'duplicate',
  'a redelivered settlement is a duplicate, not a second release'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  2000,
  'the redelivered release moves nothing'
);
select throws_ok(
  $$select public.settle_foundation_compute_v3(
    'pilot-recon00000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'settled', 12, 'OCR_COMPLETED'
  )$$,
  'foundation_compute_settlement_conflict',
  'a charge arriving after a release is refused rather than applied on top of it'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  2000,
  'the refused settlement charged nothing'
);

-- Quota exhausted. The refusal has to happen before any state is written, or a refused run
-- would leave a hold nobody settles.
select throws_ok(
  $$select public.reserve_foundation_compute_v3(
    'pilot-recon00000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '77777777-7777-7777-7777-777777777777', 60000, 60000
  )$$,
  'foundation_credits_required',
  'a reservation larger than the balance is refused'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  2000,
  'a refused reservation charges nothing and holds nothing'
);
select is(
  (select count(*)::integer from public.foundation_compute_reservations where workspace_key = 'pilot-recon00000000'),
  1,
  'one reservation row exists per document, however many attempts were made'
);

-- ---------------------------------------------------------------------------
-- FINDING O04-1, CLOSED — settlement after the expiry sweep.
--
-- `reserve_foundation_compute_v3` sweeps every reservation whose capability has
-- lapsed and returns its hold to `credit_balance`. `settle_foundation_compute_v3`
-- treated only `settled`, `released` and `operator_review` as terminal, so a
-- settlement arriving after the sweep ran the paid branch a second time and
-- returned the same hold again -- 2012 in an account that was ever granted 2000.
--
-- Direction mattered: it over-credited the account rather than double-charging the
-- customer, so it was not the failure the audit asked about -- and that question is
-- answered in the negative by the assertions above. It was still a reconciliation
-- break, and `20260911120000_compute_settlement_expired_terminal.sql` closed it by
-- adding `expired` to that terminal list under its own error name.
--
-- The two assertions below are therefore the fixed behaviour, not the broken one:
-- the late settlement is refused, and the ledger adds up to exactly what was
-- granted. They are what stops the regression coming back.
-- ---------------------------------------------------------------------------

select is(
  public.reserve_foundation_compute_v3(
    'pilot-recon00000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '77777777-7777-7777-7777-777777777777', 12, 18
  )->>'state',
  'reserved',
  'a second document takes its own hold'
);

-- Age the capability past its lifetime. `created_at` moves with it because the table refuses an
-- expiry that precedes creation, and nothing else reads either column.
update public.foundation_compute_reservations
   set created_at = clock_timestamp() - interval '20 minutes',
       expires_at = clock_timestamp() - interval '10 minutes'
 where document_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

-- Any later reservation in this workspace runs the sweep.
select is(
  public.reserve_foundation_compute_v3(
    'pilot-recon00000000', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '77777777-7777-7777-7777-777777777777', 4, 4
  )->>'state',
  'reserved',
  'the sweep runs on the next reservation and does not block it'
);
select is(
  (select state::text from public.foundation_compute_reservations where document_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'expired',
  'the lapsed capability is expired and its hold has been returned'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000'),
  1996,
  'the balance is the 2000 granted, less only the 4 still held'
);

select throws_ok(
  $$select public.settle_foundation_compute_v3(
    'pilot-recon00000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'released', 0, 'CDR_LATE_RELEASE'
  )$$,
  'foundation_compute_settlement_expired',
  'a settlement for an already-expired reservation is refused, under its own error name rather than as a conflict'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-recon00000000')
    + (select coalesce(sum(reserved_credits), 0)::integer from public.foundation_compute_reservations
        where workspace_key = 'pilot-recon00000000' and state = 'reserved'),
  2000,
  'balance plus outstanding holds is exactly the 2000 ever granted -- the expired hold was returned once'
);

select * from finish();
rollback;
