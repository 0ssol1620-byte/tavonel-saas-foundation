-- A source tombstone is an immediate serving deny, independently of later physical purge.
--
-- Connector removal already writes connector_source_suspensions and this RPC already checked
-- that overlay. The canonical source ledger has two additional terminal signals, however:
-- sources.tombstoned_at retires the logical source and source_versions.tombstoned retires one
-- observed byte version. Ignoring either lets an old retrieval unit, cached answer, World read,
-- or signed export remain readable until a separate purge/recompile happens.
--
-- Keep this as an additive migration rather than editing the applied suspension migration.
begin;

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
      )
  );
end;
$$;

revoke all on function public.connector_documents_blocked(text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.connector_documents_blocked(text, text[])
  to service_role;

commit;
