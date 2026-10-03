-- Executed assertions for 20261003120000_intake_approval_budget_invariants.sql -- phase A of the
-- held intake-approval stack. Run with `supabase test db` against a disposable database migrated
-- from 0001 to head; every row written here is rolled back.
--
-- Every assertion reads a row, a reservation or a balance the real functions wrote; nothing here
-- greps SQL text. Read the paid block as arithmetic on one account: 2000 units are granted once
-- and nothing else in this file grants any, so every balance below is explained by a hold, a
-- release or a charge, or it is a break.
--
-- Credit amounts in the manifests are fixture quotes standing in for what the server's
-- quoteCompilePages would send. They are not price constants and nothing here asserts a price.
--
-- What one transaction cannot show is two sessions racing. The serial halves are here (a retried
-- create/reserve is a replay; the unique key refuses a second row; a cancel after a confirm still
-- cancels the whole set and releases the confirmed hold once; a confirm after a cancel is
-- refused). The real concurrent run is
-- supabase/rehearsal/foundation_intake_approval_concurrency.sql, with its own instructions.
begin;
select plan(154);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '88880001-8888-4888-8888-888888888801',
   'authenticated', 'authenticated', 'approval-paid@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '88880002-8888-4888-8888-888888888802',
   'authenticated', 'authenticated', 'approval-trial@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '88880003-8888-4888-8888-888888888803',
   'authenticated', 'authenticated', 'approval-owner@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- ---------------------------------------------------------------------------------------------
-- Helpers. Session-local, gone at rollback.
-- ---------------------------------------------------------------------------------------------

create function pg_temp.digest(p_hex text) returns text
language sql immutable as $fn$ select 'sha256:' || repeat(p_hex, 64) $fn$;

create function pg_temp.file(
  p_key text, p_hex text, p_bytes integer, p_mime text, p_basis text,
  p_pages integer, p_reserved integer, p_maximum integer
) returns jsonb
language sql immutable as $fn$
  select jsonb_build_object(
    'fileKey', p_key, 'contentSha256', 'sha256:' || repeat(p_hex, 64), 'byteLength', p_bytes,
    'mimeType', p_mime, 'pageBasis', p_basis, 'approvedMaxPages', p_pages,
    'reservedCredits', p_reserved, 'maximumCredits', p_maximum)
$fn$;

-- The mixed selection: a measured 3-page PDF and a spreadsheet whose pages cannot be counted.
create function pg_temp.a1_files() returns jsonb
language sql immutable as $fn$
  select jsonb_build_array(
    pg_temp.file('file-known-pdf', 'a', 120000, 'application/pdf', 'measured', 3, 12, 18),
    pg_temp.file('file-unknown-xlsx', 'b', 64000,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'unknown', 80, 40, 60))
$fn$;

create function pg_temp.approval(p_attempt text) returns uuid
language sql stable as $fn$
  select approval_id from public.foundation_intake_approvals where attempt_key = p_attempt
$fn$;

create function pg_temp.scope(p_attempt text) returns text
language sql stable as $fn$
  select scope_digest from public.foundation_intake_approvals where attempt_key = p_attempt
$fn$;

create function pg_temp.doc(p_attempt text, p_file text) returns uuid
language sql stable as $fn$
  select f.document_id
    from public.foundation_intake_approval_files f
    join public.foundation_intake_approvals a on a.approval_id = f.approval_id
   where a.attempt_key = p_attempt and f.file_key = p_file
$fn$;

create function pg_temp.balance(p_workspace text) returns integer
language sql stable as $fn$
  select credit_balance from public.foundation_billing_accounts where workspace_key = p_workspace
$fn$;

-- "<maximum_credits>/<state>" of the one reservation behind a member.
create function pg_temp.reservation(p_attempt text, p_file text) returns text
language sql stable as $fn$
  select r.maximum_credits::text || '/' || r.state::text
    from public.foundation_compute_reservations r
   where r.document_id = pg_temp.doc(p_attempt, p_file)
$fn$;

-- "<member state>/<reservation state>" of one member; 'none' when it holds no reservation.
create function pg_temp.member_state(p_attempt text, p_file text) returns text
language sql stable as $fn$
  select f.state || '/' || coalesce(r.state::text, 'none')
    from public.foundation_intake_approval_files f
    left join public.foundation_compute_reservations r on r.document_id = f.document_id
   where f.document_id = pg_temp.doc(p_attempt, p_file)
$fn$;

-- One paid-workspace cancellation, answered as "<status>/<reconciliationRequired>".
create function pg_temp.cancel_set(p_attempt text, p_file text) returns text
language sql as $fn$
  select (c->>'status') || '/' || (c->>'reconciliationRequired')
    from public.cancel_foundation_intake_approved_file(
      'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', p_attempt, p_file,
      'CLIENT_CANCELLED') as c
$fn$;

create function pg_temp.cancel_then_abort(p_attempt text, p_file text) returns text
language plpgsql as $fn$
begin
  perform public.cancel_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', p_attempt, p_file,
    'CLIENT_CANCELLED');
  raise exception 'forced_cancel_rollback';
end
$fn$;

create temp table cancellation_balance_baseline(attempt_key text primary key, balance integer not null);

-- The existing intake path, unchanged: admit the object, then confirm what was stored.
create function pg_temp.admit(
  p_workspace text, p_document uuid, p_user uuid, p_hex text, p_bytes integer, p_mime text
) returns text
language plpgsql as $fn$
begin
  perform public.reserve_foundation_intake_admission(
    p_workspace, p_document, p_user,
    'quarantine/' || p_workspace || '/' || p_document::text || '/source', p_bytes, p_mime);
  return public.confirm_foundation_intake_admission(
    p_workspace, p_document, p_user, 'sha256:' || repeat(p_hex, 64), p_bytes, p_mime)->>'status';
end
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures for the three billing sources. The paid allowance goes through the real billing
-- event function; the evaluation and owner rows are written directly, because what is under
-- test is the approval contract, not how a trial or a grant is created.
-- ---------------------------------------------------------------------------------------------

select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('apprpaid', 26, 'a'), 'transaction.completed', '2026-10-03T07:00:00Z',
    'sha256:' || repeat('3', 64), 'allowance',
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801',
    'observer_access', 'txn_' || rpad('apprpaid', 26, 'a'), 'ctm_' || rpad('apprpaid', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'allowance_granted',
  'fixture: the paid workspace is granted 2000 units, once'
);
update public.foundation_billing_accounts
   set access_plan = 'observer_access', subscription_status = 'active'
 where workspace_key = 'pilot-apprpaid01';

