-- One intake ceiling, a digest for what was admitted, a durable refusal, and a gate receipt that
-- can be re-derived.
--
-- Four defects, one migration, because they are the same mistake seen four times: a rule written
-- in one place and enforced in another, or claimed and not enforced at all.
--
-- 1. D4-04 / D1-01. Migration 0048 raised the admission function's guard to 250 MiB and left the
--    column CHECK from 0008 at 5 MiB. Every upload between the two failed on a raw constraint
--    violation that the route mapped to a bare 503, so the 250 MiB capability the product
--    published did not exist in production at all. Worse, the number 0048 wanted was never
--    reachable: the CDR worker reads at most 5 MiB and the Cloud Run rasterizer accepts at most
--    5 MiB and 80 pages, in two other trees. Both guards now sit at the one ceiling the
--    processors actually enforce -- `shared/intakeCeiling.ts`, which the capability route reads
--    and `intakeCeilingMigration.test.ts` asserts against this file.
--
-- 2. D1-07. `source_sha256` had a consumer (`shared/documentProcessing.ts` refuses a proof
--    without it) and no producer on the live path. The browser now computes the digest with
--    SubtleCrypto, confirmation records it here, and the CDR worker's own digest over the bytes
--    it read comes back through settlement. Two independent digests over one object is what makes
--    the third one -- the claim -- checkable.
--
-- 3. D1-03. A permanent CDR rejection wrote nothing anywhere. `foundation_intake_state` has had a
--    `rejected` member since 0008 and no writer; this adds the writer, idempotently, so a refused
--    source has a state instead of an absence.
--
-- 4. D5-01. `customer_data_gate_receipts` accepted `allowed = true` with `evidence = '[]'`, so the
--    row that is supposed to let an auditor re-derive `receipt_sha256` could legally contain
--    nothing to re-derive it from. The integer was the completeness signal and the evidence list
--    was decorative; the CHECK below ties them together.
--
-- Apply order: this migration is backward compatible with the code that precedes it. The confirm
-- function keeps a three-argument call shape (the new parameter defaults to null), so a deploy
-- may follow the migration rather than accompany it.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. One ceiling (D4-04, D1-01)
-- ---------------------------------------------------------------------------------------------

-- 5 MiB = min(foundation-cdr-worker src/keys.ts MAX_SOURCE_BYTES, cdr-cloudrun app.py
-- MAX_INPUT_BYTES) = shared/intakeCeiling.ts PROCESSING_CEILING.maxSourceBytes.
alter table public.foundation_intake_admissions
  drop constraint if exists foundation_intake_admissions_requested_bytes_check;
alter table public.foundation_intake_admissions
  add constraint foundation_intake_within_processing_ceiling
  check (requested_bytes between 1 and 5242880);

