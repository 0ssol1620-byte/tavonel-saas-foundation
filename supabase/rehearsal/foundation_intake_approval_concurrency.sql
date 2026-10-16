-- Companion to supabase/tests/foundation_intake_approval.sql: the two properties one pgTAP
-- transaction cannot exercise, run as real concurrent sessions against
-- 20261003120000_intake_approval_budget_invariants.sql.
--
--   1. Two sessions create and reserve the same attempt at the same time: one approval row, one
--      reservation per member, one hold per member.
--   2. A confirmed member may be cancelled when the dependent set fails: cancellation waits for
--      confirm, then releases every still-reserved member exactly once. If cancellation commits
--      first, the later confirm is refused.
--
-- DISPOSABLE DATABASE ONLY. Unlike the pgTAP file this script COMMITS its fixture, and the
-- approval tables refuse DELETE by design, so the rows stay until the database is thrown away.
-- `setup` refuses to run twice.
--
-- It lives outside supabase/tests on purpose: `supabase test db` would otherwise run it as a
-- pgTAP file. Run it from a POSIX shell with psql on PATH and DB_URL pointing at a database
-- migrated from 0001 to head:
--
--   F=supabase/rehearsal/foundation_intake_approval_concurrency.sql
--   P="psql $DB_URL -X -q -v ON_ERROR_STOP=1 -f $F"
--   $P -v phase=setup
--   $P -v phase=duplicate & $P -v phase=duplicate & wait          # both print the same ids
--   $P -v phase=admit
--   $P -v phase=hold_confirm & sleep 1; $P -v phase=late_cancel & wait
--   $P -v phase=hold_cancel  & sleep 1; $P -v phase=late_confirm & wait
--   $P -v phase=verify                                              # exits non-zero on any break
--
-- The `hold_*` phases keep their transaction open for three seconds after deciding, so the
-- `late_*` session started one second later blocks on the same advisory lock and approval row
-- and only then reads the decision. Each `late_*` phase fails the run unless it was refused with
-- exactly the expected error.

\set ws 'pilot-7777777777774777'
\set uid '77777777-7777-4777-8777-777777777709'
\set attempt 'attempt-cancel-race10'

select :'phase' = 'setup' as is_setup,
       :'phase' = 'duplicate' as is_duplicate,
       :'phase' = 'admit' as is_admit,
       :'phase' = 'hold_confirm' as is_hold_confirm,
       :'phase' = 'late_cancel' as is_late_cancel,
       :'phase' = 'hold_cancel' as is_hold_cancel,
       :'phase' = 'late_confirm' as is_late_confirm,
       :'phase' = 'verify' as is_verify
\gset

\if :is_setup
begin;
do $$
begin
  if exists (select 1 from auth.users where id = '77777777-7777-4777-8777-777777777709') then
    raise exception 'REHEARSAL_SETUP_ALREADY_RAN: use a fresh disposable database';
  end if;
end $$;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', :'uid',
  'authenticated', 'authenticated', 'approval-cancel-race10@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
select public.apply_foundation_billing_event_v4(
  'evt_' || rpad('canceldelta10', 26, 'a'), 'transaction.completed', '2026-10-03T07:00:00Z',
  'sha256:' || repeat('4', 64), 'allowance',
  :'ws', :'uid', 'observer_access',
  'txn_' || rpad('canceldelta10', 26, 'a'), 'ctm_' || rpad('canceldelta10', 26, 'a'),
  null, null, 2000, null
)->>'status' as allowance;
update public.foundation_billing_accounts
   set access_plan = 'observer_access', subscription_status = 'active'
 where workspace_key = :'ws';
commit;
\endif

\if :is_duplicate
begin;
select public.create_foundation_intake_approval(
  :'ws', :'uid', :'attempt', 'sha256:' || repeat('6', 64), 'sha256:' || repeat('f', 64), 24,
  jsonb_build_array(
    jsonb_build_object('fileKey', 'file-race-confirm', 'contentSha256', 'sha256:' || repeat('c', 64),
      'byteLength', 2048, 'mimeType', 'application/pdf', 'pageBasis', 'declared',
      'approvedMaxPages', 2, 'reservedCredits', 8, 'maximumCredits', 12),
    jsonb_build_object('fileKey', 'file-race-cancel', 'contentSha256', 'sha256:' || repeat('d', 64),
      'byteLength', 2048, 'mimeType', 'application/pdf', 'pageBasis', 'declared',
      'approvedMaxPages', 2, 'reservedCredits', 8, 'maximumCredits', 12))
)->>'approvalId' as approval_id;
select public.reserve_foundation_intake_approved_file(
  :'ws', :'uid', :'attempt',
  (select scope_digest from public.foundation_intake_approvals where attempt_key = :'attempt'),
  'sha256:' || repeat('f', 64), 'file-race-confirm'
)->>'reservationId' as confirm_reservation_id;
select public.reserve_foundation_intake_approved_file(
  :'ws', :'uid', :'attempt',
  (select scope_digest from public.foundation_intake_approvals where attempt_key = :'attempt'),
  'sha256:' || repeat('f', 64), 'file-race-cancel'
)->>'reservationId' as cancel_reservation_id;
-- Hold the transaction open so the twin session is still waiting when this one commits.
select pg_sleep(2);
commit;
\endif

\if :is_admit
do $$
declare
  v_doc uuid;
