-- The query (KQU) and storage meters for a billing account no plan was ever projected into
-- (WO-METER-NULLPLAN-1, migration 20261127070000).
--
-- Paddle does not order its webhooks. When transaction.completed (the allowance,
-- apply_foundation_billing_event_v4) lands before the subscription event, it creates the workspace's billing
-- account with access_plan and plan_code both null. foundation_workspace_capped_plan returns null for that
-- row, and both meters read null as "no cap": until 20261127070000 a new Personal or Developer buyer's
-- workspace was uncapped on queries and storage until the subscription event projected, and for good when it
-- never did. Such an account is now metered at Free's allowance (PB-2026-11-V22: 100 KQU a month, 1 GB).
--
-- Every other row class answers as before, each with a fixture here: a v2 plan (its limit), a v2 plan whose
-- holder has an operator grant, a retired legacy plan (access_plan set, plan_code null), an operator-granted
-- owner of an account with no plan, and Free with no billing account at all (uncapped at the meter, as today).
--
-- Billing events go through apply_foundation_billing_event_v6, the webhook's one entry point, bound to a
-- checkout intent as the checkout route records it. The limit maps are the ones the server sends
-- (nextjs/lib/kqu-meter.ts KQU_LIMITS, nextjs/lib/intake-admission.ts STORAGE_LIMIT_BYTES).
begin;
select plan(42);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000',
  (lpad(i::text, 8, '0') || '-3e7e-4e7e-8e7e-3e7e3e7e3e7e')::uuid,
  'authenticated', 'authenticated', 'meter-' || i || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 20) i;

create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-3e7e-4e7e-8e7e-3e7e3e7e3e7e')::uuid
$$;
-- The workspace the signup trigger bootstraps for user i, owned by user i.
create function pg_temp.ws(i integer) returns text language sql immutable as $$
  select 'pilot-' || left(regexp_replace(pg_temp.uid(i)::text, '[^A-Za-z0-9]', '', 'g'), 16)
$$;
create function pg_temp.id(prefix text, tag text) returns text language sql immutable as $$
  select prefix || '_' || lpad(tag, 26, '0')
$$;
create function pg_temp.nonce(i integer) returns uuid language sql immutable as $$
  select ('3e7e3e7e-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
$$;
create function pg_temp.intent(i integer, offer text) returns text language sql as $$
  select public.issue_foundation_checkout_intent(pg_temp.nonce(i), pg_temp.ws(i), pg_temp.uid(i), offer,
    'checkout-v1', pg_temp.id('pri', 'p' || i), 2000, now())->>'status'
$$;
create function pg_temp.v6(evt text, typ text, i integer, offer text, sub text) returns text language sql as $$
  select public.apply_foundation_billing_event_v6(
    pg_temp.id('evt', evt), typ, now(), 'sha256:' || md5(evt) || md5(evt || '#'),
    case when typ = 'transaction.completed' then 'allowance' else 'subscription' end,
    pg_temp.ws(i), pg_temp.uid(i), offer,
    case when typ = 'transaction.completed' then pg_temp.id('txn', 't' || i) end,
    pg_temp.id('ctm', 'c' || i), pg_temp.id('sub', sub),
    case when typ = 'transaction.completed' then null else 'active' end,
    null, pg_temp.nonce(i)::text, now(), 'checkout-v1', pg_temp.id('pri', 'p' || i), null)->>'status'
$$;
create function pg_temp.row_plan(i integer) returns text language sql as $$
  select coalesce(access_plan, 'null') || '/' || coalesce(plan_code, 'null')
    from public.foundation_billing_accounts where workspace_key = pg_temp.ws(i)
$$;
create function pg_temp.account(i integer, access text, code text) returns void language sql as $$
  insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status)
  values (pg_temp.ws(i), pg_temp.uid(i), access, code, case when access is null then 'inactive' else 'active' end)
$$;
create function pg_temp.grant_to(i integer, is_active boolean) returns void language sql as $$
  insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, billing_exempt, trial_exempt, active)
  values (pg_temp.uid(i), 'owner', 'studio_access', true, true, is_active)
$$;

