-- Run only in a disposable Supabase test database after applying queue.sql as a draft migration.
begin;
select plan(26);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a1ac1000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'acl-refresh-queue@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.foundation_workspaces(workspace_key, display_name, created_by) values
  ('pilot-aclr', 'ACL refresh fixture', 'a1ac1000-0000-4000-8000-000000000001');
insert into public.foundation_workspace_members(workspace_key, user_id, role, state, accepted_at, authorization_revision) values
  ('pilot-aclr', 'a1ac1000-0000-4000-8000-000000000001', 'owner', 'active', now(), 1);

insert into public.foundation_oauth_connections (
  oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by
) values (
  'a1ac1000-0000-4000-8000-000000000010', 'pilot-aclr', 'google_drive', 'ACL refresh fixture', 'acct-aclr',
  array['drive.metadata.readonly'], 'vault://fixture/client', 'vault://fixture/refresh',
  'a1ac1000-0000-4000-8000-000000000001', 'a1ac1000-0000-4000-8000-000000000001'
);
insert into public.foundation_oauth_authorizations (
  authorization_id, workspace_key, provider, display_name, state_sha256, pkce_verifier_reference,
  redirect_uri, requested_scopes, created_by, authorization_revision, authorization_purpose, expires_at, consumed_at
) values (
  'a1ac1000-0000-4000-8000-000000000030', 'pilot-aclr', 'google_drive', 'ACL viewer fixture', repeat('c',64),
  'vault://fixture/pkce', 'https://tavonel.example/api/v1/oauth-connectors/callback/google_drive',
  array['https://www.googleapis.com/auth/drive.metadata.readonly'],
  'a1ac1000-0000-4000-8000-000000000001', 1, 'viewer_acl_link', now() + interval '5 minutes', now()
);
insert into public.foundation_provider_principal_links (
  workspace_key, foundation_user_id, provider, principal_kind, principal_id, authorization_id,
  authorization_revision, verified_at
) values (
  'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000001', 'google_drive', 'user', 'google-permission-1',
  'a1ac1000-0000-4000-8000-000000000030', 1, now()
);

insert into public.connector_document_bindings (
  source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type
) values
  ('sv-' || repeat('a',64), 'src-' || repeat('a',64), 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010',
   'google_drive', 'native-aclr-a', 'rev-a', 'a1ac1000-0000-4000-8000-000000000020', 'sha256:' || repeat('1',64), 10, 'text/plain'),
  ('sv-' || repeat('b',64), 'src-' || repeat('b',64), 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010',
   'google_drive', 'native-aclr-b', 'rev-b', 'a1ac1000-0000-4000-8000-000000000021', 'sha256:' || repeat('2',64), 10, 'text/plain');

select is(public.enqueue_stale_google_drive_acl_refreshes(300, 10), 2, 'missing snapshots enqueue unchanged current files');
select is(public.enqueue_stale_google_drive_acl_refreshes(300, 10), 0, 'repeat scan coalesces already queued work');
select is((select native_id from public.read_google_drive_acl_refresh_source(
  'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010', 'sv-' || repeat('a',64))),
  'native-aclr-a', 'eligibility discovery returns the exact active current binding');
select is((select count(*)::integer from public.claim_google_drive_acl_refresh_batch(1)), 1, 'claim is bounded to the requested one item');

create temporary table claimed_acl_refresh as
  select * from public.claim_google_drive_acl_refresh_batch(1);
select is((select count(*)::integer from claimed_acl_refresh), 1, 'second non-leased source remains independently claimable');
select ok(public.google_drive_acl_refresh_lease_owned(
  (select refresh_id from claimed_acl_refresh), (select lease_token from claimed_acl_refresh)), 'claimed lease token is valid');
select ok(not public.google_drive_acl_refresh_lease_owned(
  (select refresh_id from claimed_acl_refresh), 'a1ac1000-0000-4000-8000-000000000099'), 'wrong lease token cannot settle a job');
select ok(public.finish_google_drive_acl_refresh(
  (select refresh_id from claimed_acl_refresh), (select lease_token from claimed_acl_refresh), 'retry', 75, 'GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE'),
  'retry releases lease and persists bounded backoff');
select throws_ok($$select * from public.claim_google_drive_acl_refresh_batch(6)$$,
  'P0001', 'ACL_REFRESH_BATCH_LIMIT_INVALID', 'claim limit above five is rejected');
select throws_ok($$select public.finish_google_drive_acl_refresh(
  gen_random_uuid(), gen_random_uuid(), 'retry', 901, 'THROTTLED')$$,
  'P0001', 'ACL_REFRESH_FINISH_INPUT_INVALID', 'retry delay above 900 seconds is rejected');