begin
  select f.document_id into v_doc
    from public.foundation_intake_approval_files f
    join public.foundation_intake_approvals a on a.approval_id = f.approval_id
   where a.attempt_key = 'attempt-cancel-race10' and f.file_key = 'file-race-confirm';
  perform public.reserve_foundation_intake_admission(
    'pilot-7777777777774777', v_doc, '77777777-7777-4777-8777-777777777709',
    'quarantine/pilot-7777777777774777/' || v_doc::text || '/source', 2048, 'application/pdf');
  perform public.confirm_foundation_intake_admission(
    'pilot-7777777777774777', v_doc, '77777777-7777-4777-8777-777777777709',
    'sha256:' || repeat('c', 64), 2048, 'application/pdf');
end $$;
\endif

\if :is_hold_confirm
begin;
select public.confirm_foundation_intake_approved_file(
  :'ws', :'uid', :'attempt',
  (select scope_digest from public.foundation_intake_approvals where attempt_key = :'attempt'),
  'file-race-confirm'
)->>'fileState' as decided;
select pg_sleep(3);
commit;
\endif

\if :is_late_cancel
do $$
declare result jsonb;
begin
  result := public.cancel_foundation_intake_approved_file(
    'pilot-7777777777774777', '77777777-7777-4777-8777-777777777709', 'attempt-cancel-race10',
    'file-race-confirm', 'CLIENT_CANCELLED');
  if result->>'status' <> 'cancelled' or result->>'reconciliationRequired' <> 'false' then
    raise exception 'VERIFY_FAILED: late cancellation returned %', result;
  end if;
  raise notice 'late cancellation safely canceled the set and released its active holds';
end $$;
\endif

\if :is_hold_cancel
begin;
select public.cancel_foundation_intake_approved_file(
  :'ws', :'uid', :'attempt', 'file-race-cancel', 'CLIENT_CANCELLED'
)->>'status' as decided;
select pg_sleep(3);
commit;
\endif

\if :is_late_confirm
do $$
begin
  perform public.confirm_foundation_intake_approved_file(
    'pilot-7777777777774777', '77777777-7777-4777-8777-777777777709', 'attempt-cancel-race10',
    (select scope_digest from public.foundation_intake_approvals
      where attempt_key = 'attempt-cancel-race10'),
    'file-race-cancel');
  raise exception 'REHEARSAL_UNEXPECTED: confirm succeeded after a committed cancel';
exception when others then
  if sqlerrm <> 'foundation_intake_approval_file_cancelled' then
    raise;
  end if;
  raise notice 'late confirm refused as expected: %', sqlerrm;
end $$;
\endif

\if :is_verify
do $$
declare
  v_approvals integer;
  v_files integer;
  v_reservations integer;
  v_confirm text;
  v_cancel text;
  v_balance integer;
begin
  select count(*) into v_approvals from public.foundation_intake_approvals
   where workspace_key = 'pilot-7777777777774777' and attempt_key = 'attempt-cancel-race10';
  if v_approvals <> 1 then
    raise exception 'VERIFY_FAILED: % approval rows for one attempt', v_approvals;
  end if;

  select count(*) into v_files
    from public.foundation_intake_approval_files f
    join public.foundation_intake_approvals a on a.approval_id = f.approval_id
   where a.attempt_key = 'attempt-cancel-race10';
  if v_files <> 2 then
    raise exception 'VERIFY_FAILED: % member rows, expected 2', v_files;
  end if;

  select count(*) into v_reservations
    from public.foundation_compute_reservations r
    join public.foundation_intake_approval_files f on f.document_id = r.document_id
    join public.foundation_intake_approvals a on a.approval_id = f.approval_id
   where a.attempt_key = 'attempt-cancel-race10';
  if v_reservations <> 2 then
    raise exception 'VERIFY_FAILED: % reservations, expected exactly one per member', v_reservations;
  end if;

  select f.state || '/' || r.state::text into v_confirm
    from public.foundation_intake_approval_files f
    join public.foundation_intake_approvals a on a.approval_id = f.approval_id
    join public.foundation_compute_reservations r on r.document_id = f.document_id
   where a.attempt_key = 'attempt-cancel-race10' and f.file_key = 'file-race-confirm';
  if v_confirm <> 'cancelled/released' then
    raise exception 'VERIFY_FAILED: confirmed-then-cancelled member is %, expected cancelled/released', v_confirm;
  end if;

  select f.state || '/' || r.state::text into v_cancel
    from public.foundation_intake_approval_files f
    join public.foundation_intake_approvals a on a.approval_id = f.approval_id
    join public.foundation_compute_reservations r on r.document_id = f.document_id
   where a.attempt_key = 'attempt-cancel-race10' and f.file_key = 'file-race-cancel';
  if v_cancel <> 'cancelled/released' then
    raise exception 'VERIFY_FAILED: cancel race member is %, expected cancelled/released', v_cancel;
  end if;

  -- 2000 granted; two holds of 8 taken once each despite two creating sessions; cancellation
  -- returned both active holds once, and the late duplicate moved nothing.
  select credit_balance into v_balance from public.foundation_billing_accounts
   where workspace_key = 'pilot-7777777777774777';
  if v_balance <> 2000 then
    raise exception 'VERIFY_FAILED: balance %, expected 2000', v_balance;
  end if;

  raise notice 'VERIFY_OK: 1 approval, 2 members, 2 reservations, cancellation released both holds exactly once, balance 2000';
end $$;
\endif
