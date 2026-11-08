-- W2-C1 schema derivation and certification (migration 20261107110000).
--
-- What it proves:
--   * no client role reaches the three tables, and service_role reaches them only through the RPCs;
--   * a candidate is always written `proposed`, whatever the caller says -- nothing is certified by
--     derivation -- and a candidate with no evidence, or evidence naming a document outside its run,
--     is refused; a model run without a pinned prompt is refused;
--   * a redelivered derivation writes nothing twice;
--   * workspace B cannot list or decide workspace A's candidates (not found, not forbidden);
--   * a verdict without a reason is refused; certify/reject are final; edit keeps the candidate
--     proposed and records before/after; decisions are append-only;
--   * a document whose deletion was requested closes its runs, and the derived closure erases the
--     runs, candidates and decisions naming it while the other workspace's run is untouched.
--
-- Two self-service workspaces are bootstrapped by the auth.users insert (20260920121000):
-- pilot-c1c1c1c1c1c14c1c (owner c1c1...) and pilot-d2d2d2d2d2d24d2d (owner d2d2...).
begin;
select plan(43);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'authenticated', 'authenticated',
   'ontology-c1@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 'authenticated', 'authenticated',
   'ontology-d2@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- A, B in workspace c1; C in workspace d2.
insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at, source_sha256
)
select w, d::uuid, u::uuid, 'quarantine/' || w || '/' || d || '/source', 10, 'application/pdf',
       now(), now(), now() + interval '10 minutes', now(), 'sha256:' || repeat('5', 64)
  from (values
    ('pilot-c1c1c1c1c1c14c1c', '0a000000-0000-4000-8000-0000000000a1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'),
    ('pilot-c1c1c1c1c1c14c1c', '0b000000-0000-4000-8000-0000000000b1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'),
    ('pilot-d2d2d2d2d2d24d2d', '0c000000-0000-4000-8000-0000000000c1', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2')
  ) as f(w, d, u);

create function public.c1_test_run(p_documents text[], p_deriver text default 'baseline', p_prompt text default null)
returns jsonb language sql as $$
  select jsonb_build_object('collectionId', 'collection-' || repeat('c', 32), 'manifestDigest', 'sha256:' || repeat('d', 64),
    'deriver', p_deriver, 'deriverVersion', 'baseline-frequency:1', 'documentIds', to_jsonb(p_documents),
    'inputsSha256', 'sha256:' || repeat('1', 64), 'schemaSha256', 'sha256:' || repeat('2', 64),
    'modelId', 'tavonel:ontology-baseline-frequency', 'modelRevision', '1', 'promptSha256', p_prompt,
    'priceSnapshot', jsonb_build_object('usd', 0), 'receipt', jsonb_build_object('schema', 'tavonel.ontology_derivation_receipt.v1'),
    'receiptSha256', 'sha256:' || repeat('3', 64), 'createdBy', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1');
$$;
create function public.c1_test_candidate(p_key text, p_document text, p_kind text default 'class', p_state text default null)
returns jsonb language sql as $$
  select jsonb_build_object('kind', p_kind, 'key', p_key, 'label', initcap(p_key), 'description', 'Proposed from mentions.',
    'domainKey', case when p_kind = 'property' then 'organization' end, 'rangeKey', case when p_kind = 'property' then 'market' end,
    'support', 4, 'state', p_state,
    'evidence', jsonb_build_array(jsonb_build_object('evidenceId', 'ev-' || p_key, 'documentId', p_document, 'page', 2,
      'bbox', jsonb_build_array(10, 20, 900, 80), 'quote', 'The Nasdaq Stock Market LLC')));
$$;
grant execute on function public.c1_test_run(text[], text, text), public.c1_test_candidate(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 1. Nobody but the RPCs reaches the rows.
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.ontology_derivation_runs'::regclass), 'runs have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ontology_schema_candidates'::regclass), 'candidates have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ontology_certification_decisions'::regclass), 'decisions have RLS');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE'
  and policyname in ('ontology_derivation_runs_no_client_access', 'ontology_schema_candidates_no_client_access',
                     'ontology_certification_decisions_no_client_access')), 3, 'each table carries a deny-all client policy');
select ok(has_function_privilege('service_role', 'public.record_ontology_derivation_run(text, jsonb, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.list_ontology_schema_candidates(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.decide_ontology_schema_candidate(text, uuid, text, uuid, text, jsonb)', 'execute'),
  'the server may record, list and decide');
select ok(not has_function_privilege('authenticated', 'public.decide_ontology_schema_candidate(text, uuid, text, uuid, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.list_ontology_schema_candidates(text, text)', 'execute'),
  'a browser may not decide or list');
select ok(not has_function_privilege('anon', 'public.record_ontology_derivation_run(text, jsonb, jsonb)', 'execute'), 'anon may not record');
select ok(not has_function_privilege('service_role', 'public.erase_ontology_runs_on_derived_purge()', 'execute'),
  'the erase trigger is internal');

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1"}', true);
select throws_ok($$select 1 from public.ontology_derivation_runs$$, '42501', null, 'a workspace owner cannot read runs');
select throws_ok($$select 1 from public.ontology_schema_candidates$$, '42501', null, 'nor candidates');
select throws_ok($$select 1 from public.ontology_certification_decisions$$, '42501', null, 'nor decisions');
reset role;
set local role anon;
select throws_ok($$select 1 from public.ontology_schema_candidates$$, '42501', null, 'anon cannot read candidates');
reset role;
set local role service_role;
select throws_ok($$select 1 from public.ontology_schema_candidates$$, '42501', null, 'the server reads candidates only through the RPC');
select throws_ok($$update public.ontology_schema_candidates set state = 'certified'$$, '42501', null,
  'and cannot certify by writing the table');

-- ---------------------------------------------------------------------------
-- 2. Recording: always proposed, evidence required, idempotent.
-- ---------------------------------------------------------------------------
create temp table run1 as select public.record_ontology_derivation_run('pilot-c1c1c1c1c1c14c1c',
  public.c1_test_run(array['0a000000-0000-4000-8000-0000000000a1', '0b000000-0000-4000-8000-0000000000b1']),
  jsonb_build_array(
    public.c1_test_candidate('organization', '0a000000-0000-4000-8000-0000000000a1', 'class', 'certified'),
    public.c1_test_candidate('market', '0b000000-0000-4000-8000-0000000000b1'),
    public.c1_test_candidate('listed_on', '0a000000-0000-4000-8000-0000000000a1', 'property'))) as r;
select is((select (r->>'created')::boolean from run1), true, 'a new derivation is recorded');
select is((select (r->>'candidates')::integer from run1), 3, 'with its three candidates');
select is((select jsonb_agg(distinct c->>'state') from (select jsonb_array_elements(public.list_ontology_schema_candidates(
  'pilot-c1c1c1c1c1c14c1c', 'collection-' || repeat('c', 32))->'candidates') c) q), '["proposed"]'::jsonb,
  'every candidate is proposed, including the one whose payload said certified');
select is((select r->'runId' from (select public.record_ontology_derivation_run('pilot-c1c1c1c1c1c14c1c',
  public.c1_test_run(array['0a000000-0000-4000-8000-0000000000a1', '0b000000-0000-4000-8000-0000000000b1']),
  jsonb_build_array(public.c1_test_candidate('organization', '0a000000-0000-4000-8000-0000000000a1'))) as r) q),
  (select r->'runId' from run1), 'a redelivered derivation returns the stored run');

select throws_ok($$select public.record_ontology_derivation_run('pilot-c1c1c1c1c1c14c1c',
  public.c1_test_run(array['0a000000-0000-4000-8000-0000000000a1']) || '{"inputsSha256":"sha256:4444444444444444444444444444444444444444444444444444444444444444"}',
  jsonb_build_array(public.c1_test_candidate('organization', '0a000000-0000-4000-8000-0000000000a1') - 'evidence'))$$,
  'P0001', 'ontology_candidate_evidence_required', 'a candidate without evidence is refused');
select throws_ok($$select public.record_ontology_derivation_run('pilot-c1c1c1c1c1c14c1c',
  public.c1_test_run(array['0a000000-0000-4000-8000-0000000000a1']) || '{"inputsSha256":"sha256:4444444444444444444444444444444444444444444444444444444444444444"}',
  jsonb_build_array(public.c1_test_candidate('organization', '0a000000-0000-4000-8000-0000000000a1')
    || '{"evidence":[]}'))$$,
  'P0001', 'ontology_candidate_evidence_required', 'an empty evidence list is refused');
select throws_ok($$select public.record_ontology_derivation_run('pilot-c1c1c1c1c1c14c1c',
  public.c1_test_run(array['0a000000-0000-4000-8000-0000000000a1']) || '{"inputsSha256":"sha256:4444444444444444444444444444444444444444444444444444444444444444"}',
  jsonb_build_array(public.c1_test_candidate('organization', '0c000000-0000-4000-8000-0000000000c1')))$$,
  'P0001', 'ontology_candidate_evidence_invalid', 'evidence naming a document outside the run is refused');
select throws_ok($$select public.record_ontology_derivation_run('pilot-c1c1c1c1c1c14c1c',
  public.c1_test_run(array['0a000000-0000-4000-8000-0000000000a1'], 'model', null),
  jsonb_build_array(public.c1_test_candidate('organization', '0a000000-0000-4000-8000-0000000000a1')))$$,
  '23514', null, 'a model run without a pinned prompt is refused');
select throws_ok($$select public.record_ontology_derivation_run('tenant-c1',
  public.c1_test_run(array['0a000000-0000-4000-8000-0000000000a1']), '[]'::jsonb)$$,
  'P0001', 'ontology_run_invalid', 'a workspace key outside the pilot namespace is refused');

-- Workspace d2 derives its own World under the same collection id.
select is((select (r->>'created')::boolean from (select public.record_ontology_derivation_run('pilot-d2d2d2d2d2d24d2d',
  public.c1_test_run(array['0c000000-0000-4000-8000-0000000000c1']) || '{"createdBy":"d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2"}',
  jsonb_build_array(public.c1_test_candidate('issuer', '0c000000-0000-4000-8000-0000000000c1'))) as r) q), true,
  'the other workspace records its own run');

-- ---------------------------------------------------------------------------
-- 3. Tenant boundary: listing and deciding are per workspace.
-- ---------------------------------------------------------------------------
select is((select jsonb_agg(c->>'key' order by c->>'key') from (select jsonb_array_elements(public.list_ontology_schema_candidates(
  'pilot-d2d2d2d2d2d24d2d', 'collection-' || repeat('c', 32))->'candidates') c) q), '["issuer"]'::jsonb,
  'workspace d2 lists only its own candidate under the same collection id');
create temp table cand as select (c->>'candidateId')::uuid id, c->>'key' k from (select jsonb_array_elements(
  public.list_ontology_schema_candidates('pilot-c1c1c1c1c1c14c1c', 'collection-' || repeat('c', 32))->'candidates') c) q;
select throws_ok($$select public.decide_ontology_schema_candidate('pilot-d2d2d2d2d2d24d2d', (select id from cand where k = 'organization'),
  'certify', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 'Looks right to me.', null)$$,
  'P0001', 'ontology_candidate_not_found', 'workspace d2 cannot certify a candidate of workspace c1');
select throws_ok($$select public.decide_ontology_schema_candidate('pilot-d2d2d2d2d2d24d2d', (select id from cand where k = 'market'),
  'reject', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 'Not a type we use.', null)$$,
  'P0001', 'ontology_candidate_not_found', 'nor reject one');

-- ---------------------------------------------------------------------------
-- 4. Decisions.
-- ---------------------------------------------------------------------------
select throws_ok($$select public.decide_ontology_schema_candidate('pilot-c1c1c1c1c1c14c1c', (select id from cand where k = 'market'),
  'reject', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', '   ', null)$$,
  'P0001', 'ontology_decision_reason_required', 'a reject without a reason is refused');
select throws_ok($$select public.decide_ontology_schema_candidate('pilot-c1c1c1c1c1c14c1c', (select id from cand where k = 'market'),
  'certify', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', null, null)$$,
  'P0001', 'ontology_decision_reason_required', 'a certify without a reason is refused');
select is(public.decide_ontology_schema_candidate('pilot-c1c1c1c1c1c14c1c', (select id from cand where k = 'organization'),
  'edit', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Registrant is the filing term.',
  '{"label":"Registrant","description":"The company that files the report."}')->>'state', 'proposed',
  'an edit keeps the candidate proposed');
select is(public.decide_ontology_schema_candidate('pilot-c1c1c1c1c1c14c1c', (select id from cand where k = 'organization'),
  'certify', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Matches the cover page.', null)->>'state', 'certified',
  'a person certifies it');
select throws_ok($$select public.decide_ontology_schema_candidate('pilot-c1c1c1c1c1c14c1c', (select id from cand where k = 'organization'),
  'reject', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Changed my mind later.', null)$$,
  'P0001', 'ontology_candidate_already_decided', 'a certified candidate is not decided again');
select is(public.decide_ontology_schema_candidate('pilot-c1c1c1c1c1c14c1c', (select id from cand where k = 'market'),
  'reject', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Too generic to be a type.', null)->>'state', 'rejected',
  'a person rejects another');
select is((select c->'decisions' -> 0 ->> 'verdict' from (select jsonb_array_elements(public.list_ontology_schema_candidates(
  'pilot-c1c1c1c1c1c14c1c', 'collection-' || repeat('c', 32))->'candidates') c) q where c->>'key' = 'organization'), 'edit',
  'the listing carries the decision history, oldest first');
select is((select c->>'editedLabel' from (select jsonb_array_elements(public.list_ontology_schema_candidates(
  'pilot-c1c1c1c1c1c14c1c', 'collection-' || repeat('c', 32))->'candidates') c) q where c->>'key' = 'organization'), 'Registrant',
  'and the edited label');
reset role;
select is((select jsonb_build_object('before', before->>'label', 'after', after->>'label', 'by', decided_by)
  from public.ontology_certification_decisions where verdict = 'edit'),
  '{"before":"Organization","after":"Registrant","by":"c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1"}'::jsonb,
  'an edit records who changed what from what');
select throws_ok($$update public.ontology_certification_decisions set reason = 'rewritten afterwards'$$,
  'P0001', 'ontology_decision_append_only', 'decisions are append-only, even for the table owner');

-- ---------------------------------------------------------------------------
-- 5. Deletion: A's deletion closes the run, and the derived closure erases it.
-- ---------------------------------------------------------------------------
create temp table request as select public.request_customer_source_deletion('pilot-c1c1c1c1c1c14c1c',
  '0a000000-0000-4000-8000-0000000000a1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'sha256:' || repeat('a', 64)) as r;
set local role service_role;
select is(public.list_ontology_schema_candidates('pilot-c1c1c1c1c1c14c1c', 'collection-' || repeat('c', 32))->'run', 'null'::jsonb,
  'a run naming a document whose deletion was requested is not listed');
select throws_ok($$select public.decide_ontology_schema_candidate('pilot-c1c1c1c1c1c14c1c', (select id from cand where k = 'listed_on'),
  'certify', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Still looks right.', null)$$,
  'P0001', 'ontology_source_deleted', 'nor decided');
reset role;

alter table public.source_deletion_tombstones disable trigger source_deletion_tombstones_append_only;
update public.source_deletion_tombstones set eligible_at = now() - interval '1 minute'
 where document_id = '0a000000-0000-4000-8000-0000000000a1';
alter table public.source_deletion_tombstones enable trigger source_deletion_tombstones_append_only;
select public.attest_source_deletion_inventory((select r->>'deletionId' from request),
  jsonb_build_array(jsonb_build_object('key', 'quarantine/pilot-c1c1c1c1c1c14c1c/0a000000-0000-4000-8000-0000000000a1/source',
    'sha256', 'sha256:' || repeat('1', 64), 'sizeBytes', 10)));
select is(public.close_source_deletion_derived()->>'status', 'recorded', 'the derived closure records');

select is((select count(*)::integer from public.ontology_derivation_runs where workspace_key = 'pilot-c1c1c1c1c1c14c1c'), 0,
  'the run naming the deleted document is erased');
select is((select count(*)::integer from public.ontology_schema_candidates where workspace_key = 'pilot-c1c1c1c1c1c14c1c')
  + (select count(*)::integer from public.ontology_certification_decisions where workspace_key = 'pilot-c1c1c1c1c1c14c1c'), 0,
  'with its candidates, their evidence quotes and their decisions');
select is((select count(*)::integer from public.ontology_schema_candidates where workspace_key = 'pilot-d2d2d2d2d2d24d2d'), 1,
  'the other workspace keeps its run and candidate');

select * from finish();
rollback;
