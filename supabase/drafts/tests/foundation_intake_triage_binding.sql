-- Focused regression tests for the unregistered triage/approval schema draft.
-- Apply only in a disposable DB after the draft has been reviewed and registered.
begin;
set local role postgres;
select plan(24);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '88880011-8888-4888-8888-888888888811',
   'authenticated', 'authenticated', 'triage-owner@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '88880012-8888-4888-8888-888888888812',
   'authenticated', 'authenticated', 'triage-other@example.invalid', '$2a$10$fixture', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_billing_accounts (workspace_key,user_id,access_plan,subscription_status)
values ('pilot-triage01','88880011-8888-4888-8888-888888888811','studio_access','inactive');
insert into public.foundation_account_access_grants (
  user_id,grant_kind,access_plan,billing_exempt,trial_exempt,active
) values ('88880011-8888-4888-8888-888888888811','owner','studio_access',true,true,true);

create temporary table legacy_hold_fixture as
select public.reserve_foundation_compute_v3(
  'pilot-triage01','88880032-8888-4888-8888-888888888832',
  '88880011-8888-4888-8888-888888888811',1,1) as result;
insert into public.foundation_intake_approvals (
  approval_id,workspace_key,user_id,attempt_key,client_manifest_digest,scope_digest,
  pricing_fingerprint,file_count,aggregate_maximum_pages,aggregate_reserved_credits,
  aggregate_maximum_credits,state,created_at,expires_at
) values
 ('88880031-8888-4888-8888-888888888831','pilot-triage01','88880011-8888-4888-8888-888888888811',
  'attempt_legacytriage01','sha256:'||repeat('6',64),'sha256:'||repeat('7',64),'sha256:'||repeat('3',64),
  1,80,1,1,'approved',now(),now()+interval '10 minutes'),
 ('88880033-8888-4888-8888-888888888833','pilot-triage01','88880011-8888-4888-8888-888888888811',
  'attempt_legacysettle01','sha256:'||repeat('6',64),'sha256:'||repeat('8',64),'sha256:'||repeat('3',64),
  1,1,1,1,'approved',now(),now()+interval '10 minutes'),
 ('88880035-8888-4888-8888-888888888835','pilot-triage01','88880011-8888-4888-8888-888888888811',
  'attempt_legacyblocked01','sha256:'||repeat('6',64),'sha256:'||repeat('b',64),'sha256:'||repeat('3',64),
  1,80,1,1,'approved',now(),now()+interval '10 minutes');
insert into public.foundation_intake_approval_files (
  approval_id,file_key,document_id,content_sha256,byte_length,declared_mime_type,page_basis,
  approved_max_pages,approved_reserved_credits,approved_maximum_credits,created_at
) values (
  '88880031-8888-4888-8888-888888888831','fk_legacy01','88880034-8888-4888-8888-888888888834',
  'sha256:'||repeat('9',64),1024,'application/pdf','unknown',80,1,1,now()
),(
  '88880033-8888-4888-8888-888888888833','fk_legacy02','88880032-8888-4888-8888-888888888832',
  'sha256:'||repeat('a',64),1024,'application/pdf','measured',1,1,1,now()
), (
  '88880035-8888-4888-8888-888888888835','fk_legacy03','88880036-8888-4888-8888-888888888836',
  'sha256:'||repeat('c',64),1024,'application/pdf','unknown',80,1,1,now()
);
update public.foundation_intake_approval_files f set
  state='reserved', reservation_id=((select result->>'reservationId' from legacy_hold_fixture)::uuid),
  reserved_at=now()
 where f.approval_id='88880033-8888-4888-8888-888888888833';
update public.foundation_intake_approval_files f set state='confirmed',confirmed_at=now()
 where f.approval_id='88880033-8888-4888-8888-888888888833';

select is((select enabled from public.foundation_intake_triage_rollout_gate where gate_key='upload_triage_v1'),false,'database rollout gate defaults off');
select is((public.reserve_foundation_intake_approved_file(
  'pilot-triage01','88880011-8888-4888-8888-888888888811','attempt_legacytriage01',
  'sha256:'||repeat('7',64),'sha256:'||repeat('3',64),'fk_legacy01')->>'reservationState'),
  'reserved','legacy approved reservation works while triage rollout is disabled');
