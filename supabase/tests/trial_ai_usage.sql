-- Migration 20261104090000: trial AI access entitlement and its usage counter.
--
-- One trialing user T in workspace TAI walks every bound the function owns: a peek writes
-- nothing, a query is counted once, the daily limit refuses the next query and does not move the
-- counter, a new UTC day starts again, a second World, a page overrun and an ended AI window are
-- each refused by name, and a trial that is not trialing is not a trial. The client roles can
-- neither call the function nor read the rows it reads. The same user in another workspace is
-- not this trial. Last, the internal operations receipts (W1-A3): no role reads the table, only
-- the server calls its writer, and the first receipt wins.
--
-- Not here: two sessions racing for the last query. pgTAP runs in one transaction, so the row
-- lock that serializes them cannot be contended from this file.
begin;
select plan(35);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values ('00000000-0000-0000-0000-000000000000', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'authenticated',
  'authenticated', 'trial-ai@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"google","providers":["google"]}', '{}', now(), now());

insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, subscription_status)
values ('pilot-tai0001', 'a1a1a1a1-0000-4000-8000-0000000000a1', 'observer_access', 'inactive');
insert into public.foundation_self_service_trials (user_id, workspace_key, status, started_at, expires_at)
values ('a1a1a1a1-0000-4000-8000-0000000000a1', 'pilot-tai0001', 'trialing', now(), now() + interval '7 days');

create function pg_temp.access(p_consume boolean default false) returns jsonb language sql as $$
  select public.foundation_trial_ai_access('a1a1a1a1-0000-4000-8000-0000000000a1', 'pilot-tai0001', p_consume);
$$;
create function pg_temp.count() returns integer language sql as $$
  select ai_query_count from public.foundation_self_service_trials where user_id = 'a1a1a1a1-0000-4000-8000-0000000000a1';
$$;

-- 1-7: shape and the client boundary.
select ok(not has_function_privilege('anon', 'public.foundation_trial_ai_access(uuid, text, boolean)', 'EXECUTE'),
  'anon cannot call the entitlement function');
select ok(not has_function_privilege('authenticated', 'public.foundation_trial_ai_access(uuid, text, boolean)', 'EXECUTE'),
  'a signed-in browser cannot call the entitlement function');
select ok(has_function_privilege('service_role', 'public.foundation_trial_ai_access(uuid, text, boolean)', 'EXECUTE'),
  'the server credential can call it');
select policies_are('public', 'foundation_self_service_trials', array['foundation_self_service_trials_no_client_access'],
  'the trial row has an explicit client refusal, not only RLS with no policy');
select policies_are('public', 'foundation_trial_policy', array['foundation_trial_policy_no_client_access'],
  'the policy row has an explicit client refusal, not only RLS with no policy');
select results_eq(
  $$select ai_access_days, ai_page_limit, ai_world_limit, ai_daily_query_limit from public.foundation_trial_policy where policy_key = 'default'$$,
  $$values (14, 200, 1, 200)$$,
  'the default package is 14 days / 200 pages / 1 World / 200 queries a day');
set local role authenticated;
select throws_ok($$select ai_query_count from public.foundation_self_service_trials$$, '42501', null,
  'a signed-in browser cannot read the counter');
reset role;

-- 8-12: inputs and the peek.
set local role service_role;
select throws_ok($$select public.foundation_trial_ai_access('a1a1a1a1-0000-4000-8000-0000000000a1', 'not-a-workspace', false)$$,
  'P0001', 'foundation_trial_ai_access_invalid', 'a malformed workspace key is refused, not answered');
select throws_ok($$select public.foundation_trial_ai_access('a1a1a1a1-0000-4000-8000-0000000000a1', 'pilot-tai0001', null)$$,
  'P0001', 'foundation_trial_ai_access_invalid', 'a null consume flag is refused, not read as false');
select is(public.foundation_trial_ai_access('b2b2b2b2-0000-4000-8000-0000000000b2', 'pilot-tai0001', true)->>'status',
  'not_trial', 'a user with no trial row is not a trial, and nothing is counted for them');
select is(public.foundation_trial_ai_access('a1a1a1a1-0000-4000-8000-0000000000a1', 'pilot-tai0002', true)->>'status',
  'not_trial', 'the same user in another workspace is not this trial, and nothing is counted there');
select is(pg_temp.access()->>'status', 'allowed', 'a fresh trial inside every bound is allowed');
select is(pg_temp.count(), 0, 'a peek (and the other workspace) wrote nothing');

-- 14-19: the daily query counter.
select is((pg_temp.access(true)->'usage'->>'queriesToday')::integer, 1, 'a query is counted');
select is(pg_temp.count(), 1, 'the count is durable on the trial row');
update public.foundation_trial_policy set ai_daily_query_limit = 2 where policy_key = 'default';
select is(pg_temp.access(true)->>'status', 'allowed', 'the second query of a two-query day is allowed');
select is(pg_temp.access(true)->>'reason', 'TRIAL_AI_DAILY_QUERY_LIMIT', 'the third is refused by name');
select is(pg_temp.count(), 2, 'a refused query does not move the counter');
select is(pg_temp.access()->>'status', 'allowed', 'a spent query allowance does not block authorizing a client');

