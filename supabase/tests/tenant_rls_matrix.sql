-- Execute with Supabase CLI db test (pgTAP) only after the reviewed 0001 migration
-- has been applied to the dedicated foundation test project. This test never belongs
-- in production and every inserted fixture is rolled back.
begin;
select plan(24);

-- Test identities are inserted as an owner role only for fixture seeding. Client checks
-- below always run as `authenticated` with a distinct JWT subject for each tenant.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'tenant-a@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'tenant-b@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.workspaces (id, owner_id, name, slug) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Tenant B', 'tenant-b');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner');
insert into public.workspace_entitlements (workspace_id, status, source, upload_bytes_limit, document_limit) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'active', 'manual', 1000, 2),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'active', 'manual', 1000, 2);
insert into public.plans (id, code, name, upload_bytes_limit, document_limit, max_document_bytes) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'fixture', 'Fixture', 1000, 2, 1000);
insert into public.documents (id, workspace_id, created_by, original_filename, declared_mime_type, quarantine_object_key, state) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'a.pdf', 'application/pdf', 'quarantine/tenant-a/a/source', 'quarantined'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'b.pdf', 'application/pdf', 'quarantine/tenant-b/b/source', 'quarantined');
insert into public.sanitization_proofs (id, document_id, input_sha256, output_sha256, output_mime_type, sanitizer_version, immutable_object_key) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'dddddddd-dddd-dddd-dddd-dddddddddddd', repeat('a', 64), repeat('b', 64), 'application/pdf', 'fixture', 'canonical/tenant-a/a/proof');
insert into public.knowledge_graph_candidates (workspace_id, document_id, sanitization_proof_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff');
insert into public.paddle_customers (paddle_customer_id, user_id, email) values
  ('ctm_fixture_a', '11111111-1111-1111-1111-111111111111', 'tenant-a@example.invalid'),
  ('ctm_fixture_b', '22222222-2222-2222-2222-222222222222', 'tenant-b@example.invalid');
insert into public.paddle_subscriptions (paddle_subscription_id, workspace_id, paddle_customer_id, status, occurred_at) values
  ('sub_fixture_a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ctm_fixture_a', 'active', now()),
  ('sub_fixture_b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ctm_fixture_b', 'active', now());
insert into public.billing_events (paddle_event_id, event_type, occurred_at) values ('evt_fixture_a', 'subscription.updated', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

-- Allow matrix: Tenant A reads its own profile, workspace-scoped records, shared plan,
-- own Paddle customer, and own subscription.
select results_eq('select count(*)::integer from public.profiles', array[1], 'profile allows self only');
select results_eq('select count(*)::integer from public.workspaces', array[1], 'workspace allows member tenant only');
select results_eq('select count(*)::integer from public.workspace_memberships', array[1], 'memberships allow member tenant only');
select results_eq('select count(*)::integer from public.plans', array[1], 'plans are readable to authenticated users');
select results_eq('select count(*)::integer from public.workspace_entitlements', array[1], 'entitlements allow member tenant only');
select results_eq('select count(*)::integer from public.documents', array[1], 'documents allow member tenant only');
select results_eq('select count(*)::integer from public.sanitization_proofs', array[1], 'proofs inherit document tenant boundary');
select results_eq('select count(*)::integer from public.knowledge_graph_candidates', array[1], 'candidates allow member tenant only');
select results_eq('select count(*)::integer from public.paddle_customers', array[1], 'Paddle customers allow self only');
select results_eq('select count(*)::integer from public.paddle_subscriptions', array[1], 'Paddle subscriptions allow member tenant only');

-- Deny matrix: client role can neither discover the ledger nor write protected domain data.
select results_eq('select count(*)::integer from public.billing_events', array[0], 'billing event ledger is unreadable');
select throws_ok($$insert into public.documents (workspace_id, created_by, original_filename, declared_mime_type, quarantine_object_key) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'forbidden.pdf', 'application/pdf', 'quarantine/tenant-a/forbidden/source')$$, '42501', null, 'browser cannot insert documents');
select throws_ok($$update public.workspace_entitlements set status = 'active' where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$, '42501', null, 'browser cannot mutate entitlement');
select throws_ok($$update public.knowledge_graph_candidates set state = 'approved'$$, '42501', null, 'browser cannot promote a candidate');
select throws_ok($$insert into public.billing_events (paddle_event_id, event_type, occurred_at) values ('evt_forbidden', 'subscription.updated', now())$$, '42501', null, 'browser cannot write billing ledger');

-- Tenant B data remains invisible and cannot be selected by target identifier.
select is_empty($$select * from public.documents where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'cross-tenant document query is empty');
select is_empty($$select * from public.paddle_subscriptions where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'cross-tenant subscription query is empty');
select is_empty($$select * from public.profiles where id = '22222222-2222-2222-2222-222222222222'$$, 'cross-tenant profile query is empty');
select is_empty($$select * from public.sanitization_proofs where document_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$, 'cross-tenant proof query is empty');
select is_empty($$select * from public.knowledge_graph_candidates where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'cross-tenant candidate query is empty');

select * from finish();
rollback;
