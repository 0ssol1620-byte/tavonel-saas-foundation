-- Migration 20261127060000: an upload refused after its intake admission was reserved no longer holds a
-- slot of the free evaluation's three files (WO-TRIAL-RELEASE-1, first-5-minutes audit #20).
--
-- Every reservation goes through the seven-argument wrapper the upload route calls; every refusal through
-- refuse_foundation_intake_admission, the call the route now makes after a compute refusal. No workspace
-- here is capped by a plan, so the storage map is not read. Workspaces:
--   pilot-trl01  trial: three reserved, one refused -> a fourth is admitted; the refused one cannot be
--                confirmed or retried past the limit; confirmed files (even CDR-refused) stay counted
--   pilot-trl02  trial: an admission that expired unconfirmed is not counted (already true before)
--   pilot-trl03  trial: a refused file retried with room is a request again and can be confirmed
--   pilot-trl04  trial at the limit after a release: two reservations for the one free slot
--   pilot-trl05  legacy paid plan: no file limit; a refused paid admission is released the same way
-- The real two-session race (the second blocked on the workspace lock) is not expressible here:
-- receipts/WO-TRIAL-RELEASE-1/race.py ran it against a local cluster.
begin;
select plan(24);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
  'trial-intake-release-' || n || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"google","providers":["google"]}', '{}', now(), now()
from (values
  (1, 'a1a1a1a1-0000-4000-8000-0000000000a1'), (2, 'a2a2a2a2-0000-4000-8000-0000000000a2'),
  (3, 'a3a3a3a3-0000-4000-8000-0000000000a3'), (4, 'a4a4a4a4-0000-4000-8000-0000000000a4'),
  (5, 'a5a5a5a5-0000-4000-8000-0000000000a5')
) as u(n, id);

insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status)
values ('pilot-trl05', 'a5a5a5a5-0000-4000-8000-0000000000a5', 'observer_access', null, 'active');

insert into public.foundation_self_service_trials (user_id, workspace_key, status, started_at, expires_at, ended_reason)
values
  ('a1a1a1a1-0000-4000-8000-0000000000a1', 'pilot-trl01', 'trialing', now(), now() + interval '7 days', null),
  ('a2a2a2a2-0000-4000-8000-0000000000a2', 'pilot-trl02', 'trialing', now(), now() + interval '7 days', null),
  ('a3a3a3a3-0000-4000-8000-0000000000a3', 'pilot-trl03', 'trialing', now(), now() + interval '7 days', null),
  ('a4a4a4a4-0000-4000-8000-0000000000a4', 'pilot-trl04', 'trialing', now(), now() + interval '7 days', null);

create function pg_temp.admit(p_workspace text, p_user text, p_document text) returns jsonb
language sql as $$
  select public.reserve_foundation_intake_admission(p_workspace, p_document::uuid, p_user::uuid,
    'quarantine/' || p_workspace || '/' || p_document || '/source', 1024, 'application/pdf', '{}'::jsonb);
$$;
create function pg_temp.refuse(p_workspace text, p_document text) returns jsonb language sql as $$
  select public.refuse_foundation_intake_admission(p_workspace, p_document::uuid, 'TRIAL_PAGE_LIMIT_EXCEEDED');
$$;
create function pg_temp.confirm(p_workspace text, p_user text, p_document text) returns jsonb language sql as $$
  select public.confirm_foundation_intake_admission(p_workspace, p_document::uuid, p_user::uuid);
$$;
-- The same predicate every count of the intake functions reads.
create function pg_temp.counted(p_workspace text) returns integer language sql as $$
  select count(*)::integer from public.foundation_intake_admissions
   where workspace_key = p_workspace and (confirmed_at is not null or expires_at > clock_timestamp());
$$;
create function pg_temp.row_of(p_workspace text, p_document text) returns public.foundation_intake_admissions
language sql as $$
  select * from public.foundation_intake_admissions where workspace_key = p_workspace and document_id = p_document::uuid;
$$;

