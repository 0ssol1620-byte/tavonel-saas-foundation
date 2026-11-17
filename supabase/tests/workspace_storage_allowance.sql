-- Migration 20261117150100: the storage allowance at intake admission (WO-CAT-5).
--
-- The allowances are passed per call as the catalog does ({"personal": <bytes>}), so the fixture
-- uses a few KiB instead of 10 GB. Workspaces:
--   sto001  Personal (plan_code personal), allowance 3072 bytes
--   sto002  legacy observer_access (plan_code null)
--   sto003  Personal, allowance 2048 bytes (re-arming an expired admission)
--   sto004  trialing, no billing account
-- plus an operator grant (user e5) uploading into sto001, which does not uncap it (WO-CAT-8).
-- The two-session race (two admissions that together cross the allowance admit one) is outside
-- one pgTAP transaction: receipts/WO-CAT-5/concurrency.sh runs it against the same migration.
begin;
select plan(24);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
  'storage-allowance-' || n || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"google","providers":["google"]}', '{}', now(), now()
from (values
  (1, 'e1e1e1e1-0000-4000-8000-0000000000e1'), (2, 'e2e2e2e2-0000-4000-8000-0000000000e2'),
  (3, 'e3e3e3e3-0000-4000-8000-0000000000e3'), (4, 'e4e4e4e4-0000-4000-8000-0000000000e4'),
  (5, 'e5e5e5e5-0000-4000-8000-0000000000e5')
) as u(n, id);

insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status)
values
  ('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'observer_access', 'personal', 'active'),
  ('pilot-sto002', 'e2e2e2e2-0000-4000-8000-0000000000e2', 'observer_access', null, 'active'),
  ('pilot-sto003', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'observer_access', 'personal', 'active');

insert into public.foundation_self_service_trials (user_id, workspace_key, status, started_at, expires_at)
values ('e4e4e4e4-0000-4000-8000-0000000000e4', 'pilot-sto004', 'trialing', now(), now() + interval '7 days');

insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, billing_exempt, trial_exempt, active)
values ('e5e5e5e5-0000-4000-8000-0000000000e5', 'owner', 'studio_access', true, true, true);

create function pg_temp.admit(p_workspace text, p_user text, p_document text, p_bytes integer, p_limits jsonb) returns jsonb
language sql as $$
  select public.reserve_foundation_intake_admission(p_workspace, p_document::uuid, p_user::uuid,
    'quarantine/' || p_workspace || '/' || p_document || '/source', p_bytes, 'application/pdf', p_limits);
$$;

set local role service_role;

-- 1-4: the allowance is inclusive. A pending (unconfirmed, live) admission counts as retained.
select is(pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f1', 1024, '{"personal": 3072}')->>'intakeClass',
  'paid', 'a Personal workspace is admitted under its allowance');
select is(pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f2', 1024, '{"personal": 3072}')->>'intakeClass',
  'paid', 'a second file is admitted');
select is(pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f3', 1024, '{"personal": 3072}')->>'intakeClass',
  'paid', 'a file that brings retained bytes exactly to the allowance is admitted');
select throws_ok($$select pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f4', 1, '{"personal": 3072}')$$,
  'P0001', 'foundation_storage_allowance_exhausted', 'one byte over the allowance is refused');

-- 5-8: a replay is answered as before and counted once.
select lives_ok($$select public.confirm_foundation_intake_admission('pilot-sto001', 'f1f1f1f1-0000-4000-8000-0000000000f1'::uuid, 'e1e1e1e1-0000-4000-8000-0000000000e1'::uuid)$$,
  'the first file is confirmed');
select is(pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f1', 1024, '{"personal": 3072}')->>'idempotentReplay',
  'true', 'a confirmed admission replayed at the allowance is a replay, not a refusal');
select is(pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f3', 1024, '{"personal": 3072}')->>'documentId',
  'f1f1f1f1-0000-4000-8000-0000000000f3', 'a live unconfirmed admission replayed at the allowance is answered, not refused');
