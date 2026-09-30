-- Gate 11 (migration 20260927104000): the derived closure erases only the retrieval rows a deleted
-- document provably owns, keeps another document's rows and every World/provenance row, never runs
-- before attestation or during a retrieval compile, and records one append-only receipt.
--
-- The auth.users insert bootstraps the self-service workspace pilot-e5e5e5e5e5e54e5e
-- (20260920121000); with no operator hold its legal-hold state is 'inactive'.
begin;
select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values ('00000000-0000-0000-0000-000000000000', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'authenticated', 'authenticated',
  'derived-closure-1@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
) values ('pilot-e5e5e5e5e5e54e5e', '0e000000-0000-4000-8000-00000000000a', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5',
  'quarantine/pilot-e5e5e5e5e5e54e5e/0e000000-0000-4000-8000-00000000000a/source', 10, 'application/pdf',
  now(), now(), now() + interval '10 minutes', now());

-- One World compiled from the deleted document (A) and another document (B).
select public.promote_foundation_candidate(
  'pilot-e5e5e5e5e5e54e5e', 'collection-' || repeat('e', 32), 'sha256:' || repeat('1', 64),
  'immutable/pilot-e5e5e5e5e5e54e5e/pilot-e5e5e5e5e5e54e5e/collections/collection-' || repeat('e', 32)
    || '/' || repeat('1', 64) || '/candidate-world.json',
  'ws_candidate_derived', 'sha256:' || repeat('2', 64),
  'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', null, 'Fixture world for derived closure');
insert into public.foundation_retrieval_profiles (
  id, workspace_key, views, embedding, lexical, fusion, index_backend, index_metric, profile_digest, created_by
) values ('bge-m3-v1', 'pilot-e5e5e5e5e5e54e5e', array['section', 'claim', 'entity', 'summary'],
  '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
  '{"backend":"postgres_fts"}', '{"algorithm":"rrf","k":60}', 'pgvector', 'cosine',
  'sha256:' || repeat('3', 64), 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5');
insert into public.foundation_retrieval_compile_runs (
  run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status,
  completed_at, unit_count, embedding_count
) values ('retrieval-run-' || repeat('e', 32), 'pilot-e5e5e5e5e5e54e5e', 'collection-' || repeat('e', 32),
  'sha256:' || repeat('1', 64), 'bge-m3-v1', 'completed', now(), 5, 2);

-- A: section (upper-case id, as a foreign producer might write it), claim, entity, and a summary
-- whose ownership is not provable. B: one section.
insert into public.foundation_retrieval_units (
  unit_id, workspace_key, compile_run_id, unit_type, document_id, document_version_key, text, content_digest
) values
  ('retrieval-unit-' || repeat('1', 32), 'pilot-e5e5e5e5e5e54e5e', 'retrieval-run-' || repeat('e', 32), 'section',
    '0E000000-0000-4000-8000-00000000000A', repeat('a', 64), 'A section', 'sha256:' || repeat('4', 64)),
  ('retrieval-unit-' || repeat('2', 32), 'pilot-e5e5e5e5e5e54e5e', 'retrieval-run-' || repeat('e', 32), 'claim',
    '0e000000-0000-4000-8000-00000000000a', repeat('a', 64), 'A claim', 'sha256:' || repeat('5', 64)),
  ('retrieval-unit-' || repeat('3', 32), 'pilot-e5e5e5e5e5e54e5e', 'retrieval-run-' || repeat('e', 32), 'entity',
    '0e000000-0000-4000-8000-00000000000a', repeat('a', 64), 'Acme', 'sha256:' || repeat('6', 64)),
  ('retrieval-unit-' || repeat('4', 32), 'pilot-e5e5e5e5e5e54e5e', 'retrieval-run-' || repeat('e', 32), 'summary',
    '0e000000-0000-4000-8000-00000000000a', repeat('a', 64), 'A and B summary', 'sha256:' || repeat('7', 64)),
  ('retrieval-unit-' || repeat('5', 32), 'pilot-e5e5e5e5e5e54e5e', 'retrieval-run-' || repeat('e', 32), 'section',
    '0b000000-0000-4000-8000-00000000000b', repeat('b', 64), 'B section', 'sha256:' || repeat('8', 64));
insert into public.foundation_retrieval_embeddings (workspace_key, unit_id, retrieval_profile_id, dimension, embedding)
values ('pilot-e5e5e5e5e5e54e5e', 'retrieval-unit-' || repeat('1', 32), 'bge-m3-v1', 3, '[1,0,0]'),
       ('pilot-e5e5e5e5e5e54e5e', 'retrieval-unit-' || repeat('5', 32), 'bge-m3-v1', 3, '[0,1,0]');

-- One expired and one live cached Ask response.
insert into public.foundation_operation_leases
  (workspace_key, operation_scope, owner_token, request_key, body_digest, state, response_ciphertext, expires_at)
values ('pilot-e5e5e5e5e5e54e5e', 'ask', gen_random_uuid(), repeat('1', 64), repeat('2', 64), 'completed',
          repeat('x', 40), now() - interval '1 minute'),
       ('pilot-e5e5e5e5e5e54e5e', 'ask', gen_random_uuid(), repeat('3', 64), repeat('4', 64), 'completed',
          repeat('y', 40), now() + interval '5 minutes');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.close_source_deletion_derived()', 'execute'),
  'browsers cannot run the closure');
