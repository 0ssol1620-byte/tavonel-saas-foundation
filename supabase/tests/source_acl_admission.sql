-- Per-source ACL admission (20260927101000). Measures the default-deny rule rather than restating it:
-- unbound, cross-workspace, cross-provider and future snapshots are refused at write; missing, stale,
-- superseded and other-version snapshots admit nobody; and the serving overlay denies every
-- connector-bound document because no viewer has a verified provider principal yet.
begin;
select plan(17);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'acacacac-acac-4cac-8cac-acacacacacac',
  'authenticated', 'authenticated', 'source-acl@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.foundation_oauth_connections (
  oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by
) values
  ('0c0ac100-0000-4000-8000-000000000001', 'pilot-acl1', 'google_drive', 'Drive ACL', 'acct-acl-1',
   array['drive.readonly'], 'vault://fixture/client', 'vault://fixture/refresh',
   'acacacac-acac-4cac-8cac-acacacacacac', 'acacacac-acac-4cac-8cac-acacacacacac');

insert into public.connector_document_bindings (
  source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type
) values
  ('sv-' || repeat('a', 64), 'src-' || repeat('a', 64), 'pilot-acl1', '0c0ac100-0000-4000-8000-000000000001',
   'google_drive', 'native-acl-a', 'rev-1', '0d0ac100-0000-4000-8000-000000000001',
   'sha256:' || repeat('1', 64), 11, 'text/plain'),
  ('sv-' || repeat('b', 64), 'src-' || repeat('b', 64), 'pilot-acl1', '0c0ac100-0000-4000-8000-000000000001',
   'google_drive', 'native-acl-b', 'rev-1', '0d0ac100-0000-4000-8000-000000000002',
   'sha256:' || repeat('2', 64), 11, 'text/plain');

-- Write-time binding.
select throws_ok($$insert into public.source_acl_snapshots (source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at)
  values ('sv-' || repeat('c', 64), 'pilot-acl1', 'google_drive', '[]', 'sha256:' || repeat('0', 64), now())$$,
  'P0001', 'SOURCE_ACL_SNAPSHOT_UNBOUND', 'snapshot for a version with no binding is refused');
select throws_ok($$insert into public.source_acl_snapshots (source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at)
  values ('sv-' || repeat('a', 64), 'pilot-acl2', 'google_drive', '[]', 'sha256:' || repeat('0', 64), now())$$,
  'P0001', 'SOURCE_ACL_SNAPSHOT_UNBOUND', 'snapshot claiming another workspace is refused');
select throws_ok($$insert into public.source_acl_snapshots (source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at)
  values ('sv-' || repeat('a', 64), 'pilot-acl1', 'dropbox', '[]', 'sha256:' || repeat('0', 64), now())$$,
  'P0001', 'SOURCE_ACL_SNAPSHOT_UNBOUND', 'snapshot claiming another provider is refused');
select throws_ok($$insert into public.source_acl_snapshots (source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at)
  values ('sv-' || repeat('a', 64), 'pilot-acl1', 'google_drive', '[]', 'sha256:' || repeat('0', 64), now() + interval '1 hour')$$,
  'P0001', 'SOURCE_ACL_SNAPSHOT_FUTURE', 'future-dated snapshot is refused');

-- Missing snapshot: nobody.
select is(public.source_version_acl_admits('pilot-acl1', 'sv-' || repeat('a', 64), 'google_drive',
  '[{"kind":"user","principalId":"alice@example.invalid"}]'), false, 'no snapshot admits nobody');

insert into public.source_acl_snapshots (source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at) values
  ('sv-' || repeat('a', 64), 'pilot-acl1', 'google_drive',
   '[{"kind":"user","principalId":"alice@example.invalid","permission":"read"}]', 'sha256:' || repeat('a', 64), now() - interval '1 hour'),
  ('sv-' || repeat('b', 64), 'pilot-acl1', 'google_drive',
   '[{"kind":"user","principalId":"alice@example.invalid","permission":"read"}]', 'sha256:' || repeat('b', 64), now() - interval '2 days');

select is(public.source_version_acl_admits('pilot-acl1', 'sv-' || repeat('a', 64), 'google_drive',
  '[{"kind":"user","principalId":"alice@example.invalid"}]'), true, 'fresh snapshot admits a listed principal');
select is(public.source_version_acl_admits('pilot-acl1', 'sv-' || repeat('a', 64), 'google_drive',
  '[{"kind":"user","principalId":"bob@example.invalid"}]'), false, 'unlisted principal is denied');
select is(public.source_version_acl_admits('pilot-acl1', 'sv-' || repeat('a', 64), 'google_drive', '[]'), false,
  'empty viewer principal set is denied');
select is(public.source_version_acl_admits('pilot-acl1', 'sv-' || repeat('a', 64), 'google_drive',
  '[{"kind":"group","principalId":"alice@example.invalid"}]'), false, 'same id under another kind is denied');
select is(public.source_version_acl_admits('pilot-acl2', 'sv-' || repeat('a', 64), 'google_drive',
  '[{"kind":"user","principalId":"alice@example.invalid"}]'), false, 'another workspace cannot use the snapshot');
select is(public.source_version_acl_admits('pilot-acl1', 'sv-' || repeat('a', 64), 'dropbox',
  '[{"kind":"user","principalId":"alice@example.invalid"}]'), false, 'another provider cannot use the snapshot');
select is(public.source_version_acl_admits('pilot-acl1', 'sv-' || repeat('b', 64), 'google_drive',
  '[{"kind":"user","principalId":"alice@example.invalid"}]'), false, 'stale snapshot admits nobody');

-- A newer capture that drops alice supersedes the older grant.
insert into public.source_acl_snapshots (source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at) values
  ('sv-' || repeat('a', 64), 'pilot-acl1', 'google_drive',
   '[{"kind":"user","principalId":"bob@example.invalid","permission":"read"}]', 'sha256:' || repeat('c', 64), now() - interval '1 minute');
select is(public.source_version_acl_admits('pilot-acl1', 'sv-' || repeat('a', 64), 'google_drive',
  '[{"kind":"user","principalId":"alice@example.invalid"}]'), false, 'revocation in the newest snapshot wins');

-- Serving overlay: every connector-bound document is denied, unbound ids are not this overlay's to decide.
select is(public.connector_documents_blocked('pilot-acl1', array['0d0ac100-0000-4000-8000-000000000001']), true,
  'connector-bound document is denied without a verified viewer principal');
select is(public.connector_documents_blocked('pilot-acl1', array['0d0ac100-0000-4000-8000-00000000ffff']), false,
  'document with no connector binding is unaffected');

select ok(not has_function_privilege('authenticated', 'public.source_version_acl_admits(text,text,text,jsonb)', 'EXECUTE'),
  'browser cannot probe ACL admission');
select ok(has_function_privilege('service_role', 'public.source_version_acl_admits(text,text,text,jsonb)', 'EXECUTE'),
  'serving overlay caller can evaluate ACL admission');

select * from finish();
rollback;
