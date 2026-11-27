-- Seats under every Paddle delivery order (WO-SEAT-RACE-1, migration 20261127050000).
--
-- Paddle does not order its webhooks. For a new subscription it sends transaction.completed (the
-- allowance, apply_foundation_billing_event_v4) and subscription.created/activated/updated (the plan,
-- apply_foundation_billing_event's subscription branch) in any order. The allowance creates the
-- workspace's billing account with access_plan and plan_code both null; only a projected subscription
-- event sets them. Until 20261127050000 such a row was uncapped in seats, so a Personal buyer whose
-- transaction landed first (or whose subscription event never projected) could invite and admit members.
--
-- Every event below goes through apply_foundation_billing_event_v6, the webhook's one entry point, bound to
-- a checkout intent as the checkout route records it. The limits map is nextjs/lib/workspace-membership.ts's.
begin;
select plan(40);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000',
  (lpad(i::text, 8, '0') || '-5eac-4eac-8eac-5eac5eac5eac')::uuid,
  'authenticated', 'authenticated', 'race-' || i || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 99) i;

create function pg_temp.uid(i integer) returns uuid language sql immutable as $$
  select (lpad(i::text, 8, '0') || '-5eac-4eac-8eac-5eac5eac5eac')::uuid
$$;
-- The workspace the signup trigger bootstraps for user i, owned by user i.
create function pg_temp.ws(i integer) returns text language sql immutable as $$
  select 'pilot-' || left(regexp_replace(pg_temp.uid(i)::text, '[^A-Za-z0-9]', '', 'g'), 16)
$$;
create function pg_temp.id(prefix text, tag text) returns text language sql immutable as $$
  select prefix || '_' || lpad(tag, 26, '0')
$$;
create function pg_temp.nonce(i integer) returns uuid language sql immutable as $$
  select ('5eac5eac-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
$$;
-- The checkout route's intent for owner i buying `offer` (credits are the catalog's; not under test here).
create function pg_temp.intent(i integer, offer text) returns text language sql as $$
  select public.issue_foundation_checkout_intent(pg_temp.nonce(i), pg_temp.ws(i), pg_temp.uid(i), offer,
    'checkout-v1', pg_temp.id('pri', 'p' || i), 2000, now())->>'status'
$$;
-- The webhook's call for owner i's checkout. `evt` names the delivery; `sub` the Paddle subscription.
create function pg_temp.v6(evt text, typ text, at timestamptz, i integer, offer text, sub text, status text default 'active')
returns text language sql as $$
  select public.apply_foundation_billing_event_v6(
    pg_temp.id('evt', evt), typ, at, 'sha256:' || md5(evt) || md5(evt || '#'),
    case when typ = 'transaction.completed' then 'allowance' else 'subscription' end,
    pg_temp.ws(i), pg_temp.uid(i), offer,
    case when typ = 'transaction.completed' then pg_temp.id('txn', 't' || i) end,
    pg_temp.id('ctm', 'c' || i), pg_temp.id('sub', sub),
    case when typ = 'transaction.completed' then null else status end,
    null, pg_temp.nonce(i)::text, now(), 'checkout-v1', pg_temp.id('pri', 'p' || i), null)->>'status'
$$;
create function pg_temp.hash(i integer) returns text language sql immutable as $$
  select 'sha256:' || md5('race-token-' || i) || md5('race-token-' || i || '#')
$$;
-- Owner `owner` invites user i; the result is the invite's state or the refusal's message.
create function pg_temp.invite(owner integer, i integer) returns text language plpgsql as $$
begin
  return public.create_foundation_workspace_invite(pg_temp.ws(owner), pg_temp.uid(owner),
    'race-' || i || '@example.invalid', 'member', pg_temp.hash(i), 'race_idempotency_' || lpad(i::text, 4, '0'),
    now() + interval '1 hour', 'race-invite-' || i, '{"personal":1,"developer":1,"team":5,"business":20}'::jsonb)->>'state';
exception when raise_exception then
  return sqlerrm;
