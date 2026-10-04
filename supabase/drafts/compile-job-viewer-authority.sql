-- DRAFT ONLY. Depends on the still-unregistered google-viewer-principal-boundary.sql.
-- Keep this file outside migrations until the focused disposable pgTAP suite passes.
begin;

alter table public.foundation_compile_jobs
  add column authorization_revision bigint check (authorization_revision > 0);

create table public.foundation_compile_job_source_authority (
  job_id text not null references public.foundation_compile_jobs(job_id) on delete restrict,
  workspace_key text not null,
  actor_user_id uuid not null,
  authorization_revision bigint not null check (authorization_revision > 0),
  document_id uuid not null,
  oauth_connection_id uuid not null,
  source_version_id text not null,
  provider text not null check (provider = 'google_drive'),
  verified_issuer text not null check (verified_issuer = 'google_drive_permission_id'),
  verified_principal_id text not null check (char_length(verified_principal_id) between 1 and 512),
  principal_link_id uuid not null references public.foundation_provider_principal_links(link_id) on delete restrict,
  consent_authorization_id uuid not null references public.foundation_oauth_authorizations(authorization_id) on delete restrict,
  acl_snapshot_id uuid not null references public.source_acl_snapshots(acl_snapshot_id) on delete restrict,
  acl_snapshot_sha256 text not null check (acl_snapshot_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  acl_captured_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (job_id, document_id),
  foreign key (source_version_id) references public.connector_document_bindings(source_version_id) on delete restrict
);
alter table public.foundation_compile_job_source_authority enable row level security;
revoke all on public.foundation_compile_job_source_authority from public, anon, authenticated, service_role;
grant select, insert on public.foundation_compile_job_source_authority to service_role;

create function public.guard_foundation_compile_job_source_authority()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'COMPILE_JOB_AUTHORITY_IMMUTABLE'; end if;
  return new;
end;
$$;
create trigger foundation_compile_job_source_authority_immutable
  before update or delete on public.foundation_compile_job_source_authority
  for each row execute function public.guard_foundation_compile_job_source_authority();
revoke all on function public.guard_foundation_compile_job_source_authority() from public, anon, authenticated, service_role;

-- This is the only enqueue entry point used by the patched application. The existing enqueue
-- functions still own queue semantics; this wrapper makes actor epoch and source authority part
-- of the same transaction. Old idempotency rows are never backfilled or transferred.
create function public.enqueue_foundation_compile_job_with_authority(
  p_job_id text, p_workspace_key text, p_created_by_user_id uuid, p_authorization_revision bigint,
  p_connector_viewer_enabled boolean,
  p_document_ids text[], p_idempotency_key text, p_corpus_id text default null,
  p_batch_index integer default null, p_batch_count integer default null,
  p_global_collection boolean default false, p_max_age_seconds integer default 300
) returns table (
  job_id text, state public.foundation_compile_state, created boolean,
  corpus_id text, batch_index integer, idempotency_key text,
  created_by_user_id uuid, authorization_revision bigint
)
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.foundation_workspace_members%rowtype;
  v_result record;
  v_job public.foundation_compile_jobs%rowtype;
  v_connector_count integer;
begin
  if p_job_id is null or p_job_id !~ '^cjob-[a-f0-9]{32}$'
     or p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_created_by_user_id is null
     or p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$'
     or p_document_ids is null or pg_catalog.cardinality(p_document_ids) < 1
     or pg_catalog.cardinality(p_document_ids) > 128
     or pg_catalog.array_position(p_document_ids, null) is not null
     or pg_catalog.cardinality(p_document_ids) <> pg_catalog.cardinality(public.foundation_canonical_document_ids(p_document_ids))
     or p_authorization_revision is null or p_authorization_revision <= 0 then
    raise exception 'COMPILE_JOB_AUTHORITY_SCOPE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_key, 0));
  select * into v_member from public.foundation_workspace_members
    where workspace_key = p_workspace_key and user_id = p_created_by_user_id for update;
  if not found or v_member.state <> 'active'
     or v_member.authorization_revision is distinct from p_authorization_revision then
    raise exception 'COMPILE_JOB_AUTHORITY_CHANGED';
  end if;

  if p_global_collection then
    select * into v_result from public.enqueue_foundation_global_collection_job(
      p_job_id, p_workspace_key, p_created_by_user_id, p_document_ids, p_idempotency_key,
      p_corpus_id, p_batch_index, p_batch_count);
  else
    select * into v_result from public.enqueue_foundation_compile_job(
      p_job_id, p_workspace_key, p_created_by_user_id, p_document_ids, p_idempotency_key,
      p_corpus_id, p_batch_index, p_batch_count);
  end if;
  select compile_job.* into v_job
    from public.foundation_compile_jobs as compile_job
   where compile_job.job_id = v_result.job_id for update;
  if not found or v_job.workspace_key is distinct from p_workspace_key
     or v_job.created_by_user_id is distinct from p_created_by_user_id
     or public.foundation_canonical_document_ids(v_job.document_ids)
        is distinct from public.foundation_canonical_document_ids(p_document_ids)
     or (not v_result.created and v_job.authorization_revision is distinct from p_authorization_revision) then
    raise exception 'COMPILE_JOB_AUTHORITY_REPLAY_CONFLICT';
  end if;
  if v_result.created then
    update public.foundation_compile_jobs as compile_job
       set authorization_revision = p_authorization_revision
     where compile_job.job_id = v_job.job_id;
    v_job.authorization_revision := p_authorization_revision;
  end if;

  select pg_catalog.count(*)::integer into v_connector_count
    from public.connector_document_bindings b
    where b.workspace_key = p_workspace_key and b.document_id::text = any(p_document_ids);
  if v_connector_count > 0 then
    if p_connector_viewer_enabled is distinct from true then
      raise exception 'COMPILE_JOB_CONNECTOR_AUTHORITY_DISABLED';
    end if;
    if p_max_age_seconds is null or p_max_age_seconds < 60 or p_max_age_seconds > 900 then
      raise exception 'COMPILE_JOB_ACL_FRESHNESS_INVALID';
    end if;
    if v_connector_count <> (select pg_catalog.count(distinct b.document_id)::integer
      from public.connector_document_bindings b where b.workspace_key = p_workspace_key
        and b.document_id::text = any(p_document_ids))
       or public.connector_documents_blocked_for_viewer(p_workspace_key, p_document_ids, p_created_by_user_id, p_max_age_seconds) then
      raise exception 'COMPILE_JOB_CONNECTOR_AUTHORITY_DENIED';
    end if;

    insert into public.foundation_compile_job_source_authority(
      job_id, workspace_key, actor_user_id, authorization_revision, document_id,
      oauth_connection_id, source_version_id, provider, verified_issuer, verified_principal_id, principal_link_id,
      consent_authorization_id, acl_snapshot_id, acl_snapshot_sha256, acl_captured_at
    )
    select v_job.job_id, p_workspace_key, p_created_by_user_id, p_authorization_revision,
      b.document_id, b.oauth_connection_id, b.source_version_id, b.provider,
      'google_drive_permission_id', l.principal_id, l.link_id,
      l.authorization_id, a.acl_snapshot_id, a.snapshot_sha256, a.captured_at
    from public.connector_document_bindings b
    join public.foundation_oauth_connections c on c.oauth_connection_id = b.oauth_connection_id
      and c.workspace_key = b.workspace_key and c.provider = b.provider and c.status = 'active'
    join public.foundation_provider_principal_links l on l.workspace_key = b.workspace_key
      and l.foundation_user_id = p_created_by_user_id and l.provider = 'google_drive'
      and l.principal_kind = 'user' and l.revoked_at is null
      and l.authorization_revision = p_authorization_revision
      and l.verified_at <= pg_catalog.clock_timestamp()
      and l.verified_at > pg_catalog.clock_timestamp() - interval '24 hours'
    join public.foundation_oauth_authorizations oa on oa.authorization_id = l.authorization_id
      and oa.workspace_key = p_workspace_key and oa.created_by = p_created_by_user_id
      and oa.authorization_revision = p_authorization_revision
      and oa.authorization_purpose = 'viewer_acl_link' and oa.consumed_at is not null
      and oa.requested_scopes @> array['https://www.googleapis.com/auth/drive.metadata.readonly']::text[]
    join lateral (
      select s.acl_snapshot_id, s.snapshot_sha256, s.captured_at, s.principals, s.capture_complete
      from public.source_acl_snapshots s where s.workspace_key = b.workspace_key
        and s.source_version_id = b.source_version_id and s.provider_id = b.provider
      order by s.captured_at desc, s.recorded_at desc, s.acl_snapshot_id desc limit 1
    ) a on a.capture_complete and a.captured_at <= pg_catalog.clock_timestamp()
      and a.captured_at > pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_max_age_seconds::double precision)
      and exists (select 1 from pg_catalog.jsonb_array_elements(a.principals) p
        where p->>'kind' = 'user' and p->>'principalId' = l.principal_id
          and p->>'permission' in ('read', 'write', 'owner'))
    where b.workspace_key = p_workspace_key and b.document_id::text = any(p_document_ids)
      and b.provider = 'google_drive'
    on conflict (job_id, document_id) do nothing;

    if (select pg_catalog.count(*) from public.foundation_compile_job_source_authority a
          where a.job_id = v_job.job_id) <> v_connector_count then
      raise exception 'COMPILE_JOB_AUTHORITY_CAPTURE_INCOMPLETE';
    end if;
  end if;
  return query select v_job.job_id, v_job.state, v_result.created, v_job.corpus_id,
    v_job.batch_index, v_job.idempotency_key, v_job.created_by_user_id, v_job.authorization_revision;
