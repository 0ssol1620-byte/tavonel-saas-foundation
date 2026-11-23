-- Rollback for migration 20261117130000_agent_proposals (WO-AN-1).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117130000 was
-- applied, AFTER the site is reverted to a build that passes none of the new parameters (release
-- stage 1 order, reversed). The first levers are the flag (TAVONEL_AGENT_PROPOSALS_ENABLED unset)
-- and the kill switch (revoke_all_foundation_agent_grants); this file is the last one.
--
--   1. Refuses, changing nothing, while any data only this migration can hold exists: an agent
--      proposal, a withdrawn proposal, an action type other than library_label, a proposal with no
--      collection, a proposal input above the old 4,096-byte bound, an agent key, or any grant
--      (revoked ones included -- a revoked grant is still the record of who connected what).
--      Data is never deleted to make the rollback pass.
--   2. Restores the 12-argument create_world_change_proposal and the 6-argument
--      decide_world_change_proposal with the bodies of 20261116130100 (p_now decides expiry again),
--      the 0012 body of consume_foundation_api_rate_limit, and every previous constraint.
--   3. Drops the new functions, columns, indexes and the grants table.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117130000';
-- in the same session, and writes the version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if exists (select 1 from public.world_change_proposals
              where principal_kind = 'agent' or state = 'withdrawn' or action_type <> 'library_label'
                 or collection_id is null or pg_catalog.octet_length(input::text) > 4096) then
    raise exception 'agent_proposals_rollback_refused: world_change_proposals holds rows only 20261117130000 allows';
  end if;
  if exists (select 1 from public.foundation_api_keys where token_kind = 'agent' or agent_grant_id is not null) then
    raise exception 'agent_proposals_rollback_refused: agent credentials exist';
  end if;
  if exists (select 1 from public.foundation_agent_grants) then
    raise exception 'agent_proposals_rollback_refused: agent grants exist';
  end if;
end $$;

drop function public.create_foundation_agent_grant(text, uuid, bigint, text, text, text, text, text[], timestamptz);
drop function public.revoke_foundation_agent_grant(text, uuid, uuid);
drop function public.revoke_all_foundation_agent_grants();
drop function public.get_world_change_proposal(text, uuid);
drop function public.list_world_change_proposals_page(text, uuid, timestamptz, uuid, integer);
drop function public.list_collection_candidates(text, text, integer);
drop function public.quote_foundation_compile_recharge(text, uuid[]);
drop function public.record_foundation_review_patch_if_leaf(text, text, text, text, text, text, integer, integer[], text, uuid, text, text, text, text);

-- create_world_change_proposal and decide_world_change_proposal, as 20261116130100 made them.
drop function public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz, text, uuid, integer, integer);
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

drop function public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz);
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
    when p_current_manifest_digest <> v_row.expected_manifest_digest then 'stale'
    when p_decision = 'reject' then 'rejected'
    else 'confirmed'
  end;
  update public.world_change_proposals
    set state = v_state, decided_at = p_now, decided_by = p_decided_by
    where proposal_id = p_proposal_id
    returning * into v_row;
  return pg_catalog.to_jsonb(v_row);
end; $$;

revoke all on function public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz) to service_role;
revoke all on function public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz) to service_role;

-- consume_foundation_api_rate_limit, as 0012 made it.
create or replace function public.consume_foundation_api_rate_limit(
  p_key_id uuid,
  p_workspace_key text,
  p_scope text,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  v_count integer;
begin
  delete from public.foundation_api_rate_windows
    where key_id = p_key_id and window_started_at < v_window - interval '1 day';
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_scope not in (
      'documents:read', 'documents:intake', 'collections:read', 'collections:compile',
      'collections:download', 'worlds:read', 'ask:read',
      'connections:read', 'connections:write', 'connections:sync'
    )
    or p_limit not between 1 and 1000
    or not exists (
      select 1 from public.foundation_api_keys
      where key_id = p_key_id and workspace_key = p_workspace_key
        and revoked_at is null and (expires_at is null or expires_at > clock_timestamp())
    ) then
    return false;
  end if;

  insert into public.foundation_api_rate_windows (
    key_id, workspace_key, scope, window_started_at, request_count
  ) values (p_key_id, p_workspace_key, p_scope, v_window, 1)
  on conflict (key_id, scope, window_started_at) do update
    set request_count = public.foundation_api_rate_windows.request_count + 1
    where public.foundation_api_rate_windows.request_count < p_limit
  returning request_count into v_count;
  if v_count is not null and v_count <= p_limit then
    update public.foundation_api_keys set last_used_at = clock_timestamp()
      where key_id = p_key_id;
  end if;
  return v_count is not null and v_count <= p_limit;
end;
$$;
revoke all on function public.consume_foundation_api_rate_limit(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.consume_foundation_api_rate_limit(uuid, text, text, integer) to service_role;

-- world_change_proposals, as 20261116130100 made it.
drop index public.world_change_proposals_workspace_page_idx;
drop index public.world_change_proposals_agent_grant_idx;
drop index public.world_change_proposals_agent_open_idx;
alter table public.world_change_proposals
  drop constraint world_change_proposals_withdrawn_check,
  drop constraint world_change_proposals_state_check,
  drop constraint world_change_proposals_agent_grant_check,
  drop constraint world_change_proposals_principal_kind_check,
  drop constraint world_change_proposals_input_check,
  drop constraint world_change_proposals_binding_pairing_check,
  drop constraint world_change_proposals_binding_collection_check,
  drop constraint world_change_proposals_action_type_check;
alter table public.world_change_proposals drop column agent_grant_id, drop column binding_kind;
alter table public.world_change_proposals
  add constraint world_change_proposals_state_check check (state in
    ('proposed', 'confirmed', 'rejected', 'expired', 'stale', 'executed', 'failed', 'undone')),
  add constraint world_change_proposals_principal_kind_check check (principal_kind in ('session', 'steward')),
  add constraint world_change_proposals_input_check
    check (jsonb_typeof(input) = 'object' and pg_catalog.octet_length(input::text) <= 4096),
  add constraint world_change_proposals_action_type_check check (action_type in ('library_label'));
alter table public.world_change_proposals alter column collection_id set not null;

-- foundation_api_keys, as 20261105000000 left it.
drop index public.foundation_api_keys_agent_grant_idx;
alter table public.foundation_api_keys
  drop constraint foundation_api_keys_scopes_by_kind_check,
  drop constraint foundation_api_keys_agent_grant_check,
  drop constraint foundation_api_keys_agent_expiry_check,
  drop constraint foundation_api_keys_token_kind_check;
alter table public.foundation_api_keys drop column agent_grant_id;
alter table public.foundation_api_keys
  add constraint foundation_api_keys_token_kind_check check (token_kind in ('live', 'mcp')),
  add constraint foundation_api_keys_scopes_check check (
    cardinality(scopes) between 1 and 12
    and scopes <@ array[
      'documents:read', 'documents:intake', 'collections:read', 'collections:compile',
      'collections:download', 'worlds:read', 'ask:read',
      'connections:read', 'connections:write', 'connections:sync'
    ]::text[]);

drop table public.foundation_agent_grants;

commit;
