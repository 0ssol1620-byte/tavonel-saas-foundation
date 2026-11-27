-- Run with Supabase CLI db test after 20261127040000_scoped_retrieval_search_rpc.sql (WO-PROJ-K2-E2).
--
-- The three scoped retrieval functions, executed against real rows, as service_role calls them.
-- Fixture: tenant 1, run A, documents doc-1 (admitted) and doc-2 (hidden). doc-2's units outrank
-- doc-1's for the query and carry an embedding identical to the query vector, so any leak shows up
-- as a row. Tenant 2 holds doc-x, which matches the same query.
--
-- "Rows examined does not depend on hidden documents" is measured, not argued. The transaction-local
-- statistics counters (pg_stat_get_xact_tuples_returned / _fetched, the functions behind
-- pg_stat_xact_user_tables: seq_tup_read, idx_tup_fetch; and, on an index, idx_tup_read) count the
-- tuples this backend has read from each relation so far in this transaction. pg_temp.examined(sql)
-- sums them over the retrieval units and embeddings tables and every index on them, before and
-- after running sql. Each scoped function is measured, then three batches of forty hidden units that
-- match the query (with embeddings) are added to doc-2 in the same run, their ids sorting first, in
-- the middle and last, with a measurement after each: all four numbers must be equal. The unscoped
-- 0023 lexical RPC is measured the same way and must GROW at every step, which shows the instrument
-- would have seen a scan that visited hidden rows. The counters count index entries RETURNED, not
-- entries a btree visits and rejects inside one scan.
begin;
select plan(31);

-- ---------------------------------------------------------------------------------------
-- Existence, security posture, grants
-- ---------------------------------------------------------------------------------------
select ok(to_regprocedure('public.search_foundation_retrieval_units_lexical_scoped(text, text, text[], text[], integer)') is not null,
  'scoped lexical RPC exists with the expected signature');
select ok(to_regprocedure('public.search_foundation_retrieval_units_dense_scoped(text, text, text, double precision[], text, text[], integer)') is not null,
  'scoped dense RPC exists with the expected signature');
select ok(to_regprocedure('public.foundation_retrieval_structure_candidates_scoped(text, text, text[], integer)') is not null,
  'scoped structure RPC exists with the expected signature');

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('search_foundation_retrieval_units_lexical_scoped', 'search_foundation_retrieval_units_dense_scoped',
                        'foundation_retrieval_structure_candidates_scoped')
      and p.prosecdef and 'search_path=""' = any(p.proconfig)
      and 'enable_seqscan=off' = any(p.proconfig) and 'enable_bitmapscan=off' = any(p.proconfig)
     ),
  3,
  'all three are security definer, with an empty search_path and both planner pins');

select is(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like '%\_scoped' or p.proname = 'foundation_retrieval_scope_keys')
      and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  'foundation_retrieval_structure_candidates_scoped,search_foundation_retrieval_units_dense_scoped,search_foundation_retrieval_units_lexical_scoped',
  'service_role executes the three scoped RPCs, and not the list-check helper');

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) as r(role)
    where n.nspname = 'public' and (p.proname like '%\_scoped' or p.proname = 'foundation_retrieval_scope_keys')
      and has_function_privilege(r.role, p.oid, 'EXECUTE')),
  0,
  'neither anon nor authenticated can execute any scoped retrieval function');

-- ---------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '78787878-7878-7878-7878-787878787878',
  'authenticated', 'authenticated', 'scoped-rpc-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select public.promote_foundation_candidate(
  'pilot-scoped1', 'collection-cccccccccccccccccccccccccccccccc',
  'sha256:1212121212121212121212121212121212121212121212121212121212121212',
  'immutable/pilot-scoped1/pilot-scoped1/collections/collection-cccccccccccccccccccccccccccccccc/1212121212121212121212121212121212121212121212121212121212121212/candidate-world.json',
  'ws_candidate_scoped',
  'sha256:2323232323232323232323232323232323232323232323232323232323232323',
  '78787878-7878-7878-7878-787878787878', null, 'Fixture world for scoped search RPC tests'
);
select public.promote_foundation_candidate(
  'pilot-scoped2', 'collection-dddddddddddddddddddddddddddddddd',
  'sha256:3434343434343434343434343434343434343434343434343434343434343434',
  'immutable/pilot-scoped2/pilot-scoped2/collections/collection-dddddddddddddddddddddddddddddddd/3434343434343434343434343434343434343434343434343434343434343434/candidate-world.json',
  'ws_candidate_scoped_other',
  'sha256:4545454545454545454545454545454545454545454545454545454545454545',
  '78787878-7878-7878-7878-787878787878', null, 'Second tenant for scoped search RPC tests'
);

