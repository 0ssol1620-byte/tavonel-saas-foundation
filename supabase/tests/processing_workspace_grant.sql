-- Workspace grants: service-role only, issued from the current owner's acceptance and the latest
-- allowed release, idempotent, and never written over an explicit refusal.
begin;
select plan(22);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c0a1a1a1-0000-4000-8000-000000000001', 'authenticated',
   'authenticated', 'grant-owner-a@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0b2b2b2-0000-4000-8000-000000000002', 'authenticated',
   'authenticated', 'grant-owner-b@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now());
insert into public.foundation_workspaces (workspace_key, display_name, created_by) values
  ('pilot-c0a1a1a100004000', 'A', 'c0a1a1a1-0000-4000-8000-000000000001'),
  ('pilot-c0b2b2b200004000', 'B', 'c0b2b2b2-0000-4000-8000-000000000002')
on conflict (workspace_key) do nothing;
insert into public.foundation_workspace_members (workspace_key, user_id, role, state, accepted_at) values
  ('pilot-c0a1a1a100004000', 'c0a1a1a1-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-000000000002', 'owner', 'active', now())
on conflict (workspace_key, user_id) do nothing;

-- Acceptances are written directly (as the table owner) so their ids are pinned.
insert into public.foundation_processing_terms_acceptances (acceptance_id, workspace_key, user_id, actor_role,
  authorization_revision, terms_version, terms_path, terms_sha256, processing_path, processing_sha256, scope,
  request_id, accepted_at)
select v.id, v.ws, v.uid, 'owner', m.authorization_revision, '2026-09-30',
  '/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md', 'sha256:' || repeat('a', 64),
  '/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md', 'sha256:' || repeat('b', 64), 'direct_upload',
  'req-grant-fixture', now() - interval '1 hour'
from (values
  ('c0a1a1a1-0000-4000-8000-00000000a001'::uuid, 'pilot-c0a1a1a100004000', 'c0a1a1a1-0000-4000-8000-000000000001'::uuid),
  ('c0b2b2b2-0000-4000-8000-00000000b001'::uuid, 'pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-000000000002'::uuid)
) v(id, ws, uid)
join public.foundation_workspace_members m on m.workspace_key = v.ws and m.user_id = v.uid;

insert into public.customer_data_release_decisions (scope, release_revision, allowed, receipt_sha256, evidence,
  evaluated_at, recorded_at, operator_actor, decision_reason)
select 'direct_upload', repeat('a', 40), true, 'sha256:' || repeat('d', 64),
  (select jsonb_agg(jsonb_build_object('i', g)) from generate_series(1, 12) g),
  now() - interval '1 day', now() - interval '1 day' + interval '1 second', 'test-operator', 'fixture release';

-- Computes the receipts exactly as the server does, then calls the RPC.
create function pg_temp.issue(p_ws text, p_acceptance uuid,
  p_release text default 'sha256:' || repeat('d', 64),
  p_terms_sha text default 'sha256:' || repeat('a', 64),
  p_ttl interval default interval '7 days')
returns jsonb language plpgsql as $$
declare
  a public.foundation_processing_terms_acceptances;
  g public.customer_data_workspace_decisions;
begin
  select * into a from public.foundation_processing_terms_acceptances where acceptance_id = p_acceptance;
  g.schema_version := 'tavonel.customer_data_gate.v2';
  g.tenant_id := p_ws; g.workspace_id := p_ws; g.scope := 'direct_upload'; g.release_revision := repeat('a', 40);
  g.user_id := a.user_id; g.release_receipt_sha256 := p_release; g.terms_version := '2026-09-30';
  g.terms_receipt_sha256 := public.processing_terms_receipt_sha256('terms', a);
  g.processing_terms_receipt_sha256 := public.processing_terms_receipt_sha256('processing', a);
  g.granted_at := date_trunc('milliseconds', clock_timestamp());
  g.expires_at := g.granted_at + p_ttl;
  return public.issue_customer_data_workspace_grant(p_ws, 'direct_upload', g.release_revision, p_release,
    p_acceptance, '2026-09-30', a.terms_path, p_terms_sha, a.processing_path, a.processing_sha256,
    g.terms_receipt_sha256, g.processing_terms_receipt_sha256, g.granted_at, g.expires_at,
    public.customer_data_workspace_grant_sha256(g));
end;
$$;

