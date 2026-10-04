-- Disposable pgTAP fixture for drafts/google-viewer-principal-boundary.sql.
begin;
select plan(16);

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','acacacac-acac-4cac-8cac-acacacacacac','authenticated','authenticated','viewer-a@example.invalid','$2a$10$fixture',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd','authenticated','authenticated','viewer-b@example.invalid','$2a$10$fixture',now(),'{}','{}',now(),now());
insert into public.foundation_workspaces(workspace_key,display_name,created_by) values
('pilot-acltest','ACL viewer test','acacacac-acac-4cac-8cac-acacacacacac');
insert into public.foundation_workspace_members(workspace_key,user_id,role,state,accepted_at,authorization_revision) values
('pilot-acltest','acacacac-acac-4cac-8cac-acacacacacac','owner','active',now(),7),
('pilot-acltest','bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd','member','active',now(),3);
insert into public.foundation_oauth_connections(oauth_connection_id,workspace_key,provider,display_name,provider_account_id,granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by) values
('0c0ac100-0000-4000-8000-000000000001','pilot-acltest','google_drive','Fixture','connector-account',array['drive.readonly'],'vault://fixture/client','vault://fixture/refresh','acacacac-acac-4cac-8cac-acacacacacac','acacacac-acac-4cac-8cac-acacacacacac');
insert into public.connector_document_bindings(source_version_id,source_id,workspace_key,oauth_connection_id,provider,native_id,provider_revision,document_id,content_sha256,byte_length,mime_type) values
('sv-'||repeat('a',64),'src-'||repeat('a',64),'pilot-acltest','0c0ac100-0000-4000-8000-000000000001','google_drive','native-a','rev-1','0d0ac100-0000-4000-8000-000000000001','sha256:'||repeat('1',64),11,'text/plain');

insert into public.foundation_oauth_authorizations(authorization_id,workspace_key,provider,display_name,state_sha256,pkce_verifier_reference,redirect_uri,requested_scopes,created_by,authorization_revision,authorization_purpose,expires_at,consumed_at) values
('0c0ac100-0000-4000-8000-000000000002','pilot-acltest','google_drive','Link Google Drive',repeat('b',64),'vault://fixture/pkce','https://tavonel.example/api/v1/oauth-connectors/callback/google_drive',array['https://www.googleapis.com/auth/drive.metadata.readonly'],'acacacac-acac-4cac-8cac-acacacacacac',7,'viewer_acl_link',now()+interval '5 minutes',now());
select lives_ok($$select public.record_google_drive_viewer_principal('0c0ac100-0000-4000-8000-000000000002','drive-permission-a')$$,
  'the consumed, narrow-scope Google link stores the server-resolved Drive permissionId');
select lives_ok($$select public.record_google_drive_source_acl_snapshot('pilot-acltest','0c0ac100-0000-4000-8000-000000000001','sv-'||repeat('a',64),'[{"kind":"user","principalId":"drive-permission-a","permission":"read"}]','sha256:'||repeat('a',64))$$,
  'complete capture stores Permission.id against exact workspace, connection and source version');
select is(public.connector_documents_blocked_for_viewer('pilot-acltest',array['0d0ac100-0000-4000-8000-000000000001'],'acacacac-acac-4cac-8cac-acacacacacac',300),false,
  'linked Google permission ID admits its exact user');
select throws_ok($$select public.connector_documents_blocked_for_viewer('pilot-acltest',array['0d0ac100-0000-4000-8000-000000000001'],'acacacac-acac-4cac-8cac-acacacacacac',3600)$$,
  'P0001','CONNECTOR_AUTH_SCOPE_INVALID','freshness must remain inside the configured 15-minute maximum');
select is(public.connector_documents_blocked_for_viewer('pilot-acltest',array['0d0ac100-0000-4000-8000-000000000001'],'bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd',300),true,
  'workspace membership or connection creation alone grants no access');
update public.source_acl_snapshots set captured_at=now()-interval '6 minutes' where workspace_key='pilot-acltest' and source_version_id='sv-'||repeat('a',64);
select is(public.connector_documents_blocked_for_viewer('pilot-acltest',array['0d0ac100-0000-4000-8000-000000000001'],'acacacac-acac-4cac-8cac-acacacacacac',300),true,
  'an ACL capture older than the explicit five-minute freshness bound is denied');
select lives_ok($$select public.record_google_drive_source_acl_snapshot('pilot-acltest','0c0ac100-0000-4000-8000-000000000001','sv-'||repeat('a',64),'[{"kind":"user","principalId":"drive-permission-a","permission":"read"}]','sha256:'||repeat('d',64))$$,
  'a later complete recapture restores only the current source-version evidence');
select lives_ok($$select public.record_google_drive_source_acl_capture_failure('pilot-acltest','0c0ac100-0000-4000-8000-000000000001','sv-'||repeat('a',64),'sha256:'||repeat('f',64))$$,
  'failed provider capture records an incomplete denial marker');
select is(public.connector_documents_blocked_for_viewer('pilot-acltest',array['0d0ac100-0000-4000-8000-000000000001'],'acacacac-acac-4cac-8cac-acacacacacac',300),true,
  'newer incomplete ACL capture denies despite an older complete snapshot');
select throws_ok($$select public.record_google_drive_source_acl_snapshot('pilot-acltest','0c0ac100-0000-4000-8000-000000000001','sv-'||repeat('a',64),'[{"kind":"group","principalId":"drive-permission-a","permission":"read"}]','sha256:'||repeat('c',64))$$,
  'P0001','source_acl_capture_principal_invalid','capture refuses group expansion');
update public.foundation_provider_principal_links set verified_at=now()-interval '25 hours' where principal_id='drive-permission-a';
select is(public.connector_documents_blocked_for_viewer('pilot-acltest',array['0d0ac100-0000-4000-8000-000000000001'],'acacacac-acac-4cac-8cac-acacacacacac',300),true,
  'stale viewer link is denied');
update public.foundation_provider_principal_links set verified_at=now()-interval '1 minute' where principal_id='drive-permission-a';
select is(public.revoke_google_drive_viewer_principals('pilot-acltest','acacacac-acac-4cac-8cac-acacacacacac',7),1,
  'self-unlink revokes the active provider identity');
select is(public.connector_documents_blocked_for_viewer('pilot-acltest',array['0d0ac100-0000-4000-8000-000000000001'],'acacacac-acac-4cac-8cac-acacacacacac',300),true,
  'revocation denies access immediately');
select ok(not has_function_privilege('authenticated','public.connector_documents_blocked_for_viewer(text,text[],uuid,integer)','EXECUTE'),
  'browser role cannot call viewer authorization RPC');
select ok(has_function_privilege('service_role','public.connector_documents_blocked_for_viewer(text,text[],uuid,integer)','EXECUTE'),
  'server service role can call viewer authorization RPC');
select ok(not has_table_privilege('authenticated','public.foundation_provider_principal_links','SELECT'),
  'browser role cannot read verified identity links');
select * from finish();
rollback;
