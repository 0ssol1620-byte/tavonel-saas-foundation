-- DISPOSABLE OFFLINE OWNING FIXTURES ONLY. ALL PostgreSQL/pgTAP/races UNRUN.
-- psql -X -v ON_ERROR_STOP=1 -v world_disposable=1 -v world_role=unit -f this-file.sql
-- Requires exact canonical migrations, viewer/job-authority + purpose schema + this sibling
-- commit draft. Never use a live/project database. No public gate/role/key is changed.
-- `unit` rolls everything back; `setup` commits synthetic data ONLY for multi-session races.
-- Each race uses a fresh disposable DB/setup. Root owns launching/recording the real sessions.
\set ON_ERROR_STOP on
\if :{?world_disposable}
\else
\echo 'Refusing: explicit disposable offline fixture argument required'
\quit 9
\endif
select :'world_disposable'='1' as world_disposable_confirmed \gset
\if :world_disposable_confirmed
\else
\echo 'Refusing: world_disposable must equal 1 for offline owning tests'
\quit 9
\endif
\if :{?world_role}
\else
\set world_role unit
\endif
\if :{?world_case}
\else
\set world_case none
\endif
select :'world_role' in ('unit','setup','holder','contender','assert','member_inserter','arm_expiry') as world_role_valid,
  (:'world_case' in ('grant_revoke','qualification_revoke','epoch','delete','same_replay','changed_replay','member_fk','reservation_expiry')
    or (:'world_role' in ('unit','setup') and :'world_case'='none')) as world_case_valid \gset
\if :world_role_valid
\else
\quit 9
\endif
\if :world_case_valid
\else
\quit 9
\endif
select :'world_role' in ('unit','setup') as world_setup, :'world_role'='unit' as world_unit,
  :'world_role'='holder' as world_holder, :'world_role'='contender' as world_contender,
  :'world_role'='assert' as world_assert, :'world_role'='member_inserter' as world_member_inserter,
  :'world_role'='arm_expiry' as world_arm_expiry \gset
\if :world_setup
begin;
set local transaction isolation level read committed;
create schema native_world_fixture;
revoke all on schema native_world_fixture from public,anon,authenticated,service_role;
create table native_world_fixture.control(case_name text not null);
insert into native_world_fixture.control values(:'world_case');
create table native_world_fixture.outcomes(actor text primary key, outcome jsonb not null);
create table native_world_fixture.mutations(case_name text primary key, observed boolean not null);
create table native_world_fixture.expiry_window(reservation_id uuid primary key,expires_at timestamptz not null,armed_at timestamptz not null);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-0000-0000-000000000000','88888888-8888-4888-8888-888888888891','authenticated','authenticated',
  'native-candidate-member@example.invalid','$2a$10$fixture',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','99999999-9999-4999-8999-999999999992','authenticated','authenticated',
  'native-candidate-owner@example.invalid','$2a$10$fixture',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.foundation_workspaces(workspace_key,display_name,created_by)
values('pilot-candidate','Synthetic candidate fixture','99999999-9999-4999-8999-999999999992');
insert into public.foundation_workspace_members(workspace_key,user_id,role,state,accepted_at)
values ('pilot-candidate','99999999-9999-4999-8999-999999999992','owner','active',now()),
 ('pilot-candidate','88888888-8888-4888-8888-888888888891','member','active',now());
-- Existing billing rows are inert REFERENCES, not new billing policy or a charge/hold RPC.
insert into public.foundation_billing_accounts(workspace_key,user_id)
values('pilot-candidate','88888888-8888-4888-8888-888888888891');
insert into public.foundation_intake_approvals(approval_id,workspace_key,user_id,attempt_key,
 client_manifest_digest,scope_digest,pricing_fingerprint,file_count,aggregate_maximum_pages,
 aggregate_reserved_credits,aggregate_maximum_credits,created_at,expires_at)
values('90000000-0000-4000-8000-000000000091','pilot-candidate','88888888-8888-4888-8888-888888888891',
 'native-candidate-test-attempt','sha256:'||repeat('a',64),'sha256:'||repeat('b',64),'sha256:'||repeat('c',64),
 2,2,4,4,now(),now()+interval '10 minutes');
create function native_world_fixture.candidate_doc(i integer) returns uuid language sql immutable as $$
 select ('20000000-0000-4000-8000-'||pg_catalog.lpad(i::text,12,'0'))::uuid;
$$;
create function native_world_fixture.candidate_rep(v text,k text,key text) returns text language sql immutable as $$
 select 'rep-'||pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v||pg_catalog.chr(10)||k||pg_catalog.chr(10)||key,'UTF8')),'hex'),1,32);
$$;
insert into public.foundation_compile_jobs(job_id,workspace_key,created_by_user_id,authorization_revision,
 document_ids,idempotency_key,state,documents_total,collection_id,compilation_mode)
select 'cjob-'||repeat('4',32),'pilot-candidate','88888888-8888-4888-8888-888888888891',authorization_revision,
 array[native_world_fixture.candidate_doc(92)::text,native_world_fixture.candidate_doc(91)::text],repeat('4',64),'reading',2,null,'document_batch'