-- The query meter: one admission settled as answered; the result is the admission's status.
create function pg_temp.kqu(i integer, limits jsonb) returns text language plpgsql as $$
declare v jsonb;
begin
  v := public.admit_foundation_knowledge_query(pg_temp.ws(i), limits);
  if v->>'status' = 'admitted' then
    perform public.settle_foundation_knowledge_query((v->>'hold_id')::uuid, true);
  end if;
  return v->>'status';
end;
$$;
-- n answered queries; the count of each status, e.g. "admitted:100,exhausted:1".
create function pg_temp.kqu_times(i integer, limits jsonb, n integer) returns text language sql as $$
  select string_agg(s || ':' || c, ',' order by s) from (
    select s, count(*) c from (select pg_temp.kqu(i, limits) s from generate_series(1, n)) x group by s) y
$$;
create function pg_temp.kqu_catalog() returns jsonb language sql immutable as $$
  select '{"personal":1000,"developer":5000,"team":10000,"business":50000}'::jsonb
$$;
create function pg_temp.used(i integer) returns integer language sql as $$
  select coalesce((select used_units from public.foundation_knowledge_query_windows
    where workspace_key = pg_temp.ws(i) and window_started_at = date_trunc('month', clock_timestamp(), 'UTC')), 0)
$$;

-- The storage meter. preload writes n confirmed 5 MiB uploads from two days ago (outside the intake rate
-- windows), so a test reaches Free's 1 GB without 190 calls; store admits one more file.
create function pg_temp.preload(i integer, n integer) returns void language sql as $$
  insert into public.foundation_intake_admissions (workspace_key, document_id, user_id, object_key, requested_bytes,
    declared_mime_type, created_at, updated_at, expires_at, confirmed_at)
  select pg_temp.ws(i), d, pg_temp.uid(i), 'quarantine/' || pg_temp.ws(i) || '/' || d || '/source', 5242880,
    'application/pdf', now() - interval '2 days', now() - interval '2 days',
    now() - interval '2 days' + interval '10 minutes', now() - interval '2 days' + interval '1 minute'
  from (select ('3e7e' || lpad(i::text, 4, '0') || '-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid d
          from generate_series(1, n) k) x
$$;
create function pg_temp.store(i integer, doc integer, bytes integer, limits jsonb) returns text language plpgsql as $$
declare v_doc uuid := ('3e7e' || lpad(i::text, 4, '0') || '-d0c0-4d0c-8d0c-' || lpad(doc::text, 12, '0'))::uuid;
begin
  perform public.reserve_foundation_intake_admission(pg_temp.ws(i), v_doc, pg_temp.uid(i),
    'quarantine/' || pg_temp.ws(i) || '/' || v_doc || '/source', bytes, 'application/pdf', limits);
  return 'admitted';
exception when raise_exception then
  return sqlerrm;
end;
$$;
create function pg_temp.storage_catalog() returns jsonb language sql immutable as $$
  select '{"personal":10000000000,"developer":10000000000,"team":100000000000,"business":500000000000}'::jsonb
$$;
-- 190 preloaded files are 996,147,200 bytes; this many more reach Free's 1,000,000,000 exactly.
create function pg_temp.to_free() returns integer language sql immutable as $$ select 1000000000 - 190 * 5242880 $$;

-- 1. Transaction first (Personal). Until the subscription event lands the row has no plan at all.
select is(pg_temp.intent(1, 'personal'), 'issued', 'A: the Personal checkout intent is recorded');
select is(pg_temp.v6('a1', 'transaction.completed', 1, 'personal', 's1'), 'allowance_granted', 'A: transaction.completed lands first');
select is(pg_temp.row_plan(1), 'null/null', 'A: the allowance created the billing row with no access level and no plan code');
select is(pg_temp.kqu_times(1, pg_temp.kqu_catalog(), 100), 'admitted:100', 'A: Free''s 100 queries are admitted in the window');
select is(pg_temp.kqu(1, pg_temp.kqu_catalog()), 'exhausted', 'A: the 101st query is refused (was: uncapped)');
select is(pg_temp.used(1), 100, 'A: the refusal counted nothing');
select pg_temp.preload(1, 190);
select is(pg_temp.store(1, 1, pg_temp.to_free(), pg_temp.storage_catalog()), 'admitted', 'A: storage is admitted up to exactly 1 GB');
select is(pg_temp.store(1, 2, 1, pg_temp.storage_catalog()), 'foundation_storage_allowance_exhausted',
  'A: one byte over 1 GB is refused (was: uncapped)');
select is((select count(*)::integer from public.foundation_intake_admissions where workspace_key = pg_temp.ws(1)), 191,
  'A: the refused upload wrote no row');
select is(pg_temp.v6('a1', 'transaction.completed', 1, 'personal', 's1'), 'duplicate', 'A: a redelivered transaction is a duplicate');
select is(pg_temp.kqu(1, pg_temp.kqu_catalog()), 'exhausted', 'A: and the window is still metered as Free');
-- The plan lands: its own allowance applies, and the units already used count toward it.
select is(pg_temp.v6('a2', 'subscription.created', 1, 'personal', 's1'), 'processed', 'A: subscription.created arrives second');
select is(pg_temp.row_plan(1), 'observer_access/personal', 'A: the row now names the plan');
select is(pg_temp.kqu(1, pg_temp.kqu_catalog()), 'admitted', 'A: Personal''s allowance now applies');
select is(pg_temp.used(1), 101, 'A: the window''s units carried over');
select is(pg_temp.store(1, 2, 1, pg_temp.storage_catalog()), 'admitted', 'A: Personal''s 10 GB now applies');

-- 2. Transaction first and the subscription event never projects (refused: another subscription on the
--    same binding). The row keeps no plan for good, so it stays metered as Free for good.
select is(pg_temp.intent(3, 'developer'), 'issued', 'C: the Developer checkout intent is recorded');
select is(pg_temp.v6('c1', 'transaction.completed', 3, 'developer', 's3'), 'allowance_granted', 'C: transaction.completed first');
select is(pg_temp.v6('c2', 'subscription.created', 3, 'developer', 'x3'), 'binding_rejected',
  'C: a subscription event that does not match the binding is refused');
select is(pg_temp.row_plan(3), 'null/null', 'C: the row still has no plan');
select is(pg_temp.kqu_times(3, pg_temp.kqu_catalog(), 101), 'admitted:100,exhausted:1', 'C: queries stop at 100 (was: uncapped for good)');
select pg_temp.preload(3, 190);
select is(pg_temp.store(3, 1, pg_temp.to_free() + 1, pg_temp.storage_catalog()), 'foundation_storage_allowance_exhausted',
  'C: storage stops at 1 GB (was: uncapped for good)');

-- 3. A billing row with no plan whose holder's operator grant is inactive is metered as Free (the grant
--    exemption reads `active`).
select pg_temp.account(5, null, null);
select pg_temp.grant_to(5, false);
select is(pg_temp.kqu_times(5, pg_temp.kqu_catalog(), 101), 'admitted:100,exhausted:1', 'no plan, inactive grant: Free''s 100 queries');

