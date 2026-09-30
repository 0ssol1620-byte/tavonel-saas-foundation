-- Qualification stage (20260930070000): the ledgers and the grant writer enforce scope, workspace,
-- the one-hour bound and refusal precedence themselves; production rows and digests are unchanged.
begin;
select plan(35);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c0a1a1a1-0000-4000-8000-0000000000a1', 'authenticated',
   'authenticated', 'qual-owner-a@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0b2b2b2-0000-4000-8000-0000000000b2', 'authenticated',
   'authenticated', 'qual-owner-b@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now());
insert into public.foundation_workspaces (workspace_key, display_name, created_by) values
  ('pilot-qa1a1a100004000', 'QA', 'c0a1a1a1-0000-4000-8000-0000000000a1'),
  ('pilot-qb2b2b200004000', 'QB', 'c0b2b2b2-0000-4000-8000-0000000000b2')
on conflict (workspace_key) do nothing;
insert into public.foundation_workspace_members (workspace_key, user_id, role, state, accepted_at) values
  ('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-0000000000a1', 'owner', 'active', now()),
  ('pilot-qb2b2b200004000', 'c0b2b2b2-0000-4000-8000-0000000000b2', 'owner', 'active', now())
on conflict (workspace_key, user_id) do nothing;
insert into public.foundation_processing_terms_acceptances (acceptance_id, workspace_key, user_id, actor_role,
  authorization_revision, terms_version, terms_path, terms_sha256, processing_path, processing_sha256, scope,
  request_id, accepted_at)
select v.id, v.ws, v.uid, 'owner', m.authorization_revision, '2026-09-30',
  '/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md', 'sha256:' || repeat('a', 64),
  '/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md', 'sha256:' || repeat('b', 64), 'direct_upload',
  'req-qual-fixture', now() - interval '1 hour'
from (values
  ('c0a1a1a1-0000-4000-8000-00000000aa01'::uuid, 'pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-0000000000a1'::uuid),
  ('c0b2b2b2-0000-4000-8000-00000000bb01'::uuid, 'pilot-qb2b2b200004000', 'c0b2b2b2-0000-4000-8000-0000000000b2'::uuid)
) v(id, ws, uid)
join public.foundation_workspace_members m on m.workspace_key = v.ws and m.user_id = v.uid;

create function pg_temp.eleven() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('precondition', 'fact_' || g)) from generate_series(1, 11) g
$$;
-- Records a qualification release for workspace A (or p_ws) as the latest row.
create function pg_temp.qualify(p_receipt text, p_ws text default 'pilot-qa1a1a100004000',
  p_evaluated timestamptz default now() - interval '1 minute', p_ttl interval default interval '50 minutes')
returns void language sql as $$
  insert into public.customer_data_release_decisions (schema_version, stage, scope, release_revision, allowed,
    receipt_sha256, evidence, missing, evaluated_at, recorded_at, operator_actor, decision_reason,
    qualification_workspace_key, qualification_expires_at)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', 'direct_upload', repeat('a', 40), true,
    p_receipt, pg_temp.eleven(), array['compile_receipts_signed_and_audited'], p_evaluated, clock_timestamp(),
    'delegated-operator:parent-agent', 'bounded qualification under the founder standing delegation',
    p_ws, p_evaluated + p_ttl);
$$;
-- Computes the receipts exactly as the server does (schema from the named stage), then calls the RPC.
create function pg_temp.issue(p_ws text, p_acceptance uuid, p_release text,
  p_stage text default 'qualification', p_ttl interval default interval '30 minutes',
  p_revision text default repeat('a', 40), p_scope text default 'direct_upload')
returns jsonb language plpgsql as $$
declare
  a public.foundation_processing_terms_acceptances;
  g public.customer_data_workspace_decisions;
begin
  select * into a from public.foundation_processing_terms_acceptances where acceptance_id = p_acceptance;
  g.schema_version := case p_stage when 'qualification' then 'tavonel.customer_data_gate.v2.qualification'
    else 'tavonel.customer_data_gate.v2' end;
  g.tenant_id := p_ws; g.workspace_id := p_ws; g.scope := p_scope; g.release_revision := p_revision;
  g.user_id := coalesce(a.user_id, 'c0a1a1a1-0000-4000-8000-0000000000a1'); g.release_receipt_sha256 := p_release;
  g.terms_version := '2026-09-30';
  g.terms_receipt_sha256 := coalesce(public.processing_terms_receipt_sha256('terms', a), 'sha256:' || repeat('1', 64));
  g.processing_terms_receipt_sha256 :=
    coalesce(public.processing_terms_receipt_sha256('processing', a), 'sha256:' || repeat('2', 64));
  g.granted_at := date_trunc('milliseconds', clock_timestamp());
  g.expires_at := g.granted_at + p_ttl;
  return public.issue_customer_data_workspace_grant(p_ws, p_scope, p_revision, p_release,
    p_acceptance, '2026-09-30', '/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md', 'sha256:' || repeat('a', 64),
    '/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md', 'sha256:' || repeat('b', 64),
    g.terms_receipt_sha256, g.processing_terms_receipt_sha256, g.granted_at, g.expires_at,
    public.customer_data_workspace_grant_sha256(g));
