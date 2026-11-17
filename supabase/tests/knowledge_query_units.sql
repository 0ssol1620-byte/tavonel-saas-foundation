-- Migration 20261117150000: the KQU meter (WO-CAT-4).
--
-- Workspace KQA holds a Personal-sized allowance (1,000): 999 answered queries, the 1,000th admitted
-- and answered, the 1,001st refused with nothing written. A failed query frees its hold and counts
-- nothing; a second settle of a hold changes nothing; an expired hold stops reserving and is never
-- counted. At limit-1 a live hold refuses the next admission -- the serialization the window row lock
-- gives two concurrent requests (pgTAP runs in one transaction, so the race itself is run outside this
-- file: receipts/WO-CAT-4/race). Workspace KQL (a legacy plan, null limit) is counted and never refused.
-- Neither browser role can call the functions or read the tables.
--
-- Since 20261117160000 (WO-CAT-8) the limit is not the caller's: the server passes the catalog map and
-- the function applies the entry for the workspace's plan_code. KQA and KQB hold Personal accounts and
-- KQL a legacy one; pg_temp.admit(workspace, n) sends a map whose Personal entry is n, so each test
-- below still states its limit. (catalog_v2_meter_closure.sql tests whose plan governs.)
begin;
select plan(26);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
  'kqu-' || n || '@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now()
from (values (1, 'a1c7a1c7-0000-4000-8000-0000000000a1'), (2, 'b2c7b2c7-0000-4000-8000-0000000000b2'),
             (3, 'c3c7c3c7-0000-4000-8000-0000000000c3')) as u(n, id);
insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status)
values ('pilot-kqa', 'a1c7a1c7-0000-4000-8000-0000000000a1', 'observer_access', 'personal', 'active'),
       ('pilot-kqb', 'b2c7b2c7-0000-4000-8000-0000000000b2', 'observer_access', 'personal', 'active'),
       ('pilot-kql', 'c3c7c3c7-0000-4000-8000-0000000000c3', 'studio_access', null, 'active');

create function pg_temp.admit(p_workspace text, p_limit integer) returns jsonb language sql as $$
  select public.admit_foundation_knowledge_query(p_workspace, jsonb_build_object('personal', p_limit));
$$;
create function pg_temp.used(p_workspace text) returns integer language sql as $$
  select coalesce((select used_units from public.foundation_knowledge_query_windows
    where workspace_key = p_workspace and window_started_at = date_trunc('month', clock_timestamp(), 'UTC')), 0);
$$;
create function pg_temp.holds(p_workspace text) returns integer language sql as $$
  select count(*)::integer from public.foundation_knowledge_query_holds where workspace_key = p_workspace;
$$;
create function pg_temp.answer(p_workspace text, p_limit integer, p_times integer) returns integer language plpgsql as $$
declare
  v jsonb;
  i integer;
begin
  for i in 1..p_times loop
    v := pg_temp.admit(p_workspace, p_limit);
    if v->>'status' <> 'admitted' then return i - 1; end if;
    perform public.settle_foundation_knowledge_query((v->>'hold_id')::uuid, true);
  end loop;
  return p_times;
end;
$$;

-- 1-7: the client boundary.
select ok(not has_function_privilege('anon', 'public.admit_foundation_knowledge_query(text, jsonb)', 'EXECUTE'), 'anon cannot admit');
select ok(not has_function_privilege('authenticated', 'public.admit_foundation_knowledge_query(text, jsonb)', 'EXECUTE'), 'a browser cannot admit');
select ok(not has_function_privilege('authenticated', 'public.settle_foundation_knowledge_query(uuid, boolean)', 'EXECUTE'), 'a browser cannot settle');
select ok(has_function_privilege('service_role', 'public.admit_foundation_knowledge_query(text, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.settle_foundation_knowledge_query(uuid, boolean)', 'EXECUTE'), 'the server calls both');
select ok(not has_table_privilege('authenticated', 'public.foundation_knowledge_query_windows', 'SELECT')
  and not has_table_privilege('service_role', 'public.foundation_knowledge_query_windows', 'SELECT')
  and not has_table_privilege('service_role', 'public.foundation_knowledge_query_holds', 'INSERT'), 'no role reads or writes the tables directly');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.foundation_knowledge_query_windows'::regclass, 'public.foundation_knowledge_query_holds'::regclass)), 'both tables have RLS');