-- 4. Unchanged: a v2 plan answers to its own entry of the map.
select pg_temp.account(7, 'observer_access', 'personal');
select is(pg_temp.kqu_times(7, '{"personal":3}'::jsonb, 4), 'admitted:3,exhausted:1', 'v2 plan: its map entry is its limit, as before');
select is(pg_temp.store(7, 1, 2048, '{"personal":2048}'::jsonb), 'admitted', 'v2 plan: storage to its entry, as before');
select is(pg_temp.store(7, 2, 1, '{"personal":2048}'::jsonb), 'foundation_storage_allowance_exhausted', 'v2 plan: and no further');
select is(pg_temp.store(7, 3, 1, '{}'::jsonb), 'foundation_storage_limit_missing', 'v2 plan with no map entry: refused, as before');

-- 5. Unchanged: a retired legacy plan (an access level, no plan code) is counted and never capped.
select pg_temp.account(9, 'studio_access', null);
select is(pg_temp.kqu_times(9, pg_temp.kqu_catalog(), 101), 'admitted:101', 'legacy plan: past 100 queries, uncapped as before');
select is(pg_temp.used(9), 101, 'legacy plan: still counted');
select pg_temp.preload(9, 191);
select is(pg_temp.store(9, 1, 1, pg_temp.storage_catalog()), 'admitted', 'legacy plan: past 1 GB, uncapped as before');