-- (a) 1-4: refused, not counted.
set local role service_role;
select pg_temp.admit('pilot-trl01', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-000000000001');
select pg_temp.admit('pilot-trl01', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-000000000002');
select pg_temp.admit('pilot-trl01', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-000000000003');
select is(pg_temp.refuse('pilot-trl01', 'b1b1b1b1-0000-4000-8000-000000000003')->>'state', 'rejected',
  'trl01: the third reservation is refused after admission (a compute refusal)');
reset role;
select ok((select (r).expires_at <= clock_timestamp() and (r).confirmed_at is null
             from (select pg_temp.row_of('pilot-trl01', 'b1b1b1b1-0000-4000-8000-000000000003') as r) s)
    and pg_temp.counted('pilot-trl01') = 2,
  'the refused, unconfirmed admission closed its window: two files are counted');
set local role service_role;
-- Before 20261127060000 this raised foundation_trial_file_limit_exceeded for the next ten minutes.
select is(pg_temp.admit('pilot-trl01', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-000000000004')->>'intakeClass',
  'trial', 'a different file takes the released slot');
select throws_ok($$select pg_temp.admit('pilot-trl01', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-000000000005')$$,
  'P0001', 'foundation_trial_file_limit_exceeded', 'the limit still holds: a fifth file with three counted is refused');

-- 5-8: a refused admission can never become a file past the limit.
select throws_ok($$select pg_temp.confirm('pilot-trl01', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-000000000003')$$,
  'P0001', 'foundation_intake_admission_refused', 'an upload URL issued before the refusal cannot confirm the released file');
select throws_ok($$select pg_temp.admit('pilot-trl01', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-000000000003')$$,
  'P0001', 'foundation_trial_file_limit_exceeded', 'retrying the refused file at the limit is re-checked and refused');
reset role;
select ok((select (r).state::text = 'rejected' and (r).expires_at <= clock_timestamp()
             from (select pg_temp.row_of('pilot-trl01', 'b1b1b1b1-0000-4000-8000-000000000003') as r) s)
    and pg_temp.counted('pilot-trl01') = 3,
  'the refused retry left the row refused and released; three files counted');
set local role service_role;
select is(pg_temp.refuse('pilot-trl01', 'b1b1b1b1-0000-4000-8000-000000000003')->>'state', 'rejected',
  'a second refusal of the same admission answers the same');
reset role;

-- 9-12: confirmed counts, and stays counted when the CDR later refuses the file that arrived.
set local role service_role;
select is(pg_temp.confirm('pilot-trl01', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-000000000001')->>'status',
  'confirmed', 'trl01: an uploaded file is confirmed');
reset role;
select expires_at as confirmed_window from public.foundation_intake_admissions
 where workspace_key = 'pilot-trl01' and document_id = 'b1b1b1b1-0000-4000-8000-000000000001' \gset
set local role service_role;
select pg_temp.refuse('pilot-trl01', 'b1b1b1b1-0000-4000-8000-000000000001');
reset role;
select ok((select (r).state::text = 'rejected' and (r).confirmed_at is not null and (r).expires_at = :'confirmed_window'::timestamptz
             from (select pg_temp.row_of('pilot-trl01', 'b1b1b1b1-0000-4000-8000-000000000001') as r) s),
  'a refusal of a confirmed file keeps its window (the CDR path is unchanged)');
update public.foundation_intake_admissions set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
 where workspace_key = 'pilot-trl01' and document_id = 'b1b1b1b1-0000-4000-8000-000000000001';
select is(pg_temp.counted('pilot-trl01'), 3, 'a confirmed file is counted even after its window and its CDR refusal');
set local role service_role;
select throws_ok($$select pg_temp.admit('pilot-trl01', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-000000000006')$$,
  'P0001', 'foundation_trial_file_limit_exceeded', 'so the trial stays at its limit');
reset role;

-- (b) 13-14: expired unconfirmed, not counted (unchanged by this migration).
set local role service_role;
select pg_temp.admit('pilot-trl02', 'a2a2a2a2-0000-4000-8000-0000000000a2', 'b2b2b2b2-0000-4000-8000-000000000001');
select pg_temp.admit('pilot-trl02', 'a2a2a2a2-0000-4000-8000-0000000000a2', 'b2b2b2b2-0000-4000-8000-000000000002');
select pg_temp.admit('pilot-trl02', 'a2a2a2a2-0000-4000-8000-0000000000a2', 'b2b2b2b2-0000-4000-8000-000000000003');
reset role;
update public.foundation_intake_admissions set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
 where workspace_key = 'pilot-trl02' and document_id = 'b2b2b2b2-0000-4000-8000-000000000003';
select is(pg_temp.counted('pilot-trl02'), 2, 'trl02: an admission that expired unconfirmed is not counted');
set local role service_role;
select is(pg_temp.admit('pilot-trl02', 'a2a2a2a2-0000-4000-8000-0000000000a2', 'b2b2b2b2-0000-4000-8000-000000000004')->>'intakeClass',
  'trial', 'so a different file is admitted as the third');
reset role;

-- (c) 15-17: a refused file retried with room is a request again, and becomes a counted file.
set local role service_role;
select pg_temp.admit('pilot-trl03', 'a3a3a3a3-0000-4000-8000-0000000000a3', 'b3b3b3b3-0000-4000-8000-000000000001');
select pg_temp.refuse('pilot-trl03', 'b3b3b3b3-0000-4000-8000-000000000001');
select is(pg_temp.admit('pilot-trl03', 'a3a3a3a3-0000-4000-8000-0000000000a3', 'b3b3b3b3-0000-4000-8000-000000000001')->>'confirmed',
  'false', 'trl03: the refused file retried with room is re-armed');
reset role;
select ok((select (r).state::text = 'requested' and (r).expires_at > clock_timestamp()
             from (select pg_temp.row_of('pilot-trl03', 'b3b3b3b3-0000-4000-8000-000000000001') as r) s)
    and pg_temp.counted('pilot-trl03') = 1,
  'the re-armed row is a live request again, counted once');
set local role service_role;
select is(pg_temp.confirm('pilot-trl03', 'a3a3a3a3-0000-4000-8000-0000000000a3', 'b3b3b3b3-0000-4000-8000-000000000001')->>'status',
  'confirmed', 'and its upload confirms');
reset role;

-- (d) 18-20: two reservations for the one slot a refusal freed. They serialize on the workspace lock;
-- in one session that is the order below. Exactly one is admitted, and the count is the limit.
set local role service_role;
select pg_temp.admit('pilot-trl04', 'a4a4a4a4-0000-4000-8000-0000000000a4', 'b4b4b4b4-0000-4000-8000-000000000001');
select pg_temp.admit('pilot-trl04', 'a4a4a4a4-0000-4000-8000-0000000000a4', 'b4b4b4b4-0000-4000-8000-000000000002');
select pg_temp.admit('pilot-trl04', 'a4a4a4a4-0000-4000-8000-0000000000a4', 'b4b4b4b4-0000-4000-8000-000000000003');
select pg_temp.refuse('pilot-trl04', 'b4b4b4b4-0000-4000-8000-000000000003');
select is(pg_temp.admit('pilot-trl04', 'a4a4a4a4-0000-4000-8000-0000000000a4', 'b4b4b4b4-0000-4000-8000-000000000003')->>'confirmed',
  'false', 'trl04: the refused file retried takes the freed slot first');
select throws_ok($$select pg_temp.admit('pilot-trl04', 'a4a4a4a4-0000-4000-8000-0000000000a4', 'b4b4b4b4-0000-4000-8000-000000000004')$$,
  'P0001', 'foundation_trial_file_limit_exceeded', 'the second reservation for the same slot is refused');
reset role;
select is(pg_temp.counted('pilot-trl04'), 3, 'the trial holds exactly its three files');

-- (e) 21-22: paid. No file limit applies; a refused paid admission is released the same way.
set local role service_role;
select count(pg_temp.admit('pilot-trl05', 'a5a5a5a5-0000-4000-8000-0000000000a5',
  'b5b5b5b5-0000-4000-8000-' || lpad(g::text, 12, '0'))) from generate_series(1, 4) g;
select pg_temp.refuse('pilot-trl05', 'b5b5b5b5-0000-4000-8000-000000000004');
reset role;
select is(pg_temp.counted('pilot-trl05'), 3, 'trl05: four paid admissions, the refused one released');
set local role service_role;
select is(pg_temp.admit('pilot-trl05', 'a5a5a5a5-0000-4000-8000-0000000000a5', 'b5b5b5b5-0000-4000-8000-000000000004')->>'confirmed',
  'false', 'the refused paid file retried is re-armed like any expired one');
reset role;

-- 23-24: the installed bodies are the ones the rollback draft guards on, and the grants are kept.
select is(md5(pg_get_functiondef('public.refuse_foundation_intake_admission(text, uuid, text)'::regprocedure))
    || ' ' || md5(pg_get_functiondef('public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)'::regprocedure))
    || ' ' || md5(pg_get_functiondef('public.confirm_foundation_intake_admission(text, uuid, uuid, text, bigint, text)'::regprocedure)),
  '6acce3d69b7441bf4adc76b8b438105d 968fafded557158da2e898281a35527b 8f559f53a69827ce38727aaf129f4954',
  'the three functions are the 20261127060000 bodies its rollback draft expects');
select ok(has_function_privilege('service_role', 'public.refuse_foundation_intake_admission(text, uuid, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.refuse_foundation_intake_admission(text, uuid, text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.confirm_foundation_intake_admission(text, uuid, uuid, text, bigint, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.confirm_foundation_intake_admission(text, uuid, uuid, text, bigint, text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)', 'EXECUTE'),
  'grants are unchanged');

select * from finish();
rollback;
