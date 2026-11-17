-- Migration 20261117160000 (WO-CAT-8): the three meters agree on whose plan governs a workspace.
--
-- One rule, foundation_workspace_capped_plan(workspace): the plan_code of the workspace's billing
-- account, unless the user OF THAT ACCOUNT holds an active operator grant. The query meter now reads
-- it inside admit_foundation_knowledge_query (the server passes the catalog map, CAT-D10), and the
-- storage and seat meters read it instead of their own variants. An operator who is merely an owner,
-- member or uploader of a customer workspace does not uncap it.
--
-- Also here: a query unit is never counted after its hold expired (the clock is moved by updating
-- expires_at, never by sleeping), and the storage meter's input guards run before the allowance.
--
-- Users (the signup trigger bootstraps workspace ws(i), owned by user i):
--   1  Team account (no grant)                       5  Personal account, operator grant on 5
--   2  legacy studio_access account (plan_code null)  6  operator (active grant, trial exempt)
--   3  no billing account                             7  Personal account, operator 6 made its owner
--   4  Team account, inactive grant on 4              8  Personal account (storage guards)
begin;
select plan(32);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000',
  (lpad(i::text, 8, '0') || '-c108-4c08-8c08-c108c108c108')::uuid,
  'authenticated', 'authenticated', 'closure-' || i || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 40) i;

create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-c108-4c08-8c08-c108c108c108')::uuid
$$;
create function pg_temp.ws(i integer) returns text language sql immutable as $$
  select 'pilot-' || left(regexp_replace(pg_temp.uid(i)::text, '[^A-Za-z0-9]', '', 'g'), 16)
$$;
create function pg_temp.plan(owner integer, access text, code text) returns void language sql as $$
  insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status)
  values (pg_temp.ws(owner), pg_temp.uid(owner), access, code, 'active')
$$;
create function pg_temp.kqu(owner integer, limits jsonb) returns text language plpgsql as $$
declare v jsonb;
begin
  v := public.admit_foundation_knowledge_query(pg_temp.ws(owner), limits);
  if v->>'status' = 'admitted' then
    perform public.settle_foundation_knowledge_query((v->>'hold_id')::uuid, true);
  end if;
  return v->>'status';
end;
$$;
create function pg_temp.kqu_times(owner integer, limits jsonb, n integer) returns text language sql as $$
  select string_agg(pg_temp.kqu(owner, limits), ',' order by i) from generate_series(1, n) i
$$;
create function pg_temp.used(owner integer) returns integer language sql as $$
  select coalesce((select used_units from public.foundation_knowledge_query_windows
    where workspace_key = pg_temp.ws(owner) and window_started_at = date_trunc('month', clock_timestamp(), 'UTC')), 0)
$$;
create function pg_temp.invite(owner integer, actor integer, i integer) returns text language plpgsql as $$
begin
  return public.create_foundation_workspace_invite(pg_temp.ws(owner), pg_temp.uid(actor),
    'closure-' || i || '@example.invalid', 'member', 'sha256:' || md5('closure-' || i) || md5('closure-' || i || '#'),
    'closure_idempotency_' || lpad(i::text, 4, '0'), now() + interval '1 hour', 'closure-invite-' || i,
    '{"personal":1,"developer":1,"team":5,"business":20}'::jsonb)->>'state';
exception when others then return sqlerrm;
end;
$$;
create function pg_temp.store(owner integer, uploader integer, doc integer, bytes integer, limits jsonb) returns text language plpgsql as $$
declare v_doc uuid := (lpad(doc::text, 8, '0') || '-d0c0-4d0c-8d0c-d0c0d0c0d0c0')::uuid;
begin
  return public.reserve_foundation_intake_admission(pg_temp.ws(owner), v_doc, pg_temp.uid(uploader),
    'quarantine/' || pg_temp.ws(owner) || '/' || v_doc || '/source', bytes, 'application/pdf', limits)->>'intakeClass';
