-- DRAFT ONLY: kept under supabase/drafts, outside Supabase migration auto-discovery.
-- This package does not register or execute the SQL or alter a database.
-- Review before use. A future disposable rehearsal should temporarily register the reviewed
-- draft with the repository's official Supabase CLI workflow, then run its matching fixture.
-- Do not apply this SQL outside that disposable rehearsal.
--
-- The draft adds receipt storage, tenant-scoped triage staging/finalization, one-time approval
-- binding, and versioned quote/reserve/compile RPC contracts. It is not registered or executed.

begin;

-- Database-side rollout lock. The code-owned server switch also defaults off. With this
-- migration installed but the gate off, legacy reservations remain available. Enabling triage
-- requires the matching client/RPC rollout and an explicit owner-controlled update to this row.
create table public.foundation_intake_triage_rollout_gate (
  gate_key text primary key check (gate_key = 'upload_triage_v1'),
  enabled boolean not null default false,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
insert into public.foundation_intake_triage_rollout_gate(gate_key,enabled) values ('upload_triage_v1',false);
alter table public.foundation_intake_triage_rollout_gate enable row level security;
revoke all on public.foundation_intake_triage_rollout_gate from public, anon, authenticated, service_role;

create function public.foundation_intake_triage_rollout_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select g.enabled from public.foundation_intake_triage_rollout_gate g
    where g.gate_key = 'upload_triage_v1'), false)
$$;

