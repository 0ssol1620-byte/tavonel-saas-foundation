-- Run with Supabase CLI db test after 0006_foundation_subscription_schedule.sql.
-- Every fixture and projected event is rolled back.
begin;
select plan(32);

select has_table('public', 'foundation_billing_accounts', 'billing accounts table exists');
select has_table('public', 'foundation_billing_events', 'billing event receipt table exists');
select has_table('public', 'foundation_credit_ledger', 'credit ledger table exists');
select has_table('public', 'foundation_pending_reversals', 'pending reversal table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_billing_accounts'::regclass), 'billing accounts have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_billing_events'::regclass), 'billing events have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_credit_ledger'::regclass), 'credit ledger has RLS');
select ok(not has_table_privilege('anon', 'public.foundation_billing_accounts', 'select'), 'anonymous clients cannot read billing');
select ok(not has_table_privilege('authenticated', 'public.foundation_billing_accounts', 'select'), 'authenticated clients cannot read billing directly');
-- 0005 shipped apply_foundation_billing_event; 0009, 0010 and 0035 superseded it with v2, v3
-- and v4, and each revoked EXECUTE on the version it replaced -- 0009 line 214 takes the v1
-- grant away from service_role by name. v4 is the live entry point
-- (0035_subscription_allowance_ledger.sql line 156), so that is what the privileges are
-- asserted on, and the retired v1 is asserted to be reachable by nobody at all.
select ok(not has_function_privilege('authenticated', 'public.apply_foundation_billing_event_v4(text,text,timestamptz,text,text,text,uuid,text,text,text,text,text,integer,text)', 'execute'), 'authenticated clients cannot execute billing projection');
select ok(has_function_privilege('service_role', 'public.apply_foundation_billing_event_v4(text,text,timestamptz,text,text,text,uuid,text,text,text,text,text,integer,text)', 'execute'), 'service role can execute billing projection');
select ok(not has_function_privilege('service_role', 'public.apply_foundation_billing_event(text,text,timestamptz,text,text,text,uuid,text,text,text,text,text,integer,text)', 'execute'), 'the superseded v1 projection is reachable by nobody, service role included');
select ok(not has_function_privilege('authenticated', 'public.apply_foundation_subscription_schedule(text,text,text,timestamptz)', 'execute'), 'authenticated clients cannot project cancellation schedules');
select ok(has_function_privilege('service_role', 'public.apply_foundation_subscription_schedule(text,text,text,timestamptz)', 'execute'), 'service role can project cancellation schedules');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated', 'billing-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select is(
  public.apply_foundation_billing_event(
    'evt_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'transaction.paid', '2026-08-29T10:00:00Z',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'purchase', 'pilot-billtest00000000', '33333333-3333-3333-3333-333333333333',
    'credit_starter', 'txn_tttttttttttttttttttttttttt', 'ctm_cccccccccccccccccccccccccc',
    null, null, 100, null
  )->>'status',
  'processed',
  'first purchase is projected'
);
select is(
  public.apply_foundation_billing_event(
    'evt_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'transaction.paid', '2026-08-29T10:00:00Z',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'purchase', 'pilot-billtest00000000', '33333333-3333-3333-3333-333333333333',
    'credit_starter', 'txn_tttttttttttttttttttttttttt', 'ctm_cccccccccccccccccccccccccc',
    null, null, 100, null
  )->>'status',
  'duplicate',
  'duplicate event is idempotent'
);
select is(
  public.apply_foundation_billing_event(
    'evt_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'transaction.paid', '2026-08-29T10:01:00Z',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'purchase', 'pilot-billtest00000000', '33333333-3333-3333-3333-333333333333',
    'credit_starter', 'txn_tttttttttttttttttttttttttt', 'ctm_cccccccccccccccccccccccccc',
    null, null, 100, null
  )->>'status',
  'duplicate_transaction',
  'duplicate transaction cannot mint credits'
);
select is((select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-billtest00000000'), 100, 'duplicate transaction leaves balance unchanged');

select is(
  public.apply_foundation_billing_event(
    'evt_cccccccccccccccccccccccccc', 'subscription.updated', '2026-08-29T12:00:00Z',
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'subscription', 'pilot-billtest00000000', '33333333-3333-3333-3333-333333333333',
    'observer_access', null, 'ctm_cccccccccccccccccccccccccc',
    'sub_ssssssssssssssssssssssssss', 'active', 0, null
  )->>'status',
  'processed',
  'new subscription state is projected'
);
select is(
  public.apply_foundation_billing_event(
    'evt_dddddddddddddddddddddddddd', 'subscription.canceled', '2026-08-29T11:00:00Z',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'subscription', 'pilot-billtest00000000', '33333333-3333-3333-3333-333333333333',
    'observer_access', null, 'ctm_cccccccccccccccccccccccccc',
    'sub_ssssssssssssssssssssssssss', 'canceled', 0, null
  )->>'status',
  'stale_or_mismatched_subscription',
  'older subscription event is ignored'
);
select is((select subscription_status from public.foundation_billing_accounts where workspace_key = 'pilot-billtest00000000'), 'active', 'newest subscription state wins');
select is(
  public.apply_foundation_subscription_schedule(
    'evt_cccccccccccccccccccccccccc', 'pilot-billtest00000000',
    'sub_ssssssssssssssssssssssssss', '2026-09-29T12:00:00Z'
  )->>'status',
  'processed',
  'period-end cancellation schedule is projected'
);
select is(
  (select subscription_cancel_at from public.foundation_billing_accounts where workspace_key = 'pilot-billtest00000000'),
  '2026-09-29T12:00:00Z'::timestamptz,
  'cancellation effective timestamp is retained while access remains active'
);
select is(
  public.apply_foundation_subscription_schedule(
    'evt_dddddddddddddddddddddddddd', 'pilot-billtest00000000',
    'sub_ssssssssssssssssssssssssss', null
  )->>'status',
  'stale_subscription_schedule',
  'older subscription event cannot clear a newer cancellation schedule'
);

select is(
  public.apply_foundation_billing_event(
    'evt_eeeeeeeeeeeeeeeeeeeeeeeeee', 'adjustment.created', '2026-08-29T13:00:00Z',
    'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'reversal', null, null, null, 'txn_zzzzzzzzzzzzzzzzzzzzzzzzzz', null, null, null, 0,
    'adj_jjjjjjjjjjjjjjjjjjjjjjjjjj'
  )->>'status',
  'pending_original_transaction',
  'reversal arriving before purchase is retained'
);
select is(
  public.apply_foundation_billing_event(
    'evt_ffffffffffffffffffffffffff', 'transaction.paid', '2026-08-29T13:01:00Z',
    'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'purchase', 'pilot-billtest00000000', '33333333-3333-3333-3333-333333333333',
    'credit_starter', 'txn_zzzzzzzzzzzzzzzzzzzzzzzzzz', 'ctm_cccccccccccccccccccccccccc',
    null, null, 100, null
  )->>'status',
  'processed',
  'later purchase resolves pending reversal'
);
select is((select credit_balance from public.foundation_billing_accounts where workspace_key = 'pilot-billtest00000000'), 100, 'reversed purchase contributes no available credits');
select is((select lifetime_credits_purchased from public.foundation_billing_accounts where workspace_key = 'pilot-billtest00000000'), 200, 'lifetime purchases are audited');
select is((select lifetime_credits_reversed from public.foundation_billing_accounts where workspace_key = 'pilot-billtest00000000'), 100, 'lifetime reversals are audited');
select ok((select billing_hold from public.foundation_billing_accounts where workspace_key = 'pilot-billtest00000000'), 'refund or dispute applies billing hold');
select is((select count(*)::integer from public.foundation_pending_reversals), 0, 'resolved reversal leaves no pending row');
select is((select count(*)::integer from public.foundation_billing_events), 6, 'exactly one immutable receipt per distinct event remains');

select * from finish();
rollback;
