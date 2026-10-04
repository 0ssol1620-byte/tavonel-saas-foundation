-- Disposable pgTAP fixture. Run only after the base compile migrations plus both
-- drafts/google-viewer-principal-boundary.sql and drafts/compile-job-viewer-authority.sql.
begin;
select plan(35);

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','caacacac-0000-4000-8000-000000000001','authenticated','authenticated','compile-actor@example.invalid','$2a$10$fixture',now(),'{}','{}',now(),now());
insert into public.foundation_workspaces(workspace_key,display_name,created_by)
values ('pilot-cjobtest','Compile authority fixture','caacacac-0000-4000-8000-000000000001');
insert into public.foundation_workspace_members(workspace_key,user_id,role,state,accepted_at,authorization_revision)
values ('pilot-cjobtest','caacacac-0000-4000-8000-000000000001','owner','active',now(),11);

select lives_ok($$select * from public.enqueue_foundation_compile_job_with_authority(
  'cjob-00000000000000000000000000000011','pilot-cjobtest','caacacac-0000-4000-8000-000000000001',11,false,
  array['caacacac-0000-4000-8000-000000000011'],repeat('1',64),null,null,null,false)$$,
  'direct-upload intake job stores authenticated processing actor and authority revision');
select is((select authorization_revision from public.foundation_compile_jobs where job_id='cjob-00000000000000000000000000000011'),11::bigint,
  'the compile row durably retains the exact membership revision');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000011','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000011'],'before_source_read',false),true,
  'a same-epoch direct-upload processing actor is allowed while connector rollout remains off');
select throws_ok($$select * from public.enqueue_foundation_compile_job_with_authority(
  'cjob-00000000000000000000000000000012','pilot-cjobtest','caacacac-0000-4000-8000-000000000001',10,false,
  array['caacacac-0000-4000-8000-000000000012'],repeat('2',64),null,null,null,false)$$,
  'P0001','COMPILE_JOB_AUTHORITY_CHANGED','stale enqueue authority revision is rejected');

update public.foundation_workspace_members set authorization_revision=12
where workspace_key='pilot-cjobtest' and user_id='caacacac-0000-4000-8000-000000000001';
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000011','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000011'],'before_core',false),false,
  'membership revocation after enqueue denies a queued job');
select throws_ok($$select * from public.enqueue_foundation_compile_job_with_authority(
  'cjob-00000000000000000000000000000013','pilot-cjobtest','caacacac-0000-4000-8000-000000000001',11,false,
  array['caacacac-0000-4000-8000-000000000011'],repeat('1',64),null,null,null,false)$$,
  'P0001','COMPILE_JOB_AUTHORITY_CHANGED','an old idempotency replay cannot transfer or revive stale authority');
select ok(not has_function_privilege('authenticated',
  'public.authorize_foundation_compile_job(text,text,text[],text,boolean,integer)','EXECUTE'),
  'browser role cannot invoke the service-only job authorization RPC');

insert into public.foundation_oauth_connections(oauth_connection_id,workspace_key,provider,display_name,provider_account_id,granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by)
values ('caacacac-0000-4000-8000-000000000021','pilot-cjobtest','google_drive','Fixture','connector-account',
  array['https://www.googleapis.com/auth/drive.metadata.readonly'],'vault://fixture/client','vault://fixture/refresh',
  'caacacac-0000-4000-8000-000000000001','caacacac-0000-4000-8000-000000000001');
insert into public.connector_document_bindings(source_version_id,source_id,workspace_key,oauth_connection_id,provider,native_id,provider_revision,document_id,content_sha256,byte_length,mime_type)
values ('sv-'||repeat('c',64),'src-'||repeat('c',64),'pilot-cjobtest','caacacac-0000-4000-8000-000000000021','google_drive',
  'drive-file-c','rev-c','caacacac-0000-4000-8000-000000000022','sha256:'||repeat('c',64),23,'text/plain');
insert into public.foundation_oauth_authorizations(authorization_id,workspace_key,provider,display_name,state_sha256,pkce_verifier_reference,redirect_uri,requested_scopes,created_by,authorization_revision,authorization_purpose,expires_at,consumed_at)
values ('caacacac-0000-4000-8000-000000000023','pilot-cjobtest','google_drive','Link Google Drive',repeat('c',64),
  'vault://fixture/pkce','https://tavonel.example/api/v1/oauth-connectors/callback/google_drive',
  array['https://www.googleapis.com/auth/drive.metadata.readonly'],'caacacac-0000-4000-8000-000000000001',12,
  'viewer_acl_link',now()+interval '5 minutes',now());
