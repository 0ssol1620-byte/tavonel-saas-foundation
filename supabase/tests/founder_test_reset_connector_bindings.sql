-- Founder test reset vs. the connector binding guard (migration 20261002140000):
--   - 20261001150000 replaced guard_connector_document_binding() and dropped the archived-row DELETE
--     allowance 20260920133000 had given it, so finalize failed with CONNECTOR_BINDING_IMMUTABLE on
--     any workspace with a binding -- after R2 had already been purged. With the allowance restored,
--     prepare/seal/finalize succeeds and the binding is archived, then gone;
--   - outside the sealed reset session a binding is still immutable (DELETE and UPDATE), a forged
--     reset session without an archived row still deletes nothing, and a direct service_role INSERT
--     is still refused by 20261001150000's write boundary while the guarded writer still records;
--   - another workspace's bindings are untouched by finalize, and not deletable from its session.
--
-- Everything runs inside this rolled-back transaction on the disposable rehearsal database. Each
-- auth.users insert bootstraps a legacy workspace and a foundation workspace (0001, 20260920121000):
--   pilot-f0f0f0f0f0f04f0f  the founder test identity (enterprise, grace 0, hold off) -- the subject
--   pilot-e5e5e5e5e5e54e5e  an unrelated self-service workspace -- must be left alone
begin;
select plan(13);

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

insert into public.foundation_oauth_connections (
  oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by
) values
  ('f0b00000-0000-4000-8000-0000000000c1', 'pilot-f0f0f0f0f0f04f0f', 'google_drive', 'Founder Drive', 'acct-founder',
   array['drive.readonly'], 'vault://fixture/client', 'vault://fixture/refresh',
   'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0'),
  ('e5b00000-0000-4000-8000-0000000000c1', 'pilot-e5e5e5e5e5e54e5e', 'google_drive', 'Bystander Drive', 'acct-bystander',
   array['drive.readonly'], 'vault://fixture/client', 'vault://fixture/refresh',
   'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5');

-- Owner-level SQL is outside the API-role write boundary, so the founder fixture row is a plain insert.
insert into public.connector_document_bindings (
  source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type
) values
  ('sv-' || repeat('f', 64), 'src-' || repeat('f', 64), 'pilot-f0f0f0f0f0f04f0f', 'f0b00000-0000-4000-8000-0000000000c1',
   'google_drive', 'native-founder', 'rev-1', '0db00000-0000-4000-8000-0000000000f1',
   'sha256:' || repeat('1', 64), 11, 'text/plain');

-- Every binding row of one workspace, for an exact before/after comparison.
create function pg_temp.binding_rows(p_workspace text) returns text language sql as $f$
  select coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.source_version_id), '')
    from public.connector_document_bindings b where b.workspace_key = p_workspace
$f$;
create function pg_temp.binding_count(p_workspace text) returns integer language sql as $f$
  select count(*)::integer from public.connector_document_bindings where workspace_key = p_workspace
$f$;

select is(pg_temp.binding_count('pilot-f0f0f0f0f0f04f0f'), 1, 'fixture: the founder workspace has one binding');

-- The bystander binding goes through the supported writer, with the identity its fields derive.
select is((select public.record_connector_document_binding_after(jsonb_build_object(
    'source_version_id', i.source_version_id, 'source_id', i.source_id, 'workspace_key', 'pilot-e5e5e5e5e5e54e5e',
    'oauth_connection_id', 'e5b00000-0000-4000-8000-0000000000c1', 'provider', 'google_drive',
    'native_id', 'native-bystander', 'provider_revision', 'rev-1', 'document_id', i.document_id,
    'content_sha256', 'sha256:' || repeat('2', 64), 'byte_length', 12, 'mime_type', 'text/plain'), '{}'::text[])
  from public.connector_binding_identity('pilot-e5e5e5e5e5e54e5e', 'e5b00000-0000-4000-8000-0000000000c1',
    'google_drive', 'native-bystander', 'rev-1') i),
  'recorded', 'the guarded writer still records a binding under the restored guard');
create temp table bystander_before as select pg_temp.binding_rows('pilot-e5e5e5e5e5e54e5e') as rows;

