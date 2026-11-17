-- WO-AN-1 (V34 agent-native v1, workorders/agent-native.md §5): an agent proposes, a person confirms.
--
-- Ordering: after 20261117120000_page_meter_settlement. The timestamp is a placeholder in the serial
-- chain shared with the catalog migrations (WO-CAT-3..6); whichever merges second takes the later
-- timestamp. Applied to production before any code that passes the new parameters (release stage 1).
-- Old named-argument calls still resolve: create_world_change_proposal keeps its twelve parameters and
-- adds four trailing ones with defaults; decide_world_change_proposal keeps its six, and `p_now` is
-- accepted and IGNORED (expiry is decided by the database clock). Each function is dropped and created
-- once, so exactly one candidate exists for PostgREST to resolve.
--
-- What it adds:
--   1. foundation_agent_grants: the stable "agent" a person connected. A credential is a
--      foundation_api_keys row with token_kind 'agent' and agent_grant_id set; liveness, disconnect,
--      the open-proposal cap and the replay namespace key on the grant, never on the key.
--   2. foundation_api_keys: token_kind 'agent', agent scopes disjoint from the developer scopes,
--      every agent key bound to a grant and expiring. create_foundation_api_key_authorized cannot
--      mint an agent key (no grant id): only create_foundation_agent_grant does.
--   3. world_change_proposals: two new action types with their binding kinds, nullable collection for
--      a compile, agent principals bound to a grant, state 'withdrawn' (decided_at set, decided_by
--      null, no receipt), an open-proposal cap per (workspace, person) across all their grants.
--   4. Read RPCs for the executors (stable) and record_foundation_review_patch_if_leaf, which checks
--      "this base has no recorded correction" and records the correction in one transaction.
--
-- Lock order, the same in every function that takes more than one: proposal-key advisory lock ->
-- grant row -> membership row -> open-cap advisory lock -> proposal row. decide reads the proposal's
-- grant id without a lock first, so it never holds a proposal row while waiting for a grant that a
-- revoke holds while it withdraws that proposal.
--
-- Every new or changed function: security definer, search_path '', revoked from public, anon,
-- authenticated and service_role, execute granted to service_role only. The new table has RLS on, a
-- restrictive deny-all policy and no grant.
begin;

-- ---------------------------------------------------------------------------------------------
-- Generated constraint names this migration drops: fail loudly when one is not what the chain made.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'foundation_api_keys:foundation_api_keys_token_kind_check',
    'foundation_api_keys:foundation_api_keys_scopes_check',
    'world_change_proposals:world_change_proposals_action_type_check',
    'world_change_proposals:world_change_proposals_input_check',
    'world_change_proposals:world_change_proposals_principal_kind_check',
    'world_change_proposals:world_change_proposals_state_check',
    'world_change_proposals:world_change_proposals_collection_id_check'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
       where conrelid = pg_catalog.to_regclass('public.' || pg_catalog.split_part(v_name, ':', 1))
         and conname = pg_catalog.split_part(v_name, ':', 2)) then
      raise exception 'agent_proposals_migration_constraint_missing: %', v_name;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. Grants (§5.1)
-- ---------------------------------------------------------------------------------------------
create table public.foundation_agent_grants (
  grant_id uuid primary key default gen_random_uuid(),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  user_id uuid not null references auth.users(id) on delete restrict,
  client_label text not null check (pg_catalog.char_length(client_label) between 1 and 48 and client_label !~ '[[:cntrl:]]'),
  grantor_email text check (grantor_email is null or pg_catalog.char_length(grantor_email) <= 320),
  authorization_revision bigint not null check (authorization_revision >= 1),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  revoked_at timestamptz check (revoked_at is null or revoked_at >= created_at)
);
create index foundation_agent_grants_workspace_user_idx
  on public.foundation_agent_grants (workspace_key, user_id, created_at desc);

alter table public.foundation_agent_grants enable row level security;
revoke all on public.foundation_agent_grants from public, anon, authenticated, service_role;
create policy foundation_agent_grants_no_client_access on public.foundation_agent_grants
  as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------------------------------------
-- 2. foundation_api_keys (§5.2)
-- ---------------------------------------------------------------------------------------------
alter table public.foundation_api_keys drop constraint foundation_api_keys_token_kind_check;
alter table public.foundation_api_keys
  add constraint foundation_api_keys_token_kind_check check (token_kind in ('live', 'mcp', 'agent'));

