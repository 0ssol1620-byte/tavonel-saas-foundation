-- Processing-terms acceptance receipts: owner-only, tenant-bound, append-only, and only current
-- while the acceptor remains the active owner at the revision they accepted under.
begin;
select plan(33);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c0a1a1a1-0000-4000-8000-000000000001', 'authenticated',
   'authenticated', 'terms-owner-a@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0b2b2b2-0000-4000-8000-000000000002', 'authenticated',
   'authenticated', 'terms-owner-b@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0c3c3c3-0000-4000-8000-000000000003', 'authenticated',
   'authenticated', 'terms-member-a@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now());

-- The Auth signup trigger normally creates these; keep the fixture independent of it.
insert into public.foundation_workspaces (workspace_key, display_name, created_by) values
  ('pilot-c0a1a1a100004000', 'A', 'c0a1a1a1-0000-4000-8000-000000000001'),
  ('pilot-c0b2b2b200004000', 'B', 'c0b2b2b2-0000-4000-8000-000000000002')
on conflict (workspace_key) do nothing;
insert into public.foundation_workspace_members (workspace_key, user_id, role, state, accepted_at) values
  ('pilot-c0a1a1a100004000', 'c0a1a1a1-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-000000000002', 'owner', 'active', now())
on conflict (workspace_key, user_id) do nothing;
insert into public.foundation_workspace_members (workspace_key, user_id, role, state, accepted_at) values
  ('pilot-c0a1a1a100004000', 'c0c3c3c3-0000-4000-8000-000000000003', 'member', 'active', now())
on conflict (workspace_key, user_id) do update set role = 'member', state = 'active', revoked_at = null;

create temporary table terms_fixture as select
  'sha256:' || repeat('a', 64) as terms_sha,
  'sha256:' || repeat('b', 64) as processing_sha,
  '/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md' as terms_path,
  '/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md' as processing_path;
create temporary table terms_receipts (label text primary key, r jsonb not null);
grant select on terms_fixture to service_role;
grant insert on terms_receipts to service_role;

-- 1-9: no browser or direct service access.
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_processing_terms_acceptances'::regclass),
  'RLS is enabled');
select ok(not has_table_privilege('anon', 'public.foundation_processing_terms_acceptances',
  'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'), 'anon has no table privilege');
select ok(not has_table_privilege('authenticated', 'public.foundation_processing_terms_acceptances',
  'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'), 'authenticated has no table privilege');
select ok(not has_table_privilege('service_role', 'public.foundation_processing_terms_acceptances',
  'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'), 'service_role cannot write or read the table directly');
select ok(not has_function_privilege('anon',
  'public.record_foundation_processing_terms_acceptance(text, uuid, text, text, text, text, text, text, text)', 'EXECUTE'),
  'anon cannot record an acceptance');
select ok(not has_function_privilege('authenticated',
  'public.record_foundation_processing_terms_acceptance(text, uuid, text, text, text, text, text, text, text)', 'EXECUTE'),
  'authenticated cannot record an acceptance');
select ok(not has_function_privilege('authenticated',
  'public.current_foundation_processing_terms_acceptance(text, text, text, text, text)', 'EXECUTE'),
  'authenticated cannot read acceptances');
select ok(has_function_privilege('service_role',
  'public.record_foundation_processing_terms_acceptance(text, uuid, text, text, text, text, text, text, text)', 'EXECUTE'),
  'service_role may call the narrow writer');
select ok(not has_function_privilege('service_role',
  'public.foundation_processing_terms_acceptance_receipt(public.foundation_processing_terms_acceptances, boolean)', 'EXECUTE'),
  'receipt helper is internal');

-- 10-15: owner accepts through the service role; exact replay is idempotent.
set local role service_role;
insert into terms_receipts
select 'first', public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
  'c0a1a1a1-0000-4000-8000-000000000001', 'direct_upload', '2026-09-30',
  terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0001') from terms_fixture;
reset role;
select is((select r ->> 'idempotentReplay' from terms_receipts where label = 'first'), 'false', 'first acceptance is a new receipt');
select is((select r ->> 'actorRole' from terms_receipts where label = 'first'), 'owner', 'receipt records the owner role');
select ok((select (r ->> 'acceptedAt')::timestamptz <= clock_timestamp() from terms_receipts where label = 'first'),
  'acceptedAt is the database clock');