select throws_ok($$select pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f4', 1, '{"personal": 3072}')$$,
  'P0001', 'foundation_storage_allowance_exhausted', 'the replays added no bytes: the workspace is still exactly at its allowance');

-- 9-11: a deleted upload frees its bytes when its tombstone is recorded.
reset role;
insert into public.source_deletion_tombstones (
  deletion_id, workspace_key, source_id, oauth_connection_id, provider, reason,
  eligible_at, document_id, requested_by_user_id, request_manifest_sha256
) values (
  'sha256:' || repeat('a', 64), 'pilot-sto001', 'f1f1f1f1-0000-4000-8000-0000000000f2', null, null, 'customer_requested',
  now() + interval '30 days', 'f1f1f1f1-0000-4000-8000-0000000000f2', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'sha256:' || repeat('b', 64)
);
set local role service_role;
select is(pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f5', 1024, '{"personal": 3072}')->>'intakeClass',
  'paid', 'a deleted upload frees its bytes');
select throws_ok($$select pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f6', 1, '{"personal": 3072}')$$,
  'P0001', 'foundation_storage_allowance_exhausted', 'and only those bytes');
select throws_ok($$select pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f2', 1024, '{"personal": 3072}')$$,
  'P0001', 'foundation_intake_source_deleted', 'the deleted upload itself is still never re-admitted');

-- 12-13: a connector tombstone frees the bytes of every document bound to that source.
reset role;
insert into public.foundation_oauth_connections (oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by)
values ('e1e1e1e1-0000-4000-8000-00000000c001', 'pilot-sto001', 'google_drive', 'Fixture', 'connector-account',
  array['https://www.googleapis.com/auth/drive.metadata.readonly'], 'vault://fixture/client', 'vault://fixture/refresh',
  'e1e1e1e1-0000-4000-8000-0000000000e1', 'e1e1e1e1-0000-4000-8000-0000000000e1');
insert into public.connector_document_bindings (source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type)
values ('sv-' || repeat('c', 64), 'src-' || repeat('c', 64), 'pilot-sto001', 'e1e1e1e1-0000-4000-8000-00000000c001', 'google_drive',
  'drive-file-c', 'rev-c', 'f1f1f1f1-0000-4000-8000-0000000000f1', 'sha256:' || repeat('c', 64), 1024, 'application/pdf');
insert into public.source_deletion_tombstones (deletion_id, workspace_key, source_id, oauth_connection_id, provider, reason, eligible_at)
values ('sha256:' || repeat('d', 64), 'pilot-sto001', 'src-' || repeat('c', 64), 'e1e1e1e1-0000-4000-8000-00000000c001',
  'google_drive', 'provider_deleted', now() + interval '30 days');
set local role service_role;
select is(pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f7', 1024, '{"personal": 3072}')->>'intakeClass',
  'paid', 'a connector source deleted at origin frees its bound document''s bytes');
select throws_ok($$select pg_temp.admit('pilot-sto001', 'e1e1e1e1-0000-4000-8000-0000000000e1', 'f1f1f1f1-0000-4000-8000-0000000000f8', 1, '{"personal": 3072}')$$,
  'P0001', 'foundation_storage_allowance_exhausted', 'the workspace is back at its allowance');

-- 14-16: re-arming an expired, unconfirmed admission is checked like a new one.
select is(pg_temp.admit('pilot-sto003', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'f3f3f3f3-0000-4000-8000-0000000000f1', 1024, '{"personal": 2048}')->>'intakeClass',
  'paid', 'sto003: the first file is admitted');
reset role;
update public.foundation_intake_admissions
   set created_at = now() - interval '20 minutes', expires_at = now() - interval '6 minutes'
 where workspace_key = 'pilot-sto003' and document_id = 'f3f3f3f3-0000-4000-8000-0000000000f1';
