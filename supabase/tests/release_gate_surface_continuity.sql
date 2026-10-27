-- D-05 (20261027120000): a production release may name its gate-surface digest. The guard trigger
-- stays the authority: a surface on a qualification is refused, a refusal of a revision also refuses
-- its surface, no qualification can shadow a live surface release, and an unchanged grant writer
-- still issues only from an allowed, unexpired release (so an expired founder receipt grants nobody).
begin;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'd0a1a1a1-0000-4000-8000-0000000000d1', 'authenticated',
  'authenticated', 'surface-owner@example.invalid', '$2a$10$fixture', now(), '{}', '{}', now(), now());
insert into public.foundation_workspaces (workspace_key, display_name, created_by) values
  ('pilot-sd1d1d100004000', 'SD', 'd0a1a1a1-0000-4000-8000-0000000000d1')
on conflict (workspace_key) do nothing;
insert into public.foundation_workspace_members (workspace_key, user_id, role, state, accepted_at) values
  ('pilot-sd1d1d100004000', 'd0a1a1a1-0000-4000-8000-0000000000d1', 'owner', 'active', now())
on conflict (workspace_key, user_id) do nothing;
insert into public.foundation_processing_terms_acceptances (acceptance_id, workspace_key, user_id, actor_role,
  authorization_revision, terms_version, terms_path, terms_sha256, processing_path, processing_sha256, scope,
  request_id, accepted_at)
select 'd0a1a1a1-0000-4000-8000-00000000dd01', 'pilot-sd1d1d100004000', 'd0a1a1a1-0000-4000-8000-0000000000d1',
  'owner', m.authorization_revision, '2026-09-30', '/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md',
  'sha256:' || repeat('a', 64), '/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md', 'sha256:' || repeat('b', 64),
  'direct_upload', 'req-surface-fixture', now() - interval '1 hour'
from public.foundation_workspace_members m
where m.workspace_key = 'pilot-sd1d1d100004000' and m.user_id = 'd0a1a1a1-0000-4000-8000-0000000000d1';

-- A production release for revision X recorded with surface S (the founder's row).
create function pg_temp.release(p_revision text, p_receipt text, p_surface text default 'sha256:' || repeat('5', 64),
  p_evaluated timestamptz default now() - interval '1 day')
returns void language sql as $$
  insert into public.customer_data_release_decisions (scope, release_revision, allowed, receipt_sha256, evidence,
    evaluated_at, operator_actor, decision_reason, gate_surface_sha256)
  select 'direct_upload', p_revision, true, p_receipt,
    (select jsonb_agg(jsonb_build_object('i', g)) from generate_series(1, 12) g),
    p_evaluated, 'founder:sql-editor', 'production release for a gate surface', p_surface;
$$;
create function pg_temp.qualify(p_revision text) returns void language sql as $$
  insert into public.customer_data_release_decisions (schema_version, stage, scope, release_revision, allowed,
    receipt_sha256, evidence, missing, evaluated_at, operator_actor, decision_reason,
    qualification_workspace_key, qualification_expires_at)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', 'direct_upload', p_revision, true,
    'sha256:' || repeat('9', 64), (select jsonb_agg(jsonb_build_object('i', g)) from generate_series(1, 11) g),
    array['compile_receipts_signed_and_audited'], now() - interval '1 minute', 'delegated-operator:parent-agent',
    'bounded qualification', 'pilot-sd1d1d100004000', now() + interval '30 minutes');
$$;
-- The unchanged 20260930070000 writer, with server-computed receipts, for revision p_revision.
create function pg_temp.issue(p_revision text, p_release text) returns jsonb language plpgsql as $$
declare
  a public.foundation_processing_terms_acceptances;
  g public.customer_data_workspace_decisions;
begin
  select * into a from public.foundation_processing_terms_acceptances
   where acceptance_id = 'd0a1a1a1-0000-4000-8000-00000000dd01';
  g.schema_version := 'tavonel.customer_data_gate.v2';
  g.tenant_id := a.workspace_key; g.workspace_id := a.workspace_key; g.user_id := a.user_id;
  g.scope := 'direct_upload'; g.release_revision := p_revision; g.release_receipt_sha256 := p_release;
  g.terms_version := a.terms_version;
  g.terms_receipt_sha256 := public.processing_terms_receipt_sha256('terms', a);
  g.processing_terms_receipt_sha256 := public.processing_terms_receipt_sha256('processing', a);
  g.granted_at := date_trunc('milliseconds', clock_timestamp());
  g.expires_at := g.granted_at + interval '1 day';
  return public.issue_customer_data_workspace_grant(a.workspace_key, 'direct_upload', p_revision, p_release,
    a.acceptance_id, a.terms_version, a.terms_path, a.terms_sha256, a.processing_path, a.processing_sha256,
    g.terms_receipt_sha256, g.processing_terms_receipt_sha256, g.granted_at, g.expires_at,
    public.customer_data_workspace_grant_sha256(g));
