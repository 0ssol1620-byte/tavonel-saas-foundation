-- DRAFT DESIGN ONLY. Not applied; no seeds, RPC, approval/qualification issuer, adapter or route.
-- Candidate persistence is not a verified grant. Root must review the contract and missing
-- issuer/security/billing-reference policies before ANY acceptance/issuance implementation.
-- No existing table, reservation state, credit amount or Source representation is changed.
begin;

create table public.foundation_native_qualification_profiles (
  qualification_id text primary key check (qualification_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  producer_id text not null check (char_length(producer_id) between 1 and 128),
  producer_key_id text not null check (char_length(producer_key_id) between 1 and 128),
  producer_key_reference text not null check (char_length(producer_key_reference) between 1 and 256),
  producer_revision text not null check (producer_revision ~ '^sha256:[a-f0-9]{64}$'),
  caller_id text not null check (char_length(caller_id) between 1 and 128),
  reader_revision text not null check (reader_revision ~ '^sha256:[a-f0-9]{64}$'),
  input_mime_type text not null check (input_mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  cir_schema_version text not null check (cir_schema_version = 'cir-1.0.0'),
  native_parser_version text not null check (native_parser_version = '1.2.0'),
  state text not null default 'unreviewed' check (state in ('unreviewed','reviewed','revoked')),
  independent_qualifier_id text check (char_length(independent_qualifier_id) between 1 and 128),
  review_attestation_sha256 text check (review_attestation_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  reviewed_at timestamptz,
  valid_from timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (independent_qualifier_id is null or independent_qualifier_id not in (producer_id,caller_id)),
  check ((state = 'revoked') = (revoked_at is not null)),
  check ((state in ('unreviewed','revoked') and independent_qualifier_id is null and review_attestation_sha256 is null
      and reviewed_at is null and valid_from is null and expires_at is null)
    or (state in ('reviewed','revoked') and independent_qualifier_id is not null and review_attestation_sha256 is not null and reviewed_at is not null
      and valid_from is not null and expires_at is not null and expires_at > valid_from)),
  check (reviewed_at is null or pg_catalog.isfinite(reviewed_at)),
  check (valid_from is null or pg_catalog.isfinite(valid_from)),
  check (expires_at is null or pg_catalog.isfinite(expires_at)),
  check (revoked_at is null or pg_catalog.isfinite(revoked_at))
);

create table public.foundation_native_purpose_grants (
  native_grant_id uuid primary key,
  intake_approval_id uuid not null references public.foundation_intake_approvals(approval_id) on delete restrict,
  -- Pin the existing immutable approval scope digest; never reinterpret it as native permission.
  intake_scope_digest text not null check (intake_scope_digest ~ '^sha256:[a-f0-9]{64}$'),
  qualification_id text not null references public.foundation_native_qualification_profiles(qualification_id) on delete restrict,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  tenant_id text not null,
  principal_user_id uuid not null references auth.users(id) on delete restrict,
  job_id text not null check (job_id ~ '^cjob-[a-f0-9]{32}$'),
  -- Existing current job authorization must be rechecked; an FK alone would not grant access.
  authorization_revision bigint not null check (authorization_revision between 1 and 9007199254740991),
  collection_id text not null check (collection_id ~ '^collection-[a-f0-9]{32}$'),
  replay_binding text not null check (replay_binding ~ '^native-work-[a-f0-9]{32}$'),
  purpose text not null default 'native_artifact_preparation' check (purpose = 'native_artifact_preparation'),
  state text not null default 'proposed' check (state in ('proposed','authorized','revoked')),
  native_authorization_issuer_id text check (char_length(native_authorization_issuer_id) between 1 and 128),
  native_authorization_policy_sha256 text check (native_authorization_policy_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  native_authorization_evidence_sha256 text check (native_authorization_evidence_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  authorized_at timestamptz,
  valid_from timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(native_grant_id,intake_approval_id),
  check (tenant_id = workspace_key),
  check ((state = 'revoked') = (revoked_at is not null)),
  check ((state in ('proposed','revoked') and native_authorization_issuer_id is null and native_authorization_policy_sha256 is null
      and native_authorization_evidence_sha256 is null and authorized_at is null and valid_from is null and expires_at is null)
    or (state in ('authorized','revoked') and native_authorization_issuer_id is not null and native_authorization_policy_sha256 is not null
      and native_authorization_evidence_sha256 is not null and authorized_at is not null
      and valid_from is not null and expires_at is not null and expires_at > valid_from)),
  check (authorized_at is null or pg_catalog.isfinite(authorized_at)),
  check (valid_from is null or pg_catalog.isfinite(valid_from)),
  check (expires_at is null or pg_catalog.isfinite(expires_at)),
  check (revoked_at is null or pg_catalog.isfinite(revoked_at))
);

create table public.foundation_native_purpose_members (
  native_grant_id uuid not null,
  intake_approval_id uuid not null,
  intake_file_key text not null,
  document_id uuid not null,
  reservation_id uuid not null references public.foundation_compute_reservations(reservation_id) on delete restrict,
  source_id text not null references public.sources(source_id) on delete restrict,
  source_version_id text not null references public.source_versions(source_version_id) on delete restrict,
  original_representation_id text not null references public.source_representations(representation_id) on delete restrict,
  normalized_representation_id text not null references public.source_representations(representation_id) on delete restrict,
  original_sha256 text not null check (original_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  original_bytes bigint not null check (original_bytes between 1 and 5242880),
  quarantine_original_key text not null check (char_length(quarantine_original_key) between 1 and 1024),
  normalized_pdf_key text not null check (char_length(normalized_pdf_key) between 1 and 1024),
  normalized_pdf_sha256 text not null check (normalized_pdf_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  -- These exact pins are NOT verified scanner/CDR/qualification facts. There is no canonical
  -- SQL security-receipt table/FK today. The separately trusted verifier remains a blocker.
  security_receipt_id text not null check (char_length(security_receipt_id) between 1 and 128),
  security_object_key text not null check (char_length(security_object_key) between 1 and 1024),
  security_object_sha256 text not null check (security_object_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  security_qualification_id text not null check (char_length(security_qualification_id) between 1 and 128),
  security_attestation_sha256 text not null check (security_attestation_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  native_object_key text not null check (char_length(native_object_key) between 1 and 1024),
  native_object_sha256 text not null check (native_object_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  native_bytes bigint not null check (native_bytes between 1 and 5242880),
  binding_state text not null default 'unbound' check (binding_state in ('unbound','bound','revoked')),
  processing_receipt_id text unique check (char_length(processing_receipt_id) between 1 and 128),
  signed_processing_receipt jsonb check (pg_catalog.jsonb_typeof(signed_processing_receipt) = 'object'
    and pg_catalog.octet_length(signed_processing_receipt::text) <= 32768),
  signed_receipt_sha256 text check (signed_receipt_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  cir_object_key text check (char_length(cir_object_key) between 1 and 1024),
  cir_object_sha256 text check (cir_object_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  cir_canonical_sha256 text check (cir_canonical_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  cir_bytes bigint check (cir_bytes between 1 and 8388608),
  bound_at timestamptz,
  revoked_at timestamptz,
  primary key(native_grant_id,document_id),
  unique(native_grant_id,intake_file_key),
  unique(native_grant_id,reservation_id),
  foreign key(native_grant_id,intake_approval_id) references public.foundation_native_purpose_grants(native_grant_id,intake_approval_id) on delete restrict,
  foreign key(intake_approval_id,intake_file_key) references public.foundation_intake_approval_files(approval_id,file_key) on delete restrict,
  check (source_id = document_id::text),
  check (source_version_id = source_id || ':' || pg_catalog.substr(original_sha256,8)),
  check (native_object_sha256 = original_sha256 and native_bytes = original_bytes),
  check ((binding_state = 'revoked') = (revoked_at is not null)),
  check ((binding_state in ('unbound','revoked') and processing_receipt_id is null and signed_processing_receipt is null
      and signed_receipt_sha256 is null and cir_object_key is null and cir_object_sha256 is null
      and cir_canonical_sha256 is null and cir_bytes is null and bound_at is null)
    or (binding_state in ('bound','revoked') and processing_receipt_id is not null and signed_processing_receipt is not null and signed_receipt_sha256 is not null
      and cir_object_key is not null and cir_object_sha256 is not null and cir_canonical_sha256 is not null
      and cir_bytes is not null and bound_at is not null)),
  check (bound_at is null or pg_catalog.isfinite(bound_at)),
  check (revoked_at is null or pg_catalog.isfinite(revoked_at))
);

-- Deliberately no write/qualification/authorization role, table access or read RPC is granted.
-- RLS and empty privileges keep all live app roles closed. A future reviewed definer transaction
-- must enforce immutable identities, monotonic revocation, exact whole-set membership, current
-- reservation/source/job/ACL/security bindings and locking before it can issue/read authority.
alter table public.foundation_native_qualification_profiles enable row level security;
alter table public.foundation_native_purpose_grants enable row level security;
alter table public.foundation_native_purpose_members enable row level security;
revoke all on public.foundation_native_qualification_profiles, public.foundation_native_purpose_grants,
  public.foundation_native_purpose_members from public, anon, authenticated, service_role;
commit;