end;
$$;
revoke all on function public.enqueue_foundation_compile_job_with_authority(
  text, text, uuid, bigint, boolean, text[], text, text, integer, integer, boolean, integer
) from public, anon, authenticated;
grant execute on function public.enqueue_foundation_compile_job_with_authority(
  text, text, uuid, bigint, boolean, text[], text, text, integer, integer, boolean, integer
) to service_role;

-- Service workers provide no identity. They provide only a job key, the expected immutable scope,
-- and a checkpoint label; SQL derives actor/revision and checks current membership, consent, link,
-- connection, binding, complete ACL capture, freshness, and exact source-version snapshot identity.
create function public.authorize_foundation_compile_job(
  p_job_id text, p_expected_workspace_key text, p_expected_document_ids text[], p_phase text,
  p_connector_viewer_enabled boolean, p_max_age_seconds integer default 300
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_job public.foundation_compile_jobs%rowtype;
  v_expected text[];
  v_bindings integer;
  v_authority integer;
begin
  if p_phase not in ('before_source_read', 'before_core', 'after_core', 'before_persist')
     or p_expected_document_ids is null then return false; end if;
  select * into v_job from public.foundation_compile_jobs where job_id = p_job_id;
  if not found or v_job.workspace_key is distinct from p_expected_workspace_key
     or v_job.authorization_revision is null then return false; end if;
  v_expected := public.foundation_canonical_document_ids(p_expected_document_ids);
  if pg_catalog.cardinality(v_expected) < 1
     or not (v_expected <@ public.foundation_canonical_document_ids(v_job.document_ids)) then return false; end if;
  if not exists (select 1 from public.foundation_workspace_members m where m.workspace_key = v_job.workspace_key
       and m.user_id = v_job.created_by_user_id and m.state = 'active'
       and m.authorization_revision = v_job.authorization_revision) then return false; end if;

  select pg_catalog.count(*)::integer into v_bindings from public.connector_document_bindings b
    where b.workspace_key = v_job.workspace_key and b.document_id::text = any(v_job.document_ids);
  select pg_catalog.count(*)::integer into v_authority from public.foundation_compile_job_source_authority a
    where a.job_id = v_job.job_id;
  if v_bindings <> v_authority then return false; end if;
  if v_bindings = 0 then return true; end if;
  if p_connector_viewer_enabled is distinct from true then return false; end if;
  if p_max_age_seconds is null or p_max_age_seconds < 60 or p_max_age_seconds > 900 then return false; end if;

  -- This is a point-in-time database authorization check at each checkpoint. It cannot cancel
  -- protected reads or external Core I/O that already began between checkpoints.
  if public.connector_documents_blocked_for_viewer(v_job.workspace_key, v_job.document_ids,
      v_job.created_by_user_id, p_max_age_seconds) then return false; end if;
  if exists (
    select 1 from public.foundation_compile_job_source_authority ja
    where ja.job_id = v_job.job_id and (
      ja.workspace_key is distinct from v_job.workspace_key
      or ja.actor_user_id is distinct from v_job.created_by_user_id
      or ja.authorization_revision is distinct from v_job.authorization_revision
      or not exists (select 1 from public.connector_document_bindings b
        join public.foundation_oauth_connections c on c.oauth_connection_id = b.oauth_connection_id
          and c.workspace_key = b.workspace_key and c.provider = b.provider and c.status = 'active'
        where b.workspace_key = ja.workspace_key and b.document_id = ja.document_id
          and b.oauth_connection_id = ja.oauth_connection_id and b.source_version_id = ja.source_version_id
          and b.provider = ja.provider)
      or not exists (select 1 from public.foundation_provider_principal_links l
        join public.foundation_oauth_authorizations oa on oa.authorization_id = l.authorization_id
          and oa.authorization_purpose = 'viewer_acl_link' and oa.consumed_at is not null
          and oa.authorization_revision = ja.authorization_revision
          and oa.requested_scopes @> array['https://www.googleapis.com/auth/drive.metadata.readonly']::text[]
        where l.link_id = ja.principal_link_id and l.workspace_key = ja.workspace_key
          and l.foundation_user_id = ja.actor_user_id and l.authorization_id = ja.consent_authorization_id
          and l.authorization_revision = ja.authorization_revision and l.revoked_at is null
          and l.provider = ja.provider and l.principal_kind = 'user'
          and l.principal_id = ja.verified_principal_id
          and l.verified_at <= pg_catalog.clock_timestamp()
          and l.verified_at > pg_catalog.clock_timestamp() - interval '24 hours')
      or not exists (select 1 from public.source_acl_snapshots a
        where a.acl_snapshot_id = ja.acl_snapshot_id and a.workspace_key = ja.workspace_key
          and a.source_version_id = ja.source_version_id and a.provider_id = ja.provider
          and a.snapshot_sha256 = ja.acl_snapshot_sha256 and a.captured_at = ja.acl_captured_at
          and a.capture_complete and a.captured_at <= pg_catalog.clock_timestamp()
          and exists (select 1 from pg_catalog.jsonb_array_elements(a.principals) p
            join public.foundation_provider_principal_links l on l.link_id = ja.principal_link_id
              and l.principal_kind = 'user'
            where p->>'kind' = 'user' and p->>'principalId' = l.principal_id
              and p->>'permission' in ('read', 'write', 'owner')))
      -- Preserve the pinned snapshot as historical enqueue evidence, but authorize continued
      -- work against the absolute latest capture. Select latest before testing time/completeness
      -- so a future, stale, incomplete, or non-admitting capture cannot fall back to an older one.
      or not exists (
        select 1 from public.source_acl_snapshots current_acl
        where current_acl.acl_snapshot_id = (
          select latest.acl_snapshot_id from public.source_acl_snapshots latest
          where latest.workspace_key = ja.workspace_key
            and latest.source_version_id = ja.source_version_id
            and latest.provider_id = ja.provider
          order by latest.captured_at desc, latest.recorded_at desc, latest.acl_snapshot_id desc
          limit 1
        )
          and current_acl.workspace_key = ja.workspace_key
          and current_acl.source_version_id = ja.source_version_id
          and current_acl.provider_id = ja.provider
          and current_acl.capture_complete
          and current_acl.captured_at <= pg_catalog.clock_timestamp()
          and current_acl.captured_at > pg_catalog.clock_timestamp()
            - pg_catalog.make_interval(secs => p_max_age_seconds::double precision)
          and exists (select 1 from pg_catalog.jsonb_array_elements(current_acl.principals) p
            where p->>'kind' = 'user' and p->>'principalId' = ja.verified_principal_id
              and p->>'permission' in ('read', 'write', 'owner'))
      )
    )
  ) then return false; end if;
  return true;
end;
$$;
revoke all on function public.authorize_foundation_compile_job(text, text, text[], text, boolean, integer) from public, anon, authenticated;
grant execute on function public.authorize_foundation_compile_job(text, text, text[], text, boolean, integer) to service_role;

commit;