alter table public.foundation_api_keys
  add column agent_grant_id uuid references public.foundation_agent_grants(grant_id) on delete restrict;
alter table public.foundation_api_keys
  add constraint foundation_api_keys_agent_grant_check check ((token_kind = 'agent') = (agent_grant_id is not null)),
  add constraint foundation_api_keys_agent_expiry_check check (token_kind <> 'agent' or expires_at is not null);
create index foundation_api_keys_agent_grant_idx
  on public.foundation_api_keys (agent_grant_id) where agent_grant_id is not null;

alter table public.foundation_api_keys drop constraint foundation_api_keys_scopes_check;
alter table public.foundation_api_keys
  add constraint foundation_api_keys_scopes_by_kind_check check (
    pg_catalog.cardinality(scopes) between 1 and 12
    and (case when token_kind = 'agent'
      then scopes <@ array['agent:read', 'agent:propose']::text[]
      else scopes <@ array[
        'documents:read', 'documents:intake', 'collections:read', 'collections:compile',
        'collections:download', 'worlds:read', 'ask:read',
        'connections:read', 'connections:write', 'connections:sync'
      ]::text[] end));

-- Body identical to 0012 except the scope list gains the two agent scopes.
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
      'connections:read', 'connections:write', 'connections:sync',
      'agent:read', 'agent:propose'
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