-- Reservation rows have a workspace FK into billing_accounts even when the reservation is
-- funded by the trial or owner branch. These zero-balance rows are the minimum account binding;
-- the trial/grant below still decides the actual billing source.
insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, subscription_status)
values
  ('pilot-apprtrial01', '88880002-8888-4888-8888-888888888802', 'observer_access', 'inactive'),
  ('pilot-approwner01', '88880003-8888-4888-8888-888888888803', 'studio_access', 'inactive');

insert into public.foundation_self_service_trials (user_id, workspace_key, status, started_at, expires_at)
values ('88880002-8888-4888-8888-888888888802', 'pilot-apprtrial01', 'trialing', now(), now() + interval '7 days');

insert into public.foundation_account_access_grants (
  user_id, grant_kind, access_plan, billing_exempt, trial_exempt, active
) values ('88880003-8888-4888-8888-888888888803', 'owner', 'studio_access', true, true, true);

-- ---------------------------------------------------------------------------------------------
-- Refused before anything is written
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-invalid-unknown1',
    pg_temp.digest('6'), pg_temp.digest('f'), 60,
    jsonb_build_array(pg_temp.file('file-unknown-xlsx', 'b', 64000,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'unknown', 40, 40, 60)))$$,
  'foundation_intake_approval_unknown_ceiling_required',
  'an unknown-page format approved below the 80-page ceiling is refused'
);
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-invalid-known081',
    pg_temp.digest('6'), pg_temp.digest('f'), 18,
    jsonb_build_array(pg_temp.file('file-known-pdf', 'a', 120000, 'application/pdf', 'measured', 81, 12, 18)))$$,
  'foundation_intake_approval_invalid',
  'no member may be approved past the 80-page processing ceiling'
);
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-invalid-under077',
    pg_temp.digest('6'), pg_temp.digest('f'), 77, pg_temp.a1_files())$$,
  'foundation_intake_approval_aggregate_mismatch',
  'an aggregate claimed below the sum of member maxima is refused, not corrected'
);
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-invalid-over0079',
    pg_temp.digest('6'), pg_temp.digest('f'), 79, pg_temp.a1_files())$$,
  'foundation_intake_approval_aggregate_mismatch',
  'an aggregate claimed above the sum of member maxima is refused too'
);
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880002-8888-4888-8888-888888888802', 'attempt-invalid-principal',
    pg_temp.digest('6'), pg_temp.digest('f'), 78, pg_temp.a1_files())$$,
  'foundation_intake_approval_principal_mismatch',
  'a principal with no server-established binding to the workspace cannot approve for it'
);
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-invalid-duplicate',
    pg_temp.digest('6'), pg_temp.digest('f'), 36,
    jsonb_build_array(pg_temp.a1_files()->0, pg_temp.a1_files()->0))$$,
  'foundation_intake_approval_invalid',
  'one stable file key may appear once in a manifest'
);
select is(
  (select count(*)::integer from public.foundation_intake_approvals where attempt_key like 'attempt-invalid-%'),
  0,
  'none of the refused manifests left an approval row'
);

-- ---------------------------------------------------------------------------------------------
-- Known cap and the mixed aggregate
-- ---------------------------------------------------------------------------------------------

select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.digest('6'), pg_temp.digest('f'), 78, pg_temp.a1_files())->>'idempotentReplay',
  'false',
  'a complete mixed manifest is approved'
);
select is(
  (select aggregate_maximum_credits from public.foundation_intake_approvals where attempt_key = 'attempt-paid-mixed-0001'),
  78,
  'the approved aggregate is the known file maximum plus the unknown file at its full ceiling'
);
select is(
  (select aggregate_maximum_pages from public.foundation_intake_approvals where attempt_key = 'attempt-paid-mixed-0001'),
  83,
  'the unknown spreadsheet is counted in the page aggregate, not omitted from it'
);
select is(
  (select approved_max_pages::text || '/' || page_basis from public.foundation_intake_approval_files
    where document_id = pg_temp.doc('attempt-paid-mixed-0001', 'file-unknown-xlsx')),
  '80/unknown',
  'the unknown member carries the 80-page ceiling and says why'
);
select is(
  (select expires_at - created_at from public.foundation_intake_approvals where attempt_key = 'attempt-paid-mixed-0001'),
  interval '10 minutes',
  'the approval lives ten minutes'
);

-- Retry with the same idempotency key.
select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.digest('6'), pg_temp.digest('f'), 78, pg_temp.a1_files())->>'approvalId',
  pg_temp.approval('attempt-paid-mixed-0001')::text,
  'an identical retry returns the same approval'
);
select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.digest('6'), pg_temp.digest('f'), 78,
    jsonb_build_array(pg_temp.a1_files()->1, pg_temp.a1_files()->0))->>'approvalId',
  pg_temp.approval('attempt-paid-mixed-0001')::text,
  'the manifest is a set: the same members in another order are the same approval'
);

-- Changed scope or pricing under the same key.
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.digest('6'), pg_temp.digest('9'), 78, pg_temp.a1_files())$$,
  'foundation_intake_approval_conflict',
  'a changed pricing fingerprint under the same attempt conflicts; it is never a silent reprice'
);
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.digest('6'), pg_temp.digest('f'), 78,
    jsonb_build_array(
      pg_temp.file('file-known-pdf', '8', 120000, 'application/pdf', 'measured', 3, 12, 18),
      pg_temp.a1_files()->1))$$,
  'foundation_intake_approval_conflict',
  'a member whose content digest changed is a different scope'
);
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.digest('6'), pg_temp.digest('f'), 18, jsonb_build_array(pg_temp.a1_files()->0))$$,
  'foundation_intake_approval_conflict',
  'a subset of the approved selection is a different scope, not a narrower replay'
);
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.digest('7'), pg_temp.digest('f'), 78, pg_temp.a1_files())$$,
  'foundation_intake_approval_conflict',
  'a different client manifest digest under the same attempt conflicts'
);
select is(
  (select count(*)::integer from public.foundation_intake_approvals where attempt_key = 'attempt-paid-mixed-0001'),
  1,
  'one approval row for one attempt, however many times and however it was retried'
);
select is(
  (select sum(approved_maximum_credits)::integer from public.foundation_intake_approval_files
    where approval_id = pg_temp.approval('attempt-paid-mixed-0001')),
  78,
  'the refused retries left the approved members as they were'
);

-- Reservations are the approved amounts, once.
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.scope('attempt-paid-mixed-0001'), pg_temp.digest('f'), 'file-known-pdf')->>'reservationState',
  'reserved',
  'the known member is reserved under its approval'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1988, 'the hold is the approved reserved amount, 12');
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.scope('attempt-paid-mixed-0001'), pg_temp.digest('f'), 'file-known-pdf')->>'idempotentReplay',
  'true',
  'a retried reservation for the same attempt and member is a replay'
);
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.scope('attempt-paid-mixed-0001'), pg_temp.digest('f'), 'file-known-pdf')->>'reservationId',
  (select reservation_id::text from public.foundation_intake_approval_files
    where document_id = pg_temp.doc('attempt-paid-mixed-0001', 'file-known-pdf')),
  'the replay names the reservation the first call committed'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1988, 'two retries took no second hold');
