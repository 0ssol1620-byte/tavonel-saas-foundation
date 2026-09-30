-- Billing gate enforcement: service-role only, lease-fenced, and a notice only for a pause this
-- sweeper intended -- including one whose acknowledgement was lost -- never for a customer's own.
begin;
select plan(31);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
  '$2a$10$fixture', now(), '{}', '{}', now(), now()
from (values
  ('b1111111-0000-4000-8000-000000000001'::uuid, 'gate-bill-a@example.invalid'),
  ('b2222222-0000-4000-8000-000000000002'::uuid, 'gate-bill-b@example.invalid'),
  ('b3333333-0000-4000-8000-000000000003'::uuid, 'gate-bill-c@example.invalid'),
  ('b4444444-0000-4000-8000-000000000004'::uuid, 'gate-bill-d@example.invalid'),
  ('b5555555-0000-4000-8000-000000000005'::uuid, 'gate-bill-e@example.invalid')
) v(id, email);

-- A: active and ours to pause.  B: customer paused it themselves.  C: paused projection, no intent.
-- D: malformed subscription id.  E: lost acknowledgement, replayed after the webhook projected it.
insert into public.foundation_billing_accounts (workspace_key, user_id, subscription_status,
  paddle_customer_id, paddle_subscription_id)
values
  ('pilot-gatebilla', 'b1111111-0000-4000-8000-000000000001', 'active',
   'ctm_' || repeat('a', 26), 'sub_' || repeat('a', 26)),
  ('pilot-gatebillb', 'b2222222-0000-4000-8000-000000000002', 'active',
   'ctm_' || repeat('b', 26), 'sub_' || repeat('b', 26)),
  ('pilot-gatebillc', 'b3333333-0000-4000-8000-000000000003', 'paused',
   'ctm_' || repeat('c', 26), 'sub_' || repeat('c', 26)),
  ('pilot-gatebilld', 'b4444444-0000-4000-8000-000000000004', 'active',
   'ctm_' || repeat('d', 26), 'sub_not_a_paddle_id'),
  ('pilot-gatebille', 'b5555555-0000-4000-8000-000000000005', 'active',
   'ctm_' || repeat('e', 26), 'sub_' || repeat('e', 26));

-- Privileges: tables unreadable to every API role; RPCs callable by service_role only.
select ok(bool_and(not has_table_privilege(r, 'public.' || t, p)),
  'enforcement state, audit and notices are closed to every API role, service_role included')
from unnest(array['foundation_billing_gate_enforcements', 'foundation_billing_gate_enforcement_events',
  'foundation_billing_notices']) t,
     unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['select', 'insert', 'update', 'delete']) p;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')
  and not has_function_privilege('anon', f, 'execute')
  and not has_function_privilege('authenticated', f, 'execute')), 'every enforcement RPC is service-role only')
from unnest(array[
  'public.list_foundation_billing_gate_candidates(integer)',
  'public.claim_foundation_billing_gate_enforcement(text, text, uuid, integer)',
  'public.mark_foundation_billing_gate_pause_intent(text, uuid, text, boolean)',
  'public.record_foundation_billing_gate_enforcement(text, uuid, text, text, text, text, timestamptz, timestamptz)',
  'public.list_foundation_billing_notices(text, uuid)']) f;

select set_eq(
  $$ select paddle_subscription_id from public.list_foundation_billing_gate_candidates(50) $$,
  array['sub_' || repeat('a', 26), 'sub_' || repeat('b', 26), 'sub_' || repeat('e', 26)],
  'candidates are chargeable subscriptions with well-formed ids; a paused projection without intent is not one');

-- Leases.
create temporary table claims (who text primary key, token uuid);
insert into claims
select 'a', (public.claim_foundation_billing_gate_enforcement(
  'sub_' || repeat('a', 26), 'pilot-gatebilla', 'b1111111-0000-4000-8000-000000000001', 120)->>'claimToken')::uuid;
select isnt((select token from claims where who = 'a'), null, 'a free subscription is claimed');
select is(public.claim_foundation_billing_gate_enforcement(
  'sub_' || repeat('a', 26), 'pilot-gatebilla', 'b1111111-0000-4000-8000-000000000001', 120)->>'status',
  'held', 'a live lease cannot be claimed twice');
select is(public.claim_foundation_billing_gate_enforcement(
  'sub_' || repeat('a', 26), 'pilot-gatebillb', 'b2222222-0000-4000-8000-000000000002', 120)->>'status',
  'not_candidate', 'a subscription is claimed only for the account that holds it');
