-- DEFAULT-OFF DRAFT. Not a migration. No issuer, seeds, privileges or application routing.
-- Base Foundation 629b7b84fa8fe5e6db9eaa010a941ba42c447a08. Core 92d899 unchanged.
begin;
create table public.foundation_native_world_grants (
  grant_id uuid primary key,
  preparation_grant_id uuid not null references public.foundation_native_purpose_grants(native_grant_id) on delete restrict,
  reduction_job_id text not null references public.foundation_compile_jobs(job_id) on delete restrict,
  workspace_key text not null check(workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  principal_user_id uuid not null references auth.users(id) on delete restrict,
  authorization_revision bigint not null check(authorization_revision between 1 and 9007199254740991),
  purpose text not null default 'native_world_reduction' check(purpose='native_world_reduction'),
  claims_wire text not null check(octet_length(claims_wire) between 1 and 32768),
  claims jsonb not null check(jsonb_typeof(claims)='object' and claims_wire::jsonb=claims),
  issuer_signature text not null check(issuer_signature ~ '^sha256:[a-f0-9]{64}$'),
  state text not null default 'proposed' check(state in ('proposed','authorized','revoked')),
  issued_at timestamptz not null check(isfinite(issued_at)),
  expires_at timestamptz not null check(isfinite(expires_at) and expires_at>issued_at),
  revoked_at timestamptz check(isfinite(revoked_at)),
  check((state='revoked')=(revoked_at is not null)),
  check(claims->>'purpose'='native_world_reduction' and claims->>'grantId'=grant_id::text
    and claims->>'preparationGrantId'=preparation_grant_id::text and grant_id<>preparation_grant_id
    and claims->>'jobId'=reduction_job_id and claims->>'preparationJobId'<>reduction_job_id
    and claims->>'workspaceId'=workspace_key and claims->>'tenantId'=workspace_key
    and claims->>'principalUserId'=principal_user_id::text
    and (claims->>'authorizationRevision')::bigint=authorization_revision)
);
create table public.foundation_native_world_commits (
  grant_id uuid not null references public.foundation_native_world_grants(grant_id) on delete restrict,
  workspace_key text not null,
  reduction_job_id text not null,
  world_replay_binding text not null check(world_replay_binding ~ '^native-world-work-[a-f0-9]{32}$'),
  input_work_sha256 text not null check(input_work_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  output_binding_sha256 text not null check(output_binding_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  world_state_id text not null check(world_state_id ~ '^native_refs_ws_[a-f0-9]{64}$'),
  manifest_wire text not null check(octet_length(manifest_wire) between 1 and 32768),
  manifest_raw_sha256 text not null check(manifest_raw_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  artifact_refs jsonb not null check(jsonb_typeof(artifact_refs)='array' and jsonb_array_length(artifact_refs)=3),
  commit_request jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(workspace_key,reduction_job_id,world_replay_binding),
  unique(grant_id),
  check(manifest_raw_sha256='sha256:'||encode(sha256(convert_to(manifest_wire,'UTF8')),'hex'))
);
alter table public.foundation_native_world_grants enable row level security;
alter table public.foundation_native_world_commits enable row level security;
revoke all on public.foundation_native_world_grants,public.foundation_native_world_commits from public,anon,authenticated,service_role;

create function public.guard_foundation_native_world_v1() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='foundation_native_world_grants' and tg_op='UPDATE'
    and (to_jsonb(new)-'state'-'revoked_at')=(to_jsonb(old)-'state'-'revoked_at')
    and old.state in ('proposed','authorized') and new.state='revoked' and new.revoked_at is not null then return new; end if;
  raise exception 'NATIVE_WORLD_IMMUTABLE';
end; $$;
create trigger foundation_native_world_grant_immutable before update or delete on public.foundation_native_world_grants
for each row execute function public.guard_foundation_native_world_v1();
create trigger foundation_native_world_commit_immutable before update or delete on public.foundation_native_world_commits
for each row execute function public.guard_foundation_native_world_v1();
revoke all on function public.guard_foundation_native_world_v1() from public,anon,authenticated,service_role;

-- Typed commit/claim headers ONLY. Never JSONB-reserialize CIR, facts, model or signed receipts.
-- ASCII schema keys, UTF-8 JSON string escaping, safe integer numbers; no floating point.
create function public.native_world_header_wire_v1(v jsonb) returns text
language plpgsql immutable strict set search_path='' as $$
declare result text;
begin
  if octet_length(v::text)>65536 then raise exception 'NATIVE_WORLD_HEADER_TOO_LARGE'; end if;
  case jsonb_typeof(v)
  when 'object' then
    if exists(select 1 from jsonb_object_keys(v) k where k !~ '^[A-Za-z][A-Za-z0-9]*$') then raise exception 'NATIVE_WORLD_HEADER_KEY'; end if;
    select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.native_world_header_wire_v1(value),',' order by key collate "C"),'')||'}'
      into result from jsonb_each(v);
  when 'array' then
    select '['||coalesce(string_agg(public.native_world_header_wire_v1(value),',' order by ord),'')||']'
      into result from jsonb_array_elements(v) with ordinality a(value,ord);
  when 'number' then
    if v::text !~ '^-?(0|[1-9][0-9]{0,15})$' or abs((v::text)::numeric)>9007199254740991 then raise exception 'NATIVE_WORLD_HEADER_NUMBER'; end if;
    result:=v::text;
  else result:=v::text;
  end case;
  return result;
end; $$;
revoke all on function public.native_world_header_wire_v1(jsonb) from public,anon,authenticated,service_role;

create function public.commit_foundation_native_world_reduction_v1(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare
  prerequisite_review_complete constant boolean := false;
  p_context jsonb; ws text; principal uuid; docs text[]; doc text; locked record; n integer;
  w public.foundation_native_world_grants%rowtype; prep_id uuid; gid uuid;
  captured jsonb; qualification_snapshot jsonb; grant_snapshot jsonb; decision_time timestamptz;
  manifest jsonb; ref jsonb; s jsonb; m jsonb; expected text; input_digest text; output_digest text;
  prior public.foundation_native_world_commits%rowtype; did_insert boolean; allowed boolean;
  version_key text; claim_fields text[]:=array['schemaVersion','purpose','grantId','issuerId','issuerKeyId','callerId','policySha256','evidenceSha256',
    'tenantId','workspaceId','principalUserId','jobId','authorizationRevision','collectionId','preparationGrantId','preparationJobId','preparationReplayBinding',
    'worldReplayBinding','canonicalRequestSha256','coreReleaseDigest','projectionVersion','sources','inputArtifacts','issuedAt','expiresAt'];
begin
  if not prerequisite_review_complete then raise exception 'NATIVE_WORLD_REDUCTION_DISABLED'; end if;
  if current_setting('transaction_isolation')<>'read committed' or jsonb_typeof(p_request) is distinct from 'object'
    or octet_length(p_request::text)>131072 or (select count(*) from jsonb_object_keys(p_request))<>9
    or not(p_request ?& array['schemaVersion','context','grantId','worldReplayBinding','inputWorkSha256','outputBindingSha256','manifestWire','manifestRawSha256','artifactRefs'])
    or p_request->>'schemaVersion'<>'tavonel.native_world_reduction_commit.v1'
    or jsonb_typeof(p_request->'context') is distinct from 'object'
    or jsonb_typeof(p_request->'artifactRefs') is distinct from 'array'
    or exists(select 1 from jsonb_each(p_request) e where e.key<>all(array['context','artifactRefs']) and jsonb_typeof(e.value)<>'string')
    then raise exception 'NATIVE_WORLD_REQUEST_INVALID'; end if;
  p_context:=p_request->'context';
  if (select count(*) from jsonb_object_keys(p_context))<>7 or not(p_context ?& array['workspaceId','tenantId','principalUserId','jobId','authorizationRevision','collectionId','documentIds'])
    or p_context->>'workspaceId' !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_context->>'tenantId' is distinct from p_context->>'workspaceId'
    or p_context->>'principalUserId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or p_context->>'jobId' !~ '^cjob-[a-f0-9]{32}$' or p_context->>'collectionId' !~ '^collection-[a-f0-9]{32}$'
    or jsonb_typeof(p_context->'authorizationRevision') is distinct from 'number'
    or p_context->>'authorizationRevision' !~ '^[1-9][0-9]{0,15}$' or (p_context->>'authorizationRevision')::numeric>9007199254740991
    or jsonb_typeof(p_context->'documentIds') is distinct from 'array'
    or exists(select 1 from jsonb_each(p_context) e where e.key<>all(array['authorizationRevision','documentIds']) and jsonb_typeof(e.value)<>'string')
    then raise exception 'NATIVE_WORLD_CONTEXT_INVALID'; end if;
  if jsonb_array_length(p_context->'documentIds') not between 1 and 16
    or exists(select 1 from jsonb_array_elements(p_context->'documentIds') e where jsonb_typeof(e.value)<>'string'
      or e.value #>> '{}' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then raise exception 'NATIVE_WORLD_CONTEXT_INVALID'; end if;
  select array_agg(value order by value collate "C") into docs from jsonb_array_elements_text(p_context->'documentIds');
  if (select count(distinct d) from unnest(docs) d)<>cardinality(docs) or p_context->'documentIds'<>to_jsonb(docs) then raise exception 'NATIVE_WORLD_CONTEXT_INVALID'; end if;
  ws:=p_context->>'workspaceId';principal:=(p_context->>'principalUserId')::uuid;gid:=(p_request->>'grantId')::uuid;

  -- Existing canonical order: approval workspace, ALL sorted deletions, intake, legal hold.
  perform pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:'||ws,0));
  foreach doc in array docs loop
    perform pg_advisory_xact_lock(hashtextextended('sha256:'||encode(sha256(convert_to(
      'tavonel.source_deletion.v1'||chr(10)||ws||chr(10)||doc,'UTF8')),'hex'),0));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('foundation-intake:'||ws,0));
  perform pg_advisory_xact_lock(hashtextextended('tavonel.source_legal_hold.v1'||chr(10)||ws,0));
  perform 1 from public.foundation_workspace_members where workspace_key=ws and user_id=principal for update;
  perform 1 from public.foundation_compile_jobs where job_id=p_context->>'jobId' for update;
  perform 1 from public.sources where source_id=any(docs) order by source_id for update;
  -- Lock world parent, then preparation parent before enumerating members. FOR UPDATE blocks
  -- FK KEY SHARE inserts; FOR SHARE would not. Protocol/race qualification remains UNRUN.
  select * into w from public.foundation_native_world_grants where grant_id=gid for update;
  if not found then raise exception 'NATIVE_WORLD_AUTHORITY_REQUIRED'; end if;
  prep_id:=w.preparation_grant_id;
  perform 1 from public.foundation_native_purpose_grants where native_grant_id=prep_id for update;
  perform 1 from public.foundation_native_qualification_profiles where qualification_id in
    (select qualification_id from public.foundation_native_purpose_grants where native_grant_id=prep_id) for update;
  perform 1 from public.foundation_intake_approvals where approval_id in
    (select intake_approval_id from public.foundation_native_purpose_grants where native_grant_id=prep_id) for update;
  n:=0;
  for locked in select * from public.foundation_native_purpose_members where native_grant_id=prep_id order by document_id limit 17 for update loop
    n:=n+1;if n>16 then raise exception 'NATIVE_WORLD_SCOPE_INVALID';end if;
  end loop;
  perform 1 from public.source_versions where source_version_id in
    (select source_version_id from public.foundation_native_purpose_members where native_grant_id=prep_id) order by source_version_id for update;
  for version_key in select source_version_id from public.foundation_native_purpose_members where native_grant_id=prep_id order by source_version_id loop
    n:=0;
    for locked in select representation_id,cardinality(derived_from) as parents from public.source_representations
      where source_version_id=version_key order by representation_id limit 129 for update loop
      n:=n+1;if n>128 or locked.parents>32 then raise exception 'NATIVE_WORLD_LEDGER_TOO_LARGE';end if;
    end loop;
  end loop;
  perform 1 from public.foundation_intake_approval_files where approval_id in
    (select intake_approval_id from public.foundation_native_purpose_grants where native_grant_id=prep_id) order by file_key for update;
  perform 1 from public.foundation_compute_reservations where reservation_id in
    (select reservation_id from public.foundation_native_purpose_members where native_grant_id=prep_id) order by reservation_id for update;
  perform 1 from public.foundation_intake_admissions where workspace_key=ws and document_id::text=any(docs) order by document_id for update;
  -- Fresh authorizer is for the NEW reduction job; terminal preparation jobs cannot authorize it.
  if to_regprocedure('public.authorize_foundation_compile_job(text,text,text[],text,boolean,integer)') is null then raise exception 'NATIVE_WORLD_JOB_AUTHORIZER_REQUIRED'; end if;
  execute 'select public.authorize_foundation_compile_job($1::text,$2::text,$3::text[],''before_source_read''::text,false::boolean,null::integer)'
    into allowed using p_context->>'jobId',ws,docs;
  if allowed is distinct from true then raise exception 'NATIVE_WORLD_JOB_UNAUTHORIZED'; end if;
  -- WORLD_CAPTURE_AFTER_WAITS: one fresh command, full bounded set, no stale pre-wait rows.
  with g as materialized(select * from public.foundation_native_purpose_grants where native_grant_id=prep_id),
    q as materialized(select * from public.foundation_native_qualification_profiles where qualification_id=(select qualification_id from g)),
    a as materialized(select * from public.foundation_intake_approvals where approval_id=(select intake_approval_id from g)),
    m as materialized(select * from public.foundation_native_purpose_members where native_grant_id=prep_id order by document_id limit 17),
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
      r.expires_at as reservation_expires_at,
      (r.reservation_id is not null and r.workspace_key=ws and r.user_id=principal and r.document_id=m.document_id
       -- Failed/review, released and expired settlement states refuse this World slice.
       and r.state::text in ('reserved','settled')
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
       and m.revoked_at is null and m.binding_state='bound'
       and m.processing_receipt_id is not null and m.signed_processing_receipt is not null
       and m.signed_receipt_sha256 is not null and m.cir_object_key is not null and m.cir_object_sha256 is not null
       and m.cir_canonical_sha256 is not null and m.cir_bytes between 1 and 8388608 and m.bound_at is not null) as exact_join
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
    and (select workspace_key=ws and tenant_id=ws and principal_user_id=principal and job_id=w.claims->>'preparationJobId'
      and authorization_revision=(p_context->>'authorizationRevision')::bigint and collection_id=p_context->>'collectionId'
      and replay_binding=w.claims->>'preparationReplayBinding' and purpose='native_artifact_preparation' and state='authorized' and revoked_at is null from g)
    and (select workspace_key=ws and created_by_user_id=principal and state::text not in ('ready','failed','cancelled')
      and authorization_revision=(p_context->>'authorizationRevision')::bigint
      and compilation_mode='document_batch' and expected_collection_id=p_context->>'collectionId'
      and exists(select 1 from current_member cm where cm.workspace_key=j.workspace_key and cm.user_id=j.created_by_user_id
        and cm.state='active' and cm.authorization_revision=j.authorization_revision)
      -- Exact current direct-upload authority, captured AFTER waits: no pinned source authority
      -- may appear even when there are no connector bindings. Early helper is point-in-time only.
      and not exists(select 1 from public.foundation_compile_job_source_authority ja where ja.job_id=j.job_id)
      and pg_catalog.cardinality(document_ids)=pg_catalog.cardinality(docs)
      and (select pg_catalog.array_agg(d order by d) from pg_catalog.unnest(j.document_ids) d)=docs from j),
    'qualification',(select pg_catalog.to_jsonb(q) from q), 'grant',(select pg_catalog.to_jsonb(g) from g),
    'worldGrant',to_jsonb(w),
    'reductionJob',(select jsonb_build_object('jobId',job_id,'workspaceId',workspace_key,'principalUserId',created_by_user_id,
      'authorizationRevision',authorization_revision,'documentIds',document_ids,'state',state,'compilationMode',compilation_mode) from j),
    'currentMember',(select to_jsonb(current_member) from current_member),
    'intakeApproval',(select to_jsonb(a) from a),
    'members',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(joined) order by document_id) from joined),'[]'::jsonb),
    'sourceLedgers',coalesce((select jsonb_agg(jsonb_build_object(
      'documentId',m.document_id,'source',jsonb_build_object('sourceId',s.source_id,'tenantId',s.tenant_id,'workspaceId',s.workspace_id,
        'originKind',s.origin_kind,'originProvider',s.origin_provider,'sourceFamily',s.source_family,'createdAt',s.created_at,
        'tombstoned',s.tombstoned_at is not null),
      'version',jsonb_build_object('sourceVersionId',v.source_version_id,'sourceId',v.source_id,'immutableObjectKey',v.immutable_object_key,
        'contentSha256',v.content_sha256,'byteLength',v.byte_length,'mimeType',v.mime_type,'sourceModifiedAt',v.source_modified_at,
        'observedAt',v.observed_at,'parentVersionId',v.parent_version_id,'tombstoned',v.tombstoned,'securityClassification',v.security_classification),
      'representations',(select jsonb_agg(jsonb_build_object('representationId',b.representation_id,'sourceVersionId',b.source_version_id,
        'kind',b.kind,'providerId',b.provider_id,'providerRevision',b.provider_revision,'contentSha256',b.content_sha256,'objectKey',b.object_key,
        'lossy',b.lossy,'createdAt',b.created_at,'derivedFrom',case when cardinality(b.derived_from)<=32 then to_jsonb(b.derived_from) else 'null'::jsonb end)
        order by b.representation_id) from (select * from public.source_representations where source_version_id=m.source_version_id
          order by representation_id limit 129) b)) order by m.document_id)
      from m left join public.sources s on s.source_id=m.source_id left join public.source_versions v on v.source_version_id=m.source_version_id),'[]'::jsonb),
    'existingAuthority',pg_catalog.jsonb_build_object('approvalState',(select state from a),'approvedDocumentIds',pg_catalog.to_jsonb(docs),
      'reservations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reservationId',reservation_id,'documentId',reservation_doc,
        'workspaceId',reservation_ws,'principalUserId',reservation_user,'billingState',billing_state,
        'reservationExpiresAt',reservation_expires_at) order by document_id) from joined),'[]'::jsonb))) into captured;
  if captured->>'valid' is distinct from 'true' then raise exception 'NATIVE_WORLD_CURRENT_SCOPE_INVALID'; end if;
  if octet_length(captured::text)>262144 then raise exception 'NATIVE_WORLD_CAPTURE_TOO_LARGE';end if;
  if (select count(*) from jsonb_object_keys(w.claims))<>cardinality(claim_fields) or not(w.claims ?& claim_fields)
    or exists(select 1 from jsonb_each(w.claims) e where e.key<>all(array['authorizationRevision','sources','inputArtifacts']) and jsonb_typeof(e.value)<>'string')
    or jsonb_typeof(w.claims->'sources') is distinct from 'array' or jsonb_typeof(w.claims->'inputArtifacts') is distinct from 'array'
    or w.claims->>'worldReplayBinding' !~ '^native-world-work-[a-f0-9]{32}$'
    or w.claims->>'preparationReplayBinding' !~ '^native-work-[a-f0-9]{32}$'
    or w.claims->>'issuedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$'
    or w.claims->>'expiresAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$'
    then raise exception 'NATIVE_WORLD_AUTHORITY_SHAPE_INVALID';end if;
  qualification_snapshot:=captured->'qualification';grant_snapshot:=captured->'grant';
  if w.state<>'authorized' or w.revoked_at is not null or w.workspace_key<>ws or w.principal_user_id<>principal
    or w.reduction_job_id<>p_context->>'jobId' or w.authorization_revision<>(p_context->>'authorizationRevision')::bigint
    or w.claims->>'schemaVersion'<>'tavonel.native_world_reduction_authority.v1'
    or w.claims->>'purpose'<>'native_world_reduction' or w.claims->>'preparationJobId'<>grant_snapshot->>'job_id'
    or w.claims->>'collectionId'<>p_context->>'collectionId' or w.claims->>'worldReplayBinding'<>p_request->>'worldReplayBinding'
    or w.claims->>'projectionVersion'<>'tavonel.native_cell_observation_world.refs.v1'
    or w.claims_wire<>public.native_world_header_wire_v1(w.claims) then raise exception 'NATIVE_WORLD_AUTHORITY_BINDING_INVALID'; end if;
  if jsonb_array_length(w.claims->'sources')<>cardinality(docs) then raise exception 'NATIVE_WORLD_SOURCE_IDENTITY_INVALID'; end if;
  for s in select value from jsonb_array_elements(w.claims->'sources') loop
    if jsonb_typeof(s)<>'object' or (select count(*) from jsonb_object_keys(s))<>6
      or not(s ?& array['nativeId','sourceId','sourceVersionId','contentSha256','cirSha256','processingReceiptId'])
      or exists(select 1 from jsonb_each(s) e where jsonb_typeof(e.value)<>'string') then raise exception 'NATIVE_WORLD_SOURCE_SHAPE_INVALID';end if;
    select value into m from jsonb_array_elements(captured->'members') where value->>'document_id'=s->>'nativeId';
    expected:='src_'||encode(sha256(convert_to('akc.identity.v1'||chr(30)||'src'||chr(30)||
      length(ws)||':'||ws||chr(31)||'13:foundation-r2'||chr(31)||length(s->>'nativeId')||':'||(s->>'nativeId'),'UTF8')),'hex');
    if m is null or s->>'contentSha256' is distinct from m->>'original_sha256' or s->>'cirSha256' is distinct from m->>'cir_canonical_sha256'
      or s->>'processingReceiptId' is distinct from m->>'processing_receipt_id' or s->>'sourceId' is distinct from expected
      or s->>'sourceVersionId' is distinct from 'dv_'||encode(sha256(convert_to('akc.identity.v1'||chr(30)||'dv'||chr(30)||
        length(expected)||':'||expected||chr(31)||length(s->>'contentSha256')||':'||(s->>'contentSha256'),'UTF8')),'hex') then raise exception 'NATIVE_WORLD_SOURCE_IDENTITY_INVALID'; end if;
  end loop;
  if (select array_agg(value->>'nativeId' order by value->>'nativeId') from jsonb_array_elements(w.claims->'sources'))<>docs then raise exception 'NATIVE_WORLD_SOURCE_SET_INVALID'; end if;
  if jsonb_typeof(p_request->'manifestWire')<>'string' or octet_length(p_request->>'manifestWire') not between 1 and 32768
    or right(p_request->>'manifestWire',1)<>chr(10) then raise exception 'NATIVE_WORLD_MANIFEST_INVALID'; end if;
  manifest:=(p_request->>'manifestWire')::jsonb;
  if jsonb_typeof(manifest)<>'object' or (select count(*) from jsonb_object_keys(manifest))<>21
    or not(manifest ?& array['schemaVersion','projectionVersion','kind','operationClass','status','approvalStatus','candidatePromotion','signatureStatus',
      'tenantId','workspaceId','collectionId','coreReleaseDigest','canonicalRequestSha256','worldStateId','manifestDigest','sources','artifacts','cellCount',
      'knowledgeObjectCount','validation','reviewReasons'])
    or exists(select 1 from jsonb_each(manifest) e where e.key<>all(array['candidatePromotion','sources','artifacts','cellCount','knowledgeObjectCount','validation','reviewReasons'])
      and jsonb_typeof(e.value)<>'string') or jsonb_typeof(manifest->'artifacts') is distinct from 'array'
    then raise exception 'NATIVE_WORLD_MANIFEST_INVALID';end if;
  if manifest->>'schemaVersion'<>'tavonel.product_core.native_world_artifact_manifest.v1'
    or manifest->>'projectionVersion' is distinct from w.claims->>'projectionVersion'
    or manifest->>'tenantId' is distinct from ws or manifest->>'workspaceId' is distinct from ws
    or manifest->>'collectionId' is distinct from p_context->>'collectionId'
    or manifest->>'canonicalRequestSha256' is distinct from w.claims->>'canonicalRequestSha256'
    or manifest->>'coreReleaseDigest' is distinct from w.claims->>'coreReleaseDigest'
    or manifest->'sources' is distinct from w.claims->'sources'
    or manifest->>'operationClass'<>'initial_compile' or manifest->>'status'<>'review_required' or manifest->>'approvalStatus'<>'unbound'
    or manifest->'candidatePromotion' is distinct from 'false'::jsonb or manifest->>'signatureStatus'<>'external_signer_required'
    or p_request->>'manifestRawSha256' is distinct from 'sha256:'||encode(sha256(convert_to(p_request->>'manifestWire','UTF8')),'hex')
    or jsonb_array_length(p_request->'artifactRefs')<>3 or jsonb_array_length(manifest->'artifacts')<>3
    or jsonb_array_length(w.claims->'inputArtifacts')<>2 then raise exception 'NATIVE_WORLD_MANIFEST_BINDING_INVALID'; end if;
  for n in 0..2 loop
    ref:=p_request->'artifactRefs'->n;
    expected:=(array['native_facts','full_cir_package','canonical_knowledge_model'])[n+1];
    if jsonb_typeof(ref)<>'object' or (select count(*) from jsonb_object_keys(ref))<>6
      or not(ref ?& array['artifactId','kind','mediaType','byteLength','sha256','objectKey'])
      or ref->>'kind'<>expected or ref->>'mediaType'<>'application/json'
      or exists(select 1 from jsonb_each(ref) e where e.key<>'byteLength' and jsonb_typeof(e.value)<>'string')
      or ref->>'sha256' !~ '^sha256:[a-f0-9]{64}$' or ref->>'artifactId'<>expected||'_'||substr(ref->>'sha256',8)
      or jsonb_typeof(ref->'byteLength')<>'number' or ref->>'byteLength' !~ '^[1-9][0-9]{0,7}$'
      or (ref->>'byteLength')::bigint>33554432 or (ref-'objectKey') is distinct from manifest->'artifacts'->n
      then raise exception 'NATIVE_WORLD_ARTIFACT_INVALID'; end if;
    if n<2 then
      if ref is distinct from w.claims->'inputArtifacts'->n
        or ref->>'objectKey'<>'immutable/'||ws||'/'||ws||'/native-preparations/nprep_'||substr(w.claims->>'canonicalRequestSha256',8)||'/'||substr(ref->>'sha256',8)||'/'||expected||'.json'
        then raise exception 'NATIVE_WORLD_INPUT_REFERENCE_INVALID';end if;
    elsif ref->>'objectKey'<>'immutable/'||ws||'/'||ws||'/native-world-reductions/'||(manifest->>'worldStateId')||'/'||substr(ref->>'sha256',8)||'/'||expected||'.json'
      then raise exception 'NATIVE_WORLD_MODEL_REFERENCE_INVALID'; end if;
  end loop;
  input_digest:='sha256:'||encode(sha256(convert_to('tavonel.native_world_reduction_commit.v1'||chr(10)||public.native_world_header_wire_v1(jsonb_build_object(
    'purpose','native_world_reduction','context',p_context,'grantId',gid::text,'worldReplayBinding',w.claims->'worldReplayBinding',
    'canonicalRequestSha256',w.claims->'canonicalRequestSha256','sources',w.claims->'sources','inputArtifacts',w.claims->'inputArtifacts',
    'coreReleaseDigest',w.claims->'coreReleaseDigest','projectionVersion',w.claims->'projectionVersion')),'UTF8')),'hex');
  output_digest:='sha256:'||encode(sha256(convert_to('tavonel.native_world_reduction_commit.v1'||chr(10)||public.native_world_header_wire_v1(jsonb_build_object(
    'manifestRawSha256',p_request->'manifestRawSha256','artifactRefs',p_request->'artifactRefs')),'UTF8')),'hex');
  if p_request->>'inputWorkSha256' is distinct from input_digest or p_request->>'outputBindingSha256' is distinct from output_digest then raise exception 'NATIVE_WORLD_WORK_BINDING_INVALID'; end if;
  -- REQUIRED MISSING PREREQUISITE: void/throwing trusted verifier, NOT a client boolean.
  -- It authenticates the issuer/key, policy/evidence, bound producer + security receipts,
  -- independent qualification and actual Core three-blob reprojection against this capture.
  -- No implementation/issuance is supplied; absence keeps even a private gate-open copy closed.
  if to_regprocedure('public.verify_foundation_native_world_commit_v1(text,text,jsonb,jsonb)') is null then raise exception 'NATIVE_WORLD_TRUSTED_VERIFIER_REQUIRED'; end if;
  execute 'select public.verify_foundation_native_world_commit_v1($1::text,$2::text,$3::jsonb,$4::jsonb)' using w.claims_wire,w.issuer_signature,captured,p_request;
  -- Decision clock AFTER all waits and verification. Captured JSON only below; no later grants.
  decision_time:=clock_timestamp();
  -- Match assert_foundation_intake_compile_set at THIS final clock: a reserved pin
  -- must not have reached its deadline, even if it was valid before the verifier wait.
  -- Settled pins retain the existing policy: their historical expiry does not refuse.
  for m in select value from jsonb_array_elements(captured->'existingAuthority'->'reservations') loop
    if m->>'billingState'='reserved' and
      (jsonb_typeof(m->'reservationExpiresAt') is distinct from 'string'
       or (m->>'reservationExpiresAt')::timestamptz<=decision_time)
      then raise exception 'NATIVE_WORLD_RESERVATION_EXPIRED'; end if;
  end loop;
  if w.issued_at>decision_time or w.expires_at<=decision_time
    or (w.claims->>'issuedAt')::timestamptz is distinct from w.issued_at or (w.claims->>'expiresAt')::timestamptz is distinct from w.expires_at
    or qualification_snapshot->>'state'<>'reviewed' or qualification_snapshot->>'revoked_at' is not null
    or qualification_snapshot->>'independent_qualifier_id' is null or qualification_snapshot->>'review_attestation_sha256' is null
    or (qualification_snapshot->>'reviewed_at')::timestamptz>decision_time or (qualification_snapshot->>'valid_from')::timestamptz>decision_time
    or (qualification_snapshot->>'expires_at')::timestamptz<=decision_time
    or grant_snapshot->>'state'<>'authorized' or grant_snapshot->>'revoked_at' is not null
    or (grant_snapshot->>'authorized_at')::timestamptz>decision_time or (grant_snapshot->>'valid_from')::timestamptz>decision_time
    or (grant_snapshot->>'expires_at')::timestamptz<=decision_time then raise exception 'NATIVE_WORLD_CURRENT_AUTHORITY_INVALID'; end if;
  -- WORLD_INSERT_ATOMIC: one immutable row holds raw manifest + EXACT three refs + both bindings.
  insert into public.foundation_native_world_commits(grant_id,workspace_key,reduction_job_id,world_replay_binding,input_work_sha256,
    output_binding_sha256,world_state_id,manifest_wire,manifest_raw_sha256,artifact_refs,commit_request)
  values(gid,ws,p_context->>'jobId',p_request->>'worldReplayBinding',input_digest,output_digest,manifest->>'worldStateId',
    p_request->>'manifestWire',p_request->>'manifestRawSha256',p_request->'artifactRefs',p_request)
  on conflict do nothing returning true into did_insert;
  select * into prior from public.foundation_native_world_commits where workspace_key=ws and reduction_job_id=p_context->>'jobId'
    and world_replay_binding=p_request->>'worldReplayBinding';
  if not found or prior.commit_request is distinct from p_request then raise exception 'NATIVE_WORLD_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schemaVersion','tavonel.native_world_reduction_commit.v1','writeStatus',case when did_insert then 'written' else 'exists' end,
    'worldStateId',prior.world_state_id,'manifestRawSha256',prior.manifest_raw_sha256,'artifactRefs',prior.artifact_refs);
end; $$;
revoke all on function public.commit_foundation_native_world_reduction_v1(jsonb) from public,anon,authenticated,service_role;
commit;
