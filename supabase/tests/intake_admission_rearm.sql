-- Migration 20261117160100: re-arming an expired upload admission (WO-CAT-9).
--
-- An unconfirmed admission expires ten minutes after it was created. A customer who retries the same
-- file after that re-arms it. Before 20261117160100 the re-arm moved expires_at and not created_at,
-- and every re-arm broke foundation_intake_admissions_check1 (expires_at <= created_at + 15 min):
-- 23514, a server error for a plain retry. Workspaces:
--   pilot-rearm01  legacy observer_access (plan_code null): the six-argument path, no allowance
--   pilot-rearm02  Personal (plan_code personal): the seven-argument path, with an allowance
-- The storage-allowance map's shape (item 3 of WO-CAT-9) is tested on pilot-rearm02.
-- The allowance refusal on the re-arm path is in workspace_storage_allowance.sql (16).
begin;
select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
  'intake-rearm-' || n || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"google","providers":["google"]}', '{}', now(), now()
from (values
  (1, 'a7a7a7a7-0000-4000-8000-0000000000a7'), (2, 'a8a8a8a8-0000-4000-8000-0000000000a8')
) as u(n, id);

insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status)
values
  ('pilot-rearm01', 'a7a7a7a7-0000-4000-8000-0000000000a7', 'observer_access', null, 'active'),
  ('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'observer_access', 'personal', 'active');

create function pg_temp.admit6(p_workspace text, p_user text, p_document text, p_bytes integer) returns jsonb
language sql as $$
  select public.reserve_foundation_intake_admission(p_workspace, p_document::uuid, p_user::uuid,
    'quarantine/' || p_workspace || '/' || p_document || '/source', p_bytes, 'application/pdf');
$$;
create function pg_temp.admit7(p_workspace text, p_user text, p_document text, p_bytes integer, p_limits jsonb) returns jsonb
language sql as $$
  select public.reserve_foundation_intake_admission(p_workspace, p_document::uuid, p_user::uuid,
    'quarantine/' || p_workspace || '/' || p_document || '/source', p_bytes, 'application/pdf', p_limits);
$$;
-- The admission as it stands when its window has passed: created twenty minutes ago, expired ten.
create function pg_temp.expire(p_workspace text, p_document text) returns void language sql as $$
  update public.foundation_intake_admissions
     set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
   where workspace_key = p_workspace and document_id = p_document::uuid;
$$;
create function pg_temp.row_of(p_workspace text, p_document text) returns public.foundation_intake_admissions
language sql as $$
  select * from public.foundation_intake_admissions where workspace_key = p_workspace and document_id = p_document::uuid;
$$;

set local role service_role;

-- 1-5: the six-argument path (legacy workspace, no allowance).
select is(pg_temp.admit6('pilot-rearm01', 'a7a7a7a7-0000-4000-8000-0000000000a7', 'b9b9b9b9-0000-4000-8000-0000000000b1', 1024)->>'intakeClass',
  'paid', 'rearm01: the first upload is admitted');
reset role;
select pg_temp.expire('pilot-rearm01', 'b9b9b9b9-0000-4000-8000-0000000000b1');
set local role service_role;
-- Before 20261117160100 this call raised 23514: foundation_intake_admissions_check1.
select is(pg_temp.admit6('pilot-rearm01', 'a7a7a7a7-0000-4000-8000-0000000000a7', 'b9b9b9b9-0000-4000-8000-0000000000b1', 2048)->>'idempotentReplay',
  'false', 'retrying the same file after its window re-arms the admission instead of failing the check constraint');
reset role;
select ok((select (r).expires_at - (r).created_at = interval '10 minutes' and (r).expires_at > clock_timestamp()
             and (r).requested_bytes = 2048 and (r).confirmed_at is null
             from (select pg_temp.row_of('pilot-rearm01', 'b9b9b9b9-0000-4000-8000-0000000000b1') as r) s),
  'the re-armed row is one consistent window: ten minutes from now, with the retried size, still unconfirmed');
select ok((select (r).created_at >= now() from (select pg_temp.row_of('pilot-rearm01', 'b9b9b9b9-0000-4000-8000-0000000000b1') as r) s),
  'created_at is the start of the current window, not the first sighting');
set local role service_role;
select lives_ok($$select public.confirm_foundation_intake_admission('pilot-rearm01', 'b9b9b9b9-0000-4000-8000-0000000000b1'::uuid, 'a7a7a7a7-0000-4000-8000-0000000000a7'::uuid)$$,
  'the re-armed admission is confirmed (confirmed_at >= created_at holds)');

-- 6-7: what is not a re-arm is unchanged.
select is(pg_temp.admit6('pilot-rearm01', 'a7a7a7a7-0000-4000-8000-0000000000a7', 'b9b9b9b9-0000-4000-8000-0000000000b1', 2048)->>'idempotentReplay',
  'true', 'a confirmed admission is a replay, never re-armed');
select is((pg_temp.admit6('pilot-rearm01', 'a7a7a7a7-0000-4000-8000-0000000000a7', 'b9b9b9b9-0000-4000-8000-0000000000b2', 1024)->>'expiresAt')::timestamptz,
  (pg_temp.admit6('pilot-rearm01', 'a7a7a7a7-0000-4000-8000-0000000000a7', 'b9b9b9b9-0000-4000-8000-0000000000b2', 1024)->>'expiresAt')::timestamptz,
  'a live, unconfirmed admission replayed keeps its window');

-- 8-9: the seven-argument path re-arms too, and checks the re-armed bytes against the allowance.
select is(pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c1', 1024, '{"personal": 2048}')->>'intakeClass',
  'paid', 'rearm02: the first upload is admitted under its allowance');
reset role;
select pg_temp.expire('pilot-rearm02', 'b9b9b9b9-0000-4000-8000-0000000000c1');
set local role service_role;
select is(pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c1', 2048, '{"personal": 2048}')->>'confirmed',
  'false', 'a Personal workspace re-arms a retried file that brings it exactly to its allowance');

-- 10-18: an allowance that is not a whole, non-negative JSON number is a missing allowance, never a cast error.
select throws_ok($$select pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c2', 1, '{"personal": "x"}')$$,
  'P0001', 'foundation_storage_limit_missing', 'a string entry is a missing allowance (was 22P02)');
select throws_ok($$select pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c2', 1, '{"personal": "4096"}')$$,
  'P0001', 'foundation_storage_limit_missing', 'a numeric string is not a number (was accepted as 4096)');
select throws_ok($$select pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c2', 1, '{"personal": 4096.5}')$$,
  'P0001', 'foundation_storage_limit_missing', 'a fraction is a missing allowance (was 22P02)');
select throws_ok($$select pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c2', 1, '{"personal": {"bytes": 4096}}')$$,
  'P0001', 'foundation_storage_limit_missing', 'an object is a missing allowance (was 22P02)');
select throws_ok($$select pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c2', 1, '{"personal": 1e30}')$$,
  'P0001', 'foundation_storage_limit_missing', 'a number past bigint is a missing allowance (was 22003)');
select throws_ok($$select pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c2', 1, '{"personal": -1}')$$,
  'P0001', 'foundation_storage_limit_missing', 'a negative number is a missing allowance');
select throws_ok($$select pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c2', 1, '[4096]')$$,
  'P0001', 'foundation_storage_limit_missing', 'a map that is not an object is a missing allowance');
select throws_ok($$select pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c2', 1, '{"personal": 0}')$$,
  'P0001', 'foundation_storage_allowance_exhausted', 'zero is an allowance, and a full one: refused as exhausted, not as missing');
select is(pg_temp.admit7('pilot-rearm02', 'a8a8a8a8-0000-4000-8000-0000000000a8', 'b9b9b9b9-0000-4000-8000-0000000000c2', 1024, '{"personal": 4096}')->>'intakeClass',
  'paid', 'a whole JSON number still admits');
reset role;

-- 19-20: the installed bodies are the ones the rollback drafts guard on, and the grants are kept.
-- 20261123120000 (WO-C-T2) redefined the inner function; its rollback restores 240678b7..., the
-- 20261117160200 (WO-CAT-10) body, whose rollback restores 7a71d281..., the
-- 20261117160100 body supabase/drafts/rollback-20261117160100-*.sql guards on. The wrapper is
-- 20261127070000's (WO-METER-NULLPLAN-1, 76e0d93f...); its rollback restores 5c2fd1f5..., the 160100 body.
select is(md5(pg_get_functiondef('public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)'::regprocedure))
    || ' ' || md5(pg_get_functiondef('public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)'::regprocedure)),
  '1bd2c9f6d4c8e2fb64fa6d846ae69185 76e0d93f04a8338a8d74d927a1298f5e',
  'the inner function is the 20261123120000 body and the wrapper the 20261127070000 body their rollback drafts expect');
select ok(not has_function_privilege('service_role', 'public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)', 'EXECUTE'),
  'grants are unchanged: only the wrapper is callable, and only by the server');

select * from finish();
rollback;