end $$;
create function pg_temp.accept(i integer) returns text language plpgsql as $$
begin
  return public.accept_foundation_workspace_invite(pg_temp.uid(i), pg_temp.hash(i), 'race-accept-' || i,
    '{"personal":1,"developer":1,"team":5,"business":20}'::jsonb)->>'state';
exception when raise_exception then
  return sqlerrm;
end $$;
-- An invitation written straight into the table: one pending from before a cap applied.
create function pg_temp.pending(owner integer, i integer) returns void language sql as $$
  insert into public.foundation_workspace_invitations (workspace_key, invitee_email, role, token_hash, idempotency_key, invited_by, expires_at)
  values (pg_temp.ws(owner), 'race-' || i || '@example.invalid', 'member', pg_temp.hash(i),
    'race_idempotency_' || lpad(i::text, 4, '0'), pg_temp.uid(owner), now() + interval '1 hour')
$$;
-- The billing row's plan columns, "access_plan/plan_code", with null spelled out.
create function pg_temp.row_plan(i integer) returns text language sql as $$
  select coalesce(access_plan, 'null') || '/' || coalesce(plan_code, 'null')
    from public.foundation_billing_accounts where workspace_key = pg_temp.ws(i)
$$;
create function pg_temp.active(owner integer) returns integer language sql as $$
  select count(*)::integer from public.foundation_workspace_members
   where workspace_key = pg_temp.ws(owner) and state = 'active'
$$;

-- 1. Subscription first, then the transaction (the order the projection was written for): one seat.
select is(pg_temp.intent(1, 'personal'), 'issued', 'A: the Personal checkout intent is recorded');
select is(pg_temp.v6('a1', 'subscription.created', now(), 1, 'personal', 's1'), 'processed', 'A: subscription.created projects first');
select is(pg_temp.v6('a2', 'transaction.completed', now(), 1, 'personal', 's1'), 'allowance_granted', 'A: then the allowance');
select is(pg_temp.row_plan(1), 'observer_access/personal', 'A: the row names the plan');
select is(pg_temp.invite(1, 2), 'workspace_seat_limit_reached', 'A: the Personal owner cannot invite');

-- 2. Transaction first. Before the subscription event lands the row has no plan at all.
select is(pg_temp.intent(3, 'personal'), 'issued', 'B: the Personal checkout intent is recorded');
select is(pg_temp.v6('b1', 'transaction.completed', now(), 3, 'personal', 's3'), 'allowance_granted', 'B: transaction.completed lands first');
select is(pg_temp.row_plan(3), 'null/null', 'B: the allowance created the billing row with no access level and no plan code');
select is(pg_temp.invite(3, 4), 'workspace_seat_limit_reached', 'B: in that window the owner cannot invite (was: uncapped)');
select is((select count(*)::integer from public.foundation_workspace_invitations where workspace_key = pg_temp.ws(3)), 0,
  'B: the refused invite wrote no row');
select is(pg_temp.v6('b1', 'transaction.completed', now(), 3, 'personal', 's3'), 'duplicate', 'B: a redelivered transaction is a duplicate');
select is(pg_temp.invite(3, 4), 'workspace_seat_limit_reached', 'B: and the window is still one seat');
-- An invitation pending from before this migration (issued while the row was uncapped) cannot be accepted.
select pg_temp.pending(3, 5);
select is(pg_temp.accept(5), 'workspace_seat_limit_reached', 'B: accepting an earlier-pending invite in the window is refused');
select is(pg_temp.active(3), 1, 'B: the owner is still the only member');
select is(pg_temp.v6('b2', 'subscription.created', now(), 3, 'personal', 's3'), 'processed', 'B: subscription.created arrives second');
select is(pg_temp.row_plan(3), 'observer_access/personal', 'B: the row now names the plan');
select is(pg_temp.invite(3, 6), 'workspace_seat_limit_reached', 'B: and the plan''s one seat holds');