select is(
  (select count(*)::integer from public.foundation_compute_reservations
    where document_id = pg_temp.doc('attempt-paid-mixed-0001', 'file-known-pdf')),
  1,
  'one reservation row for the member'
);
select throws_ok(
  $$select public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.scope('attempt-paid-mixed-0001'), pg_temp.digest('9'), 'file-unknown-xlsx')$$,
  'foundation_intake_approval_conflict',
  'a reservation under a different pricing fingerprint is refused'
);
select throws_ok(
  $$select public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.digest('0'), pg_temp.digest('f'), 'file-unknown-xlsx')$$,
  'foundation_intake_approval_conflict',
  'a reservation against a different scope digest is refused'
);
select throws_ok(
  $$select public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.scope('attempt-paid-mixed-0001'), pg_temp.digest('f'), 'file-not-approved')$$,
  'foundation_intake_approval_file_out_of_scope',
  'a file outside the approved manifest cannot be reserved under it'
);
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.scope('attempt-paid-mixed-0001'), pg_temp.digest('f'), 'file-unknown-xlsx')->>'billingSource',
  'paid',
  'the unknown member is reserved against the paid balance'
);
select is(
  pg_temp.reservation('attempt-paid-mixed-0001', 'file-unknown-xlsx'),
  '60/reserved',
  'its reservation maximum is the approved ceiling quote, 60'
);
select is(
  (select sum(r.maximum_credits)::integer
     from public.foundation_compute_reservations r
     join public.foundation_intake_approval_files f on f.document_id = r.document_id
    where f.approval_id = pg_temp.approval('attempt-paid-mixed-0001')),
  78,
  'the reservations together carry exactly the approved aggregate maximum'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1948, 'holds of 12 and 40 are out of 2000');

-- The serial half of "concurrent duplicate": the key itself refuses a second row.
select throws_ok(
  $$insert into public.foundation_intake_approvals (
      approval_id, workspace_key, user_id, attempt_key, client_manifest_digest, scope_digest,
      pricing_fingerprint, file_count, aggregate_maximum_pages, aggregate_reserved_credits,
      aggregate_maximum_credits, created_at, expires_at)
    select gen_random_uuid(), workspace_key, user_id, attempt_key, client_manifest_digest,
      scope_digest, pricing_fingerprint, file_count, aggregate_maximum_pages,
      aggregate_reserved_credits, aggregate_maximum_credits, clock_timestamp(),
      clock_timestamp() + interval '10 minutes'
      from public.foundation_intake_approvals where attempt_key = 'attempt-paid-mixed-0001'$$,
  '23505',
  null::text,
  'a second approval row for the same workspace and attempt is a unique violation'
);

-- ---------------------------------------------------------------------------------------------
-- Confirm against cancel, on the same member row
-- ---------------------------------------------------------------------------------------------

select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-race-00001',
    pg_temp.digest('6'), pg_temp.digest('f'), 24,
    jsonb_build_array(
      pg_temp.file('file-race-confirm', 'c', 2048, 'application/pdf', 'declared', 2, 8, 12),
      pg_temp.file('file-race-cancel', 'd', 2048, 'application/pdf', 'declared', 2, 8, 12)))->>'fileCount',
  '2',
  'a two-member approval for the race'
);
select throws_ok(
  $$select public.reserve_foundation_compute_v3(
    'pilot-apprpaid01', pg_temp.doc('attempt-paid-race-00001', 'file-race-confirm'),
    '88880001-8888-4888-8888-888888888801', 9, 13)$$,
  'foundation_intake_approval_reservation_out_of_scope',
  'a direct reserve_v3 for an approved document above its approved amounts is refused'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1948, 'the refused direct reservation held nothing');
select is(
  (select count(*)::integer from public.foundation_compute_reservations
    where document_id = pg_temp.doc('attempt-paid-race-00001', 'file-race-confirm')),
  0,
  'and wrote no reservation row'
);
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-race-00001',
    pg_temp.scope('attempt-paid-race-00001'), pg_temp.digest('f'), 'file-race-confirm')->>'reservationState',
  'reserved',
  'the first race member is reserved'
);
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-race-00001',
    pg_temp.scope('attempt-paid-race-00001'), pg_temp.digest('f'), 'file-race-cancel')->>'reservationState',
  'reserved',
  'the second race member is reserved'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1932, 'two holds of 8 more are out');
select throws_ok(
  $$select public.confirm_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-race-00001',
    pg_temp.scope('attempt-paid-race-00001'), 'file-race-confirm')$$,
  'foundation_intake_approval_source_unconfirmed',
  'a member cannot be confirmed before its stored object is'
);
select is(
  pg_temp.admit('pilot-apprpaid01', pg_temp.doc('attempt-paid-race-00001', 'file-race-confirm'),
    '88880001-8888-4888-8888-888888888801', 'c', 2048, 'application/pdf'),
  'confirmed',
  'fixture: the first member''s object is admitted and confirmed through the existing intake path'
);
select is(
  public.confirm_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-race-00001',
    pg_temp.scope('attempt-paid-race-00001'), 'file-race-confirm')->>'fileState',
  'confirmed',
  'confirm wins the member when it commits first'
);
select is(
  public.confirm_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-race-00001',
    pg_temp.scope('attempt-paid-race-00001'), 'file-race-confirm')->>'idempotentReplay',
  'true',
  'a lost confirm response is answered from the committed row'
);
select is(
  pg_temp.cancel_set('attempt-paid-race-00001', 'file-race-confirm'),
  'cancelled/false',
  'a cancel that arrives after the confirm is applied to the set; confirmation does not stop it'
);
select is(
  pg_temp.member_state('attempt-paid-race-00001', 'file-race-confirm'),
  'cancelled/released',
  'the confirmed member is cancelled and its hold released through the audited settlement path'
);
select is(
  pg_temp.member_state('attempt-paid-race-00001', 'file-race-cancel'),
  'cancelled/released',
  'its reserved sibling is cancelled and released with it'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1948, 'cancellation returns both holds exactly once');
select is(
  pg_temp.cancel_set('attempt-paid-race-00001', 'file-race-cancel'),
  'duplicate/false',
  'a cancel naming the other member after the set is cancelled is a duplicate'
);
select is(
  pg_temp.cancel_set('attempt-paid-race-00001', 'file-race-confirm'),
  'duplicate/false',
  'a redelivered cancel is a duplicate'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1948, 'and the duplicates return nothing a second time');