end;
$$;

-- 1-3: shape. Only a production row carries a surface, and only a well-formed one.
select throws_ok($$ select pg_temp.release(repeat('1', 40), 'sha256:' || repeat('d', 64), 'sha256:short') $$,
  '23514', null, 'a malformed surface digest is refused');
select throws_ok($$
  insert into public.customer_data_release_decisions (schema_version, stage, scope, release_revision, allowed,
    receipt_sha256, evidence, missing, evaluated_at, operator_actor, decision_reason,
    qualification_workspace_key, qualification_expires_at, gate_surface_sha256)
  values ('tavonel.customer_data_gate.v2.qualification', 'qualification', 'direct_upload', repeat('1', 40), true,
    'sha256:' || repeat('9', 64), (select jsonb_agg(jsonb_build_object('i', g)) from generate_series(1, 11) g),
    array['compile_receipts_signed_and_audited'], now() - interval '1 minute', 'delegated-operator:parent-agent',
    'bounded qualification', 'pilot-sd1d1d100004000', now() + interval '30 minutes', 'sha256:' || repeat('5', 64)) $$,
  '23514', null, 'a qualification can never name a gate surface, so it never leaves its own SHA');
select lives_ok($$ select pg_temp.release(repeat('1', 40), 'sha256:' || repeat('d', 64)) $$,
  'a production release can name its gate surface');

-- 4-5: no qualification can shadow a live surface release, for that SHA or any other.
select throws_ok($$ select pg_temp.qualify(repeat('2', 40)) $$, 'P0001', 'qualification_over_surface_release',
  'a qualification for another SHA is refused while a surface release is live (it would shadow an inherited release)');
select throws_ok($$ select pg_temp.qualify(repeat('1', 40)) $$, 'P0001', 'qualification_after_release',
  'the exact-SHA refusal from 20260930070000 still holds');

-- 6-7: the unchanged grant writer issues under the release's own revision, never under one with no row.
select is(pg_temp.issue(repeat('1', 40), 'sha256:' || repeat('d', 64)) ->> 'releaseRevision', repeat('1', 40),
  'a grant is issued against the founder-recorded revision');
select throws_ok($$ select pg_temp.issue(repeat('2', 40), 'sha256:' || repeat('d', 64)) $$,
  'P0001', 'workspace_grant_release_changed',
  'the writer never grants a revision that has no release row of its own');

-- 8-9: refusing the revision also refuses its surface.
insert into public.customer_data_release_decisions (scope, release_revision, allowed, missing, evaluated_at,
  operator_actor, decision_reason)
values ('direct_upload', repeat('1', 40), false, array['founder_approval_receipt_recorded'], now(),
  'founder:sql-editor', 'revision refused');
select is((select gate_surface_sha256 from public.customer_data_release_decisions
    where scope = 'direct_upload' and release_revision = repeat('1', 40) and not allowed),
  'sha256:' || repeat('5', 64), 'a refusal that names no surface takes the surface its revision released');
select is((select allowed from public.customer_data_release_decisions
    where scope = 'direct_upload' and (release_revision = repeat('3', 40) or gate_surface_sha256 = 'sha256:' || repeat('5', 64))
    order by recorded_at desc, allowed asc, evaluated_at desc limit 1),
  false, 'so the latest decision any equal-surface deployment reads is the refusal');

-- 10-11: an expired founder receipt never releases: the writer refuses it, inherited or not.
select lives_ok($$ select pg_temp.release(repeat('4', 40), 'sha256:' || repeat('e', 64), 'sha256:' || repeat('7', 64),
  now() - interval '31 days') $$, 'an old release row can be recorded (the ledger is history)');
select throws_ok($$ select pg_temp.issue(repeat('4', 40), 'sha256:' || repeat('e', 64)) $$,
  'P0001', 'workspace_grant_release_changed', 'a release evaluated more than 30 days ago grants nobody');

-- 12: every release insert holds the scope-wide lock until commit.
select ok(exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
    and ((classid::bigint << 32) | objid::bigint)
      = hashtextextended('customer_data_release_decisions:direct_upload', 0)),
  'release inserts hold the scope-wide advisory lock, so decision order is total across revisions');

select * from finish();
rollback;
