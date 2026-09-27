-- Per-source ACL admission for connector documents (customer-data gate row 16).
--
-- 0050 created `source_acl_snapshots` as storage only: no workspace column, no binding to the
-- connector document it describes, and no reader. This migration makes the table enforceable and
-- puts it on the one serving path every document read, retrieval, compile, download and World read
-- already goes through (`connector_documents_blocked`, via `nextjs/lib/connector-source-access.ts`).
--
-- The rule, default deny: a connector-bound document is served only if the newest snapshot for its
-- exact source version, in its own workspace and from its own provider, is fresh and grants read
-- (or more) to one of the viewer's verified provider principals. Missing, stale, future-dated,
-- cross-workspace or cross-provider snapshots admit nobody.
--
-- What this does NOT do, stated rather than implied (docs/CUSTOMER_DATA_GATE_2026-09-06.md §9):
--   * No connector captures a snapshot. Dropbox's granted scopes cannot read sharing metadata;
--     Google Drive and Microsoft Graph return partial ACLs whose group/domain grants cannot be
--     expanded with the granted scopes. Nothing here writes a row.
--   * No viewer has a verified provider principal. A TAVONEL member is a Supabase user; the only
--     provider identity on record is the account that connected, per connection. Matching an email
--     string to an ACL entry would be an identity claim nobody verified. The serving check
--     therefore passes an empty principal set, and every connector-bound document is denied.
-- Connector intake already requires a verified customer-data gate decision, which requires this row,
-- so no admitted workspace loses access it was ever granted under the gate.
begin;

-- Tenant binding. No writer has ever existed, so the table is empty and NOT NULL is safe; if a row
-- somehow exists, the migration fails rather than inventing its workspace.
alter table public.source_acl_snapshots
  add column workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$');

create index source_acl_snapshot_admission_idx
  on public.source_acl_snapshots (workspace_key, source_version_id, provider_id, captured_at desc);

-- Version binding at write time: a snapshot must describe an existing connector binding for the same
-- source version, workspace and provider. A trigger rather than a foreign key because the founder
-- test reset deletes bindings before snapshots, and a restrict FK would break that ordering.
create function public.guard_source_acl_snapshot() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.connector_document_bindings
    where source_version_id = new.source_version_id
      and workspace_key = new.workspace_key
      and provider = new.provider_id;
  if not found then raise exception 'SOURCE_ACL_SNAPSHOT_UNBOUND'; end if;
  if new.captured_at > now() + interval '5 minutes' then raise exception 'SOURCE_ACL_SNAPSHOT_FUTURE'; end if;
  return new;
end;
$$;
create trigger source_acl_snapshot_guard before insert
  on public.source_acl_snapshots for each row execute function public.guard_source_acl_snapshot();
revoke all on function public.guard_source_acl_snapshot() from public, anon, authenticated;

-- Admission for one source version. Strict identity match on (kind, principalId): no containment
-- (`anyone` does not cover a user, a group does not cover its members), because every containment
-- rule can only widen and the directory lookups it needs do not exist -- same ceiling as
-- `shared/aclSnapshot.ts`. If two snapshots share the newest capture instant, all must admit.
-- ponytail: freshness is a fixed 24 hours; make it a governed policy value when a capture job exists.
create function public.source_version_acl_admits(
  p_workspace_key text,
  p_source_version_id text,
  p_provider text,
  p_viewer_principals jsonb
) returns boolean
language sql
stable
set search_path = ''
as $$
  with fresh as (
    select a.principals, a.captured_at
    from public.source_acl_snapshots a
    where a.workspace_key = p_workspace_key
      and a.source_version_id = p_source_version_id
      and a.provider_id = p_provider
      and a.captured_at <= now()
      and a.captured_at > now() - interval '24 hours'
  ),
  latest as (
    select f.principals from fresh f where f.captured_at = (select max(captured_at) from fresh)
  )
  select coalesce(bool_and(exists (
    select 1
    from jsonb_array_elements(l.principals) grant_row,
         jsonb_array_elements(case when jsonb_typeof(p_viewer_principals) = 'array' then p_viewer_principals else '[]'::jsonb end) viewer
    where grant_row->>'kind' = viewer->>'kind'
      and grant_row->>'principalId' = viewer->>'principalId'
      and grant_row->>'permission' in ('read', 'write', 'owner')
  )), false)
  from latest l;
$$;
revoke all on function public.source_version_acl_admits(text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.source_version_acl_admits(text, text, text, jsonb) to service_role;

-- The serving overlay, unchanged except for the final ACL clause.
create or replace function public.connector_documents_blocked(
  p_workspace_key text,
  p_document_ids text[]
) returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_workspace_key is null
    or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_document_ids is null
    or cardinality(p_document_ids) > 2000
    or array_position(p_document_ids, null) is not null then
    raise exception 'CONNECTOR_AUTH_SCOPE_INVALID';
  end if;

  return exists (
    select 1
    from public.connector_document_bindings b
    join public.foundation_oauth_connections c
      on c.oauth_connection_id = b.oauth_connection_id
    left join public.source_versions sv
      on sv.source_version_id = b.source_version_id
    left join public.sources s
      on s.source_id = b.source_id
    where b.workspace_key = p_workspace_key
      and b.document_id::text = any(p_document_ids)
      and (
        c.status <> 'active'
        or c.workspace_key <> b.workspace_key
        or c.provider <> b.provider
        or exists (
          select 1
          from public.connector_source_suspensions css
          where css.source_id = b.source_id
            and css.workspace_key = b.workspace_key
        )
        or sv.tombstoned is true
        or s.tombstoned_at is not null
        -- Per-source ACL. The viewer's verified provider principals: none exist yet (see header),
        -- so this denies every connector-bound document until identity linking lands.
        or not public.source_version_acl_admits(b.workspace_key, b.source_version_id, b.provider, '[]'::jsonb)
      )
  );
end;
$$;

revoke all on function public.connector_documents_blocked(text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.connector_documents_blocked(text, text[])
  to service_role;

commit;