end;
$$;
create function pg_temp.pinned(p_schema text) returns text language plpgsql as $$
declare g public.customer_data_workspace_decisions;
begin
  g.schema_version := p_schema;
  g.tenant_id := 'pilot-c0a1a1a100004000'; g.workspace_id := g.tenant_id;
  g.user_id := 'c0a1a1a1-0000-4000-8000-000000000001'; g.scope := 'direct_upload';
  g.release_revision := repeat('a', 40); g.release_receipt_sha256 := 'sha256:' || repeat('d', 64);
  g.terms_version := '2026-09-30'; g.terms_receipt_sha256 := 'sha256:' || repeat('1', 64);
  g.processing_terms_receipt_sha256 := 'sha256:' || repeat('2', 64);
  g.granted_at := '2026-09-30T00:00:00.123Z'; g.expires_at := '2026-09-30T01:00:00.000Z';
  return public.customer_data_workspace_grant_sha256(g);
end;
$$;

-- 1-2: digest parity with workspaceGrantSha256 (pinned in processing-workspace-grant.test.ts); a row
-- without a schema version hashes to nothing.
select is(pg_temp.pinned('tavonel.customer_data_gate.v2.qualification'),
  'sha256:e9b93be98f017dae135364ec48620a6ba063651c0c6ef054f3dbc6651794a7d3',
  'qualification grant receipt matches the TypeScript digest');
select is(pg_temp.pinned(null), null, 'a grant row without a schema version has no digest');

-- 3-12: the release ledger accepts exactly one qualification shape.
select lives_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64)) $$,
  'an 11-fact, one-workspace, one-hour, delegated qualification is recordable');
select throws_ok($$ insert into public.customer_data_release_decisions (schema_version, stage, scope,
    release_revision, allowed, receipt_sha256, evidence, missing, evaluated_at, operator_actor, decision_reason,
    qualification_workspace_key, qualification_expires_at)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', 'direct_upload', repeat('a', 40), true,
    'sha256:' || repeat('e', 64),
    pg_temp.eleven() - 0 || '[{"precondition": "compile_receipts_signed_and_audited"}]'::jsonb,
    array['compile_receipts_signed_and_audited'], now(), 'delegated-operator:x', 'claims the audited compile',
    'pilot-qa1a1a100004000', now() + interval '10 minutes') $$,
  '23514', null, 'a qualification cannot claim the audited compile');
select throws_ok($$ insert into public.customer_data_release_decisions (schema_version, stage, scope,
    release_revision, allowed, receipt_sha256, evidence, missing, evaluated_at, operator_actor, decision_reason,
    qualification_workspace_key, qualification_expires_at)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', 'direct_upload', repeat('a', 40), true,
    'sha256:' || repeat('e', 64), pg_temp.eleven(), '{}', now(), 'delegated-operator:x', 'no pending fact',
    'pilot-qa1a1a100004000', now() + interval '10 minutes') $$,
  '23514', null, 'a qualification must name the audited compile as pending');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64), p_ttl => interval '1 hour 1 millisecond') $$,
  '23514', null, 'a qualification cannot outlive one hour');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('e', 64), p_ws => 'pilot-*') $$,
  '23514', null, 'a qualification names exactly one workspace key');
select throws_ok($$ insert into public.customer_data_release_decisions (schema_version, stage, scope,
    release_revision, allowed, receipt_sha256, evidence, missing, evaluated_at, operator_actor, decision_reason,
    qualification_workspace_key, qualification_expires_at)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', 'connector', repeat('a', 40), true,
    'sha256:' || repeat('e', 64), pg_temp.eleven(), array['compile_receipts_signed_and_audited'], now(),
    'delegated-operator:x', 'connector', 'pilot-qa1a1a100004000', now() + interval '10 minutes') $$,
  '23514', null, 'a qualification is direct_upload only');
