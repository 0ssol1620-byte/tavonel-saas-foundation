-- Executed assertions for 0051_intake_ceiling_and_gate_evidence.sql.
-- Run with Supabase CLI `db test` after every migration is applied.
--
-- Grepping SQL text is how the 0048 defect survived review: the migration was right about itself
-- and wrong about the column constraint it had to move. Everything below runs the statements
-- instead, so a guard that contradicts a constraint fails here rather than in production as a
-- bare 503.
begin;
select plan(15);

-- ---------------------------------------------------------------------------------------------
-- One ceiling (D4-04, D1-01)
-- ---------------------------------------------------------------------------------------------

select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.foundation_intake_admissions'::regclass
      and conname = 'foundation_intake_admissions_requested_bytes_check'
  ),
  'the 0008 inline byte CHECK is gone, not merely shadowed'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.foundation_intake_admissions'::regclass
      and conname = 'foundation_intake_within_processing_ceiling'
  ),
  'the replacement byte CHECK exists under a name a later migration can find'
);
select has_column('public', 'foundation_intake_admissions', 'source_sha256', 'admissions carry the source digest');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '55555555-5555-4555-8555-555555555555',
  'authenticated', 'authenticated', 'ceiling-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

-- The band 0048 opened and no processor could ever read. It must be a typed refusal, never a
-- constraint violation reaching the error mapper.
select throws_ok(
  $$select public.reserve_foundation_intake_admission(
    'pilot-ceiling000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '55555555-5555-4555-8555-555555555555',
    'quarantine/pilot-ceiling000000/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/source',
    31457280, 'application/pdf'
  )$$,
  'foundation_intake_file_too_large',
  'a 30 MB source is refused by name, not by constraint violation'
);

select throws_ok(
  $$select public.reserve_foundation_intake_admission(
    'pilot-ceiling000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
    '55555555-5555-4555-8555-555555555555',
    'quarantine/pilot-ceiling000000/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc/source',
    5242881, 'application/pdf'
  )$$,
  'foundation_intake_file_too_large',
  'one byte over the ceiling is refused by name'
);

select is(
  public.reserve_foundation_intake_admission(
    'pilot-ceiling000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '55555555-5555-4555-8555-555555555555',
    'quarantine/pilot-ceiling000000/cccccccc-cccc-4ccc-8ccc-cccccccccccc/source',
    5242880, 'application/pdf'
  )->>'confirmed',
  'false',
  'exactly the ceiling is admitted'
);

-- ---------------------------------------------------------------------------------------------
-- What was stored is what was reserved (D1-07)
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  $$select public.confirm_foundation_intake_admission(
    'pilot-ceiling000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '55555555-5555-4555-8555-555555555555',
    null, 5242879, 'application/pdf'
  )$$,
  'foundation_intake_content_length_mismatch',
  'a stored object shorter than the reservation is refused'
);

select throws_ok(
  $$select public.confirm_foundation_intake_admission(
    'pilot-ceiling000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '55555555-5555-4555-8555-555555555555',
    null, 5242880, 'image/png'
  )$$,
  'foundation_intake_observed_mime_mismatch',
  'a stored object of another type is refused'
);

select throws_ok(
  $$select public.confirm_foundation_intake_admission(
    'pilot-ceiling000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '55555555-5555-4555-8555-555555555555',
    'not-a-digest', 5242880, 'application/pdf'
  )$$,
  'foundation_intake_source_digest_invalid',
  'a digest that is not one is refused rather than stored'
);

select is(
  public.confirm_foundation_intake_admission(
    'pilot-ceiling000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '55555555-5555-4555-8555-555555555555',
    'sha256:' || repeat('a', 64), 5242880, 'application/pdf'
  )->>'status',
  'confirmed',
  'a matching object confirms and records its digest'
);

select throws_ok(
  $$select public.confirm_foundation_intake_admission(
    'pilot-ceiling000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '55555555-5555-4555-8555-555555555555',
    'sha256:' || repeat('b', 64), 5242880, 'application/pdf'
  )$$,
  'foundation_intake_source_digest_conflict',
  'a second, different digest under the same capability is a conflict, not an update'
);

-- ---------------------------------------------------------------------------------------------
-- A refusal that exists (D1-03)
-- ---------------------------------------------------------------------------------------------

select is(
  public.refuse_foundation_intake_admission(
    'pilot-ceiling000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'CDR_PERMANENT_REJECT'
  )->>'state',
  'rejected',
  'a permanent CDR rejection moves the admission to its terminal state'
);

select is(
  public.refuse_foundation_intake_admission(
    'pilot-ceiling000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'CDR_PERMANENT_REJECT'
  )->>'state',
  'rejected',
  'a redelivered refusal changes nothing'
);

-- ---------------------------------------------------------------------------------------------
-- A gate receipt an auditor can re-derive (D5-01)
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  $$insert into public.customer_data_gate_receipts
      (tenant_id, workspace_id, allowed, satisfied_count, receipt_sha256, missing, evidence, evaluated_at)
    values ('t1', 'pilot-ceiling000000', true, 17, 'sha256:' || repeat('a', 64), '{}', '[]'::jsonb, now())$$,
  '23514',
  -- Four arguments, not three. With a SQLSTATE in the second position pgTAP reads the third as
  -- the expected message, so the three-argument form compared this test's own description against
  -- Postgres's constraint-violation text and failed the rehearsal. The message is left null
  -- because its wording is Postgres's to change; the code and the constraint name are the claim.
  null::text,
  'an approval whose digest cannot be re-derived is refused at the column'
);

select ok(
  (select count(*) from pg_constraint
   where conrelid = 'public.customer_data_gate_receipts'::regclass
     and conname = 'customer_data_gate_evidence_matches_count') = 1,
  'the evidence constraint is named, so a later migration can find it'
);

select * from finish();
rollback;
