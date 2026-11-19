-- Catalog v2 offer codes (20261117140000, WO-CAT-3): plan identity beside an unchanged access level.
-- Credit amounts are the catalog's (nextjs/lib/billing-catalog.ts): personal 2,000, team 12,000,
-- observer_access 2,000. The checkout route records them in the intent; nothing here invents one.
begin;
select plan(45);

-- Fixtures: one user per workspace (foundation_billing_accounts.user_id is unique).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000',
  (lpad(i::text, 8, '0') || '-c2c2-4c2c-8c2c-c2c2c2c2c2c2')::uuid,
  'authenticated', 'authenticated', 'catalog-v2-' || i || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 100) i;

create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-c2c2-4c2c-8c2c-c2c2c2c2c2c2')::uuid
$$;
create function pg_temp.id(prefix text, tag text) returns text language sql immutable as $$
  select prefix || '_' || lpad(tag, 26, '0')
$$;
create function pg_temp.raises(q text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when invalid_parameter_value then
  return true;
end $$;
-- Paddle ids are [a-z0-9]{26} after the prefix; the workspace's suffix keeps them distinct.
create function pg_temp.ctm(ws text) returns text language sql immutable as $$
  select pg_temp.id('ctm', replace(ws, 'pilot-', ''))
$$;
create function pg_temp.nonce(tag integer) returns text language sql immutable as $$
  select 'd3d3d3d3-0000-4000-8000-' || lpad(tag::text, 12, '0')
$$;
create function pg_temp.intent(tag integer, ws text, usr uuid, offer text, credit integer) returns jsonb language sql as $$
  select public.issue_foundation_checkout_intent(
    pg_temp.nonce(tag)::uuid, ws, usr, offer, 'checkout-v1', pg_temp.id('pri', 'p' || tag), credit, now())
$$;
-- The webhook's call: a bound event, settled against the intent with the same tag.
create function pg_temp.v6(evt text, typ text, at timestamptz, act text, ws text, usr uuid, offer text,
  txn text, sub text, status text, tag integer, configured integer default null, price text default null)
returns jsonb language sql as $$
  select public.apply_foundation_billing_event_v6(
    pg_temp.id('evt', evt), typ, at, 'sha256:' || md5(evt) || md5(evt || '#'), act, ws, usr, offer,
    case when txn is null then null else pg_temp.id('txn', txn) end, pg_temp.ctm(ws),
    sub, status, null, pg_temp.nonce(tag), now(), 'checkout-v1',
    coalesce(price, pg_temp.id('pri', 'p' || tag)), configured)
$$;

-- 1. The mapping names six codes and raises for every other one.
select is(
  (select string_agg(c || '=' || public.foundation_offer_access_plan(c), ',' order by c)
    from unnest(array['business', 'developer', 'observer_access', 'personal', 'studio_access', 'team']) c),
  'business=studio_access,developer=observer_access,observer_access=observer_access,personal=observer_access,studio_access=studio_access,team=studio_access',
  'personal/developer -> observer_access, team/business -> studio_access, legacy codes -> themselves'
);
select is(
  (select count(*)::integer from unnest(array['enterprise', 'free', 'Personal', 'Team ', 'observer', 'credit_starter', '', null]) c
    where pg_temp.raises($q$select public.foundation_offer_access_plan($q$ || coalesce(quote_literal(c), 'null') || $q$)$q$)),
  8,
  'every code the mapping does not name raises invalid_parameter_value, null included'
);

-- 2. Intents: a v2 code is accepted, an unknown one refused before anything is written.
select is(pg_temp.intent(1, 'pilot-cv2a', pg_temp.uid(1), 'personal', 2000)->>'status', 'issued', 'an intent for personal is accepted');
select throws_ok(
  $$select pg_temp.intent(2, 'pilot-cv2a', pg_temp.uid(1), 'enterprise', 2000)$$,
  '22023', 'foundation_offer_code_unknown', 'an intent for an unknown code is refused'
);
select is((select count(*)::integer from public.foundation_checkout_intents where workspace_key = 'pilot-cv2a'), 1,
  'the refused intent left no row');

-- 3. personal: settles exactly the catalog's credits; access_plan = observer_access, plan_code = personal.
select is(
  pg_temp.v6('cv2a1', 'subscription.created', now(), 'subscription', 'pilot-cv2a', pg_temp.uid(1), 'personal',
    null, pg_temp.id('sub', 'cv2a'), 'active', 1)->>'status',
  'processed', 'the personal subscription is projected');
select is(
  pg_temp.v6('cv2a2', 'transaction.completed', now(), 'allowance', 'pilot-cv2a', pg_temp.uid(1), 'personal',
    'cv2a1', pg_temp.id('sub', 'cv2a'), null, 1)->>'status',
  'allowance_granted', 'the personal payment grants its allowance');
select is(
  (select access_plan || '/' || plan_code || '/' || credit_balance || '/' || subscription_status
    from public.foundation_billing_accounts where workspace_key = 'pilot-cv2a'),
  'observer_access/personal/2000/active',
  'personal: 2,000 credits, access_plan observer_access, plan_code personal');
select is(
  (select offer_code || ':' || credit_delta from public.foundation_credit_ledger
    where workspace_key = 'pilot-cv2a' and kind = 'allowance'),
  'personal:2000', 'the grant row names the plan, not the level');
select is(
  (select offer_code from public.foundation_checkout_binding_consumptions where nonce = pg_temp.nonce(1)::uuid),
  'personal', 'the consumed binding names the plan');

-- 4. A duplicate v2 event is a replay: no second credit.
select is(
  pg_temp.v6('cv2a2', 'transaction.completed', now(), 'allowance', 'pilot-cv2a', pg_temp.uid(1), 'personal',
    'cv2a1', pg_temp.id('sub', 'cv2a'), null, 1)->>'status',
  'duplicate', 'a redelivered v2 payment is a duplicate');
select is(
  pg_temp.v6('cv2a3', 'transaction.completed', now(), 'allowance', 'pilot-cv2a', pg_temp.uid(1), 'personal',
    'cv2a1', pg_temp.id('sub', 'cv2a'), null, 1)->>'status',
  'duplicate_transaction', 'the same transaction under a new event id grants nothing');
select is((select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-cv2a'), 2000,
  'the balance is still exactly one grant');

-- 5. A reversal of a v2 purchase is applied.
select is(
  public.apply_foundation_billing_event_v6(
    pg_temp.id('evt', 'cv2a4'), 'adjustment.updated', now(), 'sha256:' || repeat('4', 64), 'reversal',
    null, null, null, pg_temp.id('txn', 'cv2a1'), null, null, null, pg_temp.id('adj', 'cv2a4'))->>'status',
  'reversal_applied', 'a refund of the personal payment is applied');
select is(
  (select credit_balance || '/' || billing_hold from public.foundation_billing_accounts where workspace_key = 'pilot-cv2a'),
  '0/true', 'the reversal takes the grant back and holds the account');
select is(
  (select offer_code || ':' || credit_delta from public.foundation_credit_ledger
    where workspace_key = 'pilot-cv2a' and kind = 'reversed'),
  'personal:-2000', 'the reversal row names the plan it reverses');

-- 6. team maps to studio_access.
select is(pg_temp.intent(3, 'pilot-cv2b', pg_temp.uid(2), 'team', 12000)->>'status', 'issued', 'an intent for team is accepted');
select is(
  pg_temp.v6('cv2b1', 'transaction.completed', now(), 'allowance', 'pilot-cv2b', pg_temp.uid(2), 'team',
    'cv2b1', pg_temp.id('sub', 'cv2b'), null, 3)->>'status',
  'allowance_granted', 'the team payment bootstraps from its intent');
select is(
  pg_temp.v6('cv2b2', 'subscription.created', now(), 'subscription', 'pilot-cv2b', pg_temp.uid(2), 'team',
    null, pg_temp.id('sub', 'cv2b'), 'active', 3)->>'status',
  'processed', 'the team subscription is projected');
select is(
  (select access_plan || '/' || plan_code || '/' || credit_balance
    from public.foundation_billing_accounts where workspace_key = 'pilot-cv2b'),
  'studio_access/team/12000', 'team: 12,000 credits, access_plan studio_access, plan_code team');

-- 7. An unknown code is refused by every function that names offer codes.
select is(pg_temp.intent(4, 'pilot-cv2c', pg_temp.uid(3), 'personal', 2000)->>'status', 'issued', 'an intent for the unknown-code probes');
select is(
  pg_temp.v6('cv2c1', 'transaction.completed', now(), 'allowance', 'pilot-cv2c', pg_temp.uid(3), 'Personal',
    'cv2c1', pg_temp.id('sub', 'cv2c'), null, 4)->>'reason',
  'checkout_binding_contract_invalid', 'v6 rejects a payment for an unknown code');
select is(
  (select offer_code || ':' || reason from public.foundation_billing_event_rejections where event_id = pg_temp.id('evt', 'cv2c1')),
  'Personal:checkout_binding_contract_invalid', 'the rejected payment is a durable review row');
select ok(
  not exists (select 1 from public.foundation_billing_accounts where workspace_key = 'pilot-cv2c')
  and not exists (select 1 from public.foundation_checkout_binding_consumptions where nonce = pg_temp.nonce(4)::uuid),
  'nothing settled and no binding consumed for the unknown code');
select throws_ok(
  $$select public.apply_foundation_billing_event_v4(pg_temp.id('evt', 'cv2c2'), 'transaction.completed', now(),
    'sha256:' || repeat('5', 64), 'allowance', 'pilot-cv2c', pg_temp.uid(3), 'enterprise', pg_temp.id('txn', 'cv2c2'),
    pg_temp.ctm('pilot-cv2c'), pg_temp.id('sub', 'cv2c'), null, 2000, null)$$,
  '22023', 'foundation_offer_code_unknown', 'the allowance projection (v4) raises for an unknown code');
select throws_ok(
  $$select public.apply_foundation_billing_event_v3(pg_temp.id('evt', 'cv2c3'), 'subscription.created', now(),
    'sha256:' || repeat('6', 64), 'subscription', 'pilot-cv2c', pg_temp.uid(3), 'free', null,
    pg_temp.ctm('pilot-cv2c'), pg_temp.id('sub', 'cv2c'), 'active', 0, null)$$,
  '22023', 'foundation_offer_code_unknown', 'the subscription projection (v3 -> base) raises for an unknown code');
select throws_ok(
  $$insert into public.foundation_checkout_binding_consumptions (nonce, workspace_key, user_id, offer_code, policy_version,
    initial_action, issued_at, paddle_customer_id, first_event_id)
    values (gen_random_uuid(), 'pilot-cv2c', pg_temp.uid(3), 'observer', 'checkout-v1', 'purchase', now(),
      pg_temp.ctm('pilot-cv2c'), pg_temp.id('evt', 'cv2c4'))$$,
  '22023', 'foundation_offer_code_unknown', 'the consumption table refuses an unknown code');
select throws_ok(
  $$update public.foundation_billing_accounts set plan_code = 'observer_access' where workspace_key = 'pilot-cv2b'$$,
  '23514', null, 'plan_code never holds a legacy code (null is legacy)');
select throws_ok(
  $$update public.foundation_billing_accounts set plan_code = 'personal' where workspace_key = 'pilot-cv2b'$$,
  '23514', null, 'plan_code always agrees with access_plan');
-- 20261117140100 (WO-CAT-3B): the check evaluated to null, and so passed, for a plan code with no level.
select throws_ok(
  $$update public.foundation_billing_accounts set access_plan = null where workspace_key = 'pilot-cv2b'$$,
  '23514', 'new row for relation "foundation_billing_accounts" violates check constraint "foundation_billing_accounts_plan_code_check"',
  'a plan code never stands without an access level');
select lives_ok(
  $$update public.foundation_billing_accounts set access_plan = null, plan_code = null where workspace_key = 'pilot-cv2b'$$,
  'a row with neither a level nor a plan code is still accepted (no plan)');

-- 8. A legacy renewal after the migration settles from its snapshot, unchanged.
select is(pg_temp.intent(5, 'pilot-cv2d', pg_temp.uid(4), 'observer_access', 2000)->>'status', 'issued',
  'a legacy intent from before the sale closed');
select is(
  pg_temp.v6('cv2d1', 'transaction.completed', now(), 'allowance', 'pilot-cv2d', pg_temp.uid(4), 'observer_access',
    'cv2d1', pg_temp.id('sub', 'cv2d'), null, 5)->>'status',
  'allowance_granted', 'the legacy first payment');
select is(
  pg_temp.v6('cv2d2', 'subscription.created', now(), 'subscription', 'pilot-cv2d', pg_temp.uid(4), 'observer_access',
    null, pg_temp.id('sub', 'cv2d'), 'active', 5)->>'status',
  'processed', 'the legacy subscription');
select is(
  pg_temp.v6('cv2d3', 'transaction.completed', now() + interval '31 days', 'allowance', 'pilot-cv2d', pg_temp.uid(4),
    'observer_access', 'cv2d3', pg_temp.id('sub', 'cv2d'), null, 5)->>'status',
  'allowance_granted', 'the legacy renewal after the intent window');
select is(
  (select access_plan || '/' || coalesce(plan_code, 'null') || '/' || credit_balance || '/' || lifetime_allowance_units
    from public.foundation_billing_accounts where workspace_key = 'pilot-cv2d'),
  'observer_access/null/2000/4000',
  'the renewal settles 2,000 from the snapshot, expires the unused month, and keeps the legacy identity');
select is(
  pg_temp.v6('cv2d4', 'transaction.completed', now() + interval '62 days', 'allowance', 'pilot-cv2d', pg_temp.uid(4),
    'observer_access', 'cv2d4', pg_temp.id('sub', 'cv2d'), null, 5, null, pg_temp.id('pri', 'personal'))->>'reason',
  'checkout_price_not_allowed', 'a legacy renewal at a price its snapshot never offered settles nothing without a configured amount');
select is(
  pg_temp.v6('cv2d5', 'transaction.completed', now() + interval '62 days', 'allowance', 'pilot-cv2d', pg_temp.uid(4),
    'personal', 'cv2d5', pg_temp.id('sub', 'cv2d'), null, 5)->>'reason',
  'checkout_binding_reuse_conflict', 'a legacy binding cannot be settled as a v2 plan');
select is((select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-cv2d'), 2000,
  'neither refused renewal moved the legacy balance');

-- 9. Plan changes: the projection replaces a held subscription only after its cancellation is
-- scheduled, and only into a v2 plan the workspace does not hold (or legacy Developer -> legacy
-- Team, as 0010/0011 always did). nextjs/lib/checkout-policy.ts `projectionAdmitsReplacement` is
-- this table; checkout-policy.test.ts holds `decideSubscriptionChange` to it over every pair.
create function pg_temp.change(i integer, held text, target text, scheduled boolean) returns text language plpgsql as $$
declare
  ws text := 'pilot-cv2m' || i;
  usr uuid := pg_temp.uid(10 + i);
  r jsonb;
begin
  perform pg_temp.intent(1000 + i, ws, usr, held, 100);
  perform pg_temp.v6('m' || i || 'a', 'subscription.created', now(), 'subscription', ws, usr, held,
    null, pg_temp.id('sub', 'm' || i || 'a'), 'active', 1000 + i);
  if scheduled then
    perform public.apply_foundation_subscription_schedule(pg_temp.id('evt', 'm' || i || 'a'), ws,
      pg_temp.id('sub', 'm' || i || 'a'), now() + interval '20 days');
  end if;
  perform pg_temp.intent(2000 + i, ws, usr, target, 100);
  r := pg_temp.v6('m' || i || 'b', 'subscription.created', now() + interval '1 minute', 'subscription', ws, usr, target,
    null, pg_temp.id('sub', 'm' || i || 'b'), 'active', 2000 + i);
  if r->>'status' = 'processed_subscription_upgrade' then
    if (select access_plan is distinct from public.foundation_offer_access_plan(target)
          or plan_code is distinct from nullif(target, public.foundation_offer_access_plan(target))
          or paddle_subscription_id <> pg_temp.id('sub', 'm' || i || 'b')
          or subscription_cancel_at is not null
        from public.foundation_billing_accounts where workspace_key = ws) then
      return 'BAD';
    end if;
    return 'Y';
  end if;
  if r->>'status' = 'stale_or_mismatched_subscription' and exists (
      select 1 from public.foundation_billing_accounts
      where workspace_key = ws and paddle_subscription_id = pg_temp.id('sub', 'm' || i || 'a')
        and access_plan = public.foundation_offer_access_plan(held)
        and plan_code is not distinct from nullif(held, public.foundation_offer_access_plan(held))) then
    return 'N';
  end if;
  return 'BAD:' || r::text;
end $$;

create temporary table pairs as
select row_number() over (order by h.o, t.o)::integer as i, h.c as held, t.c as target
from unnest(array['observer_access', 'studio_access', 'personal', 'developer', 'team', 'business']) with ordinality h(c, o)
cross join unnest(array['observer_access', 'studio_access', 'personal', 'developer', 'team', 'business']) with ordinality t(c, o);

select is(
  (select string_agg(held || '>' || target || ':' || pg_temp.change(i, held, target, true), ' ' order by i) from pairs),
  (select string_agg(held || '>' || target || ':' ||
      case when (held = 'observer_access' and target = 'studio_access')
             or (target in ('personal', 'developer', 'team', 'business') and held <> target) then 'Y' else 'N' end,
      ' ' order by i) from pairs),
  'with the cancellation scheduled, exactly the admitted pairs are replaced, with the target plan identity'
);
select is(
  (select string_agg(pg_temp.change(36 + i, held, target, false), '' order by i)
    from pairs where held in ('observer_access', 'personal', 'team')),
  repeat('N', 18),
  'without a scheduled cancellation no plan replaces a held subscription'
);

-- 10. A held v2 plan's later events and the expiry floor stay per plan.
select is(
  (select count(*)::integer from public.foundation_billing_accounts
    where workspace_key like 'pilot-cv2m%' and plan_code is not null
      and public.foundation_offer_access_plan(plan_code) <> access_plan),
  0, 'no account holds a plan code above or below its level');

-- 11. Boundaries.
select ok(
  has_function_privilege('service_role', 'public.foundation_offer_access_plan(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.foundation_offer_access_plan(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.foundation_offer_access_plan(text)', 'EXECUTE'),
  'the mapping is not callable by browser roles');
select ok(
  has_function_privilege('service_role', 'public.apply_foundation_billing_event_v6(text,text,timestamptz,text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,text,text,integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.apply_foundation_billing_event_v4(text,text,timestamptz,text,text,text,uuid,text,text,text,text,text,integer,text)', 'EXECUTE'),
  'v6 stays the service-role entry point and v4 stays closed');
-- 20261117140100 (WO-CAT-3B): v3 is reached only through v4 by the function owner; the service role cannot call it,
-- so v6 is the one billing projection function the service role can execute.
select is(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'apply\_foundation\_billing\_event%'
      and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  'apply_foundation_billing_event_v6',
  'v6 is the only billing projection entry point the service role can execute (v3 closed)');

select * from finish();
rollback;