select throws_ok(
  $$select public.confirm_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-race-00001',
    pg_temp.scope('attempt-paid-race-00001'), 'file-race-cancel')$$,
  'foundation_intake_approval_file_cancelled',
  'a confirm that arrives after the cancel is refused'
);
select throws_ok(
  $$select public.confirm_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-race-00001',
    pg_temp.scope('attempt-paid-race-00001'), 'file-race-confirm')$$,
  'foundation_intake_approval_file_cancelled',
  'a replayed confirm of the cancelled member is refused, not answered as confirmed'
);
select is(
  pg_temp.reservation('attempt-paid-race-00001', 'file-race-confirm'),
  '12/released',
  'the release left the confirmed member''s approved maximum at 12'
);
select is(
  (select state from public.foundation_intake_approvals where attempt_key = 'attempt-paid-race-00001'),
  'cancelled',
  'cancelling one member cancels the approval'
);
select throws_ok(
  $$select public.assert_foundation_intake_compile_set(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801',
    array[pg_temp.doc('attempt-paid-race-00001','file-race-confirm'),
          pg_temp.doc('attempt-paid-race-00001','file-race-cancel')])$$,
  'foundation_intake_approval_compile_set_not_ready',
  'the server compile gate rejects a cancelled dependent set'
);

select is(
  public.read_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-race-00001')->>'compilable',
  'false',
  'a cancelled set is never compilable, though one of its members was confirmed'
);

-- ---------------------------------------------------------------------------------------------
-- A reservation that lapses keeps the existing expiry accounting
-- ---------------------------------------------------------------------------------------------

select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-lapse-00001',
    pg_temp.digest('6'), pg_temp.digest('f'), 6,
    jsonb_build_array(pg_temp.file('file-lapse-pdf', '1', 1024, 'application/pdf', 'declared', 1, 4, 6)))->>'idempotentReplay',
  'false',
  'a one-member approval whose reservation will lapse'
);
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-lapse-00001',
    pg_temp.scope('attempt-paid-lapse-00001'), pg_temp.digest('f'), 'file-lapse-pdf')->>'reservationState',
  'reserved',
  'it is reserved'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1944, 'a hold of 4 is out');

-- Age the capability exactly as billing_reconciliation.sql does; the guard allows it because no
-- amount moves.
update public.foundation_compute_reservations
   set created_at = clock_timestamp() - interval '20 minutes',
       expires_at = clock_timestamp() - interval '10 minutes'
 where document_id = pg_temp.doc('attempt-paid-lapse-00001', 'file-lapse-pdf');

select throws_ok(
  $$select public.confirm_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-lapse-00001',
    pg_temp.scope('attempt-paid-lapse-00001'), 'file-lapse-pdf')$$,
  'foundation_intake_approval_reservation_expired',
  'a member whose reservation lapsed cannot be confirmed'
);
select is(
  public.cancel_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-lapse-00001',
    'file-lapse-pdf', 'CAPABILITY_LAPSED')->>'status',
  'cancelled',
  'it can still be cancelled'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1948, 'and its hold of 4 is returned exactly once');
select is(
  pg_temp.reservation('attempt-paid-lapse-00001', 'file-lapse-pdf'),
  '6/released',
  'the lapsed reservation ends released, with its maximum unchanged'
);

-- ---------------------------------------------------------------------------------------------
-- Approval expiry, and nothing approved can be widened by hand
-- ---------------------------------------------------------------------------------------------

select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-expire-0001',
    pg_temp.digest('6'), pg_temp.digest('f'), 30,
    jsonb_build_array(pg_temp.file('file-expire-docx', 'e', 30000,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'declared', 5, 20, 30)))->>'idempotentReplay',
  'false',
  'an approval that will expire before anything is reserved under it'
);
select throws_ok(
  $$update public.foundation_intake_approvals
       set expires_at = expires_at + interval '1 second'
     where attempt_key = 'attempt-paid-expire-0001'$$,
  'foundation_intake_approval_immutable',
  'an approval cannot be given more time'
);
select throws_ok(
  $$update public.foundation_intake_approval_files
       set approved_maximum_credits = 99
     where document_id = pg_temp.doc('attempt-paid-mixed-0001', 'file-known-pdf')$$,
  'foundation_intake_approval_immutable',
  'an approved member maximum cannot be rewritten upward'
);
select throws_ok(
  $$update public.foundation_intake_approvals
       set aggregate_maximum_credits = 999
     where attempt_key = 'attempt-paid-mixed-0001'$$,
  'foundation_intake_approval_immutable',
  'an approved aggregate cannot be rewritten upward'
);
select throws_ok(
  $$delete from public.foundation_intake_approvals where attempt_key = 'attempt-paid-mixed-0001'$$,
  'foundation_intake_approval_immutable',
  'an approval cannot be deleted'
);

-- Simulate the passage of ten minutes. The guard just refused exactly this update, so it is
-- switched off for this one statement, inside this rolled-back transaction, and switched back
-- on -- and the next assertion proves it is on again before anything relies on the aged row.
alter table public.foundation_intake_approvals disable trigger foundation_intake_approval_immutable_trigger;
update public.foundation_intake_approvals
   set created_at = clock_timestamp() - interval '20 minutes',
       expires_at = clock_timestamp() - interval '10 minutes'
 where attempt_key = 'attempt-paid-expire-0001';
alter table public.foundation_intake_approvals enable trigger foundation_intake_approval_immutable_trigger;

select is(
  (select tgenabled::text from pg_trigger
    where tgrelid = 'public.foundation_intake_approvals'::regclass
      and tgname = 'foundation_intake_approval_immutable_trigger'),
  'O',
  'the immutability guard is enabled again'
);
select throws_ok(
  $$select public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-expire-0001',
    pg_temp.scope('attempt-paid-expire-0001'), pg_temp.digest('f'), 'file-expire-docx')$$,
  'foundation_intake_approval_expired',
  'no new work is reserved under an expired approval'
);
select throws_ok(
  $$select public.create_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-expire-0001',
    pg_temp.digest('6'), pg_temp.digest('f'), 30,
    jsonb_build_array(pg_temp.file('file-expire-docx', 'e', 30000,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'declared', 5, 20, 30)))$$,
  'foundation_intake_approval_expired',
  'an identical retry cannot revive an expired approval; a fresh attempt is required'
);
select throws_ok(
  $$select public.reserve_foundation_compute_v3(
    'pilot-apprpaid01', pg_temp.doc('attempt-paid-expire-0001', 'file-expire-docx'),
    '88880001-8888-4888-8888-888888888801', 20, 30)$$,
  'foundation_intake_approval_expired',
  'nor can a direct reserve_v3 at the exact approved amounts'
);
select is(
  (select count(*)::integer from public.foundation_compute_reservations
    where document_id = pg_temp.doc('attempt-paid-expire-0001', 'file-expire-docx')),
  0,
  'the expired approval has no reservation'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1948, 'and held nothing');