select throws_ok($$select public.reserve_foundation_intake_approved_file_v2(
  'pilot-triage01','88880011-8888-4888-8888-888888888811','attempt_legacytriage01',
  'sha256:'||repeat('7',64),'sha256:'||repeat('3',64),'fk_legacy01')$$,
  'foundation_intake_triage_rollout_disabled','versioned reservation refuses while rollout is disabled');
select is((public.cancel_foundation_intake_approved_file(
  'pilot-triage01','88880011-8888-4888-8888-888888888811','attempt_legacytriage01',
  'fk_legacy01','TEST_CANCEL')->>'status'),'cancelled','legacy approval remains cancellable while triage is disabled');
update public.foundation_intake_triage_rollout_gate set enabled=true,updated_at=now() where gate_key='upload_triage_v1';
select is((select enabled from public.foundation_intake_triage_rollout_gate where gate_key='upload_triage_v1'),true,'test transaction enables database gate for triage RPC coverage');
select throws_ok($$select public.reserve_foundation_intake_approved_file(
  'pilot-triage01','88880011-8888-4888-8888-888888888811','attempt_legacyblocked01',
  'sha256:'||repeat('b',64),'sha256:'||repeat('3',64),'fk_legacy03')$$,
  'foundation_intake_triage_required','database-on/server-off legacy approval cannot create a new reservation');
select is((public.settle_foundation_intake_approved_compute(
  'pilot-triage01','88880032-8888-4888-8888-888888888832','settled',1,'OCR_COMPLETED')->>'status'),
  'processed','a pre-existing legacy hold remains settleable after database triage gate is enabled');
create temporary table triage_stage_fixture as
select public.create_foundation_intake_triage_stage(
  'pilot-triage01','88880011-8888-4888-8888-888888888811',
  '88880041-8888-4888-8888-888888888841','88880042-8888-4888-8888-888888888842',
  '88880021-8888-4888-8888-888888888821','88880043-8888-4888-8888-888888888843',
  'report.pdf','report.pdf','application/pdf',1024
) as created;
select public.create_foundation_intake_preflight_approval(
  'pilot-triage01','88880011-8888-4888-8888-888888888811',
  '88880041-8888-4888-8888-888888888841','88880049-8888-4888-8888-888888888849',
  'triage-config-v1',jsonb_build_array(jsonb_build_object(
    'stageId','88880042-8888-4888-8888-888888888842','choice','preflight')),
  now()+interval '5 minutes');
select public.claim_foundation_intake_triage_stage_seal(
  'pilot-triage01','88880011-8888-4888-8888-888888888811',
  '88880042-8888-4888-8888-888888888842','88880044-8888-4888-8888-888888888844',
  '88880049-8888-4888-8888-888888888849');
select public.finish_foundation_intake_triage_stage_seal(
  'pilot-triage01','88880011-8888-4888-8888-888888888811',
  '88880042-8888-4888-8888-888888888842','88880044-8888-4888-8888-888888888844',
  1,
  'fk_12345678','sha256:' || repeat('4',64),'etag-sealed','valid');

select ok(
  not has_table_privilege('anon','public.foundation_intake_triage_stages','SELECT')
  and not has_function_privilege('anon',
    'public.create_foundation_intake_triage_stage(text,uuid,uuid,uuid,uuid,uuid,text,text,text,integer)','EXECUTE'),
  'stage storage and create RPC are not directly available to anon'
);
select is((select state from public.foundation_intake_triage_stages
  where stage_id='88880042-8888-4888-8888-888888888842'),'sealed',
  'seal RPC publishes only the server-finalized state');
select is((public.create_foundation_intake_triage_stage(
  'pilot-triage01','88880011-8888-4888-8888-888888888811',
  '88880041-8888-4888-8888-888888888841','88880045-8888-4888-8888-888888888845',
  '88880046-8888-4888-8888-888888888846','88880043-8888-4888-8888-888888888843',
  'report.pdf','report.pdf','application/pdf',1024)->>'stageId'),
  '88880042-8888-4888-8888-888888888842',
  'same idempotency key returns the original stage identity');
