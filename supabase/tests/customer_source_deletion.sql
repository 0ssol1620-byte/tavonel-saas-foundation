-- Gates 10 and 11 (migration 20260927102000): an uploaded source is deleted through the same
-- tombstone -> attestation -> claim/begin/finalize chain as a connector source, by an owner or
-- admin of its own workspace only, never under legal hold, and never re-admitted afterwards.
--
-- Each auth.users insert bootstraps a personal workspace with that user as owner
-- (20260920121000), so the workspace keys below are derived from the user ids:
--   pilot-c1c1c1c1c1c14c1c  owner c1, grace 0, hold off -- the subject
--   pilot-c2c2c2c2c2c24c2c  owner c2, grace 0, hold ON
--   c3 is a plain member of the first workspace.
begin;
select plan(53);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'authenticated', 'authenticated',
   'customer-delete-1@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'authenticated', 'authenticated',
   'customer-delete-2@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'authenticated', 'authenticated',
   'customer-delete-3@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_workspace_members (workspace_key, user_id, role, state, accepted_at)
values ('pilot-c1c1c1c1c1c14c1c', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'member', 'active', now());

insert into public.enterprise_organizations (organization_id, name, slug, created_by) values
  ('0a100000-0000-4000-8000-000000000001', 'Customer Delete One', 'customer-delete-one', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'),
  ('0a100000-0000-4000-8000-000000000002', 'Customer Delete Two', 'customer-delete-two', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2');
insert into public.enterprise_workspaces (workspace_key, organization_id, display_name) values
  ('pilot-c1c1c1c1c1c14c1c', '0a100000-0000-4000-8000-000000000001', 'Customer Delete One'),
  ('pilot-c2c2c2c2c2c24c2c', '0a100000-0000-4000-8000-000000000002', 'Customer Delete Two');
insert into public.enterprise_governance_policies
  (organization_id, deleted_object_grace_days, legal_hold_enabled, updated_by) values
  ('0a100000-0000-4000-8000-000000000001', 0, false, 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'),
  ('0a100000-0000-4000-8000-000000000002', 0, true,  'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2');

-- A: fresh, confirmed upload in the subject workspace. B: 400 days old there (past the default
-- 365-day retention). C: 400 days old in the held workspace.
insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
) values
  ('pilot-c1c1c1c1c1c14c1c', '0e000000-0000-4000-8000-00000000000a', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
   'quarantine/pilot-c1c1c1c1c1c14c1c/0e000000-0000-4000-8000-00000000000a/source', 10, 'application/pdf',
   now(), now(), now() + interval '10 minutes', now()),
  ('pilot-c1c1c1c1c1c14c1c', '0e000000-0000-4000-8000-00000000000b', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
   'quarantine/pilot-c1c1c1c1c1c14c1c/0e000000-0000-4000-8000-00000000000b/source', 10, 'application/pdf',
   now() - interval '400 days', now() - interval '400 days', now() - interval '400 days' + interval '10 minutes',
   now() - interval '400 days'),
  ('pilot-c2c2c2c2c2c24c2c', '0e000000-0000-4000-8000-00000000000c', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2',
   'quarantine/pilot-c2c2c2c2c2c24c2c/0e000000-0000-4000-8000-00000000000c/source', 10, 'application/pdf',
   now() - interval '400 days', now() - interval '400 days', now() - interval '400 days' + interval '10 minutes',
   now() - interval '400 days');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.request_customer_source_deletion(text,uuid,uuid,text)', 'execute'),
  'browsers cannot request a deletion directly');
select ok(has_function_privilege('service_role', 'public.request_customer_source_deletion(text,uuid,uuid,text)', 'execute'),
  'the server can request a deletion');
select ok(not has_function_privilege('service_role', 'public.reserve_foundation_intake_admission_unchecked(text,uuid,uuid,text,integer,text)', 'execute'),
  'the server cannot reach the unchecked reserve underneath the tombstone guard');
select ok(has_function_privilege('service_role', 'public.reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text)', 'execute'),
  'the server still reserves through the guarded wrapper');

-- ---------------------------------------------------------------------------
-- Who may ask, and for what
-- ---------------------------------------------------------------------------
select throws_ok($$select public.request_customer_source_deletion('pilot-c1c1c1c1c1c14c1c',
  '0e000000-0000-4000-8000-00000000000a', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'sha256:' || repeat('a', 64))$$,
  'P0001', 'CUSTOMER_SOURCE_DELETE_FORBIDDEN', 'a plain member cannot delete');
select throws_ok($$select public.request_customer_source_deletion('pilot-c1c1c1c1c1c14c1c',
  '0e000000-0000-4000-8000-00000000000a', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'sha256:' || repeat('a', 64))$$,
  'P0001', 'CUSTOMER_SOURCE_DELETE_FORBIDDEN', 'another workspace''s owner cannot delete');
select throws_ok($$select public.request_customer_source_deletion('pilot-c1c1c1c1c1c14c1c',
  '0e000000-0000-4000-8000-00000000000c', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'sha256:' || repeat('a', 64))$$,
  'P0001', 'CUSTOMER_SOURCE_NOT_FOUND', 'an owner naming another tenant''s document finds nothing');
select throws_ok($$select public.request_customer_source_deletion('pilot-c2c2c2c2c2c24c2c',
  '0e000000-0000-4000-8000-00000000000c', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'sha256:' || repeat('a', 64))$$,
  'P0001', 'SOURCE_LEGAL_HOLD_ACTIVE', 'legal hold refuses the request');
select is((select count(*)::integer from public.source_deletion_tombstones where document_id is not null), 0,
  'no refusal left a tombstone behind');

-- ---------------------------------------------------------------------------
-- The request, and its replay
-- ---------------------------------------------------------------------------
create temp table first_request as select public.request_customer_source_deletion('pilot-c1c1c1c1c1c14c1c',
  '0e000000-0000-4000-8000-00000000000a', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'sha256:' || repeat('a', 64)) as r;
select is((select r->>'status' from first_request), 'recorded', 'the owner''s request is recorded');
select ok((select (r->>'eligibleAt')::timestamptz >= now() + interval '25 minutes' from first_request),
  'eligibility waits 15 minutes past the admission window, so no outstanding PUT can land after the listing');
select is((select r->>'receiptId' from public.request_customer_source_deletion('pilot-c1c1c1c1c1c14c1c',
    '0e000000-0000-4000-8000-00000000000a', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'sha256:' || repeat('b', 64)) r),
  (select r->>'receiptId' from first_request), 'a retry replays the same tombstone receipt');
select is((select count(*)::integer from public.source_deletion_receipts r
  join public.source_deletion_tombstones t using (deletion_id)
  where t.document_id = '0e000000-0000-4000-8000-00000000000a' and r.action = 'tombstoned'), 1, 'exactly one tombstone receipt');
select is((select reason || ':' || source_id from public.source_deletion_tombstones
  where document_id = '0e000000-0000-4000-8000-00000000000a'),
  'customer_requested:0e000000-0000-4000-8000-00000000000a', 'the tombstone names the upload and why');

-- ---------------------------------------------------------------------------
-- No resurrection
-- ---------------------------------------------------------------------------
select throws_ok($$select public.reserve_foundation_intake_admission('pilot-c1c1c1c1c1c14c1c',
  '0e000000-0000-4000-8000-00000000000a', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
  'quarantine/pilot-c1c1c1c1c1c14c1c/0e000000-0000-4000-8000-00000000000a/source', 10, 'application/pdf')$$,
  'P0001', 'foundation_intake_source_deleted', 'a replayed idempotency key cannot re-admit a deleted upload');
select throws_ok($$select public.confirm_foundation_intake_admission('pilot-c1c1c1c1c1c14c1c',
  '0e000000-0000-4000-8000-00000000000a', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1')$$,
  'P0001', 'foundation_intake_source_deleted', 'a late confirmation cannot restart processing');
select is((public.reserve_foundation_intake_admission('pilot-c1c1c1c1c1c14c1c',
  '0e000000-0000-4000-8000-00000000000d', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
  'quarantine/pilot-c1c1c1c1c1c14c1c/0e000000-0000-4000-8000-00000000000d/source', 10, 'application/pdf'))->>'documentId',
  '0e000000-0000-4000-8000-00000000000d', 'an unrelated upload still reserves through the wrapper');

-- ---------------------------------------------------------------------------
-- Attestation names the upload's own document, never zero documents
-- ---------------------------------------------------------------------------
select is(public.source_deletion_inventory_candidate(), null::jsonb, 'nothing is attested before eligible_at');

alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0e000000-0000-4000-8000-00000000000a';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;

select is(public.source_deletion_inventory_candidate()->'documentIds',
  '["0e000000-0000-4000-8000-00000000000a"]'::jsonb, 'the candidate carries exactly the uploaded document');
select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from first_request), '[]'::jsonb)$$,
  'P0001', 'SOURCE_DELETION_INVENTORY_EMPTY', 'an empty listing is not proof the upload is gone');