select lives_ok($$select public.record_google_drive_viewer_principal('caacacac-0000-4000-8000-000000000023','drive-permission-c')$$,
  'verified provider consent creates the server-owned viewer principal link');
select lives_ok($$select public.record_google_drive_source_acl_snapshot('pilot-cjobtest','caacacac-0000-4000-8000-000000000021','sv-'||repeat('c',64),'[{"kind":"user","principalId":"drive-permission-c","permission":"read"}]','sha256:'||repeat('c',64))$$,
  'complete direct-user ACL capture is bound to the exact source version');
update public.source_acl_snapshots set captured_at=now()-interval '61 seconds'
where workspace_key='pilot-cjobtest' and source_version_id='sv-'||repeat('c',64);
select throws_ok($$select * from public.enqueue_foundation_compile_job_with_authority(
  'cjob-00000000000000000000000000000021','pilot-cjobtest','caacacac-0000-4000-8000-000000000001',12,true,
  array['caacacac-0000-4000-8000-000000000022'],repeat('3',64),null,null,null,false,p_max_age_seconds => null)$$,
  'P0001','COMPILE_JOB_ACL_FRESHNESS_INVALID','invalid server freshness configuration fails closed for connector enqueue');
select throws_ok($$select * from public.enqueue_foundation_compile_job_with_authority(
  'cjob-00000000000000000000000000000021','pilot-cjobtest','caacacac-0000-4000-8000-000000000001',12,true,
  array['caacacac-0000-4000-8000-000000000022'],repeat('3',64),null,null,null,false,p_max_age_seconds => 901)$$,
  'P0001','COMPILE_JOB_ACL_FRESHNESS_INVALID','SQL rejects a freshness bound above 900 seconds');
select throws_ok($$select * from public.enqueue_foundation_compile_job_with_authority(
  'cjob-00000000000000000000000000000021','pilot-cjobtest','caacacac-0000-4000-8000-000000000001',12,true,
  array['caacacac-0000-4000-8000-000000000022'],repeat('3',64),null,null,null,false,p_max_age_seconds => 60)$$,
  'P0001','COMPILE_JOB_CONNECTOR_AUTHORITY_DENIED','a 61-second-old capture fails the configured 60-second enqueue bound');
select lives_ok($$select * from public.enqueue_foundation_compile_job_with_authority(
  'cjob-00000000000000000000000000000021','pilot-cjobtest','caacacac-0000-4000-8000-000000000001',12,true,
  array['caacacac-0000-4000-8000-000000000022'],repeat('3',64),null,null,null,false)$$,
  'connector enqueue persists actor, connection, source version, consent link and ACL snapshot in one transaction');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_core',true,60),false,
  'a configured 60-second limit rejects that older ACL evidence at a worker checkpoint');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_core',true),true,
  'the durable same-revision actor is admitted against the captured permissionId');
select is((select count(*) from public.foundation_compile_job_source_authority
  where job_id='cjob-00000000000000000000000000000021' and oauth_connection_id='caacacac-0000-4000-8000-000000000021'
    and source_version_id='sv-'||repeat('c',64) and actor_user_id='caacacac-0000-4000-8000-000000000001'),1::bigint,
  'job authority row binds workspace actor, connection and immutable source version');
create temporary table compile_job_identity_before_acl_refresh as
select jsonb_build_object('job',to_jsonb(j),'source_authority',to_jsonb(a)) as evidence
from public.foundation_compile_jobs j
join public.foundation_compile_job_source_authority a on a.job_id=j.job_id
where j.job_id='cjob-00000000000000000000000000000021';
select lives_ok($$select public.record_google_drive_source_acl_snapshot('pilot-cjobtest','caacacac-0000-4000-8000-000000000021','sv-'||repeat('c',64),'[{"kind":"user","principalId":"drive-permission-c","permission":"read"}]','sha256:'||repeat('d',64))$$,
  'a newer complete recapture with the same viewer read grant is recorded');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_source_read',true),true,
  'equivalent ACL refresh keeps the queued job authorized');