insert into public.foundation_retrieval_profiles (
  id, workspace_key, views, embedding, lexical, fusion, index_backend, index_metric, profile_digest, created_by
) values (
  'bge-m3-v1', 'pilot-scoped1', array['section'],
  '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
  '{"backend":"postgres_fts"}', '{"algorithm":"rrf","k":60}', 'pgvector', 'cosine',
  'sha256:5656565656565656565656565656565656565656565656565656565656565656', '78787878-7878-7878-7878-787878787878'
),(
  'bge-m3-v1', 'pilot-scoped2', array['section'],
  '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
  '{"backend":"postgres_fts"}', '{"algorithm":"rrf","k":60}', 'pgvector', 'cosine',
  'sha256:6767676767676767676767676767676767676767676767676767676767676767', '78787878-7878-7878-7878-787878787878'
);

insert into public.foundation_retrieval_compile_runs (
  run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status,
  completed_at, unit_count, embedding_count
) values (
  'retrieval-run-' || repeat('c', 32), 'pilot-scoped1', 'collection-cccccccccccccccccccccccccccccccc',
  'sha256:1212121212121212121212121212121212121212121212121212121212121212', 'bge-m3-v1', 'completed', now(), 4, 4
),(
  'retrieval-run-' || repeat('d', 32), 'pilot-scoped2', 'collection-dddddddddddddddddddddddddddddddd',
  'sha256:3434343434343434343434343434343434343434343434343434343434343434', 'bge-m3-v1', 'completed', now(), 1, 1
);

-- doc-1 (admitted): two 'payment' units at different densities, one without the term.
-- doc-2 (hidden): one unit with 'payment' three times, the best lexical match in the run.
insert into public.foundation_retrieval_units (
  unit_id, workspace_key, compile_run_id, unit_type, document_id, document_version_key, text, content_digest,
  search_tokens, claim_ids, entity_ids
) values
  ('retrieval-unit-' || repeat('1', 32), 'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'section', 'doc-1',
   repeat('c', 64), 'Payment terms are net 30 days.', 'sha256:' || repeat('7', 64),
   array['payment', 'terms', 'net', '30', 'days'], array['claim-a'], array['entity-a']),
  ('retrieval-unit-' || repeat('2', 32), 'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'section', 'doc-1',
   repeat('c', 64), 'Payment schedule and payment method.', 'sha256:' || repeat('8', 64),
   array['payment', 'schedule', 'payment', 'method'], array['claim-a'], array['entity-b']),
  ('retrieval-unit-' || repeat('3', 32), 'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'section', 'doc-1',
   repeat('c', 64), 'Notice period is 60 days.', 'sha256:' || repeat('9', 64),
   array['notice', 'period', '60', 'days'], array[]::text[], array[]::text[]),
  ('retrieval-unit-' || repeat('4', 32), 'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'section', 'doc-2',
   repeat('d', 64), 'Payment payment payment, the hidden codename.', 'sha256:' || repeat('a', 64),
   array['payment', 'payment', 'payment', 'codename'], array['claim-a'], array['entity-a']);

insert into public.foundation_retrieval_units (
  unit_id, workspace_key, compile_run_id, unit_type, document_id, document_version_key, text, content_digest, search_tokens
) values (
  'retrieval-unit-' || repeat('9', 32), 'pilot-scoped2', 'retrieval-run-' || repeat('d', 32), 'section', 'doc-x',
  repeat('e', 64), 'Payment obligations of the other tenant.', 'sha256:' || repeat('b', 64),
  array['payment', 'obligations', 'other', 'tenant']
);

