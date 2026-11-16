-- WO-D30-1 (V34 D30 M9-03, U37, S29): the proposal store. A proposal is a person's or a steward's
-- request for a change to the World, kept for a person to confirm or reject. Creating one mutates
-- nothing; execution is the app's act after a confirmation, recorded afterwards.
--
-- States: proposed -> confirmed | rejected | expired | stale (decide), confirmed -> executed | failed,
-- executed -> undone (record outcome). Every other move raises. A proposal binds the active World
-- manifest digest it was made against: a confirmation after the World moved is `stale` and is never
-- executed. Past expires_at a decision turns the row `expired`.
--
-- Idempotency: unique (workspace_key, idempotency_key). The same key with the same input digest
-- (and collection) returns the existing row with replayed = true; the same key with another digest
-- is `proposal_idempotency_conflict`, never an overwrite. A per-key advisory lock makes the
-- check-then-insert race-free; decide and record lock the row.
--
-- A rejection is honoured whatever the World did since: it executes nothing. Only a confirmation
-- is held to the digest.
--
-- Client access: none (RLS on, restrictive deny-all policy, no grants). service_role executes the
-- four functions; the browser reaches them through session-only routes.
--
-- Ordering: second of the two migrations of the V34 product-UX cluster. The lead assigns the final
-- timestamp at merge so file order equals merge order. The founder test reset covers this table in
-- 20261116130200.
begin;

