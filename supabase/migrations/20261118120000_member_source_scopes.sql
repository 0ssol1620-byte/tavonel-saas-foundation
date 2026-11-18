-- WO-C-T3 (workorders/all-features/C-teams-federation-creators.md §1): per-member source scopes.
--
-- Ordering: PROVISIONAL. The cluster file names this file `<ts>_member_source_scopes.sql`; the
-- lead assigns the timestamp at merge (after the latest on the joint head). Windows cannot carry
-- `<` or `>` in a file name, so 20261118120000 stands in and is renamed at merge together with the
-- rollback draft's name. Rollback: supabase/drafts/rollback-20261118120000-member-source-scopes.sql.
--
-- The unit of permission is the source: a document id of the workspace. A member reads a World
-- only when every source behind it is in their scope (TC-D2); record-level filtering inside a
-- compiled World is not built. Owners and admins read every source of their workspace.
--
-- Rows: one `all` row, or any number of `listed` rows (one per document). A member with no row
-- reads nothing (TC-D1). No membership row, a revoked membership, and an unknown role all read
-- nothing. Every read path asks the database on every request (documents_outside_member_scope /
-- member_readable_document_ids); nothing is cached between the write and the check, so a
-- narrowed scope or a revoked member is refused on the next request (constitution: an ACL revoke
-- never waits for a background job).
--
-- Writes go through set_member_source_scope only: owner/admin, never targeting an owner/admin,
-- under the subject's membership row lock, with one membership event carrying the before/after
-- digest in the same transaction. A member's own uploads enter their scope in the transaction
-- that admits them: an AFTER INSERT trigger on foundation_intake_admissions, so no reviewed
-- admission function is redefined.
--
-- The table is RPC-only: service_role holds no table privilege (0053 inventory row added in
-- supabase/tests/service_role_grant_matrix.sql), every function is security definer with an
-- empty search_path, and execute is granted to service_role only.
begin;

create table public.foundation_workspace_member_source_scopes (
  workspace_key text not null,
  user_id uuid not null,
  scope_kind text not null check (scope_kind in ('all', 'listed')),
  document_id uuid,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default clock_timestamp(),
  check ((scope_kind = 'all') = (document_id is null)),
  foreign key (workspace_key, user_id)
    references public.foundation_workspace_members (workspace_key, user_id) on delete restrict
);
create unique index foundation_member_source_scopes_all_idx
  on public.foundation_workspace_member_source_scopes (workspace_key, user_id)
  where scope_kind = 'all';
create unique index foundation_member_source_scopes_listed_idx
  on public.foundation_workspace_member_source_scopes (workspace_key, user_id, document_id)
  where scope_kind = 'listed';

alter table public.foundation_workspace_member_source_scopes enable row level security;
create policy foundation_member_source_scopes_deny_all
  on public.foundation_workspace_member_source_scopes as restrictive for all
  using (false) with check (false);
revoke all on public.foundation_workspace_member_source_scopes
  from public, anon, authenticated, service_role;

-- The membership history gains the scope change. Same constraint, one more action.
alter table public.foundation_workspace_membership_events
  drop constraint foundation_workspace_membership_events_action_check;
alter table public.foundation_workspace_membership_events
  add constraint foundation_workspace_membership_events_action_check check (action in (
    'invite.created', 'invite.accepted', 'invite.revoked',
    'member.role_changed', 'member.revoked', 'member.source_scope_changed'
  ));

-- A scope as one digest over its canonical text: 'all', 'none', or 'listed:' and the sorted ids.
-- p_kind/p_ids describe a scope; the stored scope is read by passing what the rows say.
create function public.foundation_member_source_scope_digest(p_kind text, p_ids uuid[])
returns text
language sql
immutable
set search_path = ''
as $$
  select 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    case
      when p_kind = 'all' then 'all'
      when coalesce(pg_catalog.cardinality(p_ids), 0) = 0 then 'none'
      else 'listed:' || (select pg_catalog.string_agg(distinct d.id::text, ',' order by d.id::text)
                           from pg_catalog.unnest(p_ids) as d(id))
    end, 'UTF8')), 'hex')
