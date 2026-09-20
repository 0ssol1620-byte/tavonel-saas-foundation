-- Internal retrieval/model attempt receipts. Public clients have no table or RPC access.
begin;

create table public.foundation_model_attempt_receipts (
  receipt_id uuid primary key,
  attempted_at timestamptz not null,
  endpoint text not null check (endpoint in ('ask', 'search')),
  tenant_digest text not null check (tenant_digest ~ '^sha256:[a-f0-9]{64}$'),
  collection_digest text not null check (collection_digest ~ '^sha256:[a-f0-9]{64}$'),
  world_manifest_digest text not null check (world_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  input_digest text not null check (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  policy_version text not null check (policy_version = 'retrieval-route-policy/v1'),
  route_decision_digest text not null check (route_decision_digest ~ '^sha256:[a-f0-9]{64}$'),
  outcome text not null check (outcome in ('succeeded', 'degraded', 'failed')),
  failure_class text not null check (failure_class in ('none', 'provider_unavailable', 'invalid_model_output', 'downstream_failure')),
  receipt jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (receipt->>'schemaVersion' = 'tavonel.model_attempt_receipt.v1'),
  check ((receipt->>'attemptId')::uuid = receipt_id),
  check (receipt->>'endpoint' = endpoint),
  check (receipt->>'tenantDigest' = tenant_digest),
  check (receipt->>'collectionDigest' = collection_digest),
  check (receipt->>'worldManifestDigest' = world_manifest_digest),
  check (receipt->>'inputDigest' = input_digest),
  check (receipt->>'policyVersion' = policy_version),
  check (receipt->>'routeDecisionDigest' = route_decision_digest),
  check (receipt->>'outcome' = outcome),
  check (receipt->>'failureClass' = failure_class),
  check (jsonb_typeof(receipt->'modelRoute') = 'object'),
  check (jsonb_typeof(receipt->'attemptedRoles') = 'array'),
  check (jsonb_array_length(receipt->'attemptedRoles') > 0),
  check (jsonb_typeof(receipt->'costReferenceDigests') = 'array'),
  check (not (receipt ?| array['prompt', 'features', 'costMatrix', 'rawError', 'apiKey'])),
  check (octet_length(receipt::text) <= 32768)
);

create index foundation_model_attempt_receipts_metrics_idx
  on public.foundation_model_attempt_receipts (attempted_at desc, outcome, failure_class);

alter table public.foundation_model_attempt_receipts enable row level security;
revoke all on public.foundation_model_attempt_receipts from public, anon, authenticated, service_role;
grant select on public.foundation_model_attempt_receipts to service_role;

create or replace function public.prevent_foundation_model_attempt_receipt_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'foundation_model_attempt_receipts_append_only';
end;
$$;

create trigger foundation_model_attempt_receipts_append_only
  before update or delete on public.foundation_model_attempt_receipts
  for each row execute function public.prevent_foundation_model_attempt_receipt_mutation();

create or replace function public.record_model_attempt_receipt_v1(p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_existing public.foundation_model_attempt_receipts%rowtype;
begin
  if p_receipt is null
    or p_receipt->>'schemaVersion' <> 'tavonel.model_attempt_receipt.v1'
    or p_receipt->>'policyVersion' <> 'retrieval-route-policy/v1'
    or p_receipt->>'endpoint' not in ('ask', 'search')
    or p_receipt->>'outcome' not in ('succeeded', 'degraded', 'failed')
    or p_receipt->>'failureClass' not in ('none', 'provider_unavailable', 'invalid_model_output', 'downstream_failure')
    or jsonb_typeof(p_receipt->'modelRoute') <> 'object'
    or jsonb_typeof(p_receipt->'attemptedRoles') <> 'array'
    or jsonb_array_length(p_receipt->'attemptedRoles') = 0
    or jsonb_typeof(p_receipt->'costReferenceDigests') <> 'array'
    or p_receipt ?| array['prompt', 'features', 'costMatrix', 'rawError', 'apiKey']
    or octet_length(p_receipt::text) > 32768 then
    raise exception 'model_attempt_receipt_contract_invalid';
  end if;

  begin
    v_id := (p_receipt->>'attemptId')::uuid;
  exception when others then
    raise exception 'model_attempt_receipt_contract_invalid';
  end;

  select * into v_existing from public.foundation_model_attempt_receipts where receipt_id = v_id;
  if found then
    if v_existing.receipt is distinct from p_receipt then
      raise exception 'model_attempt_receipt_idempotency_conflict';
    end if;
    return pg_catalog.jsonb_build_object('receiptId', v_id, 'status', 'replayed');
  end if;

  insert into public.foundation_model_attempt_receipts (
    receipt_id, attempted_at, endpoint, tenant_digest, collection_digest,
    world_manifest_digest, input_digest, policy_version, route_decision_digest,
    outcome, failure_class, receipt
  ) values (
    v_id, (p_receipt->>'attemptedAt')::timestamptz, p_receipt->>'endpoint',
    p_receipt->>'tenantDigest', p_receipt->>'collectionDigest',
    p_receipt->>'worldManifestDigest', p_receipt->>'inputDigest',
    p_receipt->>'policyVersion', p_receipt->>'routeDecisionDigest',
    p_receipt->>'outcome', p_receipt->>'failureClass', p_receipt
  );
  return pg_catalog.jsonb_build_object('receiptId', v_id, 'status', 'recorded');
end;
$$;

revoke all on function public.record_model_attempt_receipt_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_model_attempt_receipt_v1(jsonb) to service_role;
revoke execute on function public.prevent_foundation_model_attempt_receipt_mutation()
  from public, anon, authenticated, service_role;

commit;
