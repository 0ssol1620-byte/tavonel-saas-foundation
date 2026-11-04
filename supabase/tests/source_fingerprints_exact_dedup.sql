-- B1 exact-duplicate detection (migration 20261104120000).
--
-- What it proves: two documents with the same sanitized bytes find each other in one workspace
-- and never across two; a re-upload of the same source finds the original by its confirm digest;
-- redelivery returns the same answer and writes nothing twice; the rows are unreachable from any
-- client role and from service_role except through the RPC; and a source deletion's derived
-- closure erases the deleted document's rows while the other copy keeps its own.
--
-- Two self-service workspaces are bootstrapped by the auth.users insert (20260920121000):
-- pilot-b1b1b1b1b1b14b1b (owner b1b1...) and pilot-c2c2c2c2c2c24c2c (owner c2c2...).
begin;
select plan(32);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'authenticated', 'authenticated',
   'dedup-b1@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'authenticated', 'authenticated',
   'dedup-c2@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- A, B: one source uploaded twice, same bytes, so the CDR produced the same sanitized version.
-- D: the same source again, but a different sanitized version (a CDR that was not byte-stable).
-- E: unrelated. C: A's exact bytes, in the other workspace.
insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at, source_sha256
)
select w, d::uuid, u::uuid, 'quarantine/' || w || '/' || d || '/source', 10, 'application/pdf',
       now(), now(), now() + interval '10 minutes', now(), s
  from (values
    ('pilot-b1b1b1b1b1b14b1b', '0a000000-0000-4000-8000-00000000000a', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'sha256:' || repeat('5', 64)),
    ('pilot-b1b1b1b1b1b14b1b', '0b000000-0000-4000-8000-00000000000b', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'sha256:' || repeat('5', 64)),
    ('pilot-b1b1b1b1b1b14b1b', '0d000000-0000-4000-8000-00000000000d', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'sha256:' || repeat('5', 64)),
    ('pilot-b1b1b1b1b1b14b1b', '0e000000-0000-4000-8000-00000000000e', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'sha256:' || repeat('6', 64)),
    ('pilot-c2c2c2c2c2c24c2c', '0c000000-0000-4000-8000-00000000000c', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'sha256:' || repeat('5', 64))
  ) as f(w, d, u, s);

create function public.b1_test_fp(p_document text, p_hex text) returns jsonb language sql as $$
  select jsonb_build_object('documentId', p_document, 'sourceVersionId', repeat(p_hex, 64),
                            'sanitizedSha256', 'sha256:' || repeat(p_hex, 64));
$$;
grant execute on function public.b1_test_fp(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 1. Nobody but the RPC reaches the rows.
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.source_fingerprints'::regclass), 'fingerprints have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.document_relations'::regclass), 'relations have RLS');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'source_fingerprints'
  and policyname = 'source_fingerprints_no_client_access' and permissive = 'RESTRICTIVE'), 'fingerprints carry a deny-all client policy');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_relations'
  and policyname = 'document_relations_no_client_access' and permissive = 'RESTRICTIVE'), 'relations carry a deny-all client policy');
select ok(has_function_privilege('service_role', 'public.record_source_fingerprints(text, jsonb)', 'execute'), 'the server may record');
select ok(not has_function_privilege('authenticated', 'public.record_source_fingerprints(text, jsonb)', 'execute'), 'a browser may not');
select ok(not has_function_privilege('anon', 'public.record_source_fingerprints(text, jsonb)', 'execute'), 'anon may not');
select ok(not has_function_privilege('service_role', 'public.erase_source_fingerprints_on_derived_purge()', 'execute'),
  'the erase trigger is internal');

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1"}', true);
select throws_ok($$select 1 from public.source_fingerprints$$, '42501', null, 'a workspace owner cannot read fingerprints');
select throws_ok($$select 1 from public.document_relations$$, '42501', null, 'a workspace owner cannot read relations');
reset role;

set local role service_role;
select throws_ok($$select 1 from public.source_fingerprints$$, '42501', null, 'the server reads fingerprints only through the RPC');

-- ---------------------------------------------------------------------------
-- 2. Identical bytes, the same source twice, redelivery.
-- ---------------------------------------------------------------------------
select is(public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b',
  jsonb_build_array(public.b1_test_fp('0a000000-0000-4000-8000-00000000000a', 'a')))->'relations', '[]'::jsonb,
  'the first copy is nobody''s duplicate');

create temp table second_copy as select public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b',
  jsonb_build_array(public.b1_test_fp('0b000000-0000-4000-8000-00000000000b', 'a'))) as r;
select is((select r->'relations' from second_copy), jsonb_build_array(jsonb_build_object(
  'documentId', '0b000000-0000-4000-8000-00000000000b', 'relatedDocumentId', '0a000000-0000-4000-8000-00000000000a',
  'kind', 'exact_bytes', 'matchedOn', jsonb_build_array('sanitized_sha256', 'source_sha256'))),
  'identical bytes match on both digests');
select is(public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b',
  jsonb_build_array(public.b1_test_fp('0b000000-0000-4000-8000-00000000000b', 'a'))), (select r from second_copy),
  'a redelivered call returns the same answer');
select is(public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b',
  jsonb_build_array(public.b1_test_fp('0a000000-0000-4000-8000-00000000000a', 'a')))->'relations'->0->>'relatedDocumentId',
  '0b000000-0000-4000-8000-00000000000b', 'the original names its copy as well');