from public.foundation_workspace_members where workspace_key='pilot-candidate' and user_id='88888888-8888-4888-8888-888888888891';
insert into public.foundation_native_qualification_profiles(qualification_id,producer_id,producer_key_id,producer_key_reference,
 producer_revision,caller_id,reader_revision,input_mime_type,cir_schema_version,native_parser_version)
values('synthetic-unreviewed-correction','synthetic-producer','synthetic-key-ref','opaque-reference-never-loaded',
 'sha256:'||repeat('1',64),'synthetic-caller','sha256:'||repeat('2',64),
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','cir-1.0.0','1.2.0');
-- Golden identities are generated by the existing nativeCollectionId/nativeReplayBinding
-- functions and recorded/checked by the focused offline harness; NOT job output collection_id.
insert into public.foundation_native_purpose_grants(native_grant_id,intake_approval_id,intake_scope_digest,qualification_id,
 workspace_key,tenant_id,principal_user_id,job_id,authorization_revision,collection_id,replay_binding)
select '90000000-0000-4000-8000-000000000092','90000000-0000-4000-8000-000000000091','sha256:'||repeat('b',64),
 'synthetic-unreviewed-correction',workspace_key,workspace_key,created_by_user_id,job_id,authorization_revision,
 'collection-785c3825ef186bf71c72c6aeb6a5078a','native-work-1fa26e9ef83fb26f16ead43f41a7df53'
from public.foundation_compile_jobs where job_id='cjob-'||repeat('4',32);
create function native_world_fixture.seed_candidate_member(i integer) returns void language plpgsql as $$
declare
 d uuid:=native_world_fixture.candidate_doc(i);v text;original_key text;pdf_key text;oid text;pid text;
 rid uuid:=('30000000-0000-4000-8000-'||pg_catalog.lpad(i::text,12,'0'))::uuid;
 mime constant text:='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
begin
 v:=d::text||':'||repeat('c',64);original_key:='quarantine/pilot-candidate/'||d::text||'/source';
 pdf_key:='immutable/pilot-candidate/pilot-candidate/'||d::text||'/'||repeat('d',64)||'/sanitized.pdf';
 oid:=native_world_fixture.candidate_rep(v,'original',original_key);pid:=native_world_fixture.candidate_rep(v,'normalized',pdf_key);
 insert into public.foundation_intake_approval_files(approval_id,file_key,document_id,content_sha256,byte_length,declared_mime_type,
  page_basis,approved_max_pages,approved_reserved_credits,approved_maximum_credits,created_at)
 values('90000000-0000-4000-8000-000000000091','synthetic-file-'||i,d,'sha256:'||repeat('c',64),12,mime,'measured',1,2,2,now());
 insert into public.foundation_compute_reservations(reservation_id,workspace_key,document_id,user_id,reserved_credits,maximum_credits,billing_source,expires_at)
 values(rid,'pilot-candidate',d,'88888888-8888-4888-8888-888888888891',2,2,'paid',now()+interval '10 minutes');
 update public.foundation_intake_approval_files set state='reserved',reservation_id=rid,reserved_at=now() where document_id=d;
 update public.foundation_intake_approval_files set state='confirmed',confirmed_at=now() where document_id=d;
 insert into public.foundation_intake_admissions(workspace_key,document_id,user_id,object_key,requested_bytes,declared_mime_type,
  expires_at,confirmed_at,source_sha256,state)
 values('pilot-candidate',d,'88888888-8888-4888-8888-888888888891',original_key,12,mime,now()+interval '10 minutes',now(),'sha256:'||repeat('c',64),'quarantined');
 insert into public.sources(source_id,tenant_id,workspace_id,origin_kind,source_family,created_at,origin_provider)
 values(d::text,'pilot-candidate','pilot-candidate','upload','spreadsheet',now(),'synthetic-original');
 insert into public.source_versions(source_version_id,source_id,immutable_object_key,content_sha256,byte_length,mime_type,observed_at)
 values(v,d::text,original_key,'sha256:'||repeat('c',64),12,mime,now());
 insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,content_sha256,object_key,lossy,derived_from,created_at)
 values(oid,v,'original','synthetic-original','synthetic-revision','sha256:'||repeat('c',64),original_key,false,'{}',now());
 insert into public.source_representations(representation_id,source_version_id,kind,provider_id,provider_revision,content_sha256,object_key,lossy,derived_from,created_at)
 values(pid,v,'normalized','synthetic-cdr','synthetic-revision','sha256:'||repeat('d',64),pdf_key,true,array[oid],now());
 insert into public.foundation_native_purpose_members(native_grant_id,intake_approval_id,intake_file_key,document_id,reservation_id,
  source_id,source_version_id,original_representation_id,normalized_representation_id,original_sha256,original_bytes,quarantine_original_key,
  normalized_pdf_key,normalized_pdf_sha256,security_receipt_id,security_object_key,security_object_sha256,security_qualification_id,
  security_attestation_sha256,native_object_key,native_object_sha256,native_bytes)
 values('90000000-0000-4000-8000-000000000092','90000000-0000-4000-8000-000000000091','synthetic-file-'||i,d,rid,
  d::text,v,oid,pid,'sha256:'||repeat('c',64),12,original_key,pdf_key,'sha256:'||repeat('d',64),'unverified-security-'||i,
  'quarantine/pilot-candidate/'||d::text||'/receipt','sha256:'||repeat('e',64),'unverified-security-profile','sha256:'||repeat('f',64),
  'immutable/pilot-candidate/pilot-candidate/'||d::text||'/'||repeat('c',64)||'/source.xlsx','sha256:'||repeat('c',64),12);
