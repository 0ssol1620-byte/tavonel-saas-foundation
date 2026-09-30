-- Gate 11 (migration 20260930010000): deleting a document invalidates every World compiled from it.
--
-- Workspace E6 (self-service, legal hold 'inactive' without an operator hold):
--   c1/d3  World from A (job J3), superseded     -> affected, its R2 key listed absent
--   c1/d1  World from A + B (job J1), active     -> affected: pointer invalidated, every unit erased
--   c2/d2  World from B only (job J2), active    -> untouched
--   c4/d4  World indexed with A, no compile job  -> not claimed: pointer and summary stay
-- Workspace E7 holds a job naming A's document id and the same collection id -> untouched.
begin;
select plan(35);

create function pg_temp.wk(p_ws text, p_c text, p_d text) returns text language sql immutable as $$
  select 'immutable/' || p_ws || '/' || p_ws || '/collections/collection-' || repeat(p_c, 32) || '/'
    || repeat(p_d, 64) || '/candidate-world.json';
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', 'authenticated', 'authenticated',
   'world-deletion-1@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7', 'authenticated', 'authenticated',
   'world-deletion-2@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
) values ('pilot-e6e6e6e6e6e64e6e', '0e600000-0000-4000-8000-00000000000a', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6',
  'quarantine/pilot-e6e6e6e6e6e64e6e/0e600000-0000-4000-8000-00000000000a/source', 10, 'application/pdf',
  now(), now(), now() + interval '10 minutes', now());