-- ---------------------------------------------------------------------------------------------
-- 3. Grant RPCs (§5.3)
-- ---------------------------------------------------------------------------------------------
create function public.create_foundation_agent_grant(
  p_workspace_key text, p_actor_user_id uuid, p_authorization_revision bigint, p_client_label text,
  p_grantor_email text, p_key_prefix text, p_token_sha256 text, p_scopes text[], p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_membership public.foundation_workspace_members%rowtype;
  v_grant public.foundation_agent_grants%rowtype;
  v_key public.foundation_api_keys%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_actor_user_id is null or p_authorization_revision is null
    or p_scopes is null or p_expires_at is null or p_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'agent_grant_request_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_key, 0));
  select * into v_membership from public.foundation_workspace_members
    where workspace_key = p_workspace_key and user_id = p_actor_user_id
    for update;
  if not found or v_membership.state <> 'active'
    or v_membership.authorization_revision <> p_authorization_revision then
    raise exception 'api_key_authorization_changed';
  end if;

  insert into public.foundation_agent_grants (workspace_key, user_id, client_label, grantor_email, authorization_revision)
    values (p_workspace_key, p_actor_user_id, p_client_label, p_grantor_email, p_authorization_revision)
    returning * into v_grant;
  insert into public.foundation_api_keys (
    workspace_key, name, key_prefix, token_sha256, scopes, created_by,
    expires_at, authorization_revision, token_kind, agent_grant_id
  ) values (
    p_workspace_key, 'Agent access', p_key_prefix, p_token_sha256, p_scopes, p_actor_user_id,
    p_expires_at, p_authorization_revision, 'agent', v_grant.grant_id
  ) returning * into v_key;
  insert into public.foundation_developer_audit_events (
    workspace_key, action, target_id, actor_user_id, actor_key_id, details
  ) values (
    p_workspace_key, 'api_key_created', v_key.key_id::text, p_actor_user_id, null,
    pg_catalog.jsonb_build_object('tokenKind', 'agent', 'grantId', v_grant.grant_id, 'scopes', p_scopes,
      'authorizationRevision', p_authorization_revision)
  );
  return pg_catalog.jsonb_build_object('grantId', v_grant.grant_id, 'keyId', v_key.key_id, 'keyPrefix', v_key.key_prefix,
    'scopes', v_key.scopes, 'createdAt', v_key.created_at, 'expiresAt', v_key.expires_at);
end; $$;

-- No membership-revision check: revocation only ever reduces access.
create function public.revoke_foundation_agent_grant(p_workspace_key text, p_grant_id uuid, p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_grant public.foundation_agent_grants%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_keys integer;
  v_proposals integer;
begin
  if p_workspace_key is null or p_grant_id is null or p_actor_user_id is null then
    raise exception 'agent_grant_request_invalid';
  end if;
  select * into v_grant from public.foundation_agent_grants
    where grant_id = p_grant_id and workspace_key = p_workspace_key and user_id = p_actor_user_id and revoked_at is null
    for update;
  if not found then
    raise exception 'agent_grant_not_found';
  end if;

  update public.foundation_agent_grants set revoked_at = v_now where grant_id = p_grant_id;
  with revoked as (
    update public.foundation_api_keys set revoked_at = v_now
      where agent_grant_id = p_grant_id and revoked_at is null
      returning key_id
  ), audit as (
    insert into public.foundation_developer_audit_events (workspace_key, action, target_id, actor_user_id, details)
    select p_workspace_key, 'api_key_revoked', r.key_id::text, p_actor_user_id,
      pg_catalog.jsonb_build_object('tokenKind', 'agent', 'grantId', p_grant_id)
      from revoked r
    returning 1
  )
  select pg_catalog.count(*)::integer into v_keys from audit;
  update public.world_change_proposals
    set state = 'withdrawn', decided_at = v_now, decided_by = null
    where agent_grant_id = p_grant_id and state = 'proposed';
  get diagnostics v_proposals = row_count;
  return pg_catalog.jsonb_build_object('revokedAt', v_now, 'keysRevoked', v_keys, 'proposalsWithdrawn', v_proposals);
end; $$;

-- The kill switch: every grant, every agent credential, every open agent proposal, one transaction.
create function public.revoke_all_foundation_agent_grants()
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '30s' as $$
declare
  v_out jsonb;
begin
  -- Grants first (the lock order every other function uses), then keys, then proposals.
  perform 1 from public.foundation_agent_grants where revoked_at is null for update;
  with g as (
    update public.foundation_agent_grants set revoked_at = pg_catalog.clock_timestamp()
      where revoked_at is null returning workspace_key, 'grants'::text as kind
  ), k as (
    update public.foundation_api_keys set revoked_at = pg_catalog.clock_timestamp()
      where token_kind = 'agent' and revoked_at is null returning workspace_key, 'keys'::text as kind
  ), p as (
    update public.world_change_proposals set state = 'withdrawn', decided_at = pg_catalog.clock_timestamp(), decided_by = null
      where principal_kind = 'agent' and state = 'proposed' returning workspace_key, 'proposals'::text as kind
  ), changed as (
    select * from g union all select * from k union all select * from p
  ), per_kind as (
    select workspace_key, kind, pg_catalog.count(*)::integer as n from changed group by workspace_key, kind
  )
  select pg_catalog.jsonb_build_object(
      'grants', (select pg_catalog.count(*)::integer from changed where kind = 'grants'),
      'keys', (select pg_catalog.count(*)::integer from changed where kind = 'keys'),
      'proposals', (select pg_catalog.count(*)::integer from changed where kind = 'proposals'),
      'byWorkspace', coalesce((select pg_catalog.jsonb_object_agg(w.workspace_key, w.counts)
        from (select workspace_key, pg_catalog.jsonb_object_agg(kind, n) as counts from per_kind group by workspace_key) w),
        '{}'::jsonb))
    into v_out;
  return v_out;
end; $$;

-- ---------------------------------------------------------------------------------------------
-- 4. world_change_proposals (§5.4)
-- ---------------------------------------------------------------------------------------------
-- The existing collection_id CHECK (a regex match) already passes a null; only NOT NULL goes.
alter table public.world_change_proposals alter column collection_id drop not null;

alter table public.world_change_proposals drop constraint world_change_proposals_action_type_check;
alter table public.world_change_proposals add constraint world_change_proposals_action_type_check
  check (action_type in ('library_label', 'compile_plan', 'ontology_label_patch'));

alter table public.world_change_proposals
  add column binding_kind text not null default 'active_manifest'
    constraint world_change_proposals_binding_kind_check
    check (binding_kind in ('active_manifest', 'source_inventory', 'correction_leaf'));
alter table public.world_change_proposals
  add constraint world_change_proposals_binding_pairing_check check (
    (action_type = 'library_label' and binding_kind = 'active_manifest')
    or (action_type = 'compile_plan' and binding_kind = 'source_inventory')
    or (action_type = 'ontology_label_patch' and binding_kind = 'correction_leaf')),
  add constraint world_change_proposals_binding_collection_check
    check ((binding_kind = 'source_inventory') = (collection_id is null));

alter table public.world_change_proposals drop constraint world_change_proposals_input_check;
alter table public.world_change_proposals add constraint world_change_proposals_input_check
  check (jsonb_typeof(input) = 'object' and pg_catalog.octet_length(input::text) <= 8192);

alter table public.world_change_proposals drop constraint world_change_proposals_principal_kind_check;
alter table public.world_change_proposals add constraint world_change_proposals_principal_kind_check
  check (principal_kind in ('session', 'steward', 'agent'));
alter table public.world_change_proposals
  add column agent_grant_id uuid references public.foundation_agent_grants(grant_id);
alter table public.world_change_proposals add constraint world_change_proposals_agent_grant_check
  check ((principal_kind = 'agent') = (agent_grant_id is not null));

alter table public.world_change_proposals drop constraint world_change_proposals_state_check;
alter table public.world_change_proposals add constraint world_change_proposals_state_check check (state in
  ('proposed', 'confirmed', 'rejected', 'expired', 'stale', 'executed', 'failed', 'undone', 'withdrawn'));
alter table public.world_change_proposals add constraint world_change_proposals_withdrawn_check
  check (state <> 'withdrawn' or (principal_kind = 'agent' and decided_by is null and receipt is null));

create index world_change_proposals_workspace_page_idx
  on public.world_change_proposals (workspace_key, created_at desc, proposal_id desc);
create index world_change_proposals_agent_grant_idx
  on public.world_change_proposals (workspace_key, agent_grant_id, created_at desc) where agent_grant_id is not null;
create index world_change_proposals_agent_open_idx
  on public.world_change_proposals (workspace_key, principal_id) where state = 'proposed' and principal_kind = 'agent';

-- ---------------------------------------------------------------------------------------------
-- 5. Proposal RPCs (§5.5)
-- ---------------------------------------------------------------------------------------------
drop function public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz);
create function public.create_world_change_proposal(
  p_workspace_key text, p_collection_id text, p_action_type text, p_input jsonb, p_input_sha256 text,
  p_evidence_ids text[], p_expected_manifest_digest text, p_authorization_revision integer,
  p_principal_kind text, p_principal_id uuid, p_idempotency_key text, p_expires_at timestamptz,
  p_binding_kind text default 'active_manifest', p_agent_grant_id uuid default null,
  p_open_limit integer default null, p_open_reserve integer default 1)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_row public.world_change_proposals%rowtype;
  v_grant public.foundation_agent_grants%rowtype;
  v_open integer;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_action_type is null or p_binding_kind is null
    or not ((p_action_type = 'library_label' and p_binding_kind = 'active_manifest')
         or (p_action_type = 'compile_plan' and p_binding_kind = 'source_inventory')
         or (p_action_type = 'ontology_label_patch' and p_binding_kind = 'correction_leaf'))
    or (p_binding_kind = 'source_inventory') <> (p_collection_id is null)
    or (p_collection_id is not null and p_collection_id !~ '^collection-[a-f0-9]{32}$')
    or p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object' or pg_catalog.octet_length(p_input::text) > 8192
    or p_input_sha256 is null or p_input_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_evidence_ids is null or pg_catalog.cardinality(p_evidence_ids) > 16
    or p_expected_manifest_digest is null or p_expected_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_authorization_revision is null or p_authorization_revision < 0
    or p_principal_kind is null or p_principal_kind not in ('session', 'steward', 'agent')
    or p_principal_id is null
    or (p_principal_kind = 'agent') <> (p_agent_grant_id is not null)
    or (p_principal_kind = 'agent') <> (p_open_limit is not null)
    or (p_open_limit is not null and p_open_limit not between 1 and 10000)
    or p_open_reserve is null or p_open_reserve not between 1 and 10000
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    or p_expires_at is null or p_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'proposal_request_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('world_change_proposal:' || p_workspace_key || ':' || p_idempotency_key, 0));

  -- An agent's grant is live, the person's own, and at the membership revision it was made at.
  -- `for share` makes a concurrent revoke and this insert serialize on the grant row (I-12).
  if p_principal_kind = 'agent' then
    select * into v_grant from public.foundation_agent_grants where grant_id = p_agent_grant_id for share;
    if not found or v_grant.revoked_at is not null or v_grant.workspace_key <> p_workspace_key
      or v_grant.user_id <> p_principal_id or v_grant.authorization_revision <> p_authorization_revision then
      raise exception 'proposal_agent_grant_revoked';
    end if;
    perform 1 from public.foundation_workspace_members
      where workspace_key = v_grant.workspace_key and user_id = v_grant.user_id
        and state = 'active' and authorization_revision = v_grant.authorization_revision
      for share;
    if not found then
      raise exception 'proposal_agent_grant_revoked';
    end if;
  end if;

  select * into v_row from public.world_change_proposals
    where workspace_key = p_workspace_key and idempotency_key = p_idempotency_key;
  if found then
    if v_row.input_sha256 <> p_input_sha256
      or v_row.collection_id is distinct from p_collection_id
      or v_row.action_type <> p_action_type
      or v_row.principal_kind <> p_principal_kind
      or v_row.principal_id <> p_principal_id
      or v_row.agent_grant_id is distinct from p_agent_grant_id then
      raise exception 'proposal_idempotency_conflict';
    end if;
    return jsonb_build_object('proposal', pg_catalog.to_jsonb(v_row), 'replayed', true);
  end if;

  -- The open cap counts the person's open agent proposals across ALL their grants (I-13).
  if p_principal_kind = 'agent' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wcp_open:' || p_workspace_key || ':' || p_principal_id::text, 0));
    select pg_catalog.count(*)::integer into v_open from public.world_change_proposals
      where workspace_key = p_workspace_key and principal_id = p_principal_id
        and principal_kind = 'agent' and state = 'proposed' and expires_at > pg_catalog.clock_timestamp();
    if v_open + p_open_reserve > p_open_limit then
      raise exception 'proposal_open_limit';
    end if;
  end if;

  insert into public.world_change_proposals (
    workspace_key, collection_id, action_type, input, input_sha256, evidence_ids, expected_manifest_digest,
    authorization_revision, principal_kind, principal_id, idempotency_key, expires_at, binding_kind, agent_grant_id)
  values (
    p_workspace_key, p_collection_id, p_action_type, p_input, p_input_sha256, p_evidence_ids, p_expected_manifest_digest,
    p_authorization_revision, p_principal_kind, p_principal_id, p_idempotency_key, p_expires_at, p_binding_kind, p_agent_grant_id)
  returning * into v_row;
  return jsonb_build_object('proposal', pg_catalog.to_jsonb(v_row), 'replayed', false);
end; $$;

drop function public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz);
create function public.decide_world_change_proposal(
  p_workspace_key text, p_proposal_id uuid, p_decision text, p_decided_by uuid,
  p_current_manifest_digest text, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_row public.world_change_proposals%rowtype;
  v_grant_id uuid;
  v_grant public.foundation_agent_grants%rowtype;
  v_grant_live boolean := false;
  v_now timestamptz;
  v_state text;
begin
  -- p_now is accepted so the deployed caller still resolves, and ignored: expiry is the DB clock's.
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_proposal_id is null
    or p_decision is null or p_decision not in ('confirm', 'reject')
    or p_decided_by is null
    or p_current_manifest_digest is null or p_current_manifest_digest !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'proposal_request_invalid';
  end if;

  -- Grant before row: a revoke holds the grant while it withdraws this row.
  select agent_grant_id into v_grant_id from public.world_change_proposals
    where proposal_id = p_proposal_id and workspace_key = p_workspace_key;
  if v_grant_id is not null then
    select * into v_grant from public.foundation_agent_grants where grant_id = v_grant_id for share;
    if found and v_grant.revoked_at is null then
      perform 1 from public.foundation_workspace_members
        where workspace_key = v_grant.workspace_key and user_id = v_grant.user_id
          and state = 'active' and authorization_revision = v_grant.authorization_revision
        for share;
      v_grant_live := found;
    end if;
  end if;

  select * into v_row from public.world_change_proposals
    where proposal_id = p_proposal_id and workspace_key = p_workspace_key for update;
  if not found then
    raise exception 'proposal_not_found';
  end if;
  if v_row.state <> 'proposed' then
    raise exception 'proposal_not_decidable';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_state := case
    when v_now >= v_row.expires_at then 'expired'
    when v_row.principal_kind = 'agent' and not v_grant_live then 'withdrawn'
    when p_current_manifest_digest <> v_row.expected_manifest_digest then 'stale'
    when p_decision = 'reject' then 'rejected'
    else 'confirmed'
  end;
  update public.world_change_proposals
    set state = v_state, decided_at = v_now,
        decided_by = case when v_state = 'withdrawn' then null else p_decided_by end
    where proposal_id = p_proposal_id
    returning * into v_row;
  return pg_catalog.to_jsonb(v_row);
end; $$;

create function public.get_world_change_proposal(p_workspace_key text, p_proposal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_out jsonb;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' or p_proposal_id is null then
    raise exception 'proposal_request_invalid';
  end if;
  select pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object('agent_client_label', g.client_label, 'agent_grantor_email', g.grantor_email)
    into v_out
    from public.world_change_proposals p
    left join public.foundation_agent_grants g on g.grant_id = p.agent_grant_id
   where p.workspace_key = p_workspace_key and p.proposal_id = p_proposal_id;
  if v_out is null then
    raise exception 'proposal_not_found';
  end if;
  return v_out;
end; $$;

create function public.list_world_change_proposals_page(
  p_workspace_key text, p_agent_grant_id uuid, p_before_created_at timestamptz, p_before_id uuid, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '3s' as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or (p_before_created_at is null) <> (p_before_id is null)
    or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'proposal_request_invalid';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(x.p) || pg_catalog.jsonb_build_object('agent_client_label', x.client_label, 'agent_grantor_email', x.grantor_email)
             order by (x.p).created_at desc, (x.p).proposal_id desc)
      from (select p, g.client_label, g.grantor_email
              from public.world_change_proposals p
              left join public.foundation_agent_grants g on g.grant_id = p.agent_grant_id
             where p.workspace_key = p_workspace_key
               and (p_agent_grant_id is null or p.agent_grant_id = p_agent_grant_id)
               and (p_before_created_at is null or (p.created_at, p.proposal_id) < (p_before_created_at, p_before_id))
             order by p.created_at desc, p.proposal_id desc
             limit p_limit) x
  ), '[]'::jsonb);