exception when others then return sqlerrm;
end;
$$;

select pg_temp.plan(1, 'studio_access', 'team');
select pg_temp.plan(2, 'studio_access', null);
select pg_temp.plan(4, 'studio_access', 'team');
select pg_temp.plan(5, 'observer_access', 'personal');
select pg_temp.plan(7, 'observer_access', 'personal');
select pg_temp.plan(8, 'observer_access', 'personal');
insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, billing_exempt, trial_exempt, active)
values (pg_temp.uid(4), 'owner', 'studio_access', true, true, false),
       (pg_temp.uid(5), 'owner', 'studio_access', true, true, true),
       (pg_temp.uid(6), 'owner', 'studio_access', true, true, true);
-- Operator 6 becomes the owner of customer workspace ws(7); the account holder 7 stays an admin.
update public.foundation_workspace_members set role = 'admin' where workspace_key = pg_temp.ws(7) and user_id = pg_temp.uid(7);
insert into public.foundation_workspace_members (workspace_key, user_id, role, state, invited_by, invited_at, accepted_at)
values (pg_temp.ws(7), pg_temp.uid(6), 'owner', 'active', pg_temp.uid(7), now(), now());

-- 1-7: one rule.
select is(public.foundation_workspace_capped_plan(pg_temp.ws(1)), 'team', 'a v2 account caps its workspace by its plan_code');
select is(public.foundation_workspace_capped_plan(pg_temp.ws(2)), null, 'a legacy plan (plan_code null) is not capped');
select is(public.foundation_workspace_capped_plan(pg_temp.ws(3)), null, 'a workspace with no billing account is not capped');
select is(public.foundation_workspace_capped_plan(pg_temp.ws(4)), 'team', 'an inactive grant does not uncap');
select is(public.foundation_workspace_capped_plan(pg_temp.ws(5)), null, 'an operator grant on the account''s own user uncaps it');
select is(public.foundation_workspace_capped_plan(pg_temp.ws(7)), 'personal',
  'an operator who becomes the owner of a customer workspace does not uncap the customer''s plan');
select ok(not has_function_privilege('service_role', 'public.foundation_workspace_capped_plan(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.foundation_workspace_capped_plan(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.foundation_workspace_capped_plan(text)', 'EXECUTE'),
  'the rule is reached only through the three meters');

-- 8-15: the query meter resolves the limit by workspace, in SQL, from the catalog map. (Run as the
-- table owner so the counter can be read back; test 15 pins that the server role may call it.)
select is(pg_temp.kqu_times(1, '{"personal": 1, "team": 2}', 3), 'admitted,admitted,exhausted',
  'team: the workspace''s plan entry governs (2), not another plan''s');
select is(pg_temp.kqu_times(2, '{"personal": 1, "team": 1}', 4), 'admitted,admitted,admitted,admitted',
  'legacy: counted, never refused, whatever the map');
select is(pg_temp.used(2), 4, 'legacy: every answered query counted');
select is(pg_temp.kqu_times(5, '{"personal": 1}', 3), 'admitted,admitted,admitted', 'an operator-granted account: never refused');
select is(pg_temp.kqu_times(7, '{"personal": 1}', 2), 'admitted,exhausted',
  'an operator owning a customer workspace: the customer''s allowance still holds');
select throws_ok($$select public.admit_foundation_knowledge_query(pg_temp.ws(4), '{"personal": 1}')$$,
  'knowledge_query_meter_contract_invalid', 'a v2 plan the map has no entry for is refused, never uncapped');
select throws_ok($$select public.admit_foundation_knowledge_query(pg_temp.ws(4), '{"team": 0}')$$,
  'knowledge_query_meter_contract_invalid', 'a zero, negative or fractional entry is a contract error');
