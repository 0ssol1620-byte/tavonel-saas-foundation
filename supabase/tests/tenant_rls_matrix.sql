-- The tenant isolation matrix, executed rather than described.
--
-- Until the db-rehearsal workflow existed this file had never run anywhere: no Docker on the
-- build machine, no runner in CI, and `server/foundation/rlsMatrixContract.test.ts` reads it as
-- text. The customer-data gate records that as precondition 1, PARTIAL. So this is written to be
-- run, and to fail loudly rather than to look thorough.
--
-- Two identities, in two workspaces and two organizations, plus anon, an authenticated session
-- carrying no subject at all, and service_role. Roles are switched with `set local role` and the
-- identity with `request.jwt.claims`, which is what `auth.uid()` reads.
--
-- Reading the assertions:
--   * a missing GRANT raises 42501, so it is asserted with throws_ok;
--   * a `using` clause filters rows out silently, so it is asserted with is_empty, and an
--     allowed write is proved with `returning` and results_eq -- never lives_ok, which passes
--     when the write matched nothing.
--
-- The first four assertions are catalog-wide on purpose. Naming forty service-role-only tables
-- one at a time invites the next table to be forgotten; asking the catalog which tables a
-- browser role can touch covers every table the migrations create, including the ones nobody
-- has written yet. The runtime blocks below then prove the same thing as the role itself,
-- because a grant table is evidence about privileges and not about behaviour.
begin;
select plan(46);

-- Fixture seeding runs as the migration role. Every client assertion below runs under an
-- explicit `set local role`, and the whole transaction is rolled back.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'tenant-a@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'tenant-b@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- `on_auth_user_created` (0001) gives each of the two users a personal workspace, membership and
-- entitlement of their own. The tenant fixtures below are therefore the SECOND workspace each
-- user belongs to, which is why the assertions ask what a session can reach rather than how many
-- rows it counts: an earlier version of this file asserted `count(*) = 1` for workspaces,
-- memberships and entitlements and could never have passed.
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

-- Two organizations, so a cross-organization read is a different question from a cross-workspace
-- one. User A is a `viewer`: the lowest role that still holds `organization:read`, which is the
-- permission `append_enterprise_audit_event` checks (gap matrix L-4).
insert into public.enterprise_organizations (organization_id, name, slug, created_by) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Org Alpha', 'org-alpha', '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-0000000000b1', 'Org Beta', 'org-beta', '22222222-2222-2222-2222-222222222222');
insert into public.enterprise_organization_memberships (organization_id, user_id, role, created_by) values
  ('a0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'viewer', '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'owner', '22222222-2222-2222-2222-222222222222');
insert into public.enterprise_workspaces (workspace_key, organization_id, display_name) values
  ('pilot-a1', 'a0000000-0000-0000-0000-0000000000a1', 'Alpha pilot'),
  ('pilot-b1', 'b0000000-0000-0000-0000-0000000000b1', 'Beta pilot');
insert into public.enterprise_workspace_memberships (workspace_key, user_id, role, created_by) values
  ('pilot-a1', '11111111-1111-1111-1111-111111111111', 'viewer', '11111111-1111-1111-1111-111111111111'),
  ('pilot-b1', '22222222-2222-2222-2222-222222222222', 'owner', '22222222-2222-2222-2222-222222222222');
insert into public.enterprise_audit_events (organization_id, workspace_key, action, target_type, target_id, actor_user_id, outcome) values
  ('a0000000-0000-0000-0000-0000000000a1', 'pilot-a1', 'organization.created', 'organization', 'org-alpha', '11111111-1111-1111-1111-111111111111', 'succeeded'),
  ('b0000000-0000-0000-0000-0000000000b1', 'pilot-b1', 'organization.created', 'organization', 'org-beta', '22222222-2222-2222-2222-222222222222', 'succeeded');

-- ---------------------------------------------------------------------------
-- 1. What the grant tables say, for every table in the schema.
--
-- DELETE has no column-level form, so the table-level sweep covers four privileges and the
-- column-level sweep covers the three that can be granted per column. A leak that `revoke all`
-- missed shows up in one of the two.
-- ---------------------------------------------------------------------------

select is_empty($$
  select c.relname::text || ':' || p.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(privilege_type)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_table_privilege('anon', c.oid, p.privilege_type)
$$, 'anon holds no table privilege anywhere in the public schema');

select is_empty($$
  select c.relname::text || ':' || p.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE')) as p(privilege_type)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_any_column_privilege('anon', c.oid, p.privilege_type)
$$, 'anon holds no column privilege anywhere in the public schema');