end; $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Read and guard RPCs for the executors (§5.6)
-- ---------------------------------------------------------------------------------------------
create function public.list_collection_candidates(p_workspace_key text, p_collection_id text, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '3s' as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_collection_id is null or p_collection_id !~ '^collection-[a-f0-9]{32}$'
    or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'collection_candidates_request_invalid';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'manifestDigest', c.manifest_digest, 'registeredAt', c.registered_at, 'documentIds', c.document_ids)
             order by c.registered_at desc, c.manifest_digest desc)
      from (select d.manifest_digest, d.registered_at, d.document_ids
              from (select distinct on (r.manifest_digest) r.manifest_digest, r.registered_at, r.document_ids
                      from public.foundation_collection_artifact_provenance r
                     where r.workspace_key = p_workspace_key and r.collection_id = p_collection_id
                     order by r.manifest_digest, r.registered_at) d
             order by d.registered_at desc, d.manifest_digest desc
             limit p_limit) c
  ), '[]'::jsonb);
end; $$;

-- Exactly the rows recharge_foundation_compute_for_ready_compile (20261117120000) loops over, with its
-- arithmetic: per paid row the balance pays least(settled, reserved) and the rest of reversed_credits is
-- booked as overage whatever the balance. The twin rule (which can only lower the charge) is ignored, so
-- every figure is an upper bound.
create function public.quote_foundation_compile_recharge(p_workspace_key text, p_document_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_reservations jsonb;
  v_total bigint;
  v_balance_part bigint;
  v_overage bigint;
  v_balance integer;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_document_ids is null or pg_catalog.cardinality(p_document_ids) not between 1 and 1000
    or pg_catalog.array_position(p_document_ids, null) is not null then
    raise exception 'compile_quote_request_invalid';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'reservationId', c.reservation_id, 'documentId', c.document_id, 'billingSource', c.billing_source,
           'reversedCredits', c.reversed_credits, 'settledCredits', c.settled_credits, 'reservedCredits', c.reserved_credits)
           order by c.reservation_id), '[]'::jsonb),
         coalesce(pg_catalog.sum(c.reversed_credits), 0),
         coalesce(pg_catalog.sum(least(c.settled_credits, c.reserved_credits)) filter (where c.billing_source = 'paid'), 0),
         coalesce(pg_catalog.sum(c.reversed_credits - least(c.settled_credits, c.reserved_credits)) filter (where c.billing_source = 'paid'), 0)
    into v_reservations, v_total, v_balance_part, v_overage
    from public.foundation_compute_reservations c
   where c.workspace_key = p_workspace_key
     and c.document_id = any (p_document_ids)
     and c.reversed_at is not null and c.recharged_at is null;
  select credit_balance into v_balance from public.foundation_billing_accounts where workspace_key = p_workspace_key;
  return pg_catalog.jsonb_build_object('reservations', v_reservations, 'totalRechargeCredits', v_total,
    'balanceRechargeCredits', v_balance_part, 'overageCredits', v_overage, 'balanceCredits', coalesce(v_balance, 0));
