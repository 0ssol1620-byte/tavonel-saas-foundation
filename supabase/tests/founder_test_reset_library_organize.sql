-- Founder test reset vs. W2-B2's document_labels (migration 20261107100100):
--   - the table is counted in the sealed manifest and fingerprinted (a label recorded after prepare
--     is drift), fenced while sealed, and deleted by finalize for the reset workspace only, ahead of
--     the fingerprints it references (otherwise the fingerprint delete fails on the foreign key);
--   - the bystander's labels are byte-identical after finalize;
--   - nothing of it is archived: it is derived proposals about rows the reset deletes.
--
-- Everything runs inside this rolled-back transaction on the disposable rehearsal database. Each
-- auth.users insert bootstraps a legacy workspace and a foundation workspace (0001, 20260920121000):
--   pilot-f0f0f0f0f0f04f0f  the founder test identity (enterprise, grace 0, hold off) -- the subject
--   pilot-e5e5e5e5e5e54e5e  an unrelated self-service workspace -- must be left alone
begin;
select plan(9);

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

-- One document-type proposal in each workspace, through the service-role recorder.
create function pg_temp.organize_item(p_document text, p_hex text, p_method_version text) returns jsonb language sql as $f$
  select jsonb_build_object('documentId', p_document, 'sourceVersionId', repeat(p_hex, 64),
    'sanitizedSha256', 'sha256:' || repeat(p_hex, 64), 'textFingerprint', null,
    'labels', jsonb_build_array(jsonb_build_object('labelKind', 'doc_type', 'labelKey', 'report',
      'labelSetVersion', 'doc-type:v0', 'method', 'rules', 'methodVersion', p_method_version,
      'inputsSha256', 'sha256:' || repeat('1', 64), 'disposition', 'proposed', 'abstainReason', null,
      'internalScore', 0.75, 'evidenceIds', '[]'::jsonb)))
$f$;
select public.record_library_organize('pilot-f0f0f0f0f0f04f0f',
  jsonb_build_array(pg_temp.organize_item('0f000000-0000-4000-8000-00000000000f', 'f', 'doc-type-rules:v1')));
select public.record_library_organize('pilot-e5e5e5e5e5e54e5e',
  jsonb_build_array(pg_temp.organize_item('0e000000-0000-4000-8000-00000000000e', 'e', 'doc-type-rules:v1')));

create function pg_temp.label_rows(p_workspace text) returns text language sql as $f$
  select coalesce(string_agg(to_jsonb(l)::text, E'\n' order by l.document_id), '')
  from public.document_labels l where l.workspace_key = p_workspace
$f$;
create function pg_temp.label_count(p_workspace text) returns integer language sql as $f$
  select count(*)::integer from public.document_labels where workspace_key = p_workspace
$f$;

select is(pg_temp.label_count('pilot-f0f0f0f0f0f04f0f'), 1, 'fixture: the founder workspace has one label');
create temp table bystander_before as select pg_temp.label_rows('pilot-e5e5e5e5e5e54e5e') as rows;

-- ---------------------------------------------------------------------------
-- Prepare and seal
-- ---------------------------------------------------------------------------
create temp table prepared as select public.prepare_founder_test_reset('0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f') as r;
select is((select (r->'dbCounts'->>'document_labels')::integer from prepared), 1,
  'the sealed manifest counts the labels');

select throws_ok($$do $d$ begin
  -- The fingerprint already exists, so the only row this adds is a second label (another method version).
  perform public.record_library_organize('pilot-f0f0f0f0f0f04f0f',
    jsonb_build_array(pg_temp.organize_item('0f000000-0000-4000-8000-00000000000f', 'f', 'doc-type-rules:v2')));
  perform public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
    'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
    'sha256:' || repeat('b', 64), '[]'::jsonb);
end $d$;$$, 'P0001', 'founder_test_reset_database_drift', 'a label recorded after prepare is database drift');

select is(public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
  'sha256:' || repeat('b', 64), '[]'::jsonb)->>'status', 'sealed', 'the reset seals with a label present');

-- A direct insert, so the fence that answers is document_labels' own and not source_fingerprints'.
select throws_ok($$insert into public.document_labels (workspace_key, document_id, source_version_id, label_kind,
    label_key, label_set_version, method, method_version, inputs_sha256)
  values ('pilot-f0f0f0f0f0f04f0f', '0f000000-0000-4000-8000-00000000000f', repeat('f', 64), 'doc_type', 'report',
    'doc-type:v0', 'rules', 'doc-type-rules:v3', 'sha256:' || repeat('1', 64))$$,
  'P0001', 'founder_test_reset_write_fenced', 'a sealed workspace records no label');

-- ---------------------------------------------------------------------------
-- Finalize: the founder workspace's labels gone; the bystander untouched
-- ---------------------------------------------------------------------------
select is(public.finalize_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', 'sha256:' || repeat('b', 64))->>'status',
  'db_finalized_pending_object_verify', 'finalize succeeds on a workspace with a label and its fingerprint');
select is(pg_temp.label_count('pilot-f0f0f0f0f0f04f0f'), 0, 'no label of the founder workspace remains');
select is(pg_temp.label_rows('pilot-e5e5e5e5e5e54e5e'), (select rows from bystander_before),
  'the bystander labels are byte-identical after finalize');
select is((select count(*)::integer from public.founder_test_reset_evidence_archive
  where reset_id = (select (r->>'resetId')::uuid from prepared)
    and source_table = 'document_labels'), 0,
  'labels are not archived');

select * from finish();
rollback;
