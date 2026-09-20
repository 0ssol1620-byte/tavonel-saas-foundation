-- Two-phase adaptive-routing lineage. A decision is durable before dispatch; its measured
-- terminal outcome is a separate append-only record linked by attempt_id.
begin;

create table public.foundation_model_attempt_decisions (
  attempt_id uuid primary key,
  admitted_at timestamptz not null,
  endpoint text not null check (endpoint in ('ask', 'search')),
  attempted_role text not null check (attempted_role in ('embedder', 'reranker')),
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$'),
  meter text not null check (meter ~ '^[a-z][a-z0-9_]{1,47}$'),
  tenant_digest text not null check (tenant_digest ~ '^sha256:[a-f0-9]{64}$'),
  collection_digest text not null check (collection_digest ~ '^sha256:[a-f0-9]{64}$'),
  world_manifest_digest text not null check (world_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  input_digest text not null check (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  route_decision_digest text not null check (route_decision_digest ~ '^sha256:[a-f0-9]{64}$'),
  policy_id uuid not null,
  policy_version text not null check (policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  policy_revision bigint not null check (policy_revision > 0),
  rollout_revision bigint not null check (rollout_revision > 0),
  assignment_id uuid not null,
  policy_digest text not null check (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  evidence_digest text not null check (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  scope_digest text not null check (scope_digest ~ '^sha256:[a-f0-9]{64}$'),
  assignment_digest text not null check (assignment_digest ~ '^sha256:[a-f0-9]{64}$'),
  thresholds_digest text not null check (thresholds_digest ~ '^sha256:[a-f0-9]{64}$'),
  index_state_digest text not null check (index_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  control_id text not null check (control_id ~ '^sha256:[a-f0-9]{64}$'),
  chosen_id text not null check (chosen_id ~ '^sha256:[a-f0-9]{64}$'),
  profile_id text not null check (profile_id ~ '^.{1,200}$'),
  profile_digest text not null check (profile_digest ~ '^sha256:[a-f0-9]{64}$'),
  run_id text not null check (run_id ~ '^.{1,200}$'),
  shadow_id text check (shadow_id is null or shadow_id ~ '^.{1,200}$'),
  reservation_id uuid not null
    references public.model_provider_spend_reservations (reservation_id) on delete restrict,
  admission_id text not null check (admission_id ~ '^[A-Za-z0-9._~-]{8,128}$'),
  admission_event_id text not null
    references public.model_provider_circuit_events (event_id) on delete restrict,
  retry_of_attempt_id uuid references public.foundation_model_attempt_decisions (attempt_id),
  retry_ordinal integer not null check (retry_ordinal between 0 and 100),
  receipt jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (receipt->>'schemaVersion' = 'tavonel.model_attempt_decision.v2'),
  check ((receipt->>'attemptId')::uuid = attempt_id),
  check (admission_event_id = 'admission:' || admission_id),
  check (not (receipt ?| array['query', 'features', 'prompt', 'rawOutput', 'rawError', 'apiKey'])),
  check (octet_length(receipt::text) <= 32768)
);

create index foundation_model_attempt_decisions_lineage_idx
  on public.foundation_model_attempt_decisions (policy_id, rollout_revision, admitted_at desc);

create table public.foundation_model_attempt_outcomes (
  outcome_id uuid primary key,
  attempt_id uuid not null unique
    references public.foundation_model_attempt_decisions (attempt_id),
  completed_at timestamptz not null,
  outcome text not null check (outcome in ('succeeded', 'degraded', 'failed')),
  failure_class text not null check (failure_class in (
    'none', 'provider_unavailable', 'invalid_model_output', 'downstream_failure'
  )),
  latency_ms integer not null check (latency_ms between 0 and 86400000),
  meter text not null check (meter ~ '^.{1,80}$'),
  input_units bigint not null check (input_units >= 0),
  output_units bigint not null check (output_units >= 0),
  total_units bigint not null check (total_units >= 0),
  billed_units bigint not null check (billed_units >= 0),
  price_reference_digest text not null check (price_reference_digest ~ '^sha256:[a-f0-9]{64}$'),
  cost_usd_micros bigint not null check (cost_usd_micros >= 0),
  output_digest text not null check (output_digest ~ '^sha256:[a-f0-9]{64}$'),
  trust_reference_digest text not null check (trust_reference_digest ~ '^sha256:[a-f0-9]{64}$'),
  receipt jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (receipt->>'schemaVersion' = 'tavonel.model_attempt_outcome.v2'),
  check ((receipt->>'outcomeId')::uuid = outcome_id),
  check ((receipt->>'attemptId')::uuid = attempt_id),
  check (not (receipt ?| array['query', 'features', 'prompt', 'rawOutput', 'rawError', 'apiKey'])),
  check (octet_length(receipt::text) <= 16384)
);

create index foundation_model_attempt_outcomes_metrics_idx
  on public.foundation_model_attempt_outcomes (completed_at desc, outcome, failure_class);

alter table public.foundation_model_attempt_decisions enable row level security;
alter table public.foundation_model_attempt_outcomes enable row level security;
revoke all on public.foundation_model_attempt_decisions from public, anon, authenticated, service_role;
revoke all on public.foundation_model_attempt_outcomes from public, anon, authenticated, service_role;
grant select on public.foundation_model_attempt_decisions to service_role;
grant select on public.foundation_model_attempt_outcomes to service_role;

create trigger foundation_model_attempt_decisions_append_only
  before update or delete on public.foundation_model_attempt_decisions
  for each row execute function public.prevent_foundation_model_attempt_receipt_mutation();

create trigger foundation_model_attempt_outcomes_append_only
  before update or delete on public.foundation_model_attempt_outcomes
  for each row execute function public.prevent_foundation_model_attempt_receipt_mutation();

create or replace function public.admit_model_attempt_decision_v2(p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_retry_id uuid;
  v_policy_id uuid;
  v_assignment_id uuid;
  v_reservation_id uuid;
  v_policy_revision bigint;
  v_rollout_revision bigint;
  v_admitted_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_reservation public.model_provider_spend_reservations%rowtype;
  v_admission public.model_provider_circuit_events%rowtype;
  v_existing jsonb;
begin
  if p_receipt is null
    or p_receipt->>'schemaVersion' <> 'tavonel.model_attempt_decision.v2'
    or p_receipt->>'endpoint' not in ('ask', 'search')
    or p_receipt->>'attemptedRole' not in ('embedder', 'reranker')
    or p_receipt->>'tenantDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'collectionDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'worldManifestDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'inputDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'routeDecisionDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'policyDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'evidenceDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'scopeDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'assignmentDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'thresholdsDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'indexStateDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'controlId' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'chosenId' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'profileDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt ?| array['query', 'features', 'prompt', 'rawOutput', 'rawError', 'apiKey']
    or octet_length(p_receipt::text) > 32768 then
    raise exception 'model_attempt_decision_contract_invalid';
  end if;
  begin
    v_id := (p_receipt->>'attemptId')::uuid;
    v_retry_id := nullif(p_receipt->>'retryOfAttemptId', '')::uuid;
    v_policy_id := (p_receipt->>'policyId')::uuid;
    v_assignment_id := (p_receipt->>'assignmentId')::uuid;
    v_reservation_id := (p_receipt->>'reservationId')::uuid;
    v_policy_revision := (p_receipt->>'policyRevision')::bigint;
    v_rollout_revision := (p_receipt->>'rolloutRevision')::bigint;
    v_admitted_at := (p_receipt->>'admittedAt')::timestamptz;
  exception when others then
    raise exception 'model_attempt_decision_contract_invalid';
  end;

  if v_admitted_at < v_now - interval '5 minutes'
    or v_admitted_at > v_now + interval '1 minute' then
    raise exception 'model_attempt_decision_timestamp_invalid';
  end if;

  select receipt into v_existing from public.foundation_model_attempt_decisions where attempt_id = v_id;
  if found then
    if v_existing is distinct from p_receipt then
      raise exception 'model_attempt_decision_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object('attemptId', v_id, 'status', 'replayed');
  end if;

  select * into v_reservation from public.model_provider_spend_reservations
   where reservation_id = v_reservation_id for key share;
  if not found
    or v_reservation.state <> 'reserved'
    or v_reservation.admitted_at is null
    or v_reservation.admitted_at > v_admitted_at
    or v_reservation.expires_at is null
    or v_reservation.expires_at <= v_now
    or v_reservation.request_key is distinct from p_receipt->>'admissionId'
    or v_reservation.provider is distinct from p_receipt->>'provider'
    or v_reservation.model is distinct from p_receipt->>'model'
    or v_reservation.meter is distinct from p_receipt->>'meter'
    or ('sha256:' || pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_reservation.tenant_id, 'UTF8'), 'sha256'), 'hex'))
      is distinct from p_receipt->>'tenantDigest' then
    raise exception 'model_attempt_decision_spend_binding_invalid';
  end if;

  select * into v_admission from public.model_provider_circuit_events
   where event_id = 'admission:' || (p_receipt->>'admissionId') for key share;
  if not found
    or v_admission.kind <> 'admission'
    or v_admission.admission_id is distinct from p_receipt->>'admissionId'
    or v_admission.provider is distinct from v_reservation.provider
    or v_admission.occurred_at > v_admitted_at then
    raise exception 'model_attempt_decision_provider_binding_invalid';
  end if;

  insert into public.foundation_model_attempt_decisions (
    attempt_id, admitted_at, endpoint, attempted_role, provider, model, meter,
    tenant_digest, collection_digest,
    world_manifest_digest, input_digest, route_decision_digest, policy_id, policy_version,
    policy_revision, rollout_revision, assignment_id, policy_digest, evidence_digest,
    scope_digest, assignment_digest, thresholds_digest, index_state_digest, control_id, chosen_id,
    profile_id, profile_digest, run_id, shadow_id, reservation_id, admission_id, admission_event_id,
    retry_of_attempt_id, retry_ordinal, receipt
  ) values (
    v_id, v_admitted_at, p_receipt->>'endpoint', p_receipt->>'attemptedRole',
    p_receipt->>'provider', p_receipt->>'model', p_receipt->>'meter',
    p_receipt->>'tenantDigest', p_receipt->>'collectionDigest',
    p_receipt->>'worldManifestDigest', p_receipt->>'inputDigest',
    p_receipt->>'routeDecisionDigest', v_policy_id, p_receipt->>'policyVersion',
    v_policy_revision, v_rollout_revision, v_assignment_id, p_receipt->>'policyDigest',
    p_receipt->>'evidenceDigest', p_receipt->>'scopeDigest', p_receipt->>'assignmentDigest',
    p_receipt->>'thresholdsDigest', p_receipt->>'indexStateDigest', p_receipt->>'controlId',
    p_receipt->>'chosenId', p_receipt->>'profileId', p_receipt->>'profileDigest',
    p_receipt->>'runId', nullif(p_receipt->>'shadowId', ''),
    v_reservation_id, p_receipt->>'admissionId', 'admission:' || (p_receipt->>'admissionId'), v_retry_id,
    (p_receipt->>'retryOrdinal')::integer, p_receipt
  );
  return pg_catalog.jsonb_build_object('attemptId', v_id, 'status', 'admitted');
exception when foreign_key_violation or check_violation or not_null_violation or invalid_text_representation then
  raise exception 'model_attempt_decision_contract_invalid';
end;
$$;

create or replace function public.record_model_attempt_outcome_v2(p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_outcome_id uuid;
  v_attempt_id uuid;
  v_admitted_at timestamptz;
  v_existing jsonb;
begin
  if p_receipt is null
    or p_receipt->>'schemaVersion' <> 'tavonel.model_attempt_outcome.v2'
    or p_receipt->>'outcome' not in ('succeeded', 'degraded', 'failed')
    or p_receipt->>'failureClass' not in (
      'none', 'provider_unavailable', 'invalid_model_output', 'downstream_failure'
    )
    or jsonb_typeof(p_receipt->'usage') <> 'object'
    or p_receipt->>'priceReferenceDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'outputDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt->>'trustReferenceDigest' !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt ?| array['query', 'features', 'prompt', 'rawOutput', 'rawError', 'apiKey']
    or octet_length(p_receipt::text) > 16384 then
    raise exception 'model_attempt_outcome_contract_invalid';
  end if;
  begin
    v_outcome_id := (p_receipt->>'outcomeId')::uuid;
    v_attempt_id := (p_receipt->>'attemptId')::uuid;
  exception when others then
    raise exception 'model_attempt_outcome_contract_invalid';
  end;

  select receipt into v_existing from public.foundation_model_attempt_outcomes
    where outcome_id = v_outcome_id or attempt_id = v_attempt_id;
  if found then
    if v_existing is distinct from p_receipt then
      raise exception 'model_attempt_outcome_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'attemptId', v_attempt_id, 'outcomeId', v_outcome_id, 'status', 'replayed'
    );
  end if;
  select admitted_at into v_admitted_at from public.foundation_model_attempt_decisions
    where attempt_id = v_attempt_id;
  if not found then
    raise exception 'model_attempt_outcome_without_admission';
  end if;
  if (p_receipt->>'completedAt')::timestamptz < v_admitted_at then
    raise exception 'model_attempt_outcome_precedes_admission';
  end if;

  insert into public.foundation_model_attempt_outcomes (
    outcome_id, attempt_id, completed_at, outcome, failure_class, latency_ms, meter,
    input_units, output_units, total_units, billed_units, price_reference_digest,
    cost_usd_micros, output_digest, trust_reference_digest, receipt
  ) values (
    v_outcome_id, v_attempt_id, (p_receipt->>'completedAt')::timestamptz,
    p_receipt->>'outcome', p_receipt->>'failureClass', (p_receipt->>'latencyMs')::integer,
    p_receipt->'usage'->>'meter', (p_receipt->'usage'->>'inputUnits')::bigint,
    (p_receipt->'usage'->>'outputUnits')::bigint, (p_receipt->'usage'->>'totalUnits')::bigint,
    (p_receipt->'usage'->>'billedUnits')::bigint, p_receipt->>'priceReferenceDigest',
    (p_receipt->>'costUsdMicros')::bigint, p_receipt->>'outputDigest',
    p_receipt->>'trustReferenceDigest', p_receipt
  );
  return pg_catalog.jsonb_build_object(
    'attemptId', v_attempt_id, 'outcomeId', v_outcome_id, 'status', 'recorded'
  );
exception when foreign_key_violation or unique_violation or check_violation
  or not_null_violation or invalid_text_representation then
  raise exception 'model_attempt_outcome_contract_invalid';
end;
$$;

-- The decision RPC remains unavailable until the later adaptive-router migration adds the
-- policy/rollout/assignment foreign keys. This avoids a migration-order window in which a
-- service-role caller could admit only partially bound lineage.
revoke all on function public.admit_model_attempt_decision_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.record_model_attempt_outcome_v2(jsonb)
  from public, anon, authenticated, service_role;

commit;
