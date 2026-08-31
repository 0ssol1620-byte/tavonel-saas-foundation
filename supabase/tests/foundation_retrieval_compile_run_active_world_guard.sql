-- Run with Supabase CLI db test after 0021_retrieval_compile_run_active_world_guard.sql.
begin;
select plan(4);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '66666666-6666-6666-6666-666666666666',
  'authenticated', 'authenticated', 'retrieval-guard-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select is(
  public.promote_foundation_candidate(
    'pilot-guardtest0001', 'collection-cccccccccccccccccccccccccccccccc',
    'sha256:7777777777777777777777777777777777777777777777777777777777777777',
    'immutable/pilot-guardtest0001/pilot-guardtest0001/collections/collection-cccccccccccccccccccccccccccccccc/7777777777777777777777777777777777777777777777777777777777777777/candidate-world.json',
    'ws_candidate_guard_1',
    'sha256:8888888888888888888888888888888888888888888888888888888888888888',
    '66666666-6666-6666-6666-666666666666', null, 'Fixture world one for the active-world guard'
  ) ->> 'status',
  'active',
  'first fixture world is promoted and active'
);

insert into public.foundation_retrieval_profiles (
  id, workspace_key, views, embedding, lexical, fusion, index_backend, index_metric,
  profile_digest, created_by
) values (
  'bge-m3-v1', 'pilot-guardtest0001', array['section'],
  '{"provider":"huggingface","model":"BAAI/bge-m3","revision":"fixture","dimension":3,"normalize":true}',
  '{"backend":"postgres_fts"}', '{"algorithm":"rrf","k":60}', 'pgvector', 'cosine',
  'sha256:9999999999999999999999999999999999999999999999999999999999999999',
  '66666666-6666-6666-6666-666666666666'
);

select lives_ok(
  $$insert into public.foundation_retrieval_compile_runs (
    run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status
  ) values (
    'retrieval-run-' || repeat('1', 32), 'pilot-guardtest0001', 'collection-cccccccccccccccccccccccccccccccc',
    'sha256:7777777777777777777777777777777777777777777777777777777777777777', 'bge-m3-v1', 'pending'
  )$$,
  'a compile run against the currently active world is accepted'
);

select is(
  public.promote_foundation_candidate(
    'pilot-guardtest0001', 'collection-cccccccccccccccccccccccccccccccc',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'immutable/pilot-guardtest0001/pilot-guardtest0001/collections/collection-cccccccccccccccccccccccccccccccc/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/candidate-world.json',
    'ws_candidate_guard_2',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '66666666-6666-6666-6666-666666666666',
    'sha256:7777777777777777777777777777777777777777777777777777777777777777',
    'Second promotion supersedes the first fixture world'
  ) ->> 'status',
  'active',
  'a second promotion supersedes the world the earlier compile run referenced'
);

select throws_ok(
  $$insert into public.foundation_retrieval_compile_runs (
    run_id, workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, status
  ) values (
    'retrieval-run-' || repeat('2', 32), 'pilot-guardtest0001', 'collection-cccccccccccccccccccccccccccccccc',
    'sha256:7777777777777777777777777777777777777777777777777777777777777777', 'bge-m3-v1', 'pending'
  )$$,
  'retrieval_compile_run_requires_active_world',
  'a new compile run cannot be created against a now-superseded world'
);

select is(
  (select count(*)::integer from public.foundation_retrieval_compile_runs
    where run_id = 'retrieval-run-' || repeat('1', 32)),
  1,
  'the earlier compile run remains a valid historical record after its world is superseded'
);

select * from finish();
rollback;
