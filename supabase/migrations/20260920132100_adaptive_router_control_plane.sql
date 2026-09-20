-- Durable, fail-closed control plane for the adaptive model router.
-- Policy and evidence rows are immutable facts. A small mutable head is writable only by the
-- CAS transition RPC; every accepted change is also recorded in immutable revision and event rows.
begin;

-- PostgreSQL jsonb has a deterministic normalized text representation. Digests are derived from
-- that canonical body after removing the self-referential digest property; a caller cannot make
-- an arbitrary digest authoritative merely by repeating it in the JSON document and column.
create function public.adaptive_router_canonical_digest_v1(
  p_document jsonb,
  p_omitted_keys text[],
  p_domain text
)
returns text language sql immutable strict parallel safe set search_path = '' as $$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(
      p_domain || pg_catalog.chr(31) || (p_document - p_omitted_keys)::text,
      'UTF8'
    ), 'sha256'),
    'hex'
  );
$$;

create table public.adaptive_router_evidence_receipts (
  receipt_id uuid primary key,
  evidence_digest text not null unique check (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  corpus_digest text not null check (corpus_digest ~ '^sha256:[a-f0-9]{64}$'),
  evaluator_digest text not null check (evaluator_digest ~ '^sha256:[a-f0-9]{64}$'),
  measured_at timestamptz not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  receipt jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (valid_until > valid_from),
  check (measured_at <= valid_from),
  check (receipt->>'schemaVersion' = 'tavonel.adaptive_router_evidence.v1'),
  check ((receipt->>'receiptId')::uuid = receipt_id),
  check (receipt->>'evidenceDigest' = evidence_digest),
  check (evidence_digest = public.adaptive_router_canonical_digest_v1(
    receipt, array['evidenceDigest']::text[], 'tavonel.adaptive_router_evidence.v1')),
  check (receipt->>'corpusDigest' = corpus_digest),
  check (receipt->>'evaluatorDigest' = evaluator_digest),
  check (jsonb_typeof(receipt->'thresholdResults') = 'object'),
  check (not (receipt ?| array['prompt', 'sourceText', 'apiKey', 'secret'])),
  check (octet_length(receipt::text) <= 65536)
);

create table public.adaptive_router_policy_revisions (
  policy_id uuid not null,
  policy_revision bigint not null check (policy_revision > 0),
  policy_digest text not null unique check (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  evidence_receipt_id uuid not null references public.adaptive_router_evidence_receipts(receipt_id) on delete restrict,
  evidence_digest text not null references public.adaptive_router_evidence_receipts(evidence_digest)
    on delete restrict check (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  thresholds_digest text not null check (thresholds_digest ~ '^sha256:[a-f0-9]{64}$'),
  scope_digest text not null check (scope_digest ~ '^sha256:[a-f0-9]{64}$'),
  candidate_set_digest text not null check (candidate_set_digest ~ '^sha256:[a-f0-9]{64}$'),
  index_state_digest text not null check (index_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  control_revision bigint not null check (control_revision > 0),
  candidate_revision bigint not null check (candidate_revision > 0),
  rollback_revision bigint not null check (rollback_revision > 0),
  candidate_basis_points integer not null check (candidate_basis_points between 0 and 10000),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  policy jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (policy_id, policy_revision),
  check (valid_until > valid_from),
  check (policy->>'schemaVersion' = 'tavonel.adaptive_router_policy.v1'),
  check ((policy->>'policyId')::uuid = policy_id),
  check ((policy->>'policyRevision')::bigint = policy_revision),
  check (policy->>'policyDigest' = policy_digest),
  check (policy_digest = public.adaptive_router_canonical_digest_v1(
    policy, array['policyDigest']::text[], 'tavonel.adaptive_router_policy.v1')),
  check (policy->>'evidenceDigest' = evidence_digest),
  check (policy->>'thresholdsDigest' = thresholds_digest),
  check (policy->>'scopeDigest' = scope_digest),
  check (policy->>'candidateSetDigest' = candidate_set_digest),
  check (policy->>'indexStateDigest' = index_state_digest),
  check ((policy->>'controlRevision')::bigint = control_revision),
  check ((policy->>'candidateRevision')::bigint = candidate_revision),
  check ((policy->>'rollbackRevision')::bigint = rollback_revision),
  check ((policy->>'candidateBasisPoints')::integer = candidate_basis_points),
  check (jsonb_typeof(policy->'thresholds') = 'object'),
  check (jsonb_typeof(policy->'scope') = 'object'),
  check (jsonb_typeof(policy->'candidates') = 'array'),
  check (jsonb_array_length(policy->'candidates') > 0),
  check (jsonb_typeof(policy->'routerPolicy') = 'object'),
  check (policy->'routerPolicy'->>'schemaVersion' = 'tavonel.adaptive_router.v1'),
  check (policy->'routerPolicy'->>'policyId' = policy_id::text),
  check ((policy->'routerPolicy'->>'canaryPermille')::integer = candidate_basis_points),
  check (not (policy ?| array['prompt', 'sourceText', 'apiKey', 'secret'])),
  check (octet_length(policy::text) <= 65536)
);

create table public.adaptive_router_rollout_heads (
  policy_id uuid primary key,
  rollout_revision bigint not null check (rollout_revision > 0),
  state text not null check (state in ('shadow', 'canary', 'active', 'rolled_back', 'disabled')),
  policy_revision bigint not null,
  policy_digest text not null check (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  evidence_digest text not null references public.adaptive_router_evidence_receipts(evidence_digest)
    on delete restrict check (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  thresholds_digest text not null check (thresholds_digest ~ '^sha256:[a-f0-9]{64}$'),
  scope_digest text not null check (scope_digest ~ '^sha256:[a-f0-9]{64}$'),
  candidate_set_digest text not null check (candidate_set_digest ~ '^sha256:[a-f0-9]{64}$'),
  index_state_digest text not null check (index_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  control_revision bigint not null check (control_revision > 0),
  candidate_revision bigint not null check (candidate_revision > 0),
  rollback_revision bigint not null check (rollback_revision > 0),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (policy_id, policy_revision)
    references public.adaptive_router_policy_revisions(policy_id, policy_revision) on delete restrict,
  check (valid_until > valid_from)
);

create table public.adaptive_router_rollout_revisions (
  policy_id uuid not null,
  rollout_revision bigint not null check (rollout_revision > 0),
  operation_id uuid not null unique,
  from_state text not null check (from_state in ('none', 'shadow', 'canary', 'active', 'rolled_back', 'disabled')),
  to_state text not null check (to_state in ('shadow', 'canary', 'active', 'rolled_back', 'disabled')),
  policy_revision bigint not null,
  policy_digest text not null check (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  evidence_digest text not null check (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  thresholds_digest text not null check (thresholds_digest ~ '^sha256:[a-f0-9]{64}$'),
  scope_digest text not null check (scope_digest ~ '^sha256:[a-f0-9]{64}$'),
  candidate_set_digest text not null check (candidate_set_digest ~ '^sha256:[a-f0-9]{64}$'),
  index_state_digest text not null check (index_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  control_revision bigint not null check (control_revision > 0),
  candidate_revision bigint not null check (candidate_revision > 0),
  rollback_revision bigint not null check (rollback_revision > 0),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  request_digest text not null check (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  reason text not null check (char_length(reason) between 8 and 500),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (policy_id, rollout_revision),
  foreign key (policy_id, policy_revision)
    references public.adaptive_router_policy_revisions(policy_id, policy_revision) on delete restrict,
  check (valid_until > valid_from)
);

create table public.adaptive_router_state_events (
  event_id uuid primary key,
  operation_id uuid not null unique,
  policy_id uuid not null,
  rollout_revision bigint not null,
  from_state text not null,
  to_state text not null,
  request_digest text not null check (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  receipt_digest text not null unique check (receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
  event jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (policy_id, rollout_revision)
    references public.adaptive_router_rollout_revisions(policy_id, rollout_revision) on delete restrict,
  check (event->>'schemaVersion' = 'tavonel.adaptive_router_state_event.v1'),
  check ((event->>'eventId')::uuid = event_id),
  check ((event->>'operationId')::uuid = operation_id),
  check (event->>'requestDigest' = request_digest),
  check (event->>'receiptDigest' = receipt_digest),
  check (octet_length(event::text) <= 32768)
);

create table public.adaptive_router_assignments (
  assignment_id uuid primary key,
  policy_id uuid not null,
  policy_revision bigint not null,
  rollout_revision bigint not null,
  assignment_key_digest text not null check (assignment_key_digest ~ '^sha256:[a-f0-9]{64}$'),
  subject_digest text not null check (subject_digest ~ '^sha256:[a-f0-9]{64}$'),
  assignment_digest text not null unique check (assignment_digest ~ '^sha256:[a-f0-9]{64}$'),
  variant text not null check (variant in ('control', 'candidate')),
  model_revision bigint not null check (model_revision > 0),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  assigned_at timestamptz not null default clock_timestamp(),
  unique (policy_id, policy_revision, assignment_key_digest, subject_digest),
  foreign key (policy_id, policy_revision)
    references public.adaptive_router_policy_revisions(policy_id, policy_revision) on delete restrict,
  foreign key (policy_id, rollout_revision)
    references public.adaptive_router_rollout_revisions(policy_id, rollout_revision) on delete restrict,
  check (valid_until > valid_from)
);

create table public.adaptive_router_revocations (
  revocation_id uuid primary key,
  revocation_kind text not null check (revocation_kind in ('global_kill_switch', 'policy', 'assignment')),
  policy_id uuid,
  assignment_id uuid references public.adaptive_router_assignments(assignment_id) on delete restrict,
  evidence_digest text not null references public.adaptive_router_evidence_receipts(evidence_digest)
    on delete restrict check (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  reason text not null check (char_length(reason) between 8 and 500),
  effective_at timestamptz not null,
  expires_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  check (expires_at is null or expires_at > effective_at),
  check ((revocation_kind = 'global_kill_switch' and policy_id is null and assignment_id is null)
    or (revocation_kind = 'policy' and policy_id is not null and assignment_id is null)
    or (revocation_kind = 'assignment' and policy_id is not null and assignment_id is not null))
);

-- The lineage migration is deliberately earlier because provider spend and circuit records already
-- exist there. Complete the control-plane side only after all referenced adaptive tables exist.
alter table public.adaptive_router_assignments
  add constraint adaptive_router_assignments_lineage_key
  unique (assignment_id, policy_id, policy_revision);

alter table public.foundation_model_attempt_decisions
  add constraint foundation_model_attempt_decisions_policy_fkey
    foreign key (policy_id, policy_revision)
    references public.adaptive_router_policy_revisions (policy_id, policy_revision) on delete restrict,
  add constraint foundation_model_attempt_decisions_rollout_fkey
    foreign key (policy_id, rollout_revision)
    references public.adaptive_router_rollout_revisions (policy_id, rollout_revision) on delete restrict,
  add constraint foundation_model_attempt_decisions_assignment_fkey
    foreign key (assignment_id, policy_id, policy_revision)
    references public.adaptive_router_assignments
      (assignment_id, policy_id, policy_revision) on delete restrict;

create function public.validate_foundation_model_attempt_control_lineage()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_policy public.adaptive_router_policy_revisions%rowtype;
  v_assignment public.adaptive_router_assignments%rowtype;
  v_head public.adaptive_router_rollout_heads%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('adaptive_router:revocations', 0)
  );
  select * into v_policy from public.adaptive_router_policy_revisions
   where policy_id = new.policy_id and policy_revision = new.policy_revision;
  select * into v_assignment from public.adaptive_router_assignments
   where assignment_id = new.assignment_id and policy_id = new.policy_id
     and policy_revision = new.policy_revision;
  select * into v_head from public.adaptive_router_rollout_heads
   where policy_id = new.policy_id and policy_revision = new.policy_revision;
  if v_policy.policy_id is null or v_assignment.assignment_id is null or v_head.policy_id is null
    or v_head.rollout_revision is distinct from new.rollout_revision
    or v_head.state not in ('shadow', 'canary', 'active')
    or v_assignment.rollout_revision > new.rollout_revision
    or v_policy.policy->'routerPolicy'->>'version' is distinct from new.policy_version
    or v_policy.policy_digest is distinct from new.policy_digest
    or v_policy.evidence_digest is distinct from new.evidence_digest
    or v_policy.scope_digest is distinct from new.scope_digest
    or v_policy.thresholds_digest is distinct from new.thresholds_digest
    or v_policy.index_state_digest is distinct from new.index_state_digest
    or v_assignment.assignment_digest is distinct from new.assignment_digest
    or not pg_catalog.coalesce(
      (v_policy.policy->'routerPolicy'->'orderedCandidateKeys') ? new.control_id, false)
    or not pg_catalog.coalesce(
      (v_policy.policy->'routerPolicy'->'orderedCandidateKeys') ? new.chosen_id, false)
    or new.admitted_at < v_policy.valid_from or new.admitted_at >= v_policy.valid_until
    or new.admitted_at < v_assignment.valid_from or new.admitted_at >= v_assignment.valid_until
    or v_now < v_policy.valid_from or v_now >= v_policy.valid_until
    or v_now < v_assignment.valid_from or v_now >= v_assignment.valid_until
    or exists (select 1 from public.adaptive_router_revocations r
      where r.effective_at <= v_now and (r.expires_at is null or r.expires_at > v_now)
        and (r.revocation_kind = 'global_kill_switch'
          or (r.revocation_kind = 'policy' and r.policy_id = new.policy_id)
          or (r.revocation_kind = 'assignment' and r.assignment_id = new.assignment_id))) then
    raise exception 'model_attempt_decision_control_binding_invalid';
  end if;
  return new;
end;
$$;

create trigger foundation_model_attempt_decisions_control_lineage
  before insert on public.foundation_model_attempt_decisions
  for each row execute function public.validate_foundation_model_attempt_control_lineage();

create index adaptive_router_policy_scope_idx
  on public.adaptive_router_policy_revisions (scope_digest, valid_from, valid_until);
create index adaptive_router_revocations_active_idx
  on public.adaptive_router_revocations (revocation_kind, policy_id, assignment_id, effective_at, expires_at);

create or replace function public.prevent_adaptive_router_immutable_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'adaptive_router_append_only';
end;
$$;

create or replace function public.guard_adaptive_router_rollout_head_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('app.adaptive_router_transition', true) is distinct from '1' then
    raise exception 'adaptive_router_head_rpc_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.serialize_adaptive_router_revocation()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('adaptive_router:revocations', 0)
  );
  return new;
end;
$$;

create trigger adaptive_router_evidence_receipts_append_only before update or delete
  on public.adaptive_router_evidence_receipts for each row
  execute function public.prevent_adaptive_router_immutable_mutation();
create trigger adaptive_router_policy_revisions_append_only before update or delete
  on public.adaptive_router_policy_revisions for each row
  execute function public.prevent_adaptive_router_immutable_mutation();
create trigger adaptive_router_rollout_revisions_append_only before update or delete
  on public.adaptive_router_rollout_revisions for each row
  execute function public.prevent_adaptive_router_immutable_mutation();
create trigger adaptive_router_state_events_append_only before update or delete
  on public.adaptive_router_state_events for each row
  execute function public.prevent_adaptive_router_immutable_mutation();
create trigger adaptive_router_assignments_append_only before update or delete
  on public.adaptive_router_assignments for each row
  execute function public.prevent_adaptive_router_immutable_mutation();
create trigger adaptive_router_revocations_append_only before update or delete
  on public.adaptive_router_revocations for each row
  execute function public.prevent_adaptive_router_immutable_mutation();
create trigger adaptive_router_revocations_serialize before insert
  on public.adaptive_router_revocations for each statement
  execute function public.serialize_adaptive_router_revocation();
create trigger adaptive_router_rollout_heads_rpc_only before insert or update or delete
  on public.adaptive_router_rollout_heads for each row
  execute function public.guard_adaptive_router_rollout_head_mutation();

create or replace function public.transition_adaptive_router_rollout_v1(
  p_operation_id uuid,
  p_event_id uuid,
  p_policy_id uuid,
  p_expected_rollout_revision bigint,
  p_expected_state text,
  p_next_state text,
  p_policy_revision bigint,
  p_policy_digest text,
  p_evidence_digest text,
  p_thresholds_digest text,
  p_scope_digest text,
  p_candidate_set_digest text,
  p_index_state_digest text,
  p_control_revision bigint,
  p_candidate_revision bigint,
  p_rollback_revision bigint,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_policy public.adaptive_router_policy_revisions%rowtype;
  v_evidence public.adaptive_router_evidence_receipts%rowtype;
  v_head public.adaptive_router_rollout_heads%rowtype;
  v_existing public.adaptive_router_state_events%rowtype;
  v_request_digest text;
  v_receipt_digest text;
  v_event jsonb;
  v_next_revision bigint;
  v_changed integer;
begin
  if p_operation_id is null or p_event_id is null or p_policy_id is null
    or p_expected_rollout_revision < 0
    or p_policy_revision <= 0 or p_control_revision <= 0
    or p_candidate_revision <= 0 or p_rollback_revision <= 0
    or p_expected_state not in ('none', 'shadow', 'canary', 'active', 'rolled_back', 'disabled')
    or p_next_state not in ('shadow', 'canary', 'active', 'rolled_back', 'disabled')
    or p_policy_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_evidence_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_thresholds_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_scope_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_candidate_set_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_index_state_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_valid_from is null or p_valid_until <= p_valid_from
    or char_length(p_reason) not between 8 and 500 then
    raise exception 'adaptive_router_transition_contract_invalid';
  end if;

  if not ((p_expected_state = 'none' and p_next_state = 'shadow' and p_expected_rollout_revision = 0)
    or (p_expected_state = 'shadow' and p_next_state in ('canary', 'disabled'))
    or (p_expected_state = 'canary' and p_next_state in ('active', 'rolled_back', 'disabled'))
    or (p_expected_state = 'active' and p_next_state in ('rolled_back', 'disabled'))
    or (p_expected_state = 'rolled_back' and p_next_state = 'disabled')) then
    raise exception 'adaptive_router_transition_forbidden';
  end if;

  v_request_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operationId', p_operation_id, 'eventId', p_event_id, 'policyId', p_policy_id,
      'expectedRolloutRevision', p_expected_rollout_revision, 'expectedState', p_expected_state,
      'nextState', p_next_state, 'policyRevision', p_policy_revision,
      'policyDigest', p_policy_digest, 'evidenceDigest', p_evidence_digest,
      'thresholdsDigest', p_thresholds_digest, 'scopeDigest', p_scope_digest,
      'candidateSetDigest', p_candidate_set_digest, 'indexStateDigest', p_index_state_digest,
      'controlRevision', p_control_revision, 'candidateRevision', p_candidate_revision,
      'rollbackRevision', p_rollback_revision, 'validFrom', p_valid_from,
      'validUntil', p_valid_until, 'reason', p_reason
    )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('adaptive_router:revocations', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_policy_id::text, 0));

  select * into v_existing from public.adaptive_router_state_events
   where operation_id = p_operation_id for update;
  if found then
    if v_existing.request_digest is distinct from v_request_digest
      or v_existing.event_id is distinct from p_event_id
      or v_existing.policy_id is distinct from p_policy_id then
      raise exception 'adaptive_router_transition_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'replayed', 'policyId', v_existing.policy_id,
      'rolloutRevision', v_existing.rollout_revision, 'state', v_existing.to_state,
      'eventId', v_existing.event_id, 'requestDigest', v_existing.request_digest,
      'receiptDigest', v_existing.receipt_digest
    );
  end if;

  select * into v_policy from public.adaptive_router_policy_revisions
   where policy_id = p_policy_id and policy_revision = p_policy_revision;
  if not found
    or v_policy.policy_digest is distinct from p_policy_digest
    or v_policy.evidence_digest is distinct from p_evidence_digest
    or v_policy.thresholds_digest is distinct from p_thresholds_digest
    or v_policy.scope_digest is distinct from p_scope_digest
    or v_policy.candidate_set_digest is distinct from p_candidate_set_digest
    or v_policy.index_state_digest is distinct from p_index_state_digest
    or v_policy.control_revision is distinct from p_control_revision
    or v_policy.candidate_revision is distinct from p_candidate_revision
    or v_policy.rollback_revision is distinct from p_rollback_revision
    or v_policy.valid_from is distinct from p_valid_from
    or v_policy.valid_until is distinct from p_valid_until then
    raise exception 'adaptive_router_policy_binding_invalid';
  end if;

  select * into v_evidence from public.adaptive_router_evidence_receipts
   where receipt_id = v_policy.evidence_receipt_id and evidence_digest = p_evidence_digest;
  if not found or v_evidence.valid_from > p_valid_from or v_evidence.valid_until < p_valid_until then
    raise exception 'adaptive_router_evidence_binding_invalid';
  end if;
  if p_next_state in ('canary', 'active') and not (
    v_now >= p_valid_from and v_now < p_valid_until
    and v_now >= v_evidence.valid_from and v_now < v_evidence.valid_until
  ) then
    raise exception 'adaptive_router_evidence_not_current';
  end if;
  if p_next_state in ('canary', 'active') and exists (
    select 1 from public.adaptive_router_revocations r
     where r.effective_at <= v_now and (r.expires_at is null or r.expires_at > v_now)
       and (r.revocation_kind = 'global_kill_switch'
         or (r.revocation_kind = 'policy' and r.policy_id = p_policy_id))
  ) then
    raise exception 'adaptive_router_kill_switch_engaged';
  end if;

  select * into v_head from public.adaptive_router_rollout_heads
   where policy_id = p_policy_id for update;
  if p_expected_state = 'none' then
    if found then raise exception 'adaptive_router_transition_compare_and_swap_conflict'; end if;
  elsif not found
    or v_head.rollout_revision is distinct from p_expected_rollout_revision
    or v_head.state is distinct from p_expected_state
    or v_head.policy_revision is distinct from p_policy_revision
    or v_head.policy_digest is distinct from p_policy_digest
    or v_head.evidence_digest is distinct from p_evidence_digest
    or v_head.thresholds_digest is distinct from p_thresholds_digest
    or v_head.scope_digest is distinct from p_scope_digest
    or v_head.candidate_set_digest is distinct from p_candidate_set_digest
    or v_head.index_state_digest is distinct from p_index_state_digest
    or v_head.control_revision is distinct from p_control_revision
    or v_head.candidate_revision is distinct from p_candidate_revision
    or v_head.rollback_revision is distinct from p_rollback_revision
    or v_head.valid_from is distinct from p_valid_from
    or v_head.valid_until is distinct from p_valid_until then
    raise exception 'adaptive_router_transition_compare_and_swap_conflict';
  end if;

  v_next_revision := p_expected_rollout_revision + 1;
  insert into public.adaptive_router_rollout_revisions (
    policy_id, rollout_revision, operation_id, from_state, to_state, policy_revision,
    policy_digest, evidence_digest, thresholds_digest, scope_digest, candidate_set_digest,
    index_state_digest, control_revision, candidate_revision, rollback_revision,
    valid_from, valid_until, request_digest, reason
  ) values (
    p_policy_id, v_next_revision, p_operation_id, p_expected_state, p_next_state,
    p_policy_revision, p_policy_digest, p_evidence_digest, p_thresholds_digest,
    p_scope_digest, p_candidate_set_digest, p_index_state_digest, p_control_revision,
    p_candidate_revision, p_rollback_revision, p_valid_from, p_valid_until,
    v_request_digest, p_reason
  );

  perform set_config('app.adaptive_router_transition', '1', true);
  if p_expected_state = 'none' then
    insert into public.adaptive_router_rollout_heads (
      policy_id, rollout_revision, state, policy_revision, policy_digest, evidence_digest,
      thresholds_digest, scope_digest, candidate_set_digest, index_state_digest,
      control_revision, candidate_revision, rollback_revision, valid_from, valid_until
    ) values (
      p_policy_id, v_next_revision, p_next_state, p_policy_revision, p_policy_digest,
      p_evidence_digest, p_thresholds_digest, p_scope_digest, p_candidate_set_digest,
      p_index_state_digest, p_control_revision, p_candidate_revision, p_rollback_revision,
      p_valid_from, p_valid_until
    ) on conflict (policy_id) do nothing;
  else
    update public.adaptive_router_rollout_heads set
      rollout_revision = v_next_revision, state = p_next_state, updated_at = v_now
    where policy_id = p_policy_id and rollout_revision = p_expected_rollout_revision
      and state = p_expected_state;
  end if;
  get diagnostics v_changed = row_count;
  perform set_config('app.adaptive_router_transition', '0', true);
  if v_changed <> 1 then raise exception 'adaptive_router_transition_compare_and_swap_conflict'; end if;

  v_receipt_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'eventId', p_event_id, 'operationId', p_operation_id, 'policyId', p_policy_id,
      'rolloutRevision', v_next_revision, 'fromState', p_expected_state,
      'toState', p_next_state, 'requestDigest', v_request_digest,
      'policyDigest', p_policy_digest, 'evidenceDigest', p_evidence_digest,
      'thresholdsDigest', p_thresholds_digest, 'scopeDigest', p_scope_digest,
      'candidateSetDigest', p_candidate_set_digest, 'indexStateDigest', p_index_state_digest,
      'controlRevision', p_control_revision, 'candidateRevision', p_candidate_revision,
      'rollbackRevision', p_rollback_revision, 'validFrom', p_valid_from,
      'validUntil', p_valid_until
    )::text, 'UTF8'), 'sha256'), 'hex');
  v_event := pg_catalog.jsonb_build_object(
    'schemaVersion', 'tavonel.adaptive_router_state_event.v1',
    'eventId', p_event_id, 'operationId', p_operation_id, 'policyId', p_policy_id,
    'rolloutRevision', v_next_revision, 'fromState', p_expected_state,
    'toState', p_next_state, 'requestDigest', v_request_digest,
    'receiptDigest', v_receipt_digest, 'policyDigest', p_policy_digest,
    'evidenceDigest', p_evidence_digest, 'thresholdsDigest', p_thresholds_digest,
    'scopeDigest', p_scope_digest, 'candidateSetDigest', p_candidate_set_digest,
    'indexStateDigest', p_index_state_digest, 'controlRevision', p_control_revision,
    'candidateRevision', p_candidate_revision, 'rollbackRevision', p_rollback_revision,
    'validFrom', p_valid_from, 'validUntil', p_valid_until
  );
  insert into public.adaptive_router_state_events (
    event_id, operation_id, policy_id, rollout_revision, from_state, to_state,
    request_digest, receipt_digest, event
  ) values (
    p_event_id, p_operation_id, p_policy_id, v_next_revision, p_expected_state,
    p_next_state, v_request_digest, v_receipt_digest, v_event
  );

  return pg_catalog.jsonb_build_object(
    'status', 'applied', 'policyId', p_policy_id, 'rolloutRevision', v_next_revision,
    'state', p_next_state, 'eventId', p_event_id, 'requestDigest', v_request_digest,
    'receiptDigest', v_receipt_digest
  );
end;
$$;

create or replace function public.resolve_adaptive_router_policy_v1(
  p_scope_digest text,
  p_assignment_key_digest text,
  p_subject_digest text,
  p_assignment_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_match_count integer;
  v_head public.adaptive_router_rollout_heads%rowtype;
  v_policy public.adaptive_router_policy_revisions%rowtype;
  v_assignment public.adaptive_router_assignments%rowtype;
  v_assignment_id uuid;
  v_bucket integer;
  v_variant text;
  v_model_revision bigint;
begin
  if p_scope_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_assignment_key_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_subject_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_assignment_digest !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'adaptive_router_resolution_contract_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('adaptive_router:revocations', 0)
  );
  if exists (select 1 from public.adaptive_router_revocations r
    where r.revocation_kind = 'global_kill_switch' and r.effective_at <= v_now
      and (r.expires_at is null or r.expires_at > v_now)) then
    raise exception 'adaptive_router_kill_switch_engaged';
  end if;

  select count(*)::integer into v_match_count
    from public.adaptive_router_rollout_heads h
    join public.adaptive_router_policy_revisions p
      on p.policy_id = h.policy_id and p.policy_revision = h.policy_revision
    join public.adaptive_router_evidence_receipts e
      on e.receipt_id = p.evidence_receipt_id and e.evidence_digest = h.evidence_digest
   where h.scope_digest = p_scope_digest and h.state in ('shadow', 'canary', 'active')
     and v_now >= h.valid_from and v_now < h.valid_until
     and v_now >= p.valid_from and v_now < p.valid_until
     and v_now >= e.valid_from and v_now < e.valid_until
     and h.policy_digest = p.policy_digest and h.thresholds_digest = p.thresholds_digest
     and h.candidate_set_digest = p.candidate_set_digest
     and h.index_state_digest = p.index_state_digest
     and h.control_revision = p.control_revision
     and h.candidate_revision = p.candidate_revision
     and h.rollback_revision = p.rollback_revision
     and not exists (select 1 from public.adaptive_router_revocations r
       where r.revocation_kind = 'policy' and r.policy_id = h.policy_id
         and r.effective_at <= v_now and (r.expires_at is null or r.expires_at > v_now));
  if v_match_count <> 1 then raise exception 'adaptive_router_policy_unavailable'; end if;

  select h.* into strict v_head
    from public.adaptive_router_rollout_heads h
    join public.adaptive_router_policy_revisions p
      on p.policy_id = h.policy_id and p.policy_revision = h.policy_revision
    join public.adaptive_router_evidence_receipts e
      on e.receipt_id = p.evidence_receipt_id and e.evidence_digest = h.evidence_digest
   where h.scope_digest = p_scope_digest and h.state in ('shadow', 'canary', 'active')
     and v_now >= h.valid_from and v_now < h.valid_until
     and v_now >= p.valid_from and v_now < p.valid_until
     and v_now >= e.valid_from and v_now < e.valid_until
     and h.policy_digest = p.policy_digest and h.thresholds_digest = p.thresholds_digest
     and h.candidate_set_digest = p.candidate_set_digest
     and h.index_state_digest = p.index_state_digest
     and h.control_revision = p.control_revision
     and h.candidate_revision = p.candidate_revision
     and h.rollback_revision = p.rollback_revision
     and not exists (select 1 from public.adaptive_router_revocations r
       where r.revocation_kind = 'policy' and r.policy_id = h.policy_id
         and r.effective_at <= v_now and (r.expires_at is null or r.expires_at > v_now));
  select * into strict v_policy from public.adaptive_router_policy_revisions
   where policy_id = v_head.policy_id and policy_revision = v_head.policy_revision;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_policy.policy_id::text || pg_catalog.chr(31) || v_policy.policy_revision::text
      || pg_catalog.chr(31) || p_assignment_key_digest || pg_catalog.chr(31) || p_subject_digest, 0));
  select * into v_assignment from public.adaptive_router_assignments
   where policy_id = v_policy.policy_id and policy_revision = v_policy.policy_revision
     and assignment_key_digest = p_assignment_key_digest and subject_digest = p_subject_digest;
  if found then
    if v_assignment.assignment_digest is distinct from p_assignment_digest
      or v_assignment.rollout_revision > v_head.rollout_revision
      or v_assignment.valid_from is distinct from v_policy.valid_from
      or v_assignment.valid_until is distinct from v_policy.valid_until then
      raise exception 'adaptive_router_assignment_conflict';
    end if;
  else
    v_bucket := (pg_catalog.get_byte(extensions.digest(pg_catalog.convert_to(
      p_subject_digest || pg_catalog.chr(31) || p_assignment_key_digest
        || pg_catalog.chr(31) || v_policy.policy_digest, 'UTF8'), 'sha256'), 0) * 256
      + pg_catalog.get_byte(extensions.digest(pg_catalog.convert_to(
      p_subject_digest || pg_catalog.chr(31) || p_assignment_key_digest
        || pg_catalog.chr(31) || v_policy.policy_digest, 'UTF8'), 'sha256'), 1)) % 10000;
    v_variant := case when v_bucket < v_policy.candidate_basis_points then 'candidate' else 'control' end;
    v_model_revision := case when v_variant = 'candidate'
      then v_policy.candidate_revision else v_policy.control_revision end;
    v_assignment_id := (
      substring(p_assignment_digest from 8 for 8) || '-' ||
      substring(p_assignment_digest from 16 for 4) || '-4' ||
      substring(p_assignment_digest from 21 for 3) || '-8' ||
      substring(p_assignment_digest from 25 for 3) || '-' ||
      substring(p_assignment_digest from 28 for 12)
    )::uuid;
    insert into public.adaptive_router_assignments (
      assignment_id, policy_id, policy_revision, rollout_revision, assignment_key_digest,
      subject_digest, assignment_digest, variant, model_revision, valid_from, valid_until
    ) values (
      v_assignment_id, v_policy.policy_id, v_policy.policy_revision, v_head.rollout_revision,
      p_assignment_key_digest, p_subject_digest, p_assignment_digest, v_variant,
      v_model_revision, v_policy.valid_from, v_policy.valid_until
    ) returning * into v_assignment;
  end if;
  if exists (select 1 from public.adaptive_router_revocations r
    where r.revocation_kind = 'assignment' and r.assignment_id = v_assignment.assignment_id
      and r.effective_at <= v_now and (r.expires_at is null or r.expires_at > v_now)) then
    raise exception 'adaptive_router_assignment_revoked';
  end if;

  return pg_catalog.jsonb_build_object(
    'policyId', v_policy.policy_id, 'policyRevision', v_policy.policy_revision,
    'rolloutRevision', v_head.rollout_revision, 'rolloutState', v_head.state,
    'policyDigest', v_policy.policy_digest, 'evidenceDigest', v_policy.evidence_digest,
    'thresholdsDigest', v_policy.thresholds_digest, 'scopeDigest', v_policy.scope_digest,
    'candidateSetDigest', v_policy.candidate_set_digest,
    'indexStateDigest', v_policy.index_state_digest,
    'controlRevision', v_policy.control_revision,
    'candidateRevision', v_policy.candidate_revision,
    'rollbackRevision', v_policy.rollback_revision,
    'validFrom', v_policy.valid_from, 'validUntil', v_policy.valid_until,
    'assignment', pg_catalog.jsonb_build_object(
      'assignmentId', v_assignment.assignment_id, 'variant', v_assignment.variant,
      'modelRevision', v_assignment.model_revision,
      'assignmentDigest', v_assignment.assignment_digest),
    'policy', v_policy.policy
  );
end;
$$;

alter table public.adaptive_router_evidence_receipts enable row level security;
alter table public.adaptive_router_policy_revisions enable row level security;
alter table public.adaptive_router_rollout_heads enable row level security;
alter table public.adaptive_router_rollout_revisions enable row level security;
alter table public.adaptive_router_state_events enable row level security;
alter table public.adaptive_router_assignments enable row level security;
alter table public.adaptive_router_revocations enable row level security;

revoke all on public.adaptive_router_evidence_receipts from public, anon, authenticated, service_role;
revoke all on public.adaptive_router_policy_revisions from public, anon, authenticated, service_role;
revoke all on public.adaptive_router_rollout_heads from public, anon, authenticated, service_role;
revoke all on public.adaptive_router_rollout_revisions from public, anon, authenticated, service_role;
revoke all on public.adaptive_router_state_events from public, anon, authenticated, service_role;
revoke all on public.adaptive_router_assignments from public, anon, authenticated, service_role;
revoke all on public.adaptive_router_revocations from public, anon, authenticated, service_role;

grant select, insert on public.adaptive_router_evidence_receipts to service_role;
grant select, insert on public.adaptive_router_policy_revisions to service_role;
grant select on public.adaptive_router_rollout_heads to service_role;
grant select on public.adaptive_router_rollout_revisions to service_role;
grant select on public.adaptive_router_state_events to service_role;
grant select on public.adaptive_router_assignments to service_role;
grant select, insert on public.adaptive_router_revocations to service_role;

revoke all on function public.adaptive_router_canonical_digest_v1(jsonb, text[], text)
  from public, anon, authenticated;
grant execute on function public.adaptive_router_canonical_digest_v1(jsonb, text[], text) to service_role;
grant execute on function public.admit_model_attempt_decision_v2(jsonb) to service_role;
grant execute on function public.record_model_attempt_outcome_v2(jsonb) to service_role;

revoke all on function public.transition_adaptive_router_rollout_v1(
  uuid, uuid, uuid, bigint, text, text, bigint, text, text, text, text, text, text,
  bigint, bigint, bigint, timestamptz, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.transition_adaptive_router_rollout_v1(
  uuid, uuid, uuid, bigint, text, text, bigint, text, text, text, text, text, text,
  bigint, bigint, bigint, timestamptz, timestamptz, text
) to service_role;
revoke all on function public.resolve_adaptive_router_policy_v1(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_adaptive_router_policy_v1(text, text, text, text)
  to service_role;
revoke execute on function public.prevent_adaptive_router_immutable_mutation(),
  public.guard_adaptive_router_rollout_head_mutation(),
  public.serialize_adaptive_router_revocation(),
  public.validate_foundation_model_attempt_control_lineage()
  from public, anon, authenticated, service_role;

commit;