select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from first_request),
  jsonb_build_array(jsonb_build_object('key', 'quarantine/pilot-c1c1c1c1c1c14c1c/0e000000-0000-4000-8000-00000000000b/source',
    'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10)))$$,
  'P0001', 'SOURCE_DELETION_INVENTORY_OBJECT_OUT_OF_SCOPE', 'a sibling document''s object is out of scope');
select is(public.attest_source_deletion_inventory((select r->>'deletionId' from first_request),
  jsonb_build_array(jsonb_build_object('key', 'quarantine/pilot-c1c1c1c1c1c14c1c/0e000000-0000-4000-8000-00000000000a/source',
    'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10)))->>'artifactCount', '1', 'the upload''s own object is attested');

-- ---------------------------------------------------------------------------
-- Claim, begin, finalize: the existing sweeper runs an upload unchanged
-- ---------------------------------------------------------------------------
create temp table claimed as select c from public.claim_source_deletion_sweep(1) c;
select is((select c->>'objectKey' from claimed),
  'quarantine/pilot-c1c1c1c1c1c14c1c/0e000000-0000-4000-8000-00000000000a/source', 'the sweeper claims the upload''s object');
select is(public.begin_source_deletion_object((select c->>'deletionId' from claimed), (select c->>'objectKey' from claimed),
  (select c->>'objectSha256' from claimed), (select (c->>'claimId')::uuid from claimed))->>'status', 'started', 'delete intent is durable');
select is(public.finalize_source_deletion_object((select c->>'deletionId' from claimed), (select c->>'objectKey' from claimed),
  (select c->>'objectSha256' from claimed), false, (select (c->>'claimId')::uuid from claimed))->>'status', 'recorded', 'the purge receipt is recorded');

select ok((select jsonb_array_length(s->'objects') = 1 and s->'objects'->0->>'receiptId' is not null
  and s->>'inventoryManifestSha256' is not null
  from public.customer_source_deletion_status('pilot-c1c1c1c1c1c14c1c', '0e000000-0000-4000-8000-00000000000a') s),
  'the status the customer reads shows the attested object with its purge receipt');
select is(public.customer_source_deletion_status('pilot-c2c2c2c2c2c24c2c', '0e000000-0000-4000-8000-00000000000a'), null::jsonb,
  'another workspace reads no status for this document');

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
create temp table retained as select public.request_retention_expired_source_deletion() as r;
select is((select (r->>'status') || ':' || (r->>'documentId') from retained),
  'recorded:0e000000-0000-4000-8000-00000000000b', 'the upload past retention_days is tombstoned');
select is((select reason from public.source_deletion_tombstones where document_id = '0e000000-0000-4000-8000-00000000000b'),
  'retention_expired', 'as a retention deletion, with no requesting user');
select is(public.request_retention_expired_source_deletion()->>'status', 'idle',
  'the held workspace''s equally old upload is never picked');
select is((select count(*)::integer from public.source_deletion_tombstones
  where document_id = '0e000000-0000-4000-8000-00000000000c'), 0, 'legal hold keeps the old upload');
select is((select count(*)::integer from public.retention_expired_source_candidates('pilot-c2c2c2c2c2c24c2c', 25)), 0,
  'the dry-run selection is the same selection: nothing in the held workspace');
select is(public.request_retention_expired_source_deletion('pilot-c2c2c2c2c2c24c2c')->>'status', 'idle',
  'a canary run scoped to one workspace touches only that workspace');

-- ---------------------------------------------------------------------------
-- Serving deny: every read path asks connector_documents_blocked
-- ---------------------------------------------------------------------------
select ok(public.connector_documents_blocked('pilot-c1c1c1c1c1c14c1c', array['0e000000-0000-4000-8000-00000000000a']),
  'a tombstoned upload is blocked (its bytes are already purged here, but derived artifacts are not)');
select ok(public.connector_documents_blocked('pilot-c1c1c1c1c1c14c1c',
  array['0E000000-0000-4000-8000-00000000000A', '0e000000-0000-4000-8000-00000000000d']),
  'in any case and alongside a live document, so a collection holding it is blocked too');
select ok(not public.connector_documents_blocked('pilot-c1c1c1c1c1c14c1c', array['0e000000-0000-4000-8000-00000000000d']),
  'a live upload stays readable');
select ok(not public.connector_documents_blocked('pilot-c2c2c2c2c2c24c2c', array['0e000000-0000-4000-8000-00000000000a']),
  'the tombstone is scoped to its own workspace');

-- ---------------------------------------------------------------------------
-- Self-service workspaces (no enterprise organization): c3's personal workspace
-- ---------------------------------------------------------------------------
select is(public.source_legal_hold_state('pilot-c3c3c3c3c3c34c3c'), 'inactive',
  'a self-service workspace with no operator hold is readably inactive');
select is(public.source_legal_hold_state('pilot-doesnotexist'), 'unknown', 'an unknown workspace is still unknown');
select ok(has_function_privilege('service_role', 'public.source_legal_hold_state(text)', 'execute'),
  'the route reads the hold from the database function, not a TypeScript copy');
select ok(not has_table_privilege('service_role', 'public.source_operator_legal_holds', 'insert'),
  'only an operator (not the app) can place a hold');

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
) values ('pilot-c3c3c3c3c3c34c3c', '0e000000-0000-4000-8000-00000000000e', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
  'quarantine/pilot-c3c3c3c3c3c34c3c/0e000000-0000-4000-8000-00000000000e/source', 10, 'application/pdf',
  now(), now(), now() + interval '10 minutes', now());

insert into public.source_operator_legal_holds (workspace_key, reason)
values ('pilot-c3c3c3c3c3c34c3c', 'fixture: litigation hold');
select is(public.source_legal_hold_state('pilot-c3c3c3c3c3c34c3c'), 'active', 'an open operator hold is active');
select throws_ok($$select public.request_customer_source_deletion('pilot-c3c3c3c3c3c34c3c',
  '0e000000-0000-4000-8000-00000000000e', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'sha256:' || repeat('a', 64))$$,
  'P0001', 'SOURCE_LEGAL_HOLD_ACTIVE', 'and refuses a self-service deletion');
select throws_ok($$delete from public.source_operator_legal_holds$$,
  'P0001', 'source_operator_legal_hold_append_only', 'a hold is released, never deleted');
update public.source_operator_legal_holds set released_at = clock_timestamp() where workspace_key = 'pilot-c3c3c3c3c3c34c3c';

create temp table self_service as select public.request_customer_source_deletion('pilot-c3c3c3c3c3c34c3c',
  '0e000000-0000-4000-8000-00000000000e', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'sha256:' || repeat('a', 64)) as r;
select is((select r->>'status' from self_service), 'recorded', 'after release the self-service owner can delete');
select ok((select (r->>'eligibleAt')::timestamptz >= now() + interval '30 days' from self_service),
  'with the default 30-day grace, since there is no policy to read one from');

-- ---------------------------------------------------------------------------
-- Per-item isolation: a tombstone that cannot be attested does not stall the next one
-- ---------------------------------------------------------------------------
alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id in ('0e000000-0000-4000-8000-00000000000b', '0e000000-0000-4000-8000-00000000000e');
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;

create temp table first_candidate as select public.source_deletion_inventory_candidate()->>'deletionId' as d;
select ok((select d is not null from first_candidate), 'an eligible upload tombstone is offered');
select lives_ok($$select public.record_source_deletion_worker_failure((select d from first_candidate), 'inventory',
  'SOURCE_INVENTORY_EMPTY_LISTING')$$, 'the worker records why it could not attest it');
create temp table second_candidate as select public.source_deletion_inventory_candidate()->>'deletionId' as d;
select ok((select s.d is not null and s.d <> f.d from second_candidate s, first_candidate f),
  'the next run is offered the other tombstone instead of the stuck one');
select lives_ok($$select public.record_source_deletion_worker_failure((select d from second_candidate), 'inventory',
  'SOURCE_INVENTORY_R2_FAILED')$$, 'a second failure is recorded too');
select is(public.source_deletion_inventory_candidate()->>'deletionId', (select d from first_candidate),
  'the stuck tombstone comes back on the next rotation: retried, never skipped');
select is((select count(*)::integer from public.source_deletion_inventory_attestations a
  join first_candidate f on a.deletion_id = f.d), 0, 'and it is never recorded as attested');
select throws_ok($$delete from public.source_deletion_worker_failures$$,
  'P0001', 'source_deletion_evidence_append_only', 'failure records are append-only');

select * from finish();
rollback;