select throws_ok($$ insert into public.customer_data_release_decisions (schema_version, stage, scope,
    release_revision, allowed, receipt_sha256, evidence, missing, evaluated_at, operator_actor, decision_reason,
    qualification_workspace_key, qualification_expires_at)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', 'direct_upload', repeat('a', 40), true,
    'sha256:' || repeat('e', 64), pg_temp.eleven(), array['compile_receipts_signed_and_audited'], now(),
    'founder', 'labelled as a personal founder decision', 'pilot-qa1a1a100004000', now() + interval '10 minutes') $$,
  '23514', null, 'a qualification is recorded by a delegated operator, not as a founder signature');
select throws_ok($$ insert into public.customer_data_release_decisions (stage, scope, release_revision, allowed,
    receipt_sha256, evidence, missing, evaluated_at, operator_actor, decision_reason)
  values ('qualification', 'direct_upload', repeat('a', 40), false, null, '[]', array['x'], now(),
    'delegated-operator:x', 'stage without its schema') $$,
  '23514', null, 'stage and schema version move together');
select throws_ok($$ insert into public.customer_data_release_decisions (scope, release_revision, allowed,
    receipt_sha256, evidence, evaluated_at, operator_actor, decision_reason, qualification_workspace_key)
  values ('direct_upload', repeat('a', 40), true, 'sha256:' || repeat('d', 64),
    (select jsonb_agg(jsonb_build_object('i', g)) from generate_series(1, 12) g), now(), 'test-operator',
    'production with a workspace', 'pilot-qa1a1a100004000') $$,
  '23514', null, 'a production release names no qualification workspace');
select throws_ok($$ insert into public.customer_data_release_decisions (stage, scope, release_revision, allowed,
    missing, evaluated_at, operator_actor, decision_reason)
  values ('canary', 'direct_upload', repeat('a', 40), false, array['x'], now(), 'test-operator', 'unknown stage') $$,
  '23514', null, 'an unknown stage is refused');

-- 13-17: the writer issues an hour-bounded qualification grant to the recorded workspace only.
select is(pg_temp.issue('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000aa01',
    'sha256:' || repeat('e', 64)) ->> 'stage', 'qualification', 'the recorded workspace gets a qualification grant');
select ok((select stage = 'qualification' and schema_version = 'tavonel.customer_data_gate.v2.qualification'
    and grant_receipt_sha256 = public.customer_data_workspace_grant_sha256(d)
    and expires_at <= granted_at + interval '1 hour'
  from public.customer_data_workspace_decisions d where tenant_id = 'pilot-qa1a1a100004000'),
  'the stored grant carries its stage, schema and self-consistent digest');
select is(pg_temp.issue('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000aa01',
    'sha256:' || repeat('e', 64)) ->> 'idempotentReplay', 'true', 'a retry replays the live qualification grant');
select throws_ok($$ select pg_temp.issue('pilot-qb2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000bb01',
  'sha256:' || repeat('e', 64)) $$, 'P0001', 'workspace_grant_qualification_refused',
  'a qualification never grants a workspace it does not name');
select throws_ok($$ select pg_temp.issue('pilot-qb2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000bb01',
  'sha256:' || repeat('e', 64), p_stage => 'production') $$, 'P0001', 'workspace_grant_qualification_refused',
  'nor can the caller relabel it as production');

-- 18-22: expiry, deployed SHA, scope escalation and absent terms.
select throws_ok($$ select pg_temp.issue('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000aa01',
  'sha256:' || repeat('e', 64), p_ttl => interval '55 minutes') $$, 'P0001', 'workspace_grant_qualification_refused',
  'a grant cannot outlive its qualification');
select throws_ok($$ select pg_temp.issue('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000aa01',
  'sha256:' || repeat('e', 64), p_revision => repeat('b', 40)) $$, 'P0001', 'workspace_grant_release_changed',
  'a qualification binds one deployed SHA');
select throws_ok($$ select pg_temp.issue('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000aa01',
  'sha256:' || repeat('e', 64), p_scope => 'connector') $$, 'P0001', 'workspace_grant_release_changed',
  'a direct-upload qualification never grants connector scope');
select throws_ok($$ insert into public.customer_data_workspace_decisions (schema_version, stage, tenant_id,
    workspace_id, scope, release_revision, allowed, user_id, release_receipt_sha256, terms_version,
    terms_receipt_sha256, processing_terms_receipt_sha256, grant_receipt_sha256, granted_at, expires_at,
    operator_actor, decision_reason)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', 'pilot-qa1a1a100004000',
    'pilot-qa1a1a100004000', 'direct_upload', repeat('a', 40), true, 'c0a1a1a1-0000-4000-8000-0000000000a1',
    'sha256:' || repeat('e', 64), '2026-09-30', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
    'sha256:' || repeat('3', 64), now(), now() + interval '2 hours', 'test-operator', 'direct two-hour grant') $$,
  '23514', null, 'even a direct insert cannot hold a qualification grant beyond one hour');