insert into public.foundation_retrieval_embeddings (workspace_key, unit_id, retrieval_profile_id, dimension, embedding) values
  ('pilot-scoped1', 'retrieval-unit-' || repeat('1', 32), 'bge-m3-v1', 3, '[0.9,0.1,0]'),
  ('pilot-scoped1', 'retrieval-unit-' || repeat('2', 32), 'bge-m3-v1', 3, '[0,1,0]'),
  ('pilot-scoped1', 'retrieval-unit-' || repeat('3', 32), 'bge-m3-v1', 3, '[0,0,1]'),
  ('pilot-scoped1', 'retrieval-unit-' || repeat('4', 32), 'bge-m3-v1', 3, '[1,0,0]'),
  ('pilot-scoped2', 'retrieval-unit-' || repeat('9', 32), 'bge-m3-v1', 3, '[1,0,0]');

-- Tuples read from the two retrieval tables (and their indexes) by `sql`, in this backend.
create function pg_temp.reads() returns bigint language sql as $$
  select coalesce(sum(pg_stat_get_xact_tuples_returned(r.oid) + pg_stat_get_xact_tuples_fetched(r.oid)), 0)::bigint
  from (select c.oid from pg_class c
         where c.oid in ('public.foundation_retrieval_units'::regclass, 'public.foundation_retrieval_embeddings'::regclass)
        union all
        select i.indexrelid from pg_index i
         where i.indrelid in ('public.foundation_retrieval_units'::regclass, 'public.foundation_retrieval_embeddings'::regclass)) as r(oid)
$$;
create function pg_temp.examined(p_sql text) returns bigint language plpgsql as $$
declare
  v_before bigint := pg_temp.reads();
  v_rows bigint;
begin
  execute 'select count(*) from (' || p_sql || ') as measured' into v_rows;
  return pg_temp.reads() - v_before;
end;
$$;
create temporary table scoped_reads (probe text, stage integer, reads bigint, primary key (probe, stage)) on commit drop;

-- ---------------------------------------------------------------------------------------
-- Lexical
-- ---------------------------------------------------------------------------------------
select is(
  (select array_agg(s.unit_id order by s.unit_id) from public.search_foundation_retrieval_units_lexical_scoped(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], array['doc-1'], 10) s),
  array['retrieval-unit-' || repeat('1', 32), 'retrieval-unit-' || repeat('2', 32)],
  'scoped lexical returns the admitted matches only: the hidden best match is absent');

-- Rank is per unit (ts_rank_cd), so the admitted order and scores must be exactly the unscoped
-- run's with the hidden rows removed: what a run holding only doc-1 would rank.
select is(
  (select array_agg(s.unit_id || ':' || s.rank::text order by s.ord) from public.search_foundation_retrieval_units_lexical_scoped(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment', 'notice'], array['doc-1'], 10) with ordinality as s(unit_id, rank, ord)),
  (select array_agg(s.unit_id || ':' || s.rank::text order by s.ord) from public.search_foundation_retrieval_units_lexical(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment', 'notice'], 500) with ordinality as s(unit_id, rank, ord)
    join public.foundation_retrieval_units u on u.workspace_key = 'pilot-scoped1' and u.unit_id = s.unit_id
   where u.document_id = 'doc-1'),
  'scoped lexical order and scores equal the unscoped ranking with hidden units removed');

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_lexical_scoped(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], array['doc-1'], 1)),
  1,
  'the limit bounds the scoped result');

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_lexical_scoped(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], array['doc-x'], 10)),
  0,
  'another tenant''s document id admits nothing in this tenant');

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_lexical_scoped(
    'pilot-scoped1', 'retrieval-run-' || repeat('d', 32), array['payment'], array['doc-1', 'doc-x'], 10)),
  0,
  'another tenant''s run id under this workspace returns nothing');

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_lexical_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], array[]::text[], 10)$$,
  'retrieval_scoped_search_documents_empty',
  'an empty document list is refused, typed, not answered as an empty result');

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_lexical_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], null, 10)$$,
  'retrieval_scoped_search_documents_invalid',
  'a null document list is refused');

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_lexical_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'],
      (select array_agg('doc-' || n) from generate_series(1, 2001) as n), 10)$$,
  'retrieval_scoped_search_documents_invalid',
  'a document list over 2000 entries is refused');