-- 20: a new UTC day starts again.
reset role;
update public.foundation_self_service_trials set ai_query_day = ai_query_day - 1
 where user_id = 'a1a1a1a1-0000-4000-8000-0000000000a1';
set local role service_role;
select is((pg_temp.access(true)->'usage'->>'queriesToday')::integer, 1, 'yesterday''s count does not carry over');

-- 21-22: a second World.
reset role;
insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids, idempotency_key, state, documents_total)
values ('cjob-' || repeat('a', 32), 'pilot-tai0001', 'a1a1a1a1-0000-4000-8000-0000000000a1',
        array['0a100000-0000-4000-8000-00000000000a'], 'trial-ai-usage-1', 'structuring', 1),
       ('cjob-' || repeat('b', 32), 'pilot-tai0001', 'a1a1a1a1-0000-4000-8000-0000000000a1',
        array['0a100000-0000-4000-8000-00000000000b'], 'trial-ai-usage-2', 'structuring', 1);
set local role service_role;
select is(pg_temp.access()->>'reason', 'TRIAL_AI_WORLD_LIMIT', 'two World-bearing jobs exceed a one-World trial');
update public.foundation_trial_policy set ai_world_limit = 2 where policy_key = 'default';
select is(pg_temp.access()->>'status', 'allowed', 'the limit is the policy row''s, not a constant');

-- 23-24: pages, from the same ledger the 0046 guard reads.
reset role;
update public.foundation_trial_policy set ai_page_limit = 1 where policy_key = 'default';
insert into public.foundation_compute_reservations
  (workspace_key, document_id, user_id, reserved_credits, maximum_credits, state, expires_at, billing_source)
values ('pilot-tai0001', '0a100000-0000-4000-8000-00000000000c', 'a1a1a1a1-0000-4000-8000-0000000000a1',
        8, 8, 'reserved', now() + interval '10 minutes', 'trial');
set local role service_role;
select is(pg_temp.access()->>'reason', 'TRIAL_AI_PAGE_LIMIT', 'eight units are two standard pages, over a one-page limit');
select is((pg_temp.access()->'usage'->>'pages')::integer, 2, 'pages are units / 4, rounded up');

-- 25: the AI window ends before the trial does when the trial is older than ai_access_days.
reset role;
update public.foundation_self_service_trials set started_at = now() - interval '15 days', expires_at = now() + interval '1 day'
 where user_id = 'a1a1a1a1-0000-4000-8000-0000000000a1';
set local role service_role;
select is(pg_temp.access()->>'reason', 'TRIAL_AI_WINDOW_ENDED', 'a 15-day-old trial is past a 14-day AI window');

-- 26-28: a trial that is not trialing is not a trial.
reset role;
update public.foundation_self_service_trials set started_at = now() - interval '8 days', expires_at = now() - interval '1 day'
 where user_id = 'a1a1a1a1-0000-4000-8000-0000000000a1';
set local role service_role;
select is(pg_temp.access(true)->>'status', 'not_trial', 'an expired trial is not a trial');
reset role;
update public.foundation_self_service_trials set status = 'converted', expires_at = now() + interval '1 day'
 where user_id = 'a1a1a1a1-0000-4000-8000-0000000000a1';
set local role service_role;
select is(pg_temp.access(true)->>'status', 'not_trial', 'a converted trial is not a trial');
reset role;
select is(pg_temp.count(), 1, 'nothing was counted for a trial that was not one');

-- 29-35: internal operations receipts.
select is_empty($$
  select r.role || ':' || p.privilege
    from (values ('anon'), ('authenticated'), ('service_role')) r(role)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(privilege)
   where has_table_privilege(r.role, 'public.foundation_operations_receipts', p.privilege)
$$, 'no client role and not service_role holds a table privilege on the operations receipts');
select policies_are('public', 'foundation_operations_receipts', array['foundation_operations_receipts_no_client_access'],
  'the receipts table carries an explicit client refusal');
select ok(not has_function_privilege('anon', 'public.record_foundation_operations_receipt(text, text, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_foundation_operations_receipt(text, text, text, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.record_foundation_operations_receipt(text, text, text, jsonb)', 'EXECUTE'),
  'only the server credential can write a receipt');
set local role service_role;
select is(public.record_foundation_operations_receipt('e2e_timing', 'pilot-tai0001', 'collection-' || repeat('c', 32), '{"n": 1}'),
  true, 'the first receipt for a World is written');
select is(public.record_foundation_operations_receipt('e2e_timing', 'pilot-tai0001', 'collection-' || repeat('c', 32), '{"n": 2}'),
  false, 'a second receipt for the same World writes nothing');
select throws_ok($$select public.record_foundation_operations_receipt('customer_note', 'pilot-tai0001', 'x', '{}')$$,
  '23514', null, 'an unknown receipt kind is refused');
reset role;
select is((select details->>'n' from public.foundation_operations_receipts
  where receipt_kind = 'e2e_timing' and workspace_key = 'pilot-tai0001'), '1', 'the first receipt is the one kept');

select * from finish();
rollback;