-- The allowlist is 0001 verbatim: ten browser-readable relations plus the two profile columns a
-- user may rename. Anything else a migration hands to `authenticated` -- including a table that
-- inherited Supabase default privileges because its migration forgot to revoke -- fails here.
select is_empty($$
  select c.relname::text || ':' || p.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE')) as p(privilege_type)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_any_column_privilege('authenticated', c.oid, p.privilege_type)
     and (c.relname::text || ':' || p.privilege_type) <> all (array[
       'profiles:SELECT', 'profiles:UPDATE', 'workspaces:SELECT', 'workspace_memberships:SELECT',
       'plans:SELECT', 'workspace_entitlements:SELECT', 'documents:SELECT',
       'sanitization_proofs:SELECT', 'knowledge_graph_candidates:SELECT',
       'paddle_customers:SELECT', 'paddle_subscriptions:SELECT'
     ])
$$, 'authenticated holds nothing beyond the ten browser-readable relations');

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
  and has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'),
  'the only browser write in the schema is a profile display name and avatar'
);

-- ---------------------------------------------------------------------------
-- 2. anon, at runtime. No identity, no grants, nothing to read.
--    Four of the reads below sample the service-role-only tables of gap matrix row L-3.
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok($$select 1 from public.documents$$, '42501', null, 'anon cannot read documents');
select throws_ok($$select 1 from public.enterprise_audit_events$$, '42501', null, 'anon cannot read the enterprise audit log');
select throws_ok($$select 1 from public.foundation_jobs$$, '42501', null, 'anon cannot read the job queue');
select throws_ok($$select 1 from public.sources$$, '42501', null, 'anon cannot read the source ledger');
select throws_ok($$select 1 from public.customer_data_gate_receipts$$, '42501', null, 'anon cannot read gate receipts');
select throws_ok($$insert into public.documents (workspace_id, created_by, original_filename, declared_mime_type, quarantine_object_key) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'anon.pdf', 'application/pdf', 'quarantine/anon/source')$$, '42501', null, 'anon cannot write documents');
select throws_ok($$select public.append_enterprise_audit_event('a0000000-0000-0000-0000-0000000000a1'::uuid, 'pilot-a1', 'compile.complete', 'corpus', 'corpus-a', '11111111-1111-1111-1111-111111111111'::uuid, 'succeeded', null, '{}'::jsonb)$$, '42501', null, 'anon cannot call the audit RPC');

-- ---------------------------------------------------------------------------
-- 3. User A, authenticated. What its own tenant allows.
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select results_eq('select count(*)::integer from public.profiles', array[1], 'profile allows self only');
select isnt_empty($$select id from public.workspaces where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$, 'workspace allows member tenant');
select isnt_empty($$select workspace_id from public.workspace_memberships where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$, 'memberships allow member tenant');
select results_eq('select count(*)::integer from public.plans', array[1], 'plans are readable to authenticated users');
select isnt_empty($$select workspace_id from public.workspace_entitlements where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$, 'entitlements allow member tenant');
select results_eq('select count(*)::integer from public.documents', array[1], 'documents allow member tenant only');
select results_eq('select count(*)::integer from public.sanitization_proofs', array[1], 'proofs inherit document tenant boundary');
select results_eq('select count(*)::integer from public.knowledge_graph_candidates', array[1], 'candidates allow member tenant only');
select results_eq('select count(*)::integer from public.paddle_customers', array[1], 'Paddle customers allow self only');
select results_eq('select count(*)::integer from public.paddle_subscriptions', array[1], 'Paddle subscriptions allow member tenant only');

-- Deny matrix: the ledger is not discoverable and no protected domain row is writable. Every one
-- of these is a missing grant, which raises rather than filtering.
select throws_ok($$select 1 from public.billing_events$$, '42501', null, 'billing event ledger is unreadable');
select throws_ok($$insert into public.documents (workspace_id, created_by, original_filename, declared_mime_type, quarantine_object_key) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'forbidden.pdf', 'application/pdf', 'quarantine/tenant-a/forbidden/source')$$, '42501', null, 'browser cannot insert documents');
select throws_ok($$update public.workspace_entitlements set status = 'active' where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$, '42501', null, 'browser cannot mutate entitlement');
select throws_ok($$update public.knowledge_graph_candidates set state = 'approved'$$, '42501', null, 'browser cannot promote a candidate');
select throws_ok($$insert into public.billing_events (paddle_event_id, event_type, occurred_at) values ('evt_forbidden', 'subscription.updated', now())$$, '42501', null, 'browser cannot write billing ledger');

-- ---------------------------------------------------------------------------
-- 4. User A against user B's workspace. Reads are filtered to nothing; the one write a browser
--    session holds matches no row of B's.
-- ---------------------------------------------------------------------------

