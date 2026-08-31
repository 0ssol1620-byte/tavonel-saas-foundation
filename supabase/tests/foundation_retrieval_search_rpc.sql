-- Run with Supabase CLI db test after 0023_retrieval_search_rpc.sql.
--
-- This is the gate the TypeScript side cannot provide. retrieval-search-rpc-migration.test.ts
-- asserts the migration's TEXT, and lexical-search.ts / dense-search.ts have their own tests
-- for how a caller shapes a search -- but neither executes SQL. Everything below runs the two
-- RPCs against real rows: real tsvector matching, real pgvector distances, real failure modes.
--
-- Both functions are security definer with an empty search_path, so they are called here
-- exactly as the application calls them through PostgREST as service_role.
begin;
select plan(20);

-- ---------------------------------------------------------------------------------------
-- Existence and security posture
-- ---------------------------------------------------------------------------------------
select has_function(
  'public', 'search_foundation_retrieval_units_lexical',
  array['text', 'text', 'text[]', 'integer'],
  'lexical search RPC exists with the expected signature'
);
select has_function(
  'public', 'search_foundation_retrieval_units_dense',
  array['text', 'text', 'text', 'double precision[]', 'text', 'integer'],
  'dense search RPC exists with the expected signature'
);
select is(
  (select prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'search_foundation_retrieval_units_lexical'),
  true,
  'lexical RPC is security definer'
);
select is(
  (select prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'search_foundation_retrieval_units_dense'),
  true,
  'dense RPC is security definer'
);
-- Neither anon nor authenticated may execute these: the app reaches them as service_role
-- only, and a browser-reachable role must never be able to query another tenant's units.
select ok(
  not has_function_privilege('anon', 'public.search_foundation_retrieval_units_lexical(text, text, text[], integer)', 'execute'),
  'anon cannot execute the lexical RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.search_foundation_retrieval_units_dense(text, text, text, double precision[], text, integer)', 'execute'),
  'authenticated cannot execute the dense RPC'
);

-- ---------------------------------------------------------------------------------------
-- Fixture: two tenants, so cross-tenant isolation is actually exercised rather than assumed
-- ---------------------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '77777777-7777-7777-7777-777777777777',
  'authenticated', 'authenticated', 'search-rpc-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select public.promote_foundation_candidate(
  'pilot-searchrpc1', 'collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  'immutable/pilot-searchrpc1/pilot-searchrpc1/collections/collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/1111111111111111111111111111111111111111111111111111111111111111/candidate-world.json',
  'ws_candidate_searchrpc',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '77777777-7777-7777-7777-777777777777', null, 'Fixture world for search RPC tests'
);

-- Second tenant, its own world, its own units.
select public.promote_foundation_candidate(
  'pilot-searchrpc2', 'collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:3131313131313131313131313131313131313131313131313131313131313131',
  'immutable/pilot-searchrpc2/pilot-searchrpc2/collections/collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/3131313131313131313131313131313131313131313131313131313131313131/candidate-world.json',
  'ws_candidate_searchrpc_other',
  'sha256:4141414141414141414141414141414141414141414141414141414141414141',
  '77777777-7777-7777-7777-777777777777', null, 'Second tenant fixture world'
);

insert into public.foundation_retrieval_profiles (
  id, workspace_key, views, embedding, lexical, fusion, index_backend, index_metric,
  profile_digest, created_by
) values (
  'bge-m3-v1', 'pilot-searchrpc1', array['section'],
  '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
  '{"backend":"postgres_fts"}', '{"algorithm":"rrf","k":60}',
  'pgvector', 'cosine',
  'sha256:5151515151515151515151515151515151515151515151515151515151515151',
  '77777777-7777-7777-7777-777777777777'
),(
  'bge-m3-v1', 'pilot-searchrpc2', array['section'],
  '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
  '{"backend":"postgres_fts"}', '{"algorithm":"rrf","k":60}',
  'pgvector', 'cosine',
  'sha256:6161616161616161616161616161616161616161616161616161616161616161',
  '77777777-7777-7777-7777-777777777777'
);

insert into public.foundation_retrieval_compile_runs (
  run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status
) values (
  'retrieval-run-' || repeat('a', 32), 'pilot-searchrpc1', 'collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111', 'bge-m3-v1', 'completed'
),(
  'retrieval-run-' || repeat('b', 32), 'pilot-searchrpc2', 'collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:3131313131313131313131313131313131313131313131313131313131313131', 'bge-m3-v1', 'completed'
);

-- Tenant 1: three units. Unit 1 and 2 both carry 'payment'; unit 2 carries it twice so
-- ts_rank_cd has a real reason to order it first (the ordering assertion below must not be
-- satisfiable by insertion order or by unit_id, which is the tie-break).
insert into public.foundation_retrieval_units (
  unit_id, workspace_key, compile_run_id, unit_type, document_id, document_version_key,
  text, content_digest, search_tokens
) values (
  'retrieval-unit-' || repeat('1', 32), 'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32),
  'section', 'doc-1', repeat('c', 64), 'Payment terms are net 30 days.',
  'sha256:7171717171717171717171717171717171717171717171717171717171717171',
  array['payment', 'terms', 'net', '30', 'days']
),(
  'retrieval-unit-' || repeat('2', 32), 'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32),
  'section', 'doc-1', repeat('c', 64), 'Payment schedule and payment method.',
  'sha256:8181818181818181818181818181818181818181818181818181818181818181',
  array['payment', 'schedule', 'payment', 'method']
),(
  'retrieval-unit-' || repeat('3', 32), 'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32),
  'section', 'doc-2', repeat('d', 64), '계약 해지 통보 기간은 30일입니다.',
  'sha256:9191919191919191919191919191919191919191919191919191919191919191',
  array['계약', '해지', '통보', '기간', '30일']
);