create or replace function public.reserve_foundation_intake_admission(
  p_workspace_key text,
  p_document_id uuid,
  p_user_id uuid,
  p_object_key text,
  p_requested_bytes integer,
  p_declared_mime_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.foundation_intake_admissions%rowtype;
  v_trial public.foundation_self_service_trials%rowtype;
  v_policy public.foundation_trial_policy%rowtype;
  v_owner boolean := false;
  v_is_trial boolean := false;
  minute_count integer;
  minute_bytes bigint;
  day_count integer;
  day_bytes bigint;
  trial_file_count integer;
  expires_at_value timestamptz;
  v_minute_count_limit integer := 20;
  v_minute_byte_limit bigint := 524288000; -- 500 MiB
  v_day_count_limit integer := 200;
  v_day_byte_limit bigint := 2147483648; -- 2 GiB
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_object_key <> ('quarantine/' || p_workspace_key || '/' || p_document_id::text || '/source')
    or p_requested_bytes < 1
    or char_length(p_declared_mime_type) < 3 or char_length(p_declared_mime_type) > 160 then
    raise exception 'foundation_intake_admission_invalid';
  end if;
  -- The processing ceiling, not an application preference. Admitting more than the CDR worker and
  -- the rasterizer will read is not a larger limit, it is a refusal the customer cannot see.
  if p_requested_bytes > 5242880 then -- 5 MiB
    raise exception 'foundation_intake_file_too_large';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('foundation-intake:' || p_workspace_key, 0));

  select * into existing from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and document_id = p_document_id for update;
  if found then
    if existing.user_id <> p_user_id or existing.object_key <> p_object_key
      or existing.declared_mime_type <> p_declared_mime_type then
      raise exception 'foundation_intake_idempotency_conflict';
    end if;
    if existing.confirmed_at is not null then
      return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
        'expiresAt', existing.expires_at, 'idempotentReplay', true, 'confirmed', true);
    end if;
    if existing.expires_at <= clock_timestamp() then
      expires_at_value := clock_timestamp() + interval '10 minutes';
      update public.foundation_intake_admissions
      set requested_bytes = p_requested_bytes, expires_at = expires_at_value
      where workspace_key = p_workspace_key and document_id = p_document_id
      returning * into existing;
    end if;
    return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
      'expiresAt', existing.expires_at, 'idempotentReplay', false, 'confirmed', false);
  end if;

  select exists(
    select 1 from public.foundation_account_access_grants
     where user_id = p_user_id and active = true and trial_exempt = true
  ) into v_owner;

  if not v_owner then
    select * into v_trial from public.foundation_self_service_trials
     where user_id = p_user_id and workspace_key = p_workspace_key for update;
    if found then
      v_is_trial := true;
      if v_trial.status <> 'trialing' or v_trial.expires_at <= clock_timestamp() then
        raise exception 'foundation_trial_not_active';
      end if;
      -- Free evaluation is bounded independently, and never above the processing ceiling. The
      -- guard above already refuses everything this one would; it stays so the trial bound is
      -- still stated here if the two numbers ever diverge again.
      if p_requested_bytes > 5242880 then -- min(50 MiB trial bound, 5 MiB processing ceiling)
        raise exception 'foundation_trial_file_too_large';
      end if;
      select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
      select count(*) into trial_file_count
        from public.foundation_intake_admissions
       where workspace_key = p_workspace_key
         and (confirmed_at is not null or expires_at > clock_timestamp());
      if trial_file_count >= v_policy.file_limit then
        raise exception 'foundation_trial_file_limit_exceeded';
      end if;
      -- Trial already has a three-file / fifty-page contract; keep transfer velocity modest too.
      v_minute_count_limit := 5;
      v_minute_byte_limit := 104857600; -- 100 MiB
      v_day_count_limit := 10;
      v_day_byte_limit := 157286400; -- 150 MiB
    end if;
  end if;

  select count(*), coalesce(sum(requested_bytes), 0) into minute_count, minute_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '1 minute'
    and (confirmed_at is not null or expires_at > clock_timestamp());
  if minute_count >= v_minute_count_limit or minute_bytes + p_requested_bytes > v_minute_byte_limit then
    raise exception 'foundation_intake_rate_limited';
  end if;

  select count(*), coalesce(sum(requested_bytes), 0) into day_count, day_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '24 hours'
    and (confirmed_at is not null or expires_at > clock_timestamp());
  if day_count >= v_day_count_limit or day_bytes + p_requested_bytes > v_day_byte_limit then
    raise exception 'foundation_intake_daily_quota_exceeded';
  end if;

  expires_at_value := clock_timestamp() + interval '10 minutes';
  insert into public.foundation_intake_admissions (
    workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type, expires_at
  ) values (
    p_workspace_key, p_document_id, p_user_id, p_object_key, p_requested_bytes, p_declared_mime_type, expires_at_value
  );
  return jsonb_build_object('documentId', p_document_id, 'objectKey', p_object_key,
    'expiresAt', expires_at_value, 'idempotentReplay', false, 'confirmed', false,
    'intakeClass', case when v_is_trial then 'trial' when v_owner then 'owner' else 'paid' end);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. The digest of what was admitted (D1-07, D1-04)
-- ---------------------------------------------------------------------------------------------

alter table public.foundation_intake_admissions
  add column if not exists source_sha256 text;
alter table public.foundation_intake_admissions
  drop constraint if exists foundation_intake_source_sha256_shape;
alter table public.foundation_intake_admissions
  add constraint foundation_intake_source_sha256_shape
  check (source_sha256 is null or source_sha256 ~ '^sha256:[a-f0-9]{64}$');

-- Replacing the three-argument function rather than overloading it: two candidates, one with a
-- defaulted fourth parameter, make a three-argument call ambiguous. The default keeps every
-- existing caller working.
drop function if exists public.confirm_foundation_intake_admission(text, uuid, uuid);