select is(
  public.read_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-expire-0001')->>'expired',
  'true',
  'the status lookup reports the approval as expired'
);

-- ---------------------------------------------------------------------------------------------
-- Atomicity of the new combined confirmation RPC: if the approved member cannot be
-- confirmed, the base intake admission confirmation must roll back in the same transaction.
select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-atomic-confirm-0001',
    pg_temp.digest('4'),pg_temp.digest('f'),6,
    jsonb_build_array(pg_temp.file('file-atomic-confirm','d',1024,'application/pdf','measured',2,4,6))
  )->>'idempotentReplay',
  'false',
  'an approval is created for the atomic-confirm rollback fixture'
);
select public.reserve_foundation_intake_admission(
  'pilot-apprpaid01', pg_temp.doc('attempt-atomic-confirm-0001','file-atomic-confirm'),
  '88880001-8888-4888-8888-888888888801',
  'quarantine/pilot-apprpaid01/'||pg_temp.doc('attempt-atomic-confirm-0001','file-atomic-confirm')::text||'/source',
  1024,'application/pdf'
);
select throws_ok(
  $$select public.confirm_foundation_intake_approved_upload(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-atomic-confirm-0001',
    pg_temp.scope('attempt-atomic-confirm-0001'),'file-atomic-confirm',
    pg_temp.doc('attempt-atomic-confirm-0001','file-atomic-confirm'),pg_temp.digest('d'),1024,'application/pdf')$$,
  'foundation_intake_approval_file_not_reserved',
  'combined confirmation refuses a member with no approved compute reservation'
);
select is(
  (select confirmed_at is null from public.foundation_intake_admissions
    where document_id=pg_temp.doc('attempt-atomic-confirm-0001','file-atomic-confirm')),
  true,
  'a failed approved confirmation rolled the base admission confirmation back'
);

-- Expiry semantics: approval expiry prevents new holds, but a reservation made inside
-- the approval window remains usable until that reservation itself expires.
select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-approval-expiry-live-01',
    pg_temp.digest('5'),pg_temp.digest('f'),6,
    jsonb_build_array(pg_temp.file('file-approval-expiry','e',1024,'application/pdf','declared',2,4,6))
  )->>'idempotentReplay',
  'false',
  'create the approval-expiry/live-reservation fixture'
);
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-approval-expiry-live-01',
    pg_temp.scope('attempt-approval-expiry-live-01'),pg_temp.digest('f'),'file-approval-expiry')->>'reservationState',
  'reserved',
  'a live hold is created while the approval is valid'
);
select is(
  pg_temp.admit('pilot-apprpaid01',pg_temp.doc('attempt-approval-expiry-live-01','file-approval-expiry'),
    '88880001-8888-4888-8888-888888888801','e',1024,'application/pdf'),
  'confirmed',
  'the stored object is admitted before approval expiry'
);
alter table public.foundation_intake_approvals disable trigger foundation_intake_approval_immutable_trigger;
update public.foundation_intake_approvals
   set created_at=clock_timestamp()-interval '20 minutes',
       expires_at=clock_timestamp()-interval '10 minutes'
 where attempt_key='attempt-approval-expiry-live-01';
alter table public.foundation_intake_approvals enable trigger foundation_intake_approval_immutable_trigger;
select is(
  public.confirm_foundation_intake_approved_file(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-approval-expiry-live-01',
    pg_temp.scope('attempt-approval-expiry-live-01'),'file-approval-expiry')->>'fileState',
  'confirmed',
  'a live reservation can still be confirmed after the approval window closes'
);
select is(
  public.assert_foundation_intake_compile_set('pilot-apprpaid01','88880001-8888-4888-8888-888888888801',
    array[pg_temp.doc('attempt-approval-expiry-live-01','file-approval-expiry')])->>'allowed',
  'true',
  'compilation remains allowed while that confirmed reservation is live'
);

-- Paid: confirm the whole set, refuse the overrun, settle within the approval
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  $$select public.assert_foundation_intake_compile_set(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801',
    array[pg_temp.doc('attempt-paid-mixed-0001','file-known-pdf')])$$,
  'foundation_intake_approval_compile_set_incomplete',
  'the server compile gate rejects a browser-selected subset of an approved set'
);
select is(
  pg_temp.admit('pilot-apprpaid01', pg_temp.doc('attempt-paid-mixed-0001', 'file-known-pdf'),
    '88880001-8888-4888-8888-888888888801', 'a', 120000, 'application/pdf'),
  'confirmed',
  'fixture: the PDF object is admitted and confirmed'
);
select is(
  pg_temp.admit('pilot-apprpaid01', pg_temp.doc('attempt-paid-mixed-0001', 'file-unknown-xlsx'),
    '88880001-8888-4888-8888-888888888801', 'b', 64000,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  'confirmed',
  'fixture: the spreadsheet object is admitted and confirmed'
);
select is(
  public.confirm_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.scope('attempt-paid-mixed-0001'), 'file-known-pdf')->>'fileState',
  'confirmed',
  'the PDF member is confirmed'
);
select is(
  public.confirm_foundation_intake_approved_file(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001',
    pg_temp.scope('attempt-paid-mixed-0001'), 'file-unknown-xlsx')->>'fileState',
  'confirmed',
  'the spreadsheet member is confirmed'
);
select is(
  public.read_foundation_intake_approval(
    'pilot-apprpaid01', '88880001-8888-4888-8888-888888888801', 'attempt-paid-mixed-0001')->>'compilable',
  'true',
  'with every member confirmed and holding its reservation, the set is compilable'
);
select is(
  public.assert_foundation_intake_compile_set(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801',
    array[pg_temp.doc('attempt-paid-mixed-0001','file-known-pdf'),
          pg_temp.doc('attempt-paid-mixed-0001','file-unknown-xlsx')])->>'allowed',
  'true',
  'the server compile gate allows the complete, confirmed, reserved set'
);