select throws_ok($$select public.read_foundation_intake_triage_stages(
  'pilot-triage01','88880012-8888-4888-8888-888888888812',
  '88880041-8888-4888-8888-888888888841')$$,
  'foundation_intake_triage_stage_not_found','other actor cannot enumerate a stage batch');
select throws_ok($$select public.claim_foundation_intake_triage_stage_seal(
  'pilot-triage02','88880011-8888-4888-8888-888888888811',
  '88880042-8888-4888-8888-888888888842','88880047-8888-4888-8888-888888888847',
  '88880049-8888-4888-8888-888888888849')$$,
  'foundation_intake_triage_stage_not_found','another workspace cannot claim the stage');
select is((public.claim_foundation_intake_triage_stage_seal(
  'pilot-triage01','88880011-8888-4888-8888-888888888811',
  '88880042-8888-4888-8888-888888888842','88880048-8888-4888-8888-888888888848',
  '88880049-8888-4888-8888-888888888849')->>'state'),
  'sealed','a late completion retry replays the already sealed stage');

select ok((select provider_calls=0 and monetary_cost_status='not_priced'
    and budget_scope='bounded_bytes_and_file_count' and max_files=1 and max_total_bytes=1024
  from public.foundation_intake_preflight_approvals
  where preflight_approval_id='88880049-8888-4888-8888-888888888849'),
  'preflight consent is separate, file/byte capped, provider-free, and not priced');

create temporary table triage_receipt_fixture as
select public.create_foundation_intake_triage_receipt(
  'pilot-triage01','88880011-8888-4888-8888-888888888811','direct_upload',
  '88880041-8888-4888-8888-888888888841','sha256:' || repeat('1',64),'tavonel-intake-triage-v1',
  'sha256:' || repeat('2',64),'triage-config-v1','sha256:' || repeat('3',64),
  jsonb_build_object('version','tavonel-intake-triage-v1','approvalReady',false,
    'selectedFileKeys',jsonb_build_array(),
    'files',jsonb_build_array(jsonb_build_object('fileKey','fk_12345678','disposition','needs_review',
      'digestEvidence','server_verified','contentSha256','sha256:' || repeat('4',64),
      'byteLength',1024,'mimeType','application/pdf','encryption','unknown','corruption','unknown'))),
  jsonb_build_object('costScope','unknown','reprocessingIncluded',null,
    'incremental',jsonb_build_object('minimum',null,'maximum',null),
    'unavailableProviders',jsonb_build_array('compile_or_reprocessing_price')),
  jsonb_build_array(jsonb_build_object(
    'fileKey','fk_12345678','documentId','88880044-8888-4888-8888-888888888844',
    'stageId','88880042-8888-4888-8888-888888888842',
    'preflightApprovalId','88880049-8888-4888-8888-888888888849',
    'stagingKey','quarantine/pilot-triage01/triage-staging/88880042-8888-4888-8888-888888888842/upload',
    'objectKey','quarantine/pilot-triage01/88880044-8888-4888-8888-888888888844/source',
    'objectVersion','etag-sealed','sealed',true,
    'stagingWriteExpiresAt',(select upload_expires_at from public.foundation_intake_triage_stages where stage_id='88880042-8888-4888-8888-888888888842'),
    'sealMode','server_only_copy_v1',
    'sealedAt',(select sealed_at from public.foundation_intake_triage_stages where stage_id='88880042-8888-4888-8888-888888888842'))),
  false,now()+interval '5 minutes') as result;
create temporary table triage_receipt_bound_fixture as
select r.* from public.foundation_intake_triage_receipts r
where r.receipt_id=(select result->>'receiptId' from triage_receipt_fixture)::uuid;