-- Tenant 2: a unit that WOULD match tenant 1's query if scoping failed.
insert into public.foundation_retrieval_units (
  unit_id, workspace_key, compile_run_id, unit_type, document_id, document_version_key,
  text, content_digest, search_tokens
) values (
  'retrieval-unit-' || repeat('9', 32), 'pilot-searchrpc2', 'retrieval-run-' || repeat('b', 32),
  'section', 'doc-x', repeat('e', 64), 'Payment obligations of the other tenant.',
  'sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
  array['payment', 'obligations', 'other', 'tenant']
);

insert into public.foundation_retrieval_embeddings (
  workspace_key, unit_id, retrieval_profile_id, dimension, embedding
) values
  ('pilot-searchrpc1', 'retrieval-unit-' || repeat('1', 32), 'bge-m3-v1', 3, '[1,0,0]'),
  ('pilot-searchrpc1', 'retrieval-unit-' || repeat('2', 32), 'bge-m3-v1', 3, '[0,1,0]'),
  ('pilot-searchrpc1', 'retrieval-unit-' || repeat('3', 32), 'bge-m3-v1', 3, '[0,0,1]'),
  ('pilot-searchrpc2', 'retrieval-unit-' || repeat('9', 32), 'bge-m3-v1', 3, '[1,0,0]');

-- ---------------------------------------------------------------------------------------
-- Lexical RPC behaviour
-- ---------------------------------------------------------------------------------------
select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_lexical(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), array['payment'], 10)),
  2,
  'lexical search returns exactly the units whose search_tokens contain the query token'
);

-- The cross-tenant unit also contains 'payment'. If workspace scoping were broken this
-- would return 3, not 2 -- which is why the fixture plants it.
select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_lexical(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), array['payment'], 10)
   where unit_id = 'retrieval-unit-' || repeat('9', 32)),
  0,
  'lexical search never returns another tenant unit that matches the same token'
);

select is(
  (select unit_id from public.search_foundation_retrieval_units_lexical(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), array['payment'], 10) limit 1),
  'retrieval-unit-' || repeat('2', 32),
  'ts_rank_cd orders the denser match first, not insertion order or unit_id'
);

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_lexical(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), array['계약', '해지'], 10)),
  1,
  'Korean pre-tokenized terms match through to_tsquery(simple) as the compiler wrote them'
);

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_lexical(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), array['payment', 'nonexistentterm'], 10)),
  2,
  'multiple tokens are OR-ed: an absent token does not suppress a present one'
);

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_lexical(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), array['payment'], 1)),
  1,
  'the limit argument actually bounds the result set'
);

-- A token carrying tsquery operator syntax must be filtered out by the function itself, not
-- passed to the parser. With no safe token left, this must raise rather than return rows or
-- let the operator through.
select throws_ok(
  $$select * from public.search_foundation_retrieval_units_lexical(
      'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), array['payment | 1:1'], 10)$$,
  'retrieval_lexical_search_requires_safe_token',
  'a token containing tsquery syntax is rejected, never parsed as an operator'
);

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_lexical(
      'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), array['payment'], 5000)$$,
  'retrieval_lexical_search_limit_out_of_bounds',
  'an unbounded scan cannot be requested through the limit argument'
);

-- ---------------------------------------------------------------------------------------
-- Dense RPC behaviour
-- ---------------------------------------------------------------------------------------
-- Query vector [1,0,0] is identical to unit 1's embedding, so cosine distance 0 puts it
-- first; unit 2 and 3 are orthogonal (distance 1).
select is(
  (select unit_id from public.search_foundation_retrieval_units_dense(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), 'bge-m3-v1',
    array[1, 0, 0]::double precision[], 'cosine', 10) limit 1),
  'retrieval-unit-' || repeat('1', 32),
  'cosine search returns the nearest unit first'
);

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_dense(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), 'bge-m3-v1',
    array[1, 0, 0]::double precision[], 'cosine', 10)
   where unit_id = 'retrieval-unit-' || repeat('9', 32)),
  0,
  'dense search never returns another tenant unit despite an identical embedding'
);

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_dense(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), 'bge-m3-v1',
    array[1, 0, 0]::double precision[], 'l2', 10)),
  3,
  'the l2 metric path executes and returns the compile run''s units'
);

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_dense(
    'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), 'bge-m3-v1',
    array[1, 0, 0]::double precision[], 'inner_product', 10)),
  3,
  'the inner_product metric path executes and returns the compile run''s units'
);

-- The guard that matters most: a 5D query against a 3D stored space is not comparable, and
-- must fail rather than produce a distance anyone could act on.
select throws_ok(
  $$select * from public.search_foundation_retrieval_units_dense(
      'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), 'bge-m3-v1',
      array[1, 0, 0, 0, 0]::double precision[], 'cosine', 10)$$,
  'retrieval_dense_search_dimension_mismatch: stored 3 vs query 5',
  'an incompatible embedding space fails closed instead of returning a distance'
);

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_dense(
      'pilot-searchrpc1', 'retrieval-run-' || repeat('a', 32), 'bge-m3-v1',
      array[1, 0, 0]::double precision[], 'euclidean', 10)$$,
  'retrieval_dense_search_unknown_metric',
  'an unrecognised metric is rejected rather than silently defaulted'
);

select * from finish();
rollback;
