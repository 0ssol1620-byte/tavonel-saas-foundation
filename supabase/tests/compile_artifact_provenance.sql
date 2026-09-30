-- Migration 20260930013000: every stored World candidate names its documents, and deletion reads it.
--
-- Workspace C8, document X, collection c:
--   D1  recorded on compile job J only (the job rule of 20260930010000)
--   D2  a late second digest for J: the job row refuses it (20260930012000), the registry holds it
--   D3  a direct compile with no job row at all: the registry holds it
-- Workspace C7 registers the same collection, digest and document id -> never claimed by C8.
begin;
select plan(27);

create function pg_temp.wk(p_ws text, p_d text) returns text language sql immutable as $$
  select 'immutable/' || p_ws || '/' || p_ws || '/collections/collection-' || repeat('c', 32) || '/'
    || repeat(p_d, 64) || '/candidate-world.json';
$$;
create function pg_temp.reg(p_ws text, p_d text, p_docs uuid[]) returns jsonb language sql as $$
  select public.register_collection_artifact_provenance(p_ws, 'collection-' || repeat('c', 32),
    'sha256:' || repeat(p_d, 64), p_docs);
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8', 'authenticated', 'authenticated',
   'artifact-provenance-1@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c7c7c7c7-c7c7-4c7c-8c7c-c7c7c7c7c7c7', 'authenticated', 'authenticated',
   'artifact-provenance-2@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
) values ('pilot-c8c8c8c8c8c84c8c', '0c800000-0000-4000-8000-00000000000a', 'c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8',
  'quarantine/pilot-c8c8c8c8c8c84c8c/0c800000-0000-4000-8000-00000000000a/source', 10, 'application/pdf',
  now(), now(), now() + interval '10 minutes', now());

insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids,
  idempotency_key, state, documents_total, collection_id, candidate_manifest_digest, settled_at)
values ('cjob-' || repeat('8', 32), 'pilot-c8c8c8c8c8c84c8c', 'c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8',
  array['0c800000-0000-4000-8000-00000000000a'], 'artifact-provenance-j', 'review_required', 1,
  'collection-' || repeat('c', 32), 'sha256:' || repeat('1', 64), null);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
select table_privs_are('public', 'foundation_collection_artifact_provenance', 'service_role', array[]::text[],
  'the registry is reached only through its functions');
select ok(has_function_privilege('service_role',
  'public.register_collection_artifact_provenance(text,text,text,uuid[])', 'execute'), 'the compile server can register');
select ok(not has_function_privilege('authenticated',
  'public.register_collection_artifact_provenance(text,text,text,uuid[])', 'execute'), 'a browser cannot');

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------
select throws_ok($$update public.foundation_compile_jobs set candidate_manifest_digest = 'sha256:' || repeat('2', 64)
   where job_id = 'cjob-' || repeat('8', 32)$$,
  'P0001', 'compile_job_candidate_digest_immutable', 'the job row refuses the late second digest D2');
select is(pg_temp.reg('pilot-c8c8c8c8c8c84c8c', '2', array['0c800000-0000-4000-8000-00000000000a'::uuid]),
  jsonb_build_object('objectKey', pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '2'), 'leaseSeconds', 120),
  'the registry records D2 for X before its PUT');
select ok(exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid()
    and l.objsubid = 1 and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended(
      'tavonel.source_legal_hold.v1' || chr(10) || 'pilot-c8c8c8c8c8c84c8c', 0)),
  'registration holds the workspace lock every tombstone writer and the attestation take');
select lives_ok($$select pg_temp.reg('pilot-c8c8c8c8c8c84c8c', '3', array['0c800000-0000-4000-8000-00000000000a'::uuid])$$,
  'a direct compile with no job row registers D3');
select lives_ok($$select pg_temp.reg('pilot-c8c8c8c8c8c84c8c', '2', array['0c800000-0000-4000-8000-00000000000a'::uuid])$$,
  'a retry with the same mapping registers again');
select is((select count(*)::integer from public.foundation_collection_artifact_provenance
   where object_key = pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '2')), 2, 'one row per publication attempt');
select throws_ok($$select pg_temp.reg('pilot-c8c8c8c8c8c84c8c', '2',
    array['0c800000-0000-4000-8000-00000000000a'::uuid, '0c800000-0000-4000-8000-00000000000b'::uuid])$$,
  'P0001', 'COLLECTION_ARTIFACT_PROVENANCE_CONFLICT', 'a key cannot be re-registered with a different document set');
select throws_ok($$select pg_temp.reg('pilot-c8c8c8c8c8c84c8c', '4', array[]::uuid[])$$,
  'P0001', 'COLLECTION_ARTIFACT_PROVENANCE_INVALID', 'an empty document set is refused');
select throws_ok($$select pg_temp.reg('pilot-c8c8c8c8c8c84c8c', '4', array[null]::uuid[])$$,
  'P0001', 'COLLECTION_ARTIFACT_PROVENANCE_INVALID', 'a null document id is refused');
select throws_ok($$update public.foundation_collection_artifact_provenance set document_ids = array[gen_random_uuid()]$$,
  'P0001', 'foundation_collection_artifact_provenance_append_only', 'a mapping cannot be rewritten');
select throws_ok($$delete from public.foundation_collection_artifact_provenance$$,
  'P0001', 'foundation_collection_artifact_provenance_append_only', 'or erased');
select lives_ok($$select pg_temp.reg('pilot-c7c7c7c7c7c74c7c', '2', array['0c800000-0000-4000-8000-00000000000a'::uuid])$$,
  'another workspace registers the same collection, digest and document id in its own scope');