-- Worlds. c1/d3 first, then c1/d1 supersedes it.
select public.promote_foundation_candidate(w.ws, 'collection-' || repeat(w.c, 32), 'sha256:' || repeat(w.d, 64),
  pg_temp.wk(w.ws, w.c, w.d), 'ws_world_' || w.d, 'sha256:' || repeat('f', 64), w.actor::uuid, w.expected,
  'Fixture world for source deletion')
  from (values
    (1, 'pilot-e6e6e6e6e6e64e6e', '1', '3', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', null),
    (2, 'pilot-e6e6e6e6e6e64e6e', '1', '1', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', 'sha256:' || repeat('3', 64)),
    (3, 'pilot-e6e6e6e6e6e64e6e', '2', '2', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', null),
    (4, 'pilot-e6e6e6e6e6e64e6e', '4', '4', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', null),
    (5, 'pilot-e7e7e7e7e7e74e7e', '1', '1', 'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7', null)
  ) w(n, ws, c, d, actor, expected)
 order by w.n;

insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids,
  idempotency_key, state, documents_total, collection_id, candidate_manifest_digest, settled_at)
values
  ('cjob-' || repeat('1', 32), 'pilot-e6e6e6e6e6e64e6e', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6',
   array['0e600000-0000-4000-8000-00000000000a', '0e600000-0000-4000-8000-00000000000b'], 'world-deletion-j1', 'ready', 2,
   'collection-' || repeat('1', 32), 'sha256:' || repeat('1', 64), now()),
  ('cjob-' || repeat('3', 32), 'pilot-e6e6e6e6e6e64e6e', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6',
   array['0e600000-0000-4000-8000-00000000000a'], 'world-deletion-j3', 'ready', 1,
   'collection-' || repeat('1', 32), 'sha256:' || repeat('3', 64), now()),
  ('cjob-' || repeat('2', 32), 'pilot-e6e6e6e6e6e64e6e', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6',
   array['0e600000-0000-4000-8000-00000000000b'], 'world-deletion-j2', 'ready', 1,
   'collection-' || repeat('2', 32), 'sha256:' || repeat('2', 64), now()),
  -- A job that named A but never recorded a digest: no World is derived from it.
  ('cjob-' || repeat('5', 32), 'pilot-e6e6e6e6e6e64e6e', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6',
   array['0e600000-0000-4000-8000-00000000000a'], 'world-deletion-j5', 'failed', 1, null, null, now()),
  ('cjob-' || repeat('7', 32), 'pilot-e7e7e7e7e7e74e7e', 'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7',
   array['0e600000-0000-4000-8000-00000000000a'], 'world-deletion-j7', 'ready', 1,
   'collection-' || repeat('1', 32), 'sha256:' || repeat('1', 64), now());

insert into public.foundation_retrieval_profiles (
  id, workspace_key, views, embedding, lexical, fusion, index_backend, index_metric, profile_digest, created_by
) select 'bge-m3-v1', ws, array['section', 'claim', 'entity', 'summary'],
  '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
  '{"backend":"postgres_fts"}', '{"algorithm":"rrf","k":60}', 'pgvector', 'cosine',
  'sha256:' || repeat('3', 64), actor::uuid
  from (values ('pilot-e6e6e6e6e6e64e6e', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6'),
               ('pilot-e7e7e7e7e7e74e7e', 'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7')) p(ws, actor);
insert into public.foundation_retrieval_compile_runs (
  run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status, completed_at, unit_count
) values
  ('retrieval-run-' || repeat('1', 32), 'pilot-e6e6e6e6e6e64e6e', 'collection-' || repeat('1', 32), 'sha256:' || repeat('1', 64), 'bge-m3-v1', 'completed', now(), 4),
  ('retrieval-run-' || repeat('2', 32), 'pilot-e6e6e6e6e6e64e6e', 'collection-' || repeat('2', 32), 'sha256:' || repeat('2', 64), 'bge-m3-v1', 'completed', now(), 1),
  ('retrieval-run-' || repeat('4', 32), 'pilot-e6e6e6e6e6e64e6e', 'collection-' || repeat('4', 32), 'sha256:' || repeat('4', 64), 'bge-m3-v1', 'completed', now(), 2),
  ('retrieval-run-' || repeat('7', 32), 'pilot-e7e7e7e7e7e74e7e', 'collection-' || repeat('1', 32), 'sha256:' || repeat('1', 64), 'bge-m3-v1', 'completed', now(), 1);
insert into public.foundation_retrieval_units (
  unit_id, workspace_key, compile_run_id, unit_type, document_id, document_version_key, text, content_digest
) select 'retrieval-unit-' || repeat(u.id, 16), u.ws, 'retrieval-run-' || repeat(u.run, 32), u.kind, u.doc,
    repeat('a', 64), u.body, 'sha256:' || repeat('4', 64)
  from (values
    ('11', 'pilot-e6e6e6e6e6e64e6e', '1', 'section', '0e600000-0000-4000-8000-00000000000a', 'A section'),
    ('12', 'pilot-e6e6e6e6e6e64e6e', '1', 'section', '0e600000-0000-4000-8000-00000000000b', 'B section in the shared World'),
    ('13', 'pilot-e6e6e6e6e6e64e6e', '1', 'summary', '0e600000-0000-4000-8000-00000000000a', 'A and B summary'),
    ('14', 'pilot-e6e6e6e6e6e64e6e', '1', 'summary', '0e600000-0000-4000-8000-00000000000b', 'B and A summary'),
    ('21', 'pilot-e6e6e6e6e6e64e6e', '2', 'section', '0e600000-0000-4000-8000-00000000000b', 'B section alone'),
    ('41', 'pilot-e6e6e6e6e6e64e6e', '4', 'section', '0e600000-0000-4000-8000-00000000000a', 'A section, unassociated World'),
    ('42', 'pilot-e6e6e6e6e6e64e6e', '4', 'summary', '0e600000-0000-4000-8000-00000000000a', 'A summary, unassociated World'),
    ('71', 'pilot-e7e7e7e7e7e74e7e', '7', 'summary', '0e600000-0000-4000-8000-00000000000a', 'Other workspace')
  ) u(id, ws, run, kind, doc, body);
insert into public.foundation_retrieval_embeddings (workspace_key, unit_id, retrieval_profile_id, dimension, embedding)
values ('pilot-e6e6e6e6e6e64e6e', 'retrieval-unit-' || repeat('12', 16), 'bge-m3-v1', 3, '[1,0,0]'),
       ('pilot-e6e6e6e6e6e64e6e', 'retrieval-unit-' || repeat('21', 16), 'bge-m3-v1', 3, '[0,1,0]');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('service_role', 'public.source_deletion_affected_worlds(text)', 'execute'),
  'the affected-World rule is internal');
select ok(not has_function_privilege('authenticated', 'public.attest_source_deletion_inventory(text,jsonb,jsonb)', 'execute'),
  'browsers cannot attest');
select ok(has_function_privilege('service_role', 'public.attest_source_deletion_inventory(text,jsonb,jsonb)', 'execute'),
  'the inventory worker can');

-- ---------------------------------------------------------------------------
-- Candidate: exactly the persisted associations
-- ---------------------------------------------------------------------------
create temp table request as select public.request_customer_source_deletion('pilot-e6e6e6e6e6e64e6e',
  '0e600000-0000-4000-8000-00000000000a', 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', 'sha256:' || repeat('a', 64)) as r;
alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0e600000-0000-4000-8000-00000000000a';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;

select is(public.source_deletion_inventory_candidate()->'worldObjectKeys',
  jsonb_build_array(pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '1'), pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '3')),
  'the candidate names both Worlds compiled from A, and not B''s, the unassociated or the other workspace''s');

-- ---------------------------------------------------------------------------
-- Attestation refusals
-- ---------------------------------------------------------------------------
create temp table source_object as select jsonb_build_object(
  'key', 'quarantine/pilot-e6e6e6e6e6e64e6e/0e600000-0000-4000-8000-00000000000a/source',
  'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10) as o;
create temp table world_object as select jsonb_build_object(
  'key', pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '1'), 'sha256', 'sha256:' || repeat('2', 64), 'sizeBytes', 7) as o;

select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array((select o from source_object)))$$,
  'P0001', 'SOURCE_DELETION_INVENTORY_WORLD_KEYS_MISMATCH', 'a worker that omits the World key set is refused');
