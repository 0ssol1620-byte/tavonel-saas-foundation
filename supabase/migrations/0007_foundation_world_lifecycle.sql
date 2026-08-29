-- Candidate-to-active lifecycle for the Foundation product surface. Candidate bytes stay
-- immutable in R2; this database stores only verified bindings, the active pointer and events.
begin;

create table public.foundation_world_versions (
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  collection_id text not null check (collection_id ~ '^collection-[a-f0-9]{32}$'),
  manifest_digest text not null check (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  candidate_object_key text not null,
  world_state_id text not null check (world_state_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  core_output_sha256 text not null check (core_output_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  lifecycle_status text not null check (lifecycle_status in ('active', 'superseded')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  first_promoted_at timestamptz not null default now(),
  last_activated_at timestamptz not null default now(),
  activation_count integer not null default 1 check (activation_count > 0),
  primary key (workspace_key, collection_id, manifest_digest),
  unique (workspace_key, candidate_object_key),
  check (
    candidate_object_key = 'immutable/' || workspace_key || '/' || workspace_key ||
      '/collections/' || collection_id || '/' || substring(manifest_digest from 8) ||
      '/candidate-world.json'
  )
);

create table public.foundation_active_worlds (
  workspace_key text not null,
  collection_id text not null,
  manifest_digest text not null,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (workspace_key, collection_id),
  foreign key (workspace_key, collection_id, manifest_digest)
    references public.foundation_world_versions(workspace_key, collection_id, manifest_digest)
    on delete restrict
);

create table public.foundation_world_events (
  event_id uuid primary key default gen_random_uuid(),
  workspace_key text not null,
  collection_id text not null,
  action text not null check (action in ('promote', 'rollback')),
  from_manifest_digest text check (
    from_manifest_digest is null or from_manifest_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  to_manifest_digest text not null check (to_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(reason) between 8 and 500),
  created_at timestamptz not null default now(),
  foreign key (workspace_key, collection_id, to_manifest_digest)
    references public.foundation_world_versions(workspace_key, collection_id, manifest_digest)
    on delete restrict
);
create index foundation_world_events_collection_idx
  on public.foundation_world_events (workspace_key, collection_id, created_at desc);
create index foundation_world_versions_collection_idx
  on public.foundation_world_versions (workspace_key, collection_id, last_activated_at desc);
create unique index foundation_world_versions_one_active_idx
  on public.foundation_world_versions (workspace_key, collection_id)
  where lifecycle_status = 'active';

alter table public.foundation_world_versions enable row level security;
alter table public.foundation_active_worlds enable row level security;
alter table public.foundation_world_events enable row level security;

revoke all on public.foundation_world_versions, public.foundation_active_worlds,
  public.foundation_world_events from public, anon, authenticated;
grant select on public.foundation_world_versions, public.foundation_active_worlds,
  public.foundation_world_events to service_role;

create or replace function public.promote_foundation_candidate(
  p_workspace_key text,
  p_collection_id text,
  p_manifest_digest text,
  p_candidate_object_key text,
  p_world_state_id text,
  p_core_output_sha256 text,
  p_actor_user_id uuid,
  p_expected_current_manifest text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.foundation_active_worlds%rowtype;
  v_version public.foundation_world_versions%rowtype;
  v_inserted integer;
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_collection_id !~ '^collection-[a-f0-9]{32}$'
    or p_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_core_output_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_world_state_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
    or char_length(p_reason) not between 8 and 500 then
    raise exception 'world_promotion_contract_invalid';
  end if;
  if p_candidate_object_key is distinct from
    'immutable/' || p_workspace_key || '/' || p_workspace_key || '/collections/' ||
    p_collection_id || '/' || substring(p_manifest_digest from 8) || '/candidate-world.json' then
    raise exception 'world_candidate_binding_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key || pg_catalog.chr(31) || p_collection_id, 0)
  );
  select * into v_current from public.foundation_active_worlds
    where workspace_key = p_workspace_key and collection_id = p_collection_id for update;
  if found and v_current.manifest_digest = p_manifest_digest then
    select * into v_version from public.foundation_world_versions
      where workspace_key = p_workspace_key and collection_id = p_collection_id
        and manifest_digest = p_manifest_digest;
    if v_version.candidate_object_key is distinct from p_candidate_object_key
      or v_version.world_state_id is distinct from p_world_state_id
      or v_version.core_output_sha256 is distinct from p_core_output_sha256 then
      raise exception 'world_version_immutable_binding_conflict';
    end if;
    return jsonb_build_object(
      'status', 'already_active', 'manifestDigest', p_manifest_digest,
      'revision', v_current.revision
    );
  end if;
  if (found and v_current.manifest_digest is distinct from p_expected_current_manifest)
    or (not found and p_expected_current_manifest is not null) then
    raise exception 'world_active_pointer_conflict';
  end if;

  insert into public.foundation_world_versions (
    workspace_key, collection_id, manifest_digest, candidate_object_key, world_state_id,
    core_output_sha256, lifecycle_status, created_by
  ) values (
    p_workspace_key, p_collection_id, p_manifest_digest, p_candidate_object_key,
    p_world_state_id, p_core_output_sha256, 'superseded', p_actor_user_id
  ) on conflict (workspace_key, collection_id, manifest_digest) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_version from public.foundation_world_versions
    where workspace_key = p_workspace_key and collection_id = p_collection_id
      and manifest_digest = p_manifest_digest for update;
  if v_version.candidate_object_key is distinct from p_candidate_object_key
    or v_version.world_state_id is distinct from p_world_state_id
    or v_version.core_output_sha256 is distinct from p_core_output_sha256 then
    raise exception 'world_version_immutable_binding_conflict';
  end if;

  update public.foundation_world_versions set lifecycle_status = 'superseded'
    where workspace_key = p_workspace_key and collection_id = p_collection_id
      and lifecycle_status = 'active' and manifest_digest <> p_manifest_digest;
  update public.foundation_world_versions set
    lifecycle_status = 'active',
    last_activated_at = now(),
    activation_count = activation_count + case when v_inserted = 1 then 0 else 1 end
    where workspace_key = p_workspace_key and collection_id = p_collection_id
      and manifest_digest = p_manifest_digest;

  insert into public.foundation_active_worlds (
    workspace_key, collection_id, manifest_digest, revision, updated_by
  ) values (p_workspace_key, p_collection_id, p_manifest_digest, 1, p_actor_user_id)
  on conflict (workspace_key, collection_id) do update set
    manifest_digest = excluded.manifest_digest,
    revision = public.foundation_active_worlds.revision + 1,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into public.foundation_world_events (
    workspace_key, collection_id, action, from_manifest_digest, to_manifest_digest,
    actor_user_id, reason
  ) values (
    p_workspace_key, p_collection_id, 'promote', v_current.manifest_digest,
    p_manifest_digest, p_actor_user_id, p_reason
  );
  select * into v_current from public.foundation_active_worlds
    where workspace_key = p_workspace_key and collection_id = p_collection_id;
  return jsonb_build_object(
    'status', 'active', 'manifestDigest', p_manifest_digest, 'revision', v_current.revision
  );
end;
$$;

create or replace function public.rollback_foundation_world(
  p_workspace_key text,
  p_collection_id text,
  p_target_manifest_digest text,
  p_expected_current_manifest text,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.foundation_active_worlds%rowtype;
  v_target public.foundation_world_versions%rowtype;
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_collection_id !~ '^collection-[a-f0-9]{32}$'
    or p_target_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_expected_current_manifest !~ '^sha256:[a-f0-9]{64}$'
    or char_length(p_reason) not between 8 and 500 then
    raise exception 'world_rollback_contract_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key || pg_catalog.chr(31) || p_collection_id, 0)
  );
  select * into v_current from public.foundation_active_worlds
    where workspace_key = p_workspace_key and collection_id = p_collection_id for update;
  if not found then raise exception 'world_active_pointer_missing'; end if;
  if v_current.manifest_digest is distinct from p_expected_current_manifest then
    raise exception 'world_active_pointer_conflict';
  end if;
  if v_current.manifest_digest = p_target_manifest_digest then
    return jsonb_build_object(
      'status', 'already_active', 'manifestDigest', p_target_manifest_digest,
      'revision', v_current.revision
    );
  end if;
  select * into v_target from public.foundation_world_versions
    where workspace_key = p_workspace_key and collection_id = p_collection_id
      and manifest_digest = p_target_manifest_digest for update;
  if not found then raise exception 'world_rollback_target_missing'; end if;

  update public.foundation_world_versions set lifecycle_status = 'superseded'
    where workspace_key = p_workspace_key and collection_id = p_collection_id
      and lifecycle_status = 'active';
  update public.foundation_world_versions set
    lifecycle_status = 'active', last_activated_at = now(), activation_count = activation_count + 1
    where workspace_key = p_workspace_key and collection_id = p_collection_id
      and manifest_digest = p_target_manifest_digest;
  update public.foundation_active_worlds set
    manifest_digest = p_target_manifest_digest,
    revision = revision + 1,
    updated_by = p_actor_user_id,
    updated_at = now()
    where workspace_key = p_workspace_key and collection_id = p_collection_id;
  insert into public.foundation_world_events (
    workspace_key, collection_id, action, from_manifest_digest, to_manifest_digest,
    actor_user_id, reason
  ) values (
    p_workspace_key, p_collection_id, 'rollback', v_current.manifest_digest,
    p_target_manifest_digest, p_actor_user_id, p_reason
  );
  select * into v_current from public.foundation_active_worlds
    where workspace_key = p_workspace_key and collection_id = p_collection_id;
  return jsonb_build_object(
    'status', 'active', 'manifestDigest', p_target_manifest_digest,
    'revision', v_current.revision
  );
end;
$$;

revoke all on function public.promote_foundation_candidate(
  text, text, text, text, text, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.promote_foundation_candidate(
  text, text, text, text, text, text, uuid, text, text
) to service_role;
revoke all on function public.rollback_foundation_world(
  text, text, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.rollback_foundation_world(
  text, text, text, text, uuid, text
) to service_role;

commit;
