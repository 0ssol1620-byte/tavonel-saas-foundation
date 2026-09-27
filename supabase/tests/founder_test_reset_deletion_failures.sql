-- Founder test reset vs. the 20260927 deletion tables (migration 20260927105000):
--   - source_deletion_worker_failures rows of the reset workspace are counted, fingerprinted,
--     fenced while sealed, archived and deleted, so finalize no longer fails on their foreign key;
--     another workspace's failures are untouched;
--   - an open operator legal hold refuses the reset, and no hold can be placed while it is sealed
--     or finalizing. Hold rows are never deleted.
--
-- Everything runs inside this rolled-back transaction on the disposable rehearsal database. Each
-- auth.users insert bootstraps a legacy workspace and a foundation workspace (0001, 20260920121000):
--   pilot-f0f0f0f0f0f04f0f  the founder test identity (enterprise, grace 0, hold off) -- the subject
--   pilot-e5e5e5e5e5e54e5e  an unrelated self-service workspace -- must be left alone
begin;
select plan(26);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'authenticated', 'authenticated',
   '0ssol1620@gmail.com', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'authenticated', 'authenticated',
   'reset-bystander@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, active)
values ('f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'owner', 'studio_access', true);
insert into public.enterprise_organizations (organization_id, name, slug, created_by)
values ('0a200000-0000-4000-8000-000000000001', 'Founder Reset', 'founder-reset-fixture', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');
insert into public.enterprise_organization_memberships (organization_id, user_id, role, created_by)
values ('0a200000-0000-4000-8000-000000000001', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'owner', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');
insert into public.enterprise_workspaces (workspace_key, organization_id, display_name)
values ('pilot-f0f0f0f0f0f04f0f', '0a200000-0000-4000-8000-000000000001', 'Founder Reset');
insert into public.enterprise_workspace_memberships (workspace_key, user_id, role, created_by)
values ('pilot-f0f0f0f0f0f04f0f', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'owner', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');
insert into public.enterprise_governance_policies (organization_id, deleted_object_grace_days, legal_hold_enabled, updated_by)
values ('0a200000-0000-4000-8000-000000000001', 0, false, 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');

-- Both admissions closed an hour ago: an open upload window is active work for the reset.
insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
) values
  ('pilot-f0f0f0f0f0f04f0f', '0f100000-0000-4000-8000-00000000000a', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',
   'quarantine/pilot-f0f0f0f0f0f04f0f/0f100000-0000-4000-8000-00000000000a/source', 10, 'application/pdf',
   now() - interval '1 hour', now() - interval '1 hour', now() - interval '55 minutes', now() - interval '1 hour'),
  ('pilot-e5e5e5e5e5e54e5e', '0f100000-0000-4000-8000-00000000000b', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5',
   'quarantine/pilot-e5e5e5e5e5e54e5e/0f100000-0000-4000-8000-00000000000b/source', 10, 'application/pdf',
   now() - interval '1 hour', now() - interval '1 hour', now() - interval '55 minutes', now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
select has_trigger('public', 'source_deletion_worker_failures', 'founder_reset_fence',
  'worker failures are behind the sealed reset write fence');
select has_trigger('public', 'source_operator_legal_holds', 'founder_test_reset_blocks_operator_legal_hold',
  'operator holds wait for a sealed reset');

-- ---------------------------------------------------------------------------
-- Fixture: a founder deletion with one purge failure and one inventory failure (then purged,
-- as it would be after an R2 retry), and a bystander tombstone with its own failure.
-- ---------------------------------------------------------------------------
create temp table founder_request as select public.request_customer_source_deletion('pilot-f0f0f0f0f0f04f0f',
  '0f100000-0000-4000-8000-00000000000a', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'sha256:' || repeat('a', 64)) as r;
create temp table bystander_request as select public.request_customer_source_deletion('pilot-e5e5e5e5e5e54e5e',
  '0f100000-0000-4000-8000-00000000000b', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'sha256:' || repeat('c', 64)) as r;

alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0f100000-0000-4000-8000-00000000000a';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;

create temp table founder_inventory_failure as select public.record_source_deletion_worker_failure(
  (select r->>'deletionId' from founder_request), 'inventory', 'SOURCE_DELETE_LIST_FAILED') as r;
create temp table bystander_inventory_failure as select public.record_source_deletion_worker_failure(
  (select r->>'deletionId' from bystander_request), 'inventory', 'SOURCE_DELETE_LIST_FAILED') as r;
create temp table attested as select public.attest_source_deletion_inventory((select r->>'deletionId' from founder_request),
  jsonb_build_array(jsonb_build_object('key', 'quarantine/pilot-f0f0f0f0f0f04f0f/0f100000-0000-4000-8000-00000000000a/source',
    'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10))) as r;
create temp table claimed as select c from public.claim_source_deletion_sweep(1) c;
create temp table begun as select public.begin_source_deletion_object((select c->>'deletionId' from claimed),
  (select c->>'objectKey' from claimed), (select c->>'objectSha256' from claimed), (select (c->>'claimId')::uuid from claimed)) as r;
create temp table purge_failure as select public.record_source_deletion_purge_failure((select c->>'deletionId' from claimed),
  (select c->>'objectKey' from claimed), (select (c->>'claimId')::uuid from claimed), 'SOURCE_DELETE_OBJECT_LOCKED') as r;
create temp table purged as select public.finalize_source_deletion_object((select c->>'deletionId' from claimed),
  (select c->>'objectKey' from claimed), (select c->>'objectSha256' from claimed), false, (select (c->>'claimId')::uuid from claimed)) as r;

select is((select count(*)::integer from public.source_deletion_worker_failures
  where deletion_id = (select r->>'deletionId' from founder_request)), 2, 'fixture: two founder failures reference the tombstone and object');

-- ---------------------------------------------------------------------------
-- An open operator hold refuses the reset before it starts
-- ---------------------------------------------------------------------------
insert into public.source_operator_legal_holds (workspace_key, reason) values ('pilot-f0f0f0f0f0f04f0f', 'fixture: hold one');
select throws_ok($$select public.prepare_founder_test_reset('0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f')$$,
  'P0001', 'founder_test_reset_operator_legal_hold_active', 'an open operator hold refuses prepare');
update public.source_operator_legal_holds set released_at = clock_timestamp()
 where workspace_key = 'pilot-f0f0f0f0f0f04f0f' and released_at is null;

create temp table prepared as select public.prepare_founder_test_reset('0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f') as r;
select is((select (r->'dbCounts'->>'source_deletion_worker_failures')::integer from prepared), 2,
  'the inventory counts only the founder workspace failures');
select is((select (r->'dbCounts'->>'source_deletion_tombstones')::integer from prepared), 1,
  'and only the founder tombstone');

-- A failure recorded after prepare changes the fingerprint; the whole attempt is rolled back.
select throws_ok($q$do $d$ begin
  perform public.record_source_deletion_worker_failure((select r->>'deletionId' from founder_request), 'inventory', 'SOURCE_DELETE_LIST_FAILED');
  perform public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
    'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
    'sha256:' || repeat('b', 64), '[]'::jsonb);
end $d$$q$, 'P0001', 'founder_test_reset_database_drift', 'a failure recorded after prepare is database drift');

-- A hold placed between prepare and seal refuses the seal.
insert into public.source_operator_legal_holds (workspace_key, reason) values ('pilot-f0f0f0f0f0f04f0f', 'fixture: hold two');
select throws_ok($$select public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
  'sha256:' || repeat('b', 64), '[]'::jsonb)$$,
  'P0001', 'founder_test_reset_operator_legal_hold_active', 'a hold placed after prepare refuses seal');
update public.source_operator_legal_holds set released_at = clock_timestamp()
 where workspace_key = 'pilot-f0f0f0f0f0f04f0f' and released_at is null;

select is(public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
  'sha256:' || repeat('b', 64), '[]'::jsonb)->>'status', 'sealed', 'the reset seals once every hold is released');

-- ---------------------------------------------------------------------------
-- While sealed
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.source_operator_legal_holds (workspace_key, reason)
  values ('pilot-f0f0f0f0f0f04f0f', 'fixture: during seal')$$,
  'P0001', 'founder_test_reset_operator_legal_hold_waits_for_finalize', 'no operator hold can be placed while sealed');
select throws_ok($$select public.record_source_deletion_worker_failure((select r->>'deletionId' from founder_request),
  'inventory', 'SOURCE_DELETE_LIST_FAILED')$$,
  'P0001', 'founder_test_reset_write_fenced', 'no founder failure can be written while sealed');
select throws_ok($$delete from public.source_deletion_worker_failures
  where deletion_id = (select r->>'deletionId' from founder_request)$$,
  'P0001', 'founder_test_reset_write_fenced', 'nor deleted outside finalize');
select lives_ok($$select public.record_source_deletion_worker_failure((select r->>'deletionId' from bystander_request),
  'inventory', 'SOURCE_DELETE_LIST_FAILED')$$, 'another workspace still records failures');
select lives_ok($$insert into public.source_operator_legal_holds (workspace_key, reason)
  values ('pilot-e5e5e5e5e5e54e5e', 'fixture: bystander hold')$$, 'and still takes holds');

-- ---------------------------------------------------------------------------
-- Finalize: the failures no longer block it, and only the founder's go
-- ---------------------------------------------------------------------------
select is(public.finalize_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', 'sha256:' || repeat('b', 64))->>'status',
  'db_finalized_pending_object_verify', 'finalize succeeds with recorded worker failures');
select is((select count(*)::integer from public.source_deletion_worker_failures
  where deletion_id = (select r->>'deletionId' from founder_request)), 0, 'founder failures are deleted');
select is((select count(*)::integer from public.source_deletion_tombstones where workspace_key = 'pilot-f0f0f0f0f0f04f0f'), 0,
  'with the tombstone they referenced');
select is((select count(*)::integer from public.source_deletion_worker_failures
  where deletion_id = (select r->>'deletionId' from bystander_request)), 2, 'bystander failures are untouched');
select is((select count(*)::integer from public.source_deletion_tombstones where workspace_key = 'pilot-e5e5e5e5e5e54e5e'), 1,
  'and so is the bystander tombstone');

select is((select count(*)::integer from public.founder_test_reset_evidence_archive
  where reset_id = (select (r->>'resetId')::uuid from prepared) and source_table = 'source_deletion_worker_failures'), 2,
  'both founder failures are archived');
select ok((select bool_and(row_sha256 = public.founder_test_reset_row_sha256(payload)
    and payload->>'deletion_id' = (select r->>'deletionId' from founder_request))
  from public.founder_test_reset_evidence_archive
  where reset_id = (select (r->>'resetId')::uuid from prepared) and source_table = 'source_deletion_worker_failures'),
  'each archived failure is the founder row with its digest');
select throws_ok($$delete from public.founder_test_reset_evidence_archive
  where source_table = 'source_deletion_worker_failures'$$,
  'P0001', 'founder_test_reset_evidence_append_only', 'the archive stays append-only');

select is((select count(*)::integer from public.source_operator_legal_holds
  where workspace_key = 'pilot-f0f0f0f0f0f04f0f' and released_at is not null), 2, 'hold history is preserved');
select throws_ok($$insert into public.source_operator_legal_holds (workspace_key, reason)
  values ('pilot-f0f0f0f0f0f04f0f', 'fixture: before complete')$$,
  'P0001', 'founder_test_reset_operator_legal_hold_waits_for_finalize', 'no hold while objects await verification');

select is(public.complete_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', 'sha256:' || repeat('b', 64))->>'status',
  'completed', 'the reset completes');
select lives_ok($$insert into public.source_operator_legal_holds (workspace_key, reason)
  values ('pilot-f0f0f0f0f0f04f0f', 'fixture: after complete')$$, 'a completed reset no longer fences holds');

select * from finish();
rollback;