select public.record_google_drive_source_acl_snapshot('pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010',
  'sv-' || repeat('a',64), '[{"kind":"user","principalId":"google-permission-1","permission":"read"}]'::jsonb,
  'sha256:' || repeat('d',64));
create temporary table pinned_acl_observation as
  select acl_snapshot_id, snapshot_sha256, captured_at from public.source_acl_snapshots
   where workspace_key = 'pilot-aclr' and source_version_id = 'sv-' || repeat('a',64)
     and snapshot_sha256 = 'sha256:' || repeat('d',64);
select public.record_google_drive_source_acl_snapshot('pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010',
  'sv-' || repeat('a',64), '[{"kind":"user","principalId":"google-permission-1","permission":"read"}]'::jsonb,
  'sha256:' || repeat('d',64));
select is((select count(*)::integer from public.source_acl_snapshots
  where workspace_key = 'pilot-aclr' and source_version_id = 'sv-' || repeat('a',64)
    and snapshot_sha256 = 'sha256:' || repeat('d',64)), 2, 'same ACL hash creates a new append-only verification observation');
select ok(exists (select 1 from public.source_acl_snapshots a join pinned_acl_observation p
  on p.acl_snapshot_id = a.acl_snapshot_id and p.snapshot_sha256 = a.snapshot_sha256 and p.captured_at = a.captured_at),
  'recapture leaves the historical pinned row and timestamp unchanged');

select lives_ok($$select public.record_google_drive_source_acl_capture_failure('pilot-aclr',
  'a1ac1000-0000-4000-8000-000000000010', 'sv-' || repeat('a',64), 'sha256:' || repeat('e',64))$$,
  'incomplete marker appends after removal of the snapshot uniqueness constraint');
select is(public.connector_documents_blocked_for_viewer('pilot-aclr',
  array['a1ac1000-0000-4000-8000-000000000020'], 'a1ac1000-0000-4000-8000-000000000001', 300), true,
  'a persisted incomplete marker denies viewer access');
select lives_ok($$select public.record_google_drive_source_acl_snapshot('pilot-aclr',
  'a1ac1000-0000-4000-8000-000000000010', 'sv-' || repeat('a',64),
  '[{"kind":"user","principalId":"google-permission-1","permission":"read"}]'::jsonb,
  'sha256:' || repeat('9',64))$$,
  'a later complete observation supersedes the older incomplete marker');
select is(public.connector_documents_blocked_for_viewer('pilot-aclr',
  array['a1ac1000-0000-4000-8000-000000000020'], 'a1ac1000-0000-4000-8000-000000000001', 300), false,
  'the newest complete observation restores viewer admission');
update public.foundation_google_drive_acl_refresh_queue
   set state = 'done', lease_token = null, lease_expires_at = null
 where workspace_key = 'pilot-aclr' and source_version_id = 'sv-' || repeat('a',64);
select is(public.enqueue_stale_google_drive_acl_refreshes(300, 10), 0,
  'an older incomplete marker does not keep a newer complete snapshot due');

insert into public.connector_document_bindings (
  source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type
) values (
  'sv-' || repeat('c',64), 'src-' || repeat('c',64), 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010',
  'google_drive', 'native-aclr-c', 'rev-c', 'a1ac1000-0000-4000-8000-000000000022',
  'sha256:' || repeat('3',64), 10, 'text/plain'
);
insert into public.source_acl_snapshots (
  source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at, capture_complete
) values
  ('sv-' || repeat('c',64), 'pilot-aclr', 'google_drive', '[]'::jsonb, 'sha256:' || repeat('1',64), statement_timestamp(), true),
  ('sv-' || repeat('c',64), 'pilot-aclr', 'google_drive', '[]'::jsonb, 'sha256:' || repeat('2',64), statement_timestamp(), false);
select is(public.enqueue_stale_google_drive_acl_refreshes(300, 10), 1,
  'tied newest complete and incomplete observations remain refresh eligible');
select is((select count(*)::integer from public.foundation_google_drive_acl_refresh_queue
  where workspace_key = 'pilot-aclr' and source_version_id = 'sv-' || repeat('c',64) and state = 'queued'), 1,
  'tied incomplete observation is not masked by hash ordering');