select lives_ok(
  $$select * from public.search_foundation_retrieval_units_lexical_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'],
      (select array_agg('doc-' || n) from generate_series(1, 2000) as n), 10)$$,
  'a document list of exactly 2000 entries is accepted');

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_lexical_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], array['doc-1', 'doc-1'], 10)$$,
  'retrieval_scoped_search_documents_invalid',
  'a duplicated document id is refused');

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_lexical_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], array['doc-1', null], 10)$$,
  'retrieval_scoped_search_documents_invalid',
  'a null document id is refused');

-- The run id is part of the scope key; outside its fixed 0020 form the key would not be injective.
select throws_ok(
  $$select * from public.search_foundation_retrieval_units_lexical_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32) || 'x', array['payment'], array['doc-1'], 10)$$,
  'retrieval_scoped_search_run_invalid',
  'a compile run id outside the 0020 pattern is refused');

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_lexical_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], array['doc-1'], 501)$$,
  'retrieval_lexical_search_limit_out_of_bounds',
  'the scoped lexical limit keeps 0023''s bound');

-- ---------------------------------------------------------------------------------------
-- Structure pool
-- ---------------------------------------------------------------------------------------
select is(
  (select array_agg(s.unit_id order by s.ord) from public.foundation_retrieval_structure_candidates_scoped(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['doc-1'], 2000) with ordinality as s(unit_id, claim_ids, entity_ids, ord)),
  array['retrieval-unit-' || repeat('1', 32), 'retrieval-unit-' || repeat('2', 32), 'retrieval-unit-' || repeat('3', 32)],
  'the scoped structure pool is every admitted unit, ordered by unit_id, and no hidden one');

select throws_ok(
  $$select * from public.foundation_retrieval_structure_candidates_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array[]::text[], 2000)$$,
  'retrieval_scoped_search_documents_empty',
  'the structure pool refuses an empty document list');

select throws_ok(
  $$select * from public.foundation_retrieval_structure_candidates_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['doc-1'], 2001)$$,
  'retrieval_structure_candidates_limit_out_of_bounds',
  'the structure pool cannot be asked for more than 2000 units');

-- ---------------------------------------------------------------------------------------
-- Dense
-- ---------------------------------------------------------------------------------------
select is(
  (select array_agg(s.unit_id order by s.ord) from public.search_foundation_retrieval_units_dense_scoped(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'bge-m3-v1', array[1, 0, 0]::double precision[], 'cosine',
    array['doc-1'], 10) with ordinality as s(unit_id, distance, ord)),
  array['retrieval-unit-' || repeat('1', 32), 'retrieval-unit-' || repeat('2', 32), 'retrieval-unit-' || repeat('3', 32)],
  'scoped dense ranks the admitted units only: the hidden unit identical to the query is absent');

select is(
  (select array_agg(s.unit_id || ':' || s.distance::text order by s.ord) from public.search_foundation_retrieval_units_dense_scoped(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'bge-m3-v1', array[1, 0, 0]::double precision[], 'l2',
    array['doc-1'], 10) with ordinality as s(unit_id, distance, ord)),
  (select array_agg(s.unit_id || ':' || s.distance::text order by s.ord) from public.search_foundation_retrieval_units_dense(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'bge-m3-v1', array[1, 0, 0]::double precision[], 'l2', 500)
    with ordinality as s(unit_id, distance, ord)
    join public.foundation_retrieval_units u on u.workspace_key = 'pilot-scoped1' and u.unit_id = s.unit_id
   where u.document_id = 'doc-1'),
  'scoped dense order and distances equal the unscoped ranking with hidden units removed');

select is(
  (select count(*)::integer from public.search_foundation_retrieval_units_dense_scoped(
    'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'bge-m3-v1', array[1, 0, 0]::double precision[], 'inner_product',
    array['doc-x'], 10)),
  0,
  'scoped dense admits no other tenant''s document');

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_dense_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'bge-m3-v1', array[1, 0, 0]::double precision[], 'cosine',
      (select array_agg('doc-' || n) from generate_series(1, 2001) as n), 10)$$,
  'retrieval_scoped_search_documents_invalid',
  'scoped dense refuses an oversize document list');

