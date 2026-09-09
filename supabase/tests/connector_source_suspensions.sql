begin;
select plan(5);
select table_privs_are('public', 'connector_source_suspensions', 'service_role', array['SELECT','INSERT']::text[]);
select table_privs_are('public', 'connector_source_suspensions', 'anon', array[]::text[]);
select table_privs_are('public', 'connector_source_suspensions', 'authenticated', array[]::text[]);
select ok(not has_function_privilege('authenticated','public.connector_documents_blocked(text,text[])','EXECUTE'), 'browser cannot inspect source suspension state');
select ok((select relrowsecurity from pg_class where oid='public.connector_source_suspensions'::regclass), 'suspension RLS enabled');
select * from finish();
rollback;