set local role service_role;
select is(pg_temp.admit('pilot-sto003', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'f3f3f3f3-0000-4000-8000-0000000000f2', 2048, '{"personal": 2048}')->>'intakeClass',
  'paid', 'an expired, unconfirmed admission holds no bytes');
select throws_ok($$select pg_temp.admit('pilot-sto003', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'f3f3f3f3-0000-4000-8000-0000000000f1', 1024, '{"personal": 2048}')$$,
  'P0001', 'foundation_storage_allowance_exhausted', 're-arming the expired admission past the allowance is refused by the allowance (the re-arm itself works since 20261117160100)');

-- 17-19: legacy, owner and trial are never refused by the allowance.
select is(pg_temp.admit('pilot-sto002', 'e2e2e2e2-0000-4000-8000-0000000000e2', 'f2f2f2f2-0000-4000-8000-0000000000f1', 4096,
  '{"personal": 1, "developer": 1, "team": 1, "business": 1}')->>'intakeClass',
  'paid', 'a legacy plan (plan_code null) is counted by nothing and refused by nothing, whatever the allowances');
select throws_ok($$select pg_temp.admit('pilot-sto001', 'e5e5e5e5-0000-4000-8000-0000000000e5', 'f5f5f5f5-0000-4000-8000-0000000000f1', 4096, '{"personal": 3072}')$$,
  'P0001', 'foundation_storage_allowance_exhausted',
  'an operator uploading into a customer workspace at its allowance is refused: only a grant on the account''s own user uncaps it (WO-CAT-8, catalog_v2_meter_closure.sql)');
select is(pg_temp.admit('pilot-sto004', 'e4e4e4e4-0000-4000-8000-0000000000e4', 'f4f4f4f4-0000-4000-8000-0000000000f1', 4096, '{"personal": 1}')->>'intakeClass',
  'trial', 'a trial keeps its own bounds and no storage allowance');

-- 20-22: a v2 workspace with no allowance is refused, never admitted uncapped; the old
-- six-argument signature still works and passes none.
select throws_ok($$select pg_temp.admit('pilot-sto003', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'f3f3f3f3-0000-4000-8000-0000000000f3', 1, '{"team": 100}')$$,
  'P0001', 'foundation_storage_limit_missing', 'a v2 plan the caller sent no allowance for is refused');
select throws_ok($$select public.reserve_foundation_intake_admission('pilot-sto003', 'f3f3f3f3-0000-4000-8000-0000000000f3'::uuid,
    'e3e3e3e3-0000-4000-8000-0000000000e3'::uuid, 'quarantine/pilot-sto003/f3f3f3f3-0000-4000-8000-0000000000f3/source', 1, 'application/pdf')$$,
  'P0001', 'foundation_storage_limit_missing', 'the six-argument signature cannot admit a v2 workspace uncapped');
select is(public.reserve_foundation_intake_admission('pilot-sto002', 'f2f2f2f2-0000-4000-8000-0000000000f2'::uuid,
    'e2e2e2e2-0000-4000-8000-0000000000e2'::uuid, 'quarantine/pilot-sto002/f2f2f2f2-0000-4000-8000-0000000000f2/source', 1024, 'application/pdf')->>'intakeClass',
  'paid', 'the six-argument signature still admits a legacy workspace');
reset role;

-- 23: no admission can have an unknown size, so no allowance is decided on a guess.
select throws_ok($$insert into public.foundation_intake_admissions (workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type, expires_at)
  values ('pilot-sto002', 'f2f2f2f2-0000-4000-8000-0000000000f3', 'e2e2e2e2-0000-4000-8000-0000000000e2',
    'quarantine/pilot-sto002/f2f2f2f2-0000-4000-8000-0000000000f3/source', null, 'application/pdf', now() + interval '5 minutes')$$,
  '23502', 'requested_bytes is NOT NULL: every admission states its size');

-- 24: only the server may call the new signature.
select ok(has_function_privilege('service_role', 'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)', 'EXECUTE'),
  'service_role may call the seven-argument wrapper; no browser role may');

select * from finish();
rollback;
