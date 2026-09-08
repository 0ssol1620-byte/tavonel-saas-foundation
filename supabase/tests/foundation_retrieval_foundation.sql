-- Run with Supabase CLI db test after 0020_retrieval_foundation.sql.
begin;
select plan(20);

select has_table('public', 'foundation_retrieval_profiles', 'retrieval profiles table exists');
select has_table('public', 'foundation_retrieval_compile_runs', 'retrieval compile runs table exists');
select has_table('public', 'foundation_retrieval_units', 'retrieval units table exists');
select has_table('public', 'foundation_retrieval_embeddings', 'retrieval embeddings table exists');

select ok((select relrowsecurity from pg_class where oid = 'public.foundation_retrieval_profiles'::regclass), 'profiles have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_retrieval_compile_runs'::regclass), 'compile runs have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_retrieval_units'::regclass), 'units have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_retrieval_embeddings'::regclass), 'embeddings have RLS');

select ok(not has_table_privilege('anon', 'public.foundation_retrieval_profiles', 'select'), 'anonymous clients cannot read retrieval profiles');
select ok(not has_table_privilege('authenticated', 'public.foundation_retrieval_embeddings', 'select'), 'authenticated clients cannot bypass the retrieval compile API');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '55555555-5555-5555-5555-555555555555',
  'authenticated', 'authenticated', 'retrieval-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select is(
  public.promote_foundation_candidate(
    'pilot-retrievtest01', 'collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'immutable/pilot-retrievtest01/pilot-retrievtest01/collections/collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/1111111111111111111111111111111111111111111111111111111111111111/candidate-world.json',
    'ws_candidate_retrieval',
    'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    '55555555-5555-5555-5555-555555555555', null, 'Fixture world for retrieval foundation tests'
  ) ->> 'status',
  'active',
  'fixture world is promoted before retrieval compilation'
);

insert into public.foundation_retrieval_profiles (
  id, workspace_key, views, embedding, lexical, fusion, reranker, index_backend, index_metric,
  profile_digest, created_by
) values (
  'bge-m3-v1', 'pilot-retrievtest01', array['section', 'claim', 'entity', 'table'],
  '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
  '{"backend":"postgres_fts"}', '{"algorithm":"rrf","k":60}',
  '{"provider":"huggingface","model":"BAAI/bge-reranker-v2-m3","revision":"fixture"}',
  'pgvector', 'cosine',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '55555555-5555-5555-5555-555555555555'
);
select is((select count(*)::integer from public.foundation_retrieval_profiles), 1, 'baseline retrieval profile is stored');

select throws_ok(
  $$insert into public.foundation_retrieval_profiles (
    id, workspace_key, views, embedding, lexical, fusion, index_backend, index_metric,
    profile_digest, created_by
  ) values (
    'bad-fusion-v1', 'pilot-retrievtest01', array['section'],
    '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
    '{"backend":"postgres_fts"}', '{"algorithm":"weighted-sum","k":60}',
    'pgvector', 'cosine',
    'sha256:4444444444444444444444444444444444444444444444444444444444444444',
    '55555555-5555-5555-5555-555555555555'
  )$$,
  '23514', null,
  'retrieval profile fusion algorithm is locked to rrf for v1'
);

insert into public.foundation_retrieval_compile_runs (
  run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status
) values (
  'retrieval-run-' || repeat('a', 32), 'pilot-retrievtest01', 'collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111', 'bge-m3-v1', 'pending'
);
select throws_ok(
  $$update public.foundation_retrieval_compile_runs set status = 'completed'
    where run_id = 'retrieval-run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'$$,
  '23514', null,
  'a completed run must record its completion time and unit count'
);
update public.foundation_retrieval_compile_runs
  set status = 'completed', completed_at = now(), unit_count = 1, embedding_count = 1
  where run_id = 'retrieval-run-' || repeat('a', 32);
select is((select status from public.foundation_retrieval_compile_runs where run_id = 'retrieval-run-' || repeat('a', 32)), 'completed', 'compile run reaches completed status');

insert into public.foundation_retrieval_units (
  unit_id, workspace_key, compile_run_id, unit_type, document_id, document_version_key,
  text, page_number1, bbox1000, content_digest
) values (
  'retrieval-unit-' || repeat('b', 32), 'pilot-retrievtest01', 'retrieval-run-' || repeat('a', 32),
  'section', 'doc-1', repeat('c', 64), 'Payment terms are net 30 days.', 1, array[100, 100, 900, 300],
  'sha256:5555555555555555555555555555555555555555555555555555555555555555'
);
select is((select count(*)::integer from public.foundation_retrieval_units), 1, 'retrieval unit is stored under its compile run');

select throws_ok(
  $$insert into public.foundation_retrieval_embeddings (
    workspace_key, unit_id, retrieval_profile_id, dimension, embedding
  ) values (
    'pilot-retrievtest01', 'retrieval-unit-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'bge-m3-v1', 3, '[0.1,0.2]'::vector
  )$$,
  '23514', null,
  'an embedding whose vector length disagrees with its declared dimension is rejected'
);
insert into public.foundation_retrieval_embeddings (
  workspace_key, unit_id, retrieval_profile_id, dimension, embedding
) values (
  'pilot-retrievtest01', 'retrieval-unit-' || repeat('b', 32), 'bge-m3-v1', 3, '[0.1,0.2,0.3]'::vector
);
select is((select count(*)::integer from public.foundation_retrieval_embeddings), 1, 'embedding matching the profile dimension is stored');

delete from public.foundation_retrieval_compile_runs where run_id = 'retrieval-run-' || repeat('a', 32);
select is((select count(*)::integer from public.foundation_retrieval_units), 0, 'deleting a compile run cascades to its retrieval units');
select is((select count(*)::integer from public.foundation_retrieval_embeddings), 0, 'deleting a compile run cascades to its embeddings, leaving only the world version to recompile from');

select * from finish();
rollback;