select throws_ok(
  $$select * from public.search_foundation_retrieval_units_dense_scoped(
      'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'bge-m3-v1', array[1, 0, 0]::double precision[], 'cosine',
      array[]::text[], 10)$$,
  'retrieval_scoped_search_documents_empty',
  'scoped dense refuses an empty document list');

-- ---------------------------------------------------------------------------------------
-- Rows examined do not depend on hidden documents
-- ---------------------------------------------------------------------------------------
-- Each probe is measured four times: with no extra hidden units, then after each of three batches of
-- forty hidden doc-2 units that match the query and sit at the query vector. The batches' unit ids sort
-- FIRST (0-filled, before every admitted id), in the MIDDLE (2-filled: after ...222, before ...333) and
-- LAST (f-filled), so a plan that walked any unit_id-ordered index and stopped at a LIMIT would meet
-- hidden rows in at least one stage (review r1 N-d).
create function pg_temp.measure(p_stage integer) returns void language plpgsql as $m$
begin
  insert into scoped_reads values
    ('lexical_scoped', p_stage, pg_temp.examined($q$select * from public.search_foundation_retrieval_units_lexical_scoped(
       'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], array['doc-1'], 10)$q$)),
    ('dense_scoped', p_stage, pg_temp.examined($q$select * from public.search_foundation_retrieval_units_dense_scoped(
       'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'bge-m3-v1', array[1, 0, 0]::double precision[], 'cosine', array['doc-1'], 10)$q$)),
    ('structure_scoped', p_stage, pg_temp.examined($q$select * from public.foundation_retrieval_structure_candidates_scoped(
       'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['doc-1'], 2000)$q$)),
    ('lexical_unscoped', p_stage, pg_temp.examined($q$select * from public.search_foundation_retrieval_units_lexical(
       'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), array['payment'], 10)$q$));
end;
$m$;
create function pg_temp.add_hidden(p_fill text, p_base integer) returns void language plpgsql as $m$
begin
  insert into public.foundation_retrieval_units (
    unit_id, workspace_key, compile_run_id, unit_type, document_id, document_version_key, text, content_digest, search_tokens
  )
  select 'retrieval-unit-' || lpad(to_hex(p_base + n), 32, p_fill), 'pilot-scoped1', 'retrieval-run-' || repeat('c', 32), 'section',
         'doc-2', repeat('d', 64), 'Payment codename filler ' || n, 'sha256:' || lpad(to_hex(p_base + n), 64, '0'),
         array['payment', 'codename', 'filler']
  from generate_series(1, 40) as n;
  insert into public.foundation_retrieval_embeddings (workspace_key, unit_id, retrieval_profile_id, dimension, embedding)
  select 'pilot-scoped1', 'retrieval-unit-' || lpad(to_hex(p_base + n), 32, p_fill), 'bge-m3-v1', 3, '[1,0,0]'
  from generate_series(1, 40) as n;
end;
$m$;

select pg_temp.measure(0);
select pg_temp.add_hidden('0', 1000);
select pg_temp.measure(1);
select pg_temp.add_hidden('2', 2000);
select pg_temp.measure(2);
select pg_temp.add_hidden('f', 3000);
select pg_temp.measure(3);

select ok((select bool_and(r.reads > p.reads) from scoped_reads r join scoped_reads p on p.probe = r.probe and p.stage = r.stage - 1
            where r.probe = 'lexical_unscoped'),
  'instrument check: the unscoped lexical RPC reads more tuples after every batch of hidden matches');
select ok((select min(reads) > 0 and count(distinct reads) = 1 and count(*) = 4 from scoped_reads where probe = 'lexical_scoped'),
  'scoped lexical reads the same number of tuples with hidden matches sorting first, in the middle and last');
select ok((select min(reads) > 0 and count(distinct reads) = 1 and count(*) = 4 from scoped_reads where probe = 'dense_scoped'),
  'scoped dense reads the same number of tuples with hidden nearest neighbours sorting first, in the middle and last');
select ok((select min(reads) > 0 and count(distinct reads) = 1 and count(*) = 4 from scoped_reads where probe = 'structure_scoped'),
  'the scoped structure pool reads the same number of tuples with hidden units sorting first, in the middle and last');

select * from finish();
rollback;
