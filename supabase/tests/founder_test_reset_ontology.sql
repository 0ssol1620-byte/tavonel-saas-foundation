-- Founder test reset vs. W2-C1's ontology tables (migration 20261107110100):
--   - runs, candidates and decisions are counted in the sealed manifest and fingerprinted (a
--     derivation recorded after prepare is drift), fenced while sealed, and deleted by finalize for
--     the reset workspace only;
--   - after finalize the founder workspace has no proposed schema and no decision, so its next World
--     is derived afresh; the bystander's run is byte-identical;
--   - nothing of them is archived: they are derived from rows the reset deletes.
--
-- Everything runs inside this rolled-back transaction on the disposable rehearsal database. Each
-- auth.users insert bootstraps a legacy workspace and a foundation workspace (0001, 20260920121000):
--   pilot-f0f0f0f0f0f04f0f  the founder test identity (enterprise, grace 0, hold off) -- the subject
--   pilot-e5e5e5e5e5e54e5e  an unrelated self-service workspace -- must be left alone
begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'authenticated', 'authenticated',
   '0ssol1620@gmail.com', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'authenticated', 'authenticated',
   'reset-bystander@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_account_access_grants (user_id, grant_kind, access_plan, active)
values ('f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'owner', 'studio_access', true);
insert into public.enterprise_organizations (organization_id, name, slug, created_by)
values ('0a200000-0000-4000-8000-000000000001', 'Founder Reset', 'founder-reset-fixture', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');
insert into public.enterprise_organization_memberships (organization_id, user_id, role, created_by)
values ('0a200000-0000-4000-8000-000000000001', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'owner', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');
insert into public.enterprise_workspaces (workspace_key, organization_id, display_name)
values ('pilot-f0f0f0f0f0f04f0f', '0a200000-0000-4000-8000-000000000001', 'Founder Reset');
insert into public.enterprise_workspace_memberships (workspace_key, user_id, role, created_by)
values ('pilot-f0f0f0f0f0f04f0f', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'owner', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');
insert into public.enterprise_governance_policies (organization_id, deleted_object_grace_days, legal_hold_enabled, updated_by)
values ('0a200000-0000-4000-8000-000000000001', 0, false, 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0');

create function pg_temp.run(p_workspace text, p_actor text, p_inputs text) returns jsonb language sql as $f$
  select public.record_ontology_derivation_run(p_workspace,
    jsonb_build_object('collectionId', 'collection-' || repeat('c', 32), 'manifestDigest', 'sha256:' || repeat('d', 64),
      'deriver', 'baseline', 'deriverVersion', 'baseline-frequency:1',
      'documentIds', jsonb_build_array('0a000000-0000-4000-8000-0000000000f0'),
      'inputsSha256', 'sha256:' || repeat(p_inputs, 64), 'schemaSha256', 'sha256:' || repeat('2', 64),
      'modelId', 'tavonel:ontology-baseline-frequency', 'modelRevision', '1', 'priceSnapshot', '{"usd":0}'::jsonb,
      'receipt', '{}'::jsonb, 'receiptSha256', 'sha256:' || repeat('3', 64), 'createdBy', p_actor),
    jsonb_build_array(jsonb_build_object('kind', 'class', 'key', 'registrant', 'label', 'Registrant', 'support', 2,
      'evidence', jsonb_build_array(jsonb_build_object('evidenceId', 'ev-1', 'documentId', '0a000000-0000-4000-8000-0000000000f0',
        'page', 1, 'bbox', jsonb_build_array(0, 0, 1000, 100), 'quote', 'Apple Inc.')))))
$f$;
create function pg_temp.ontology_rows(p_workspace text) returns text language sql as $f$
  select coalesce(string_agg(x, E'\n' order by x), '') from (
    select to_jsonb(r)::text x from public.ontology_derivation_runs r where r.workspace_key = p_workspace
    union all select to_jsonb(c)::text from public.ontology_schema_candidates c where c.workspace_key = p_workspace
    union all select to_jsonb(d)::text from public.ontology_certification_decisions d where d.workspace_key = p_workspace) q
$f$;
create function pg_temp.ontology_count(p_workspace text) returns integer language sql as $f$
  select ((select count(*) from public.ontology_derivation_runs where workspace_key = p_workspace)
    + (select count(*) from public.ontology_schema_candidates where workspace_key = p_workspace)
    + (select count(*) from public.ontology_certification_decisions where workspace_key = p_workspace))::integer
$f$;

-- One derivation in each workspace, and one decision in the founder's.
select pg_temp.run('pilot-f0f0f0f0f0f04f0f', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', '1');
select pg_temp.run('pilot-e5e5e5e5e5e54e5e', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', '1');
select public.decide_ontology_schema_candidate('pilot-f0f0f0f0f0f04f0f',
  (select candidate_id from public.ontology_schema_candidates where workspace_key = 'pilot-f0f0f0f0f0f04f0f'),
  'certify', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'Fixture certification.', null);

select is(pg_temp.ontology_count('pilot-f0f0f0f0f0f04f0f'), 3, 'fixture: the founder workspace has a run, a candidate and a decision');
create temp table bystander_before as select pg_temp.ontology_rows('pilot-e5e5e5e5e5e54e5e') as rows;

-- ---------------------------------------------------------------------------
-- Prepare and seal
-- ---------------------------------------------------------------------------
create temp table prepared as select public.prepare_founder_test_reset('0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f') as r;
select is((select jsonb_build_array((r->'dbCounts'->>'ontology_derivation_runs')::integer,
  (r->'dbCounts'->>'ontology_schema_candidates')::integer, (r->'dbCounts'->>'ontology_certification_decisions')::integer) from prepared),
  '[1,1,1]'::jsonb, 'the sealed manifest counts the three tables');

select throws_ok($$do $d$ begin
  perform pg_temp.run('pilot-f0f0f0f0f0f04f0f', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', '9');
  perform public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
    'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
    'sha256:' || repeat('b', 64), '[]'::jsonb);
end $d$;$$, 'P0001', 'founder_test_reset_database_drift', 'a derivation recorded after prepare is database drift');

select is(public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
  'sha256:' || repeat('b', 64), '[]'::jsonb)->>'status', 'sealed', 'the reset seals with a proposed schema present');

select throws_ok($$select pg_temp.run('pilot-f0f0f0f0f0f04f0f', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', '8')$$,
  'P0001', 'founder_test_reset_write_fenced', 'a sealed workspace records no derivation');

-- ---------------------------------------------------------------------------
-- Finalize: the founder workspace's rows gone; the bystander untouched
-- ---------------------------------------------------------------------------
select is(public.finalize_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', 'sha256:' || repeat('b', 64))->>'status',
  'db_finalized_pending_object_verify', 'finalize succeeds on a workspace with a certified candidate');
select is(pg_temp.ontology_count('pilot-f0f0f0f0f0f04f0f'), 0, 'no run, candidate or decision of the founder workspace remains');
select is(pg_temp.ontology_rows('pilot-e5e5e5e5e5e54e5e'), (select rows from bystander_before),
  'the bystander rows are byte-identical after finalize');
select is((select count(*)::integer from public.founder_test_reset_evidence_archive
  where reset_id = (select (r->>'resetId')::uuid from prepared)
    and source_table like 'ontology_%'), 0,
  'none of them is archived');
select is(pg_temp.ontology_count('pilot-e5e5e5e5e5e54e5e'), 2, 'the bystander keeps its run and candidate');

select * from finish();
rollback;