create or replace function public.confirm_foundation_intake_admission(
  p_workspace_key text,
  p_document_id uuid,
  p_user_id uuid,
  p_source_sha256 text default null,
  p_observed_bytes bigint default null,
  p_observed_mime text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admission public.foundation_intake_admissions%rowtype;
begin
  if p_source_sha256 is not null and p_source_sha256 !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'foundation_intake_source_digest_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('foundation-intake:' || p_workspace_key, 0));
  select * into admission
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and document_id = p_document_id
  for update;
  if not found or admission.user_id <> p_user_id then
    raise exception 'foundation_intake_confirmation_not_found';
  end if;
  -- What R2 stored against what the capability reserved, before anything is marked confirmed.
  -- The presign signs content-length and content-type, so a disagreement here means either R2
  -- does not enforce a signed header or the object is not the one that was admitted. Either way
  -- it is refused rather than recorded, and the check does not depend on the bucket for its truth.
  if p_observed_bytes is not null and p_observed_bytes <> admission.requested_bytes then
    raise exception 'foundation_intake_content_length_mismatch';
  end if;
  if p_observed_mime is not null and lower(p_observed_mime) <> lower(admission.declared_mime_type) then
    raise exception 'foundation_intake_observed_mime_mismatch';
  end if;
  -- The digest is written once. A second confirmation that disagrees with the first is a
  -- different object under the same capability, and that is a conflict rather than an update.
  if admission.source_sha256 is not null and p_source_sha256 is not null
    and admission.source_sha256 <> p_source_sha256 then
    raise exception 'foundation_intake_source_digest_conflict';
  end if;
  update public.foundation_intake_admissions
  set confirmed_at = coalesce(confirmed_at, clock_timestamp()),
      source_sha256 = coalesce(source_sha256, p_source_sha256),
      updated_at = now()
  where workspace_key = p_workspace_key and document_id = p_document_id
  returning * into admission;
  return jsonb_build_object(
    'status', 'confirmed',
    'documentId', admission.document_id,
    'confirmedAt', admission.confirmed_at,
    -- Returned so confirmation can compare what R2 actually stored against what was reserved,
    -- without a second round trip and without reading the object.
    'requestedBytes', admission.requested_bytes,
    'declaredMimeType', admission.declared_mime_type,
    'sourceSha256', admission.source_sha256
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. A refusal that exists (D1-03)
-- ---------------------------------------------------------------------------------------------

create or replace function public.refuse_foundation_intake_admission(
  p_workspace_key text,
  p_document_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admission public.foundation_intake_admissions%rowtype;
begin
  if p_reason_code !~ '^[A-Z][A-Z0-9_]{2,79}$' then
    raise exception 'foundation_intake_refusal_invalid';
  end if;
  select * into admission
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and document_id = p_document_id
  for update;
  if not found then
    raise exception 'foundation_intake_refusal_not_found';
  end if;
  -- Queue delivery is at-least-once, so this says the same thing twice without changing anything
  -- the second time. A source already read cannot be un-read by a late refusal, either.
  if admission.state in ('ocr_ready', 'sanitized') then
    return jsonb_build_object('status', 'ignored', 'documentId', admission.document_id, 'state', admission.state);
  end if;
  update public.foundation_intake_admissions
  set state = 'rejected', updated_at = now()
  where workspace_key = p_workspace_key and document_id = p_document_id
  returning * into admission;
  return jsonb_build_object('status', 'refused', 'documentId', admission.document_id, 'state', admission.state);
end;
$$;

revoke all on function public.refuse_foundation_intake_admission(text, uuid, text) from public, anon, authenticated;
grant execute on function public.refuse_foundation_intake_admission(text, uuid, text) to service_role;
revoke all on function public.confirm_foundation_intake_admission(text, uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.confirm_foundation_intake_admission(text, uuid, uuid, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. A gate receipt an auditor can re-derive (D5-01)
-- ---------------------------------------------------------------------------------------------

-- `satisfied_count` is an integer anyone can assert; the evidence list is the expensive thing to
-- fabricate consistently, and it was the one the constraint did not look at. Tie them together,
-- and require the seventeen preconditions to be exactly the frozen set -- reusing the `@?`
-- jsonpath idiom 0050 already uses for `principals` rather than inventing a validator.
alter table public.customer_data_gate_receipts
  drop constraint if exists customer_data_gate_evidence_matches_count;
alter table public.customer_data_gate_receipts
  add constraint customer_data_gate_evidence_matches_count check (
    allowed = false
    or (
      satisfied_count = 17
      and jsonb_array_length(evidence) = 17
      and evidence @? '$[*] ? (@.precondition == "tenant_isolation_suite_passed")'
      and evidence @? '$[*] ? (@.precondition == "encryption_at_rest_verified")'
      and evidence @? '$[*] ? (@.precondition == "encryption_in_transit_verified")'
      and evidence @? '$[*] ? (@.precondition == "connector_credentials_in_secret_manager")'
      and evidence @? '$[*] ? (@.precondition == "no_secrets_in_receipts_or_logs_verified")'
      and evidence @? '$[*] ? (@.precondition == "malware_scan_and_quarantine_active")'
      and evidence @? '$[*] ? (@.precondition == "archive_bomb_limits_enforced")'
      and evidence @? '$[*] ? (@.precondition == "compile_receipts_signed_and_audited")'
      and evidence @? '$[*] ? (@.precondition == "deletion_tombstone_propagation_verified")'
      and evidence @? '$[*] ? (@.precondition == "retention_controls_configured")'
      and evidence @? '$[*] ? (@.precondition == "data_export_and_delete_available")'
      and evidence @? '$[*] ? (@.precondition == "audit_log_active")'
      and evidence @? '$[*] ? (@.precondition == "least_privilege_connector_scopes_verified")'
      and evidence @? '$[*] ? (@.precondition == "per_provider_isolation_verified")'
      and evidence @? '$[*] ? (@.precondition == "dpa_and_privacy_notice_published")'
      and evidence @? '$[*] ? (@.precondition == "per_source_acl_preserved")'
      and evidence @? '$[*] ? (@.precondition == "founder_approval_receipt_recorded")'
    )
  );

commit;