create table public.world_change_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,32}$'),
  collection_id text not null check (collection_id ~ '^collection-[a-f0-9]{32}$'),
  action_type text not null check (action_type in ('library_label')),
  input jsonb not null check (jsonb_typeof(input) = 'object' and pg_catalog.octet_length(input::text) <= 4096),
  input_sha256 text not null check (input_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  evidence_ids text[] not null default '{}' check (pg_catalog.cardinality(evidence_ids) <= 16),
  expected_manifest_digest text not null check (expected_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  authorization_revision integer not null check (authorization_revision >= 0),
  principal_kind text not null check (principal_kind in ('session', 'steward')),
  principal_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  state text not null default 'proposed' check (state in
    ('proposed', 'confirmed', 'rejected', 'expired', 'stale', 'executed', 'failed', 'undone')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  decided_by uuid,
  receipt jsonb check (receipt is null or (jsonb_typeof(receipt) = 'object' and pg_catalog.octet_length(receipt::text) <= 8192)),
  unique (workspace_key, idempotency_key),
  check ((state = 'proposed') = (decided_at is null)),
  check (decided_by is null or decided_at is not null),
  check ((state in ('executed', 'failed', 'undone')) = (receipt is not null))
);

create index world_change_proposals_collection_idx
  on public.world_change_proposals (workspace_key, collection_id, created_at desc);

alter table public.world_change_proposals enable row level security;
revoke all on public.world_change_proposals from public, anon, authenticated, service_role;
create policy world_change_proposals_no_client_access on public.world_change_proposals
  as restrictive for all to anon, authenticated using (false) with check (false);

create function public.create_world_change_proposal(
  p_workspace_key text, p_collection_id text, p_action_type text, p_input jsonb, p_input_sha256 text,
  p_evidence_ids text[], p_expected_manifest_digest text, p_authorization_revision integer,
  p_principal_kind text, p_principal_id uuid, p_idempotency_key text, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_row public.world_change_proposals%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_collection_id is null or p_collection_id !~ '^collection-[a-f0-9]{32}$'
    or p_action_type is null or p_action_type not in ('library_label')
    or p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object' or pg_catalog.octet_length(p_input::text) > 4096
    or p_input_sha256 is null or p_input_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_evidence_ids is null or pg_catalog.cardinality(p_evidence_ids) > 16
    or p_expected_manifest_digest is null or p_expected_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_authorization_revision is null or p_authorization_revision < 0
    or p_principal_kind is null or p_principal_kind not in ('session', 'steward')
    or p_principal_id is null
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    or p_expires_at is null or p_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'proposal_request_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('world_change_proposal:' || p_workspace_key || ':' || p_idempotency_key, 0));

  select * into v_row from public.world_change_proposals
    where workspace_key = p_workspace_key and idempotency_key = p_idempotency_key;
  if found then
    if v_row.input_sha256 <> p_input_sha256 or v_row.collection_id <> p_collection_id or v_row.action_type <> p_action_type then
      raise exception 'proposal_idempotency_conflict';
    end if;
    return jsonb_build_object('proposal', pg_catalog.to_jsonb(v_row), 'replayed', true);
  end if;

  insert into public.world_change_proposals (
    workspace_key, collection_id, action_type, input, input_sha256, evidence_ids, expected_manifest_digest,
    authorization_revision, principal_kind, principal_id, idempotency_key, expires_at)
  values (
    p_workspace_key, p_collection_id, p_action_type, p_input, p_input_sha256, p_evidence_ids, p_expected_manifest_digest,
    p_authorization_revision, p_principal_kind, p_principal_id, p_idempotency_key, p_expires_at)
  returning * into v_row;
  return jsonb_build_object('proposal', pg_catalog.to_jsonb(v_row), 'replayed', false);
end; $$;

create function public.decide_world_change_proposal(
  p_workspace_key text, p_proposal_id uuid, p_decision text, p_decided_by uuid,
  p_current_manifest_digest text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_row public.world_change_proposals%rowtype;
  v_state text;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_proposal_id is null
    or p_decision is null or p_decision not in ('confirm', 'reject')
    or p_decided_by is null
    or p_current_manifest_digest is null or p_current_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_now is null then
    raise exception 'proposal_request_invalid';
  end if;

  select * into v_row from public.world_change_proposals
    where proposal_id = p_proposal_id and workspace_key = p_workspace_key for update;
  if not found then
    raise exception 'proposal_not_found';
  end if;
  if v_row.state <> 'proposed' then
    raise exception 'proposal_not_decidable';
  end if;

  v_state := case
    when p_now >= v_row.expires_at then 'expired'
    when p_decision = 'reject' then 'rejected'
    when p_current_manifest_digest <> v_row.expected_manifest_digest then 'stale'
    else 'confirmed'
  end;
  update public.world_change_proposals
    set state = v_state, decided_at = p_now, decided_by = p_decided_by
    where proposal_id = p_proposal_id
    returning * into v_row;
  return pg_catalog.to_jsonb(v_row);
end; $$;

create function public.record_world_change_proposal_outcome(
  p_workspace_key text, p_proposal_id uuid, p_outcome text, p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_row public.world_change_proposals%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_proposal_id is null
    or p_outcome is null or p_outcome not in ('executed', 'failed', 'undone')
    or p_receipt is null or pg_catalog.jsonb_typeof(p_receipt) <> 'object' or pg_catalog.octet_length(p_receipt::text) > 8192 then
    raise exception 'proposal_request_invalid';
  end if;

  select * into v_row from public.world_change_proposals
    where proposal_id = p_proposal_id and workspace_key = p_workspace_key for update;
  if not found then
    raise exception 'proposal_not_found';
  end if;
  if not ((v_row.state = 'confirmed' and p_outcome in ('executed', 'failed'))
       or (v_row.state = 'executed' and p_outcome = 'undone')) then
    raise exception 'proposal_transition_illegal';
  end if;

  update public.world_change_proposals set state = p_outcome, receipt = p_receipt
    where proposal_id = p_proposal_id
    returning * into v_row;
  return pg_catalog.to_jsonb(v_row);
end; $$;

create function public.list_world_change_proposals(p_workspace_key text, p_collection_id text, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '3s' as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_collection_id is null or p_collection_id !~ '^collection-[a-f0-9]{32}$'
    or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'proposal_request_invalid';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.created_at desc, p.proposal_id)
      from (select * from public.world_change_proposals
              where workspace_key = p_workspace_key and collection_id = p_collection_id
              order by created_at desc, proposal_id limit p_limit) p
  ), '[]'::jsonb);
end; $$;

revoke all on function public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz) to service_role;
revoke all on function public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz) to service_role;
revoke all on function public.record_world_change_proposal_outcome(text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_world_change_proposal_outcome(text, uuid, text, jsonb) to service_role;
revoke all on function public.list_world_change_proposals(text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_world_change_proposals(text, text, integer) to service_role;

commit;
