begin;
select plan(37);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '99999999-9999-4999-8999-999999999999',
  'authenticated', 'authenticated', 'checkout-intent@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '77777777-7777-4777-8777-777777777777',
  'authenticated', 'authenticated', 'checkout-skew@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88888888-8888-4888-8888-888888888888',
  'authenticated', 'authenticated', 'checkout-order@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

-- Boundaries: only the service role reaches the RPCs, nobody reads the tables directly, and v5
-- (which re-read the live checkout gate) is no longer callable.
select ok(
  has_function_privilege('service_role', 'public.issue_foundation_checkout_intent(uuid,text,uuid,text,text,text,integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.issue_foundation_checkout_intent(uuid,text,uuid,text,text,text,integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.issue_foundation_checkout_intent(uuid,text,uuid,text,text,text,integer,timestamptz)', 'EXECUTE'),
  'intent issuance is service-role only'
);
select ok(
  has_function_privilege('service_role', 'public.apply_foundation_billing_event_v6(text,text,timestamptz,text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,text,text,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.quarantine_foundation_billing_envelope(text,text,timestamptz,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.quarantine_foundation_billing_envelope(text,text,timestamptz,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.apply_foundation_billing_event_v6(text,text,timestamptz,text,text,text,uuid,text,text,text,text,text,text,text,timestamptz,text,text,integer)', 'EXECUTE'),
  'v6 and quarantine are service-role only'
);
select ok(
  not has_function_privilege('service_role', 'public.apply_foundation_billing_event_v5(text,text,timestamptz,text,text,text,uuid,text,text,text,text,text,integer,text,text,timestamptz,text,boolean,boolean)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.reject_foundation_billing_event(text,text,timestamptz,text,text,text,text,uuid,text,text,text,text,text,text)', 'EXECUTE'),
  'v5 and the private rejection writer are closed to the service role'
);
select ok(
  not has_table_privilege('service_role', 'public.foundation_checkout_intents', 'SELECT')
  and not has_table_privilege('service_role', 'public.foundation_checkout_intents', 'INSERT')
  and not has_table_privilege('service_role', 'public.foundation_billing_event_rejections', 'SELECT')
  and not has_table_privilege('authenticated', 'public.foundation_billing_event_rejections', 'SELECT'),
  'intent and rejection tables are reachable only through security-definer functions'
);

select is(
  public.issue_foundation_checkout_intent(
    'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'checkout-v1', 'pri_' || repeat('o', 26), 2000, now()
  )->>'status',
  'issued',
  'the checkout route records what it authorized'
);

select is(
  public.issue_foundation_checkout_intent(
    'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', 'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'checkout-v1', 'pri_' || repeat('o', 26), 2000, now() - interval '1 hour'
  )->>'reason',
  'checkout_intent_clock_skew',
  'an intent cannot be backdated'
);

-- Payment lands two hours later (past the old 15 minute binding window), after the configured
-- price rotated (configured credit null) and with no gate input at all.
select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('a', 26), 'transaction.completed', now() + interval '2 hours',
    'sha256:' || repeat('1', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('a', 26), 'ctm_' || repeat('a', 26),
    'sub_' || repeat('a', 26), null, null,
    'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', now(), 'checkout-v1',
    'pri_' || repeat('o', 26), null
  )->>'status',
  'allowance_granted',
  'a delayed payment against a rotated price bootstraps from the intent snapshot'
);

select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-intent9999'),
  2000,
  'credits come from the snapshot, not current configuration'
);

select is(
  (select price_id || ':' || credit_delta from public.foundation_checkout_binding_consumptions
    where nonce = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'pri_' || repeat('o', 26) || ':2000',
  'the consumption keeps the price and credit snapshot for renewals'
);

select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('a', 26), 'transaction.completed', now() + interval '2 hours',
    'sha256:' || repeat('1', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('a', 26), 'ctm_' || repeat('a', 26),
    'sub_' || repeat('a', 26), null, null,
    'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', now(), 'checkout-v1',
    'pri_' || repeat('o', 26), null
  )->>'status',
  'duplicate',
  'a redelivered bootstrap stays idempotent'
);

select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('b', 26), 'transaction.completed', now() + interval '30 days',
    'sha256:' || repeat('2', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('b', 26), 'ctm_' || repeat('a', 26),
    'sub_' || repeat('a', 26), null, null,
    'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', now(), 'checkout-v1',
    'pri_' || repeat('o', 26), null
  )->>'status',
  'allowance_granted',
  'a renewal after the intent window and price rotation settles from the stored snapshot'
);

select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('c', 26), 'transaction.completed', now() + interval '60 days',
    'sha256:' || repeat('3', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('c', 26), 'ctm_' || repeat('a', 26),
    'sub_' || repeat('a', 26), null, null,
    'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', now(), 'checkout-v1',
    'pri_' || repeat('x', 26), null
  )->>'reason',
  'checkout_price_not_allowed',
  'a renewal at a price neither snapshotted nor configured is refused'
);