select is(public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b',
  jsonb_build_array(public.b1_test_fp('0d000000-0000-4000-8000-00000000000d', 'd')))->'relations',
  jsonb_build_array(
    jsonb_build_object('documentId', '0d000000-0000-4000-8000-00000000000d', 'relatedDocumentId', '0a000000-0000-4000-8000-00000000000a',
      'kind', 'exact_bytes', 'matchedOn', jsonb_build_array('source_sha256')),
    jsonb_build_object('documentId', '0d000000-0000-4000-8000-00000000000d', 'relatedDocumentId', '0b000000-0000-4000-8000-00000000000b',
      'kind', 'exact_bytes', 'matchedOn', jsonb_build_array('source_sha256'))),
  'the same source re-sanitized differently is found by its confirm digest alone');
select is(public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b',
  jsonb_build_array(public.b1_test_fp('0e000000-0000-4000-8000-00000000000e', 'e')))->'relations', '[]'::jsonb,
  'an unrelated document matches nothing');

-- ---------------------------------------------------------------------------
-- 3. Tenant isolation: A's exact bytes in another workspace.
-- ---------------------------------------------------------------------------
select is(public.record_source_fingerprints('pilot-c2c2c2c2c2c24c2c',
  jsonb_build_array(public.b1_test_fp('0c000000-0000-4000-8000-00000000000c', 'a')))->'relations', '[]'::jsonb,
  'the same bytes in another workspace are never a duplicate');

-- ---------------------------------------------------------------------------
-- 4. Refusals.
-- ---------------------------------------------------------------------------
select throws_ok($$select public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b', jsonb_build_array(
  jsonb_build_object('documentId', '0a000000-0000-4000-8000-00000000000a', 'sourceVersionId', repeat('a', 64),
                     'sanitizedSha256', 'sha256:' || repeat('f', 64))))$$,
  'P0001', 'source_fingerprint_request_invalid', 'a digest that is not the version key is refused');
select throws_ok($$select public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b', '[]'::jsonb)$$,
  'P0001', 'source_fingerprint_request_invalid', 'an empty call is refused');
select throws_ok($$select public.record_source_fingerprints('tenant-b1', jsonb_build_array(
  public.b1_test_fp('0a000000-0000-4000-8000-00000000000a', 'a')))$$,
  'P0001', 'source_fingerprint_request_invalid', 'a workspace key of the wrong shape is refused');
select throws_ok($$select public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b',
  (select jsonb_agg(public.b1_test_fp('0a000000-0000-4000-8000-00000000000a', 'a')) from generate_series(1, 129)))$$,
  'P0001', 'source_fingerprint_request_invalid', 'more than one compile''s worth of documents is refused');
reset role;

select throws_ok($$insert into public.source_fingerprints (workspace_key, document_id, source_version_id, sanitized_sha256, fingerprint_version)
  values ('pilot-b1b1b1b1b1b14b1b', '0f000000-0000-4000-8000-00000000000f', repeat('a', 64), 'sha256:' || repeat('b', 64), 'exact:v1')$$,
  '23514', null, 'a fingerprint whose version is not its sanitized digest cannot exist');
select throws_ok($$update public.document_relations set internal_score = 1 where kind = 'exact_bytes'$$,
  '23514', null, 'an exact relation never carries a score');
alter table public.foundation_intake_admissions disable trigger user;
update public.foundation_intake_admissions set source_sha256 = 'sha256:' || repeat('7', 64)
 where document_id = '0e000000-0000-4000-8000-00000000000e';
alter table public.foundation_intake_admissions enable trigger user;
set local role service_role;
select throws_ok($$select public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b',
  jsonb_build_array(public.b1_test_fp('0e000000-0000-4000-8000-00000000000e', 'e')))$$,
  'P0001', 'source_fingerprint_conflict', 'a recorded source digest that changed is an integrity fault');
reset role;

select is((select count(*)::integer from public.document_relations where workspace_key = 'pilot-b1b1b1b1b1b14b1b'), 6,
  'A<->B, D->A, D->B and their reverses: six rows, nothing written twice');
select is((select count(*)::integer from public.document_relations where workspace_key = 'pilot-c2c2c2c2c2c24c2c'), 0,
  'and none in the other workspace');

-- ---------------------------------------------------------------------------
-- 5. Deletion: A is deleted; B keeps its fingerprint, and nothing names A any more.
-- ---------------------------------------------------------------------------
create temp table request as select public.request_customer_source_deletion('pilot-b1b1b1b1b1b14b1b',
  '0a000000-0000-4000-8000-00000000000a', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'sha256:' || repeat('a', 64)) as r;
set local role service_role;
select is(public.record_source_fingerprints('pilot-b1b1b1b1b1b14b1b',
  jsonb_build_array(public.b1_test_fp('0b000000-0000-4000-8000-00000000000b', 'a')))->'relations',
  jsonb_build_array(jsonb_build_object('documentId', '0b000000-0000-4000-8000-00000000000b',
    'relatedDocumentId', '0d000000-0000-4000-8000-00000000000d', 'kind', 'exact_bytes', 'matchedOn', jsonb_build_array('source_sha256'))),
  'a document whose deletion was requested is nobody''s original');
reset role;

alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0a000000-0000-4000-8000-00000000000a';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;
select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array(jsonb_build_object('key', 'quarantine/pilot-b1b1b1b1b1b14b1b/0a000000-0000-4000-8000-00000000000a/source',
    'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10)));
select is(public.close_source_deletion_derived()->>'status', 'recorded', 'the derived closure records');

select is((select count(*)::integer from public.source_fingerprints
  where document_id = '0a000000-0000-4000-8000-00000000000a'), 0, 'the deleted document''s fingerprint is erased');
select is((select count(*)::integer from public.document_relations
  where '0a000000-0000-4000-8000-00000000000a' in (document_id, related_document_id)), 0, 'and every relation naming it');
select is((select count(*)::integer from public.source_fingerprints
  where document_id = '0b000000-0000-4000-8000-00000000000b'), 1, 'the surviving copy keeps its own fingerprint');

select * from finish();
rollback;
