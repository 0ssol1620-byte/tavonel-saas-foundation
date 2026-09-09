begin;
select plan(5);
select table_privs_are('public', 'foundation_connector_page_snapshots', 'service_role', array['SELECT','INSERT']::text[]);
select table_privs_are('public', 'foundation_connector_page_snapshots', 'anon', array[]::text[]);
select table_privs_are('public', 'foundation_connector_page_snapshots', 'authenticated', array[]::text[]);
select ok(not has_function_privilege('authenticated','public.connector_sync_page(text,text,text,text,jsonb)','EXECUTE'), 'browser cannot read or create sync snapshots');
select ok((select relrowsecurity from pg_class where oid='public.foundation_connector_page_snapshots'::regclass), 'snapshot RLS enabled');
select * from finish();
rollback;
