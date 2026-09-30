-- Connector qualification (20260930080000): the same bounded stage as 20260930070000 for scope
-- `connector`, pending exactly the three facts only an imported connector source can show.
begin;
select plan(20);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c0c1c1c1-0000-4000-8000-0000000000c1', 'authenticated',
   'authenticated', 'conn-owner-a@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0d2d2d2-0000-4000-8000-0000000000d2', 'authenticated',
   'authenticated', 'conn-owner-b@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now());
insert into public.foundation_workspaces (workspace_key, display_name, created_by) values
  ('pilot-cc1c1c100004000', 'CA', 'c0c1c1c1-0000-4000-8000-0000000000c1'),
  ('pilot-cd2d2d200004000', 'CB', 'c0d2d2d2-0000-4000-8000-0000000000d2')
on conflict (workspace_key) do nothing;
insert into public.foundation_workspace_members (workspace_key, user_id, role, state, accepted_at) values
  ('pilot-cc1c1c100004000', 'c0c1c1c1-0000-4000-8000-0000000000c1', 'owner', 'active', now()),
  ('pilot-cd2d2d200004000', 'c0d2d2d2-0000-4000-8000-0000000000d2', 'owner', 'active', now())
on conflict (workspace_key, user_id) do nothing;
-- A has connector and direct_upload acceptances; B only connector.
insert into public.foundation_processing_terms_acceptances (acceptance_id, workspace_key, user_id, actor_role,
  authorization_revision, terms_version, terms_path, terms_sha256, processing_path, processing_sha256, scope,
  request_id, accepted_at)
select v.id, v.ws, v.uid, 'owner', m.authorization_revision, '2026-09-30',
  '/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md', 'sha256:' || repeat('a', 64),
  '/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md', 'sha256:' || repeat('b', 64), v.scope,
  'req-conn-fixture-' || v.scope, now() - interval '1 hour'
from (values
  ('c0c1c1c1-0000-4000-8000-00000000cc01'::uuid, 'pilot-cc1c1c100004000', 'c0c1c1c1-0000-4000-8000-0000000000c1'::uuid, 'connector'),
  ('c0c1c1c1-0000-4000-8000-00000000cc02'::uuid, 'pilot-cc1c1c100004000', 'c0c1c1c1-0000-4000-8000-0000000000c1'::uuid, 'direct_upload'),
  ('c0d2d2d2-0000-4000-8000-00000000dd01'::uuid, 'pilot-cd2d2d200004000', 'c0d2d2d2-0000-4000-8000-0000000000d2'::uuid, 'connector')
) v(id, ws, uid, scope)
join public.foundation_workspace_members m on m.workspace_key = v.ws and m.user_id = v.uid;

-- 14 facts named like the real ones; none of the three pending preconditions.
create function pg_temp.facts(p_extra text default null, p_drop text default null) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('precondition', p))
  from unnest(array_remove(array_remove(array[
    'tenant_isolation_suite_passed', 'encryption_at_rest_verified', 'encryption_in_transit_verified',
    'connector_credentials_in_secret_manager', 'no_secrets_in_receipts_or_logs_verified',
    'malware_scan_and_quarantine_active', 'archive_bomb_limits_enforced', 'retention_controls_configured',
    'data_export_and_delete_available', 'audit_log_active', 'least_privilege_connector_scopes_verified',
    'per_provider_isolation_verified', 'dpa_and_privacy_notice_published', 'founder_approval_receipt_recorded',
    p_extra], null), p_drop)) p
$$;
create function pg_temp.pending() returns text[] language sql as $$
  select array['compile_receipts_signed_and_audited', 'deletion_tombstone_propagation_verified',
    'per_source_acl_preserved']
$$;
create function pg_temp.qualify(p_receipt text, p_revision text default repeat('c', 40),
  p_ws text default 'pilot-cc1c1c100004000', p_evidence jsonb default pg_temp.facts(),
  p_missing text[] default pg_temp.pending(), p_ttl interval default interval '50 minutes',
  p_actor text default 'delegated-operator:parent-agent', p_scope text default 'connector')