insert into public.foundation_oauth_connections (
  oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by
) values (
  'a1ac1000-0000-4000-8000-000000000013', 'pilot-aclr', 'google_drive', 'Second ACL refresh fixture', 'acct-aclr-2',
  array['drive.metadata.readonly'], 'vault://fixture/client-2', 'vault://fixture/refresh-2',
  'a1ac1000-0000-4000-8000-000000000001', 'a1ac1000-0000-4000-8000-000000000001'
);
insert into public.connector_document_bindings (
  source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type
) values (
  'sv-' || repeat('d',64), 'src-' || repeat('d',64), 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000013',
  'google_drive', 'native-aclr-d', 'rev-d', 'a1ac1000-0000-4000-8000-000000000023',
  'sha256:' || repeat('4',64), 10, 'text/plain'
);
select is(public.enqueue_stale_google_drive_acl_refreshes(300, 10), 1,
  'a different connection remains discoverable during a connection cooldown');
select is(public.cooldown_google_drive_acl_refresh_connection(
  'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010', 75), true,
  '429 cooldown is persisted against its OAuth connection');
create temporary table claimed_outside_cooldown as
  select * from public.claim_google_drive_acl_refresh_batch(1);
select is((select oauth_connection_id from claimed_outside_cooldown), 'a1ac1000-0000-4000-8000-000000000013'::uuid,
  'claim skips cooled connection while unrelated connection continues');

update public.foundation_google_drive_acl_refresh_queue
   set state = 'done', lease_token = null, lease_expires_at = null
 where workspace_key = 'pilot-aclr';
insert into public.connector_document_bindings (
  source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type
) values
  ('sv-' || repeat('e',64), 'src-' || repeat('e',64), 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010',
   'google_drive', 'native-aclr-e', 'rev-e', 'a1ac1000-0000-4000-8000-000000000024', 'sha256:' || repeat('5',64), 10, 'text/plain'),
  ('sv-' || repeat('f',64), 'src-' || repeat('f',64), 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010',
   'google_drive', 'native-aclr-f', 'rev-f', 'a1ac1000-0000-4000-8000-000000000025', 'sha256:' || repeat('6',64), 10, 'text/plain'),
  ('sv-' || repeat('8',64), 'src-' || repeat('8',64), 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010',
   'google_drive', 'native-aclr-g', 'rev-g', 'a1ac1000-0000-4000-8000-000000000026', 'sha256:' || repeat('7',64), 10, 'text/plain');
insert into public.source_acl_snapshots (
  source_version_id, workspace_key, provider_id, principals, snapshot_sha256, captured_at, capture_complete
) values
  ('sv-' || repeat('e',64), 'pilot-aclr', 'google_drive', '[]'::jsonb, 'sha256:' || repeat('5',64), statement_timestamp(), true),
  ('sv-' || repeat('f',64), 'pilot-aclr', 'google_drive', '[]'::jsonb, 'sha256:' || repeat('6',64), statement_timestamp(), true),
  ('sv-' || repeat('8',64), 'pilot-aclr', 'google_drive', '[]'::jsonb, 'sha256:' || repeat('7',64), statement_timestamp(), true);
insert into public.foundation_google_drive_acl_refresh_queue (
  refresh_id, workspace_key, oauth_connection_id, source_version_id, state
) values
  ('a1ac1000-0000-4000-8000-000000000001', 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010', 'sv-' || repeat('e',64), 'done'),
  ('a1ac1000-0000-4000-8000-000000000002', 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000099', 'sv-' || repeat('f',64), 'queued'),
  ('a1ac1000-0000-4000-8000-000000000003', 'pilot-aclr', 'a1ac1000-0000-4000-8000-000000000010', 'sv-' || repeat('8',64), 'queued');
update public.foundation_google_drive_acl_refresh_scan_cursor
   set last_cleanup_refresh_id = 'a1ac1000-0000-4000-8000-000000000003'
 where singleton;
select public.enqueue_stale_google_drive_acl_refreshes(300, 1);
select is((select state from public.foundation_google_drive_acl_refresh_queue
  where refresh_id = 'a1ac1000-0000-4000-8000-000000000002'), 'cancelled',
  'wraparound cleanup skips terminal low IDs and inspects the next active row');
select is((select state from public.foundation_google_drive_acl_refresh_queue
  where refresh_id = 'a1ac1000-0000-4000-8000-000000000001'), 'done',
  'wraparound cleanup leaves the terminal low-ID row unchanged');
select is((select state from public.foundation_google_drive_acl_refresh_queue
  where refresh_id = 'a1ac1000-0000-4000-8000-000000000003'), 'queued',
  'wraparound cursor does not skip the later active row');
select is((select last_cleanup_refresh_id from public.foundation_google_drive_acl_refresh_scan_cursor where singleton),
  'a1ac1000-0000-4000-8000-000000000002'::uuid,
  'cleanup cursor advances to the last active row actually scanned');

select * from finish();
rollback;
