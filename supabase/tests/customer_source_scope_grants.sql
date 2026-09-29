begin;
select plan(8);
select ok(has_column_privilege('service_role', 'public.foundation_intake_admissions', 'workspace_key', 'SELECT'), 'scope reader can read workspace');
select ok(has_column_privilege('service_role', 'public.foundation_intake_admissions', 'document_id', 'SELECT'), 'scope reader can read document identity');
select ok(has_column_privilege('service_role', 'public.foundation_intake_admissions', 'confirmed_at', 'SELECT'), 'scope reader can require confirmation');
select ok(not has_table_privilege('service_role', 'public.foundation_intake_admissions', 'SELECT'), 'no full table read granted');
select ok(not has_column_privilege('service_role', 'public.foundation_intake_admissions', 'user_id', 'SELECT'), 'scope reader cannot read customer identity');
select ok(not has_column_privilege('authenticated', 'public.foundation_intake_admissions', 'document_id', 'SELECT'), 'browser roles cannot read admissions');
select ok(not has_column_privilege('anon', 'public.foundation_intake_admissions', 'document_id', 'SELECT'), 'anonymous callers cannot read admissions');
select is_empty($$
  select attname from pg_attribute
  where attrelid = 'public.foundation_intake_admissions'::regclass
    and attnum > 0 and not attisdropped
    and attname not in ('workspace_key', 'document_id', 'confirmed_at')
    and has_column_privilege('service_role', 'public.foundation_intake_admissions', attname, 'SELECT')
$$, 'no other admission columns are readable');
select * from finish();
rollback;
