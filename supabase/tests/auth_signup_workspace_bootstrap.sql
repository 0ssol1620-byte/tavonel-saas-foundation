-- Reproduce the Auth role's commit-time permission shape before rollback.
-- The local test connection cannot SET ROLE supabase_auth_admin, and it cannot grant
-- INSERT on Supabase-owned auth.users. Seed as postgres, then force the queued
-- deferred checks under authenticated, which likewise cannot read private tables.
begin;
select plan(6);

select ok(not has_table_privilege('supabase_auth_admin', 'public.foundation_workspace_members', 'SELECT'),
  'Auth still has no direct membership-table read grant');
select ok(not has_table_privilege('supabase_auth_admin', 'public.foundation_workspaces', 'SELECT'),
  'Auth still has no direct workspace-table read grant');
select ok((select prosecdef from pg_proc where oid = 'public.assert_foundation_workspace_has_owner()'::regprocedure),
  'member owner invariant runs with its restricted owner privileges');
select ok((select prosecdef from pg_proc where oid = 'public.assert_new_foundation_workspace_has_owner()'::regprocedure),
  'workspace owner invariant runs with its restricted owner privileges');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a93df1bb-4e5b-4f45-a089-e33a9ca11e29',
  'authenticated', 'authenticated', 'auth-bootstrap-probe@example.invalid',
  '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}',
  '{}', now(), now()
);
set local role authenticated;
set constraints all immediate;
reset role;

select is(
  (select count(*)::integer from public.foundation_workspaces
    where created_by = 'a93df1bb-4e5b-4f45-a089-e33a9ca11e29'::uuid),
  1, 'Auth signup creates one private workspace');
select is(
  (select count(*)::integer from public.foundation_workspace_members
    where user_id = 'a93df1bb-4e5b-4f45-a089-e33a9ca11e29'::uuid
      and role = 'owner' and state = 'active'),
  1, 'Auth signup creates one active owner');

select * from finish();
rollback;