select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array((select o from source_object)),
  jsonb_build_array(pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '1')))$$,
  'P0001', 'SOURCE_DELETION_INVENTORY_WORLD_KEYS_MISMATCH', 'a partial World key set is refused');
select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array((select o from source_object)),
  jsonb_build_array(pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '1'), pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '3'),
    pg_temp.wk('pilot-e7e7e7e7e7e74e7e', '1', '1')))$$,
  'P0001', 'SOURCE_DELETION_INVENTORY_WORLD_KEYS_MISMATCH', 'another workspace''s World key is refused');
select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array((select o from source_object), jsonb_build_object(
    'key', pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '2', '2'), 'sha256', 'sha256:' || repeat('3', 64), 'sizeBytes', 7)),
  jsonb_build_array(pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '1'), pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '3')))$$,
  'P0001', 'SOURCE_DELETION_INVENTORY_OBJECT_OUT_OF_SCOPE', 'an unrelated World object is refused');
select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array((select o from source_object)),
  (select jsonb_agg(pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', lpad(to_hex(n), 2, '0'))) from generate_series(1, 65) n))$$,
  'P0001', 'SOURCE_DELETION_INVENTORY_INVALID', 'an oversized World key set is refused');

insert into public.source_operator_legal_holds (workspace_key, reason)
values ('pilot-e6e6e6e6e6e64e6e', 'Fixture hold before attestation');
select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array((select o from source_object), (select o from world_object)),
  jsonb_build_array(pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '1'), pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '3')))$$,
  'P0001', 'SOURCE_LEGAL_HOLD_ACTIVE', 'a held workspace is not attested');
update public.source_operator_legal_holds set released_at = clock_timestamp() where workspace_key = 'pilot-e6e6e6e6e6e64e6e';

-- ---------------------------------------------------------------------------
-- Attestation: the present World key is enqueued, the absent one is not claimed
-- ---------------------------------------------------------------------------
create temp table attested as select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array((select o from world_object), (select o from source_object)),
  jsonb_build_array(pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '3'), pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '1'))) as r;
select is((select r->>'status' from attested), 'recorded', 'the exact World key set attests');
select is((select (r->>'artifactCount')::integer from attested), 2, 'with the source and the present World object');
select is((select array_agg(object_key order by object_key) from public.source_deletion_objects
   where deletion_id = (select r->>'deletionId' from request)),
  array[pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '1'),
        'quarantine/pilot-e6e6e6e6e6e64e6e/0e600000-0000-4000-8000-00000000000a/source'],
  'only listed objects are enqueued: nothing is claimed for the absent or the unassociated World');
select is((select count(*)::integer from public.source_deletion_receipts
   where deletion_id = (select r->>'deletionId' from request) and action = 'object_purged'), 0,
  'no purge is claimed before an R2 removal receipt');

-- ---------------------------------------------------------------------------
-- A hold stops the closure
-- ---------------------------------------------------------------------------
insert into public.source_operator_legal_holds (workspace_key, reason)
values ('pilot-e6e6e6e6e6e64e6e', 'Fixture hold before closure');
select is(public.close_source_deletion_derived()->>'status', 'idle', 'a held workspace is not closed');
select is((select manifest_digest from public.foundation_active_worlds
   where workspace_key = 'pilot-e6e6e6e6e6e64e6e' and collection_id = 'collection-' || repeat('1', 32)),
  'sha256:' || repeat('1', 64), 'and its active pointer stays');
select is((select count(*)::integer from public.foundation_retrieval_units where workspace_key = 'pilot-e6e6e6e6e6e64e6e'),
  7, 'and its units stay');
update public.source_operator_legal_holds set released_at = clock_timestamp()
 where workspace_key = 'pilot-e6e6e6e6e6e64e6e' and released_at is null;

-- ---------------------------------------------------------------------------
-- The closure
-- ---------------------------------------------------------------------------
create temp table closed as select public.close_source_deletion_derived() as r;
select is((select r->>'status' from closed), 'recorded', 'the closure records');
select is((select (r->>'activeWorldPointersInvalidated')::integer from closed), 1, 'one active pointer is invalidated');
select is((select (r->>'worldRetrievalUnitsErased')::integer from closed), 4,
  'every unit of the affected World is erased, shared summaries and B''s section included');
