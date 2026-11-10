-- Migration 20261110041500: PDF and DOCX members may be approved up to 500 pages (ADR-0006).
--
-- Every assertion reads what create_foundation_intake_approval returned or wrote, or a constraint
-- the table enforced. Every row is rolled back.
--   PDF  measured 500               -> approved, 500 stored
--   DOCX measured 500               -> approved
--   PDF  measured 501               -> foundation_intake_approval_invalid
--   XLSX measured 81                -> foundation_intake_approval_invalid (not a segmented format)
--   PDF  unknown basis at 500       -> foundation_intake_approval_unknown_ceiling_required
--   XLSX unknown basis at 80        -> approved (unchanged)
--   128 PDFs x 500                  -> aggregate 64,000 approved
--   a row written past the function -> CHECK violation for 501, and for an 81-page XLSX
begin;
select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '55550001-5555-4555-8555-555555555501',
   'authenticated', 'authenticated', 'segmented-ceiling@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

create function pg_temp.file(p_key text, p_mime text, p_basis text, p_pages integer) returns jsonb
language sql immutable as $fn$
  select jsonb_build_object(
    'fileKey', p_key, 'contentSha256', 'sha256:' || repeat('a', 64), 'byteLength', 4096,
    'mimeType', p_mime, 'pageBasis', p_basis, 'approvedMaxPages', p_pages,
    'reservedCredits', 1, 'maximumCredits', 1)
$fn$;

create function pg_temp.approve(p_attempt text, p_files jsonb) returns jsonb
language sql as $fn$
  select public.create_foundation_intake_approval(
    'pilot-segceil01', '55550001-5555-4555-8555-555555555501', p_attempt,
    'sha256:' || repeat('6', 64), 'sha256:' || repeat('f', 64), jsonb_array_length(p_files), p_files)
$fn$;

select is(
  public.apply_foundation_billing_event_v4(
    'evt_' || rpad('segceil', 26, 'a'), 'transaction.completed', '2026-11-10T04:15:00Z',
    'sha256:' || repeat('3', 64), 'allowance',
    'pilot-segceil01', '55550001-5555-4555-8555-555555555501',
    'observer_access', 'txn_' || rpad('segceil', 26, 'a'), 'ctm_' || rpad('segceil', 26, 'a'),
    null, null, 2000, null
  )->>'status',
  'allowance_granted',
  'fixture: the paid workspace is granted 2000 units, once'
);
update public.foundation_billing_accounts
   set access_plan = 'observer_access', subscription_status = 'active'
 where workspace_key = 'pilot-segceil01';

select is(
  pg_temp.approve('attempt-segceil-pdf500',
    jsonb_build_array(pg_temp.file('file-pdf-500', 'application/pdf', 'measured', 500)))->>'aggregateMaximumPages',
  '500', 'a measured 500-page PDF is approved'
);
select is(
  (select f.approved_max_pages from public.foundation_intake_approval_files f
     join public.foundation_intake_approvals a using (approval_id)
    where a.attempt_key = 'attempt-segceil-pdf500'),
  500, 'and stored at 500 pages'
);
select is(
  pg_temp.approve('attempt-segceil-docx500',
    jsonb_build_array(pg_temp.file('file-docx-500',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'measured', 500)))->>'aggregateMaximumPages',
  '500', 'a 500-page DOCX is approved'
);
select throws_ok(
  $$select pg_temp.approve('attempt-segceil-pdf501',
    jsonb_build_array(pg_temp.file('file-pdf-501', 'application/pdf', 'measured', 501)))$$,
  'foundation_intake_approval_invalid',
  'no member may be approved past the 500-page segmented ceiling'
);
select throws_ok(
  $$select pg_temp.approve('attempt-segceil-xlsx81',
    jsonb_build_array(pg_temp.file('file-xlsx-81',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'measured', 81)))$$,
  'foundation_intake_approval_invalid',
  'a format that is not segmented keeps the 80-page ceiling'
);
select throws_ok(
  $$select pg_temp.approve('attempt-segceil-pdfunknown',
    jsonb_build_array(pg_temp.file('file-pdf-unknown', 'application/pdf', 'unknown', 500)))$$,
  'foundation_intake_approval_unknown_ceiling_required',
  'a member whose pages were not counted is still approved at exactly 80'
);
select is(
  pg_temp.approve('attempt-segceil-xlsxunk',
    jsonb_build_array(pg_temp.file('file-xlsx-unknown',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'unknown', 80)))->>'aggregateMaximumPages',
  '80', 'an uncounted spreadsheet is approved at 80, as before'
);
select is(
  pg_temp.approve('attempt-segceil-cap-128',
    (select jsonb_agg(pg_temp.file('file-cap-' || lpad(n::text, 3, '0'), 'application/pdf', 'measured', 500) order by n)
       from generate_series(1, 128) as n))->>'aggregateMaximumPages',
  '64000', '128 members of 500 pages are one approved set of 64,000 pages'
);
select throws_ok(
  $$insert into public.foundation_intake_approval_files (
      approval_id, file_key, document_id, content_sha256, byte_length, declared_mime_type, page_basis,
      approved_max_pages, approved_reserved_credits, approved_maximum_credits, created_at)
    select approval_id, 'file-direct-501', gen_random_uuid(), 'sha256:' || repeat('b', 64), 4096,
      'application/pdf', 'measured', 501, 1, 1, now()
      from public.foundation_intake_approvals where attempt_key = 'attempt-segceil-pdf500'$$,
  '23514', null, 'the table refuses 501 pages even past the function'
);
select throws_ok(
  $$insert into public.foundation_intake_approval_files (
      approval_id, file_key, document_id, content_sha256, byte_length, declared_mime_type, page_basis,
      approved_max_pages, approved_reserved_credits, approved_maximum_credits, created_at)
    select approval_id, 'file-direct-xlsx', gen_random_uuid(), 'sha256:' || repeat('c', 64), 4096,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'measured', 81, 1, 1, now()
      from public.foundation_intake_approvals where attempt_key = 'attempt-segceil-pdf500'$$,
  '23514', null, 'the table refuses an 81-page member in a format that is not segmented'
);
select is(
  (select count(*)::integer from public.foundation_intake_approvals where attempt_key like 'attempt-segceil-%'),
  4, 'only the four approved sets were written'
);

select * from finish();
rollback;
