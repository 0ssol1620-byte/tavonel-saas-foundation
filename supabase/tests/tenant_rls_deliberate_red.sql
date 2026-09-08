-- The deliberate-red test: proof that the tenant isolation matrix can see a leak.
--
-- Founder ruling G-3 / Layer A: "a matrix that cannot go red proves nothing". tenant_rls_matrix.sql
-- passes 51 assertions on a clean chain, and that is only evidence if the same assertions would
-- fail against a database that actually leaks. Nothing in a green run distinguishes a policy set
-- that holds from a query that was quietly asking the wrong question.
--
-- So this file introduces two real leaks, one of each kind the matrix checks, and shows the
-- matrix's own assertion pattern going red on each -- then puts both back and shows it green again,
-- so the red is attributable to the leak rather than to the fixture. Everything happens inside one
-- transaction that ends in `rollback`, so no leak outlives the file: `create policy` and `grant`
-- are transactional DDL in Postgres.
--
-- The two kinds, deliberately, because they fail in different ways and only one of them raises:
--   * a missing GRANT is a privilege fact, caught by the catalog sweeps in matrix section 1;
--   * a too-permissive POLICY is a row-visibility fact that raises nothing at all and is caught
--     only by `is_empty` on a cross-tenant query (matrix section 4).
-- A file that proved only the first would leave the silent half unproven, which is the half that
-- matters: an over-broad `using` clause returns rows and returns success.
--
-- Read the assertion pair, not the assertion: each `isnt_empty` below is the matrix's own
-- `is_empty` query, run while the leak exists. `isnt_empty` passing here means `is_empty` would
-- have failed there.

begin;
select plan(6);

-- Two tenants, the smallest fixture the two questions need.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'red-a@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'red-b@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.workspaces (id, owner_id, name, slug) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Red A', 'red-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Red B', 'red-b');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner');
insert into public.documents (id, workspace_id, created_by, original_filename, declared_mime_type, quarantine_object_key, state) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'a.pdf', 'application/pdf', 'quarantine/red-a/a/source', 'quarantined'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'b.pdf', 'application/pdf', 'quarantine/red-b/b/source', 'quarantined');

-- ---------------------------------------------------------------------------
-- 1. A missing revoke. This is matrix section 1's first sweep, verbatim.
-- ---------------------------------------------------------------------------

select is_empty($$
  select c.relname::text || ':' || p.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(privilege_type)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_table_privilege('anon', c.oid, p.privilege_type)
$$, 'control: the anon grant sweep is empty on an unmodified chain');

grant select on public.documents to anon;

select isnt_empty($$
  select c.relname::text || ':' || p.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(privilege_type)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_table_privilege('anon', c.oid, p.privilege_type)
$$, 'RED: one forgotten grant to anon and the matrix sweep is no longer empty');

revoke select on public.documents from anon;

select is_empty($$
  select c.relname::text || ':' || p.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(privilege_type)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_table_privilege('anon', c.oid, p.privilege_type)
$$, 'the sweep is empty again once the grant is taken back, so the red was the grant');

-- ---------------------------------------------------------------------------
-- 2. A too-permissive policy. This is matrix section 4's cross-tenant query, verbatim, under
--    user A's identity. Nothing raises here: a `using` clause that is too wide just returns rows.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

set local role authenticated;
select is_empty($$select * from public.documents where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'control: A sees none of B''s documents on an unmodified chain');

-- Policies are permissive by default and OR together, so this one alone opens the table.
reset role;
create policy deliberate_red_leak on public.documents for select to authenticated using (true);

set local role authenticated;
select isnt_empty($$select * from public.documents where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'RED: one permissive policy and A reads B''s documents, with no error raised');

reset role;
drop policy deliberate_red_leak on public.documents;

set local role authenticated;
select is_empty($$select * from public.documents where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'the cross-tenant query is empty again once the policy is dropped, so the red was the policy');

select * from finish();
rollback;