select is(
  (select reason from public.foundation_billing_event_rejections where event_id = 'evt_' || repeat('c', 26)),
  'checkout_price_not_allowed',
  'the refused paid renewal is durably quarantined, not dropped'
);

select isnt(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('d', 26), 'subscription.canceled', now() + interval '61 days',
    'sha256:' || repeat('4', 64), 'subscription',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', null, 'ctm_' || repeat('a', 26),
    'sub_' || repeat('a', 26), 'canceled', null,
    'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', now(), 'checkout-v1',
    'pri_' || repeat('x', 26), null
  )->>'status',
  'binding_rejected',
  'a cancellation is never refused on price, so access can always be withdrawn'
);

select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('e', 26), 'transaction.completed', now() + interval '1 minute',
    'sha256:' || repeat('5', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('e', 26), 'ctm_' || repeat('e', 26),
    'sub_' || repeat('e', 26), null, null,
    'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', now(), 'checkout-v1',
    'pri_' || repeat('o', 26), 2000
  )->>'reason',
  'checkout_intent_missing',
  'a signed binding the checkout route never recorded cannot bootstrap'
);

select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('e', 26), 'transaction.completed', now() + interval '1 minute',
    'sha256:' || repeat('5', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('e', 26), 'ctm_' || repeat('e', 26),
    'sub_' || repeat('e', 26), null, null,
    'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', now(), 'checkout-v1',
    'pri_' || repeat('o', 26), 2000
  )->>'reason',
  'checkout_intent_missing',
  'a redelivered refusal gives the same answer'
);

do $$ begin perform public.issue_foundation_checkout_intent(
  'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
  'observer_access', 'checkout-v1', 'pri_' || repeat('o', 26), 2000, now()
); end $$;
select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('f', 26), 'transaction.completed', now() + interval '25 hours',
    'sha256:' || repeat('6', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('f', 26), 'ctm_' || repeat('f', 26),
    'sub_' || repeat('f', 26), null, null,
    'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', now(), 'checkout-v1',
    'pri_' || repeat('o', 26), 2000
  )->>'reason',
  'checkout_intent_expired',
  'an intent does not authorize a payment after its window'
);

do $$ begin perform public.issue_foundation_checkout_intent(
  'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
  'observer_access', 'checkout-v1', 'pri_' || repeat('o', 26), 2000, now()
); end $$;
select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('g', 26), 'transaction.completed', now() + interval '1 minute',
    'sha256:' || repeat('7', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('g', 26), 'ctm_' || repeat('g', 26),
    'sub_' || repeat('g', 26), null, null,
    'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', now(), 'checkout-v1',
    'pri_' || repeat('n', 26), 10000
  )->>'reason',
  'checkout_price_not_allowed',
  'a bootstrap must pay the price the intent offered, whatever configuration says now'
);

select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('h', 26), 'subscription.canceled', now() + interval '1 minute',
    'sha256:' || repeat('8', 64), 'subscription',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', null, 'ctm_' || repeat('h', 26),
    'sub_' || repeat('h', 26), 'canceled', null,
    'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', now(), 'checkout-v1',
    'pri_' || repeat('o', 26), 2000
  )->>'reason',
  'checkout_binding_bootstrap_event_invalid',
  'a cancellation cannot consume an unassociated checkout binding'
);

-- Paddle may deliver subscription.created before transaction.completed. The signed, matching
-- subscription establishes the association; the later transaction grants the allowance once.
do $$ begin perform public.issue_foundation_checkout_intent(
  'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6', 'pilot-orderj1', '88888888-8888-4888-8888-888888888888',
  'observer_access', 'checkout-v1', 'pri_' || repeat('j', 26), 2000, now()
); end $$;
select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('l', 26), 'subscription.canceled', now() + interval '3 minutes',
    'sha256:' || repeat('d', 64), 'subscription',
    'pilot-orderj1', '88888888-8888-4888-8888-888888888888',
    'observer_access', null, 'ctm_' || repeat('j', 26),
    'sub_' || repeat('j', 26), 'canceled', null,
    'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6', now(), 'checkout-v1',
    'pri_' || repeat('j', 26), null
  )->>'reason',
  'checkout_binding_bootstrap_event_invalid',
  'an early cancellation waits for the subscription binding'
);
select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('j', 26), 'subscription.created', now() + interval '1 minute',
    'sha256:' || repeat('a', 64), 'subscription',
    'pilot-orderj1', '88888888-8888-4888-8888-888888888888',
    'observer_access', null, 'ctm_' || repeat('j', 26),
    'sub_' || repeat('j', 26), 'active', null,
    'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6', now(), 'checkout-v1',
    'pri_' || repeat('j', 26), null
  )->>'status',
  'processed',
  'a paid subscription may establish a checkout binding before transaction.completed'
);
select is(
  (select initial_action from public.foundation_checkout_binding_consumptions
    where nonce = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6'),
  'subscription',
  'the early subscription retains its association for later payment events'
);
select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('k', 26), 'transaction.completed', now() + interval '2 minutes',
    'sha256:' || repeat('b', 64), 'allowance',
    'pilot-orderj1', '88888888-8888-4888-8888-888888888888',
    'observer_access', 'txn_' || repeat('j', 26), 'ctm_' || repeat('j', 26),
    'sub_' || repeat('j', 26), null, null,
    'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6', now(), 'checkout-v1',
    'pri_' || repeat('j', 26), null
  )->>'status',
  'allowance_granted',
  'the transaction following subscription.created grants its snapshotted allowance'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-orderj1'),
  2000,
  'out-of-order delivery grants one allowance'
);
select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('l', 26), 'subscription.canceled', now() + interval '3 minutes',
    'sha256:' || repeat('d', 64), 'subscription',
    'pilot-orderj1', '88888888-8888-4888-8888-888888888888',
    'observer_access', null, 'ctm_' || repeat('j', 26),
    'sub_' || repeat('j', 26), 'canceled', null,
    'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6', now(), 'checkout-v1',
    'pri_' || repeat('j', 26), null
  )->>'status',
  'processed',
  'redelivery of the early cancellation applies after bootstrap'
);
select ok(
  (select resolved_at is not null from public.foundation_billing_event_rejections
    where event_id = 'evt_' || repeat('l', 26)),
  'the previously quarantined lifecycle event is marked resolved'
);
select is(
  (select subscription_status from public.foundation_billing_accounts where workspace_key = 'pilot-orderj1'),
  'canceled',
  'the latest cancellation wins despite arrival order'
);