select throws_ok(
  $$select public.settle_foundation_intake_approved_compute(
    'pilot-apprpaid01', pg_temp.doc('attempt-paid-mixed-0001', 'file-known-pdf'), 'settled', 19, 'OCR_COMPLETED')$$,
  'foundation_intake_approval_maximum_exceeded',
  'paid: a settlement above the approved member maximum is refused'
);
select throws_ok(
  $$select public.settle_foundation_compute_v3(
    'pilot-apprpaid01', pg_temp.doc('attempt-paid-mixed-0001', 'file-known-pdf'), 'settled', 19, 'OCR_COMPLETED')$$,
  'foundation_compute_maximum_charge_exceeded',
  'paid: the existing guard refuses the same overrun on a direct settle_v3'
);
select is(
  pg_temp.reservation('attempt-paid-mixed-0001', 'file-known-pdf'),
  '18/reserved',
  'paid: the refused overrun left the maximum at 18 and the reservation open'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1944, 'paid: the refused overrun charged nothing');
select is(
  public.settle_foundation_intake_approved_compute(
    'pilot-apprpaid01', pg_temp.doc('attempt-paid-mixed-0001', 'file-known-pdf'), 'settled', 10, 'OCR_COMPLETED')->>'releasedCredits',
  '2',
  'paid: settling 10 against a hold of 12 releases 2'
);
select is(pg_temp.balance('pilot-apprpaid01'), 1946, 'paid: the release is back in the balance');
select is(
  public.settle_foundation_intake_approved_compute(
    'pilot-apprpaid01', pg_temp.doc('attempt-paid-mixed-0001', 'file-unknown-xlsx'), 'settled', 40, 'OCR_COMPLETED')->>'status',
  'processed',
  'paid: the spreadsheet settles at its hold'
);
select is(
  pg_temp.balance('pilot-apprpaid01')
    + (select coalesce(sum(reserved_credits), 0)::integer from public.foundation_compute_reservations
        where workspace_key = 'pilot-apprpaid01' and state = 'reserved'),
  1950,
  'paid: balance plus open holds is 2000 less exactly the 50 consumed -- every release returned once'
);
select is(
  (select aggregate_maximum_credits from public.foundation_intake_approvals where attempt_key = 'attempt-paid-mixed-0001'),
  78,
  'paid: settlement did not move the approved aggregate'
);

-- ---------------------------------------------------------------------------------------------
-- Trial: the overrun is refused instead of widening the maximum
-- ---------------------------------------------------------------------------------------------

select is(
  public.create_foundation_intake_approval(
    'pilot-apprtrial01', '88880002-8888-4888-8888-888888888802', 'attempt-trial-overrun1',
    pg_temp.digest('6'), pg_temp.digest('f'), 12,
    jsonb_build_array(pg_temp.file('file-trial-docx', '2', 4096, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'declared', 2, 8, 12)))->>'idempotentReplay',
  'false',
  'trial: a two-page declared DOCX count is recorded as a claim'
);
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-apprtrial01', '88880002-8888-4888-8888-888888888802', 'attempt-trial-overrun1',
    pg_temp.scope('attempt-trial-overrun1'), pg_temp.digest('f'), 'file-trial-docx')->>'billingSource',
  'trial',
  'trial: the reservation is a trial reservation'
);
select is(
  pg_temp.admit('pilot-apprtrial01', pg_temp.doc('attempt-trial-overrun1', 'file-trial-docx'),
    '88880002-8888-4888-8888-888888888802', '2', 4096, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  'confirmed',
  'fixture: the trial object is admitted and confirmed'
);
select is(
  public.confirm_foundation_intake_approved_file(
    'pilot-apprtrial01', '88880002-8888-4888-8888-888888888802', 'attempt-trial-overrun1',
    pg_temp.scope('attempt-trial-overrun1'), 'file-trial-docx')->>'fileState',
  'confirmed',
  'trial: the member is confirmed'
);

create temp table approval_trial_budget_before as
  select coalesce((select observed_overage_units from public.foundation_trial_daily_budget
                    where budget_day = current_date), 0) as units;

select throws_ok(
  $$select public.settle_foundation_intake_approved_compute(
    'pilot-apprtrial01', pg_temp.doc('attempt-trial-overrun1', 'file-trial-docx'), 'settled', 13, 'OCR_COMPLETED')$$,
  'foundation_intake_approval_maximum_exceeded',
  'trial: actual work above the stale declared DOCX maximum is refused'
);
select throws_ok(
  $$select public.settle_foundation_compute_v3(
    'pilot-apprtrial01', pg_temp.doc('attempt-trial-overrun1', 'file-trial-docx'), 'settled', 13, 'OCR_COMPLETED')$$,
  'foundation_intake_approval_maximum_immutable',
  'trial: a direct settle_v3 cannot raise the approved maximum to fit the observed work'
);
select is(
  pg_temp.reservation('attempt-trial-overrun1', 'file-trial-docx'),
  '12/reserved',
  'trial: the maximum is still 12 and the reservation still open'
);
select is(
  (select coalesce((select observed_overage_units from public.foundation_trial_daily_budget
                     where budget_day = current_date), 0)
          - (select units from approval_trial_budget_before))::integer,
  0,
  'trial: the refused overrun recorded no observed overage'
);
select is(
  public.settle_foundation_intake_approved_compute(
    'pilot-apprtrial01', pg_temp.doc('attempt-trial-overrun1', 'file-trial-docx'), 'settled', 10, 'OCR_COMPLETED')->>'maximumCredits',
  '12',
  'trial: a settlement inside the approval is processed and the maximum stays 12'
);
select is(
  (select coalesce((select observed_overage_units from public.foundation_trial_daily_budget
                     where budget_day = current_date), 0)
          - (select units from approval_trial_budget_before))::integer,
  2,
  'trial: within the approval the existing accounting holds -- 10 against a hold of 8 is 2 observed'
);
select is(
  (select approved_maximum_credits from public.foundation_intake_approval_files
    where document_id = pg_temp.doc('attempt-trial-overrun1', 'file-trial-docx')),
  12,
  'trial: the approved member maximum is unchanged'
);

-- ---------------------------------------------------------------------------------------------
-- Owner: the same refusal, and a member whose stored object is not what was approved
-- ---------------------------------------------------------------------------------------------

select is(
  public.create_foundation_intake_approval(
    'pilot-approwner01', '88880003-8888-4888-8888-888888888803', 'attempt-owner-overrun1',
    pg_temp.digest('6'), pg_temp.digest('f'), 24,
    jsonb_build_array(
      pg_temp.file('file-owner-pdf', '3', 4096, 'application/pdf', 'declared', 2, 8, 12),
      pg_temp.file('file-owner-swap', '4', 4096, 'application/pdf', 'declared', 2, 8, 12)))->>'fileCount',
  '2',
  'owner: an owner approves two members'
);
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-approwner01', '88880003-8888-4888-8888-888888888803', 'attempt-owner-overrun1',
    pg_temp.scope('attempt-owner-overrun1'), pg_temp.digest('f'), 'file-owner-pdf')->>'billingSource',
  'owner',
  'owner: the reservation is an owner reservation'
);
select is(
  public.reserve_foundation_intake_approved_file(
    'pilot-approwner01', '88880003-8888-4888-8888-888888888803', 'attempt-owner-overrun1',
    pg_temp.scope('attempt-owner-overrun1'), pg_temp.digest('f'), 'file-owner-swap')->>'reservationState',
  'reserved',
  'owner: the second member is reserved'
);
select is(
  pg_temp.admit('pilot-approwner01', pg_temp.doc('attempt-owner-overrun1', 'file-owner-pdf'),
    '88880003-8888-4888-8888-888888888803', '3', 4096, 'application/pdf'),
  'confirmed',
  'fixture: the owner PDF object is admitted and confirmed with its approved digest'
);
select is(
  pg_temp.admit('pilot-approwner01', pg_temp.doc('attempt-owner-overrun1', 'file-owner-swap'),
    '88880003-8888-4888-8888-888888888803', '5', 4096, 'application/pdf'),
  'confirmed',
  'fixture: the second object is stored with content other than what was approved'
);
select throws_ok(
  $$select public.confirm_foundation_intake_approved_file(
    'pilot-approwner01', '88880003-8888-4888-8888-888888888803', 'attempt-owner-overrun1',
    pg_temp.scope('attempt-owner-overrun1'), 'file-owner-swap')$$,
  'foundation_intake_approval_source_mismatch',
  'owner: a member whose stored digest differs from the approved one cannot be confirmed'
);
select is(
  public.confirm_foundation_intake_approved_file(
    'pilot-approwner01', '88880003-8888-4888-8888-888888888803', 'attempt-owner-overrun1',
    pg_temp.scope('attempt-owner-overrun1'), 'file-owner-pdf')->>'fileState',
  'confirmed',
  'owner: the matching member is confirmed'
);
select throws_ok(
  $$select public.settle_foundation_intake_approved_compute(
    'pilot-approwner01', pg_temp.doc('attempt-owner-overrun1', 'file-owner-pdf'), 'settled', 13, 'OCR_COMPLETED')$$,
  'foundation_intake_approval_maximum_exceeded',
  'owner: a settlement above the approved maximum is refused'
);
select throws_ok(
  $$select public.settle_foundation_compute_v3(
    'pilot-approwner01', pg_temp.doc('attempt-owner-overrun1', 'file-owner-pdf'), 'settled', 13, 'OCR_COMPLETED')$$,
  'foundation_intake_approval_maximum_immutable',
  'owner: a direct settle_v3 cannot raise the approved maximum either'
);
select is(
  pg_temp.reservation('attempt-owner-overrun1', 'file-owner-pdf'),
  '12/reserved',
  'owner: the maximum is still 12 and the reservation still open'
);
select is(
  public.settle_foundation_intake_approved_compute(
    'pilot-approwner01', pg_temp.doc('attempt-owner-overrun1', 'file-owner-pdf'), 'settled', 12, 'OCR_COMPLETED')->>'status',
  'processed',
  'owner: a settlement at exactly the approved maximum is processed'
);
select is(
  public.read_foundation_intake_approval(
    'pilot-approwner01', '88880003-8888-4888-8888-888888888803', 'attempt-owner-overrun1')->>'compilable',
  'false',
  'owner: one unconfirmable member keeps the whole set from compiling'
);

