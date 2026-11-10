-- Migration 20261110120000: an active paid plan takes precedence over a trial row at intake admission.
--
-- Six users, one workspace each, every one carrying a trial row that is not trialing unless named:
--   P1 paid (observer_access, active) + expired trial   -> admitted, intakeClass paid
--   P2 paid (studio_access, active)   + converted trial -> admitted, intakeClass paid
--   X  no plan (inactive)             + expired trial   -> foundation_trial_not_active
--   H  paid but billing hold          + expired trial   -> foundation_trial_not_active
--   C  paid but cancellation passed   + expired trial   -> foundation_trial_not_active
--   T  no plan                        + trialing trial  -> admitted, intakeClass trial (unchanged)
-- Then the client boundary: no browser role can call the wrapper or the inner function.
begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
  'paid-over-trial-' || n || '@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"google","providers":["google"]}', '{}', now(), now()
from (values
  (1, 'c1c1c1c1-0000-4000-8000-0000000000c1'), (2, 'c2c2c2c2-0000-4000-8000-0000000000c2'),
  (3, 'c3c3c3c3-0000-4000-8000-0000000000c3'), (4, 'c4c4c4c4-0000-4000-8000-0000000000c4'),
  (5, 'c5c5c5c5-0000-4000-8000-0000000000c5'), (6, 'c6c6c6c6-0000-4000-8000-0000000000c6')
) as u(n, id);

insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, subscription_status, billing_hold, subscription_cancel_at)
values
  ('pilot-pot001', 'c1c1c1c1-0000-4000-8000-0000000000c1', 'observer_access', 'active', false, null),
  ('pilot-pot002', 'c2c2c2c2-0000-4000-8000-0000000000c2', 'studio_access', 'active', false, null),
  ('pilot-pot003', 'c3c3c3c3-0000-4000-8000-0000000000c3', null, 'inactive', false, null),
  ('pilot-pot004', 'c4c4c4c4-0000-4000-8000-0000000000c4', 'observer_access', 'active', true, null),
  ('pilot-pot005', 'c5c5c5c5-0000-4000-8000-0000000000c5', 'observer_access', 'active', false, now() - interval '1 day');

insert into public.foundation_self_service_trials (user_id, workspace_key, status, started_at, expires_at, ended_reason)
values
  ('c1c1c1c1-0000-4000-8000-0000000000c1', 'pilot-pot001', 'expired', now() - interval '40 days', now() - interval '33 days', 'TRIAL_TIME_EXPIRED'),
  ('c2c2c2c2-0000-4000-8000-0000000000c2', 'pilot-pot002', 'converted', now() - interval '3 days', now() + interval '4 days', 'PAID_ACCESS_ACTIVE'),
  ('c3c3c3c3-0000-4000-8000-0000000000c3', 'pilot-pot003', 'expired', now() - interval '40 days', now() - interval '33 days', 'TRIAL_TIME_EXPIRED'),
  ('c4c4c4c4-0000-4000-8000-0000000000c4', 'pilot-pot004', 'expired', now() - interval '40 days', now() - interval '33 days', 'TRIAL_TIME_EXPIRED'),
  ('c5c5c5c5-0000-4000-8000-0000000000c5', 'pilot-pot005', 'expired', now() - interval '40 days', now() - interval '33 days', 'TRIAL_TIME_EXPIRED'),
  ('c6c6c6c6-0000-4000-8000-0000000000c6', 'pilot-pot006', 'trialing', now(), now() + interval '7 days', null);

create function pg_temp.admit(p_workspace text, p_user text, p_document text) returns jsonb language sql as $$
  select public.reserve_foundation_intake_admission(p_workspace, p_document::uuid, p_user::uuid,
    'quarantine/' || p_workspace || '/' || p_document || '/source', 1024, 'application/pdf');
$$;

set local role service_role;

-- 1-4: an active paid plan is admitted as paid, whatever trial row it carries.
select is(pg_temp.admit('pilot-pot001', 'c1c1c1c1-0000-4000-8000-0000000000c1', 'd1d1d1d1-0000-4000-8000-0000000000d1')->>'intakeClass',
  'paid', 'paid Developer with an expired trial row is admitted as paid');
select is(pg_temp.admit('pilot-pot001', 'c1c1c1c1-0000-4000-8000-0000000000c1', 'd1d1d1d1-0000-4000-8000-0000000000d2')->>'intakeClass',
  'paid', 'a second file is admitted too: no trial file bound applies to a paid plan');
select is(pg_temp.admit('pilot-pot002', 'c2c2c2c2-0000-4000-8000-0000000000c2', 'd2d2d2d2-0000-4000-8000-0000000000d1')->>'intakeClass',
  'paid', 'paid Team with a converted trial row is admitted as paid');
select is((select count(*)::integer from public.foundation_intake_admissions where workspace_key in ('pilot-pot001', 'pilot-pot002')),
  3, 'each paid admission is recorded');

-- 5-7: without an active, unheld, uncancelled plan the trial row still decides, and an ended trial is refused.
select throws_ok($$select pg_temp.admit('pilot-pot003', 'c3c3c3c3-0000-4000-8000-0000000000c3', 'd3d3d3d3-0000-4000-8000-0000000000d1')$$,
  'P0001', 'foundation_trial_not_active', 'an expired trial and no plan is still refused');
select throws_ok($$select pg_temp.admit('pilot-pot004', 'c4c4c4c4-0000-4000-8000-0000000000c4', 'd4d4d4d4-0000-4000-8000-0000000000d1')$$,
  'P0001', 'foundation_trial_not_active', 'a plan under billing hold is not paid precedence');
select throws_ok($$select pg_temp.admit('pilot-pot005', 'c5c5c5c5-0000-4000-8000-0000000000c5', 'd5d5d5d5-0000-4000-8000-0000000000d1')$$,
  'P0001', 'foundation_trial_not_active', 'a plan whose cancellation has taken effect is not paid precedence');

-- 8: a live trial with no plan is still a trial.
select is(pg_temp.admit('pilot-pot006', 'c6c6c6c6-0000-4000-8000-0000000000c6', 'd6d6d6d6-0000-4000-8000-0000000000d1')->>'intakeClass',
  'trial', 'a trialing workspace with no plan keeps the trial class and its bounds');

-- 9: a refusal is stable on a retry.
select throws_ok($$select pg_temp.admit('pilot-pot003', 'c3c3c3c3-0000-4000-8000-0000000000c3', 'd3d3d3d3-0000-4000-8000-0000000000d2')$$,
  'P0001', 'foundation_trial_not_active', 'the refusal is stable on a second attempt');
reset role;

-- 10-11: the client boundary is unchanged.
select ok(not has_function_privilege('authenticated', 'public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text)', 'EXECUTE'),
  'a signed-in browser cannot call the admission wrapper');
select ok(not has_function_privilege('authenticated', 'public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)', 'EXECUTE'),
  'a signed-in browser cannot call the inner function');

select * from finish();
rollback;
