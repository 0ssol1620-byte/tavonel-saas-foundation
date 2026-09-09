begin;
create table public.connector_source_suspensions (
  source_id text primary key check (source_id ~ '^src-[a-f0-9]{64}$'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  reason text not null check (reason in ('removed_or_inaccessible', 'permission_review_required')),
  recorded_at timestamptz not null default now()
);
create function public.guard_connector_source_suspension() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'CONNECTOR_SUSPENSION_IMMUTABLE'; end if;
  perform 1 from public.connector_document_bindings where source_id=new.source_id and workspace_key=new.workspace_key;
  if not found then raise exception 'CONNECTOR_SUSPENSION_UNBOUND'; end if;
  return new;
end;
$$;
create trigger connector_source_suspension_guard before insert or update or delete
  on public.connector_source_suspensions for each row execute function public.guard_connector_source_suspension();
alter table public.connector_source_suspensions enable row level security;
revoke all on public.connector_source_suspensions from public, anon, authenticated, service_role;
grant select, insert on public.connector_source_suspensions to service_role;
revoke all on function public.guard_connector_source_suspension() from public, anon, authenticated;

-- Negative authorization overlay only. Unbound legacy imports remain a qualification gap.
create function public.connector_documents_blocked(p_workspace_key text, p_document_ids text[]) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_document_ids is null or cardinality(p_document_ids) > 2000
    or array_position(p_document_ids, null) is not null then raise exception 'CONNECTOR_AUTH_SCOPE_INVALID'; end if;
  return exists (
    select 1 from public.connector_document_bindings b
    join public.foundation_oauth_connections c on c.oauth_connection_id=b.oauth_connection_id
    where b.workspace_key=p_workspace_key and b.document_id::text=any(p_document_ids)
      and (c.status <> 'active' or c.workspace_key <> b.workspace_key or c.provider <> b.provider or exists (
        select 1 from public.connector_source_suspensions s where s.source_id=b.source_id and s.workspace_key=b.workspace_key
      ))
  );
end;
$$;
revoke all on function public.connector_documents_blocked(text,text[]) from public, anon, authenticated, service_role;
grant execute on function public.connector_documents_blocked(text,text[]) to service_role;
commit;
