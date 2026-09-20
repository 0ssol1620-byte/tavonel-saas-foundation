-- B27: race-safe Foundation world activation and rollback.
--
-- The original 0007 RPCs serialized writers by collection, but their CAS compared only the
-- current digest. A digest can become active, be superseded, and become active again (ABA), so a
-- stale writer could pass that comparison. They also trusted a caller-supplied actor UUID. This
-- migration adds a revision-and-state CAS, transaction-local membership authorization, durable
-- idempotency, and an audit receipt bound to the resulting pointer revision.
begin;

alter table public.foundation_workspace_members
  add column authorization_revision bigint not null default 1
    check (authorization_revision > 0);

create or replace function public.bump_foundation_workspace_authorization_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
    or new.state is distinct from old.state
    or new.accepted_at is distinct from old.accepted_at
    or new.revoked_at is distinct from old.revoked_at then
    new.authorization_revision := old.authorization_revision + 1;
  else
    new.authorization_revision := old.authorization_revision;
  end if;
  return new;
end;
$$;

create trigger foundation_workspace_authorization_revision_bump
  before update on public.foundation_workspace_members
  for each row execute function public.bump_foundation_workspace_authorization_revision();

create table public.foundation_world_transition_receipts (
  operation_id uuid primary key,
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  collection_id text not null check (collection_id ~ '^collection-[a-f0-9]{32}$'),
  action text not null check (action in ('activate', 'rollback')),
  request_sha256 text not null check (request_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  event_id uuid not null unique references public.foundation_world_events(event_id) on delete restrict,
  from_manifest_digest text check (
    from_manifest_digest is null or from_manifest_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  to_manifest_digest text not null check (to_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  before_revision bigint not null check (before_revision >= 0),
  after_revision bigint not null check (after_revision >= before_revision),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_role text not null check (actor_role in ('owner', 'admin')),
  authorization_revision bigint not null check (authorization_revision > 0),
  outcome text not null check (outcome in ('applied', 'already_active')),
  receipt_sha256 text not null unique check (receipt_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (workspace_key, collection_id, request_sha256),
  check (
    (outcome = 'applied' and after_revision = before_revision + 1)
    or (outcome = 'already_active' and after_revision = before_revision)
  )
);
create index foundation_world_transition_receipts_scope_idx
  on public.foundation_world_transition_receipts (
    workspace_key, collection_id, created_at desc, operation_id
  );

alter table public.foundation_world_transition_receipts enable row level security;
revoke all on public.foundation_world_transition_receipts from public, anon, authenticated, service_role;
grant select on public.foundation_world_transition_receipts to service_role;

create or replace function public.foundation_world_transition_request_sha256(
  p_operation_id uuid,
  p_action text,
  p_workspace_key text,
  p_collection_id text,
  p_target_manifest_digest text,
  p_candidate_object_key text,
  p_world_state_id text,
  p_core_output_sha256 text,
  p_expected_current_state text,
  p_expected_current_revision bigint,
  p_expected_current_manifest_digest text,
  p_actor_user_id uuid,
  p_reason text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select 'sha256:' || pg_catalog.encode(
    public.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'operationId', p_operation_id,
          'action', p_action,
          'workspaceKey', p_workspace_key,
          'collectionId', p_collection_id,
          'targetManifestDigest', p_target_manifest_digest,
          'candidateObjectKey', p_candidate_object_key,
          'worldStateId', p_world_state_id,
          'coreOutputSha256', p_core_output_sha256,
          'expectedCurrentState', p_expected_current_state,
          'expectedCurrentRevision', p_expected_current_revision,
          'expectedCurrentManifestDigest', p_expected_current_manifest_digest,
          'actorUserId', p_actor_user_id,
          'reason', p_reason
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.assert_foundation_world_pointer_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_key text := coalesce(new.workspace_key, old.workspace_key);
  v_collection_id text := coalesce(new.collection_id, old.collection_id);
  v_pointer_manifest text;
  v_active_manifest text;
  v_active_count integer;
begin
  select manifest_digest into v_pointer_manifest
    from public.foundation_active_worlds
   where workspace_key = v_workspace_key and collection_id = v_collection_id;

  select count(*)::integer, min(manifest_digest)
    into v_active_count, v_active_manifest
    from public.foundation_world_versions
   where workspace_key = v_workspace_key and collection_id = v_collection_id
     and lifecycle_status = 'active';

  if v_pointer_manifest is null then
    if v_active_count <> 0 then
      raise exception 'world_active_pointer_invariant_broken';
    end if;
  elsif v_active_count <> 1 or v_active_manifest is distinct from v_pointer_manifest then
    raise exception 'world_active_pointer_invariant_broken';
  end if;
  return null;
end;
$$;

create constraint trigger foundation_world_versions_pointer_invariant
  after insert or update or delete on public.foundation_world_versions
  deferrable initially deferred
  for each row execute function public.assert_foundation_world_pointer_invariant();
create constraint trigger foundation_active_worlds_version_invariant
  after insert or update or delete on public.foundation_active_worlds
  deferrable initially deferred
  for each row execute function public.assert_foundation_world_pointer_invariant();

create or replace function public.prevent_foundation_world_transition_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'foundation_world_transition_receipts_append_only';
end;
$$;
create trigger foundation_world_transition_receipts_append_only
  before update or delete on public.foundation_world_transition_receipts
  for each row execute function public.prevent_foundation_world_transition_receipt_mutation();

create or replace function public.transition_foundation_world_atomic(
  p_operation_id uuid,
  p_action text,
  p_workspace_key text,
  p_collection_id text,
  p_target_manifest_digest text,
  p_candidate_object_key text,
  p_world_state_id text,
  p_core_output_sha256 text,
  p_expected_current_state text,
  p_expected_current_revision bigint,
  p_expected_current_manifest_digest text,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.foundation_workspace_members%rowtype;
  v_authorization_recheck public.foundation_workspace_members%rowtype;
  v_current public.foundation_active_worlds%rowtype;
  v_current_exists boolean;
  v_target public.foundation_world_versions%rowtype;
  v_existing_receipt public.foundation_world_transition_receipts%rowtype;
  v_request_sha256 text;
  v_event_id uuid;
  v_receipt_sha256 text;
  v_before_revision bigint;
  v_after_revision bigint;
  v_inserted integer := 0;
  v_changed integer;
  v_outcome text;
begin
  if p_operation_id is null
    or p_action not in ('activate', 'rollback')
    or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_collection_id !~ '^collection-[a-f0-9]{32}$'
    or p_target_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_expected_current_state not in ('empty', 'active')
    or p_expected_current_revision < 0
    or (p_expected_current_manifest_digest is not null
      and p_expected_current_manifest_digest !~ '^sha256:[a-f0-9]{64}$')
    or p_actor_user_id is null
    or char_length(p_reason) not between 8 and 500 then
    raise exception 'world_transition_contract_invalid';
  end if;
  if (p_expected_current_state = 'empty'
      and (p_expected_current_revision <> 0 or p_expected_current_manifest_digest is not null))
    or (p_expected_current_state = 'active'
      and (p_expected_current_revision <= 0 or p_expected_current_manifest_digest is null)) then
    raise exception 'world_transition_expected_state_invalid';
  end if;
  if p_action = 'activate' and (
      p_candidate_object_key is null
      or p_candidate_object_key is distinct from
        'immutable/' || p_workspace_key || '/' || p_workspace_key || '/collections/' ||
        p_collection_id || '/' || substring(p_target_manifest_digest from 8) ||
        '/candidate-world.json'
      or p_world_state_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
      or p_core_output_sha256 !~ '^sha256:[a-f0-9]{64}$'
    ) then
    raise exception 'world_activation_binding_invalid';
  end if;
  if p_action = 'rollback' and (
      p_candidate_object_key is not null
      or p_world_state_id is not null
      or p_core_output_sha256 is not null
    ) then
    raise exception 'world_rollback_binding_invalid';
  end if;

  v_request_sha256 := public.foundation_world_transition_request_sha256(
    p_operation_id, p_action, p_workspace_key, p_collection_id,
    p_target_manifest_digest, p_candidate_object_key, p_world_state_id,
    p_core_output_sha256, p_expected_current_state, p_expected_current_revision,
    p_expected_current_manifest_digest, p_actor_user_id, p_reason
  );

  -- All writers for one active pointer share a transaction-scoped lock. This serializes an
  -- absent-pointer first activation as well as updates to an existing pointer row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key || pg_catalog.chr(31) || p_collection_id, 0)
  );

  -- FOR SHARE establishes the authorization check's linearization order against role changes and
  -- revocation (which update this same row). The second check below is still mandatory: it proves
  -- the receipt returned to the caller is bound to the authorization held through commit.
  select * into v_authorization
    from public.foundation_workspace_members
   where workspace_key = p_workspace_key and user_id = p_actor_user_id
   for share;
  if not found or v_authorization.state <> 'active'
    or v_authorization.role not in ('owner', 'admin') then
    raise exception 'world_transition_forbidden';
  end if;

  select * into v_existing_receipt
    from public.foundation_world_transition_receipts
   where operation_id = p_operation_id
   for update;
  if found then
    if v_existing_receipt.request_sha256 is distinct from v_request_sha256
      or v_existing_receipt.workspace_key is distinct from p_workspace_key
      or v_existing_receipt.collection_id is distinct from p_collection_id
      or v_existing_receipt.actor_user_id is distinct from p_actor_user_id then
      raise exception 'world_transition_idempotency_conflict';
    end if;
    select * into v_authorization_recheck
      from public.foundation_workspace_members
     where workspace_key = p_workspace_key and user_id = p_actor_user_id
       and state = 'active' and role in ('owner', 'admin')
       and authorization_revision = v_existing_receipt.authorization_revision
     for share;
    if not found then raise exception 'world_transition_authorization_changed'; end if;
    return jsonb_build_object(
      'status', 'replayed',
      'action', v_existing_receipt.action,
      'manifestDigest', v_existing_receipt.to_manifest_digest,
      'revision', v_existing_receipt.after_revision,
      'operationId', v_existing_receipt.operation_id,
      'eventId', v_existing_receipt.event_id,
      'requestSha256', v_existing_receipt.request_sha256,
      'receiptSha256', v_existing_receipt.receipt_sha256
    );
  end if;

  select * into v_current
    from public.foundation_active_worlds
   where workspace_key = p_workspace_key and collection_id = p_collection_id
   for update;
  v_current_exists := found;

  if v_current_exists and not exists (
    select 1 from public.foundation_world_versions
     where workspace_key = p_workspace_key and collection_id = p_collection_id
       and manifest_digest = v_current.manifest_digest and lifecycle_status = 'active'
  ) then
    raise exception 'world_active_pointer_invariant_broken';
  end if;
  if not v_current_exists and exists (
    select 1 from public.foundation_world_versions
     where workspace_key = p_workspace_key and collection_id = p_collection_id
       and lifecycle_status = 'active'
  ) then
    raise exception 'world_active_pointer_invariant_broken';
  end if;

  if (v_current_exists and (
      p_expected_current_state <> 'active'
      or v_current.revision is distinct from p_expected_current_revision
      or v_current.manifest_digest is distinct from p_expected_current_manifest_digest
    )) or (not v_current_exists and p_expected_current_state <> 'empty') then
    raise exception 'world_transition_compare_and_swap_conflict';
  end if;

  v_before_revision := case when v_current_exists then v_current.revision else 0 end;

  if v_current_exists and v_current.manifest_digest = p_target_manifest_digest then
    v_outcome := 'already_active';
    v_after_revision := v_before_revision;
  else
    if p_action = 'activate' then
      insert into public.foundation_world_versions (
        workspace_key, collection_id, manifest_digest, candidate_object_key,
        world_state_id, core_output_sha256, lifecycle_status, created_by
      ) values (
        p_workspace_key, p_collection_id, p_target_manifest_digest,
        p_candidate_object_key, p_world_state_id, p_core_output_sha256,
        'superseded', p_actor_user_id
      ) on conflict (workspace_key, collection_id, manifest_digest) do nothing;
      get diagnostics v_inserted = row_count;

      select * into v_target from public.foundation_world_versions
       where workspace_key = p_workspace_key and collection_id = p_collection_id
         and manifest_digest = p_target_manifest_digest
       for update;
      if v_target.candidate_object_key is distinct from p_candidate_object_key
        or v_target.world_state_id is distinct from p_world_state_id
        or v_target.core_output_sha256 is distinct from p_core_output_sha256 then
        raise exception 'world_version_immutable_binding_conflict';
      end if;
    else
      if not v_current_exists then raise exception 'world_active_pointer_missing'; end if;
      select * into v_target from public.foundation_world_versions
       where workspace_key = p_workspace_key and collection_id = p_collection_id
         and manifest_digest = p_target_manifest_digest
       for update;
      if not found then raise exception 'world_rollback_target_missing'; end if;
      if v_target.lifecycle_status <> 'superseded' then
        raise exception 'world_rollback_target_state_conflict';
      end if;
    end if;

    update public.foundation_world_versions
       set lifecycle_status = 'superseded'
     where workspace_key = p_workspace_key and collection_id = p_collection_id
       and lifecycle_status = 'active' and manifest_digest <> p_target_manifest_digest;
    update public.foundation_world_versions
       set lifecycle_status = 'active',
           last_activated_at = clock_timestamp(),
           activation_count = activation_count + case when v_inserted = 1 then 0 else 1 end
     where workspace_key = p_workspace_key and collection_id = p_collection_id
       and manifest_digest = p_target_manifest_digest;
    get diagnostics v_changed = row_count;
    if v_changed <> 1 then raise exception 'world_transition_target_state_conflict'; end if;

    if v_current_exists then
      update public.foundation_active_worlds
         set manifest_digest = p_target_manifest_digest,
             revision = revision + 1,
             updated_by = p_actor_user_id,
             updated_at = clock_timestamp()
       where workspace_key = p_workspace_key and collection_id = p_collection_id
         and revision = p_expected_current_revision
         and manifest_digest = p_expected_current_manifest_digest;
      get diagnostics v_changed = row_count;
      if v_changed <> 1 then raise exception 'world_transition_compare_and_swap_conflict'; end if;
      v_after_revision := p_expected_current_revision + 1;
    else
      insert into public.foundation_active_worlds (
        workspace_key, collection_id, manifest_digest, revision, updated_by
      ) values (
        p_workspace_key, p_collection_id, p_target_manifest_digest, 1, p_actor_user_id
      ) on conflict (workspace_key, collection_id) do nothing;
      get diagnostics v_changed = row_count;
      if v_changed <> 1 then raise exception 'world_transition_compare_and_swap_conflict'; end if;
      v_after_revision := 1;
    end if;
    v_outcome := 'applied';
  end if;

  insert into public.foundation_world_events (
    workspace_key, collection_id, action, from_manifest_digest, to_manifest_digest,
    actor_user_id, reason
  ) values (
    p_workspace_key, p_collection_id,
    case when p_action = 'activate' then 'promote' else 'rollback' end,
    case when v_current_exists then v_current.manifest_digest else null end,
    p_target_manifest_digest, p_actor_user_id, p_reason
  ) returning event_id into v_event_id;

  v_receipt_sha256 := 'sha256:' || pg_catalog.encode(
    public.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'operationId', p_operation_id,
          'requestSha256', v_request_sha256,
          'eventId', v_event_id,
          'workspaceKey', p_workspace_key,
          'collectionId', p_collection_id,
          'action', p_action,
          'fromManifestDigest', case when v_current_exists then v_current.manifest_digest else null end,
          'toManifestDigest', p_target_manifest_digest,
          'beforeRevision', v_before_revision,
          'afterRevision', v_after_revision,
          'actorUserId', p_actor_user_id,
          'actorRole', v_authorization.role,
          'authorizationRevision', v_authorization.authorization_revision,
          'outcome', v_outcome
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.foundation_world_transition_receipts (
    operation_id, workspace_key, collection_id, action, request_sha256, event_id,
    from_manifest_digest, to_manifest_digest, before_revision, after_revision,
    actor_user_id, actor_role, authorization_revision, outcome, receipt_sha256
  ) values (
    p_operation_id, p_workspace_key, p_collection_id, p_action, v_request_sha256, v_event_id,
    case when v_current_exists then v_current.manifest_digest else null end,
    p_target_manifest_digest, v_before_revision, v_after_revision,
    p_actor_user_id, v_authorization.role, v_authorization.authorization_revision,
    v_outcome, v_receipt_sha256
  );

  -- Recheck immediately before returning. The FOR SHARE lock held since the first check makes
  -- a concurrent revoke serialize either before this transition (and deny it) or after commit.
  select * into v_authorization_recheck
    from public.foundation_workspace_members
   where workspace_key = p_workspace_key and user_id = p_actor_user_id
     and state = 'active' and role in ('owner', 'admin')
     and authorization_revision = v_authorization.authorization_revision
   for share;
  if not found then raise exception 'world_transition_authorization_changed'; end if;

  return jsonb_build_object(
    'status', v_outcome,
    'action', p_action,
    'manifestDigest', p_target_manifest_digest,
    'revision', v_after_revision,
    'operationId', p_operation_id,
    'eventId', v_event_id,
    'requestSha256', v_request_sha256,
    'receiptSha256', v_receipt_sha256
  );
end;
$$;

-- Close the digest-only, caller-asserted actor paths. The functions remain for schema/history
-- compatibility and for the original owner-run pgTAP fixture, but the runtime role cannot call them.
revoke execute on function public.promote_foundation_candidate(
  text, text, text, text, text, text, uuid, text, text
) from service_role;
revoke execute on function public.rollback_foundation_world(
  text, text, text, text, uuid, text
) from service_role;

revoke all on function public.transition_foundation_world_atomic(
  uuid, text, text, text, text, text, text, text, text, bigint, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.transition_foundation_world_atomic(
  uuid, text, text, text, text, text, text, text, text, bigint, text, uuid, text
) to service_role;

revoke execute on function public.foundation_world_transition_request_sha256(
  uuid, text, text, text, text, text, text, text, text, bigint, text, uuid, text
), public.assert_foundation_world_pointer_invariant(),
  public.prevent_foundation_world_transition_receipt_mutation(),
  public.bump_foundation_workspace_authorization_revision()
  from public, anon, authenticated;

commit;