$$;

-- The stored scope of one user, in the digest's terms.
create function public.foundation_member_source_scope_stored(p_workspace_key text, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.foundation_member_source_scope_digest(
    case when exists (select 1 from public.foundation_workspace_member_source_scopes s
                       where s.workspace_key = p_workspace_key and s.user_id = p_user_id and s.scope_kind = 'all')
         then 'all' else 'listed' end,
    array(select s.document_id from public.foundation_workspace_member_source_scopes s
           where s.workspace_key = p_workspace_key and s.user_id = p_user_id and s.scope_kind = 'listed'))
$$;

-- The subset of p_document_ids this user may read in this workspace. Order and duplicates of the
-- input are not preserved. An id that is not a canonical lower-case uuid is never readable by a
-- member (it cannot match a listed row); owners and admins get every id back.
create function public.member_readable_document_ids(
  p_workspace_key text,
  p_user_id uuid,
  p_document_ids text[]
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_user_id is null or p_document_ids is null
    or pg_catalog.cardinality(p_document_ids) > 2000
    or pg_catalog.array_position(p_document_ids, null) is not null then
    raise exception 'member_source_scope_input_invalid';
  end if;
  select m.role into v_role from public.foundation_workspace_members m
   where m.workspace_key = p_workspace_key and m.user_id = p_user_id and m.state = 'active';
  if not found then return '{}'::text[]; end if;
  if v_role in ('owner', 'admin') then
    return array(select distinct d.id from pg_catalog.unnest(p_document_ids) as d(id));
  end if;
  if v_role <> 'member' then return '{}'::text[]; end if;
  if exists (select 1 from public.foundation_workspace_member_source_scopes s
              where s.workspace_key = p_workspace_key and s.user_id = p_user_id and s.scope_kind = 'all') then
    return array(select distinct d.id from pg_catalog.unnest(p_document_ids) as d(id));
  end if;
  return array(
    select distinct d.id from pg_catalog.unnest(p_document_ids) as d(id)
     where exists (select 1 from public.foundation_workspace_member_source_scopes s
                    where s.workspace_key = p_workspace_key and s.user_id = p_user_id
                      and s.scope_kind = 'listed' and s.document_id::text = d.id)
  );
end;
$$;

-- true when any id is outside the user's scope, or the user has no active membership here.
create function public.documents_outside_member_scope(
  p_workspace_key text,
  p_user_id uuid,
  p_document_ids text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_readable text[];
begin
  -- Validates the input (raises), then answers. A stable function reads one snapshot throughout.
  v_readable := public.member_readable_document_ids(p_workspace_key, p_user_id, p_document_ids);
  if not exists (
    select 1 from public.foundation_workspace_members m
     where m.workspace_key = p_workspace_key and m.user_id = p_user_id and m.state = 'active'
  ) then
    return true;
  end if;
  return exists (select 1 from pg_catalog.unnest(p_document_ids) as d(id) where d.id <> all (v_readable));
end;
$$;

-- What an owner/admin sees about one member's scope: kind none|all|listed and the listed ids.
create function public.get_member_source_scope(
  p_workspace_key text,
  p_actor_user_id uuid,
  p_member_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.foundation_workspace_members%rowtype;
  v_subject public.foundation_workspace_members%rowtype;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_actor_user_id is null or p_member_user_id is null then
    raise exception 'member_source_scope_input_invalid';
  end if;
  select * into v_actor from public.foundation_workspace_members
   where workspace_key = p_workspace_key and user_id = p_actor_user_id;
  if not found or v_actor.state <> 'active' or v_actor.role not in ('owner', 'admin') then
    raise exception 'member_source_scope_forbidden';
  end if;
  select * into v_subject from public.foundation_workspace_members
   where workspace_key = p_workspace_key and user_id = p_member_user_id;
  if not found or v_subject.state <> 'active' then raise exception 'workspace_member_not_found'; end if;
  if v_subject.role <> 'member' then raise exception 'member_source_scope_target_forbidden'; end if;
  return jsonb_build_object(
    'workspaceKey', p_workspace_key,
    'userId', p_member_user_id,
    'kind', case
      when exists (select 1 from public.foundation_workspace_member_source_scopes s
                    where s.workspace_key = p_workspace_key and s.user_id = p_member_user_id and s.scope_kind = 'all') then 'all'
      when exists (select 1 from public.foundation_workspace_member_source_scopes s
                    where s.workspace_key = p_workspace_key and s.user_id = p_member_user_id) then 'listed'
      else 'none' end,
    'documentIds', coalesce((select jsonb_agg(s.document_id::text order by s.document_id::text)
                               from public.foundation_workspace_member_source_scopes s
                              where s.workspace_key = p_workspace_key and s.user_id = p_member_user_id
                                and s.scope_kind = 'listed'), '[]'::jsonb)
  );
end;
$$;

create function public.set_member_source_scope(
  p_workspace_key text,
  p_actor_user_id uuid,
  p_member_user_id uuid,
  p_kind text,
  p_document_ids uuid[],
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.foundation_workspace_members%rowtype;
  v_subject public.foundation_workspace_members%rowtype;
  v_before text;
  v_after text;
  v_count integer;
  v_keyed jsonb;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_actor_user_id is null or p_member_user_id is null
    or p_kind is null or p_kind not in ('all', 'listed')
    or p_request_id is null or pg_catalog.char_length(p_request_id) not between 8 and 160
    or (p_kind = 'all' and p_document_ids is not null and pg_catalog.cardinality(p_document_ids) > 0)
    or (p_kind = 'listed' and (p_document_ids is null
      or pg_catalog.cardinality(p_document_ids) > 2000
      or pg_catalog.array_position(p_document_ids, null) is not null)) then
    raise exception 'member_source_scope_input_invalid';
  end if;

  -- Actor, then subject: the same lock order as the membership functions of 20260920110000.
  select * into v_actor from public.foundation_workspace_members
   where workspace_key = p_workspace_key and user_id = p_actor_user_id for update;
  if not found or v_actor.state <> 'active' or v_actor.role not in ('owner', 'admin') then
    raise exception 'member_source_scope_forbidden';
  end if;
  select * into v_subject from public.foundation_workspace_members
   where workspace_key = p_workspace_key and user_id = p_member_user_id for update;
  if not found or v_subject.state <> 'active' then raise exception 'workspace_member_not_found'; end if;
  if v_subject.role <> 'member' then raise exception 'member_source_scope_target_forbidden'; end if;

  v_before := public.foundation_member_source_scope_stored(p_workspace_key, p_member_user_id);
  v_after := public.foundation_member_source_scope_digest(p_kind, p_document_ids);
  v_count := case when p_kind = 'all' then 0
    else (select count(distinct d.id)::integer from pg_catalog.unnest(p_document_ids) as d(id)) end;

  -- A request id already used for this member answers what it did then and never writes again: a late
  -- retry of an earlier grant must not undo a later revoke. The same id with another scope is refused.
  -- Every request id is recorded (below), so this holds for a request that changed nothing too.
  select e.details into v_keyed from public.foundation_workspace_membership_events e
   where e.workspace_key = p_workspace_key and e.subject_user_id = p_member_user_id
     and e.action = 'member.source_scope_changed' and e.request_id = p_request_id
   limit 1;
  if found then
    if v_keyed ->> 'after' is distinct from v_after then
      raise exception 'member_source_scope_idempotency_conflict';
    end if;
    return jsonb_build_object('workspaceKey', p_workspace_key, 'userId', p_member_user_id,
      'kind', p_kind, 'documentCount', v_count, 'digest', v_after, 'idempotentReplay', true);
  end if;

  if v_after = v_before then
    -- The scope asked for is the scope stored: no scope row is written; the request id is recorded.
    insert into public.foundation_workspace_membership_events (
      workspace_key, action, actor_user_id, subject_user_id, request_id, details
    ) values (
      p_workspace_key, 'member.source_scope_changed', p_actor_user_id, p_member_user_id, p_request_id,
      jsonb_build_object('kind', p_kind, 'documentCount', v_count, 'before', v_before, 'after', v_after)
    );
    return jsonb_build_object('workspaceKey', p_workspace_key, 'userId', p_member_user_id,
      'kind', p_kind, 'documentCount', v_count, 'digest', v_after, 'idempotentReplay', true);
  end if;
  delete from public.foundation_workspace_member_source_scopes
   where workspace_key = p_workspace_key and user_id = p_member_user_id;
  if p_kind = 'all' then
    insert into public.foundation_workspace_member_source_scopes (workspace_key, user_id, scope_kind, document_id, granted_by)
    values (p_workspace_key, p_member_user_id, 'all', null, p_actor_user_id);
  else
    insert into public.foundation_workspace_member_source_scopes (workspace_key, user_id, scope_kind, document_id, granted_by)
    select distinct p_workspace_key, p_member_user_id, 'listed', d.id, p_actor_user_id
      from pg_catalog.unnest(p_document_ids) as d(id);
  end if;
  -- The stored rows must now say exactly what was asked; anything else is an integrity failure.
  if public.foundation_member_source_scope_stored(p_workspace_key, p_member_user_id) <> v_after then
    raise exception 'member_source_scope_write_mismatch';
  end if;
  insert into public.foundation_workspace_membership_events (
    workspace_key, action, actor_user_id, subject_user_id, request_id, details
  ) values (
    p_workspace_key, 'member.source_scope_changed', p_actor_user_id, p_member_user_id, p_request_id,
    jsonb_build_object('kind', p_kind, 'documentCount', v_count, 'before', v_before, 'after', v_after)
  );
  return jsonb_build_object('workspaceKey', p_workspace_key, 'userId', p_member_user_id,
    'kind', p_kind, 'documentCount', v_count, 'digest', v_after, 'idempotentReplay', false);
end;
$$;

-- A member's own upload enters their scope in the transaction that admits it. Owners and admins
-- already read everything; a member with an `all` row already reads it; anyone else (no active
-- membership) gets nothing -- the admission itself is decided elsewhere and is not refused here.
-- The membership row is locked FOR SHARE, so a concurrent set_member_source_scope (FOR UPDATE on
-- the same row) is ordered strictly before or after this insert, never interleaved.
create function public.foundation_member_upload_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select m.role into v_role from public.foundation_workspace_members m
   where m.workspace_key = new.workspace_key and m.user_id = new.user_id and m.state = 'active'
   for share;
  if not found or v_role <> 'member' then return new; end if;
  if exists (select 1 from public.foundation_workspace_member_source_scopes s
              where s.workspace_key = new.workspace_key and s.user_id = new.user_id and s.scope_kind = 'all') then
    return new;
  end if;
  insert into public.foundation_workspace_member_source_scopes (workspace_key, user_id, scope_kind, document_id, granted_by)
  values (new.workspace_key, new.user_id, 'listed', new.document_id, new.user_id)
  on conflict (workspace_key, user_id, document_id) where scope_kind = 'listed' do nothing;
  return new;
end;
$$;
create trigger foundation_member_upload_scope
  after insert or update of user_id on public.foundation_intake_admissions
  for each row execute function public.foundation_member_upload_scope();

revoke all on function public.foundation_member_source_scope_digest(text, uuid[]),
  public.foundation_member_source_scope_stored(text, uuid),
  public.member_readable_document_ids(text, uuid, text[]),
  public.documents_outside_member_scope(text, uuid, text[]),
  public.get_member_source_scope(text, uuid, uuid),
  public.set_member_source_scope(text, uuid, uuid, text, uuid[], text),
  public.foundation_member_upload_scope()
  from public, anon, authenticated, service_role;
grant execute on function public.member_readable_document_ids(text, uuid, text[]),
  public.documents_outside_member_scope(text, uuid, text[]),
  public.get_member_source_scope(text, uuid, uuid),
  public.set_member_source_scope(text, uuid, uuid, text, uuid[], text)
  to service_role;

commit;