select ok(to_regprocedure('public.admit_foundation_knowledge_query(text, integer)') is null
  and has_function_privilege('service_role', 'public.admit_foundation_knowledge_query(text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.admit_foundation_knowledge_query(text, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admit_foundation_knowledge_query(text, jsonb)', 'EXECUTE'),
  'the caller-supplied limit is gone; only the server calls the map signature');

-- 16-19: a unit is never counted after its hold expired (limit N admits exactly N under a slow request).
create temp table slow as select (public.admit_foundation_knowledge_query(pg_temp.ws(4), '{"team": 3}')->>'hold_id')::uuid as id;
select is(pg_temp.kqu_times(4, '{"team": 3}', 3), 'admitted,admitted,exhausted', 'a live hold reserves its unit');
update public.foundation_knowledge_query_holds set expires_at = clock_timestamp() - interval '1 second'
  where hold_id = (select id from slow);
select is(pg_temp.kqu(4, '{"team": 3}'), 'admitted', 'the clock passed the hold: its unit is admitted to another request');
select is(public.settle_foundation_knowledge_query((select id from slow), true), false,
  'the slow request settles after its hold expired: refused');
select is(pg_temp.used(4) * 10 + (select count(*)::integer from public.foundation_knowledge_query_holds where workspace_key = pg_temp.ws(4)), 30,
  'limit 3 counted exactly 3, and the expired hold is gone');

-- 20-23: seats follow the same rule.
select is((select string_agg(pg_temp.invite(7, 6, i), ',' order by i) from generate_series(11, 11) i), 'workspace_seat_limit_reached',
  'seats: an operator owning a Personal customer workspace cannot pass its one seat');
select is((select string_agg(pg_temp.invite(5, 5, i), ',' order by i) from generate_series(12, 14) i), 'pending,pending,pending',
  'seats: the operator''s own account is uncapped');
select is((select string_agg(pg_temp.invite(1, 1, i), ',' order by i) from generate_series(15, 19) i),
  'pending,pending,pending,pending,workspace_seat_limit_reached', 'seats: team still stops at five');
select is(pg_temp.invite(2, 2, 20), 'pending', 'seats: legacy stays uncapped');

-- 24-29: storage follows the same rule, and its input guards come before the allowance.
set local role service_role;
select is(pg_temp.store(7, 7, 1, 2048, '{"personal": 2048}'), 'paid', 'storage: the customer fills its allowance');
select is(pg_temp.store(7, 6, 2, 1, '{"personal": 2048}'), 'foundation_storage_allowance_exhausted',
  'storage: an operator uploading into the full customer workspace is refused like anyone else');
select is(pg_temp.store(5, 5, 3, 4096, '{"personal": 1}'), 'owner', 'storage: the operator''s own account is uncapped');
select is(pg_temp.store(7, 7, 4, 5242881, '{"personal": 2048}'), 'foundation_intake_file_too_large',
  'storage: an over-size file into a full workspace is refused as too large, as in a workspace with room');
select is(pg_temp.store(8, 8, 5, 5242881, '{"personal": 999999999}'), 'foundation_intake_file_too_large',
  'storage: the same file into a workspace with room');
reset role;
select is((select count(*)::integer from public.foundation_intake_admissions where workspace_key = pg_temp.ws(7)), 1,
  'storage: a refused admission leaves no row');

-- 30-32: the inner function's idempotency rules also come first in a full workspace.
set local role service_role;
select is(pg_temp.store(7, 8, 1, 2048, '{"personal": 2048}'), 'foundation_intake_idempotency_conflict',
  'storage: the same document from another user is an idempotency conflict, not an allowance refusal');
select is(coalesce(pg_temp.store(7, 7, 1, 2048, '{"personal": 2048}'), 'answered'), 'answered',
  'storage: a replay of a live admission in a full workspace is answered, not re-checked');
reset role;
select is((select count(*)::integer from public.foundation_intake_admissions where workspace_key = pg_temp.ws(7)), 1,
  'storage: and the replay added no row');

select * from finish();
rollback;