-- ---------------------------------------------------------------------------
-- No reset session: bindings stay immutable and the API-role write boundary holds
-- ---------------------------------------------------------------------------
select throws_ok($$delete from public.connector_document_bindings where workspace_key = 'pilot-f0f0f0f0f0f04f0f'$$,
  'P0001', 'CONNECTOR_BINDING_IMMUTABLE', 'a binding is not deleted outside a sealed reset session');
select throws_ok($$update public.connector_document_bindings set mime_type = 'text/html'
    where workspace_key = 'pilot-f0f0f0f0f0f04f0f'$$,
  'P0001', 'CONNECTOR_BINDING_IMMUTABLE', 'nor updated');
select throws_ok($$do $d$ begin
  set local role service_role;
  insert into public.connector_document_bindings (
    source_version_id, source_id, workspace_key, oauth_connection_id, provider,
    native_id, provider_revision, document_id, content_sha256, byte_length, mime_type
  ) values ('sv-' || repeat('e', 64), 'src-' || repeat('e', 64), 'pilot-f0f0f0f0f0f04f0f',
    'f0b00000-0000-4000-8000-0000000000c1', 'google_drive', 'native-direct', 'rev-1',
    '0db00000-0000-4000-8000-0000000000f2', 'sha256:' || repeat('3', 64), 13, 'text/plain');
end $d$;$$, 'P0001', 'CONNECTOR_BINDING_WRITE_PATH', 'a direct service_role insert is still refused by the write boundary');

-- ---------------------------------------------------------------------------
-- Prepare and seal with a binding present
-- ---------------------------------------------------------------------------
create temp table prepared as select public.prepare_founder_test_reset('0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f') as r;
select is((select (r->'dbCounts'->>'connector_document_bindings')::integer from prepared), 1,
  'the sealed manifest counts the founder binding');
select is(public.seal_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', (select r->>'dbManifestDigest' from prepared),
  'sha256:' || repeat('b', 64), '[]'::jsonb)->>'status', 'sealed', 'the reset seals with a binding present');

-- The allowance needs the archived row, not just the session setting: before finalize archives it,
-- naming the sealed reset deletes nothing.
select throws_ok($$do $d$ begin
  perform set_config('tavonel.founder_reset_id', (select r->>'resetId' from prepared), true);
  delete from public.connector_document_bindings where workspace_key = 'pilot-f0f0f0f0f0f04f0f';
end $d$;$$, 'P0001', 'CONNECTOR_BINDING_IMMUTABLE', 'a sealed reset session without the archived row deletes no binding');

-- ---------------------------------------------------------------------------
-- Finalize: the binding is archived, then deleted; the bystander is untouched
-- ---------------------------------------------------------------------------
select is(public.finalize_founder_test_reset((select (r->>'resetId')::uuid from prepared), '0ssol1620@gmail.com',
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'pilot-f0f0f0f0f0f04f0f', 'sha256:' || repeat('b', 64))->>'status',
  'db_finalized_pending_object_verify', 'finalize succeeds on a workspace with a connector binding');
select is(pg_temp.binding_count('pilot-f0f0f0f0f0f04f0f'), 0, 'no binding of the founder workspace remains');
select is((select count(*)::integer from public.founder_test_reset_evidence_archive
  where reset_id = (select (r->>'resetId')::uuid from prepared) and source_table = 'connector_document_bindings'
    and source_row_key = 'sv-' || repeat('f', 64) and payload->>'workspace_key' = 'pilot-f0f0f0f0f0f04f0f'), 1,
  'the deleted binding is in the evidence archive');
select is(pg_temp.binding_rows('pilot-e5e5e5e5e5e54e5e'), (select rows from bystander_before),
  'every bystander binding is byte-identical after finalize');
select throws_ok($$do $d$ begin
  perform set_config('tavonel.founder_reset_id', (select r->>'resetId' from prepared), true);
  delete from public.connector_document_bindings where workspace_key = 'pilot-e5e5e5e5e5e54e5e';
end $d$;$$, 'P0001', 'CONNECTOR_BINDING_IMMUTABLE', 'the reset session cannot delete another workspace''s binding');

select * from finish();
rollback;
