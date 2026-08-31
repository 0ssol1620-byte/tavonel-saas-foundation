-- Run with Supabase CLI db test after 0022_retrieval_lexical_search.sql.
begin;
select plan(6);

select has_column('public', 'foundation_retrieval_units', 'search_tokens', 'search_tokens column exists');
select has_column('public', 'foundation_retrieval_units', 'search_vector', 'search_vector column exists');
select has_index('public', 'foundation_retrieval_units', 'foundation_retrieval_units_search_vector_idx', 'GIN index on search_vector exists');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '66666666-6666-6666-6666-666666666666',
  'authenticated', 'authenticated', 'lexical-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select public.promote_foundation_candidate(
  'pilot-lexicaltest1', 'collection-cccccccccccccccccccccccccccccccc',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  'immutable/pilot-lexicaltest1/pilot-lexicaltest1/collections/collection-cccccccccccccccccccccccccccccccc/1111111111111111111111111111111111111111111111111111111111111111/candidate-world.json',
  'ws_candidate_lexical',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '66666666-6666-6666-6666-666666666666', null, 'Fixture world for lexical search tests'
);

insert into public.foundation_retrieval_profiles (
  id, workspace_key, views, embedding, lexical, fusion, index_backend, index_metric,
  profile_digest, created_by
) values (
  'bge-m3-v1', 'pilot-lexicaltest1', array['section'],
  '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
  '{"backend":"postgres_fts"}', '{"algorithm":"rrf","k":60}',
  'pgvector', 'cosine',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '66666666-6666-6666-6666-666666666666'
);

insert into public.foundation_retrieval_compile_runs (
  run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status
) values (
  'retrieval-run-' || repeat('d', 32), 'pilot-lexicaltest1', 'collection-cccccccccccccccccccccccccccccccc',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111', 'bge-m3-v1', 'pending'
);

insert into public.foundation_retrieval_units (
  unit_id, workspace_key, compile_run_id, unit_type, document_id, document_version_key,
  text, content_digest, search_tokens
) values (
  'retrieval-unit-' || repeat('e', 32), 'pilot-lexicaltest1', 'retrieval-run-' || repeat('d', 32),
  'section', 'doc-1', repeat('c', 64), 'Payment terms are net 30 days.',
  'sha256:5555555555555555555555555555555555555555555555555555555555555555',
  array['payment', 'terms', 'net', '30', 'days']
),(
  'retrieval-unit-' || repeat('f', 32), 'pilot-lexicaltest1', 'retrieval-run-' || repeat('d', 32),
  'section', 'doc-1', repeat('c', 64), '삼성전자는 이번 분기 매출이 증가했다.',
  'sha256:6666666666666666666666666666666666666666666666666666666666666666',
  array['삼성전자', '이번', '분기', '매출', '증가']
);

select is(
  (select count(*)::integer from public.foundation_retrieval_units
   where workspace_key = 'pilot-lexicaltest1'
     and search_vector @@ to_tsquery('simple', 'payment')),
  1,
  'English token search matches the unit whose search_tokens contain it'
);

select is(
  (select count(*)::integer from public.foundation_retrieval_units
   where workspace_key = 'pilot-lexicaltest1'
     and search_vector @@ to_tsquery('simple', '매출')),
  1,
  'Korean token search matches the unit whose pre-tokenized search_tokens contain it'
);

select is(
  (select count(*)::integer from public.foundation_retrieval_units
   where workspace_key = 'pilot-lexicaltest1'
     and search_vector @@ to_tsquery('simple', 'nonexistentterm')),
  0,
  'a token absent from every unit matches nothing'
);

select * from finish();
rollback;