select is((select (r->>'retrievalUnitsErased')::integer from closed), 5, 'plus A''s own section elsewhere');
select is((select (r->>'retrievalEmbeddingsErased')::integer from closed), 1, 'with the affected World''s embedding');
select is((select (r->>'retrievalUnitsRetainedUnproven')::integer from closed), 1,
  'the unassociated World''s summary is retained, not claimed');
select is((select r->'affectedWorlds' from closed), jsonb_build_array(
    jsonb_build_object('collectionId', 'collection-' || repeat('1', 32), 'manifestDigest', 'sha256:' || repeat('1', 64)),
    jsonb_build_object('collectionId', 'collection-' || repeat('1', 32), 'manifestDigest', 'sha256:' || repeat('3', 64))),
  'the receipt names the affected Worlds by hash only');

select is((select array_agg(unit_id order by unit_id) from public.foundation_retrieval_units
   where workspace_key = 'pilot-e6e6e6e6e6e64e6e'),
  array['retrieval-unit-' || repeat('21', 16), 'retrieval-unit-' || repeat('42', 16)],
  'B''s own World and the unassociated summary remain');
select is((select array_agg(collection_id || '@' || manifest_digest order by collection_id) from public.foundation_active_worlds
   where workspace_key = 'pilot-e6e6e6e6e6e64e6e'),
  array['collection-' || repeat('2', 32) || '@sha256:' || repeat('2', 64),
        'collection-' || repeat('4', 32) || '@sha256:' || repeat('4', 64)],
  'the unrelated and the unassociated pointers remain; the affected one is gone');
select is((select count(*)::integer from public.foundation_world_versions
   where workspace_key = 'pilot-e6e6e6e6e6e64e6e' and collection_id = 'collection-' || repeat('1', 32)
     and lifecycle_status = 'active'), 0, 'no affected version is active');
select is((select count(*)::integer from public.foundation_world_versions where workspace_key = 'pilot-e6e6e6e6e6e64e6e'),
  4, 'every World version is kept as hash metadata');
select is((select count(*)::integer from public.foundation_world_events where workspace_key = 'pilot-e6e6e6e6e6e64e6e'),
  4, 'every World event is kept');
select is((select count(*)::integer from public.foundation_retrieval_units u
   join public.foundation_active_worlds p on p.workspace_key = u.workspace_key
   where u.workspace_key = 'pilot-e7e7e7e7e7e74e7e' and p.collection_id = 'collection-' || repeat('1', 32)
     and p.manifest_digest = 'sha256:' || repeat('1', 64)), 1,
  'the other workspace''s World, pointer and unit are untouched');

-- ---------------------------------------------------------------------------
-- An invalidated World stays invalidated
-- ---------------------------------------------------------------------------
select throws_ok($$update public.foundation_world_versions set lifecycle_status = 'active'
   where workspace_key = 'pilot-e6e6e6e6e6e64e6e' and collection_id = 'collection-' || repeat('1', 32)
     and manifest_digest = 'sha256:' || repeat('3', 64)$$,
  'P0001', 'world_source_deleted', 'an affected superseded version cannot be rolled back to');
select throws_ok($$select public.transition_foundation_world_atomic(gen_random_uuid(), 'activate',
  'pilot-e6e6e6e6e6e64e6e', 'collection-' || repeat('1', 32), 'sha256:' || repeat('1', 64),
  pg_temp.wk('pilot-e6e6e6e6e6e64e6e', '1', '1'), 'ws_world_1', 'sha256:' || repeat('f', 64),
  'empty', 0, null, 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', 'Reactivate a deleted World')$$,
  'P0001', 'world_source_deleted', 'the invalidated World cannot be activated again');
select throws_ok($$insert into public.foundation_retrieval_compile_runs (
  run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status
) values ('retrieval-run-' || repeat('9', 32), 'pilot-e6e6e6e6e6e64e6e', 'collection-' || repeat('1', 32),
  'sha256:' || repeat('1', 64), 'bge-m3-v1', 'pending')$$,
  'P0001', 'retrieval_compile_run_requires_active_world', 'and cannot be re-indexed');

-- ---------------------------------------------------------------------------
-- Receipt and status
-- ---------------------------------------------------------------------------
select is(public.close_source_deletion_derived()->>'status', 'idle', 'a closed deletion is not closed twice');
select is((public.customer_source_deletion_status('pilot-e6e6e6e6e6e64e6e', '0e600000-0000-4000-8000-00000000000a')
   ->'derived'->>'activeWorldPointersInvalidated')::integer, 1, 'the customer status reports the invalidation');

select * from finish();
rollback;