-- ---------------------------------------------------------------------------
-- Deletion of X
-- ---------------------------------------------------------------------------
create temp table request as select public.request_customer_source_deletion('pilot-c8c8c8c8c8c84c8c',
  '0c800000-0000-4000-8000-00000000000a', 'c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8', 'sha256:' || repeat('a', 64)) as r;
select throws_ok($$select pg_temp.reg('pilot-c8c8c8c8c8c84c8c', '5', array['0c800000-0000-4000-8000-00000000000a'::uuid])$$,
  'P0001', 'COLLECTION_ARTIFACT_SOURCE_DELETED', 'no candidate can be registered for a tombstoned document');
select throws_ok($$select pg_temp.reg('pilot-c8c8c8c8c8c84c8c', '5',
    array['0c800000-0000-4000-8000-00000000000a'::uuid, '0c800000-0000-4000-8000-00000000000b'::uuid])$$,
  'P0001', 'COLLECTION_ARTIFACT_SOURCE_DELETED', 'nor for a set that includes one');

alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0c800000-0000-4000-8000-00000000000a';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;

-- The registrations above committed before the tombstone and may still be followed by a PUT.
select is(public.source_deletion_inventory_candidate(), null::jsonb,
  'the inventory waits while a publication window for X is open');
select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array(jsonb_build_object('key', 'quarantine/pilot-c8c8c8c8c8c84c8c/0c800000-0000-4000-8000-00000000000a/source',
    'sha256', 'sha256:' || repeat('3', 64), 'sizeBytes', 10)),
  jsonb_build_array(pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '1'), pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '2'),
    pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '3')))$$,
  'P0001', 'SOURCE_DELETION_INVENTORY_NOT_QUIESCENT', 'and the attestation refuses inside it');

alter table public.foundation_collection_artifact_provenance disable trigger foundation_collection_artifact_provenance_append_only;
update public.foundation_collection_artifact_provenance
   set registered_at = now() - interval '10 minutes',
       publish_by = now() - interval '8 minutes'
 where workspace_key = 'pilot-c8c8c8c8c8c84c8c';
alter table public.foundation_collection_artifact_provenance enable trigger foundation_collection_artifact_provenance_append_only;

select is(public.source_deletion_inventory_candidate()->'worldObjectKeys', jsonb_build_array(
    pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '1'), pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '2'),
    pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '3')),
  'once every window has closed, the candidate names the job''s D1 and the registered D2 and D3, and not C7''s');

create temp table attested as select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array(
    jsonb_build_object('key', 'quarantine/pilot-c8c8c8c8c8c84c8c/0c800000-0000-4000-8000-00000000000a/source',
      'sha256', 'sha256:' || repeat('3', 64), 'sizeBytes', 10),
    jsonb_build_object('key', pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '2'), 'sha256', 'sha256:' || repeat('4', 64), 'sizeBytes', 7),
    jsonb_build_object('key', pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '3'), 'sha256', 'sha256:' || repeat('5', 64), 'sizeBytes', 7)),
  jsonb_build_array(pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '3'), pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '1'),
    pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '2'))) as r;
select is((select r->>'status' from attested), 'recorded', 'the full key set attests');
select is((select array_agg(object_key order by object_key) from public.source_deletion_objects
   where deletion_id = (select r->>'deletionId' from request)),
  array[pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '2'), pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '3'),
        'quarantine/pilot-c8c8c8c8c8c84c8c/0c800000-0000-4000-8000-00000000000a/source'],
  'both registered candidates are enqueued for purge; the absent D1 is recorded absent, not purged');
select throws_ok($$select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array(jsonb_build_object('key', pg_temp.wk('pilot-c7c7c7c7c7c74c7c', '2'),
    'sha256', 'sha256:' || repeat('6', 64), 'sizeBytes', 7)),
  jsonb_build_array(pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '1'), pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '2'),
    pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '3')))$$,
  'P0001', 'SOURCE_DELETION_INVENTORY_OBJECT_OUT_OF_SCOPE', 'another workspace''s registered object is never in scope');

create temp table closed as select public.close_source_deletion_derived() as r;
select is((select r->>'status' from closed), 'recorded', 'the closure records');
select is((select r->'affectedWorlds' from closed), jsonb_build_array(
    jsonb_build_object('collectionId', 'collection-' || repeat('c', 32), 'manifestDigest', 'sha256:' || repeat('1', 64)),
    jsonb_build_object('collectionId', 'collection-' || repeat('c', 32), 'manifestDigest', 'sha256:' || repeat('2', 64)),
    jsonb_build_object('collectionId', 'collection-' || repeat('c', 32), 'manifestDigest', 'sha256:' || repeat('3', 64))),
  'the receipt names all three Worlds, by hash only');
select throws_ok($$select public.transition_foundation_world_atomic(gen_random_uuid(), 'activate',
  'pilot-c8c8c8c8c8c84c8c', 'collection-' || repeat('c', 32), 'sha256:' || repeat('3', 64),
  pg_temp.wk('pilot-c8c8c8c8c8c84c8c', '3'), 'ws_world_3', 'sha256:' || repeat('f', 64),
  'empty', 0, null, 'c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8', 'Activate a registry-only World')$$,
  'P0001', 'world_source_deleted', 'a World known only from the registry cannot be activated after deletion');
select is((select count(*)::integer from public.foundation_collection_artifact_provenance
   where workspace_key = 'pilot-c7c7c7c7c7c74c7c' and publish_by > clock_timestamp()), 1,
  'the other workspace''s registration is untouched');

select * from finish();
rollback;