-- 6. Unchanged: a v2 plan whose holder has an active operator grant is uncapped.
select pg_temp.account(11, 'observer_access', 'personal');
select pg_temp.grant_to(11, true);
select is(pg_temp.kqu_times(11, '{"personal":3}'::jsonb, 4), 'admitted:4', 'v2 plan, operator-granted holder: uncapped as before');

-- 7. Unchanged: an account with no plan whose holder and owner has an active operator grant is uncapped.
select pg_temp.account(13, null, null);
select pg_temp.grant_to(13, true);
select is(pg_temp.kqu_times(13, pg_temp.kqu_catalog(), 101), 'admitted:101', 'no plan, operator-granted owner: queries uncapped as before');
select pg_temp.preload(13, 191);
select is(pg_temp.store(13, 1, 1, pg_temp.storage_catalog()), 'admitted', 'no plan, operator-granted owner: storage uncapped as before');

-- 8. Unchanged: an operator who is the active owner (not the account holder) of a workspace whose account
--    has no plan keeps it uncapped, the rule foundation_workspace_seat_limit applies to the founder's workspace.
select pg_temp.account(15, null, null);
select pg_temp.grant_to(16, true);
update public.foundation_workspace_members set role = 'admin' where workspace_key = pg_temp.ws(15) and user_id = pg_temp.uid(15);
insert into public.foundation_workspace_members (workspace_key, user_id, role, state, invited_by, invited_at, accepted_at)
values (pg_temp.ws(15), pg_temp.uid(16), 'owner', 'active', pg_temp.uid(15), now(), now());
select is(pg_temp.kqu_times(15, pg_temp.kqu_catalog(), 101), 'admitted:101', 'no plan, operator-granted active owner: uncapped as before');
select pg_temp.preload(15, 191);
select is(pg_temp.store(15, 1, 1, pg_temp.storage_catalog()), 'admitted', 'no plan, operator-granted active owner: storage uncapped as before');

-- 8b. Unchanged: the account's holder has an active operator grant but is no longer the owner (the exemption
--     foundation_workspace_capped_plan reads is the holder's): uncapped as before.
select pg_temp.account(19, null, null);
select pg_temp.grant_to(19, true);
update public.foundation_workspace_members set role = 'admin' where workspace_key = pg_temp.ws(19) and user_id = pg_temp.uid(19);
insert into public.foundation_workspace_members (workspace_key, user_id, role, state, invited_by, invited_at, accepted_at)
values (pg_temp.ws(19), pg_temp.uid(20), 'owner', 'active', pg_temp.uid(19), now(), now());
select is(pg_temp.kqu_times(19, pg_temp.kqu_catalog(), 101), 'admitted:101', 'no plan, operator-granted holder who is not the owner: queries as before');
select pg_temp.preload(19, 191);
select is(pg_temp.store(19, 1, 1, pg_temp.storage_catalog()), 'admitted', 'no plan, operator-granted holder who is not the owner: storage as before');

-- 9. Unchanged: Free with no billing account at all is not capped by these two meters (the app bounds it by
--    the free evaluation). This file changes only workspaces that have an account row.
select is((select count(*)::integer from public.foundation_billing_accounts where workspace_key = pg_temp.ws(17)), 0,
  'Free: no billing account');
select is(pg_temp.kqu_times(17, pg_temp.kqu_catalog(), 101), 'admitted:101', 'Free with no billing account: queries as before');
select pg_temp.preload(17, 191);
select is(pg_temp.store(17, 1, 1, pg_temp.storage_catalog()), 'admitted', 'Free with no billing account: storage as before');

-- 10. The rule is not reachable by a client: neither browser role executes the meters.
select ok(not has_function_privilege('authenticated', 'public.admit_foundation_knowledge_query(text, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admit_foundation_knowledge_query(text, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.admit_foundation_knowledge_query(text, jsonb)', 'EXECUTE'),
  'the query meter: the server only');
select ok(not has_function_privilege('authenticated',
    'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)', 'EXECUTE'),
  'the storage meter: no browser role');

select * from finish();
rollback;
