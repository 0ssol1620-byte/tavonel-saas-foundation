-- ADDITIVE DRAFT ONLY. Outside supabase/migrations; do not apply automatically.
-- No qualifications are seeded. Both application producers/readers default off.
-- Requires independently reviewed immutable endpoint qualification and existing original /
-- normalized source ledger lineage. Missing historical provenance is never backfilled.
begin;

create table public.foundation_completed_read_qualifications (
  binding_sha256 text primary key check (binding_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  endpoint text not null check (endpoint ~ '^https://[^[:space:]"\\?#@]+$' and length(endpoint) <= 512),
  reader_revision text not null check (reader_revision ~ '^sha256:[a-f0-9]{64}$'),
  qualification_sha256 text not null check (qualification_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  -- Review must independently attest endpoint immutability, image digest and reader behavior.
  -- An environment variable, health string, mutable tag or URL name cannot establish this fact.
  immutable_endpoint_verified boolean not null check (immutable_endpoint_verified),
  qualified_at timestamptz not null,
  revoked_at timestamptz,
  check (binding_sha256 = 'sha256:' || encode(sha256(convert_to(
    '["tavonel.qualified_reader_binding.v1",' || to_jsonb(endpoint)::text || ','
    || to_jsonb(reader_revision)::text || ',' || to_jsonb(qualification_sha256)::text || ']', 'UTF8')), 'hex'))
);

create table public.foundation_completed_read_proofs (
  reservation_id uuid primary key references public.foundation_compute_reservations(reservation_id) on delete restrict,
  workspace_key text not null,
  document_id uuid not null,
  source_version_id text not null references public.source_versions(source_version_id) on delete restrict,
  original_representation_id text not null references public.source_representations(representation_id) on delete restrict,
  normalized_representation_id text not null references public.source_representations(representation_id) on delete restrict,
  ocr_representation_id text not null references public.source_representations(representation_id) on delete restrict,
  facts jsonb not null,
  billing_source text not null check (billing_source in ('owner','trial','paid')),
  settled_credits integer not null check (settled_credits = 2),
  recorded_at timestamptz not null default now(),
  unique(workspace_key, document_id)
);
alter table public.foundation_completed_read_qualifications enable row level security;
alter table public.foundation_completed_read_proofs enable row level security;
revoke all on public.foundation_completed_read_qualifications, public.foundation_completed_read_proofs
  from public, anon, authenticated, service_role;

create function public.reject_completed_read_proof_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'COMPLETED_READ_IMMUTABLE'; end;
$$;
create trigger completed_read_proof_immutable before update or delete on public.foundation_completed_read_proofs
  for each row execute function public.reject_completed_read_proof_mutation();
revoke all on function public.reject_completed_read_proof_mutation() from public, anon, authenticated, service_role;

-- Validates the exact JSON contract and existing source-serving availability. Locks share the
-- upload deletion protocol. Source/representation locks prevent tombstone or lineage rewrites
-- before commit; this helper grants no user authorization and is not exposed to user roles.
create function public.assert_foundation_completed_read_v1(p_facts jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ws text := p_facts->>'workspaceKey';
  doc text := p_facts->>'documentId';
  prefix text;
  version public.source_versions%rowtype;
  source public.sources%rowtype;
  original public.source_representations%rowtype;
  normalized public.source_representations%rowtype;
  approval public.foundation_intake_approvals%rowtype;
  approval_file public.foundation_intake_approval_files%rowtype;
  admission public.foundation_intake_admissions%rowtype;
begin
  if p_facts is null or jsonb_typeof(p_facts) <> 'object' then raise exception 'COMPLETED_READ_INVALID'; end if;
  if (select count(*) from jsonb_object_keys(p_facts)) <> 12
    or not p_facts ?& array['schemaVersion','workspaceKey','documentId','originalKey','originalSha256',
      'sanitizedKey','sanitizedSha256','ocrKey','ocrSha256','observedPageCount','readerRevision','readerBindingSha256']
    or exists (select 1 from jsonb_each(p_facts) e where e.key <> 'observedPageCount' and jsonb_typeof(e.value) <> 'string')
    or p_facts->>'schemaVersion' <> 'tavonel.completed_read.v1'
    or ws !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or doc !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or exists (select 1 from unnest(array['originalSha256','sanitizedSha256','ocrSha256',
      'readerRevision','readerBindingSha256']) k where p_facts->>k !~ '^sha256:[a-f0-9]{64}$')
    or jsonb_typeof(p_facts->'observedPageCount') <> 'number'
    or p_facts->>'observedPageCount' !~ '^[1-9][0-9]?$' then raise exception 'COMPLETED_READ_INVALID'; end if;
  -- Cast only after the lexical/type check, independent of expression evaluation order.
  if (p_facts->>'observedPageCount')::integer > 80 then raise exception 'COMPLETED_READ_INVALID'; end if;
  prefix := 'immutable/' || ws || '/' || ws || '/' || doc || '/' || substr(p_facts->>'sanitizedSha256',8);
  if p_facts->>'originalKey' <> 'quarantine/' || ws || '/' || doc || '/source'
    or p_facts->>'sanitizedKey' <> prefix || '/sanitized.pdf'
    or p_facts->>'ocrKey' <> prefix || '/ocr.json' then raise exception 'COMPLETED_READ_SCOPE_MISMATCH'; end if;
  -- Match the existing approval -> compute reservation lock protocol before source locks.
  perform pg_advisory_xact_lock(hashtextextended('foundation-intake-approval:' || ws, 0));
  select * into approval_file from public.foundation_intake_approval_files where document_id = doc::uuid for share;
  if found then
    select * into approval from public.foundation_intake_approvals where approval_id = approval_file.approval_id for share;
    if not found or approval.workspace_key <> ws or approval.state <> 'approved'
      or approval_file.state <> 'confirmed' or approval_file.content_sha256 <> p_facts->>'originalSha256'
      then raise exception 'COMPLETED_READ_APPROVAL_NOT_ACTIVE'; end if;
  end if;
  perform public.lock_upload_source_deletion(ws, doc::uuid);
  -- Direct uploads only. Connector binding writers do not yet share this lock protocol;
  -- connector receipts are unsupported, and this draft must stay disabled until reviewed.
  if exists (select 1 from public.connector_document_bindings where document_id = doc::uuid)
    then raise exception 'COMPLETED_READ_DIRECT_UPLOAD_REQUIRED'; end if;
  select * into admission from public.foundation_intake_admissions where workspace_key = ws and document_id = doc::uuid
    and confirmed_at is not null for share;
  if not found then raise exception 'COMPLETED_READ_DIRECT_UPLOAD_REQUIRED'; end if;
  if admission.object_key is distinct from p_facts->>'originalKey'
    or admission.source_sha256 is distinct from p_facts->>'originalSha256'
    then raise exception 'COMPLETED_READ_ORIGINAL_UNBOUND'; end if;
  -- Qualification is independently reviewed, empty by default and revocable. Its row is held
  -- through commit, so concurrent revocation serializes with proof creation/reuse.
  perform 1 from public.foundation_completed_read_qualifications q
    where q.binding_sha256 = p_facts->>'readerBindingSha256'
      and q.reader_revision = p_facts->>'readerRevision' and q.revoked_at is null
      and q.immutable_endpoint_verified and q.qualified_at <= now() for share;
  if not found then raise exception 'COMPLETED_READ_READER_UNQUALIFIED'; end if;
  if public.connector_documents_blocked(ws, array[doc]) then raise exception 'COMPLETED_READ_SOURCE_UNAVAILABLE'; end if;
  select * into source from public.sources where source_id = doc and workspace_id = ws and tenant_id = ws for share;
  if not found or source.tombstoned_at is not null then raise exception 'COMPLETED_READ_SOURCE_UNAVAILABLE'; end if;
  if source.origin_kind <> 'upload' then raise exception 'COMPLETED_READ_DIRECT_UPLOAD_REQUIRED'; end if;
  -- Use the existing source-domain-store.ts identity contract and primary keys.
  -- Other versions/representations may legitimately coexist; no count or predicate uniqueness
  -- assumption is made. Missing canonical lineage fails closed and is never synthesized.
  select * into version from public.source_versions where source_version_id = doc || ':' || substr(p_facts->>'originalSha256',8)
    and source_id = source.source_id and immutable_object_key = p_facts->>'originalKey'
    and content_sha256 = p_facts->>'originalSha256' for share;
  if not found or version.tombstoned then raise exception 'COMPLETED_READ_ORIGINAL_UNBOUND'; end if;
  select * into original from public.source_representations where representation_id = 'rep-' || substr(encode(sha256(convert_to(
    version.source_version_id || chr(10) || 'original' || chr(10) || (p_facts->>'originalKey'),'UTF8')),'hex'),1,32)
    and source_version_id = version.source_version_id and kind = 'original'
    and object_key = p_facts->>'originalKey' and content_sha256 = p_facts->>'originalSha256'
    and not lossy and derived_from = '{}'::text[] for share;
  if not found then raise exception 'COMPLETED_READ_ORIGINAL_UNBOUND'; end if;
  select * into normalized from public.source_representations where representation_id = 'rep-' || substr(encode(sha256(convert_to(
    version.source_version_id || chr(10) || 'normalized' || chr(10) || (p_facts->>'sanitizedKey'),'UTF8')),'hex'),1,32)
    and source_version_id = version.source_version_id and kind = 'normalized'
    and object_key = p_facts->>'sanitizedKey' and content_sha256 = p_facts->>'sanitizedSha256'
    and lossy and derived_from = array[original.representation_id] for share;
  if not found then raise exception 'COMPLETED_READ_SANITIZED_UNBOUND'; end if;
  return version.source_version_id;
end;
$$;
revoke all on function public.assert_foundation_completed_read_v1(jsonb) from public, anon, authenticated, service_role;

create function public.settle_foundation_completed_read_v1(p_facts jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  version_id text;
  reservation public.foundation_compute_reservations%rowtype;
  proof public.foundation_completed_read_proofs%rowtype;
  original_id text;
  normalized_id text;
  v_ocr_representation_id text;
  kept public.source_representations%rowtype;
  settled jsonb;
begin
  version_id := public.assert_foundation_completed_read_v1(p_facts);
  original_id := 'rep-' || substr(encode(sha256(convert_to(version_id || chr(10) || 'original' || chr(10)
    || (p_facts->>'originalKey'),'UTF8')),'hex'),1,32);
  normalized_id := 'rep-' || substr(encode(sha256(convert_to(version_id || chr(10) || 'normalized' || chr(10)
    || (p_facts->>'sanitizedKey'),'UTF8')),'hex'),1,32);
  perform pg_advisory_xact_lock(hashtextextended('foundation-compute:' || (p_facts->>'workspaceKey'), 0));
  select * into reservation from public.foundation_compute_reservations where workspace_key = p_facts->>'workspaceKey'
    and document_id = (p_facts->>'documentId')::uuid for update;
  if not found then raise exception 'COMPLETED_READ_RESERVATION_MISSING'; end if;
  perform 1 from public.foundation_intake_admissions where workspace_key = reservation.workspace_key
    and document_id = reservation.document_id and user_id = reservation.user_id for share;
  if not found then raise exception 'COMPLETED_READ_DIRECT_UPLOAD_REQUIRED'; end if;
  select * into proof from public.foundation_completed_read_proofs where reservation_id = reservation.reservation_id;
  if found then
    if proof.facts <> p_facts or proof.workspace_key <> reservation.workspace_key or proof.document_id <> reservation.document_id
      or proof.source_version_id <> version_id or proof.original_representation_id <> original_id
      or proof.normalized_representation_id <> normalized_id
      or reservation.state <> 'settled' or reservation.settled_credits is distinct from 2
      or reservation.reason_code is distinct from 'OCR_COMPLETED' or proof.billing_source <> reservation.billing_source
      then raise exception 'COMPLETED_READ_REPLAY_CONFLICT'; end if;
    perform 1 from public.source_representations r where r.representation_id = proof.ocr_representation_id
      and r.source_version_id = proof.source_version_id and r.kind = 'ocr' and r.provider_id = 'qualified-ocr'
      and r.provider_revision = p_facts->>'readerRevision' and r.content_sha256 = p_facts->>'ocrSha256'
      and r.object_key = p_facts->>'ocrKey' and r.lossy
      and r.derived_from = array[normalized_id]
      for share;
    if not found then raise exception 'COMPLETED_READ_OCR_LINEAGE_CONFLICT'; end if;
    return jsonb_build_object('status','duplicate','reservationId',reservation.reservation_id,
      'state','settled','settledCredits',2,'billingSource',proof.billing_source,'completedRead',proof.facts);
  end if;
  -- A legacy settlement without proof cannot be certified retrospectively. A canceled,
  -- released, expired or operator-review reservation never reaches the existing debit RPC.
  if reservation.state <> 'reserved' or reservation.expires_at <= clock_timestamp()
    then raise exception 'COMPLETED_READ_RESERVATION_NOT_ACTIVE'; end if;
  if exists (select 1 from public.foundation_intake_approval_files f
    join public.foundation_intake_approvals a on a.approval_id = f.approval_id
    where f.document_id = reservation.document_id and (f.reservation_id is distinct from reservation.reservation_id
      or a.user_id <> reservation.user_id or a.expires_at <= clock_timestamp()))
    then raise exception 'COMPLETED_READ_APPROVAL_NOT_ACTIVE'; end if;
  v_ocr_representation_id := 'rep-' || substr(encode(sha256(convert_to(version_id || chr(10) || 'ocr' || chr(10)
    || (p_facts->>'ocrKey'), 'UTF8')), 'hex'),1,32);
  insert into public.source_representations
    (representation_id,source_version_id,kind,provider_id,provider_revision,content_sha256,object_key,lossy,derived_from,created_at)
    values (v_ocr_representation_id,version_id,'ocr','qualified-ocr',p_facts->>'readerRevision',p_facts->>'ocrSha256',
      p_facts->>'ocrKey',true,array[normalized_id],now()) on conflict do nothing;
  select * into kept from public.source_representations r where r.representation_id = v_ocr_representation_id for share;
  if not found or kept.source_version_id <> version_id or kept.kind <> 'ocr' or kept.provider_id <> 'qualified-ocr'
    or kept.provider_revision <> p_facts->>'readerRevision' or kept.content_sha256 <> p_facts->>'ocrSha256'
    or kept.object_key <> p_facts->>'ocrKey' or not kept.lossy or kept.derived_from <> array[normalized_id]
    then raise exception 'COMPLETED_READ_OCR_LINEAGE_CONFLICT'; end if;
  if exists (select 1 from public.foundation_intake_approval_files where document_id = reservation.document_id) then
    settled := public.settle_foundation_intake_approved_compute(reservation.workspace_key,reservation.document_id,'settled',2,'OCR_COMPLETED');
  else
    settled := public.settle_foundation_compute_v3(reservation.workspace_key,reservation.document_id,'settled',2,'OCR_COMPLETED');
  end if;
  if settled->>'status' is distinct from 'processed' or settled->>'reservationId' is distinct from reservation.reservation_id::text
    or settled->>'state' is distinct from 'settled' or settled->>'settledCredits' is distinct from '2'
    or settled->>'billingSource' is distinct from reservation.billing_source then raise exception 'COMPLETED_READ_SETTLEMENT_MISMATCH'; end if;
  insert into public.foundation_completed_read_proofs
    (reservation_id,workspace_key,document_id,source_version_id,original_representation_id,normalized_representation_id,ocr_representation_id,facts,billing_source,settled_credits)
    values(reservation.reservation_id,reservation.workspace_key,reservation.document_id,version_id,original_id,normalized_id,v_ocr_representation_id,p_facts,
      reservation.billing_source,2);
  -- Any failure (including proof INSERT) aborts this transaction, including the existing debit.
  return settled || jsonb_build_object('completedRead',p_facts);
end;
$$;
revoke all on function public.settle_foundation_completed_read_v1(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.settle_foundation_completed_read_v1(jsonb) to service_role;

create function public.read_foundation_completed_read_v1(p_facts jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare proof public.foundation_completed_read_proofs%rowtype; version_id text;
begin
  version_id := public.assert_foundation_completed_read_v1(p_facts);
  select p.* into proof from public.foundation_completed_read_proofs p
    join public.foundation_compute_reservations r on r.reservation_id = p.reservation_id
    join public.source_representations o on o.representation_id = p.ocr_representation_id
    where p.workspace_key = p_facts->>'workspaceKey' and p.document_id = (p_facts->>'documentId')::uuid
      and p.facts = p_facts and p.source_version_id = version_id
      and p.original_representation_id = 'rep-' || substr(encode(sha256(convert_to(version_id || chr(10) || 'original' || chr(10)
        || (p_facts->>'originalKey'),'UTF8')),'hex'),1,32)
      and p.normalized_representation_id = 'rep-' || substr(encode(sha256(convert_to(version_id || chr(10) || 'normalized' || chr(10)
        || (p_facts->>'sanitizedKey'),'UTF8')),'hex'),1,32)
      and r.state = 'settled' and r.settled_credits = 2
      and r.reason_code = 'OCR_COMPLETED' and r.billing_source = p.billing_source
      and o.source_version_id = p.source_version_id and o.kind = 'ocr' and o.provider_id = 'qualified-ocr'
      and o.provider_revision = p_facts->>'readerRevision' and o.content_sha256 = p_facts->>'ocrSha256'
      and o.object_key = p_facts->>'ocrKey' and o.lossy
      and o.derived_from = array[p.normalized_representation_id]
    for share of p,r,o;
  if not found then return null; end if;
  return jsonb_build_object('status','duplicate','reservationId',proof.reservation_id,'state','settled',
    'settledCredits',proof.settled_credits,'billingSource',proof.billing_source,'completedRead',proof.facts);
end;
$$;
revoke all on function public.read_foundation_completed_read_v1(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.read_foundation_completed_read_v1(jsonb) to service_role;
commit;