select throws_ok($$select public.create_foundation_intake_triage_receipt(
  (select workspace_key from triage_receipt_bound_fixture),
  (select actor_user_id from triage_receipt_bound_fixture),
  (select source_kind from triage_receipt_bound_fixture),
  (select source_id from triage_receipt_bound_fixture),
  (select inventory_revision from triage_receipt_bound_fixture),
  (select triage_version from triage_receipt_bound_fixture),
  (select inventory_digest from triage_receipt_bound_fixture),
  (select configuration_revision from triage_receipt_bound_fixture),
  (select pricing_fingerprint from triage_receipt_bound_fixture),
  (select inventory from triage_receipt_bound_fixture),
  (select estimate from triage_receipt_bound_fixture),
  jsonb_set((select file_bindings from triage_receipt_bound_fixture), '{0,sealMode}', to_jsonb('client_final_put_v1'::text)),
  (select approval_ready from triage_receipt_bound_fixture),
  (select expires_at from triage_receipt_bound_fixture))$$,
  'foundation_intake_triage_object_unsealed','receipt rejects a client-writable final-key seal mode');
select throws_ok($$select public.create_foundation_intake_triage_receipt(
  (select workspace_key from triage_receipt_bound_fixture),
  (select actor_user_id from triage_receipt_bound_fixture),
  (select source_kind from triage_receipt_bound_fixture),
  (select source_id from triage_receipt_bound_fixture),
  (select inventory_revision from triage_receipt_bound_fixture),
  (select triage_version from triage_receipt_bound_fixture),
  (select inventory_digest from triage_receipt_bound_fixture),
  (select configuration_revision from triage_receipt_bound_fixture),
  (select pricing_fingerprint from triage_receipt_bound_fixture),
  (select inventory from triage_receipt_bound_fixture),
  (select estimate from triage_receipt_bound_fixture),
  jsonb_set((select file_bindings from triage_receipt_bound_fixture), '{0,stagingWriteExpiresAt}',
    to_jsonb(((select upload_expires_at + interval '1 second' from public.foundation_intake_triage_stages
      where stage_id='88880042-8888-4888-8888-888888888842')::text))),
  (select approval_ready from triage_receipt_bound_fixture),
  (select expires_at from triage_receipt_bound_fixture))$$,
  'foundation_intake_triage_stage_scope','receipt binds the exact staging capability expiry');
select is(public.foundation_intake_customer_charge_complete(
  jsonb_build_object('selectedFileKeys',jsonb_build_array('fk_readproof01'),
    'files',jsonb_build_array(jsonb_build_object('fileKey','fk_readproof01','contentSha256','sha256:'||repeat('4',64),
      'revision','provider-rev-1','disposition','include','digestEvidence','server_verified'))),
  jsonb_build_object('currency','USD','initial',jsonb_build_object('minimum',0.01,'maximum',0.02),
    'incremental',jsonb_build_object('minimum',0,'maximum',0),
    'customerChargeCoverage',jsonb_build_object('policy','published_page_admission_once',
      'scope','entire_affected_source_version_set','pricingFingerprint','sha256:'||repeat('3',64),
      'sourceVersions',jsonb_build_array(jsonb_build_object('fileKey','fk_readproof01','revision','provider-rev-1',
        'contentSha256','sha256:'||repeat('4',64),'mode','unchanged_already_read_recompile'))),
    'operatorCost',jsonb_build_object('status','not_priced','unavailableProviders',jsonb_build_array('cdr'))),
  'sha256:'||repeat('3',64)),false,
  'SQL charge validator rejects unchanged recompile without trusted persisted reading receipt');
select is((select result->>'inventoryDigest' from triage_receipt_fixture),'sha256:' || repeat('2',64),
  'receipt stores the server-bound inventory digest');

select throws_ok($$select public.create_foundation_intake_approval_v2(
  'pilot-triage01','88880011-8888-4888-8888-888888888811','attempt_triage_v2_0001',
  'sha256:' || repeat('5',64),'sha256:' || repeat('3',64),1,
  jsonb_build_array(jsonb_build_object('fileKey','fk_12345678','contentSha256','sha256:' || repeat('4',64),
    'byteLength',1024,'mimeType','application/pdf','pageBasis','measured',
    'approvedMaxPages',1,'reservedCredits',1,'maximumCredits',1)),
  ((select result->>'receiptId' from triage_receipt_fixture)::uuid))$$,
  'foundation_intake_triage_receipt_unready',
  'unknown PDF safety and unpriced incremental work cannot become full-processing approval');