select is((select r #>> '{processing,sha256}' from terms_receipts where label = 'first'), 'sha256:' || repeat('b', 64),
  'receipt binds the processing addendum hash');

set local role service_role;
insert into terms_receipts
select 'replay', public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
  'c0a1a1a1-0000-4000-8000-000000000001', 'direct_upload', '2026-09-30',
  terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0002') from terms_fixture;
reset role;
select is((select r ->> 'acceptanceId' from terms_receipts where label = 'replay'), (select r ->> 'acceptanceId' from terms_receipts where label = 'first'),
  'exact replay returns the original receipt');
select is((select r ->> 'idempotentReplay' from terms_receipts where label = 'replay'), 'true', 'replay is marked');

-- 16: the service role cannot append a receipt without the authorization check.
set local role service_role;
do $$ begin
  insert into public.foundation_processing_terms_acceptances (workspace_key, user_id, actor_role,
    authorization_revision, scope, terms_version, terms_path, terms_sha256, processing_path,
    processing_sha256, request_id)
  values ('pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-000000000002', 'owner', 1, 'connector',
    '2026-09-30', '/policy/t.md', 'sha256:' || repeat('a', 64), '/policy/p.md', 'sha256:' || repeat('b', 64),
    'req-direct-01');
  insert into terms_receipts values ('direct', '{"sqlstate":"none"}');
exception when others then
  insert into terms_receipts values ('direct', jsonb_build_object('sqlstate', sqlstate));
end $$;
reset role;
select is((select r ->> 'sqlstate' from terms_receipts where label = 'direct'), '42501',
  'service_role cannot insert receipts directly');

-- 17-20: tenant, role and identity failures.
select throws_ok($$
  select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
    'c0b2b2b2-0000-4000-8000-000000000002', 'direct_upload', '2026-09-30',
    terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0003') from terms_fixture
$$, 'P0001', 'processing_terms_acceptance_forbidden', 'another workspace owner cannot accept for this tenant');
select throws_ok($$
  select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
    'c0c3c3c3-0000-4000-8000-000000000003', 'direct_upload', '2026-09-30',
    terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0004') from terms_fixture
$$, 'P0001', 'processing_terms_acceptance_forbidden', 'a non-owner member cannot accept');
select throws_ok($$
  select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
    'c0ffffff-0000-4000-8000-00000000ffff', 'direct_upload', '2026-09-30',
    terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0005') from terms_fixture
$$, 'P0001', 'processing_terms_acceptance_forbidden', 'an unknown identity cannot accept');
select throws_ok($$
  select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
    null, 'direct_upload', '2026-09-30',
    terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0006') from terms_fixture
$$, 'P0001', 'processing_terms_acceptance_input_invalid', 'a missing actor is rejected');

-- 21-24: malformed offers are rejected before any lookup.
select throws_ok($$
  select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
    'c0a1a1a1-0000-4000-8000-000000000001', 'all_sources', '2026-09-30',
    terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0007') from terms_fixture
$$, 'P0001', 'processing_terms_acceptance_input_invalid', 'unknown scope is rejected');
select throws_ok($$
  select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
    'c0a1a1a1-0000-4000-8000-000000000001', 'direct_upload', 'v2-draft',
    terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0008') from terms_fixture
$$, 'P0001', 'processing_terms_acceptance_input_invalid', 'non-dated version is rejected');
select throws_ok($$
  select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
    'c0a1a1a1-0000-4000-8000-000000000001', 'direct_upload', '2026-09-30',
    terms_path, 'sha256:ABC', processing_path, processing_sha, 'req-terms-0009') from terms_fixture
$$, 'P0001', 'processing_terms_acceptance_input_invalid', 'malformed hash is rejected');
select throws_ok($$
  select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
    'c0a1a1a1-0000-4000-8000-000000000001', 'direct_upload', '2026-09-30',
    '/policy/../secrets.md', terms_sha, processing_path, processing_sha, 'req-terms-0010') from terms_fixture
$$, 'P0001', 'processing_terms_acceptance_input_invalid', 'path traversal is rejected');

-- 25-27: current read requires exact scope and hashes.
select ok((select public.current_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
  'direct_upload', '2026-09-30', terms_sha, processing_sha) ->> 'acceptanceId' from terms_fixture)
  = (select r ->> 'acceptanceId' from terms_receipts where label = 'first'), 'current acceptance is found for the exact offer');
select is((select public.current_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
  'direct_upload', '2026-09-30', terms_sha, 'sha256:' || repeat('c', 64)) from terms_fixture), null,
  'a changed processing addendum has no acceptance');
select is((select public.current_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
  'connector', '2026-09-30', terms_sha, processing_sha) from terms_fixture), null,
  'direct upload acceptance does not cover connectors');

-- 28-29: receipts are immutable even to the table owner.
select throws_ok($$ update public.foundation_processing_terms_acceptances set scope = 'connector' $$,
  'P0001', 'processing_terms_acceptance_append_only', 'receipts cannot be updated');
select throws_ok($$ delete from public.foundation_processing_terms_acceptances $$,
  'P0001', 'processing_terms_acceptance_append_only', 'receipts cannot be deleted');

-- 30-33: revocation invalidates the acceptance and cannot be bypassed by reinstatement.
update public.foundation_workspace_members set state = 'revoked', revoked_at = now()
 where workspace_key = 'pilot-c0a1a1a100004000' and user_id = 'c0a1a1a1-0000-4000-8000-000000000001';
select is((select public.current_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
  'direct_upload', '2026-09-30', terms_sha, processing_sha) from terms_fixture), null,
  'a revoked owner has no current acceptance');
select throws_ok($$
  select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
    'c0a1a1a1-0000-4000-8000-000000000001', 'direct_upload', '2026-09-30',
    terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0011') from terms_fixture
$$, 'P0001', 'processing_terms_acceptance_forbidden', 'a revoked owner cannot accept');
update public.foundation_workspace_members set state = 'active', revoked_at = null, accepted_at = now()
 where workspace_key = 'pilot-c0a1a1a100004000' and user_id = 'c0a1a1a1-0000-4000-8000-000000000001';
select is((select public.current_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
  'direct_upload', '2026-09-30', terms_sha, processing_sha) from terms_fixture), null,
  'reinstatement does not resurrect the old acceptance');
select is((select public.record_foundation_processing_terms_acceptance('pilot-c0a1a1a100004000',
  'c0a1a1a1-0000-4000-8000-000000000001', 'direct_upload', '2026-09-30',
  terms_path, terms_sha, processing_path, processing_sha, 'req-terms-0012') ->> 'idempotentReplay' from terms_fixture),
  'false', 'the reinstated owner must agree again at the new revision');

select * from finish();
rollback;
