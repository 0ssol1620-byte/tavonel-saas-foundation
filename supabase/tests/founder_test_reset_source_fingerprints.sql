-- Founder test reset vs. B1's source_fingerprints and document_relations (migration 20261104091000):
--   - both tables are counted in the sealed manifest and fingerprinted (a fingerprint recorded after
--     prepare is drift), fenced while sealed, and deleted by finalize for the reset workspace only;
--   - after finalize the founder workspace has neither, so the next upload of the same test file is
--     not "a duplicate" of a document the reset removed; the bystander's rows are byte-identical;
--   - nothing of them is archived: they are derived from rows the reset deletes.
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

-- Two copies of one file in each workspace: two fingerprints and a relation each way.
create function pg_temp.fp(p_document text, p_hex text) returns jsonb language sql as $f$
  select jsonb_build_object('documentId', p_document, 'sourceVersionId', repeat(p_hex, 64),
                            'sanitizedSha256', 'sha256:' || repeat(p_hex, 64));
$f$;
select public.record_source_fingerprints('pilot-f0f0f0f0f0f04f0f', jsonb_build_array(
  pg_temp.fp('0f100000-0000-4000-8000-0000000000f1', 'a'), pg_temp.fp('0f200000-0000-4000-8000-0000000000f2', 'a')));
select public.record_source_fingerprints('pilot-e5e5e5e5e5e54e5e', jsonb_build_array(
  pg_temp.fp('0e100000-0000-4000-8000-0000000000e1', 'a'), pg_temp.fp('0e200000-0000-4000-8000-0000000000e2', 'a')));

create function pg_temp.dedup_rows(p_workspace text) returns text language sql as $f$
  select coalesce(string_agg(r, E'\n' order by r), '') from (
    select 'f:' || to_jsonb(f)::text r from public.source_fingerprints f where f.workspace_key = p_workspace
    union all select 'r:' || to_jsonb(d)::text from public.document_relations d where d.workspace_key = p_workspace
  ) q
$f$;
create function pg_temp.dedup_counts(p_workspace text) returns jsonb language sql as $f$
  select jsonb_build_object(
    'fingerprints', (select count(*) from public.source_fingerprints where workspace_key = p_workspace),
    'relations', (select count(*) from public.document_relations where workspace_key = p_workspace))
$f$;

select is(pg_temp.dedup_counts('pilot-f0f0f0f0f0f04f0f'), '{"fingerprints":2,"relations":2}'::jsonb,
  'fixture: the founder workspace has two fingerprints and a relation each way');
create temp table bystander_before as select pg_temp.dedup_rows('pilot-e5e5e5e5e5e54e5e') as rows;

-- ---------------------------------------------------------------------------
-- Prepare and seal
-- ---------------------------------------------------------------------------
create temp table prepared as select public.prepare_founder_test_reset('0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f') as r;
select is((select jsonb_build_object('fingerprints', r->'dbCounts'->'source_fingerprints',
    'relations', r->'dbCounts'->'document_relations') from prepared),
  '{"fingerprints":2,"relations":2}'::jsonb, 'the sealed manifest counts both tables');

select throws_ok($$do $d$ begin
  perform public.record_source_fingerprints('pilot-f0f0f0f0f0f04f0f',
    jsonb_build_array(pg_temp.fp('0f300000-0000-4000-8000-0000000000f3', 'b')));
  perform public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
    'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
    'sha256:' || repeat('b', 64), '[]'::jsonb);
end $d$;$$, 'P0001', 'founder_test_reset_database_drift', 'a fingerprint recorded after prepare is database drift');

select is(public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
  'sha256:' || repeat('b', 64), '[]'::jsonb)->>'status', 'sealed', 'the reset seals with fingerprints present');

select throws_ok($$select public.record_source_fingerprints('pilot-f0f0f0f0f0f04f0f',
    jsonb_build_array(pg_temp.fp('0f300000-0000-4000-8000-0000000000f3', 'b')))$$,
  'P0001', 'founder_test_reset_write_fenced', 'a sealed workspace records no fingerprint');

-- ---------------------------------------------------------------------------
-- Finalize: both tables emptied for the founder workspace; the bystander untouched
-- ---------------------------------------------------------------------------
select is(public.finalize_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', 'sha256:' || repeat('b', 64))->>'status',
  'db_finalized_pending_object_verify', 'finalize succeeds on a workspace with fingerprints');
select is(pg_temp.dedup_counts('pilot-f0f0f0f0f0f04f0f'), '{"fingerprints":0,"relations":0}'::jsonb,
  'no fingerprint or relation of the founder workspace remains');
select is(pg_temp.dedup_rows('pilot-e5e5e5e5e5e54e5e'), (select rows from bystander_before),
  'every bystander fingerprint and relation is byte-identical after finalize');
select is((select count(*)::integer from public.founder_test_reset_evidence_archive
  where reset_id = (select (r->>'resetId')::uuid from prepared)
    and source_table in ('source_fingerprints', 'document_relations')), 0,
  'derived rows are not archived');

select * from finish();
rollback;