select is_empty($$select * from public.documents where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'cross-tenant document query is empty');
select is_empty($$select * from public.paddle_subscriptions where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'cross-tenant subscription query is empty');
select is_empty($$select * from public.profiles where id = '22222222-2222-2222-2222-222222222222'$$, 'cross-tenant profile query is empty');
select is_empty($$select * from public.sanitization_proofs where document_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$, 'cross-tenant proof query is empty');
select is_empty($$select * from public.knowledge_graph_candidates where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'cross-tenant candidate query is empty');
select is_empty($$update public.profiles set display_name = 'taken over' where id = '22222222-2222-2222-2222-222222222222' returning id$$, 'A cannot rename B');
select results_eq($$update public.profiles set display_name = 'renamed by owner' where id = '11111111-1111-1111-1111-111111111111' returning display_name$$, $$select 'renamed by owner'::text$$, 'A renames its own profile');

-- ---------------------------------------------------------------------------
-- 5. User A against organization Beta. The enterprise tables are service-role-only, so the
--    boundary a browser can actually reach is the SECURITY DEFINER permission function and the
--    audit RPC granted to `authenticated`.
-- ---------------------------------------------------------------------------

select throws_ok($$select 1 from public.enterprise_organizations$$, '42501', null, 'browser cannot read the organization directory');
select ok(public.enterprise_has_permission('a0000000-0000-0000-0000-0000000000a1'::uuid, null::text, 'organization:read'), 'A reads its own organization');
select ok(not public.enterprise_has_permission('b0000000-0000-0000-0000-0000000000b1'::uuid, null::text, 'organization:read'), 'cross-organization read is refused');
select ok(not public.enterprise_has_permission('a0000000-0000-0000-0000-0000000000a1'::uuid, null::text, 'audit:read'), 'a viewer cannot read its own organization audit log');
select throws_ok($$select public.append_enterprise_audit_event('b0000000-0000-0000-0000-0000000000b1'::uuid, 'pilot-b1', 'compile.complete', 'corpus', 'corpus-b', '11111111-1111-1111-1111-111111111111'::uuid, 'succeeded', null, '{}'::jsonb)$$, 'P0001', 'enterprise_access_denied', 'A cannot append into another organization audit log');
select throws_ok($$select public.append_enterprise_audit_event('a0000000-0000-0000-0000-0000000000a1'::uuid, 'pilot-a1', 'compile.complete', 'corpus', 'corpus-a', '22222222-2222-2222-2222-222222222222'::uuid, 'succeeded', null, '{}'::jsonb)$$, 'P0001', 'enterprise_audit_actor_invalid', 'A cannot append as another actor');

-- TODO(L-4): this documents what the schema does today, not what it should do. `compile.complete`
-- is a system event, and a read-only viewer can write one into its own organization's audit log
-- because the RPC checks `organization:read` and the `action` column takes any string matching a
-- regex. An auditor cannot then tell a system event from a fabricated one. The repair is a
-- migration -- revoke EXECUTE from `authenticated`, or constrain `p_action` and stamp a source --
-- and migrations are the P1-A lane's to write, so this asserts the current behaviour rather than
-- pretending it is already fixed. When that migration lands, this assertion becomes a throws_ok.
select results_eq($$select public.append_enterprise_audit_event('a0000000-0000-0000-0000-0000000000a1'::uuid, 'pilot-a1', 'compile.complete', 'corpus', 'corpus-a', '11111111-1111-1111-1111-111111111111'::uuid, 'succeeded', null, '{}'::jsonb) is not null$$, $$select true$$, 'L-4 current behaviour: a read-only member appends a system action to its own audit log');

-- ---------------------------------------------------------------------------
-- 6. Authenticated, with no subject and therefore no organization context. `auth.uid()` is null,
--    every tenant predicate is null, and null is not true.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);

select is_empty($$select id from public.documents$$, 'a session with no subject reads no document');
select is_empty($$select id from public.workspaces$$, 'a session with no subject reads no workspace');
select ok(not public.enterprise_has_permission('a0000000-0000-0000-0000-0000000000a1'::uuid, null::text, 'organization:read'), 'a null organization context grants nothing');

-- ---------------------------------------------------------------------------
-- 7. service_role. The server's own credential reads across every tenant, which is what makes
--    the application layer the only isolation boundary the 40 policy-less tables have (L-3).
-- ---------------------------------------------------------------------------

set local role service_role;

select results_eq('select count(*)::integer from public.documents', array[2], 'service role reads both tenants');
select results_eq('select count(*)::integer from public.enterprise_organizations', array[2], 'service role reads every organization');
select results_eq($$select count(*)::integer from public.enterprise_audit_events where organization_id = 'b0000000-0000-0000-0000-0000000000b1'$$, array[1], 'service role reads an audit log it never joined');

select * from finish();
rollback;