-- A settled sibling is known accounting. Cancelling a dependent set releases only its still-live
-- sibling hold and never changes the settled reservation or reverses its charge.
insert into pg_temp.cancellation_balance_baseline
values ('attempt-cancel-settled-01', pg_temp.balance('pilot-apprpaid01'));
select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-settled-01',
    pg_temp.digest('a'),pg_temp.digest('f'),24,
    jsonb_build_array(
      pg_temp.file('file-cancel-settled','a',2048,'application/pdf','declared',2,12,12),
      pg_temp.file('file-cancel-reserved','b',2048,'application/pdf','declared',2,8,12))
  )->>'fileCount',
  '2',
  'the settled-sibling fixture approves two members'
);
select public.reserve_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-settled-01',
  pg_temp.scope('attempt-cancel-settled-01'),pg_temp.digest('f'),'file-cancel-settled');
select public.reserve_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-settled-01',
  pg_temp.scope('attempt-cancel-settled-01'),pg_temp.digest('f'),'file-cancel-reserved');
select pg_temp.admit('pilot-apprpaid01',pg_temp.doc('attempt-cancel-settled-01','file-cancel-settled'),
  '88880001-8888-4888-8888-888888888801','a',2048,'application/pdf');
select pg_temp.admit('pilot-apprpaid01',pg_temp.doc('attempt-cancel-settled-01','file-cancel-reserved'),
  '88880001-8888-4888-8888-888888888801','b',2048,'application/pdf');
select public.confirm_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-settled-01',
  pg_temp.scope('attempt-cancel-settled-01'),'file-cancel-settled');
select public.confirm_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-settled-01',
  pg_temp.scope('attempt-cancel-settled-01'),'file-cancel-reserved');
select is(
  public.settle_foundation_intake_approved_compute(
    'pilot-apprpaid01',pg_temp.doc('attempt-cancel-settled-01','file-cancel-settled'),
    'settled',5,'OCR_COMPLETED')->>'status',
  'processed',
  'member A settles inside its approved maximum before set cancellation'
);
select is(
  pg_temp.cancel_set('attempt-cancel-settled-01','file-cancel-reserved'),
  'cancelled/false',
  'a confirmed failed member can cancel a set with an already-settled sibling'
);
select is(pg_temp.member_state('attempt-cancel-settled-01','file-cancel-reserved'),
  'cancelled/released','the failed member is cancelled and its active hold is released');
select is(pg_temp.member_state('attempt-cancel-settled-01','file-cancel-settled'),
  'confirmed/settled','the settled sibling remains confirmed and settled');
select is(
  (select settled_credits from public.foundation_compute_reservations
    where document_id=pg_temp.doc('attempt-cancel-settled-01','file-cancel-settled')),
  5,
  'cancellation does not change the settled sibling''s recorded five credits'
);
select is(
  pg_temp.balance('pilot-apprpaid01')-(select balance from pg_temp.cancellation_balance_baseline
    where attempt_key='attempt-cancel-settled-01'),
  -5,
  'balance preserves exactly the settled five-credit charge after releasing member B'
);
select is(
  (select state from public.foundation_intake_approvals where attempt_key='attempt-cancel-settled-01'),
  'cancelled',
  'the approval is canceled even though one reservation had settled'
);
select is(pg_temp.cancel_set('attempt-cancel-settled-01','file-cancel-reserved'),
  'duplicate/false','replaying the cancellation is an idempotent duplicate');
