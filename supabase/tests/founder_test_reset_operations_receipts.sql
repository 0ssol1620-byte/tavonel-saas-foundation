-- Founder test reset vs. W1-A3's foundation_operations_receipts (migration 20261105010000):
--   - the table is counted in the sealed manifest and fingerprinted (a receipt recorded after
--     prepare is drift), fenced while sealed, and deleted by finalize for the reset workspace only;
--   - after finalize the founder workspace has no receipt, so its next World is timed afresh;
--     the bystander's receipt is byte-identical;
--   - nothing of it is archived: it is internal telemetry about rows the reset deletes.
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

-- One first-answer timing receipt in each workspace, through the service-role writer.
select public.record_foundation_operations_receipt('e2e_timing', 'pilot-f0f0f0f0f0f04f0f',
  'collection-' || repeat('f', 32), '{"schema":"tavonel.e2e_timing.v1"}'::jsonb);
select public.record_foundation_operations_receipt('e2e_timing', 'pilot-e5e5e5e5e5e54e5e',
  'collection-' || repeat('e', 32), '{"schema":"tavonel.e2e_timing.v1"}'::jsonb);

create function pg_temp.receipt_rows(p_workspace text) returns text language sql as $f$
  select coalesce(string_agg(to_jsonb(r)::text, E'\n' order by r.target_id), '')
  from public.foundation_operations_receipts r where r.workspace_key = p_workspace
$f$;
create function pg_temp.receipt_count(p_workspace text) returns integer language sql as $f$
  select count(*)::integer from public.foundation_operations_receipts where workspace_key = p_workspace
$f$;

select is(pg_temp.receipt_count('pilot-f0f0f0f0f0f04f0f'), 1, 'fixture: the founder workspace has one receipt');
create temp table bystander_before as select pg_temp.receipt_rows('pilot-e5e5e5e5e5e54e5e') as rows;

-- ---------------------------------------------------------------------------
-- Prepare and seal
-- ---------------------------------------------------------------------------
create temp table prepared as select public.prepare_founder_test_reset('0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f') as r;
select is((select (r->'dbCounts'->>'foundation_operations_receipts')::integer from prepared), 1,
  'the sealed manifest counts the receipts');

select throws_ok($$do $d$ begin
  perform public.record_foundation_operations_receipt('e2e_timing', 'pilot-f0f0f0f0f0f04f0f',
    'collection-' || repeat('a', 32), '{}'::jsonb);
  perform public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
    'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
    'sha256:' || repeat('b', 64), '[]'::jsonb);
end $d$;$$, 'P0001', 'founder_test_reset_database_drift', 'a receipt recorded after prepare is database drift');

select is(public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
  'sha256:' || repeat('b', 64), '[]'::jsonb)->>'status', 'sealed', 'the reset seals with a receipt present');

select throws_ok($$select public.record_foundation_operations_receipt('e2e_timing', 'pilot-f0f0f0f0f0f04f0f',
    'collection-' || repeat('a', 32), '{}'::jsonb)$$,
  'P0001', 'founder_test_reset_write_fenced', 'a sealed workspace records no receipt');

-- ---------------------------------------------------------------------------
-- Finalize: the founder workspace's receipts gone; the bystander untouched
-- ---------------------------------------------------------------------------
select is(public.finalize_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', 'sha256:' || repeat('b', 64))->>'status',
  'db_finalized_pending_object_verify', 'finalize succeeds on a workspace with a receipt');
select is(pg_temp.receipt_count('pilot-f0f0f0f0f0f04f0f'), 0, 'no receipt of the founder workspace remains');
select is(pg_temp.receipt_rows('pilot-e5e5e5e5e5e54e5e'), (select rows from bystander_before),
  'the bystander receipt is byte-identical after finalize');
select is((select count(*)::integer from public.founder_test_reset_evidence_archive
  where reset_id = (select (r->>'resetId')::uuid from prepared)
    and source_table = 'foundation_operations_receipts'), 0,
  'receipts are not archived');

select * from finish();
rollback;