end; $$;

-- The leaf check and the correction's record are one transaction under one lock per base.
create function public.record_foundation_review_patch_if_leaf(
  p_workspace_key text, p_collection_id text, p_manifest_digest text, p_evidence_id text, p_source_id text,
  p_source_version_id text, p_page_number integer, p_bbox_1000 integer[], p_reason text, p_actor_user_id uuid,
  p_patch_object_id text, p_patch_before text, p_patch_after text, p_resulting_manifest_digest text)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  v_existing public.foundation_review_decisions%rowtype;
  v_row public.foundation_review_decisions%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_collection_id is null or p_collection_id !~ '^collection-[a-f0-9]{32}$'
    or p_manifest_digest is null or p_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_resulting_manifest_digest is null or p_resulting_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_resulting_manifest_digest = p_manifest_digest then
    raise exception 'review_patch_request_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'review_patch_leaf:' || p_workspace_key || ':' || p_collection_id || ':' || p_manifest_digest, 0));

  select * into v_existing from public.foundation_review_decisions
    where workspace_key = p_workspace_key and collection_id = p_collection_id
      and manifest_digest = p_manifest_digest and resulting_manifest_digest is not null
    order by (resulting_manifest_digest = p_resulting_manifest_digest) desc, created_at
    limit 1;
  if found then
    if v_existing.resulting_manifest_digest = p_resulting_manifest_digest then
      return pg_catalog.jsonb_build_object('decisionId', v_existing.decision_id, 'recordedAt', v_existing.created_at, 'replayed', true);
    end if;
    raise exception 'review_base_not_head';
  end if;

  insert into public.foundation_review_decisions (
    workspace_key, collection_id, manifest_digest, evidence_id, source_id, source_version_id, page_number, bbox_1000,
    action, reason, actor_user_id, patch_object_id, patch_before, patch_after, resulting_manifest_digest)
  values (
    p_workspace_key, p_collection_id, p_manifest_digest, p_evidence_id, p_source_id, p_source_version_id, p_page_number, p_bbox_1000,
    'edit', p_reason, p_actor_user_id, p_patch_object_id, p_patch_before, p_patch_after, p_resulting_manifest_digest)
  returning * into v_row;
  return pg_catalog.jsonb_build_object('decisionId', v_row.decision_id, 'recordedAt', v_row.created_at, 'replayed', false);
end; $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Privileges: service_role executes, nobody else.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.consume_foundation_api_rate_limit(uuid, text, text, integer)',
    'public.create_foundation_agent_grant(text, uuid, bigint, text, text, text, text, text[], timestamptz)',
    'public.revoke_foundation_agent_grant(text, uuid, uuid)',
    'public.revoke_all_foundation_agent_grants()',
    'public.create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz, text, uuid, integer, integer)',
    'public.decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz)',
    'public.get_world_change_proposal(text, uuid)',
    'public.list_world_change_proposals_page(text, uuid, timestamptz, uuid, integer)',
    'public.list_collection_candidates(text, text, integer)',
    'public.quote_foundation_compile_recharge(text, uuid[])',
    'public.record_foundation_review_patch_if_leaf(text, text, text, text, text, text, integer, integer[], text, uuid, text, text, text, text)'
  ] loop
    execute 'revoke all on function ' || v_fn || ' from public, anon, authenticated, service_role';
    execute 'grant execute on function ' || v_fn || ' to service_role';
  end loop;
end $$;

commit;
