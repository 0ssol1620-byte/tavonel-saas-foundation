-- Migration 20260930012000: a compile job's recorded candidate digest is permanent.
--
-- One job J over document X in workspace C9 walks the worker's path: building_world records D1,
-- a redelivery repeats D1, a divergent D2 and a clear are refused on the RPC and on a direct
-- UPDATE, and the job still settles. D1 is the active World; deleting X must still reach it.
begin;
select plan(16);

create function pg_temp.wk(p_d text) returns text language sql immutable as $$
  select 'immutable/pilot-c9c9c9c9c9c94c9c/pilot-c9c9c9c9c9c94c9c/collections/collection-' || repeat('c', 32)
    || '/' || repeat(p_d, 64) || '/candidate-world.json';
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values ('00000000-0000-0000-0000-000000000000', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'authenticated',
  'authenticated', 'digest-immutability@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
) values ('pilot-c9c9c9c9c9c94c9c', '0c900000-0000-4000-8000-00000000000a', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
  'quarantine/pilot-c9c9c9c9c9c94c9c/0c900000-0000-4000-8000-00000000000a/source', 10, 'application/pdf',
  now(), now(), now() + interval '10 minutes', now());

insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids,
  idempotency_key, state, documents_total)
values ('cjob-' || repeat('c', 32), 'pilot-c9c9c9c9c9c94c9c', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
  array['0c900000-0000-4000-8000-00000000000a'], 'digest-immutability-j', 'structuring', 1);

create function pg_temp.advance(p_state public.foundation_compile_state, p_digest text) returns boolean
language sql as $$
  select changed from public.advance_foundation_compile_job('cjob-' || repeat('c', 32), 'pilot-c9c9c9c9c9c94c9c',
    p_state, 1, 'collection-' || repeat('c', 32), null, null, null, p_digest);
$$;
create function pg_temp.digest() returns text language sql as $$
  select candidate_manifest_digest from public.foundation_compile_jobs where job_id = 'cjob-' || repeat('c', 32);
$$;

select has_trigger('public', 'foundation_compile_jobs', 'foundation_compile_jobs_candidate_digest_immutable',
  'the guard sits on the table, so it covers every write path');

-- ---------------------------------------------------------------------------
-- First digest, idempotent replay
-- ---------------------------------------------------------------------------
select is(pg_temp.advance('building_world', 'sha256:' || repeat('1', 64)), true, 'the first digest is recorded');
select is(pg_temp.digest(), 'sha256:' || repeat('1', 64), 'as D1');
select is(pg_temp.advance('review_required', 'sha256:' || repeat('1', 64)), true,
  'a redelivered advance repeating D1 still moves the job');
select is((select state::text from public.foundation_compile_jobs where job_id = 'cjob-' || repeat('c', 32)),
  'review_required', 'to review_required');

-- ---------------------------------------------------------------------------
-- Replacement and clearing are refused on every path
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.advance('review_required', 'sha256:' || repeat('2', 64))$$,
  'P0001', 'compile_job_candidate_digest_immutable', 'the RPC cannot replace D1 with D2');
select throws_ok($$update public.foundation_compile_jobs set candidate_manifest_digest = 'sha256:' || repeat('2', 64)
   where job_id = 'cjob-' || repeat('c', 32)$$,
  'P0001', 'compile_job_candidate_digest_immutable', 'nor can a direct UPDATE');
select throws_ok($$update public.foundation_compile_jobs set candidate_manifest_digest = null
   where job_id = 'cjob-' || repeat('c', 32)$$,
  'P0001', 'compile_job_candidate_digest_immutable', 'and D1 cannot be cleared');
select is(pg_temp.digest(), 'sha256:' || repeat('1', 64), 'D1 is still recorded');

-- ---------------------------------------------------------------------------
-- D1 becomes the active World; the job still settles with its digest unchanged
-- ---------------------------------------------------------------------------
select public.promote_foundation_candidate('pilot-c9c9c9c9c9c94c9c', 'collection-' || repeat('c', 32),
  'sha256:' || repeat('1', 64), pg_temp.wk('1'), 'ws_world_1', 'sha256:' || repeat('f', 64),
  'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', null, 'Fixture world for digest immutability');

select is(pg_temp.advance('ready', null), true, 'the settling advance without a digest is applied');
select is((select state::text || '@' || candidate_manifest_digest from public.foundation_compile_jobs
   where job_id = 'cjob-' || repeat('c', 32)), 'ready@sha256:' || repeat('1', 64), 'the job is terminal and keeps D1');

-- ---------------------------------------------------------------------------
-- Deleting X still reaches the originally active World
-- ---------------------------------------------------------------------------
create temp table request as select public.request_customer_source_deletion('pilot-c9c9c9c9c9c94c9c',
  '0c900000-0000-4000-8000-00000000000a', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'sha256:' || repeat('a', 64)) as r;
alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0c900000-0000-4000-8000-00000000000a';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;

select is(public.source_deletion_inventory_candidate()->'worldObjectKeys', jsonb_build_array(pg_temp.wk('1')),
  'the inventory candidate names D1''s object');
select is(public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array(
    jsonb_build_object('key', 'quarantine/pilot-c9c9c9c9c9c94c9c/0c900000-0000-4000-8000-00000000000a/source',
      'sha256', 'sha256:' || repeat('3', 64), 'sizeBytes', 10),
    jsonb_build_object('key', pg_temp.wk('1'), 'sha256', 'sha256:' || repeat('4', 64), 'sizeBytes', 7)),
  jsonb_build_array(pg_temp.wk('1')))->>'status', 'recorded', 'and D1''s object is attested for purge');

create temp table closed as select public.close_source_deletion_derived() as r;
select is((select r->'affectedWorlds' from closed), jsonb_build_array(jsonb_build_object(
    'collectionId', 'collection-' || repeat('c', 32), 'manifestDigest', 'sha256:' || repeat('1', 64))),
  'the closure names D1');
select is((select (r->>'activeWorldPointersInvalidated')::integer from closed), 1, 'and invalidates its active pointer');
select throws_ok($$update public.foundation_world_versions set lifecycle_status = 'active'
   where workspace_key = 'pilot-c9c9c9c9c9c94c9c' and manifest_digest = 'sha256:' || repeat('1', 64)$$,
  'P0001', 'world_source_deleted', 'D1 cannot be activated again');

select * from finish();
rollback;
