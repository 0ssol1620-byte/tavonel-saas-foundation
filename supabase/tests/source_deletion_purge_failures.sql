-- Gate 11 (migration 20260927103000): a failed purge attempt leaves append-only evidence bound to
-- the object and the claim that attempted it, the customer's status shows it until the object's
-- receipt exists, and recording it never purges, skips or releases anything.
--
-- The auth.users insert bootstraps the self-service workspace pilot-d4d4d4d4d4d44d4d
-- (20260920121000); with no operator hold its legal-hold state is 'inactive'.
begin;
select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values ('00000000-0000-0000-0000-000000000000', 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4', 'authenticated', 'authenticated',
  'purge-failure-1@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
) values ('pilot-d4d4d4d4d4d44d4d', '0f000000-0000-4000-8000-00000000000a', 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4',
  'quarantine/pilot-d4d4d4d4d4d44d4d/0f000000-0000-4000-8000-00000000000a/source', 10, 'application/pdf',
  now(), now(), now() + interval '10 minutes', now());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.record_source_deletion_purge_failure(text,text,uuid,text)', 'execute'),
  'browsers cannot write purge evidence');
select ok(has_function_privilege('service_role', 'public.record_source_deletion_purge_failure(text,text,uuid,text)', 'execute'),
  'the deletion worker can');
select ok(not has_function_privilege('authenticated', 'public.customer_source_deletion_status(text,uuid)', 'execute'),
  'browsers read the status only through the server route');

-- ---------------------------------------------------------------------------
-- Fixture: tombstone -> attestation -> claim -> begin, exactly as the worker runs it
-- ---------------------------------------------------------------------------
create temp table request as select public.request_customer_source_deletion('pilot-d4d4d4d4d4d44d4d',
  '0f000000-0000-4000-8000-00000000000a', 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4', 'sha256:' || repeat('a', 64)) as r;

alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0f000000-0000-4000-8000-00000000000a';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;

create temp table attested as select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array(jsonb_build_object('key', 'quarantine/pilot-d4d4d4d4d4d44d4d/0f000000-0000-4000-8000-00000000000a/source',
    'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10))) as r;
create temp table claimed as select c from public.claim_source_deletion_sweep(1) c;
create temp table begun as select public.begin_source_deletion_object((select c->>'deletionId' from claimed),
  (select c->>'objectKey' from claimed), (select c->>'objectSha256' from claimed), (select (c->>'claimId')::uuid from claimed)) as r;

-- ---------------------------------------------------------------------------
-- Only the claim that made the attempt can record its failure
-- ---------------------------------------------------------------------------
select throws_ok($$select public.record_source_deletion_purge_failure((select c->>'deletionId' from claimed),
  (select c->>'objectKey' from claimed), (select (c->>'claimId')::uuid from claimed), 'not a code')$$,
  'P0001', 'SOURCE_DELETION_FAILURE_INVALID', 'a free-text code is refused');
select throws_ok($$select public.record_source_deletion_purge_failure((select c->>'deletionId' from claimed),
  (select c->>'objectKey' from claimed), gen_random_uuid(), 'SOURCE_DELETE_FAILED')$$,
  'P0001', 'SOURCE_DELETION_LEASE_INVALID', 'another claim cannot write evidence for this attempt');
select throws_ok($$select public.record_source_deletion_purge_failure((select c->>'deletionId' from claimed),
  'quarantine/pilot-d4d4d4d4d4d44d4d/unattested/source', (select (c->>'claimId')::uuid from claimed), 'SOURCE_DELETE_FAILED')$$,
  'P0001', 'SOURCE_DELETION_OBJECT_CONFLICT', 'an object outside the attested inventory has no evidence to record');

select lives_ok($$select public.record_source_deletion_purge_failure((select c->>'deletionId' from claimed),
  (select c->>'objectKey' from claimed), (select (c->>'claimId')::uuid from claimed), 'SOURCE_DELETE_FAILED')$$,
  'a transient R2 failure is recorded');
select lives_ok($$select public.record_source_deletion_purge_failure((select c->>'deletionId' from claimed),
  (select c->>'objectKey' from claimed), (select (c->>'claimId')::uuid from claimed), 'SOURCE_DELETE_OBJECT_LOCKED')$$,
  'an object-lock refusal is recorded');

-- ---------------------------------------------------------------------------
-- The customer sees it; nothing was purged or released by recording it
-- ---------------------------------------------------------------------------
create temp table status_before as
  select public.customer_source_deletion_status('pilot-d4d4d4d4d4d44d4d', '0f000000-0000-4000-8000-00000000000a')->'objects'->0 as o;
select is((select o->>'lastPurgeFailureCode' from status_before), 'SOURCE_DELETE_OBJECT_LOCKED',
  'the status names the most recent refusal');
select is((select (o->>'purgeFailureCount')::integer from status_before), 2, 'and how many attempts failed');
select ok((select o->>'receiptId' is null and o->>'purgedAt' is null from status_before),
  'recording a failure never marks the object purged');
select is((select purge_claim_id from public.source_deletion_objects
  where deletion_id = (select c->>'deletionId' from claimed) and object_key = (select c->>'objectKey' from claimed)),
  (select (c->>'claimId')::uuid from claimed), 'nor releases or replaces the claim');

-- ---------------------------------------------------------------------------
-- Table shape and append-only
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.source_deletion_worker_failures (deletion_id, stage, code, object_key)
  values ((select c->>'deletionId' from claimed), 'inventory', 'X', (select c->>'objectKey' from claimed))$$,
  '23514', null, 'an inventory failure cannot name an object');
select throws_ok($$insert into public.source_deletion_worker_failures (deletion_id, stage, code)
  values ((select c->>'deletionId' from claimed), 'purge', 'X')$$,
  '23514', null, 'a purge failure must name its object');
select throws_ok($$delete from public.source_deletion_worker_failures$$,
  'P0001', 'source_deletion_evidence_append_only', 'purge failure records are append-only');

-- ---------------------------------------------------------------------------
-- A later success: the receipt supersedes the failures in the status, the history stays
-- ---------------------------------------------------------------------------
select is(public.finalize_source_deletion_object((select c->>'deletionId' from claimed), (select c->>'objectKey' from claimed),
  (select c->>'objectSha256' from claimed), false, (select (c->>'claimId')::uuid from claimed))->>'status', 'recorded',
  'the same claim can still finalize after a recorded failure');
select ok((select o->>'lastPurgeFailureCode' is null and (o->>'purgeFailureCount')::integer = 0 and o->>'receiptId' is not null
  from (select public.customer_source_deletion_status('pilot-d4d4d4d4d4d44d4d', '0f000000-0000-4000-8000-00000000000a')->'objects'->0 as o) s),
  'a purged object shows its receipt, not stale failures');
select throws_ok($$select public.record_source_deletion_purge_failure((select c->>'deletionId' from claimed),
  (select c->>'objectKey' from claimed), (select (c->>'claimId')::uuid from claimed), 'SOURCE_DELETE_FAILED')$$,
  'P0001', 'SOURCE_DELETION_ALREADY_PURGED', 'a purged object has nothing left to fail');
select is((select count(*)::integer from public.source_deletion_worker_failures
  where deletion_id = (select c->>'deletionId' from claimed) and stage = 'purge'), 2, 'the failure history is kept');

select * from finish();
rollback;