create function pg_temp.pinned_grant_sha256() returns text language plpgsql as $$
declare g public.customer_data_workspace_decisions;
begin
  g.schema_version := 'tavonel.customer_data_gate.v2';
  g.tenant_id := 'pilot-c0a1a1a100004000'; g.workspace_id := g.tenant_id;
  g.user_id := 'c0a1a1a1-0000-4000-8000-000000000001'; g.scope := 'direct_upload';
  g.release_revision := repeat('a', 40); g.release_receipt_sha256 := 'sha256:' || repeat('d', 64);
  g.terms_version := '2026-09-30'; g.terms_receipt_sha256 := 'sha256:' || repeat('1', 64);
  g.processing_terms_receipt_sha256 := 'sha256:' || repeat('2', 64);
  g.granted_at := '2026-09-30T00:00:00.123Z'; g.expires_at := '2026-10-29T00:00:00.000Z';
  return public.customer_data_workspace_grant_sha256(g);
end;
$$;

-- 1-4: only the service role may issue; the hash helpers are internal.
select ok(not has_function_privilege('anon', 'public.issue_customer_data_workspace_grant(text, text, text, text, uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, text)', 'EXECUTE'),
  'anon cannot issue grants');
select ok(not has_function_privilege('authenticated', 'public.issue_customer_data_workspace_grant(text, text, text, text, uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, text)', 'EXECUTE'),
  'authenticated cannot issue grants');
select ok(has_function_privilege('service_role', 'public.issue_customer_data_workspace_grant(text, text, text, text, uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, text)', 'EXECUTE'),
  'service_role may call the narrow writer');
select ok(not has_function_privilege('service_role', 'public.customer_data_workspace_grant_sha256(public.customer_data_workspace_decisions)', 'EXECUTE'),
  'grant hash helper is internal');

-- 5-6: byte parity with the TypeScript hashes (pinned in processing-workspace-grant.test.ts).
select is(public.processing_terms_receipt_sha256('terms', a),
  'sha256:aa98c2784eca086344961c2f34f00fc88c9765aadd84c42fee86340d773da81b', 'terms receipt matches the server hash')
from public.foundation_processing_terms_acceptances a where acceptance_id = 'c0a1a1a1-0000-4000-8000-00000000a001';
select is(pg_temp.pinned_grant_sha256(),
  'sha256:6ce4b1d04eecc27e2e6c51febe879df2778f4e547fb0cf73f23805b63666c4c6', 'grant receipt matches workspaceGrantSha256');

-- 7-10: first issuance inserts; a retry through the service role replays the same row.
select is(pg_temp.issue('pilot-c0a1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000a001') ->> 'idempotentReplay',
  'false', 'first issuance records a grant');
select ok((select allowed and tenant_id = workspace_id and user_id = 'c0a1a1a1-0000-4000-8000-000000000001'
    and grant_receipt_sha256 = public.customer_data_workspace_grant_sha256(d)
  from public.customer_data_workspace_decisions d where tenant_id = 'pilot-c0a1a1a100004000'),
  'stored grant is tenant-bound, owner-bound and self-consistent');
create temporary table retry_args as
select a.*, public.processing_terms_receipt_sha256('terms', a) as terms_receipt,
  public.processing_terms_receipt_sha256('processing', a) as processing_receipt
from public.foundation_processing_terms_acceptances a
join public.customer_data_workspace_decisions d on d.tenant_id = a.workspace_key
where a.acceptance_id = 'c0a1a1a1-0000-4000-8000-00000000a001';
grant select on retry_args to service_role;
set local role service_role;
select is((select public.issue_customer_data_workspace_grant(workspace_key, 'direct_upload', repeat('a', 40),
    'sha256:' || repeat('d', 64), acceptance_id, terms_version, terms_path, terms_sha256, processing_path,
    processing_sha256, terms_receipt, processing_receipt, date_trunc('milliseconds', clock_timestamp()),
    date_trunc('milliseconds', clock_timestamp()) + interval '1 day', 'sha256:' || repeat('0', 64))
  from retry_args) ->> 'idempotentReplay', 'true', 'a retry replays the live grant without rewriting it');
reset role;
select is((select count(*)::int from public.customer_data_workspace_decisions where tenant_id = 'pilot-c0a1a1a100004000'),
  1, 'retries do not append grants');

-- 11-13: cross-workspace, changed manifest and forged release receipts are refused.
select throws_ok($$ select pg_temp.issue('pilot-c0b2b2b200004000', 'c0a1a1a1-0000-4000-8000-00000000a001') $$,
  'P0001', 'workspace_grant_acceptance_required', 'an acceptance cannot grant another workspace');
select throws_ok($$ select pg_temp.issue('pilot-c0a1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000a001',
  p_terms_sha => 'sha256:' || repeat('c', 64)) $$,
  'P0001', 'workspace_grant_acceptance_required', 'a changed terms document has no acceptance');