do $$ begin perform public.issue_foundation_checkout_intent(
  'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7', 'pilot-skewk1', '77777777-7777-4777-8777-777777777777',
  'observer_access', 'checkout-v1', 'pri_' || repeat('k', 26), 2000, now()
); end $$;
select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('m', 26), 'transaction.completed', now() - interval '2 minutes',
    'sha256:' || repeat('e', 64), 'allowance',
    'pilot-skewk1', '77777777-7777-4777-8777-777777777777',
    'observer_access', 'txn_' || repeat('m', 26), 'ctm_' || repeat('m', 26),
    'sub_' || repeat('m', 26), null, null,
    'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7', now(), 'checkout-v1',
    'pri_' || repeat('k', 26), null
  )->>'status',
  'allowance_granted',
  'a provider timestamp two minutes before the application clock remains within issuance skew'
);
select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-skewk1'),
  2000,
  'clock skew tolerance does not lose a paid allowance'
);

do $$ begin perform public.issue_foundation_checkout_intent(
  'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4', 'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
  'observer_access', 'checkout-v1', 'pri_' || repeat('o', 26), 2000, now()
); end $$;
insert into public.foundation_account_access_grants (
  user_id, grant_kind, access_plan, billing_exempt, trial_exempt, active
) values (
  '99999999-9999-4999-8999-999999999999', 'owner', 'studio_access', true, true, true
);

select is(
  public.issue_foundation_checkout_intent(
    'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5', 'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'checkout-v1', 'pri_' || repeat('o', 26), 2000, now()
  )->>'reason',
  'checkout_account_billing_exempt',
  'a billing-exempt owner gets no checkout intent'
);

select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('i', 26), 'transaction.completed', now() + interval '1 minute',
    'sha256:' || repeat('9', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('i', 26), 'ctm_' || repeat('i', 26),
    'sub_' || repeat('i', 26), null, null,
    'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4', now(), 'checkout-v1',
    'pri_' || repeat('o', 26), 2000
  )->>'reason',
  'checkout_account_billing_exempt',
  'an intent issued before the owner exemption still cannot bootstrap a paid entitlement'
);

select is(
  public.apply_foundation_billing_event_v6(
    'evt_' || repeat('a', 26), 'transaction.completed', now() + interval '2 hours',
    'sha256:' || repeat('1', 64), 'allowance',
    'pilot-intent9999', '99999999-9999-4999-8999-999999999999',
    'observer_access', 'txn_' || repeat('a', 26), 'ctm_' || repeat('a', 26),
    'sub_' || repeat('a', 26), null, null,
    'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', now(), 'checkout-v1',
    'pri_' || repeat('o', 26), null
  )->>'status',
  'duplicate',
  'an already-applied payment remains duplicate after owner exemption'
);
select is(
  (select count(*)::integer from public.foundation_billing_event_rejections
    where event_id = 'evt_' || repeat('a', 26)),
  0,
  'a paid duplicate does not create a false unresolved rejection'
);

select is(
  (select count(*)::integer from public.foundation_billing_event_rejections),
  7,
  'every refusal is one durable row, including the resolved early cancellation'
);

select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-intent9999'),
  2000,
  'the renewal replaced the allowance and every refusal left the balance unchanged'
);

select is(
  public.quarantine_foundation_billing_envelope(
    'evt_' || repeat('z', 26), 'transaction.completed', now(),
    'sha256:' || repeat('c', 64), 'binding_invalid'
  )->>'status',
  'binding_rejected',
  'an unbound signed payment is recorded before acknowledgement'
);
select is(
  (select reason from public.foundation_billing_event_rejections where event_id = 'evt_' || repeat('z', 26)),
  'binding_invalid',
  'the unbound payment is reviewable by event id'
);

select * from finish();
rollback;
