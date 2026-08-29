-- Run with Supabase CLI db test after 0007_foundation_world_lifecycle.sql.
begin;
select plan(28);

select has_table('public', 'foundation_world_versions', 'world versions table exists');
select has_table('public', 'foundation_active_worlds', 'active world pointer table exists');
select has_table('public', 'foundation_world_events', 'world lifecycle events table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_world_versions'::regclass), 'world versions have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_active_worlds'::regclass), 'active pointer has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_world_events'::regclass), 'world events have RLS');
select ok(not has_table_privilege('anon', 'public.foundation_active_worlds', 'select'), 'anonymous clients cannot read active worlds');
select ok(not has_table_privilege('authenticated', 'public.foundation_world_versions', 'select'), 'authenticated clients cannot bypass lifecycle API');
select ok(not has_function_privilege('authenticated', 'public.promote_foundation_candidate(text,text,text,text,text,text,uuid,text,text)', 'execute'), 'authenticated clients cannot promote directly');
select ok(has_function_privilege('service_role', 'public.promote_foundation_candidate(text,text,text,text,text,text,uuid,text,text)', 'execute'), 'service role can promote');
select ok(not has_function_privilege('authenticated', 'public.rollback_foundation_world(text,text,text,text,uuid,text)', 'execute'), 'authenticated clients cannot roll back directly');
select ok(has_function_privilege('service_role', 'public.rollback_foundation_world(text,text,text,text,uuid,text)', 'execute'), 'service role can roll back');
select ok(not has_table_privilege('service_role', 'public.foundation_world_versions', 'update'), 'service role cannot bypass lifecycle RPC updates');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '44444444-4444-4444-4444-444444444444',
  'authenticated', 'authenticated', 'world-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select is(
  public.promote_foundation_candidate(
    'pilot-worldtest0000', 'collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'immutable/pilot-worldtest0000/pilot-worldtest0000/collections/collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/candidate-world.json',
    'ws_candidate_a',
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '44444444-4444-4444-4444-444444444444', null, 'Initial human review passed'
  )->>'status',
  'active',
  'first reviewed candidate becomes active'
);
select is((select revision from public.foundation_active_worlds where workspace_key = 'pilot-worldtest0000'), 1::bigint, 'first active pointer is revision one');
select is((select lifecycle_status from public.foundation_world_versions where manifest_digest like 'sha256:a%'), 'active', 'first version is active');
select is((select count(*)::integer from public.foundation_world_events), 1, 'first promotion emits one event');

select is(
  public.promote_foundation_candidate(
    'pilot-worldtest0000', 'collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'immutable/pilot-worldtest0000/pilot-worldtest0000/collections/collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/candidate-world.json',
    'ws_candidate_b',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    '44444444-4444-4444-4444-444444444444',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Second human review passed'
  )->>'status',
  'active',
  'second candidate advances the active pointer'
);
select is((select revision from public.foundation_active_worlds where workspace_key = 'pilot-worldtest0000'), 2::bigint, 'second promotion increments revision');
select is((select lifecycle_status from public.foundation_world_versions where manifest_digest like 'sha256:a%'), 'superseded', 'prior version is retained as superseded');
select is((select lifecycle_status from public.foundation_world_versions where manifest_digest like 'sha256:b%'), 'active', 'new version is active');
select is((select count(*)::integer from public.foundation_world_versions where lifecycle_status = 'active'), 1, 'only one version can be active per collection');

select throws_ok(
  $$select public.promote_foundation_candidate(
    'pilot-worldtest0000', 'collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'immutable/pilot-worldtest0000/pilot-worldtest0000/collections/collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/candidate-world.json',
    'ws_candidate_e',
    'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    '44444444-4444-4444-4444-444444444444',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Stale browser review attempt'
  )$$,
  'world_active_pointer_conflict',
  'stale expected pointer cannot overwrite a newer world'
);

select is(
  public.rollback_foundation_world(
    'pilot-worldtest0000', 'collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '44444444-4444-4444-4444-444444444444', 'Rollback after human incident review'
  )->>'status',
  'active',
  'reviewed rollback reactivates a retained version'
);
select is((select revision from public.foundation_active_worlds where workspace_key = 'pilot-worldtest0000'), 3::bigint, 'rollback increments revision');
select is((select manifest_digest from public.foundation_active_worlds where workspace_key = 'pilot-worldtest0000'), 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'rollback changes the active pointer');
select is((select activation_count from public.foundation_world_versions where manifest_digest like 'sha256:a%'), 2, 'reactivated version records activation count');
select is((select count(*)::integer from public.foundation_world_events), 3, 'promotion and rollback events are append-only');

select * from finish();
rollback;