select ok(not exists (select 1 from public.list_foundation_billing_gate_candidates(50)
  where paddle_subscription_id = 'sub_' || repeat('a', 26)), 'a held lease is not listed');
select is(public.mark_foundation_billing_gate_pause_intent('sub_' || repeat('a', 26), gen_random_uuid(),
  'processing_authorization_refused', false)->>'status', 'lease_lost', 'an intent needs the live lease');
select is(public.record_foundation_billing_gate_enforcement('sub_' || repeat('a', 26), gen_random_uuid(),
  'admitted', null, null, null, null, null)->>'status', 'lease_lost', 'a result needs the live lease');
select throws_ok($$ select public.record_foundation_billing_gate_enforcement('sub_' || repeat('a', 26),
  (select token from claims where who = 'a'), 'paused', 'SCOPED_WORKSPACE_REFUSED', 'paused', null, null,
  clock_timestamp()) $$,
  'P0001', 'billing_gate_pause_without_intent', 'a pause cannot be recorded without a prior intent');
select throws_ok($$ select public.record_foundation_billing_gate_enforcement('sub_' || repeat('a', 26),
  (select token from claims where who = 'a'), 'refunded', null, null, null, null, null) $$,
  'P0001', 'billing_gate_record_invalid', 'an unknown outcome is refused');

-- A: intent, provider pause, result -> exactly one notice, attributed, carrying the intent reason.
select is(public.mark_foundation_billing_gate_pause_intent('sub_' || repeat('a', 26),
  (select token from claims where who = 'a'), 'processing_authorization_refused', true)->>'status',
  'intent_recorded', 'the intent is written under the live lease');
create temporary table paused_at (who text primary key, at timestamptz);
insert into paused_at values ('a', clock_timestamp());
select is(public.record_foundation_billing_gate_enforcement('sub_' || repeat('a', 26),
  (select token from claims where who = 'a'), 'paused', 'SCOPED_WORKSPACE_REFUSED', 'paused', null, null,
  (select at from paused_at where who = 'a'))->>'noticeCreated', 'true', 'our pause creates the notice');
select results_eq(
  $$ select reason, refund_review_required from public.list_foundation_billing_notices(
       'pilot-gatebilla', 'b1111111-0000-4000-8000-000000000001') $$,
  $$ values ('processing_authorization_refused'::text, true) $$,
  'the notice carries the intent reason and asks for refund review, nothing more');
select is((select count(*)::int from public.list_foundation_billing_notices(
  'pilot-gatebilla', 'b2222222-0000-4000-8000-000000000002')), 0, 'notices are listed only for their own account');
select ok((select pause_intent_at is null and refund_review_required and claim_token is null
  from public.foundation_billing_gate_enforcements where paddle_subscription_id = 'sub_' || repeat('a', 26)),
  'the intent is resolved and the lease released');

-- A again (a duplicate run before the webhook arrives): no second notice.
update claims set token = (public.claim_foundation_billing_gate_enforcement(
  'sub_' || repeat('a', 26), 'pilot-gatebilla', 'b1111111-0000-4000-8000-000000000001', 120)->>'claimToken')::uuid
where who = 'a';
select is(public.record_foundation_billing_gate_enforcement('sub_' || repeat('a', 26),
  (select token from claims where who = 'a'), 'provider_paused', 'SCOPED_WORKSPACE_REFUSED', 'paused', null, null,
  (select at from paused_at where who = 'a'))->>'noticeCreated', 'false', 'a replay adds no notice');
select is((select count(*)::int from public.foundation_billing_notices
  where paddle_subscription_id = 'sub_' || repeat('a', 26)), 1, 'still exactly one notice for that pause');

-- B: the customer paused it; we never recorded an intent.
insert into claims
select 'b', (public.claim_foundation_billing_gate_enforcement(
  'sub_' || repeat('b', 26), 'pilot-gatebillb', 'b2222222-0000-4000-8000-000000000002', 120)->>'claimToken')::uuid;
select is(public.record_foundation_billing_gate_enforcement('sub_' || repeat('b', 26),
  (select token from claims where who = 'b'), 'provider_paused', 'SCOPED_WORKSPACE_REFUSED', 'paused', null, null,
  clock_timestamp())->>'attributed', 'false', 'a customer-initiated pause is not attributed to enforcement');
select is((select count(*)::int from public.foundation_billing_notices
  where paddle_subscription_id = 'sub_' || repeat('b', 26)), 0, 'and it gets no enforcement notice');