end;
$$;
select native_world_fixture.seed_candidate_member(91);
select native_world_fixture.seed_candidate_member(92);

-- Test-only synthetic authorized/bound rows. They deliberately have NO real signatures,
-- scanner/CDR/producer/independent qualification. The private verifier below is a test double.
update public.foundation_native_qualification_profiles set state='reviewed',independent_qualifier_id='synthetic-independent-reviewer',
 review_attestation_sha256='sha256:'||repeat('f',64),reviewed_at=now()-interval '1 minute',valid_from=now()-interval '1 minute',expires_at=now()+interval '1 hour'
 where qualification_id='synthetic-unreviewed-correction';
update public.foundation_native_purpose_grants set state='authorized',native_authorization_issuer_id='synthetic-preparation-issuer',
 native_authorization_policy_sha256='sha256:'||repeat('f',64),native_authorization_evidence_sha256='sha256:'||repeat('e',64),
 authorized_at=now()-interval '1 minute',valid_from=now()-interval '1 minute',expires_at=now()+interval '1 hour'
 where native_grant_id='90000000-0000-4000-8000-000000000092';
update public.foundation_native_purpose_members set binding_state='bound',processing_receipt_id='synthetic-bound-'||document_id,
 signed_processing_receipt='{"syntheticOnly":true}',signed_receipt_sha256='sha256:'||repeat('e',64),
 cir_object_key='immutable/pilot-candidate/pilot-candidate/'||document_id||'/'||repeat('1',64)||'/native-cir.json',
 cir_object_sha256='sha256:'||repeat('1',64),cir_canonical_sha256='sha256:'||repeat('1',64),cir_bytes=3,bound_at=now()-interval '1 minute';
insert into public.foundation_compile_jobs(job_id,workspace_key,created_by_user_id,authorization_revision,
 document_ids,idempotency_key,state,documents_total,collection_id,compilation_mode)
select 'cjob-'||repeat('5',32),workspace_key,created_by_user_id,authorization_revision,document_ids,repeat('5',64),'reading',documents_total,null,'document_batch'
 from public.foundation_compile_jobs where job_id='cjob-'||repeat('4',32);
-- Failed PREPARATION job is historical evidence only. A fresh authorized World job is required.
update public.foundation_compile_jobs set state='failed',settled_at=clock_timestamp() where job_id='cjob-'||repeat('4',32);

create function native_world_fixture.identity(prefix text,parts text[]) returns text language sql immutable as $$
 select prefix||'_'||encode(sha256(convert_to('akc.identity.v1'||chr(30)||prefix||chr(30)||
 (select string_agg(length(p)||':'||p,chr(31) order by ord) from unnest(parts) with ordinality a(p,ord)),'UTF8')),'hex');
$$;
create function native_world_fixture.ref(kind text,key text) returns jsonb language sql immutable as $$
 select jsonb_build_object('artifactId',kind||'_'||encode(sha256(convert_to('{}'||chr(10),'UTF8')),'hex'),'kind',kind,
 'mediaType','application/json','byteLength',3,'sha256','sha256:'||encode(sha256(convert_to('{}'||chr(10),'UTF8')),'hex'),'objectKey',key);