select throws_ok($$ select pg_temp.issue('pilot-c0a1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000a001',
  p_release => 'sha256:' || repeat('e', 64)) $$,
  'P0001', 'workspace_grant_release_changed', 'a grant must name the latest release receipt');

-- 14-15: expiry is bounded by 30 days and by release evaluation + 30 days.
select throws_ok($$ select pg_temp.issue('pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000b001',
  p_ttl => interval '30 days 1 millisecond') $$,
  'P0001', 'workspace_grant_input_invalid', 'a grant cannot outlive 30 days');
select throws_ok($$ select pg_temp.issue('pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000b001',
  p_ttl => interval '30 days') $$,
  'P0001', 'workspace_grant_release_changed', 'a grant cannot outlive its release evidence');

-- 16-18: an explicit refusal is definitive even when written with a backdated clock.
insert into public.customer_data_workspace_decisions (tenant_id, workspace_id, scope, release_revision, allowed,
  recorded_at, operator_actor, decision_reason)
values ('pilot-c0a1a1a100004000', 'pilot-c0a1a1a100004000', 'direct_upload', repeat('a', 40), false,
  '2000-01-01T00:00:00Z', 'test-operator', 'operator refusal');
select ok((select not allowed from public.customer_data_workspace_decisions where tenant_id = 'pilot-c0a1a1a100004000'
  order by recorded_at desc, allowed asc limit 1), 'a refusal recorded after a grant is the latest decision');
select throws_ok($$ select pg_temp.issue('pilot-c0a1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000a001') $$,
  'P0001', 'workspace_grant_refused', 'renewal never writes over an explicit refusal');
select is((select count(*)::int from public.customer_data_workspace_decisions
  where tenant_id = 'pilot-c0a1a1a100004000' and allowed), 1, 'the refused workspace gained no grant');

-- 19-20: an owner change retires the acceptance it was bound to.
update public.foundation_workspace_members set state = 'revoked', revoked_at = now()
 where workspace_key = 'pilot-c0b2b2b200004000' and user_id = 'c0b2b2b2-0000-4000-8000-000000000002';
select throws_ok($$ select pg_temp.issue('pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000b001') $$,
  'P0001', 'workspace_grant_acceptance_required', 'a revoked owner''s acceptance grants nothing');
update public.foundation_workspace_members set state = 'active', revoked_at = null, accepted_at = now()
 where workspace_key = 'pilot-c0b2b2b200004000' and user_id = 'c0b2b2b2-0000-4000-8000-000000000002';
select throws_ok($$ select pg_temp.issue('pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000b001') $$,
  'P0001', 'workspace_grant_acceptance_required', 'reinstatement does not resurrect the old acceptance');

-- 21-22: a later release refusal or a stale release stops issuance.
insert into public.foundation_processing_terms_acceptances (acceptance_id, workspace_key, user_id, actor_role,
  authorization_revision, terms_version, terms_path, terms_sha256, processing_path, processing_sha256, scope,
  request_id, accepted_at)
select 'c0b2b2b2-0000-4000-8000-00000000b002', workspace_key, user_id, 'owner', authorization_revision, '2026-09-30',
  '/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md', 'sha256:' || repeat('a', 64),
  '/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md', 'sha256:' || repeat('b', 64), 'direct_upload',
  'req-grant-fixture-2', now() - interval '1 minute'
from public.foundation_workspace_members
where workspace_key = 'pilot-c0b2b2b200004000' and user_id = 'c0b2b2b2-0000-4000-8000-000000000002';
insert into public.customer_data_release_decisions (scope, release_revision, allowed, missing, evaluated_at,
  recorded_at, operator_actor, decision_reason)
values ('direct_upload', repeat('a', 40), false, array['release_refused'], now(), clock_timestamp(),
  'test-operator', 'release withdrawn');
select throws_ok($$ select pg_temp.issue('pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000b002') $$,
  'P0001', 'workspace_grant_release_changed', 'a refused release grants nobody');
insert into public.customer_data_release_decisions (scope, release_revision, allowed, receipt_sha256, evidence,
  evaluated_at, recorded_at, operator_actor, decision_reason)
select 'direct_upload', repeat('a', 40), true, 'sha256:' || repeat('d', 64),
  (select jsonb_agg(jsonb_build_object('i', g)) from generate_series(1, 12) g),
  now() - interval '31 days', clock_timestamp(), 'test-operator', 'expired release';
select throws_ok($$ select pg_temp.issue('pilot-c0b2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000b002',
  p_ttl => interval '1 hour') $$,
  'P0001', 'workspace_grant_release_changed', 'an expired release grants nobody');

select * from finish();
rollback;
