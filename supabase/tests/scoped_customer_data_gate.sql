-- The v2 tables are deliberately inactive, service-role-only and append-only.
begin;
select plan(10);

select has_table('public', 'customer_data_release_decisions', 'release ledger exists');
select has_table('public', 'customer_data_workspace_decisions', 'workspace ledger exists');
select table_privs_are('public', 'customer_data_release_decisions', 'service_role',
  array['SELECT', 'INSERT']::text[]);
select table_privs_are('public', 'customer_data_workspace_decisions', 'service_role',
  array['SELECT', 'INSERT']::text[]);

set local role anon;
select throws_ok($$select 1 from public.customer_data_release_decisions$$, '42501', null,
  'anon cannot inspect release evidence');
select throws_ok($$select 1 from public.customer_data_workspace_decisions$$, '42501', null,
  'anon cannot inspect workspace terms receipts');
reset role;

set local role authenticated;
select throws_ok($$select 1 from public.customer_data_release_decisions$$, '42501', null,
  'authenticated cannot inspect release evidence');
select throws_ok($$select 1 from public.customer_data_workspace_decisions$$, '42501', null,
  'authenticated cannot inspect other workspaces or terms receipts');
reset role;

select throws_ok($$
  insert into public.customer_data_release_decisions
    (scope, release_revision, allowed, receipt_sha256, evidence, evaluated_at, operator_actor, decision_reason)
  values
    ('direct_upload', repeat('a', 40), true, 'sha256:' || repeat('a', 64), '[]'::jsonb,
     now(), 'test-operator', 'must reject missing evidence')
$$, '23514', null, 'approved release cannot carry zero evidence');

select throws_ok($$
  insert into public.customer_data_workspace_decisions
    (tenant_id, workspace_id, scope, release_revision, allowed, operator_actor, decision_reason)
  values ('tenant-a', 'workspace-a', 'direct_upload', repeat('a', 40), true,
          'test-operator', 'must reject absent terms')
$$, '23514', null, 'approved workspace cannot omit terms receipts');

select * from finish();
rollback;