select is(pg_temp.balance('pilot-apprpaid01')-(select balance from pg_temp.cancellation_balance_baseline
    where attempt_key='attempt-cancel-settled-01'),-5,
  'the duplicate cancellation neither releases nor charges a second time');

-- An operator-review reservation is not safe to release or rewrite. It remains visible while
-- other safe holds are returned and the parent set is canceled for compilation purposes.
insert into pg_temp.cancellation_balance_baseline
values ('attempt-cancel-review-01', pg_temp.balance('pilot-apprpaid01'));
select is(
  public.create_foundation_intake_approval(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-review-01',
    pg_temp.digest('c'),pg_temp.digest('f'),36,
    jsonb_build_array(
      pg_temp.file('file-review-settled','c',2048,'application/pdf','declared',2,12,12),
      pg_temp.file('file-review-cancel','d',2048,'application/pdf','declared',2,8,12),
      pg_temp.file('file-review-operator','e',2048,'application/pdf','declared',2,10,12))
  )->>'fileCount',
  '3',
  'the reconciliation fixture approves three members'
);
select public.reserve_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-review-01',
  pg_temp.scope('attempt-cancel-review-01'),pg_temp.digest('f'),'file-review-settled');
select public.reserve_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-review-01',
  pg_temp.scope('attempt-cancel-review-01'),pg_temp.digest('f'),'file-review-cancel');
select public.reserve_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-review-01',
  pg_temp.scope('attempt-cancel-review-01'),pg_temp.digest('f'),'file-review-operator');
select pg_temp.admit('pilot-apprpaid01',pg_temp.doc('attempt-cancel-review-01','file-review-settled'),
  '88880001-8888-4888-8888-888888888801','c',2048,'application/pdf');
select pg_temp.admit('pilot-apprpaid01',pg_temp.doc('attempt-cancel-review-01','file-review-cancel'),
  '88880001-8888-4888-8888-888888888801','d',2048,'application/pdf');
select pg_temp.admit('pilot-apprpaid01',pg_temp.doc('attempt-cancel-review-01','file-review-operator'),
  '88880001-8888-4888-8888-888888888801','e',2048,'application/pdf');
select public.confirm_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-review-01',
  pg_temp.scope('attempt-cancel-review-01'),'file-review-settled');
select public.confirm_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-review-01',
  pg_temp.scope('attempt-cancel-review-01'),'file-review-cancel');
select public.confirm_foundation_intake_approved_file(
  'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-review-01',
  pg_temp.scope('attempt-cancel-review-01'),'file-review-operator');
select public.settle_foundation_intake_approved_compute(
  'pilot-apprpaid01',pg_temp.doc('attempt-cancel-review-01','file-review-settled'),
  'settled',5,'OCR_COMPLETED');
select public.settle_foundation_intake_approved_compute(
  'pilot-apprpaid01',pg_temp.doc('attempt-cancel-review-01','file-review-operator'),
  'operator_review',6,'PIPELINE_UNCERTAIN');

select throws_ok(
  $$select pg_temp.cancel_then_abort('attempt-cancel-review-01','file-review-cancel')$$,
  'forced_cancel_rollback',
  'an error after cancellation work rolls the approval and all releases back'
);
select is((select state from public.foundation_intake_approvals where attempt_key='attempt-cancel-review-01'),
  'approved','the forced error restores the approval to approved');
select is(pg_temp.member_state('attempt-cancel-review-01','file-review-cancel'),
  'confirmed/reserved','the forced error restores member B and its live hold');
select is(pg_temp.member_state('attempt-cancel-review-01','file-review-settled'),
  'confirmed/settled','rollback preserves member A''s prior settlement');
select is(pg_temp.member_state('attempt-cancel-review-01','file-review-operator'),
  'confirmed/operator_review','rollback preserves member C''s review state');
select is(
  pg_temp.balance('pilot-apprpaid01')-(select balance from pg_temp.cancellation_balance_baseline
    where attempt_key='attempt-cancel-review-01'),
  -19,
  'before cancellation, A and C are recorded and B remains held'
);

select is(pg_temp.cancel_set('attempt-cancel-review-01','file-review-cancel'),
  'cancelled_reconciliation_required/true',
  'three-member cancellation reports its operator-review sibling explicitly');
select is(pg_temp.member_state('attempt-cancel-review-01','file-review-cancel'),
  'cancelled/released','the failed member is released despite the review sibling');
select is(pg_temp.member_state('attempt-cancel-review-01','file-review-settled'),
  'confirmed/settled','member A''s settled accounting remains unchanged');
select is(
  (select settled_credits from public.foundation_compute_reservations
    where document_id=pg_temp.doc('attempt-cancel-review-01','file-review-settled')),
  5,
  'member A keeps its exact settled-credit amount'
);
select is(pg_temp.member_state('attempt-cancel-review-01','file-review-operator'),
  'confirmed/operator_review','member C remains visible in operator review');
select is(
  (select settled_credits from public.foundation_compute_reservations
    where document_id=pg_temp.doc('attempt-cancel-review-01','file-review-operator')),
  6,
  'cancellation does not rewrite the review reservation''s amount'
);
select is(
  (public.read_foundation_intake_approval(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801','attempt-cancel-review-01')->'files')
    @> jsonb_build_array(jsonb_build_object('fileKey','file-review-operator','reservationState','operator_review')),
  true,
  'the approval read model continues to expose the reconciliation obligation'
);
select is(
  pg_temp.balance('pilot-apprpaid01')-(select balance from pg_temp.cancellation_balance_baseline
    where attempt_key='attempt-cancel-review-01'),
  -11,
  'only B''s hold is returned; A''s and C''s recorded work stays charged'
);
select is((select state from public.foundation_intake_approvals where attempt_key='attempt-cancel-review-01'),
  'cancelled','the parent approval is canceled while reconciliation remains visible');
select is(pg_temp.cancel_set('attempt-cancel-review-01','file-review-cancel'),
  'duplicate_reconciliation_required/true','a duplicate reports the same reconciliation obligation');
select is(
  pg_temp.balance('pilot-apprpaid01')-(select balance from pg_temp.cancellation_balance_baseline
    where attempt_key='attempt-cancel-review-01'),
  -11,
  'duplicate replay does not release, refund, or charge again'
);
select throws_ok(
  $$select public.assert_foundation_intake_compile_set(
    'pilot-apprpaid01','88880001-8888-4888-8888-888888888801',
    array[pg_temp.doc('attempt-cancel-review-01','file-review-settled'),
          pg_temp.doc('attempt-cancel-review-01','file-review-cancel'),
          pg_temp.doc('attempt-cancel-review-01','file-review-operator')])$$,
  'foundation_intake_approval_compile_set_not_ready',
  'the three-member approval cannot compile after cancellation'
);

select * from finish();
rollback;