select throws_ok($$ select pg_temp.admit('pilot-kqa', 0) $$,
  'knowledge_query_meter_contract_invalid', 'a zero limit is refused as a contract error, not read as no limit');

-- 8-14: the allowance, to the unit.
select is(pg_temp.answer('pilot-kqa', 1000, 999), 999, '999 queries are admitted and answered');
select is(pg_temp.used('pilot-kqa'), 999, 'each answered query counted once');
select is(pg_temp.holds('pilot-kqa'), 0, 'an answered query leaves no hold');
select is(pg_temp.answer('pilot-kqa', 1000, 1), 1, 'the 1,000th query is admitted');
select is(pg_temp.used('pilot-kqa'), 1000, 'and counted');
select is(pg_temp.admit('pilot-kqa', 1000), '{"status": "exhausted"}'::jsonb, 'the 1,001st is refused');
select is(pg_temp.used('pilot-kqa') * 10 + pg_temp.holds('pilot-kqa'), 10000, 'the refusal counts nothing and holds nothing');

-- 15-20: failure, replay and expiry on workspace KQB (limit 3).
select is(pg_temp.answer('pilot-kqb', 3, 2), 2, 'two answered on a limit of 3');
create temp table hold_a as select (pg_temp.admit('pilot-kqb', 3)->>'hold_id')::uuid as id;
select is(pg_temp.admit('pilot-kqb', 3), '{"status": "exhausted"}'::jsonb,
  'at limit-1 a live hold refuses the next admission: two requests at limit-1 admit exactly one');
select is(public.settle_foundation_knowledge_query((select id from hold_a), false), true, 'a failed query settles its hold');
select is(pg_temp.used('pilot-kqb') * 10 + pg_temp.holds('pilot-kqb'), 20, 'and is not counted');
select is(public.settle_foundation_knowledge_query((select id from hold_a), true), false,
  'a second settle of the same hold, even as answered, changes nothing');
create temp table hold_b as select (pg_temp.admit('pilot-kqb', 3)->>'hold_id')::uuid as id;
update public.foundation_knowledge_query_holds set expires_at = clock_timestamp() - interval '1 second'
  where hold_id = (select id from hold_b);
select is(pg_temp.answer('pilot-kqb', 3, 1) * 10 + pg_temp.used('pilot-kqb'), 13,
  'an expired hold no longer reserves: the freed unit is admitted and counted');

-- 21-23: a legacy plan (null limit) is counted and never refused.
select is(pg_temp.answer('pilot-kql', null, 1200), 1200, 'a null limit admits past every v2 allowance');
select is(pg_temp.used('pilot-kql'), 1200, 'and counts every answered query');
create temp table hold_l as select (pg_temp.admit('pilot-kql', null)->>'hold_id')::uuid as id;
select is(public.settle_foundation_knowledge_query((select id from hold_l), false) and pg_temp.used('pilot-kql') = 1200, true,
  'a failed legacy query is not counted');

-- 24-26: one counter per workspace and month.
select is((select count(*)::integer from public.foundation_knowledge_query_windows where workspace_key = 'pilot-kqa'), 1,
  'one window row per workspace and month');
select is((select window_started_at from public.foundation_knowledge_query_windows where workspace_key = 'pilot-kqa'),
  date_trunc('month', clock_timestamp(), 'UTC'), 'the window is the calendar month, UTC');
select is(pg_temp.used('pilot-kqa'), 1000, 'other workspaces never moved this workspace''s counter');

select * from finish();
rollback;
