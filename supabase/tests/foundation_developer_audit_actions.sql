-- Run with `supabase test db` after 20260911120100_oauth_reauthorization_audit_action.sql.
--
-- `foundation_developer_audit_events.action` is a closed CHECK, so the audit write in
-- `markOAuthConnectionReauthorizationRequired` either has a value to use or fails the
-- constraint and -- because that write is fail-closed -- makes the withdrawn-grant flag
-- unreachable. Nothing outside a database can tell which, and the constraint is re-created
-- whole rather than extended, so the old values are re-typed by hand every time: that is the
-- other thing asserted here.
--
-- Rolled back, and it writes no connection, no key and no token -- one audit row with an empty
-- details object.
begin;
select plan(3);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '66666666-6666-6666-6666-666666666666',
  'authenticated', 'authenticated', 'audit-action-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select lives_ok(
  $$insert into public.foundation_developer_audit_events (workspace_key, action, target_id, actor_user_id)
    values ('pilot-audit01', 'oauth_connection_reauthorization_required',
            '55555555-5555-4555-8555-555555555555', '66666666-6666-6666-6666-666666666666')$$,
  'the withdrawn-grant transition has an action the audit ledger accepts'
);

select lives_ok(
  $$insert into public.foundation_developer_audit_events (workspace_key, action, target_id, actor_user_id)
    values ('pilot-audit01', 'oauth_connection_synced',
            '55555555-5555-4555-8555-555555555555', '66666666-6666-6666-6666-666666666666')$$,
  'the values the constraint already had survived being re-typed'
);

select throws_ok(
  $$insert into public.foundation_developer_audit_events (workspace_key, action, target_id, actor_user_id)
    values ('pilot-audit01', 'oauth_connection_reauthorized',
            '55555555-5555-4555-8555-555555555555', '66666666-6666-6666-6666-666666666666')$$,
  '23514',
  null,
  'the action list is still closed: a near-miss action is refused, not recorded'
);

select * from finish();
rollback;