returns void language sql as $$
  insert into public.customer_data_release_decisions (schema_version, stage, scope, release_revision, allowed,
    receipt_sha256, evidence, missing, evaluated_at, operator_actor, decision_reason,
    qualification_workspace_key, qualification_expires_at)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', p_scope, p_revision, true,
    p_receipt, p_evidence, p_missing, now() - interval '1 minute', p_actor,
    'bounded connector qualification on an operator-owned synthetic sample under the founder standing delegation',
    p_ws, now() - interval '1 minute' + p_ttl);
$$;
create function pg_temp.issue(p_ws text, p_acceptance uuid, p_release text,
  p_scope text default 'connector', p_ttl interval default interval '30 minutes',
  p_revision text default repeat('c', 40))
returns jsonb language plpgsql as $$
declare
  a public.foundation_processing_terms_acceptances;
  g public.customer_data_workspace_decisions;
begin
  select * into a from public.foundation_processing_terms_acceptances where acceptance_id = p_acceptance;
  g.schema_version := 'tavonel.customer_data_gate.v2.qualification';
  g.tenant_id := p_ws; g.workspace_id := p_ws; g.scope := p_scope; g.release_revision := p_revision;
  g.user_id := a.user_id; g.release_receipt_sha256 := p_release; g.terms_version := '2026-09-30';
  g.terms_receipt_sha256 := public.processing_terms_receipt_sha256('terms', a);
  g.processing_terms_receipt_sha256 := public.processing_terms_receipt_sha256('processing', a);
  g.granted_at := date_trunc('milliseconds', clock_timestamp());
  g.expires_at := g.granted_at + p_ttl;
  return public.issue_customer_data_workspace_grant(p_ws, p_scope, p_revision, p_release,
    p_acceptance, '2026-09-30', a.terms_path, a.terms_sha256, a.processing_path, a.processing_sha256,
    g.terms_receipt_sha256, g.processing_terms_receipt_sha256, g.granted_at, g.expires_at,
    public.customer_data_workspace_grant_sha256(g));
end;
$$;

-- 1-8: the ledger accepts exactly one connector qualification shape.
select lives_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64)) $$,
  'a 14-fact, three-pending, one-workspace, one-hour connector qualification is recordable');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64),
  p_missing => array['compile_receipts_signed_and_audited']) $$,
  '23514', null, 'a connector qualification cannot leave ACL and tombstone facts unnamed');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64),
  p_missing => array['per_source_acl_preserved', 'compile_receipts_signed_and_audited',
    'deletion_tombstone_propagation_verified']) $$,
  '23514', null, 'the pending set is exact, in precondition order');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64),
  p_evidence => pg_temp.facts('per_source_acl_preserved')) $$,
  '23514', null, 'a connector qualification cannot add a claimed ACL fact');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64),
  p_evidence => pg_temp.facts('deletion_tombstone_propagation_verified', 'audit_log_active')) $$,
  '23514', null, 'nor swap a required fact for a claimed tombstone fact');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64),
  p_evidence => pg_temp.facts(null, 'audit_log_active')) $$,
  '23514', null, 'all 14 non-pending connector facts are required');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64), p_ttl => interval '1 hour 1 second') $$,
  '23514', null, 'a connector qualification cannot outlive one hour');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64), p_actor => 'founder') $$,
  '23514', null, 'a connector qualification is a delegated operator record');

-- 9: direct_upload qualification keeps its 070000 shape.
select lives_ok($$ select pg_temp.qualify('sha256:' || repeat('f', 64), p_revision => repeat('d', 40),
  p_scope => 'direct_upload', p_missing => array['compile_receipts_signed_and_audited'],
  p_evidence => (select jsonb_agg(jsonb_build_object('precondition', 'fact_' || g)) from generate_series(1, 11) g)) $$,
  'a direct_upload qualification is still recordable unchanged');

-- 10-16: the writer issues a connector qualification grant only as bounded.
select is(pg_temp.issue('pilot-cc1c1c100004000', 'c0c1c1c1-0000-4000-8000-00000000cc01',
    'sha256:' || repeat('e', 64)) ->> 'stage', 'qualification', 'the recorded workspace gets a connector qualification grant');