-- B later: an intent whose window Paddle's pause time does not fall in is not ours either.
update claims set token = (public.claim_foundation_billing_gate_enforcement(
  'sub_' || repeat('b', 26), 'pilot-gatebillb', 'b2222222-0000-4000-8000-000000000002', 120)->>'claimToken')::uuid
where who = 'b';
select is(public.mark_foundation_billing_gate_pause_intent('sub_' || repeat('b', 26),
  (select token from claims where who = 'b'), 'processing_authorization_lapsed', false)->>'status',
  'intent_recorded', 'an intent may be recorded for B');
select is(public.record_foundation_billing_gate_enforcement('sub_' || repeat('b', 26),
  (select token from claims where who = 'b'), 'provider_paused', 'SCOPED_WORKSPACE_INVALID', 'paused', null, null,
  clock_timestamp() - interval '1 day')->>'attributed', 'false', 'a pause from before our intent is not ours');
select ok((select pause_intent_at is null from public.foundation_billing_gate_enforcements
  where paddle_subscription_id = 'sub_' || repeat('b', 26)), 'and the stale intent is cleared');

-- E: intent, provider pause, then the result write is lost and the lease runs out.
insert into claims
select 'e', (public.claim_foundation_billing_gate_enforcement(
  'sub_' || repeat('e', 26), 'pilot-gatebille', 'b5555555-0000-4000-8000-000000000005', 120)->>'claimToken')::uuid;
select is(public.mark_foundation_billing_gate_pause_intent('sub_' || repeat('e', 26),
  (select token from claims where who = 'e'), 'processing_authorization_lapsed', false)->>'status',
  'intent_recorded', 'E records its intent');
insert into paused_at values ('e', clock_timestamp());
update public.foundation_billing_gate_enforcements set lease_until = now() - interval '1 second'
  where paddle_subscription_id = 'sub_' || repeat('e', 26);
-- The signed webhook projects `paused` meanwhile.
update public.foundation_billing_accounts set subscription_status = 'paused' where workspace_key = 'pilot-gatebille';
select results_eq(
  $$ select subscription_status, pause_intent_pending from public.list_foundation_billing_gate_candidates(50)
     where paddle_subscription_id = 'sub_' || repeat('e', 26) $$,
  $$ values ('paused'::text, true) $$,
  'an unresolved intent keeps a paused projection listed');
update claims set token = (public.claim_foundation_billing_gate_enforcement(
  'sub_' || repeat('e', 26), 'pilot-gatebille', 'b5555555-0000-4000-8000-000000000005', 120)->>'claimToken')::uuid
where who = 'e';
select isnt((select token from claims where who = 'e'), null, 'an expired lease is reclaimed');
select is(public.record_foundation_billing_gate_enforcement('sub_' || repeat('e', 26),
  (select token from claims where who = 'e'), 'provider_paused', 'SCOPED_WORKSPACE_INVALID', 'paused', null, null,
  (select at from paused_at where who = 'e'))->>'noticeCreated', 'true',
  'the replay recovers the notice from Paddle''s paused_at');
select ok(not exists (select 1 from public.list_foundation_billing_gate_candidates(50)
  where paddle_subscription_id = 'sub_' || repeat('e', 26)), 'once resolved, the paused projection drops out');

-- A failed pause keeps its intent, so a pause that did land is still found on the next run.
update public.foundation_billing_accounts set subscription_status = 'active' where workspace_key = 'pilot-gatebille';
update claims set token = (public.claim_foundation_billing_gate_enforcement(
  'sub_' || repeat('e', 26), 'pilot-gatebille', 'b5555555-0000-4000-8000-000000000005', 120)->>'claimToken')::uuid
where who = 'e';
select is(public.mark_foundation_billing_gate_pause_intent('sub_' || repeat('e', 26),
  (select token from claims where who = 'e'), 'processing_authorization_lapsed', false)->>'status',
  'intent_recorded', 'a second intent for E');
select is(public.record_foundation_billing_gate_enforcement('sub_' || repeat('e', 26),
  (select token from claims where who = 'e'), 'pause_failed', 'SCOPED_WORKSPACE_INVALID', 'active',
  'PADDLE_SUBSCRIPTION_PAUSE_FAILED', null, null)->>'status', 'recorded', 'a failed pause is recorded');
select ok((select pause_intent_at is not null and failed_attempts = 1 from public.foundation_billing_gate_enforcements
  where paddle_subscription_id = 'sub_' || repeat('e', 26)), 'the intent survives a failed pause');

select * from finish();
rollback;
