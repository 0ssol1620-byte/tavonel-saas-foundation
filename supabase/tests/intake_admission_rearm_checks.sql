-- Migration 20261117160200: a re-armed upload admission passes every check a first reservation passes
-- (WO-CAT-10, decision CAT-D15).
--
-- Until 20261117160200 the re-arm of an expired, unconfirmed admission returned before the trial,
-- paid and quota checks; the expired row is not counted by those checks, so a retried file could
-- take a workspace past them. Each refusal below is also asked of a first reservation in the same
-- state: a refused re-arm answers what a refused first reservation answers. Every call goes through
-- the seven-argument wrapper the upload route calls; no workspace here is capped by a plan, so the
-- storage map is not read. Workspaces:
--   pilot-rck01  trial, at its three-file limit with a fourth file parked expired
--   pilot-rck06  trial, two live files and a third parked: the re-arm is the third (counted once)
--   pilot-rck02  trial that has ended since its file was parked
--   pilot-rck05  paid plan (with an expired trial row) that went past_due since its file was parked
--   pilot-rck03  legacy paid plan at its per-minute count quota
--   pilot-rck04  legacy paid plan at its per-day count quota
begin;
select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
  'intake-rearm-checks-' || n || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"google","providers":["google"]}', '{}', now(), now()
from (values
  (1, 'e1e1e1e1-0000-4000-8000-0000000000e1'), (2, 'e2e2e2e2-0000-4000-8000-0000000000e2'),
  (3, 'e3e3e3e3-0000-4000-8000-0000000000e3'), (4, 'e4e4e4e4-0000-4000-8000-0000000000e4'),
  (5, 'e5e5e5e5-0000-4000-8000-0000000000e5'), (6, 'e6e6e6e6-0000-4000-8000-0000000000e6')
) as u(n, id);

insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status)
values
  ('pilot-rck03', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'observer_access', null, 'active'),
  ('pilot-rck04', 'e4e4e4e4-0000-4000-8000-0000000000e4', 'observer_access', null, 'active'),
  ('pilot-rck05', 'e5e5e5e5-0000-4000-8000-0000000000e5', 'observer_access', null, 'active');

insert into public.foundation_self_service_trials (user_id, workspace_key, status, started_at, expires_at, ended_reason)
values
  ('e1e1e1e1-0000-4000-8000-0000000000e1', 'pilot-rck01', 'trialing', now(), now() + interval '7 days', null),
  ('e2e2e2e2-0000-4000-8000-0000000000e2', 'pilot-rck02', 'trialing', now(), now() + interval '7 days', null),
  ('e5e5e5e5-0000-4000-8000-0000000000e5', 'pilot-rck05', 'expired', now() - interval '40 days', now() - interval '33 days', 'TRIAL_TIME_EXPIRED'),
  ('e6e6e6e6-0000-4000-8000-0000000000e6', 'pilot-rck06', 'trialing', now(), now() + interval '7 days', null);

create function pg_temp.admit(p_workspace text, p_user text, p_document text, p_bytes integer) returns jsonb
language sql as $$
  select public.reserve_foundation_intake_admission(p_workspace, p_document::uuid, p_user::uuid,
    'quarantine/' || p_workspace || '/' || p_document || '/source', p_bytes, 'application/pdf', '{}'::jsonb);
$$;
-- The admission as it stands when its window has passed: created twenty minutes ago, expired ten.
create function pg_temp.expire(p_workspace text, p_document text) returns void language sql as $$
  update public.foundation_intake_admissions
     set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
   where workspace_key = p_workspace and document_id = p_document::uuid;
$$;
create function pg_temp.live(p_workspace text) returns integer language sql as $$
  select count(*)::integer from public.foundation_intake_admissions
   where workspace_key = p_workspace and (confirmed_at is not null or expires_at > clock_timestamp());
$$;
create function pg_temp.row_of(p_workspace text, p_document text) returns public.foundation_intake_admissions
language sql as $$
  select * from public.foundation_intake_admissions where workspace_key = p_workspace and document_id = p_document::uuid;
$$;

