-- Run with Supabase CLI db test after 0008_foundation_intake_admission.sql.
begin;
select plan(14);

select has_table('public', 'foundation_intake_admissions', 'intake admission table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_intake_admissions'::regclass), 'intake admissions have RLS');
select ok(not has_table_privilege('anon', 'public.foundation_intake_admissions', 'select'), 'anonymous clients cannot read intake admissions');
select ok(not has_table_privilege('authenticated', 'public.foundation_intake_admissions', 'select'), 'authenticated clients cannot read intake admissions');
select ok(not has_function_privilege('authenticated', 'public.reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text)', 'execute'), 'authenticated clients cannot reserve directly');
select ok(has_function_privilege('service_role', 'public.reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text)', 'execute'), 'service role can reserve');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '44444444-4444-4444-8444-444444444444',
  'authenticated', 'authenticated', 'intake-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select is(
  public.reserve_foundation_intake_admission(
    'pilot-intaketest000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '44444444-4444-4444-8444-444444444444',
    'quarantine/pilot-intaketest000/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source',
    1024, 'application/pdf'
  )->>'idempotentReplay',
  'false',
  'first exact request is admitted'
);
select is((select count(*)::integer from public.foundation_intake_admissions), 1, 'admission is persisted once');
select is(
  public.reserve_foundation_intake_admission(
    'pilot-intaketest000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '44444444-4444-4444-8444-444444444444',
    'quarantine/pilot-intaketest000/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source',
    1024, 'application/pdf'
  )->>'idempotentReplay',
  'true',
  'exact retry is idempotent'
);
select is((select count(*)::integer from public.foundation_intake_admissions), 1, 'idempotent retry does not duplicate admission');

select throws_ok(
  $$select public.reserve_foundation_intake_admission(
    'pilot-intaketest000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '44444444-4444-4444-8444-444444444444',
    'quarantine/pilot-intaketest000/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source',
    2048, 'application/pdf'
  )$$,
  'foundation_intake_idempotency_conflict',
  'same identity cannot be rebound to different bytes'
);
select throws_ok(
  $$select public.reserve_foundation_intake_admission(
    'pilot-intaketest000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '44444444-4444-4444-8444-444444444444',
    'quarantine/pilot-other/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/source',
    1024, 'application/pdf'
  )$$,
  'foundation_intake_admission_invalid',
  'cross-workspace object binding is rejected'
);

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes,
  declared_mime_type, created_at, updated_at, expires_at
)
select
  'pilot-ratetest00000',
  ('00000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '44444444-4444-4444-8444-444444444444',
  'quarantine/pilot-ratetest00000/00000000-0000-4000-8000-' || lpad(value::text, 12, '0') || '/source',
  1024, 'application/pdf', now(), now(), now() + interval '10 minutes'
from generate_series(1, 5) value;
select throws_ok(
  $$select public.reserve_foundation_intake_admission(
    'pilot-ratetest00000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '44444444-4444-4444-8444-444444444444',
    'quarantine/pilot-ratetest00000/cccccccc-cccc-4ccc-8ccc-cccccccccccc/source',
    1024, 'application/pdf'
  )$$,
  'foundation_intake_rate_limited',
  'sixth request inside one minute is rejected'
);

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes,
  declared_mime_type, created_at, updated_at, expires_at
)
select
  'pilot-daytest000000',
  ('10000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '44444444-4444-4444-8444-444444444444',
  'quarantine/pilot-daytest000000/10000000-0000-4000-8000-' || lpad(value::text, 12, '0') || '/source',
  1024, 'application/pdf', now() - interval '2 minutes', now() - interval '2 minutes', now() + interval '8 minutes'
from generate_series(1, 20) value;
select throws_ok(
  $$select public.reserve_foundation_intake_admission(
    'pilot-daytest000000', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '44444444-4444-4444-8444-444444444444',
    'quarantine/pilot-daytest000000/dddddddd-dddd-4ddd-8ddd-dddddddddddd/source',
    1024, 'application/pdf'
  )$$,
  'foundation_intake_daily_quota_exceeded',
  'twenty-first request inside 24 hours is rejected'
);

select * from finish();
rollback;
