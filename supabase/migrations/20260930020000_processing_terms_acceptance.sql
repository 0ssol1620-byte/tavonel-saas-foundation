-- Durable receipt of a workspace owner's explicit agreement to the published self-service terms
-- and processing addendum.
--
-- A receipt is evidence, not permission: nothing here opens customer-data processing, starts a
-- trial or charges. Release qualification and grants stay separate and must read an acceptance
-- through current_foundation_processing_terms_acceptance(), which only answers while the acceptor
-- is still the active owner at the exact membership authorization revision they accepted under.
-- A revoked, demoted or re-invited owner therefore has no current acceptance and must agree again.
--
-- No browser role can read or write the table. The service role cannot write it directly either:
-- the only writer is record_foundation_processing_terms_acceptance(), which re-authorizes the actor
-- under a share lock on their membership row (blocking concurrent revoke/role change, which take
-- FOR UPDATE) and stamps the database clock. Rows are append-only for every role.
begin;

create table public.foundation_processing_terms_acceptances (
  acceptance_id uuid primary key default gen_random_uuid(),
  workspace_key text not null references public.foundation_workspaces(workspace_key) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  actor_role text not null check (actor_role = 'owner'),
  authorization_revision bigint not null check (authorization_revision > 0),
  terms_version text not null check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  terms_path text not null check (terms_path ~ '^/policy/[A-Za-z0-9_.-]{1,120}\.md$'),
  terms_sha256 text not null check (terms_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  processing_path text not null check (processing_path ~ '^/policy/[A-Za-z0-9_.-]{1,120}\.md$'),
  processing_sha256 text not null check (processing_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  scope text not null check (scope in ('direct_upload', 'connector')),
  request_id text not null check (char_length(request_id) between 8 and 160),
  accepted_at timestamptz not null default clock_timestamp(),
  unique (workspace_key, user_id, authorization_revision, scope,
    terms_version, terms_path, terms_sha256, processing_path, processing_sha256)
);
create index foundation_processing_terms_acceptances_scope_idx
  on public.foundation_processing_terms_acceptances (workspace_key, scope, accepted_at desc);

create or replace function public.prevent_foundation_processing_terms_acceptance_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'processing_terms_acceptance_append_only';
end;
$$;
create trigger foundation_processing_terms_acceptances_append_only
  before update or delete on public.foundation_processing_terms_acceptances
  for each row execute function public.prevent_foundation_processing_terms_acceptance_mutation();
create trigger foundation_processing_terms_acceptances_no_truncate
  before truncate on public.foundation_processing_terms_acceptances
  for each statement execute function public.prevent_foundation_processing_terms_acceptance_mutation();

create or replace function public.foundation_processing_terms_acceptance_receipt(
  p_row public.foundation_processing_terms_acceptances,
  p_replay boolean
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'acceptanceId', p_row.acceptance_id,
    'workspaceKey', p_row.workspace_key,
    'userId', p_row.user_id,
    'actorRole', p_row.actor_role,
    'authorizationRevision', p_row.authorization_revision,
    'scope', p_row.scope,
    'termsVersion', p_row.terms_version,
    'terms', jsonb_build_object('path', p_row.terms_path, 'sha256', p_row.terms_sha256),
    'processing', jsonb_build_object('path', p_row.processing_path, 'sha256', p_row.processing_sha256),
    'acceptedAt', p_row.accepted_at,
    'idempotentReplay', p_replay
  );
$$;

create or replace function public.record_foundation_processing_terms_acceptance(
  p_workspace_key text,
  p_actor_user_id uuid,
  p_scope text,
  p_terms_version text,
  p_terms_path text,
  p_terms_sha256 text,
  p_processing_path text,
  p_processing_sha256 text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.foundation_workspace_members%rowtype;
  v_row public.foundation_processing_terms_acceptances%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_actor_user_id is null
    or p_scope is null or p_scope not in ('direct_upload', 'connector')
    or p_terms_version is null or p_terms_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_terms_path is null or p_terms_path !~ '^/policy/[A-Za-z0-9_.-]{1,120}\.md$'
    or p_processing_path is null or p_processing_path !~ '^/policy/[A-Za-z0-9_.-]{1,120}\.md$'
    or p_terms_path = p_processing_path
    or p_terms_sha256 is null or p_terms_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_processing_sha256 is null or p_processing_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_request_id is null or char_length(p_request_id) not between 8 and 160 then
    raise exception 'processing_terms_acceptance_input_invalid';
  end if;

  -- Share lock: concurrent acceptances by the same owner proceed, but revoke/role change
  -- (FOR UPDATE) wait until this receipt commits, and then bump the revision it is bound to.
  select * into v_actor from public.foundation_workspace_members
   where workspace_key = p_workspace_key and user_id = p_actor_user_id
   for share;
  if not found or v_actor.state <> 'active' or v_actor.role <> 'owner' then
    raise exception 'processing_terms_acceptance_forbidden';
  end if;

  insert into public.foundation_processing_terms_acceptances (
    workspace_key, user_id, actor_role, authorization_revision, scope,
    terms_version, terms_path, terms_sha256, processing_path, processing_sha256, request_id
  ) values (
    p_workspace_key, p_actor_user_id, v_actor.role, v_actor.authorization_revision, p_scope,
    p_terms_version, p_terms_path, p_terms_sha256, p_processing_path, p_processing_sha256, p_request_id
  )
  on conflict do nothing
  returning * into v_row;
  if found then
    return public.foundation_processing_terms_acceptance_receipt(v_row, false);
  end if;

  select * into v_row from public.foundation_processing_terms_acceptances
   where workspace_key = p_workspace_key and user_id = p_actor_user_id
     and authorization_revision = v_actor.authorization_revision and scope = p_scope
     and terms_version = p_terms_version and terms_path = p_terms_path
     and terms_sha256 = p_terms_sha256 and processing_path = p_processing_path
     and processing_sha256 = p_processing_sha256;
  if not found then raise exception 'processing_terms_acceptance_conflict'; end if;
  return public.foundation_processing_terms_acceptance_receipt(v_row, true);
end;
$$;

-- The only read a grant issuer should trust. Returns null unless the exact offered documents were
-- accepted for this scope by the workspace's current active owner at their current revision.
create or replace function public.current_foundation_processing_terms_acceptance(
  p_workspace_key text,
  p_scope text,
  p_terms_version text,
  p_terms_sha256 text,
  p_processing_sha256 text
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.foundation_processing_terms_acceptance_receipt(a, false)
    from public.foundation_processing_terms_acceptances a
    join public.foundation_workspace_members m
      on m.workspace_key = a.workspace_key and m.user_id = a.user_id
   where a.workspace_key = p_workspace_key and a.scope = p_scope
     and a.terms_version = p_terms_version and a.terms_sha256 = p_terms_sha256
     and a.processing_sha256 = p_processing_sha256
     and m.state = 'active' and m.role = 'owner'
     and m.authorization_revision = a.authorization_revision
   order by a.accepted_at desc, a.acceptance_id
   limit 1;
$$;

alter table public.foundation_processing_terms_acceptances enable row level security;
revoke all on public.foundation_processing_terms_acceptances from public, anon, authenticated, service_role;

revoke all on function public.prevent_foundation_processing_terms_acceptance_mutation(),
  public.foundation_processing_terms_acceptance_receipt(public.foundation_processing_terms_acceptances, boolean),
  public.record_foundation_processing_terms_acceptance(text, uuid, text, text, text, text, text, text, text),
  public.current_foundation_processing_terms_acceptance(text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.record_foundation_processing_terms_acceptance(text, uuid, text, text, text, text, text, text, text),
  public.current_foundation_processing_terms_acceptance(text, text, text, text, text)
  to service_role;

commit;