select ok((select stage = 'qualification' and scope = 'connector'
    and schema_version = 'tavonel.customer_data_gate.v2.qualification'
    and grant_receipt_sha256 = public.customer_data_workspace_grant_sha256(d)
    and expires_at <= granted_at + interval '1 hour'
  from public.customer_data_workspace_decisions d where tenant_id = 'pilot-cc1c1c100004000' and scope = 'connector'),
  'the stored connector grant carries stage, scope and a self-consistent digest');
select throws_ok($$ select pg_temp.issue('pilot-cc1c1c100004000', 'c0c1c1c1-0000-4000-8000-00000000cc02',
  'sha256:' || repeat('e', 64)) $$, 'P0001', 'workspace_grant_acceptance_required',
  'a direct_upload terms acceptance never grants connector scope');
select throws_ok($$ select pg_temp.issue('pilot-cd2d2d200004000', 'c0d2d2d2-0000-4000-8000-00000000dd01',
  'sha256:' || repeat('e', 64)) $$, 'P0001', 'workspace_grant_qualification_refused',
  'a connector qualification never grants a workspace it does not name');
select throws_ok($$ select pg_temp.issue('pilot-cc1c1c100004000', 'c0c1c1c1-0000-4000-8000-00000000cc01',
  'sha256:' || repeat('e', 64), p_ttl => interval '55 minutes') $$, 'P0001', 'workspace_grant_qualification_refused',
  'a grant cannot outlive its connector qualification');
select throws_ok($$ select pg_temp.issue('pilot-cc1c1c100004000', 'c0c1c1c1-0000-4000-8000-00000000cc02',
  'sha256:' || repeat('e', 64), p_scope => 'direct_upload') $$, 'P0001', 'workspace_grant_release_changed',
  'a connector qualification never admits direct_upload for its revision');
select throws_ok($$ insert into public.customer_data_workspace_decisions (schema_version, stage, tenant_id,
    workspace_id, scope, release_revision, allowed, user_id, release_receipt_sha256, terms_version,
    terms_receipt_sha256, processing_terms_receipt_sha256, grant_receipt_sha256, granted_at, expires_at,
    operator_actor, decision_reason)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', 'pilot-cc1c1c100004000',
    'pilot-cc1c1c100004000', 'connector', repeat('c', 40), true, 'c0c1c1c1-0000-4000-8000-0000000000c1',
    'sha256:' || repeat('e', 64), '2026-09-30', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
    'sha256:' || repeat('3', 64), now(), now() + interval '2 hours', 'test-operator', 'direct two-hour grant') $$,
  '23514', null, 'even a direct insert cannot hold a connector qualification grant beyond one hour');

-- 17-20: no connector qualification after an allowed connector release; a refusal does not block one.
insert into public.customer_data_release_decisions (scope, release_revision, allowed, missing, evaluated_at,
  operator_actor, decision_reason)
values ('connector', repeat('9', 40), false, array['per_source_acl_preserved'], now(), 'test-operator',
  'connector production refused');
select lives_ok($$ select pg_temp.qualify('sha256:' || repeat('a', 64), p_revision => repeat('9', 40)) $$,
  'a connector production refusal does not block a later qualification');
insert into public.customer_data_release_decisions (scope, release_revision, allowed, receipt_sha256, evidence,
  evaluated_at, operator_actor, decision_reason)
select 'connector', repeat('8', 40), true, 'sha256:' || repeat('d', 64),
  (select jsonb_agg(jsonb_build_object('i', g)) from generate_series(1, 17) g),
  now() - interval '1 day', 'test-operator', 'connector production release';
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('b', 64), p_revision => repeat('8', 40)) $$,
  'P0001', 'qualification_after_release', 'no connector qualification can supersede an allowed connector release');
select is((select stage from public.customer_data_release_decisions
    where scope = 'connector' and release_revision = repeat('8', 40)
    order by recorded_at desc, allowed asc limit 1),
  'production', 'the allowed connector release stays the latest decision');
select ok(not has_function_privilege('authenticated',
  'public.issue_customer_data_workspace_grant(text, text, text, text, uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, text)',
  'EXECUTE'), 'the replaced writer is still service-role only');

select * from finish();
rollback;