select ok(has_function_privilege('service_role', 'public.close_source_deletion_derived()', 'execute'),
  'the deletion worker can');
select ok(not has_function_privilege('service_role', 'public.source_deletion_exclusive_unit_types()', 'execute'),
  'the ownership rule is internal');

-- ---------------------------------------------------------------------------
-- Nothing happens before eligibility and attestation
-- ---------------------------------------------------------------------------
create temp table request as select public.request_customer_source_deletion('pilot-e5e5e5e5e5e54e5e',
  '0e000000-0000-4000-8000-00000000000a', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'sha256:' || repeat('a', 64)) as r;
select is(public.close_source_deletion_derived()->>'status', 'idle', 'a grace-period tombstone is not closed');

alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0e000000-0000-4000-8000-00000000000a';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;
select is(public.close_source_deletion_derived()->>'status', 'idle', 'an unattested tombstone is not closed');

select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array(jsonb_build_object('key', 'quarantine/pilot-e5e5e5e5e5e54e5e/0e000000-0000-4000-8000-00000000000a/source',
    'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10)));

-- A retrieval compile in flight holds the closure back.
insert into public.foundation_retrieval_compile_runs (
  run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status
) values ('retrieval-run-' || repeat('f', 32), 'pilot-e5e5e5e5e5e54e5e', 'collection-' || repeat('e', 32),
  'sha256:' || repeat('1', 64), 'bge-m3-v1', 'running');
select is(public.close_source_deletion_derived()->>'status', 'idle', 'a running retrieval compile defers the closure');
update public.foundation_retrieval_compile_runs set status = 'failed', completed_at = now(), error_reason = 'fixture'
 where run_id = 'retrieval-run-' || repeat('f', 32);

-- ---------------------------------------------------------------------------
-- The closure
-- ---------------------------------------------------------------------------
create temp table closed as select public.close_source_deletion_derived() as r;
select is((select r->>'status' from closed), 'recorded', 'the closure records');
select is((select (r->>'retrievalUnitsErased')::integer from closed), 3, 'section, claim and entity units of A are erased');
select is((select (r->>'retrievalEmbeddingsErased')::integer from closed), 1, 'with their embeddings');
select is((select (r->>'retrievalUnitsRetainedUnproven')::integer from closed), 1, 'the summary is counted as retained');
select is((select (r->>'indexedWorldVersionsRetained')::integer from closed), 1, 'the indexed shared World is counted as retained');
select is((select (r->>'expiredWorkspaceCacheRowsErased')::integer from closed), 1, 'the expired workspace cache row is erased');

select is((select array_agg(unit_id order by unit_id) from public.foundation_retrieval_units
  where workspace_key = 'pilot-e5e5e5e5e5e54e5e'),
  array['retrieval-unit-' || repeat('4', 32), 'retrieval-unit-' || repeat('5', 32)],
  'the unproven unit and the other document''s unit remain');
select is((select count(*)::integer from public.foundation_retrieval_embeddings
  where workspace_key = 'pilot-e5e5e5e5e5e54e5e'), 1, 'the other document''s embedding remains');
select is((select count(*)::integer from public.foundation_operation_leases
  where workspace_key = 'pilot-e5e5e5e5e5e54e5e'), 1, 'the live cache row remains');
select is((select count(*)::integer from public.foundation_world_versions
  where workspace_key = 'pilot-e5e5e5e5e5e54e5e'), 1, 'World provenance is untouched');

-- ---------------------------------------------------------------------------
-- Receipt, status, idempotency
-- ---------------------------------------------------------------------------
select is(public.close_source_deletion_derived()->>'status', 'idle', 'a closed deletion is not closed twice');
create temp table status_after as
  select public.customer_source_deletion_status('pilot-e5e5e5e5e5e54e5e', '0e000000-0000-4000-8000-00000000000a')->'derived' as d;
select is((select d->>'receiptId' from status_after), (select r->>'receiptId' from closed),
  'the customer status names the closure receipt');
select is((select (d->>'retrievalUnitsRemaining')::integer from status_after), 1,
  'and reads the retained unit live');
select throws_ok($$delete from public.source_deletion_receipts where action = 'derived_purged'$$,
  'P0001', 'source_deletion_evidence_append_only', 'the closure receipt is append-only');

select * from finish();
rollback;