$$;
create function native_world_fixture.seed_world_grant(id uuid) returns void language plpgsql as $$
declare c jsonb;s jsonb;a jsonb;h text:='sha256:'||encode(sha256(convert_to('{}'||chr(10),'UTF8')),'hex'); t text; e text;
begin
 select jsonb_agg(jsonb_build_object('nativeId',document_id,'sourceId',native_world_fixture.identity('src',array['pilot-candidate','foundation-r2',document_id::text]),
   'sourceVersionId',native_world_fixture.identity('dv',array[native_world_fixture.identity('src',array['pilot-candidate','foundation-r2',document_id::text]),original_sha256]),
   'contentSha256',original_sha256,'cirSha256',cir_canonical_sha256,'processingReceiptId',processing_receipt_id)
   order by native_world_fixture.identity('src',array['pilot-candidate','foundation-r2',document_id::text])) into s
 from public.foundation_native_purpose_members where native_grant_id='90000000-0000-4000-8000-000000000092';
 a:=jsonb_build_array(native_world_fixture.ref('native_facts','immutable/pilot-candidate/pilot-candidate/native-preparations/nprep_'||repeat('b',64)||'/'||substr(h,8)||'/native_facts.json'),
   native_world_fixture.ref('full_cir_package','immutable/pilot-candidate/pilot-candidate/native-preparations/nprep_'||repeat('b',64)||'/'||substr(h,8)||'/full_cir_package.json'));
 t:=to_char((now()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 e:=to_char((now()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 select jsonb_build_object('schemaVersion','tavonel.native_world_reduction_authority.v1','purpose','native_world_reduction','grantId',id,
   'issuerId','synthetic-world-sql-issuer','issuerKeyId','no-real-key','callerId','synthetic-world-sql-caller',
   'policySha256','sha256:'||repeat('f',64),'evidenceSha256','sha256:'||repeat('e',64),
   'tenantId',workspace_key,'workspaceId',workspace_key,'principalUserId',created_by_user_id,'jobId',job_id,
   'authorizationRevision',authorization_revision,'collectionId','collection-785c3825ef186bf71c72c6aeb6a5078a',
   'preparationGrantId','90000000-0000-4000-8000-000000000092','preparationJobId','cjob-'||repeat('4',32),
   'preparationReplayBinding','native-work-1fa26e9ef83fb26f16ead43f41a7df53','worldReplayBinding','native-world-work-'||repeat('5',32),
   'canonicalRequestSha256','sha256:'||repeat('b',64),'coreReleaseDigest','sha256:'||repeat('a',64),
   'projectionVersion','tavonel.native_cell_observation_world.refs.v1','sources',s,'inputArtifacts',a,'issuedAt',t,'expiresAt',e) into c
 from public.foundation_compile_jobs where job_id='cjob-'||repeat('5',32);
 insert into public.foundation_native_world_grants(grant_id,preparation_grant_id,reduction_job_id,workspace_key,principal_user_id,
   authorization_revision,claims_wire,claims,issuer_signature,state,issued_at,expires_at)
 values(id,'90000000-0000-4000-8000-000000000092',c->>'jobId',c->>'workspaceId',(c->>'principalUserId')::uuid,
   (c->>'authorizationRevision')::bigint,public.native_world_header_wire_v1(c),c,'sha256:'||repeat('d',64),'authorized',t::timestamptz,e::timestamptz);
end; $$;
select native_world_fixture.seed_world_grant('90000000-0000-4000-8000-000000000093');
select native_world_fixture.seed_world_grant('90000000-0000-4000-8000-000000000094');
create function native_world_fixture.request(id uuid default '90000000-0000-4000-8000-000000000093') returns jsonb language plpgsql as $$
declare c jsonb;ctx jsonb;refs jsonb;manifest jsonb;raw text;rawsha text;inputsha text;outputsha text;
begin
 select claims into c from public.foundation_native_world_grants where grant_id=id;
 ctx:=jsonb_build_object('tenantId',c->'tenantId','workspaceId',c->'workspaceId','principalUserId',c->'principalUserId',
  'jobId',c->'jobId','authorizationRevision',c->'authorizationRevision','collectionId',c->'collectionId',
  'documentIds',(select jsonb_agg(value->'nativeId' order by value->>'nativeId') from jsonb_array_elements(c->'sources')));
 refs:=c->'inputArtifacts'||jsonb_build_array(native_world_fixture.ref('canonical_knowledge_model',
  'immutable/pilot-candidate/pilot-candidate/native-world-reductions/native_refs_ws_'||repeat('f',64)||'/'||
  encode(sha256(convert_to('{}'||chr(10),'UTF8')),'hex')||'/canonical_knowledge_model.json'));
 manifest:=jsonb_build_object('schemaVersion','tavonel.product_core.native_world_artifact_manifest.v1','projectionVersion',c->'projectionVersion',
  'kind','native_world_artifact_manifest','operationClass','initial_compile','status','review_required','approvalStatus','unbound','candidatePromotion',false,
  'signatureStatus','external_signer_required','tenantId',c->'tenantId','workspaceId',c->'workspaceId','collectionId',c->'collectionId',
  'coreReleaseDigest',c->'coreReleaseDigest','canonicalRequestSha256',c->'canonicalRequestSha256','worldStateId','native_refs_ws_'||repeat('f',64),
  'manifestDigest','sha256:'||repeat('f',64),'sources',c->'sources','artifacts',(select jsonb_agg(value-'objectKey' order by ord) from jsonb_array_elements(refs) with ordinality a(value,ord)),
  'cellCount',8,'knowledgeObjectCount',25,'validation','{}'::jsonb,'reviewReasons',jsonb_build_array('SYNTHETIC_SQL_ONLY'));
 raw:=public.native_world_header_wire_v1(manifest)||chr(10);rawsha:='sha256:'||encode(sha256(convert_to(raw,'UTF8')),'hex');
 inputsha:='sha256:'||encode(sha256(convert_to('tavonel.native_world_reduction_commit.v1'||chr(10)||public.native_world_header_wire_v1(jsonb_build_object(
  'purpose','native_world_reduction','context',ctx,'grantId',id,'worldReplayBinding',c->'worldReplayBinding','canonicalRequestSha256',c->'canonicalRequestSha256',
  'sources',c->'sources','inputArtifacts',c->'inputArtifacts','coreReleaseDigest',c->'coreReleaseDigest','projectionVersion',c->'projectionVersion')),'UTF8')),'hex');
 outputsha:='sha256:'||encode(sha256(convert_to('tavonel.native_world_reduction_commit.v1'||chr(10)||public.native_world_header_wire_v1(jsonb_build_object(
  'manifestRawSha256',rawsha,'artifactRefs',refs)),'UTF8')),'hex');
 return jsonb_build_object('schemaVersion','tavonel.native_world_reduction_commit.v1','context',ctx,'grantId',id,'worldReplayBinding',c->'worldReplayBinding',
  'inputWorkSha256',inputsha,'outputBindingSha256',outputsha,'manifestWire',raw,'manifestRawSha256',rawsha,'artifactRefs',refs);
end; $$;
create function native_world_fixture.verify(claims text,signature text,capture jsonb,request jsonb) returns void language plpgsql as $$
declare deadline timestamptz;
begin
 if claims::jsonb->>'issuerId'<>'synthetic-world-sql-issuer' or signature<>'sha256:'||repeat('d',64)
   or capture->>'valid'<>'true' or jsonb_array_length(capture->'members')<>2 then raise exception 'SQL_SYNTHETIC_VERIFIER_REFUSED';end if;
 -- This is intentionally NOT a real issuer/security/Core verifier. It is reachable ONLY
 -- from the private INVOKER fixture copy and is revoked from every application role.
 if (select case_name from native_world_fixture.control)='reservation_expiry' then
  select (value->>'reservationExpiresAt')::timestamptz into deadline
   from jsonb_array_elements(capture->'existingAuthority'->'reservations')
   where value->>'reservationId'='30000000-0000-4000-8000-000000000091';
  if deadline is null or deadline<=clock_timestamp() then raise exception 'SQL_EXPIRY_ARM_TOO_LATE';end if;
  perform pg_advisory_xact_lock(90300,10); -- ready INSIDE the verifier while reservation is still live
  perform pg_advisory_xact_lock(90400,10); -- controller releases only after the real captured deadline
  if clock_timestamp()<deadline then raise exception 'SQL_EXPIRY_BARRIER_RELEASED_EARLY';end if;
 end if;
end; $$;
create function native_world_fixture.case_id(name text) returns integer language plpgsql immutable as $$
begin
 return case name when 'grant_revoke' then 1 when 'qualification_revoke' then 2 when 'epoch' then 3 when 'delete' then 4
 when 'same_replay' then 5 when 'changed_replay' then 6 when 'member_fk' then 7 when 'third_failure' then 8
 when 'reservation_expiry' then 10 else 9 end;
end; $$;
create function native_world_fixture.after_locks() returns void language plpgsql as $$
declare case_name text;
begin
 select c.case_name into case_name from native_world_fixture.control c;
 if case_name='member_fk' then
  perform pg_advisory_xact_lock(90300,7); -- granted readiness barrier, visible in pg_locks
  perform pg_advisory_xact_lock(90400,7); -- controller owns this BEFORE launch, releases AFTER FK waiter observed
 end if;
end; $$;
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.commit_foundation_native_world_reduction_v1(jsonb)'::regprocedure);
 if strpos(definition,'prerequisite_review_complete constant boolean := false')=0 or strpos(definition,'WORLD_CAPTURE_AFTER_WAITS')=0 then raise exception 'EXACT_CLOSED_DRAFT_REQUIRED';end if;
 definition:=replace(definition,'public.commit_foundation_native_world_reduction_v1','native_world_fixture.commit');
 definition:=replace(definition,'SECURITY DEFINER','SECURITY INVOKER');
 definition:=replace(definition,'prerequisite_review_complete constant boolean := false','prerequisite_review_complete constant boolean := true');
 definition:=replace(definition,'public.verify_foundation_native_world_commit_v1','native_world_fixture.verify');
 definition:=replace(definition,'  -- WORLD_CAPTURE_AFTER_WAITS:', '  perform native_world_fixture.after_locks();'||chr(10)||'  -- WORLD_CAPTURE_AFTER_WAITS:');
  execute definition;
  execute 'alter function native_world_fixture.commit(jsonb) set lock_timeout=''30s''';
end; $$;
create function native_world_fixture.third_failure() returns trigger language plpgsql as $$
begin
 if (select case_name from native_world_fixture.control)='third_failure' then raise exception 'SQL_THIRD_REFERENCE_FAILED';end if;
 return new;
end; $$;
create trigger native_world_fixture_third_failure before insert on public.foundation_native_world_commits
 for each row execute function native_world_fixture.third_failure();
-- All private capabilities stay owner-only, including the test-only gate-open copy.
revoke all on all tables in schema native_world_fixture from public,anon,authenticated,service_role;
revoke all on all functions in schema native_world_fixture from public,anon,authenticated,service_role;

create function native_world_fixture.unit_case(mode text) returns jsonb language plpgsql as $$
declare result jsonb;req jsonb:=native_world_fixture.request();observed boolean:=false;msg text;row_count integer;
begin
 begin
  update native_world_fixture.control set case_name=mode;
  if mode='epoch' then update public.foundation_workspace_members set role='admin',authorization_revision=authorization_revision+1 where workspace_key='pilot-candidate' and user_id='88888888-8888-4888-8888-888888888891';observed:=found;
  elsif mode='grant_revoke' then update public.foundation_native_world_grants set state='revoked',revoked_at=clock_timestamp() where grant_id='90000000-0000-4000-8000-000000000093';observed:=found;
  elsif mode='qualification_revoke' then update public.foundation_native_qualification_profiles set state='revoked',revoked_at=clock_timestamp() where qualification_id='synthetic-unreviewed-correction';observed:=found;
  elsif mode='delete' then update public.sources set tombstoned_at=clock_timestamp() where source_id=native_world_fixture.candidate_doc(91)::text;observed:=found;
  elsif mode='failed_world_job' then update public.foundation_compile_jobs set state='failed',settled_at=clock_timestamp() where job_id='cjob-'||repeat('5',32);observed:=found;
  elsif mode in ('expired_before_entry','settled_past_expiry') then
   update public.foundation_compute_reservations set created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second',
    state=case when mode='settled_past_expiry' then 'settled'::public.foundation_compute_state else 'reserved'::public.foundation_compute_state end,
    settled_at=case when mode='settled_past_expiry' then clock_timestamp() else null end,
    settled_credits=case when mode='settled_past_expiry' then 2 else null end
   where reservation_id='30000000-0000-4000-8000-000000000091';observed:=found;
  elsif mode='wrong_input' then req:=jsonb_set(req,'{inputWorkSha256}',to_jsonb('sha256:'||repeat('f',64)));observed:=true;
  elsif mode='wrong_third' then req:=jsonb_set(req,'{artifactRefs,2,objectKey}','"alias"');observed:=true;
  elsif mode='missing_third' then req:=jsonb_set(req,'{artifactRefs}',(req->'artifactRefs')-2);observed:=true;
  else observed:=true;end if;
  if not observed then raise exception 'SQL_FIXTURE_MUTATION_FAILED';end if;
  begin
   result:=jsonb_build_object('first',native_world_fixture.commit(req));
   if mode='same' then result:=result||jsonb_build_object('second',native_world_fixture.commit(req));end if;
   if mode='changed' then result:=result||jsonb_build_object('second',native_world_fixture.commit(native_world_fixture.request('90000000-0000-4000-8000-000000000094')));end if;
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text;result:=jsonb_build_object('error',msg);end;
  select count(*) into row_count from public.foundation_native_world_commits;
  result:=result||jsonb_build_object('rows',row_count,'observed',observed);
  raise exception using errcode='ZX001',message='rollback owning fixture case';
 exception when sqlstate 'ZX001' then return result;end;
end; $$;
revoke all on function native_world_fixture.unit_case(text) from public,anon,authenticated,service_role;
\if :world_unit
select no_plan();
select ok(strpos(pg_get_functiondef('public.commit_foundation_native_world_reduction_v1(jsonb)'::regprocedure),'prerequisite_review_complete constant boolean := false')>0,'public gate stays false');
select throws_ok($$select public.commit_foundation_native_world_reduction_v1('{}')$$,'P0001','NATIVE_WORLD_REDUCTION_DISABLED','public function closed');
select ok(not has_function_privilege('service_role','public.commit_foundation_native_world_reduction_v1(jsonb)','EXECUTE'),'service role has no live RPC grant');
select ok(not has_table_privilege('authenticated','public.foundation_native_world_commits','SELECT'),'user cannot enumerate unreleased refs');
select is(native_world_fixture.unit_case('positive')->'first'->>'writeStatus','written','fresh World job succeeds with private synthetic trust double');
select is(native_world_fixture.unit_case('same')->'second'->>'writeStatus','exists','same work replay current checks');
select is(native_world_fixture.unit_case('same')->>'rows','1','exactly one whole commit row');
select is(native_world_fixture.unit_case('changed')->>'error','NATIVE_WORLD_REPLAY_CONFLICT','changed grant work cannot overwrite replay');
select is(native_world_fixture.unit_case('wrong_input')->>'error','NATIVE_WORLD_WORK_BINDING_INVALID','wrong input digest refuses');
select is(native_world_fixture.unit_case('wrong_third')->>'error','NATIVE_WORLD_MODEL_REFERENCE_INVALID','wrong third key refuses');
select is(native_world_fixture.unit_case('missing_third')->>'error','NATIVE_WORLD_MANIFEST_BINDING_INVALID','two references refuse');
select is(native_world_fixture.unit_case('third_failure')->>'rows','0','third reference insertion failure is atomic');
select is(native_world_fixture.unit_case('third_failure')->>'error','SQL_THIRD_REFERENCE_FAILED','actual injected failure was reached');
select is(native_world_fixture.unit_case('epoch')->>'error','NATIVE_WORLD_JOB_UNAUTHORIZED','current epoch required');
select is(native_world_fixture.unit_case('failed_world_job')->>'error','NATIVE_WORLD_CURRENT_SCOPE_INVALID','fresh capture refuses terminal World job although historical prep job is failed');
select is(native_world_fixture.unit_case('grant_revoke')->>'error','NATIVE_WORLD_AUTHORITY_BINDING_INVALID','revoked World grant refuses');
select is(native_world_fixture.unit_case('qualification_revoke')->>'error','NATIVE_WORLD_CURRENT_AUTHORITY_INVALID','revoked qualification refuses');
select is(native_world_fixture.unit_case('delete')->>'error','NATIVE_WORLD_CURRENT_SCOPE_INVALID','fresh capture refuses deleted source');
select is(native_world_fixture.unit_case('expired_before_entry')->>'error','NATIVE_WORLD_RESERVATION_EXPIRED','reserved deadline expired before entry refuses');
select is(native_world_fixture.unit_case('expired_before_entry')->>'rows','0','expired-before-entry leaves no partial commit');
select is(native_world_fixture.unit_case('settled_past_expiry')->'first'->>'writeStatus','written','settled historical expiry retains existing compile-set policy');
select is((select count(*)::integer from public.foundation_native_world_commits),0,'all cases rolled back');
select * from finish();
rollback;
\else
-- Only the FK race needs prepared source/file 93. Insert then remove its native membership
-- before launching sessions, so the later INSERT has a genuinely new PK and all valid FKs.
select native_world_fixture.seed_candidate_member(93) where :'world_case'='member_fk';
delete from public.foundation_native_purpose_members where document_id=native_world_fixture.candidate_doc(93);
commit;
\endif
\endif

-- CROSS-SESSION BARRIERS (no sleeps). For each case use a FRESH disposable setup DB.
-- Controller session C FIRST: select pg_advisory_lock(90400,case_id).
-- Launch holder H (-v world_role=holder -v world_case=...). Poll pg_locks for GRANTED
-- (classid=90300,objid=case_id,objsubid=2); launch contender T. Capture pg_blocking_pids(T)
-- and pg_locks to prove T really waits on H. C releases its OWN advisory lock only after
-- that evidence: select pg_advisory_unlock(90400,case_id). Await H/T; then assert role.
-- grant_revoke/qualification_revoke/epoch/delete: H mutates AFTER its wait; T must see fresh
-- post-wait authority and refuse. same_replay: H writes, T waits then returns exists.
-- changed_replay: H writes grant93, T waits then conflicts using different signed grant94.
-- member_fk: C holds key(90400,7); launch T first (private after-locks barrier), observe its
-- readiness(90300,7); launch member_inserter I. Prove I waits on T's parent FOR UPDATE FK
-- lock before C releases. T sees pre-seeded file-set mismatch and refuses; I then inserts.
-- This FK case proves exclusion/bounded-set refusal, not a successful third-file World.
-- reservation_expiry: after setup, C owns (90400,10); invoke arm_expiry immediately before
-- launching T. Arming shortens the synthetic PAID reservation to a real 10-second deadline
-- without violating its created_at/lifetime constraint. Read its committed expiry_window.
-- Verify T holds ready(90300,10) and pg_blocking_pids(T) includes C: the private verifier
-- explicitly refuses readiness if the captured reservation was already expired on entry.
-- C releases ONLY when server clock_timestamp() >= expiry_window.expires_at. No sleep or
-- fake clock stands in for the wait. T must return NATIVE_WORLD_RESERVATION_EXPIRED, rows=0.
-- Early release/setup delay fails with distinct fixture errors, never masquerades as denial.
\if :world_arm_expiry
begin;
do $$
declare deadline timestamptz;armed timestamptz:=clock_timestamp();
begin
 if (select case_name from native_world_fixture.control) is distinct from 'reservation_expiry' then raise exception 'SQL_EXPIRY_CASE_REQUIRED';end if;
 update public.foundation_compute_reservations set expires_at=armed+interval '10 seconds'
  where reservation_id='30000000-0000-4000-8000-000000000091' and billing_source='paid' and state='reserved'
  returning expires_at into deadline;
 if not found or deadline<=armed then raise exception 'SQL_EXPIRY_ARM_FAILED';end if;
 insert into native_world_fixture.expiry_window values('30000000-0000-4000-8000-000000000091',deadline,armed);
 insert into native_world_fixture.mutations values('reservation_expiry',true);
end; $$;
commit;
\endif
\if :world_holder
begin;
set local transaction isolation level read committed;
set local lock_timeout='30s';
do $$ begin if (select case_name from native_world_fixture.control) not in ('grant_revoke','qualification_revoke','epoch','delete','same_replay','changed_replay') then raise exception 'SQL_RACE_CASE_INVALID';end if;end; $$;
select set_config('application_name','native-world-holder-'||:'world_case',true);
select 1 from public.foundation_native_world_grants where grant_id='90000000-0000-4000-8000-000000000093' and :'world_case'='grant_revoke' for update;
select 1 from public.foundation_native_qualification_profiles where qualification_id='synthetic-unreviewed-correction' and :'world_case'='qualification_revoke' for update;
select 1 from public.foundation_workspace_members where workspace_key='pilot-candidate' and user_id='88888888-8888-4888-8888-888888888891' and :'world_case'='epoch' for update;
-- Hold the shared approval advisory order before source deletion.
select pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:pilot-candidate',0)) where :'world_case'='delete';
select 1 from public.sources where source_id=native_world_fixture.candidate_doc(91)::text and :'world_case'='delete' for update;
insert into native_world_fixture.outcomes select 'holder',native_world_fixture.commit(native_world_fixture.request()) where :'world_case' in ('same_replay','changed_replay');
select pg_advisory_xact_lock(90300,native_world_fixture.case_id(:'world_case'));
select pg_advisory_xact_lock(90400,native_world_fixture.case_id(:'world_case'));
update public.foundation_native_world_grants set state='revoked',revoked_at=clock_timestamp() where grant_id='90000000-0000-4000-8000-000000000093' and :'world_case'='grant_revoke';
update public.foundation_native_qualification_profiles set state='revoked',revoked_at=clock_timestamp() where qualification_id='synthetic-unreviewed-correction' and :'world_case'='qualification_revoke';
update public.foundation_workspace_members set role='admin',authorization_revision=authorization_revision+1 where workspace_key='pilot-candidate' and user_id='88888888-8888-4888-8888-888888888891' and :'world_case'='epoch';
update public.sources set tombstoned_at=clock_timestamp() where source_id=native_world_fixture.candidate_doc(91)::text and :'world_case'='delete';
insert into native_world_fixture.mutations values(:'world_case',true);
commit;
\endif
\if :world_contender
begin;
set local transaction isolation level read committed;
select set_config('application_name','native-world-contender-'||:'world_case',true);
-- The private copy alone was assigned 30s at SETUP. No concurrent function DDL is needed;
-- the PUBLIC function retains its bounded 2s timeout unchanged.
do $$
declare result jsonb;msg text;id uuid:='90000000-0000-4000-8000-000000000093';
begin
 if (select case_name from native_world_fixture.control)='changed_replay' then id:='90000000-0000-4000-8000-000000000094';end if;
 begin result:=native_world_fixture.commit(native_world_fixture.request(id));
 exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text;result:=jsonb_build_object('error',msg);end;
 insert into native_world_fixture.outcomes values('contender',result);
end; $$;
commit;
\endif
\if :world_member_inserter
begin;
select set_config('application_name','native-world-member-fk-inserter',true);
-- Seed parent's Source/file/reservation are already present. This reaches the real composite
-- preparation-grant FK with a new document PK; it cannot shortcut to a duplicate-key failure.
insert into public.foundation_native_purpose_members(native_grant_id,intake_approval_id,intake_file_key,document_id,reservation_id,
 source_id,source_version_id,original_representation_id,normalized_representation_id,original_sha256,original_bytes,quarantine_original_key,
 normalized_pdf_key,normalized_pdf_sha256,security_receipt_id,security_object_key,security_object_sha256,security_qualification_id,
 security_attestation_sha256,native_object_key,native_object_sha256,native_bytes)
select native_grant_id,intake_approval_id,'synthetic-file-93',native_world_fixture.candidate_doc(93),'30000000-0000-4000-8000-000000000093',
 native_world_fixture.candidate_doc(93)::text,native_world_fixture.candidate_doc(93)::text||':'||repeat('c',64),
 native_world_fixture.candidate_rep(native_world_fixture.candidate_doc(93)::text||':'||repeat('c',64),'original','quarantine/pilot-candidate/'||native_world_fixture.candidate_doc(93)||'/source'),
 native_world_fixture.candidate_rep(native_world_fixture.candidate_doc(93)::text||':'||repeat('c',64),'normalized','immutable/pilot-candidate/pilot-candidate/'||native_world_fixture.candidate_doc(93)||'/'||repeat('d',64)||'/sanitized.pdf'),
 original_sha256,original_bytes,'quarantine/pilot-candidate/'||native_world_fixture.candidate_doc(93)||'/source',
 'immutable/pilot-candidate/pilot-candidate/'||native_world_fixture.candidate_doc(93)||'/'||repeat('d',64)||'/sanitized.pdf',normalized_pdf_sha256,
 'synthetic-security-93','quarantine/pilot-candidate/'||native_world_fixture.candidate_doc(93)||'/receipt',security_object_sha256,security_qualification_id,
 security_attestation_sha256,'immutable/pilot-candidate/pilot-candidate/'||native_world_fixture.candidate_doc(93)||'/'||repeat('c',64)||'/source.xlsx',native_object_sha256,native_bytes
 from public.foundation_native_purpose_members where document_id=native_world_fixture.candidate_doc(91);
insert into native_world_fixture.mutations values('member_fk',true);
commit;
\endif
\if :world_assert
begin;
select no_plan();
select ok((select observed from native_world_fixture.mutations where case_name=:'world_case'),'holder/inserter actually completed');
select is((select outcome->>'writeStatus' from native_world_fixture.outcomes where actor='contender'),
 'exists','same-work replay contender exists') where :'world_case'='same_replay';
select is((select outcome->>'error' from native_world_fixture.outcomes where actor='contender'),
 'NATIVE_WORLD_REPLAY_CONFLICT','changed-work contender conflicts') where :'world_case'='changed_replay';
select is((select outcome->>'error' from native_world_fixture.outcomes where actor='contender'),
 'NATIVE_WORLD_RESERVATION_EXPIRED','real deadline crossed during deferred verifier wait refuses') where :'world_case'='reservation_expiry';
select ok((select clock_timestamp()>=expires_at from native_world_fixture.expiry_window),'armed real deadline was crossed') where :'world_case'='reservation_expiry';
select ok((select outcome ? 'error' from native_world_fixture.outcomes where actor='contender'),'post-wait revocation/FK full-set refuses')
 where :'world_case' in ('grant_revoke','qualification_revoke','epoch','delete','member_fk');
select is((select count(*)::integer from public.foundation_native_world_commits),
 case when :'world_case' in ('same_replay','changed_replay') then 1 else 0 end,'no partial manifest/ref/replay row');
select ok(not exists(select 1 from public.foundation_native_world_commits where jsonb_array_length(artifact_refs)<>3),'every committed row has exactly three refs');
select ok(strpos(pg_get_functiondef('public.commit_foundation_native_world_reduction_v1(jsonb)'::regprocedure),'prerequisite_review_complete constant boolean := false')>0,'public gate was never changed');
select * from finish();
rollback;
\endif
