-- DRAFT, NOT APPLIED. Metadata only; no issuance, qualification, charging, output binding,
-- replay, artifact or live wiring. Requires the frozen five-file candidate proposal unchanged.
-- Exact job-authorizer source f9221eda0a1eb1d1df578b6ec3aeed9ba187319c was reviewed;
-- it takes NO locks. The transaction remains CLOSED pending independent SQL execution and
-- concurrency review. Source corrections do not authorize removing the gate.
-- READ COMMITTED fresh-command snapshots: https://www.postgresql.org/docs/current/transaction-iso.html
-- Definer confinement: https://supabase.com/docs/guides/database/functions
begin;
create function public.read_foundation_native_purpose_candidate_v1(p_context jsonb,p_grant_id uuid)
returns jsonb language plpgsql volatile security definer
set search_path = '' set lock_timeout = '2s' as $$
declare
  prerequisite_review_complete constant boolean := false;
  ws text; principal uuid; docs text[]; doc text; locked record; n integer;
  allowed boolean; captured jsonb; result jsonb; qualification_snapshot jsonb; grant_snapshot jsonb; decision_time timestamptz;
begin
  -- Fail closed, not a caller boolean. Root must review a SEPARATE gate patch; no activation here.
  if not prerequisite_review_complete then return null; end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed'
    or p_grant_id is null or pg_catalog.jsonb_typeof(p_context) is distinct from 'object'
    or pg_catalog.octet_length(p_context::text) > 8192
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_context)) <> 8
    or not (p_context ?& array['workspaceId','tenantId','principalUserId','jobId','authorizationRevision','collectionId','replayBinding','documentIds'])
    or pg_catalog.jsonb_typeof(p_context->'documentIds') is distinct from 'array'
    then return null; end if;
  if exists(select 1 from pg_catalog.jsonb_each(p_context) e where e.key <> all(array['authorizationRevision','documentIds'])
      and pg_catalog.jsonb_typeof(e.value) <> 'string')
    or p_context->>'workspaceId' !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_context->>'tenantId' is distinct from p_context->>'workspaceId'
    or p_context->>'principalUserId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or p_context->>'jobId' !~ '^cjob-[a-f0-9]{32}$'
    or p_context->>'collectionId' !~ '^collection-[a-f0-9]{32}$'
    or p_context->>'replayBinding' !~ '^native-work-[a-f0-9]{32}$'
    or pg_catalog.jsonb_typeof(p_context->'authorizationRevision') is distinct from 'number'
    or p_context->>'authorizationRevision' !~ '^[1-9][0-9]{0,15}$'
    or (p_context->>'authorizationRevision')::numeric > 9007199254740991
    or pg_catalog.jsonb_array_length(p_context->'documentIds') not between 1 and 16
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_context->'documentIds') e
      where pg_catalog.jsonb_typeof(e.value) <> 'string' or e.value #>> '{}' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
    then return null; end if;
  select pg_catalog.array_agg(value order by value) into docs from pg_catalog.jsonb_array_elements_text(p_context->'documentIds');
  if (select pg_catalog.count(distinct d) from pg_catalog.unnest(docs) d) <> pg_catalog.cardinality(docs) then return null; end if;
  ws := p_context->>'workspaceId'; principal := (p_context->>'principalUserId')::uuid;

  -- Current shared advisory order, BEFORE row locks. Future writers/revokers must follow it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake-approval:' || ws,0));
  -- Canonical multi-document batch pattern: acquire ALL sorted deletion locks first, then
  -- workspace intake and legal hold ONCE. The single-document helper also takes workspace
  -- locks; looping it would invert the second deletion lock against a single-doc deleter.
  foreach doc in array docs loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        'tavonel.source_deletion.v1' || pg_catalog.chr(10) || ws || pg_catalog.chr(10) || doc,'UTF8')),'hex'),0));
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || ws,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || ws,0));
  -- Existing authorizer derives current job/source/ACL policy. False disables connectors; the
  -- native slice has no provider route. Bind the exact reviewed six-argument prerequisite;
  -- another overload/name is insufficient. The direct-upload branch returns before age checks.
  if pg_catalog.to_regprocedure('public.authorize_foundation_compile_job(text,text,text[],text,boolean,integer)') is null then return null; end if;
  execute 'select public.authorize_foundation_compile_job($1::text,$2::text,$3::text[],
    ''before_source_read''::text,false::boolean,null::integer)'
    into allowed using p_context->>'jobId',ws,docs;
  if allowed is distinct from true then return null; end if;
  perform 1 from public.foundation_compile_jobs where job_id=p_context->>'jobId' for share;
  perform 1 from public.sources where source_id=any(docs) order by source_id for share;
  n := 0;
  for locked in select v.source_version_id from public.source_versions v
    where v.source_version_id in (select m.source_version_id from public.foundation_native_purpose_members m where m.native_grant_id=p_grant_id order by m.document_id limit 17)
    order by v.source_version_id limit 17 for share
  loop n:=n+1; if n>16 then return null; end if; end loop;
  n := 0;
  for locked in select r.representation_id from public.source_representations r where r.representation_id in (
    select ids.id from (select original_representation_id,normalized_representation_id from public.foundation_native_purpose_members
      where native_grant_id=p_grant_id order by document_id limit 17) m
    cross join lateral (values(m.original_representation_id),(m.normalized_representation_id)) ids(id))
    order by r.representation_id limit 33 for share
  loop n:=n+1; if n>32 then return null; end if; end loop;
  perform 1 from public.foundation_native_purpose_grants where native_grant_id=p_grant_id for share;
  perform 1 from public.foundation_native_qualification_profiles where qualification_id in (
    select qualification_id from public.foundation_native_purpose_grants where native_grant_id=p_grant_id) for share;
  n := 0;
  for locked in select document_id from public.foundation_native_purpose_members where native_grant_id=p_grant_id
    order by document_id limit 17 for share
  loop n:=n+1; if n>16 then return null; end if; end loop;
  perform 1 from public.foundation_intake_approvals where approval_id in (
    select intake_approval_id from public.foundation_native_purpose_grants where native_grant_id=p_grant_id) for share;
  n := 0;
  for locked in select f.file_key from public.foundation_intake_approval_files f where f.approval_id in (
    select intake_approval_id from public.foundation_native_purpose_grants where native_grant_id=p_grant_id)
    order by f.file_key limit 17 for share
  loop n:=n+1; if n>16 then return null; end if; end loop;
  perform 1 from public.foundation_compute_reservations where reservation_id in (
    select reservation_id from public.foundation_native_purpose_members where native_grant_id=p_grant_id order by document_id limit 17) order by reservation_id for share;
  perform 1 from public.foundation_intake_admissions where workspace_key=ws and document_id::text=any(docs) order by document_id for share;

  -- ONE fresh, NON-LOCKING capture AFTER ALL waits. Count, validate and emit this same full
  -- bounded set. Newly visible/unlocked membership is included, never assumed absent. No
  -- later public-table reads. Transaction locks end at commit, not function return; no lease.
  with g as materialized(select * from public.foundation_native_purpose_grants where native_grant_id=p_grant_id),
    q as materialized(select * from public.foundation_native_qualification_profiles where qualification_id=(select qualification_id from g)),
    a as materialized(select * from public.foundation_intake_approvals where approval_id=(select intake_approval_id from g)),
    m as materialized(select * from public.foundation_native_purpose_members where native_grant_id=p_grant_id order by document_id limit 17),
    f as materialized(select * from public.foundation_intake_approval_files where approval_id=(select intake_approval_id from g) order by file_key limit 17),
    job_row as materialized(select * from public.foundation_compile_jobs where job_id=p_context->>'jobId'),
    -- Mirror nativeCollectionId for document_batch from IMMUTABLE workspace/document IDs,
    -- not job.collection_id (normally NULL until World output). Global logical-key mode is
    -- explicitly unsupported here; never silently derive a batch identity for a global job.
    j as materialized(select job_row.*, 'collection-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'native-v1' || pg_catalog.chr(10) || job_row.workspace_key || pg_catalog.chr(10) ||
      (select pg_catalog.string_agg(d,pg_catalog.chr(10) order by d collate "C") from pg_catalog.unnest(job_row.document_ids) d),
      'UTF8')),'hex'),1,32) as expected_collection_id from job_row),
    current_member as materialized(select workspace_key,user_id,state,authorization_revision from public.foundation_workspace_members
      where workspace_key=ws and user_id=principal),
    joined as materialized(select m.*,r.workspace_key as reservation_ws,r.user_id as reservation_user,r.document_id as reservation_doc,r.state::text as billing_state,
      (r.reservation_id is not null and r.workspace_key=ws and r.user_id=principal and r.document_id=m.document_id
       and r.state::text in ('reserved','settled','released','operator_review','expired')
       and f.file_key=m.intake_file_key and f.document_id=m.document_id and f.reservation_id=m.reservation_id and f.state='confirmed'
       and f.content_sha256=m.original_sha256 and f.byte_length=m.original_bytes
       and f.declared_mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       and s.source_id=m.document_id::text and s.workspace_id=ws and s.tenant_id=ws and s.origin_kind='upload'
       and s.source_family='spreadsheet' and s.tombstoned_at is null
       and v.source_id=s.source_id and v.source_version_id=m.source_version_id and v.content_sha256=m.original_sha256
       and v.byte_length=m.original_bytes and v.immutable_object_key=m.quarantine_original_key
       and v.mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and v.tombstoned=false and v.parent_version_id is null
       and i.user_id=principal and i.object_key=m.quarantine_original_key and i.source_sha256=m.original_sha256
       and i.requested_bytes=m.original_bytes and i.declared_mime_type=v.mime_type and i.confirmed_at is not null and i.state::text not in ('rejected','expired')
       and o.source_version_id=v.source_version_id and o.kind='original' and o.object_key=m.quarantine_original_key
       and o.content_sha256=m.original_sha256 and o.lossy=false and o.derived_from=array[]::text[]
       and p.source_version_id=v.source_version_id and p.kind='normalized' and p.object_key=m.normalized_pdf_key
       and p.content_sha256=m.normalized_pdf_sha256 and p.lossy=true and p.derived_from=array[m.original_representation_id]
       and not exists(select 1 from public.source_deletion_tombstones t where t.workspace_key=ws and t.document_id=m.document_id)
       and not exists(select 1 from public.connector_document_bindings c where c.document_id=m.document_id)
       and m.document_id::text=any(docs) and m.source_id=m.document_id::text
       and m.source_version_id=m.source_id||':'||pg_catalog.substr(m.original_sha256,8)
       and m.quarantine_original_key='quarantine/'||ws||'/'||m.document_id::text||'/source'
       and m.normalized_pdf_key='immutable/'||ws||'/'||ws||'/'||m.document_id::text||'/'||pg_catalog.substr(m.normalized_pdf_sha256,8)||'/sanitized.pdf'
       and m.native_object_key='immutable/'||ws||'/'||ws||'/'||m.document_id::text||'/'||pg_catalog.substr(m.original_sha256,8)||'/source.xlsx'
       and m.native_object_sha256=m.original_sha256 and m.native_bytes=m.original_bytes
       and m.original_representation_id='rep-'||pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(m.source_version_id||pg_catalog.chr(10)||'original'||pg_catalog.chr(10)||m.quarantine_original_key,'UTF8')),'hex'),1,32)
       and m.normalized_representation_id='rep-'||pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(m.source_version_id||pg_catalog.chr(10)||'normalized'||pg_catalog.chr(10)||m.normalized_pdf_key,'UTF8')),'hex'),1,32)
       and m.revoked_at is null and m.binding_state='unbound'
       -- Output-bound snapshots remain closed pending separate SQL canonical-receipt review.
       and m.processing_receipt_id is null and m.signed_processing_receipt is null and m.signed_receipt_sha256 is null
       and m.cir_object_key is null and m.cir_object_sha256 is null and m.cir_canonical_sha256 is null and m.cir_bytes is null and m.bound_at is null) as exact_join
      from m left join f on f.file_key=m.intake_file_key and f.approval_id=m.intake_approval_id
      left join public.foundation_compute_reservations r on r.reservation_id=m.reservation_id
      left join public.sources s on s.source_id=m.source_id left join public.source_versions v on v.source_version_id=m.source_version_id
      left join public.foundation_intake_admissions i on i.workspace_key=ws and i.document_id=m.document_id
      left join public.source_representations o on o.representation_id=m.original_representation_id
      left join public.source_representations p on p.representation_id=m.normalized_representation_id)
  select pg_catalog.jsonb_build_object('valid',
    (select pg_catalog.count(*) from g)=1 and (select pg_catalog.count(*) from q)=1 and (select pg_catalog.count(*) from a)=1
    and (select pg_catalog.count(*) from m)=pg_catalog.cardinality(docs) and (select pg_catalog.count(*) from f)=pg_catalog.cardinality(docs)
    and (select pg_catalog.array_agg(document_id::text order by document_id::text) from m)=docs
    and (select pg_catalog.array_agg(document_id::text order by document_id::text) from f)=docs
    and (select pg_catalog.bool_and(exact_join is true) from joined)
    and (select workspace_key=ws and user_id=principal and state='approved' and scope_digest=(select intake_scope_digest from g)
      and file_count=pg_catalog.cardinality(docs) from a)
    and (select workspace_key=ws and tenant_id=ws and principal_user_id=principal and job_id=p_context->>'jobId'
      and authorization_revision=(p_context->>'authorizationRevision')::bigint and collection_id=p_context->>'collectionId'
      and replay_binding=p_context->>'replayBinding' and purpose='native_artifact_preparation' and state in ('proposed','authorized') and revoked_at is null from g)
    and (select workspace_key=ws and created_by_user_id=principal and state::text not in ('ready','failed','cancelled')
      and authorization_revision=(p_context->>'authorizationRevision')::bigint
      and compilation_mode='document_batch' and expected_collection_id=p_context->>'collectionId'
      and 'native-work-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        job_id || pg_catalog.chr(10) || expected_collection_id,'UTF8')),'hex'),1,32)=p_context->>'replayBinding'
      and exists(select 1 from current_member cm where cm.workspace_key=j.workspace_key and cm.user_id=j.created_by_user_id
        and cm.state='active' and cm.authorization_revision=j.authorization_revision)
      -- Exact current direct-upload authority, captured AFTER waits: no pinned source authority
      -- may appear even when there are no connector bindings. Early helper is point-in-time only.
      and not exists(select 1 from public.foundation_compile_job_source_authority ja where ja.job_id=j.job_id)
      and pg_catalog.cardinality(document_ids)=pg_catalog.cardinality(docs)
      and (select pg_catalog.array_agg(d order by d) from pg_catalog.unnest(j.document_ids) d)=docs from j),
    'qualification',(select pg_catalog.to_jsonb(q) from q), 'grant',(select pg_catalog.to_jsonb(g) from g),
    'members',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantId',native_grant_id,'intakeApprovalId',intake_approval_id,'intakeFileKey',intake_file_key,'reservationId',reservation_id,
      'documentId',document_id,'sourceId',source_id,'sourceVersionId',source_version_id,'originalRepresentationId',original_representation_id,
      'normalizedRepresentationId',normalized_representation_id,'originalSha256',original_sha256,'originalBytes',original_bytes,
      'quarantineOriginalKey',quarantine_original_key,'normalizedPdfKey',normalized_pdf_key,'normalizedPdfSha256',normalized_pdf_sha256,
      'securityReceiptId',security_receipt_id,'securityObjectKey',security_object_key,'securityObjectSha256',security_object_sha256,
      'securityQualificationId',security_qualification_id,'securityAttestationSha256',security_attestation_sha256,
      'nativeObjectKey',native_object_key,'nativeObjectSha256',native_object_sha256,'nativeBytes',native_bytes,'bindingState',binding_state,
      'processingReceiptId',null,'signedProcessingReceipt',null,'signedReceiptSha256',null,'cirObjectKey',null,'cirObjectSha256',null,
      'cirCanonicalSha256',null,'cirBytes',null,'boundAt',null,'revokedAt',null) order by document_id) from joined),'[]'::jsonb),
    'existingAuthority',pg_catalog.jsonb_build_object('approvalState',(select state from a),'approvedDocumentIds',pg_catalog.to_jsonb(docs),
      'reservations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reservationId',reservation_id,'documentId',reservation_doc,
        'workspaceId',reservation_ws,'principalUserId',reservation_user,'billingState',billing_state) order by document_id) from joined),'[]'::jsonb))) into captured;
  if captured->>'valid' is distinct from 'true' then return null; end if;
  qualification_snapshot:=captured->'qualification';grant_snapshot:=captured->'grant';
  -- Trusted clock AFTER waits/capture; all remaining operations are captured JSON only.
  decision_time:=pg_catalog.clock_timestamp();
  if qualification_snapshot->>'state' not in ('unreviewed','reviewed') or qualification_snapshot->>'revoked_at' is not null
    or (qualification_snapshot->>'state'='reviewed' and (qualification_snapshot->>'independent_qualifier_id' is null or qualification_snapshot->>'review_attestation_sha256' is null
      or (qualification_snapshot->>'reviewed_at')::timestamptz > decision_time or (qualification_snapshot->>'valid_from')::timestamptz > decision_time
      or (qualification_snapshot->>'expires_at')::timestamptz <= decision_time))
    or (grant_snapshot->>'state'='authorized' and ((grant_snapshot->>'authorized_at')::timestamptz > decision_time
      or (grant_snapshot->>'valid_from')::timestamptz > decision_time or (grant_snapshot->>'expires_at')::timestamptz <= decision_time)) then return null; end if;
  result:=pg_catalog.jsonb_build_object('schemaVersion','tavonel.native_purpose_authority_candidate.v1','kind','unverified_native_authority_candidate',
    'qualification',pg_catalog.jsonb_build_object('qualificationId',qualification_snapshot->'qualification_id','producerId',qualification_snapshot->'producer_id','producerKeyId',qualification_snapshot->'producer_key_id',
      'producerKeyReference',qualification_snapshot->'producer_key_reference','producerRevision',qualification_snapshot->'producer_revision','callerId',qualification_snapshot->'caller_id','readerRevision',qualification_snapshot->'reader_revision',
      'inputMimeType',qualification_snapshot->'input_mime_type','cirSchemaVersion',qualification_snapshot->'cir_schema_version','nativeParserVersion',qualification_snapshot->'native_parser_version','state',qualification_snapshot->'state',
      'independentQualifierId',qualification_snapshot->'independent_qualifier_id','reviewAttestationSha256',qualification_snapshot->'review_attestation_sha256',
      'reviewedAt',case when qualification_snapshot->>'reviewed_at' is not null then pg_catalog.to_char((qualification_snapshot->>'reviewed_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'validFrom',case when qualification_snapshot->>'valid_from' is not null then pg_catalog.to_char((qualification_snapshot->>'valid_from')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'expiresAt',case when qualification_snapshot->>'expires_at' is not null then pg_catalog.to_char((qualification_snapshot->>'expires_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'revokedAt',null),
    'grant',pg_catalog.jsonb_build_object('grantId',grant_snapshot->'native_grant_id','intakeApprovalId',grant_snapshot->'intake_approval_id','intakeScopeDigest',grant_snapshot->'intake_scope_digest',
      'qualificationId',grant_snapshot->'qualification_id','workspaceId',grant_snapshot->'workspace_key','tenantId',grant_snapshot->'tenant_id','principalUserId',grant_snapshot->'principal_user_id',
      'jobId',grant_snapshot->'job_id','authorizationRevision',grant_snapshot->'authorization_revision','collectionId',grant_snapshot->'collection_id','replayBinding',grant_snapshot->'replay_binding','purpose',grant_snapshot->'purpose',
      'state',grant_snapshot->'state','nativeAuthorizationIssuerId',grant_snapshot->'native_authorization_issuer_id','nativeAuthorizationPolicySha256',grant_snapshot->'native_authorization_policy_sha256',
      'nativeAuthorizationEvidenceSha256',grant_snapshot->'native_authorization_evidence_sha256',
      'authorizedAt',case when grant_snapshot->>'authorized_at' is not null then pg_catalog.to_char((grant_snapshot->>'authorized_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'validFrom',case when grant_snapshot->>'valid_from' is not null then pg_catalog.to_char((grant_snapshot->>'valid_from')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'expiresAt',case when grant_snapshot->>'expires_at' is not null then pg_catalog.to_char((grant_snapshot->>'expires_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'revokedAt',null),
    'members',captured->'members','existingAuthority',captured->'existingAuthority');
  if pg_catalog.octet_length(result::text)>262144 then return null; end if;
  return result; -- UNVERIFIED, never processing permission or a billing decision.
exception when others then return null; -- Includes lock timeout, absent prerequisites and malformed casts.
end;
$$;
revoke all on function public.read_foundation_native_purpose_candidate_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_foundation_native_purpose_candidate_v1(jsonb,uuid) to service_role;
commit;