select is((select jsonb_build_object('job',to_jsonb(j),'source_authority',to_jsonb(a))
  from public.foundation_compile_jobs j join public.foundation_compile_job_source_authority a on a.job_id=j.job_id
  where j.job_id='cjob-00000000000000000000000000000021'),
  (select evidence from compile_job_identity_before_acl_refresh),
  'ACL refresh does not mutate durable job identity or pinned enqueue evidence');
select lives_ok($$select public.record_google_drive_source_acl_snapshot('pilot-cjobtest','caacacac-0000-4000-8000-000000000021','sv-'||repeat('c',64),'[{"kind":"user","principalId":"drive-permission-c","permission":"read"}]','sha256:'||repeat('e',64))$$,
  'a future-dated complete capture is recorded for fail-closed coverage');
update public.source_acl_snapshots set captured_at=clock_timestamp()+interval '1 second'
where workspace_key='pilot-cjobtest' and snapshot_sha256='sha256:'||repeat('e',64);
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_core',true),false,
  'a future latest capture denies instead of falling back to the older fresh grant');
update public.source_acl_snapshots set captured_at=now()-interval '120 seconds'
where workspace_key='pilot-cjobtest' and snapshot_sha256='sha256:'||repeat('e',64);
update public.source_acl_snapshots set captured_at=now()-interval '100 seconds'
where workspace_key='pilot-cjobtest' and snapshot_sha256='sha256:'||repeat('d',64);
select lives_ok($$select public.record_google_drive_source_acl_snapshot('pilot-cjobtest','caacacac-0000-4000-8000-000000000021','sv-'||repeat('c',64),'[{"kind":"user","principalId":"drive-permission-c","permission":"read"}]','sha256:'||repeat('f',64))$$,
  'a stale complete capture is inserted after older evidence for freshness coverage');
update public.source_acl_snapshots set captured_at=now()-interval '60.5 seconds'
where workspace_key='pilot-cjobtest' and snapshot_sha256='sha256:'||repeat('f',64);
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_core',true,60),false,
  'a stale latest capture denies under the configured 60-second boundary');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_core',true),true,
  'the same latest capture remains within the default 300-second boundary');
select lives_ok($$select public.record_google_drive_source_acl_snapshot('pilot-cjobtest','caacacac-0000-4000-8000-000000000021','sv-'||repeat('c',64),'[]'::jsonb,'sha256:'||repeat('9',64))$$,
  'a newer complete ACL capture without the linked principal is recorded');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_core',true),false,
  'a newer capture that removes the linked principal denies the queued job');
select lives_ok($$select public.record_google_drive_source_acl_capture_failure('pilot-cjobtest','caacacac-0000-4000-8000-000000000021','sv-'||repeat('c',64),'sha256:'||repeat('8',64))$$,
  'an incomplete latest ACL capture is recorded');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_core',true),false,
  'an incomplete latest capture denies instead of falling back');
select lives_ok($$select public.record_google_drive_source_acl_snapshot('pilot-cjobtest','caacacac-0000-4000-8000-000000000021','sv-'||repeat('c',64),'[{"kind":"user","principalId":"drive-permission-c","permission":"read"}]','sha256:'||repeat('7',64))$$,
  'a fresh recapture restores the exact linked principal grant');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_core',true),true,
  'a fresh current grant is admitted before authority-change checks');
update public.foundation_workspace_members set authorization_revision=13
where workspace_key='pilot-cjobtest' and user_id='caacacac-0000-4000-8000-000000000001';
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'before_core',true),false,
  'a workspace authorization revision change denies the connector job');
update public.foundation_workspace_members set authorization_revision=12
where workspace_key='pilot-cjobtest' and user_id='caacacac-0000-4000-8000-000000000001';
select throws_ok($$update public.connector_document_bindings set source_version_id='sv-'||repeat('b',64)
  where source_version_id='sv-'||repeat('c',64)$$,
  'P0001','CONNECTOR_BINDING_IMMUTABLE','an enqueued source-version binding cannot be rewritten');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000099'],'before_core',true),false,
  'worker cannot substitute a different document/source scope for the pinned job version');
select lives_ok($$select public.revoke_google_drive_viewer_principals('pilot-cjobtest','caacacac-0000-4000-8000-000000000001',12)$$,
  'revoking the explicit provider link is recorded');
select is(public.authorize_foundation_compile_job('cjob-00000000000000000000000000000021','pilot-cjobtest',
  array['caacacac-0000-4000-8000-000000000022'],'after_core',true),false,
  'provider-link revocation blocks the queued job before persistence');
select * from finish();
rollback;
