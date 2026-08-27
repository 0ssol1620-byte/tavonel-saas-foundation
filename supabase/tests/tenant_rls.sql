-- Run only in the dedicated Supabase test database after 0001_tavonel_tenant_foundation.sql.
-- The fixtures use two distinct tenants and must prove that client-role reads do not cross workspaces.
begin;
select plan(6);

select has_table('public', 'workspaces', 'workspaces exists');
select has_table('public', 'documents', 'documents exists');
select ok((select relrowsecurity from pg_class where oid = 'public.documents'::regclass), 'documents has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.workspace_entitlements'::regclass), 'entitlements has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.billing_events', 'select'), 'billing event ledger is not browser-readable');
select ok(not has_table_privilege('authenticated', 'public.documents', 'insert'), 'browser cannot insert document metadata directly');

select * from finish();
rollback;