select throws_ok($$ select pg_temp.issue('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000ffff',
  'sha256:' || repeat('e', 64)) $$, 'P0001', 'workspace_grant_acceptance_required',
  'no qualification grant without the current owner''s terms acceptance');

-- 23-25: a later production refusal ends the qualification; nothing falls back to it.
insert into public.customer_data_release_decisions (scope, release_revision, allowed, missing, evaluated_at,
  recorded_at, operator_actor, decision_reason)
values ('direct_upload', repeat('a', 40), false, array['compile_receipts_signed_and_audited'], now(),
  clock_timestamp(), 'test-operator', 'production refused');
select throws_ok($$ select pg_temp.issue('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000aa01',
  'sha256:' || repeat('e', 64)) $$, 'P0001', 'workspace_grant_release_changed',
  'a later production refusal is final for the still-unexpired qualification');
select pg_temp.qualify('sha256:' || repeat('f', 64), p_evaluated => now() - interval '2 hours',
  p_ttl => interval '1 hour');
select throws_ok($$ select pg_temp.issue('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000aa01',
  'sha256:' || repeat('f', 64)) $$, 'P0001', 'workspace_grant_qualification_refused',
  'an expired qualification grants nobody');
insert into public.customer_data_workspace_decisions (tenant_id, workspace_id, scope, release_revision, allowed,
  operator_actor, decision_reason)
values ('pilot-qa1a1a100004000', 'pilot-qa1a1a100004000', 'direct_upload', repeat('a', 40), false,
  'test-operator', 'workspace refused');
select pg_temp.qualify('sha256:' || repeat('c', 64));
select throws_ok($$ select pg_temp.issue('pilot-qa1a1a100004000', 'c0a1a1a1-0000-4000-8000-00000000aa01',
  'sha256:' || repeat('c', 64)) $$, 'P0001', 'workspace_grant_refused',
  'a fresh qualification never writes over the workspace''s explicit refusal');

-- PostgreSQL CHECK accepts NULL, so both qualification bounds must be explicitly required.
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('b', 64), p_ws => null) $$,
  '23514', null, 'a qualification cannot omit its workspace');
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('b', 64), p_ttl => null) $$,
  '23514', null, 'a qualification cannot omit its expiry');

-- 28-35: a production release issues exactly as before, with the v2 schema and digest, and no
-- qualification can be recorded over it.
insert into public.customer_data_release_decisions (scope, release_revision, allowed, receipt_sha256, evidence,
  evaluated_at, recorded_at, operator_actor, decision_reason)
select 'direct_upload', repeat('a', 40), true, 'sha256:' || repeat('d', 64),
  (select jsonb_agg(jsonb_build_object('i', g)) from generate_series(1, 12) g),
  now() - interval '1 day', clock_timestamp(), 'test-operator', 'production release';
select is((select stage from public.customer_data_release_decisions order by recorded_at desc limit 1),
  'production', 'an unlabelled release row is production');
select throws_ok($$ select pg_temp.issue('pilot-qb2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000bb01',
  'sha256:' || repeat('d', 64), p_stage => 'qualification', p_ttl => interval '30 minutes') $$,
  'P0001', 'workspace_grant_input_invalid', 'a qualification-labelled digest does not pass for a production grant');
select is(pg_temp.issue('pilot-qb2b2b200004000', 'c0b2b2b2-0000-4000-8000-00000000bb01',
    'sha256:' || repeat('d', 64), p_stage => 'production', p_ttl => interval '7 days') ->> 'stage',
  'production', 'a production release issues a production grant');
select ok((select schema_version = 'tavonel.customer_data_gate.v2'
    and grant_receipt_sha256 = public.customer_data_workspace_grant_sha256(d)
  from public.customer_data_workspace_decisions d where tenant_id = 'pilot-qb2b2b200004000'),
  'the production grant keeps the v2 schema and digest');
select ok(not has_function_privilege('authenticated',
  'public.issue_customer_data_workspace_grant(text, text, text, text, uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, text)',
  'EXECUTE'), 'the replaced writer is still service-role only');

-- Review F1: a qualification after an allowed production release would close every other workspace.
select throws_ok($$ select pg_temp.qualify('sha256:' || repeat('9', 64)) $$,
  'P0001', 'qualification_after_release', 'no qualification can supersede an allowed production release');
select is((select stage from public.customer_data_release_decisions
    where scope = 'direct_upload' and release_revision = repeat('a', 40)
    order by recorded_at desc, allowed asc limit 1),
  'production', 'the allowed production release stays the latest decision');
select ok(exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted),
  'release inserts hold the (scope, revision) advisory lock until commit, serializing concurrent writers');

select * from finish();
rollback;
