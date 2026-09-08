-- Schema fingerprints for the read-only L-2 comparison (founder ruling G-9, condition 2).
--
-- The same file runs on two databases: the clean database CI builds from supabase/migrations (Layer A) and,
-- read-only, the production project. Each query returns (kind, object, fingerprint) so the two results can be
-- diffed without moving a single row of data or a single secret. Every fingerprint is an md5 over the catalog
-- definition text, ordered deterministically. Extension-owned functions are excluded because an extension's
-- install schema is itself one of the differences being measured (see the "extension" kind).
--
-- Statements are SELECT only. Nothing here may be rewritten into anything else.

select 'column' as kind, c.table_name as object,
       md5(string_agg(c.column_name || ':' || c.data_type || ':' || coalesce(c.character_maximum_length::text, '')
                      || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''), ',' order by c.ordinal_position)) as fingerprint
from information_schema.columns c
where c.table_schema = 'public'
group by c.table_name

union all
select 'constraint', k.conrelid::regclass::text,
       md5(string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' order by k.conname))
from pg_constraint k
where k.connamespace = 'public'::regnamespace
group by k.conrelid

union all
select 'index', i.tablename,
       md5(string_agg(i.indexname || ':' || i.indexdef, ',' order by i.indexname))
from pg_indexes i
where i.schemaname = 'public'
group by i.tablename

union all
select 'policy', p.tablename,
       md5(string_agg(p.policyname || ':' || coalesce(p.roles::text, '') || ':' || p.cmd || ':' || coalesce(p.qual, '')
                      || ':' || coalesce(p.with_check, ''), ',' order by p.policyname))
from pg_policies p
where p.schemaname = 'public'
group by p.tablename

union all
select 'function', f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')',
       md5(pg_get_functiondef(f.oid))
from pg_proc f
where f.pronamespace = 'public'::regnamespace
  and f.prokind in ('f', 'p')
  and not exists (select 1 from pg_depend d where d.objid = f.oid and d.deptype = 'e')

union all
select 'grant', g.table_name,
       md5(string_agg(g.grantee || ':' || g.privilege_type, ',' order by g.grantee, g.privilege_type))
from information_schema.role_table_grants g
where g.table_schema = 'public'
  and g.grantee in ('anon', 'authenticated', 'service_role')
group by g.table_name

union all
select 'trigger', t.event_object_table,
       md5(string_agg(t.trigger_name || ':' || t.action_timing || ':' || t.event_manipulation || ':' || t.action_statement,
                      ',' order by t.trigger_name, t.event_manipulation))
from information_schema.triggers t
where t.trigger_schema = 'public'
group by t.event_object_table

union all
select 'rls', r.relname, md5(r.relrowsecurity::text || ':' || r.relforcerowsecurity::text)
from pg_class r
where r.relnamespace = 'public'::regnamespace and r.relkind = 'r'

union all
select 'extension', e.extname, md5(e.extversion || ':' || n.nspname)
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace

union all
select 'migration', m.version, md5(coalesce(m.name, ''))
from supabase_migrations.schema_migrations m

order by 1, 2;
