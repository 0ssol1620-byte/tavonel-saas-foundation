-- Catalog-level reset safety contracts, exercised after the complete migration chain.
begin;
select plan(5);

select has_function('public', 'founder_test_reset_assertions',
  array['text', 'uuid', 'text'], 'founder reset assertions function exists');

select ok(
  pg_get_functiondef('public.founder_test_reset_assertions(text,uuid,text)'::regprocedure)
    like '%pg_advisory_xact_lock%',
  'active-work assertions acquire the founder reset advisory lock'
);

select ok(
  pg_get_functiondef('public.founder_test_reset_assertions(text,uuid,text)'::regprocedure)
    like $contract$%perform 1 from public.foundation_compile_jobs%state not in ('ready','failed','cancelled')%for update%$contract$,
  'every non-terminal compile row is locked before reset proceeds'
);

select ok(
  pg_get_functiondef('public.founder_test_reset_assertions(text,uuid,text)'::regprocedure)
    not like '%foundation_compile_jobs%updated_at%',
  'compile safety has no stale-heartbeat exception'
);

select ok(
  pg_get_functiondef('public.guard_founder_test_reset_workspace_write()'::regprocedure)
    like '%founder-test-reset:%',
  'compile writers share the founder reset advisory lock domain'
);

select * from finish();
rollback;
