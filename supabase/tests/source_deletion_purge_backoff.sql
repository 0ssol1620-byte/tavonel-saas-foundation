-- Gate 11 (migration 20260930011000): an object-lock refusal defers that one object for 24 hours
-- and fences the finished attempt (claim, expiry and delete_started_at cleared), while an ambiguous
-- failure keeps its started state. Another eligible, unheld object is claimed and receipted in the
-- meantime, the deferred object is not handed out again until it is due and then only under a new
-- claim, a legal hold can be placed after the refusal, and a hold keeps its tenant out of the sweep.
--
-- The auth.users inserts bootstrap three self-service workspaces (20260920121000): pilot-e5... and
-- pilot-f6... are unheld, pilot-a7... gets an operator hold before anything is claimed.
begin;
select plan(26);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'authenticated', 'authenticated',
   'purge-backoff-1@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6', 'authenticated', 'authenticated',
   'purge-backoff-2@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7', 'authenticated', 'authenticated',
   'purge-backoff-3@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
)
select w, d::uuid, u::uuid, 'quarantine/' || w || '/' || d || '/source', 10, 'application/pdf',
       now(), now(), now() + interval '10 minutes', now()
  from (values
    ('pilot-e5e5e5e5e5e54e5e', '0f000000-0000-4000-8000-0000000000b1', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5'),
    ('pilot-f6f6f6f6f6f64f6f', '0f000000-0000-4000-8000-0000000000b2', 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6'),
    ('pilot-a7a7a7a7a7a74a7a', '0f000000-0000-4000-8000-0000000000c1', 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7'),
    ('pilot-a7a7a7a7a7a74a7a', '0f000000-0000-4000-8000-0000000000c2', 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7')
  ) as f(w, d, u);

-- ---------------------------------------------------------------------------
-- Fixture: three tombstoned, eligible, attested objects; the third tenant then goes on hold
-- ---------------------------------------------------------------------------
create temp table requests as
select w, d, public.request_customer_source_deletion(w, d::uuid, u::uuid, 'sha256:' || repeat('a', 64)) as r
  from (values
    ('pilot-e5e5e5e5e5e54e5e', '0f000000-0000-4000-8000-0000000000b1', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5'),
    ('pilot-f6f6f6f6f6f64f6f', '0f000000-0000-4000-8000-0000000000b2', 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6'),
    ('pilot-a7a7a7a7a7a74a7a', '0f000000-0000-4000-8000-0000000000c1', 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7')
  ) as f(w, d, u);

alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where deletion_id in (select r->>'deletionId' from requests);
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;

create temp table attested as
select public.attest_source_deletion_inventory(r->>'deletionId', jsonb_build_array(jsonb_build_object(
  'key', 'quarantine/' || w || '/' || d || '/source', 'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10))) as a
  from requests;

insert into public.source_operator_legal_holds (workspace_key, reason)
values ('pilot-a7a7a7a7a7a74a7a', 'fixture: litigation hold');

select has_column('public', 'source_deletion_objects', 'purge_not_before', 'objects carry a retry-not-before time');
select ok(has_function_privilege('service_role', 'public.claim_source_deletion_sweep(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_source_deletion_sweep(integer)', 'execute')
  and has_function_privilege('service_role', 'public.record_source_deletion_purge_failure(text,text,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_source_deletion_purge_failure(text,text,uuid,text)', 'execute'),
  'grants are unchanged: worker only');

-- ---------------------------------------------------------------------------
-- First claim goes to one unheld object; the bucket refuses its delete
-- ---------------------------------------------------------------------------
create temp table locked_claim as select c from public.claim_source_deletion_sweep(1) c;
select ok((select count(*) = 1 and bool_and(c->>'workspaceKey' in ('pilot-e5e5e5e5e5e54e5e', 'pilot-f6f6f6f6f6f64f6f'))
  from locked_claim), 'the first claim goes to an unheld tenant');
create temp table locked_begun as select public.begin_source_deletion_object((select c->>'deletionId' from locked_claim),
  (select c->>'objectKey' from locked_claim), (select c->>'objectSha256' from locked_claim),
  (select (c->>'claimId')::uuid from locked_claim)) as r;

-- An ambiguous failure (timeout, unknown R2 error): the delete may have happened, so the attempt stays open.
create temp table failure_1 as select public.record_source_deletion_purge_failure((select c->>'deletionId' from locked_claim),
  (select c->>'objectKey' from locked_claim), (select (c->>'claimId')::uuid from locked_claim), 'SOURCE_DELETE_FAILED');
select ok((select purge_not_before is null and delete_started_at is not null
    and purge_claim_id = (select (c->>'claimId')::uuid from locked_claim)
  from public.source_deletion_objects where deletion_id = (select c->>'deletionId' from locked_claim)),
  'an ambiguous R2 failure is not deferred and keeps its claim and started state');

-- The explicit refusal: R2 answered and deleted nothing.
create temp table failure_2 as select public.record_source_deletion_purge_failure((select c->>'deletionId' from locked_claim),
  (select c->>'objectKey' from locked_claim), (select (c->>'claimId')::uuid from locked_claim), 'SOURCE_DELETE_OBJECT_LOCKED');
select ok((select purge_not_before >= now() + interval '24 hours' and purge_not_before <= clock_timestamp() + interval '24 hours'
  from public.source_deletion_objects where deletion_id = (select c->>'deletionId' from locked_claim)),
  'an object-lock refusal defers it by 24 hours');
select ok((select purged_at is null and purge_claim_id is null and purge_claim_expires_at is null and delete_started_at is null
  from public.source_deletion_objects where deletion_id = (select c->>'deletionId' from locked_claim)),
  'and fences the finished attempt: claim, expiry and started state cleared, nothing purged');
select is((select count(*)::integer from public.source_deletion_receipts
  where deletion_id = (select c->>'deletionId' from locked_claim) and action = 'object_purged'), 0,
  'and writes no receipt');
select throws_ok($$select public.finalize_source_deletion_object((select c->>'deletionId' from locked_claim),
  (select c->>'objectKey' from locked_claim), (select c->>'objectSha256' from locked_claim), false,
  (select (c->>'claimId')::uuid from locked_claim))$$,
  'P0001', 'SOURCE_DELETION_LEASE_INVALID', 'a stale finalize with the former claim is refused');
select throws_ok($$select public.begin_source_deletion_object((select c->>'deletionId' from locked_claim),
  (select c->>'objectKey' from locked_claim), (select c->>'objectSha256' from locked_claim),
  (select (c->>'claimId')::uuid from locked_claim))$$,
  'P0001', 'SOURCE_DELETION_LEASE_INVALID', 'so is a stale begin');
select throws_ok($$select public.record_source_deletion_purge_failure((select c->>'deletionId' from locked_claim),
  (select c->>'objectKey' from locked_claim), (select (c->>'claimId')::uuid from locked_claim), 'SOURCE_DELETE_OBJECT_LOCKED')$$,
  'P0001', 'SOURCE_DELETION_LEASE_INVALID', 'and a second failure record for the finished attempt');

-- ---------------------------------------------------------------------------
-- The other unheld object proceeds to its receipt
-- ---------------------------------------------------------------------------
create temp table other_claim as select c from public.claim_source_deletion_sweep(1) c;
select ok((select count(*) = 1
    and bool_and(c->>'deletionId' <> (select c->>'deletionId' from locked_claim))
    and bool_and(c->>'workspaceKey' in ('pilot-e5e5e5e5e5e54e5e', 'pilot-f6f6f6f6f6f64f6f'))
  from other_claim), 'the next claim goes to the other eligible, unlocked object');
create temp table other_begun as select public.begin_source_deletion_object((select c->>'deletionId' from other_claim),
  (select c->>'objectKey' from other_claim), (select c->>'objectSha256' from other_claim),
  (select (c->>'claimId')::uuid from other_claim)) as r;
select is(public.finalize_source_deletion_object((select c->>'deletionId' from other_claim), (select c->>'objectKey' from other_claim),
  (select c->>'objectSha256' from other_claim), false, (select (c->>'claimId')::uuid from other_claim))->>'status', 'recorded',
  'and is purged with a receipt');

-- ---------------------------------------------------------------------------
-- Nothing else is due: the deferred object is not reclaimed, the held tenant is not touched
-- ---------------------------------------------------------------------------
select is((select count(*)::integer from public.claim_source_deletion_sweep(1)), 0,
  'the deferred object is not handed out again before it is due');
select is((select purge_claim_id from public.source_deletion_objects
  where deletion_id = (select c->>'deletionId' from locked_claim)), null, 'it holds no claim');
select is((select purge_claim_id from public.source_deletion_objects where workspace_key = 'pilot-a7a7a7a7a7a74a7a'), null,
  'the held tenant''s object was never claimed');
select is(public.source_legal_hold_state('pilot-a7a7a7a7a7a74a7a'), 'active', 'the hold is still active');
select throws_ok($$select public.request_customer_source_deletion('pilot-a7a7a7a7a7a74a7a',
  '0f000000-0000-4000-8000-0000000000c2', 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7', 'sha256:' || repeat('a', 64))$$,
  'P0001', 'SOURCE_LEGAL_HOLD_ACTIVE', 'and still refuses a new deletion request');

-- ---------------------------------------------------------------------------
-- The refused attempt is over, so a legal hold can now be placed on its tenant
-- ---------------------------------------------------------------------------
select lives_ok($$insert into public.source_operator_legal_holds (workspace_key, reason)
  select c->>'workspaceKey', 'fixture: hold after lock refusal' from locked_claim$$,
  'an operator hold can be placed after an explicit lock refusal');
select is(public.source_legal_hold_state((select c->>'workspaceKey' from locked_claim)), 'active', 'and is active');

-- The day passes; the hold still keeps the object out of the sweep.
update public.source_deletion_objects set purge_not_before = clock_timestamp() - interval '1 second'
 where deletion_id = (select c->>'deletionId' from locked_claim);
select is((select count(*)::integer from public.claim_source_deletion_sweep(1)), 0,
  'a held object is not reclaimed even once it is due');
select is((select purge_claim_id from public.source_deletion_objects
  where deletion_id = (select c->>'deletionId' from locked_claim)), null, 'and holds no claim');

-- ---------------------------------------------------------------------------
-- Bounded: released and due, the object is retried under a new claim only
-- ---------------------------------------------------------------------------
update public.source_operator_legal_holds set released_at = clock_timestamp()
 where workspace_key = (select c->>'workspaceKey' from locked_claim) and released_at is null;
create temp table retry_claim as select c from public.claim_source_deletion_sweep(1) c;
select is((select c->>'deletionId' from retry_claim), (select c->>'deletionId' from locked_claim),
  'a due, unheld object is claimed again');
select isnt((select (c->>'claimId')::uuid from retry_claim), (select (c->>'claimId')::uuid from locked_claim),
  'under a new claim');
create temp table retry_begun as select public.begin_source_deletion_object((select c->>'deletionId' from retry_claim),
  (select c->>'objectKey' from retry_claim), (select c->>'objectSha256' from retry_claim),
  (select (c->>'claimId')::uuid from retry_claim)) as r;
select is(public.finalize_source_deletion_object((select c->>'deletionId' from retry_claim), (select c->>'objectKey' from retry_claim),
  (select c->>'objectSha256' from retry_claim), false, (select (c->>'claimId')::uuid from retry_claim))->>'status', 'recorded',
  'the new claim can finalize once R2 deletes it');
select is((select purge_claim_id from public.source_deletion_objects where workspace_key = 'pilot-a7a7a7a7a7a74a7a'), null,
  'the held tenant is still skipped');
select is((select count(*)::integer from public.source_deletion_worker_failures
  where deletion_id = (select c->>'deletionId' from locked_claim) and stage = 'purge'), 2,
  'the failure history is kept');

select * from finish();
rollback;