select is((public.read_foundation_intake_approval_v2(
  'pilot-triage01','88880011-8888-4888-8888-888888888811','attempt_legacytriage01')->>'triageReceiptId'),
  null,'legacy approval remains readable with no fabricated triage binding');
select is((public.read_foundation_intake_approval_v2(
  'pilot-triage01','88880011-8888-4888-8888-888888888811','attempt_legacytriage01')->>'triageLineageVersion'),
  '1','versioned approval reader explicitly identifies its lineage-complete response contract');
select throws_ok($$select public.create_foundation_intake_approval_v2(
  'pilot-triage01','88880012-8888-4888-8888-888888888812','attempt_wrong_actor_001',
  'sha256:'||repeat('5',64),'sha256:'||repeat('3',64),1,
  jsonb_build_array(jsonb_build_object('fileKey','fk_12345678','contentSha256','sha256:'||repeat('4',64),
    'byteLength',1024,'mimeType','application/pdf','pageBasis','measured','approvedMaxPages',1,
    'reservedCredits',1,'maximumCredits',1)),
  ((select result->>'receiptId' from triage_receipt_fixture)::uuid))$$,
  'foundation_intake_triage_receipt_not_found','another actor cannot bind the receipt to approval');
insert into public.foundation_intake_triage_receipts (
  receipt_id,workspace_key,actor_user_id,source_kind,source_id,inventory_revision,
  triage_version,inventory_digest,configuration_revision,pricing_fingerprint,
  inventory,estimate,file_bindings,approval_ready,created_at,expires_at
) values (
  '88880051-8888-4888-8888-888888888851','pilot-triage01','88880011-8888-4888-8888-888888888811',
  'direct_upload','88880052-8888-4888-8888-888888888852','sha256:'||repeat('1',64),
  'tavonel-intake-triage-v1','sha256:'||repeat('2',64),'triage-config-v1','sha256:'||repeat('3',64),
  jsonb_build_object('version','tavonel-intake-triage-v1','approvalReady',true,
    'selectedFileKeys',jsonb_build_array('fk_12345678'),
    'files',jsonb_build_array(jsonb_build_object('fileKey','fk_12345678','contentSha256','sha256:'||repeat('4',64),
      'revision',null,'disposition','include','digestEvidence','server_verified'))),
  jsonb_build_object('currency','USD','initial',jsonb_build_object('minimum',0.01,'maximum',0.02),
    'incremental',jsonb_build_object('minimum',0,'maximum',0),
    'customerChargeCoverage',jsonb_build_object('policy','published_page_admission_once',
      'scope','entire_affected_source_version_set','pricingFingerprint','sha256:'||repeat('3',64),
      'sourceVersions',jsonb_build_array(jsonb_build_object('fileKey','fk_12345678','revision',null,
        'contentSha256','sha256:'||repeat('4',64),'mode','new_read'))),
    'operatorCost',jsonb_build_object('status','not_priced','unavailableProviders',jsonb_build_array()),
    'basis','fixture','assumptions',jsonb_build_array()),'[]'::jsonb,true,now()-interval '2 minutes',now()-interval '1 minute'
);
select throws_ok($$select public.create_foundation_intake_approval_v2(
  'pilot-triage01','88880011-8888-4888-8888-888888888811','attempt_expired_receipt_01',
  'sha256:'||repeat('5',64),'sha256:'||repeat('3',64),1,
  jsonb_build_array(jsonb_build_object('fileKey','fk_12345678','contentSha256','sha256:'||repeat('4',64),
    'byteLength',1024,'mimeType','application/pdf','pageBasis','measured','approvedMaxPages',1,
    'reservedCredits',1,'maximumCredits',1)),
  '88880051-8888-4888-8888-888888888851')$$,
  'foundation_intake_triage_receipt_stale','expired receipt cannot create a new approval');
select throws_ok($$select public.assert_foundation_intake_triage_compile_set(
  'pilot-triage02','88880011-8888-4888-8888-888888888811',
  array['88880021-8888-4888-8888-888888888821'::uuid])$$,
  'foundation_intake_triage_compile_scope','compile set remains workspace scoped');

select * from finish();
rollback;