-- This validates the customer page-charge scope. Recompile modes require trusted persisted reading proof, which is not available in this draft, so only new_read is accepted. Operator/provider-cost availability is
-- intentionally not part of customer approval readiness.
create function public.foundation_intake_customer_charge_complete(
  p_inventory jsonb, p_estimate jsonb, p_pricing_fingerprint text
) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    p_estimate->>'currency' = 'USD'
    and
    p_estimate #>> '{customerChargeCoverage,policy}' = 'published_page_admission_once'
    and p_estimate #>> '{customerChargeCoverage,scope}' = 'entire_affected_source_version_set'
    and p_estimate #>> '{customerChargeCoverage,pricingFingerprint}' = p_pricing_fingerprint
    and jsonb_typeof(p_estimate #> '{customerChargeCoverage,sourceVersions}') = 'array'
    and p_estimate #>> '{operatorCost,status}' in ('priced', 'not_priced')
    and jsonb_typeof(p_estimate #> '{operatorCost,unavailableProviders}') = 'array'
    and jsonb_typeof(p_inventory->'selectedFileKeys') = 'array'
    and jsonb_array_length(p_estimate #> '{customerChargeCoverage,sourceVersions}')
      = jsonb_array_length(p_inventory->'selectedFileKeys')
    and jsonb_typeof(p_estimate #> '{initial,minimum}') = 'number'
    and jsonb_typeof(p_estimate #> '{initial,maximum}') = 'number'
    and (p_estimate #>> '{initial,minimum}')::numeric >= 0
    and (p_estimate #>> '{initial,maximum}')::numeric >= (p_estimate #>> '{initial,minimum}')::numeric
    and jsonb_typeof(p_estimate #> '{incremental,minimum}') = 'number'
    and jsonb_typeof(p_estimate #> '{incremental,maximum}') = 'number'
    and (p_estimate #>> '{incremental,minimum}')::numeric = 0
    and (p_estimate #>> '{incremental,maximum}')::numeric = 0
    and (select count(distinct source.value->>'fileKey') = count(*)
      from jsonb_array_elements(p_estimate #> '{customerChargeCoverage,sourceVersions}') source(value))
    and not exists (
      select 1 from jsonb_array_elements_text(p_inventory->'selectedFileKeys') selected(file_key)
      where not exists (
        select 1
        from jsonb_array_elements(p_estimate #> '{customerChargeCoverage,sourceVersions}') source(value)
        join jsonb_array_elements(p_inventory->'files') file(value)
          on file.value->>'fileKey' = selected.file_key
        where source.value->>'fileKey' = selected.file_key
          and source.value->>'contentSha256' = file.value->>'contentSha256'
          and source.value->>'revision' is not distinct from file.value->>'revision'
          and file.value->>'disposition' = 'include'
          and file.value->>'digestEvidence' = 'server_verified'
          and source.value->>'mode' = 'new_read'
      )
    ), false)
$$;

create table public.foundation_intake_triage_receipts (
  receipt_id uuid primary key default pg_catalog.gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  source_kind text not null check (source_kind in ('direct_upload', 'connector')),
  source_id text not null check (char_length(source_id) between 1 and 256),
  inventory_revision text not null check (char_length(inventory_revision) between 1 and 256),
  connection_id uuid,
  inventory_epoch bigint,
  triage_version text not null check (triage_version = 'tavonel-intake-triage-v1'),
  inventory_digest text not null check (inventory_digest ~ '^sha256:[a-f0-9]{64}$'),
  configuration_revision text not null check (char_length(configuration_revision) between 1 and 128),
  pricing_fingerprint text not null check (pricing_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  inventory jsonb not null check (jsonb_typeof(inventory) = 'object'),
  estimate jsonb not null check (jsonb_typeof(estimate) = 'object'),
  file_bindings jsonb not null check (jsonb_typeof(file_bindings) = 'array'),
  approval_ready boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  constraint foundation_intake_triage_receipt_scope_check check (
    (source_kind = 'direct_upload' and connection_id is null and inventory_epoch is null)
    or (source_kind = 'connector' and connection_id is not null and inventory_epoch is not null and inventory_epoch >= 0)
  ),
  constraint foundation_intake_triage_receipt_lifetime_check
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint foundation_intake_triage_receipt_ready_cost_check check (
    not approval_ready
    or (inventory->>'approvalReady' = 'true'
      and jsonb_typeof(inventory->'selectedFileKeys') = 'array'
      and jsonb_array_length(inventory->'selectedFileKeys') > 0
      and public.foundation_intake_customer_charge_complete(inventory, estimate, pricing_fingerprint))
  ),
  constraint foundation_intake_triage_receipt_unique_scope unique (
    workspace_key, actor_user_id, source_kind, source_id, inventory_revision,
    triage_version, inventory_digest, configuration_revision, pricing_fingerprint
  )
);

create table public.foundation_intake_triage_stages (
  stage_id uuid primary key,
  batch_id uuid not null,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  document_id uuid not null unique,
  relative_path text not null check (char_length(relative_path) between 1 and 1024
    and relative_path !~ '(^/|(^|/)\.\.(/|$)|(^|/)\.(/|$))'),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  declared_mime_type text not null check (char_length(declared_mime_type) between 3 and 160),
  requested_bytes integer not null check (requested_bytes between 1 and 5242880),
  staging_key text not null,
  sealed_source_key text not null,
  state text not null check (state in ('issued', 'sealing', 'sealed')),
  seal_token uuid,
  fence_generation bigint not null default 0 check (fence_generation >= 0),
  seal_lease_until timestamptz,
  file_key text check (file_key is null or file_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  object_etag text,
  signature text check (signature is null or signature in ('valid', 'mismatch')),
  seal_mode text check (seal_mode is null or seal_mode = 'server_only_copy_v1'),
  sealed_at timestamptz,
  triage_receipt_id uuid references public.foundation_intake_triage_receipts(receipt_id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  upload_expires_at timestamptz not null,
  expires_at timestamptz not null,
  staging_cleanup_at timestamptz not null,
  staging_cleanup_done_at timestamptz,
  sealed_cleanup_at timestamptz,
  sealed_cleanup_done_at timestamptz,
  constraint foundation_intake_triage_stage_idempotency unique (workspace_key, actor_user_id, idempotency_key),
  constraint foundation_intake_triage_stage_keys check (
    staging_key = 'quarantine/' || workspace_key || '/triage-staging/' || stage_id::text || '/upload'
    and sealed_source_key = 'quarantine/' || workspace_key || '/' || document_id::text || '/source'
  ),
  constraint foundation_intake_triage_stage_lifetime check (
    upload_expires_at > created_at and upload_expires_at <= created_at + interval '2 minutes'
    and expires_at > upload_expires_at and expires_at <= created_at + interval '15 minutes'
    and staging_cleanup_at >= upload_expires_at
  ),
  constraint foundation_intake_triage_stage_state_payload check (
    (state in ('issued', 'sealing') and file_key is null and content_sha256 is null and sealed_at is null and seal_mode is null)
    or (state = 'sealed' and file_key is not null and content_sha256 is not null and signature is not null
      and sealed_at is not null and seal_mode = 'server_only_copy_v1')
  )
);

-- Separate immutable consent for bounded server-side preflight. It never authorizes OCR,
-- LLMs, compute reservations, or compile dispatch, and it never asserts a monetary price.
create table public.foundation_intake_preflight_approvals (
  preflight_approval_id uuid primary key default pg_catalog.gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  batch_id uuid not null,
  approval_stage text not null check (approval_stage = 'preflight'),
  budget_scope text not null check (budget_scope = 'bounded_bytes_and_file_count'),
  configuration_revision text not null check (char_length(configuration_revision) between 1 and 128),
  stage_choices jsonb not null check (jsonb_typeof(stage_choices) = 'array'),
  selected_stage_ids uuid[] not null check (cardinality(selected_stage_ids) between 1 and 128),
  max_files integer not null check (max_files between 1 and 128),
  max_total_bytes bigint not null check (max_total_bytes between 1 and 671088640),
  provider_calls integer not null default 0 check (provider_calls = 0),
  monetary_cost_status text not null default 'not_priced' check (monetary_cost_status = 'not_priced'),
  cost_disclosure text not null check (char_length(cost_disclosure) between 1 and 512),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  constraint foundation_intake_preflight_approval_lifetime
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint foundation_intake_preflight_scope_unique unique (workspace_key,actor_user_id,batch_id)
);
alter table public.foundation_intake_triage_stages
  add column preflight_approval_id uuid references public.foundation_intake_preflight_approvals(preflight_approval_id) on delete restrict;
alter table public.foundation_intake_preflight_approvals enable row level security;
revoke all on public.foundation_intake_preflight_approvals from public, anon, authenticated, service_role;
grant select on public.foundation_intake_preflight_approvals to service_role;

create function public.foundation_intake_preflight_approval_immutable_guard()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'foundation_intake_preflight_approval_immutable'; end;
$$;
create trigger foundation_intake_preflight_approval_immutable_trigger
before update or delete on public.foundation_intake_preflight_approvals
for each row execute function public.foundation_intake_preflight_approval_immutable_guard();

create function public.create_foundation_intake_preflight_approval(
  p_workspace_key text,p_actor_user_id uuid,p_batch_id uuid,p_approval_id uuid,
  p_configuration_revision text,p_stage_choices jsonb,p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_count integer; v_selected integer; v_bytes bigint; v_ids uuid[]; v_choice jsonb; v_stage public.foundation_intake_triage_stages%rowtype;
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_actor_user_id is null or p_batch_id is null
    or p_approval_id is null or coalesce(p_configuration_revision,'') = ''
    or jsonb_typeof(p_stage_choices) <> 'array' or jsonb_array_length(p_stage_choices) not between 1 and 128
    or p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > pg_catalog.clock_timestamp() + interval '10 minutes' then
    raise exception 'foundation_intake_preflight_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'foundation-intake-preflight:' || p_workspace_key || ':' || p_actor_user_id::text || ':' || p_batch_id::text,0));
  select count(*) into v_count from public.foundation_intake_triage_stages s
   where s.workspace_key=p_workspace_key and s.actor_user_id=p_actor_user_id and s.batch_id=p_batch_id
     and s.expires_at > pg_catalog.clock_timestamp() and s.state='issued';
  if v_count <> jsonb_array_length(p_stage_choices) then raise exception 'foundation_intake_preflight_scope'; end if;
  if (select count(distinct value->>'stageId') from jsonb_array_elements(p_stage_choices) as x(value)) <> v_count then
    raise exception 'foundation_intake_preflight_invalid';
  end if;
  for v_choice in select value from jsonb_array_elements(p_stage_choices) as x(value) loop
    if coalesce(v_choice->>'stageId','') !~ '^[0-9a-f-]{36}$'
      or v_choice->>'choice' not in ('preflight','exclude') then raise exception 'foundation_intake_preflight_invalid'; end if;
    select * into v_stage from public.foundation_intake_triage_stages s
     where s.stage_id=(v_choice->>'stageId')::uuid and s.workspace_key=p_workspace_key
       and s.actor_user_id=p_actor_user_id and s.batch_id=p_batch_id and s.state='issued'
       and s.expires_at > pg_catalog.clock_timestamp() and s.preflight_approval_id is null for update;
    if not found then raise exception 'foundation_intake_preflight_scope'; end if;
    if v_choice->>'choice'='preflight' then
      v_selected := coalesce(v_selected,0)+1;
      v_bytes := coalesce(v_bytes,0)+v_stage.requested_bytes;
      v_ids := array_append(v_ids,v_stage.stage_id);
    end if;
  end loop;
  if coalesce(v_selected,0) < 1 then raise exception 'foundation_intake_preflight_empty'; end if;
  insert into public.foundation_intake_preflight_approvals(
    preflight_approval_id,workspace_key,actor_user_id,batch_id,approval_stage,budget_scope,
    configuration_revision,stage_choices,selected_stage_ids,max_files,max_total_bytes,
    provider_calls,monetary_cost_status,cost_disclosure,expires_at
  ) values (
    p_approval_id,p_workspace_key,p_actor_user_id,p_batch_id,'preflight','bounded_bytes_and_file_count',
    p_configuration_revision,p_stage_choices,v_ids,v_selected,v_bytes,0,'not_priced',
    'Monetary infrastructure cost is not priced here. Approval is limited to the selected file count and declared byte total; no external OCR, LLM, compute reservation, or compile is authorized.',p_expires_at
  );
  update public.foundation_intake_triage_stages s set preflight_approval_id=p_approval_id
   where s.stage_id=any(v_ids) and s.workspace_key=p_workspace_key and s.actor_user_id=p_actor_user_id
     and s.preflight_approval_id is null;
  return pg_catalog.jsonb_build_object(
    'preflightApprovalId',p_approval_id,'workspaceKey',p_workspace_key,'actorUserId',p_actor_user_id,
    'batchId',p_batch_id,'approvalStage','preflight','budgetScope','bounded_bytes_and_file_count',
    'selectedStageIds',to_jsonb(v_ids),'maxFiles',v_selected,'maxTotalBytes',v_bytes,
    'providerCalls',0,'monetaryCostStatus','not_priced',
    'costDisclosure','Monetary infrastructure cost is not priced here. Approval is limited to the selected file count and declared byte total; no external OCR, LLM, compute reservation, or compile is authorized.',
    'configurationRevision',p_configuration_revision,'expiresAt',p_expires_at
  );
end;
$$;

create function public.read_foundation_intake_preflight_approval(
  p_workspace_key text,p_actor_user_id uuid,p_preflight_approval_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_approval public.foundation_intake_preflight_approvals%rowtype;
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  select * into v_approval from public.foundation_intake_preflight_approvals a
   where a.preflight_approval_id=p_preflight_approval_id and a.workspace_key=p_workspace_key
     and a.actor_user_id=p_actor_user_id;
  if not found then raise exception 'foundation_intake_preflight_not_found'; end if;
  return pg_catalog.jsonb_build_object(
    'preflightApprovalId',v_approval.preflight_approval_id,'workspaceKey',v_approval.workspace_key,
    'actorUserId',v_approval.actor_user_id,'batchId',v_approval.batch_id,'approvalStage',v_approval.approval_stage,
    'budgetScope',v_approval.budget_scope,'configurationRevision',v_approval.configuration_revision,
    'stageChoices',v_approval.stage_choices,'selectedStageIds',to_jsonb(v_approval.selected_stage_ids),
    'maxFiles',v_approval.max_files,'maxTotalBytes',v_approval.max_total_bytes,
    'providerCalls',v_approval.provider_calls,'monetaryCostStatus',v_approval.monetary_cost_status,
    'costDisclosure',v_approval.cost_disclosure,'expiresAt',v_approval.expires_at
  );
end;
$$;

-- Every seal lease gets a new server-minted document/key identity. A stale worker can only
-- finish writing its own orphan key; it cannot replace the key held by a later lease.
create table public.foundation_intake_triage_seal_attempts (
  seal_token uuid primary key,
  stage_id uuid not null references public.foundation_intake_triage_stages(stage_id) on delete restrict,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  document_id uuid not null unique,
  object_key text not null unique,
  lease_until timestamptz not null,
  fence_generation bigint not null check (fence_generation > 0),
  state text not null check (state in ('active','accepted','orphan')),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  byte_length integer check (byte_length is null or byte_length between 1 and 5242880),
  object_etag text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  accepted_at timestamptz,
  cleanup_eligible_at timestamptz,
  constraint foundation_intake_triage_seal_attempt_key check (
    object_key = 'quarantine/' || workspace_key || '/' || document_id::text || '/source'
  ),
  constraint foundation_intake_triage_seal_attempt_generation unique (stage_id,fence_generation),
  constraint foundation_intake_triage_seal_attempt_state check (
    (state = 'active' and content_sha256 is null and accepted_at is null)
    or (state = 'orphan' and content_sha256 is null and accepted_at is null and cleanup_eligible_at is not null)
    or (state = 'accepted' and content_sha256 is not null and byte_length is not null and accepted_at is not null and cleanup_eligible_at is not null)
  )
);
create index foundation_intake_triage_seal_cleanup_idx
  on public.foundation_intake_triage_seal_attempts(cleanup_eligible_at, state)
  where cleanup_eligible_at is not null;

create index foundation_intake_triage_stages_batch_idx
  on public.foundation_intake_triage_stages(workspace_key, actor_user_id, batch_id, created_at);
create index foundation_intake_triage_stages_expiry_idx
  on public.foundation_intake_triage_stages(expires_at, staging_cleanup_done_at, sealed_cleanup_done_at);

alter table public.foundation_intake_triage_receipts enable row level security;
alter table public.foundation_intake_triage_stages enable row level security;
alter table public.foundation_intake_triage_seal_attempts enable row level security;
revoke all on public.foundation_intake_triage_receipts from public, anon, authenticated, service_role;
grant select on public.foundation_intake_triage_receipts to service_role;
revoke all on public.foundation_intake_triage_stages from public, anon, authenticated, service_role;
grant select on public.foundation_intake_triage_stages to service_role;
revoke all on public.foundation_intake_triage_seal_attempts from public, anon, authenticated, service_role;
grant select on public.foundation_intake_triage_seal_attempts to service_role;

create function public.foundation_intake_triage_receipt_immutable_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'foundation_intake_triage_receipt_immutable';
end;
$$;

create trigger foundation_intake_triage_receipt_immutable_trigger
before update or delete on public.foundation_intake_triage_receipts
for each row execute function public.foundation_intake_triage_receipt_immutable_guard();

-- Internal server authority. Call only after authentication, bounded byte hashing, the write
-- capability's expiry, object HEAD/version checks, user review, and estimate-scope validation.
create function public.create_foundation_intake_triage_receipt(
  p_workspace_key text,
  p_actor_user_id uuid,
  p_source_kind text,
  p_source_id text,
  p_inventory_revision text,
  p_triage_version text,
  p_inventory_digest text,
  p_configuration_revision text,
  p_pricing_fingerprint text,
  p_inventory jsonb,
  p_estimate jsonb,
  p_file_bindings jsonb,
  p_approval_ready boolean,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.foundation_intake_triage_receipts%rowtype;
  v_binding jsonb;
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_actor_user_id is null
    or p_source_kind <> 'direct_upload' or coalesce(p_source_id, '') = ''
    or p_inventory_revision !~ '^sha256:[a-f0-9]{64}$'
    or p_triage_version <> 'tavonel-intake-triage-v1'
    or p_inventory_digest !~ '^sha256:[a-f0-9]{64}$'
    or coalesce(p_configuration_revision, '') = ''
    or p_pricing_fingerprint !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(p_inventory) <> 'object' or jsonb_typeof(p_estimate) <> 'object'
    or jsonb_typeof(p_file_bindings) <> 'array'
    or jsonb_array_length(p_file_bindings) not between 1 and 128
    or p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > pg_catalog.clock_timestamp() + interval '10 minutes' then
    raise exception 'foundation_intake_triage_receipt_invalid';
  end if;
  if p_approval_ready and (p_inventory->>'approvalReady' is distinct from 'true'
    or not public.foundation_intake_customer_charge_complete(p_inventory, p_estimate, p_pricing_fingerprint)
    or jsonb_typeof(p_inventory->'selectedFileKeys') <> 'array'
    or jsonb_array_length(p_inventory->'selectedFileKeys') < 1) then
    raise exception 'foundation_intake_triage_receipt_unready';
  end if;
  for v_binding in select value from jsonb_array_elements(p_file_bindings) as x(value)
  loop
    if coalesce(v_binding->>'fileKey', '') !~ '^[A-Za-z0-9_-]{8,128}$'
      or coalesce(v_binding->>'documentId', '') !~ '^[0-9a-f-]{36}$'
      or v_binding->>'objectKey' is distinct from
        'quarantine/' || p_workspace_key || '/' || (v_binding->>'documentId') || '/source'
      or coalesce(v_binding->>'objectVersion', '') = ''
      or coalesce(v_binding->>'stageId', '') !~ '^[0-9a-f-]{36}$'
      or coalesce(v_binding->>'preflightApprovalId', '') !~ '^[0-9a-f-]{36}$'
      or v_binding->>'stagingKey' is distinct from
        'quarantine/' || p_workspace_key || '/triage-staging/' || (v_binding->>'stageId') || '/upload'
      or v_binding->>'sealed' is distinct from 'true'
      or v_binding->>'sealMode' is distinct from 'server_only_copy_v1'
      or nullif(v_binding->>'stagingWriteExpiresAt', '')::timestamptz is null
      or nullif(v_binding->>'sealedAt', '')::timestamptz is null
      or nullif(v_binding->>'sealedAt', '')::timestamptz > pg_catalog.clock_timestamp() then
      raise exception 'foundation_intake_triage_object_unsealed';
    end if;
    if not exists (
      select 1 from public.foundation_intake_triage_stages s
       where s.stage_id = (v_binding->>'stageId')::uuid
         and s.workspace_key = p_workspace_key and s.actor_user_id = p_actor_user_id
         and s.batch_id = p_source_id::uuid and s.state = 'sealed'
         and s.stage_id::text = v_binding->>'stageId'
         and s.preflight_approval_id::text = v_binding->>'preflightApprovalId'
         and s.document_id::text = v_binding->>'documentId'
         and s.staging_key = v_binding->>'stagingKey'
         and s.sealed_source_key = v_binding->>'objectKey'
         and s.file_key = v_binding->>'fileKey'
         and coalesce(s.object_etag, '') = v_binding->>'objectVersion'
         and s.seal_mode = v_binding->>'sealMode'
         and s.upload_expires_at = (v_binding->>'stagingWriteExpiresAt')::timestamptz
         and s.sealed_at = (v_binding->>'sealedAt')::timestamptz
         and s.expires_at > pg_catalog.clock_timestamp()
         and exists (select 1 from public.foundation_intake_triage_seal_attempts a
           where a.stage_id = s.stage_id and a.document_id = s.document_id
             and a.seal_token = s.seal_token and a.fence_generation = s.fence_generation
             and a.object_key = s.sealed_source_key and a.state = 'accepted'
             and a.accepted_at = s.sealed_at
             and a.object_etag = v_binding->>'objectVersion'
             and exists (select 1 from jsonb_array_elements(p_inventory->'files') as f(value)
               where value->>'fileKey' = v_binding->>'fileKey'
                 and value->>'contentSha256' = a.content_sha256
                 and (value->>'byteLength')::integer = a.byte_length))
         and exists (select 1 from public.foundation_intake_preflight_approvals p
           where p.preflight_approval_id = s.preflight_approval_id
             and p.workspace_key = p_workspace_key and p.actor_user_id = p_actor_user_id
             and p.batch_id = s.batch_id and p.approval_stage = 'preflight'
             and p.budget_scope = 'bounded_bytes_and_file_count' and p.provider_calls = 0
             and p.monetary_cost_status = 'not_priced'
             and s.stage_id = any(p.selected_stage_ids)
             and p.expires_at > pg_catalog.clock_timestamp())
         and (s.triage_receipt_id is null or exists (
           select 1 from public.foundation_intake_triage_receipts prior
            where prior.receipt_id = s.triage_receipt_id
              and prior.workspace_key = p_workspace_key and prior.actor_user_id = p_actor_user_id
              and prior.source_kind = p_source_kind and prior.source_id = p_source_id
              and prior.inventory_digest = p_inventory_digest
         ))
    ) then raise exception 'foundation_intake_triage_stage_scope'; end if;
  end loop;
  insert into public.foundation_intake_triage_receipts (
    workspace_key, actor_user_id, source_kind, source_id, inventory_revision,
    triage_version, inventory_digest, configuration_revision, pricing_fingerprint,
    inventory, estimate, file_bindings, approval_ready, expires_at
  ) values (
    p_workspace_key, p_actor_user_id, p_source_kind, p_source_id, p_inventory_revision,
    p_triage_version, p_inventory_digest, p_configuration_revision, p_pricing_fingerprint,
    p_inventory, p_estimate, p_file_bindings, p_approval_ready, p_expires_at
  ) on conflict (workspace_key, actor_user_id, source_kind, source_id, inventory_revision,
    triage_version, inventory_digest, configuration_revision, pricing_fingerprint) do nothing;
  select * into v_receipt from public.foundation_intake_triage_receipts r
   where r.workspace_key = p_workspace_key and r.actor_user_id = p_actor_user_id
     and r.source_kind = p_source_kind and r.source_id = p_source_id
     and r.inventory_revision = p_inventory_revision and r.triage_version = p_triage_version
     and r.inventory_digest = p_inventory_digest and r.configuration_revision = p_configuration_revision
     and r.pricing_fingerprint = p_pricing_fingerprint;
  if not found or v_receipt.inventory is distinct from p_inventory
    or v_receipt.estimate is distinct from p_estimate or v_receipt.file_bindings is distinct from p_file_bindings
    or v_receipt.approval_ready is distinct from p_approval_ready then
    raise exception 'foundation_intake_triage_receipt_conflict';
  end if;
  update public.foundation_intake_triage_stages s
     set triage_receipt_id = v_receipt.receipt_id
   where s.stage_id in (
     select (value->>'stageId')::uuid from jsonb_array_elements(v_receipt.file_bindings) as x(value)
   ) and s.workspace_key = p_workspace_key and s.actor_user_id = p_actor_user_id
     and s.triage_receipt_id is null;
  if exists (
    select 1 from jsonb_array_elements(v_receipt.file_bindings) as x(value)
     join public.foundation_intake_triage_stages s on s.stage_id = (value->>'stageId')::uuid
    where s.triage_receipt_id is distinct from v_receipt.receipt_id
  ) then raise exception 'foundation_intake_triage_stage_scope'; end if;
  return jsonb_build_object(
    'receiptId', v_receipt.receipt_id, 'workspaceKey', v_receipt.workspace_key,
    'actorUserId', v_receipt.actor_user_id, 'sourceKind', v_receipt.source_kind,
    'sourceId', v_receipt.source_id, 'inventoryRevision', v_receipt.inventory_revision,
    'triageVersion', v_receipt.triage_version, 'inventoryDigest', v_receipt.inventory_digest,
    'configurationRevision', v_receipt.configuration_revision,
    'pricingFingerprint', v_receipt.pricing_fingerprint, 'inventory', v_receipt.inventory,
    'estimate', v_receipt.estimate, 'fileBindings', v_receipt.file_bindings,
    'approvalReady', v_receipt.approval_ready, 'expiresAt', v_receipt.expires_at
  );
end;
$$;

create function public.read_foundation_intake_triage_receipt(
  p_workspace_key text, p_actor_user_id uuid, p_receipt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_receipt public.foundation_intake_triage_receipts%rowtype;
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  select * into v_receipt from public.foundation_intake_triage_receipts r
   where r.receipt_id = p_receipt_id and r.workspace_key = p_workspace_key
     and r.actor_user_id = p_actor_user_id;
  if not found then raise exception 'foundation_intake_triage_receipt_not_found'; end if;
  return jsonb_build_object(
    'receiptId', v_receipt.receipt_id, 'workspaceKey', v_receipt.workspace_key,
    'actorUserId', v_receipt.actor_user_id, 'sourceKind', v_receipt.source_kind,
    'sourceId', v_receipt.source_id, 'inventoryRevision', v_receipt.inventory_revision,
    'triageVersion', v_receipt.triage_version, 'inventoryDigest', v_receipt.inventory_digest,
    'configurationRevision', v_receipt.configuration_revision,
    'pricingFingerprint', v_receipt.pricing_fingerprint, 'inventory', v_receipt.inventory,
    'estimate', v_receipt.estimate, 'fileBindings', v_receipt.file_bindings,
    'approvalReady', v_receipt.approval_ready, 'expiresAt', v_receipt.expires_at
  );
end;
$$;

-- The URL writes only this staging key. The final source key is never presigned to the browser.
create function public.create_foundation_intake_triage_stage(
  p_workspace_key text, p_actor_user_id uuid, p_batch_id uuid, p_stage_id uuid,
  p_document_id uuid, p_idempotency_key uuid, p_relative_path text,
  p_original_filename text, p_declared_mime_type text, p_requested_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage public.foundation_intake_triage_stages%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_count integer;
  v_bytes bigint;
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_actor_user_id is null
    or p_batch_id is null or p_stage_id is null or p_document_id is null or p_idempotency_key is null
    or coalesce(p_relative_path, '') = '' or char_length(p_relative_path) > 1024
    or p_relative_path ~ '(^/|(^|/)\.\.(/|$)|(^|/)\.(/|$))'
    or coalesce(p_original_filename, '') = '' or char_length(p_original_filename) > 255
    or coalesce(p_declared_mime_type, '') !~ '^[A-Za-z0-9][A-Za-z0-9!#&^_.+-]{0,78}/[A-Za-z0-9][A-Za-z0-9!#&^_.+-]{0,78}$'
    or p_requested_bytes not between 1 and 5242880 then
    raise exception 'foundation_intake_triage_stage_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'foundation-intake-triage-stage:' || p_workspace_key || ':' || p_actor_user_id::text, 0));
  select * into v_stage from public.foundation_intake_triage_stages s
    where s.workspace_key = p_workspace_key and s.actor_user_id = p_actor_user_id
      and s.idempotency_key = p_idempotency_key for update;
  if found then
    if v_stage.batch_id is distinct from p_batch_id or v_stage.relative_path is distinct from p_relative_path
      or v_stage.original_filename is distinct from p_original_filename
      or v_stage.declared_mime_type is distinct from p_declared_mime_type
      or v_stage.requested_bytes is distinct from p_requested_bytes then
      raise exception 'foundation_intake_triage_stage_conflict';
    end if;
    if v_stage.expires_at <= v_now then raise exception 'foundation_intake_triage_stage_expired'; end if;
  else
    select pg_catalog.count(*), coalesce(pg_catalog.sum(s.requested_bytes), 0)::bigint
      into v_count, v_bytes from public.foundation_intake_triage_stages s
     where s.workspace_key = p_workspace_key and s.actor_user_id = p_actor_user_id
       and s.expires_at > v_now and s.state in ('issued', 'sealing', 'sealed');
    if v_count >= 128 or v_bytes + p_requested_bytes > 128::bigint * 5242880 then
      raise exception 'foundation_intake_triage_stage_quota';
    end if;
    insert into public.foundation_intake_triage_stages (
      stage_id, batch_id, workspace_key, actor_user_id, idempotency_key, document_id,
      relative_path, original_filename, declared_mime_type, requested_bytes,
      staging_key, sealed_source_key, state, created_at, upload_expires_at, expires_at, staging_cleanup_at
    ) values (
      p_stage_id, p_batch_id, p_workspace_key, p_actor_user_id, p_idempotency_key, p_document_id,
      p_relative_path, p_original_filename, p_declared_mime_type, p_requested_bytes,
      'quarantine/' || p_workspace_key || '/triage-staging/' || p_stage_id::text || '/upload',
      'quarantine/' || p_workspace_key || '/' || p_document_id::text || '/source', 'issued', v_now,
      v_now + interval '120 seconds', v_now + interval '15 minutes', v_now + interval '130 seconds'
    ) returning * into v_stage;
  end if;
  return pg_catalog.jsonb_build_object(
    'stageId', v_stage.stage_id, 'batchId', v_stage.batch_id,
    'workspaceKey', v_stage.workspace_key, 'actorUserId', v_stage.actor_user_id,
    'documentId', v_stage.document_id, 'relativePath', v_stage.relative_path,
    'originalFilename', v_stage.original_filename, 'declaredMimeType', v_stage.declared_mime_type,
    'requestedBytes', v_stage.requested_bytes, 'stagingKey', v_stage.staging_key,
    'sealedSourceKey', v_stage.sealed_source_key, 'state', v_stage.state,
    'createdAt', v_stage.created_at, 'uploadExpiresAt', v_stage.upload_expires_at,
    'expiresAt', v_stage.expires_at
  );
end;
$$;

create function public.read_foundation_intake_triage_stages(
  p_workspace_key text, p_actor_user_id uuid, p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows jsonb;
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'stageId', s.stage_id, 'batchId', s.batch_id,
    'workspaceKey', s.workspace_key, 'actorUserId', s.actor_user_id,
    'documentId', s.document_id, 'relativePath', s.relative_path,
    'originalFilename', s.original_filename, 'declaredMimeType', s.declared_mime_type,
    'requestedBytes', s.requested_bytes, 'stagingKey', s.staging_key,
    'preflightApprovalId', s.preflight_approval_id,
    'sealedSourceKey', s.sealed_source_key, 'state', s.state, 'sealToken', s.seal_token,
    'fileKey', s.file_key, 'contentSha256', s.content_sha256, 'objectEtag', s.object_etag,
    'signature', s.signature, 'sealMode', s.seal_mode, 'sealedAt', s.sealed_at, 'uploadExpiresAt', s.upload_expires_at,
    'expiresAt', s.expires_at, 'triageReceiptId', s.triage_receipt_id
  ) order by s.created_at, s.stage_id), '[]'::jsonb)
    into v_rows from public.foundation_intake_triage_stages s
   where s.workspace_key = p_workspace_key and s.actor_user_id = p_actor_user_id and s.batch_id = p_batch_id;
  if pg_catalog.jsonb_array_length(v_rows) = 0 then raise exception 'foundation_intake_triage_stage_not_found'; end if;
  return pg_catalog.jsonb_build_object('stages', v_rows);
end;
$$;

create function public.claim_foundation_intake_triage_stage_seal(
  p_workspace_key text, p_actor_user_id uuid, p_stage_id uuid, p_seal_token uuid,
  p_preflight_approval_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_stage public.foundation_intake_triage_stages%rowtype; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  select * into v_stage from public.foundation_intake_triage_stages s
   where s.stage_id = p_stage_id and s.workspace_key = p_workspace_key and s.actor_user_id = p_actor_user_id
   for update;
  if not found then raise exception 'foundation_intake_triage_stage_not_found'; end if;
  if v_stage.expires_at <= v_now then raise exception 'foundation_intake_triage_stage_expired'; end if;
  if v_stage.preflight_approval_id is distinct from p_preflight_approval_id
    or not exists (select 1 from public.foundation_intake_preflight_approvals a
      where a.preflight_approval_id = p_preflight_approval_id
        and a.workspace_key = p_workspace_key and a.actor_user_id = p_actor_user_id
        and a.batch_id = v_stage.batch_id and a.approval_stage = 'preflight'
        and a.budget_scope = 'bounded_bytes_and_file_count' and a.provider_calls = 0
        and a.monetary_cost_status = 'not_priced'
        and v_stage.stage_id = any(a.selected_stage_ids)
        and a.expires_at > v_now) then
    raise exception 'foundation_intake_preflight_required';
  end if;
  if v_stage.state = 'sealed' then
    return pg_catalog.jsonb_build_object(
      'stageId', v_stage.stage_id, 'batchId', v_stage.batch_id,
      'preflightApprovalId',v_stage.preflight_approval_id,
      'workspaceKey', v_stage.workspace_key, 'actorUserId', v_stage.actor_user_id,
      'documentId', v_stage.document_id, 'relativePath', v_stage.relative_path,
      'originalFilename', v_stage.original_filename, 'declaredMimeType', v_stage.declared_mime_type,
      'requestedBytes', v_stage.requested_bytes, 'stagingKey', v_stage.staging_key,
      'sealedSourceKey', v_stage.sealed_source_key, 'state', v_stage.state,
      'fileKey', v_stage.file_key, 'contentSha256', v_stage.content_sha256,
      'objectEtag', v_stage.object_etag, 'signature', v_stage.signature, 'sealedAt', v_stage.sealed_at,
      'uploadExpiresAt', v_stage.upload_expires_at, 'expiresAt', v_stage.expires_at
    );
  end if;
  if v_stage.state = 'sealing' and v_stage.seal_lease_until > v_now then
    raise exception 'foundation_intake_triage_stage_busy';
  end if;
  if v_stage.state = 'sealing' then
    update public.foundation_intake_triage_seal_attempts set state = 'orphan',
      cleanup_eligible_at = greatest(v_stage.seal_lease_until, v_now) + interval '1 day'
     where seal_token = v_stage.seal_token and state = 'active';
  end if;
  if exists (select 1 from public.foundation_intake_triage_seal_attempts a where a.seal_token = p_seal_token) then
    raise exception 'foundation_intake_seal_attempt_conflict';
  end if;
  update public.foundation_intake_triage_stages set state = 'sealing', seal_token = p_seal_token,
    document_id = p_seal_token,
    sealed_source_key = 'quarantine/' || p_workspace_key || '/' || p_seal_token::text || '/source',
    fence_generation = fence_generation + 1,
    seal_lease_until = v_now + interval '60 seconds'
   where stage_id = p_stage_id returning * into v_stage;
  insert into public.foundation_intake_triage_seal_attempts (
    seal_token,stage_id,workspace_key,actor_user_id,document_id,object_key,lease_until,fence_generation,state,cleanup_eligible_at
  ) values (
    p_seal_token,v_stage.stage_id,p_workspace_key,p_actor_user_id,v_stage.document_id,
    v_stage.sealed_source_key,v_stage.seal_lease_until,v_stage.fence_generation,'active',
    v_stage.seal_lease_until + interval '1 day'
  );
  return pg_catalog.jsonb_build_object(
    'stageId', v_stage.stage_id, 'batchId', v_stage.batch_id,
    'preflightApprovalId',v_stage.preflight_approval_id,
    'workspaceKey', v_stage.workspace_key, 'actorUserId', v_stage.actor_user_id,
    'documentId', v_stage.document_id, 'relativePath', v_stage.relative_path,
    'originalFilename', v_stage.original_filename, 'declaredMimeType', v_stage.declared_mime_type,
    'requestedBytes', v_stage.requested_bytes, 'stagingKey', v_stage.staging_key,
    'sealedSourceKey', v_stage.sealed_source_key, 'state', v_stage.state,
    'sealToken', v_stage.seal_token, 'sealLeaseUntil', v_stage.seal_lease_until,
    'fenceGeneration', v_stage.fence_generation
  );
end;
$$;

create function public.finish_foundation_intake_triage_stage_seal(
  p_workspace_key text, p_actor_user_id uuid, p_stage_id uuid, p_seal_token uuid, p_fence_generation bigint,
  p_file_key text, p_content_sha256 text, p_object_etag text, p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_stage public.foundation_intake_triage_stages%rowtype; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  select * into v_stage from public.foundation_intake_triage_stages s
   where s.stage_id = p_stage_id and s.workspace_key = p_workspace_key and s.actor_user_id = p_actor_user_id
   for update;
  if not found then raise exception 'foundation_intake_triage_stage_not_found'; end if;
  if v_stage.state = 'sealed' then
    if v_stage.file_key is distinct from p_file_key or v_stage.content_sha256 is distinct from p_content_sha256 then
      raise exception 'foundation_intake_triage_stage_conflict';
    end if;
  else
    if v_stage.state is distinct from 'sealing' or v_stage.seal_token is distinct from p_seal_token
      or v_stage.document_id is distinct from p_seal_token
      or v_stage.fence_generation is distinct from p_fence_generation
      or v_stage.seal_lease_until <= v_now then
      raise exception 'foundation_intake_triage_seal_token_stale';
    end if;
    if p_file_key !~ '^[A-Za-z0-9_-]{8,128}$' or p_content_sha256 !~ '^sha256:[a-f0-9]{64}$'
      or p_signature not in ('valid','mismatch') then
      raise exception 'foundation_intake_triage_stage_invalid';
    end if;
    if not exists (select 1 from public.foundation_intake_triage_seal_attempts a
      where a.seal_token = p_seal_token and a.stage_id = p_stage_id
        and a.workspace_key = p_workspace_key and a.actor_user_id = p_actor_user_id
        and a.fence_generation = p_fence_generation
        and a.document_id = p_seal_token and a.object_key = v_stage.sealed_source_key
        and a.lease_until > v_now and a.state = 'active') then
      raise exception 'foundation_intake_triage_seal_token_stale';
    end if;
    update public.foundation_intake_triage_stages set state = 'sealed', seal_mode = 'server_only_copy_v1', file_key = p_file_key,
      content_sha256 = p_content_sha256, object_etag = p_object_etag, signature = p_signature,
      sealed_at = v_now, seal_lease_until = null, sealed_cleanup_at = expires_at + interval '1 day'
     where stage_id = p_stage_id returning * into v_stage;
    update public.foundation_intake_triage_seal_attempts set state = 'accepted',
      content_sha256 = p_content_sha256, byte_length = v_stage.requested_bytes,
      object_etag = p_object_etag, accepted_at = v_now, cleanup_eligible_at = v_stage.expires_at + interval '1 day'
     where seal_token = p_seal_token and stage_id = p_stage_id
       and fence_generation = p_fence_generation and state = 'active';
  end if;
  return pg_catalog.jsonb_build_object(
    'stageId', v_stage.stage_id, 'batchId', v_stage.batch_id,
    'workspaceKey', v_stage.workspace_key, 'actorUserId', v_stage.actor_user_id,
    'documentId', v_stage.document_id, 'relativePath', v_stage.relative_path,
    'originalFilename', v_stage.original_filename, 'declaredMimeType', v_stage.declared_mime_type,
    'requestedBytes', v_stage.requested_bytes, 'sealedSourceKey', v_stage.sealed_source_key,
    'state', v_stage.state, 'fileKey', v_stage.file_key, 'contentSha256', v_stage.content_sha256,
    'objectEtag', v_stage.object_etag, 'signature', v_stage.signature, 'sealMode', v_stage.seal_mode, 'sealedAt', v_stage.sealed_at,
    'uploadExpiresAt', v_stage.upload_expires_at, 'expiresAt', v_stage.expires_at
  );
end;
$$;

create function public.foundation_intake_approval_triage_binding_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.foundation_intake_triage_receipts%rowtype;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if row(new.triage_receipt_id, new.triage_version, new.triage_inventory_digest, new.configuration_revision,
      new.approval_stage, new.budget_scope)
     is not distinct from
     row(old.triage_receipt_id, old.triage_version, old.triage_inventory_digest, old.configuration_revision,
      old.approval_stage, old.budget_scope) then
    return new;
  end if;
  if old.triage_receipt_id is not null or old.triage_version is not null
     or old.triage_inventory_digest is not null or old.configuration_revision is not null
     or old.approval_stage is not null or old.budget_scope is not null
     or new.triage_receipt_id is null or new.triage_version is null
     or new.triage_inventory_digest is null or new.configuration_revision is null
     or new.approval_stage is distinct from 'full_processing'
     or new.budget_scope is distinct from 'entire_affected_compile_request'
     or old.state is distinct from new.state then
    raise exception 'foundation_intake_triage_binding_immutable';
  end if;
  select * into v_receipt from public.foundation_intake_triage_receipts r
   where r.receipt_id = new.triage_receipt_id
     and r.workspace_key = new.workspace_key
     and r.actor_user_id = new.user_id
     and r.triage_version = new.triage_version
     and r.inventory_digest = new.triage_inventory_digest
     and r.configuration_revision = new.configuration_revision
     and r.pricing_fingerprint = new.pricing_fingerprint
     and r.approval_ready
     and r.expires_at > pg_catalog.clock_timestamp();
  if not found then
    raise exception 'foundation_intake_triage_receipt_stale_or_unready';
  end if;
  return new;
end;
$$;

alter table public.foundation_intake_approvals
  add column triage_receipt_id uuid references public.foundation_intake_triage_receipts(receipt_id) on delete restrict,
  add column triage_version text,
  add column triage_inventory_digest text,
  add column configuration_revision text,
  add column approval_stage text,
  add column budget_scope text,
  add constraint foundation_intake_approval_triage_fields_check check (
    (triage_receipt_id is null and triage_version is null
      and triage_inventory_digest is null and configuration_revision is null)
    or (triage_receipt_id is not null and triage_version is not null
      and triage_version = 'tavonel-intake-triage-v1'
      and triage_inventory_digest is not null
      and triage_inventory_digest ~ '^sha256:[a-f0-9]{64}$'
      and configuration_revision is not null and char_length(configuration_revision) between 1 and 128)),
  add constraint foundation_intake_approval_stage_scope_check check (
    (approval_stage is null and budget_scope is null)
    or (approval_stage = 'full_processing' and budget_scope = 'entire_affected_compile_request')
  );

create trigger foundation_intake_approval_triage_binding_trigger
before update or delete on public.foundation_intake_approvals
for each row execute function public.foundation_intake_approval_triage_binding_guard();

revoke all on function public.foundation_intake_triage_receipt_immutable_guard() from public, anon, authenticated, service_role;
revoke all on function public.foundation_intake_approval_triage_binding_guard() from public, anon, authenticated, service_role;

-- Patch the existing create RPC's file insert to honor a document ID only when v2 supplies it
-- from a stored, server-created sealed receipt. The legacy route does not provide this field and
-- still gets a random ID; the reservation backstop below refuses its NULL triage binding.
do $$
declare
  v_definition text;
  v_old text := 'select v_approval_id, value->>''fileKey'', gen_random_uuid(), value->>''contentSha256'',';
  v_new text := 'select v_approval_id, value->>''fileKey'', coalesce(nullif(value->>''documentId'', '''')::uuid, gen_random_uuid()), value->>''contentSha256'',';
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.create_foundation_intake_approval(text,uuid,text,text,text,integer,jsonb)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(v_definition, v_new) > 0 then return; end if;
  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'foundation_intake_triage_create_rpc_preimage_unexpected';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$$;

create function public.create_foundation_intake_approval_v2(
  p_workspace_key text, p_user_id uuid, p_attempt_key text,
  p_client_manifest_digest text, p_pricing_fingerprint text,
  p_aggregate_maximum_credits integer, p_files jsonb, p_triage_receipt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.foundation_intake_triage_receipts%rowtype;
  v_created jsonb;
  v_approval public.foundation_intake_approvals%rowtype;
  v_files jsonb;
  v_count integer;
  v_key text;
  v_entry jsonb;
  v_observed jsonb;
  v_binding jsonb;
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  select * into v_receipt from public.foundation_intake_triage_receipts r
   where r.receipt_id = p_triage_receipt_id and r.workspace_key = p_workspace_key
     and r.actor_user_id = p_user_id for share;
  if not found then raise exception 'foundation_intake_triage_receipt_not_found'; end if;
  if v_receipt.expires_at <= pg_catalog.clock_timestamp()
    or v_receipt.pricing_fingerprint is distinct from p_pricing_fingerprint then
    raise exception 'foundation_intake_triage_receipt_stale';
  end if;
  if not v_receipt.approval_ready or not public.foundation_intake_customer_charge_complete(
    v_receipt.inventory, v_receipt.estimate, v_receipt.pricing_fingerprint) then
    raise exception 'foundation_intake_triage_receipt_unready';
  end if;
  select pg_catalog.jsonb_array_length(p_files) into v_count;
  if v_count < 1 or v_count > 128
    or v_count <> pg_catalog.jsonb_array_length(v_receipt.inventory->'selectedFileKeys') then
    raise exception 'foundation_intake_triage_receipt_scope';
  end if;
  for v_entry in select value from pg_catalog.jsonb_array_elements(p_files) as x(value)
  loop
    v_key := v_entry->>'fileKey';
    select value into v_observed from pg_catalog.jsonb_array_elements(v_receipt.inventory->'files') as x(value)
     where value->>'fileKey' = v_key and value->>'disposition' = 'include';
    select value into v_binding from pg_catalog.jsonb_array_elements(v_receipt.file_bindings) as x(value)
     where value->>'fileKey' = v_key;
    if v_observed is null or v_binding is null
      or v_observed->>'digestEvidence' is distinct from 'server_verified'
      or v_observed->>'contentSha256' is distinct from v_entry->>'contentSha256'
      or (v_observed->>'byteLength')::integer is distinct from (v_entry->>'byteLength')::integer
      or v_observed->>'mimeType' is distinct from v_entry->>'mimeType'
      or v_binding->>'objectKey' is distinct from
         'quarantine/' || p_workspace_key || '/' || (v_binding->>'documentId') || '/source'
      or coalesce(v_binding->>'stageId', '') !~ '^[0-9a-f-]{36}$'
      or v_binding->>'stagingKey' is distinct from
        'quarantine/' || p_workspace_key || '/triage-staging/' || (v_binding->>'stageId') || '/upload'
      or nullif(v_binding->>'sealedAt', '')::timestamptz > pg_catalog.clock_timestamp() then
      raise exception 'foundation_intake_triage_receipt_scope';
    end if;
    v_entry := v_entry || pg_catalog.jsonb_build_object('documentId', v_binding->>'documentId');
    v_files := coalesce(v_files, '[]'::jsonb) || pg_catalog.jsonb_build_array(v_entry);
  end loop;
  v_created := public.create_foundation_intake_approval(
    p_workspace_key, p_user_id, p_attempt_key, p_client_manifest_digest,
    p_pricing_fingerprint, p_aggregate_maximum_credits, v_files
  );
  select * into v_approval from public.foundation_intake_approvals a
   where a.workspace_key = p_workspace_key and a.attempt_key = p_attempt_key for update;
  if not found then raise exception 'foundation_intake_approval_invalid'; end if;
  if v_approval.triage_receipt_id is not null then
    if v_approval.triage_receipt_id is distinct from v_receipt.receipt_id then
      raise exception 'foundation_intake_approval_conflict';
    end if;
  else
    if coalesce((v_created->>'idempotentReplay')::boolean, false) then
      raise exception 'foundation_intake_triage_legacy_reapproval_required';
    end if;
    update public.foundation_intake_approvals set
      triage_receipt_id = v_receipt.receipt_id,
      triage_version = v_receipt.triage_version,
      triage_inventory_digest = v_receipt.inventory_digest,
      configuration_revision = v_receipt.configuration_revision,
      approval_stage = 'full_processing',
      budget_scope = 'entire_affected_compile_request'
      where approval_id = v_approval.approval_id;
  end if;
  return v_created || pg_catalog.jsonb_build_object(
    'triageReceiptId', v_receipt.receipt_id, 'triageVersion', v_receipt.triage_version,
    'triageInventoryDigest', v_receipt.inventory_digest,
    'configurationRevision', v_receipt.configuration_revision
  );
end;
$$;

create function public.read_foundation_intake_approval_v2(
  p_workspace_key text, p_user_id uuid, p_attempt_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_approval public.foundation_intake_approvals%rowtype;
begin
  v_payload := public.read_foundation_intake_approval(p_workspace_key, p_user_id, p_attempt_key);
  select * into v_approval from public.foundation_intake_approvals a
   where a.workspace_key = p_workspace_key and a.user_id = p_user_id and a.attempt_key = p_attempt_key;
  if not found then raise exception 'foundation_intake_approval_not_found'; end if;
  return v_payload || pg_catalog.jsonb_build_object(
    'triageLineageVersion', 1,
    'triageReceiptId', v_approval.triage_receipt_id, 'triageVersion', v_approval.triage_version,
    'triageInventoryDigest', v_approval.triage_inventory_digest,
    'configurationRevision', v_approval.configuration_revision,
    'approvalStage', coalesce(v_approval.approval_stage, 'legacy'),
    'budgetScope', v_approval.budget_scope
  );
end;
$$;

create function public.foundation_intake_triage_reservation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.foundation_intake_approval_files%rowtype;
  v_approval public.foundation_intake_approvals%rowtype;
  v_receipt public.foundation_intake_triage_receipts%rowtype;
begin
  if tg_op <> 'INSERT' then return new; end if;
  if not public.foundation_intake_triage_rollout_enabled() then return new; end if;
  select * into v_file from public.foundation_intake_approval_files f where f.document_id = new.document_id;
  if not found then return new; end if;
  select * into v_approval from public.foundation_intake_approvals a where a.approval_id = v_file.approval_id;
  if v_approval.triage_receipt_id is null then raise exception 'foundation_intake_triage_required'; end if;
  if v_approval.approval_stage is distinct from 'full_processing'
    or v_approval.budget_scope is distinct from 'entire_affected_compile_request' then
    raise exception 'foundation_intake_full_processing_approval_required';
  end if;
  if v_approval.approval_stage is distinct from 'full_processing'
    or v_approval.budget_scope is distinct from 'entire_affected_compile_request' then
    raise exception 'foundation_intake_full_processing_approval_required';
  end if;
  select * into v_receipt from public.foundation_intake_triage_receipts r
   where r.receipt_id = v_approval.triage_receipt_id and r.workspace_key = v_approval.workspace_key
     and r.actor_user_id = v_approval.user_id and r.triage_version = v_approval.triage_version
     and r.inventory_digest = v_approval.triage_inventory_digest
     and r.configuration_revision = v_approval.configuration_revision
     and r.pricing_fingerprint = v_approval.pricing_fingerprint and r.approval_ready
     and r.expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'foundation_intake_triage_receipt_stale'; end if;
  if not exists (select 1 from pg_catalog.jsonb_array_elements(v_receipt.file_bindings) as x(value)
    where value->>'fileKey' = v_file.file_key and value->>'documentId' = v_file.document_id::text
      and value->>'sealed' = 'true'
      and coalesce(value->>'stageId', '') ~ '^[0-9a-f-]{36}$'
      and value->>'stagingKey' = 'quarantine/' || v_approval.workspace_key || '/triage-staging/' || (value->>'stageId') || '/upload'
      and nullif(value->>'sealedAt', '')::timestamptz <= pg_catalog.clock_timestamp()) then
    raise exception 'foundation_intake_triage_object_unsealed';
  end if;
  return new;
end;
$$;

create trigger foundation_intake_triage_reservation_trigger
before insert on public.foundation_compute_reservations
for each row execute function public.foundation_intake_triage_reservation_guard();

-- Route-facing reservation wrapper: unlike a BEFORE INSERT guard, this also blocks replay of an
-- existing hold for a stale/legacy approval. Read/cancel/reconcile/settle paths remain separate.
create function public.reserve_foundation_intake_approved_file_v2(
  p_workspace_key text, p_user_id uuid, p_attempt_key text,
  p_scope_digest text, p_pricing_fingerprint text, p_file_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.foundation_intake_approvals%rowtype;
  v_receipt public.foundation_intake_triage_receipts%rowtype;
  v_file public.foundation_intake_approval_files%rowtype;
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  select * into v_approval from public.foundation_intake_approvals a
   where a.workspace_key = p_workspace_key and a.user_id = p_user_id and a.attempt_key = p_attempt_key;
  if not found then raise exception 'foundation_intake_approval_not_found'; end if;
  if v_approval.triage_receipt_id is null then raise exception 'foundation_intake_triage_required'; end if;
  select * into v_receipt from public.foundation_intake_triage_receipts r
   where r.receipt_id = v_approval.triage_receipt_id and r.workspace_key = p_workspace_key
     and r.actor_user_id = p_user_id and r.triage_version = v_approval.triage_version
     and r.inventory_digest = v_approval.triage_inventory_digest
     and r.configuration_revision = v_approval.configuration_revision
     and r.pricing_fingerprint = p_pricing_fingerprint and r.approval_ready
     and r.expires_at > pg_catalog.clock_timestamp()
     and public.foundation_intake_customer_charge_complete(r.inventory, r.estimate, r.pricing_fingerprint);
  if not found then raise exception 'foundation_intake_triage_receipt_stale'; end if;
  select * into v_file from public.foundation_intake_approval_files f
   where f.approval_id = v_approval.approval_id and f.file_key = p_file_key;
  if not found then raise exception 'foundation_intake_approval_file_out_of_scope'; end if;
  if not exists (select 1 from pg_catalog.jsonb_array_elements(v_receipt.file_bindings) as x(value)
    where value->>'fileKey' = v_file.file_key and value->>'documentId' = v_file.document_id::text
      and value->>'sealed' = 'true'
      and coalesce(value->>'stageId', '') ~ '^[0-9a-f-]{36}$'
      and value->>'stagingKey' = 'quarantine/' || p_workspace_key || '/triage-staging/' || (value->>'stageId') || '/upload'
      and nullif(value->>'sealedAt', '')::timestamptz <= pg_catalog.clock_timestamp()) then
    raise exception 'foundation_intake_triage_object_unsealed';
  end if;
  return public.reserve_foundation_intake_approved_file(
    p_workspace_key, p_user_id, p_attempt_key, p_scope_digest, p_pricing_fingerprint, p_file_key
  );
end;
$$;

create function public.assert_foundation_intake_triage_compile_set(
  p_workspace_key text, p_user_id uuid, p_document_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.foundation_intake_approvals%rowtype;
  v_compile_set jsonb;
begin
  if not public.foundation_intake_triage_rollout_enabled() then raise exception 'foundation_intake_triage_rollout_disabled'; end if;
  -- Keep the service-only triage guard aligned with the established compile-set
  -- contract. In particular, unrelated documents have no intake approval and
  -- remain eligible for the legacy/non-intake path; malformed, mixed, incomplete,
  -- or cross-principal approval sets are rejected by the baseline guard.
  v_compile_set := public.assert_foundation_intake_compile_set(
    p_workspace_key, p_user_id, p_document_ids);
  if v_compile_set->>'allowed' is distinct from 'true' then
    raise exception 'foundation_intake_approval_compile_set_invalid';
  end if;
  if v_compile_set->>'approvalRequired' = 'false' then
    return pg_catalog.jsonb_build_object('allowed', true, 'triageRequired', false);
  end if;
  if v_compile_set->>'approvalRequired' is distinct from 'true' then
    raise exception 'foundation_intake_approval_compile_set_invalid';
  end if;
  for v_approval in
    select distinct a.* from public.foundation_intake_approvals a
      join public.foundation_intake_approval_files f using (approval_id)
     where f.document_id = any(p_document_ids)
  loop
    if v_approval.workspace_key is distinct from p_workspace_key or v_approval.user_id is distinct from p_user_id then
      raise exception 'foundation_intake_triage_compile_scope';
    end if;
    if v_approval.triage_receipt_id is null then raise exception 'foundation_intake_triage_required'; end if;
    if v_approval.approval_stage is distinct from 'full_processing'
      or v_approval.budget_scope is distinct from 'entire_affected_compile_request' then
      raise exception 'foundation_intake_full_processing_approval_required';
    end if;
    if not exists (select 1 from public.foundation_intake_triage_receipts r
      where r.receipt_id = v_approval.triage_receipt_id and r.workspace_key = p_workspace_key
        and r.actor_user_id = p_user_id and r.triage_version = v_approval.triage_version
        and r.inventory_digest = v_approval.triage_inventory_digest
        and r.configuration_revision = v_approval.configuration_revision
        and r.pricing_fingerprint = v_approval.pricing_fingerprint
        and r.approval_ready and r.expires_at > pg_catalog.clock_timestamp()) then
      raise exception 'foundation_intake_triage_receipt_stale';
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('allowed', true, 'triageRequired', true);
end;
$$;

revoke all on function public.create_foundation_intake_triage_receipt(text,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean,timestamptz) from public, anon, authenticated;
revoke all on function public.foundation_intake_triage_rollout_enabled() from public, anon, authenticated, service_role;
revoke all on function public.foundation_intake_preflight_approval_immutable_guard() from public, anon, authenticated, service_role;
revoke all on function public.create_foundation_intake_preflight_approval(text,uuid,uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.read_foundation_intake_preflight_approval(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.read_foundation_intake_triage_receipt(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.create_foundation_intake_triage_stage(text,uuid,uuid,uuid,uuid,uuid,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.read_foundation_intake_triage_stages(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.claim_foundation_intake_triage_stage_seal(text,uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.finish_foundation_intake_triage_stage_seal(text,uuid,uuid,uuid,bigint,text,text,text,text) from public, anon, authenticated;
revoke all on function public.create_foundation_intake_approval_v2(text,uuid,text,text,text,integer,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.read_foundation_intake_approval_v2(text,uuid,text) from public, anon, authenticated;
revoke all on function public.reserve_foundation_intake_approved_file_v2(text,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.foundation_intake_triage_reservation_guard() from public, anon, authenticated, service_role;
revoke all on function public.assert_foundation_intake_triage_compile_set(text,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.create_foundation_intake_triage_receipt(text,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean,timestamptz) to service_role;
grant execute on function public.create_foundation_intake_preflight_approval(text,uuid,uuid,uuid,text,jsonb,timestamptz) to service_role;
grant execute on function public.read_foundation_intake_preflight_approval(text,uuid,uuid) to service_role;
grant execute on function public.read_foundation_intake_triage_receipt(text,uuid,uuid) to service_role;
grant execute on function public.create_foundation_intake_triage_stage(text,uuid,uuid,uuid,uuid,uuid,text,text,text,integer) to service_role;
grant execute on function public.read_foundation_intake_triage_stages(text,uuid,uuid) to service_role;
grant execute on function public.claim_foundation_intake_triage_stage_seal(text,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.finish_foundation_intake_triage_stage_seal(text,uuid,uuid,uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.create_foundation_intake_approval_v2(text,uuid,text,text,text,integer,jsonb,uuid) to service_role;
grant execute on function public.read_foundation_intake_approval_v2(text,uuid,text) to service_role;
grant execute on function public.reserve_foundation_intake_approved_file_v2(text,uuid,text,text,text,text) to service_role;
grant execute on function public.assert_foundation_intake_triage_compile_set(text,uuid,uuid[]) to service_role;

-- The create RPC above is service-only and does not have a route caller in this candidate.
-- Keep the RPC unexposed to clients. Before use, its caller must come from a real bounded byte
-- reader or finalized authorized connector inventory; it must not trust client JSON labelled
-- server_verified. Full source/hash and object-store seal validation remain open until that
-- caller and one-use upload boundary are implemented.

commit;