-- (a) 1-6: the trial file limit. Three files admitted, the third parked expired, a fourth admitted.
set local role service_role;
select pg_temp.admit('pilot-rck01', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000a1', 1024);
select pg_temp.admit('pilot-rck01', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000a2', 1024);
select pg_temp.admit('pilot-rck01', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000a3', 1024);
reset role;
select pg_temp.expire('pilot-rck01', 'f1f1f1f1-0000-4000-8000-0000000000a3');
set local role service_role;
select is(pg_temp.admit('pilot-rck01', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000a4', 1024)->>'intakeClass',
  'trial', 'rck01: the parked file is not counted, so a fourth file is admitted as the third live one');
-- Before 20261117160200 this re-arm returned and the trial held four live files.
select throws_ok($$select pg_temp.admit('pilot-rck01', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000a3', 1024)$$,
  'P0001', 'foundation_trial_file_limit_exceeded', 're-arming the parked file at the trial file limit is refused');
select throws_ok($$select pg_temp.admit('pilot-rck01', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000a5', 1024)$$,
  'P0001', 'foundation_trial_file_limit_exceeded', 'a first reservation in the same state is refused the same way');
reset role;
select ok((select (r).expires_at <= clock_timestamp() and (r).created_at < now() - interval '15 minutes'
             from (select pg_temp.row_of('pilot-rck01', 'f1f1f1f1-0000-4000-8000-0000000000a3') as r) s),
  'the refused re-arm leaves the parked row as it was');
set local role service_role;
select pg_temp.admit('pilot-rck01', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000a1', 1024)->>'expiresAt' as replay_expires \gset
reset role;
select is(:'replay_expires'::timestamptz, (pg_temp.row_of('pilot-rck01', 'f1f1f1f1-0000-4000-8000-0000000000a1')).expires_at,
  'a live reservation replayed at the limit is answered with its own window, not refused');
select is(pg_temp.live('pilot-rck01'), 3, 'the replay is not counted again: still three live files');

-- 7-8: the row being re-armed is the candidate, counted once: two live files plus the re-arm is three.
set local role service_role;
select pg_temp.admit('pilot-rck06', 'e6e6e6e6-0000-4000-8000-0000000000e6', 'f6f6f6f6-0000-4000-8000-0000000000b1', 1024);
select pg_temp.admit('pilot-rck06', 'e6e6e6e6-0000-4000-8000-0000000000e6', 'f6f6f6f6-0000-4000-8000-0000000000b2', 1024);
select pg_temp.admit('pilot-rck06', 'e6e6e6e6-0000-4000-8000-0000000000e6', 'f6f6f6f6-0000-4000-8000-0000000000b3', 1024);
reset role;
select pg_temp.expire('pilot-rck06', 'f6f6f6f6-0000-4000-8000-0000000000b3');
set local role service_role;
select is(pg_temp.admit('pilot-rck06', 'e6e6e6e6-0000-4000-8000-0000000000e6', 'f6f6f6f6-0000-4000-8000-0000000000b3', 2048)->>'confirmed',
  'false', 'rck06: a re-arm that brings the trial exactly to its limit is admitted');
reset role;
select ok(pg_temp.live('pilot-rck06') = 3
    and (select (r).requested_bytes = 2048 and (r).expires_at > clock_timestamp()
           from (select pg_temp.row_of('pilot-rck06', 'f6f6f6f6-0000-4000-8000-0000000000b3') as r) s),
  'the re-armed row is live with the retried size, and the trial holds three files');

-- (b) 9-10: a trial that ended after the file was parked.
set local role service_role;
select pg_temp.admit('pilot-rck02', 'e2e2e2e2-0000-4000-8000-0000000000e2', 'f2f2f2f2-0000-4000-8000-0000000000c1', 1024);
reset role;
select pg_temp.expire('pilot-rck02', 'f2f2f2f2-0000-4000-8000-0000000000c1');
update public.foundation_self_service_trials
   set status = 'expired', started_at = now() - interval '8 days', expires_at = now() - interval '1 minute', ended_reason = 'TRIAL_TIME_EXPIRED'
 where workspace_key = 'pilot-rck02';
set local role service_role;
select throws_ok($$select pg_temp.admit('pilot-rck02', 'e2e2e2e2-0000-4000-8000-0000000000e2', 'f2f2f2f2-0000-4000-8000-0000000000c1', 1024)$$,
  'P0001', 'foundation_trial_not_active', 'rck02: re-arming after the trial ended is refused');
select throws_ok($$select pg_temp.admit('pilot-rck02', 'e2e2e2e2-0000-4000-8000-0000000000e2', 'f2f2f2f2-0000-4000-8000-0000000000c2', 1024)$$,
  'P0001', 'foundation_trial_not_active', 'a first reservation after the trial ended is refused the same way');

-- 11-13: the paid check. Parked while the plan was active; the plan is past_due when it is retried.
select is(pg_temp.admit('pilot-rck05', 'e5e5e5e5-0000-4000-8000-0000000000e5', 'f5f5f5f5-0000-4000-8000-0000000000d1', 1024)->>'intakeClass',
  'paid', 'rck05: admitted as paid while the plan is active');
reset role;
select pg_temp.expire('pilot-rck05', 'f5f5f5f5-0000-4000-8000-0000000000d1');
update public.foundation_billing_accounts set subscription_status = 'past_due' where workspace_key = 'pilot-rck05';
set local role service_role;
select throws_ok($$select pg_temp.admit('pilot-rck05', 'e5e5e5e5-0000-4000-8000-0000000000e5', 'f5f5f5f5-0000-4000-8000-0000000000d1', 1024)$$,
  'P0001', 'foundation_trial_not_active', 're-arming after the plan lapsed is refused (its expired trial decides)');
select throws_ok($$select pg_temp.admit('pilot-rck05', 'e5e5e5e5-0000-4000-8000-0000000000e5', 'f5f5f5f5-0000-4000-8000-0000000000d2', 1024)$$,
  'P0001', 'foundation_trial_not_active', 'a first reservation after the plan lapsed is refused the same way');

-- (c) 14-16: the per-minute count quota (20 for a paid plan). Two files parked, nineteen admitted.
select pg_temp.admit('pilot-rck03', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'f3f3f3f3-0000-4000-8000-0000000000e1', 1024);
select pg_temp.admit('pilot-rck03', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'f3f3f3f3-0000-4000-8000-0000000000e2', 1024);
reset role;
select pg_temp.expire('pilot-rck03', 'f3f3f3f3-0000-4000-8000-0000000000e1');
select pg_temp.expire('pilot-rck03', 'f3f3f3f3-0000-4000-8000-0000000000e2');
set local role service_role;
select count(pg_temp.admit('pilot-rck03', 'e3e3e3e3-0000-4000-8000-0000000000e3',
  'f3f3f3f3-0000-4000-8000-' || lpad(g::text, 12, '0'), 1024)) from generate_series(1, 19) g;
select is(pg_temp.admit('pilot-rck03', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'f3f3f3f3-0000-4000-8000-0000000000e1', 1024)->>'confirmed',
  'false', 'rck03: the first re-arm is the twentieth admission of the minute and is admitted');
select throws_ok($$select pg_temp.admit('pilot-rck03', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'f3f3f3f3-0000-4000-8000-0000000000e2', 1024)$$,
  'P0001', 'foundation_intake_rate_limited', 'the second re-arm, the twenty-first of the minute, is refused');
select throws_ok($$select pg_temp.admit('pilot-rck03', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'f3f3f3f3-0000-4000-8000-0000000000e3', 1024)$$,
  'P0001', 'foundation_intake_rate_limited', 'a first reservation in the same minute is refused the same way');

-- (d) 17-18: the per-day count quota (200 for a paid plan). One file parked, 200 confirmed today.
select pg_temp.admit('pilot-rck04', 'e4e4e4e4-0000-4000-8000-0000000000e4', 'f4f4f4f4-0000-4000-8000-0000000000f1', 1024);
reset role;
select pg_temp.expire('pilot-rck04', 'f4f4f4f4-0000-4000-8000-0000000000f1');
insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type, created_at, expires_at, confirmed_at
)
select 'pilot-rck04', d, 'e4e4e4e4-0000-4000-8000-0000000000e4'::uuid, 'quarantine/pilot-rck04/' || d::text || '/source',
  1024, 'application/pdf', now() - interval '2 hours', now() - interval '2 hours' + interval '10 minutes',
  now() - interval '2 hours' + interval '1 minute'
from (select ('f4f4f4f4-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid as d from generate_series(1, 200) g) s;
set local role service_role;
select throws_ok($$select pg_temp.admit('pilot-rck04', 'e4e4e4e4-0000-4000-8000-0000000000e4', 'f4f4f4f4-0000-4000-8000-0000000000f1', 1024)$$,
  'P0001', 'foundation_intake_daily_quota_exceeded', 'rck04: re-arming past the daily count quota is refused');
select throws_ok($$select pg_temp.admit('pilot-rck04', 'e4e4e4e4-0000-4000-8000-0000000000e4', 'f4f4f4f4-0000-4000-8000-0000000000f2', 1024)$$,
  'P0001', 'foundation_intake_daily_quota_exceeded', 'a first reservation past the daily quota is refused the same way');
reset role;

-- 19-20: the installed bodies are the ones the rollback draft guards on, and the grants are kept.
select is(md5(pg_get_functiondef('public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)'::regprocedure))
    || ' ' || md5(pg_get_functiondef('public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)'::regprocedure)),
  '240678b7f388b6e4b6f75dbe3cf0191e 5c2fd1f532fd30259819b8fafe421532',
  'the inner function is the 20261117160200 body supabase/drafts/rollback-20261117160200-*.sql expects; the wrapper is unchanged');
select ok(not has_function_privilege('service_role', 'public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)', 'EXECUTE'),
  'grants are unchanged: only the wrapper is callable, and only by the server');

select * from finish();
rollback;
