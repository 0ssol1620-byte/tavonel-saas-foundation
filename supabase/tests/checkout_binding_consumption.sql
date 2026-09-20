begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88888888-8888-4888-8888-888888888888',
  'authenticated', 'authenticated', 'checkout-binding@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select is(
  public.apply_foundation_billing_event_v5(
    'evt_' || repeat('a', 26), 'transaction.completed', '2026-09-21T00:01:00Z',
    'sha256:' || repeat('1', 64), 'allowance',
    'pilot-bind88888888', '88888888-8888-4888-8888-888888888888',
    'observer_access', 'txn_' || repeat('a', 26), 'ctm_' || repeat('a', 26),
    'sub_' || repeat('a', 26), null, 2000, null,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-21T00:00:00Z',
    'checkout-v1', true, true
  )->>'status',
  'allowance_granted',
  'a fresh current-policy binding bootstraps one subscription allowance'
);

select is(
  public.apply_foundation_billing_event_v5(
    'evt_' || repeat('a', 26), 'transaction.completed', '2026-09-21T00:01:00Z',
    'sha256:' || repeat('1', 64), 'allowance',
    'pilot-bind88888888', '88888888-8888-4888-8888-888888888888',
    'observer_access', 'txn_' || repeat('a', 26), 'ctm_' || repeat('a', 26),
    'sub_' || repeat('a', 26), null, 2000, null,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-21T00:00:00Z',
    'checkout-v1', false, false
  )->>'status',
  'duplicate',
  'an exact provider redelivery remains idempotent after policy closes'
);

select is(
  public.apply_foundation_billing_event_v5(
    'evt_' || repeat('b', 26), 'transaction.completed', '2026-10-21T00:01:00Z',
    'sha256:' || repeat('2', 64), 'allowance',
    'pilot-bind88888888', '88888888-8888-4888-8888-888888888888',
    'observer_access', 'txn_' || repeat('b', 26), 'ctm_' || repeat('a', 26),
    'sub_' || repeat('a', 26), null, 2000, null,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-21T00:00:00Z',
    'checkout-v1', false, false
  )->>'status',
  'allowance_granted',
  'an established subscription can renew with its exact stored binding'
);

select is(
  public.apply_foundation_billing_event_v5(
    'evt_' || repeat('c', 26), 'transaction.completed', '2026-09-21T00:02:00Z',
    'sha256:' || repeat('3', 64), 'allowance',
    'pilot-bind88888888', '88888888-8888-4888-8888-888888888888',
    'observer_access', 'txn_' || repeat('c', 26), 'ctm_' || repeat('a', 26),
    'sub_' || repeat('c', 26), null, 2000, null,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-21T00:00:00Z',
    'checkout-v1', true, true
  )->>'reason',
  'checkout_binding_reuse_conflict',
  'one consumed nonce cannot bootstrap a second subscription'
);

select is(
  public.apply_foundation_billing_event_v5(
    'evt_' || repeat('d', 26), 'transaction.completed', '2026-09-21T00:02:00Z',
    'sha256:' || repeat('4', 64), 'allowance',
    'pilot-bind88888888', '88888888-8888-4888-8888-888888888888',
    'observer_access', 'txn_' || repeat('d', 26), 'ctm_' || repeat('d', 26),
    'sub_' || repeat('d', 26), null, 2000, null,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '2026-09-21T00:00:00Z',
    'checkout-v1', true, false
  )->>'reason',
  'checkout_policy_closed',
  'an unused binding cannot bootstrap after checkout policy closes'
);

select is(
  public.apply_foundation_billing_event_v5(
    'evt_' || repeat('e', 26), 'transaction.completed', '2026-09-21T00:20:00Z',
    'sha256:' || repeat('5', 64), 'allowance',
    'pilot-bind88888888', '88888888-8888-4888-8888-888888888888',
    'observer_access', 'txn_' || repeat('e', 26), 'ctm_' || repeat('e', 26),
    'sub_' || repeat('e', 26), null, 2000, null,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2026-09-21T00:00:00Z',
    'checkout-v1', false, true
  )->>'reason',
  'checkout_binding_expired',
  'an unused expired binding cannot bootstrap even while checkout is open'
);

select is(
  public.apply_foundation_billing_event_v5(
    'evt_' || repeat('g', 26), 'subscription.created', '2026-09-21T00:04:00Z',
    'sha256:' || repeat('7', 64), 'subscription',
    'pilot-bind88888888', '88888888-8888-4888-8888-888888888888',
    'observer_access', null, 'ctm_' || repeat('g', 26),
    'sub_' || repeat('g', 26), 'inactive', 0, null,
    '77777777-7777-4777-8777-777777777777', '2026-09-21T00:00:00Z',
    'checkout-v1', true, true
  )->>'reason',
  'checkout_binding_bootstrap_event_invalid',
  'a non-entitling subscription event cannot consume a new checkout binding'
);

select is(
  public.apply_foundation_billing_event_v5(
    'evt_' || repeat('h', 26), 'subscription.activated', '2026-09-21T00:05:00Z',
    'sha256:' || repeat('8', 64), 'subscription',
    'pilot-bind88888888', '88888888-8888-4888-8888-888888888888',
    'observer_access', null, 'ctm_' || repeat('g', 26),
    'sub_' || repeat('g', 26), 'active', 0, null,
    '77777777-7777-4777-8777-777777777777', '2026-09-21T00:00:00Z',
    'checkout-v1', false, false
  )->>'reason',
  'checkout_binding_bootstrap_event_invalid',
  'a later active event still cannot activate after checkout closes'
);

insert into public.foundation_account_access_grants (
  user_id, grant_kind, access_plan, billing_exempt, trial_exempt, active
) values (
  '88888888-8888-4888-8888-888888888888', 'owner', 'studio_access', true, true, true
);

select is(
  public.apply_foundation_billing_event_v5(
    'evt_' || repeat('f', 26), 'transaction.completed', '2026-09-21T00:03:00Z',
    'sha256:' || repeat('6', 64), 'allowance',
    'pilot-bind88888888', '88888888-8888-4888-8888-888888888888',
    'observer_access', 'txn_' || repeat('f', 26), 'ctm_' || repeat('f', 26),
    'sub_' || repeat('f', 26), null, 2000, null,
    'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-09-21T00:00:00Z',
    'checkout-v1', true, true
  )->>'reason',
  'checkout_account_billing_exempt',
  'an account made billing-exempt cannot bootstrap a new paid transaction'
);

select is(
  (select count(*)::integer from public.foundation_checkout_binding_consumptions),
  1,
  'only the first authorized nonce was consumed'
);

select is(
  (select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-bind88888888'),
  2000,
  'the renewal replaced the allowance and every rejected replay left the balance unchanged'
);

select * from finish();
rollback;