-- 3. Transaction first for a five-seat plan: one seat in the window, five once the plan lands.
select is(pg_temp.intent(10, 'team'), 'issued', 'B-team: the Team checkout intent is recorded');
select is(pg_temp.v6('c1', 'transaction.completed', now(), 10, 'team', 's10'), 'allowance_granted', 'B-team: transaction.completed first');
select is(pg_temp.invite(10, 11), 'workspace_seat_limit_reached', 'B-team: no invite before the plan is known (fail closed)');
select is(pg_temp.v6('c2', 'subscription.activated', now(), 10, 'team', 's10'), 'processed', 'B-team: subscription.activated lands');
select is((select string_agg(pg_temp.invite(10, i), ',' order by i) from generate_series(11, 15) i),
  'pending,pending,pending,pending,workspace_seat_limit_reached', 'B-team: then the plan''s five seats apply');

-- 4. Transaction first and the subscription event never projects (refused: another subscription on the
--    same binding). The row keeps no plan for good, so it must stay one seat for good.
select is(pg_temp.intent(20, 'personal'), 'issued', 'C: the Personal checkout intent is recorded');
select is(pg_temp.v6('d1', 'transaction.completed', now(), 20, 'personal', 's20'), 'allowance_granted', 'C: transaction.completed first');
select is(pg_temp.v6('d2', 'subscription.created', now(), 20, 'personal', 'x20'), 'binding_rejected',
  'C: a subscription event that does not match the binding is refused');
select is(pg_temp.row_plan(20), 'null/null', 'C: the row still has no plan');
select is(pg_temp.invite(20, 21), 'workspace_seat_limit_reached', 'C: the owner cannot invite (was: uncapped for good)');

-- 5. subscription.updated first: v6 refuses it as a bootstrap (the webhook answers 503, Paddle redelivers).
select is(pg_temp.intent(30, 'personal'), 'issued', 'D: the Personal checkout intent is recorded');
select is(pg_temp.v6('e1', 'subscription.updated', now(), 30, 'personal', 's30'), 'binding_rejected',
  'D: subscription.updated before any bootstrap is refused');
select is(pg_temp.v6('e2', 'transaction.completed', now(), 30, 'personal', 's30'), 'allowance_granted', 'D: then the allowance');
select is(pg_temp.invite(30, 31), 'workspace_seat_limit_reached', 'D: no invite while the redelivery is pending');
select is(pg_temp.v6('e1', 'subscription.updated', now(), 30, 'personal', 's30'), 'processed', 'D: the redelivered update projects');
select is(pg_temp.row_plan(30), 'observer_access/personal', 'D: the row names the plan');

-- 6. A stale (older) subscription event after the plan landed changes nothing: the plan code stays.
select is(pg_temp.v6('f1', 'subscription.updated', now() - interval '1 hour', 1, 'personal', 's1', 'canceled'),
  'stale_or_mismatched_subscription', 'stale: an older event is refused as stale');
select is(pg_temp.row_plan(1), 'observer_access/personal', 'stale: the plan code is unchanged');

-- 7. What stays uncapped. A retired (legacy) plan: its subscription event sets an access level and no plan code.
select is(pg_temp.intent(40, 'observer_access'), 'issued', 'legacy: an intent for the retired code (accepted by the database)');
select is(pg_temp.v6('g1', 'subscription.created', now(), 40, 'observer_access', 's40'), 'processed', 'legacy: projected');
select is((select pg_temp.row_plan(40) || ' ' || string_agg(pg_temp.invite(40, i), ',' order by i) from generate_series(41, 43) i),
  'observer_access/null pending,pending,pending', 'legacy (an access level, no plan code): uncapped, as before');
-- A row with no plan whose owner (here also the account holder) has an active operator grant: uncapped, as before.
insert into public.foundation_billing_accounts (workspace_key, user_id, credit_balance) values (pg_temp.ws(50), pg_temp.uid(50), 100);
insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, active)
values (pg_temp.uid(50), 'owner', 'studio_access', true);
select is((select string_agg(pg_temp.invite(50, i), ',' order by i) from generate_series(51, 53) i), 'pending,pending,pending',
  'no plan, operator-granted account holder: uncapped, as before');
update public.foundation_account_access_grants set active = false where user_id = pg_temp.uid(50);
select is(pg_temp.invite(50, 54), 'workspace_seat_limit_reached', 'no plan, inactive grant: one seat');

select * from finish();
rollback;
