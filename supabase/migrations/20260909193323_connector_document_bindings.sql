-- Immutable bridge from provider identity to observed document bytes. No public read grant.
-- This does not grant retrieval access; revocation/ACL enforcement remains a separate gate.
begin;
create table public.connector_document_bindings (
  source_version_id text primary key check (source_version_id ~ '^sv-[a-f0-9]{64}$'),
  source_id text not null check (source_id ~ '^src-[a-f0-9]{64}$'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  oauth_connection_id uuid not null references public.foundation_oauth_connections(oauth_connection_id) on delete restrict,
  provider text not null check (provider in ('google_drive', 'dropbox', 'microsoft_graph')),
  native_id text not null check (char_length(native_id) between 1 and 512 and native_id !~ '[[:cntrl:]]' and btrim(native_id) <> ''),
  provider_revision text not null check (char_length(provider_revision) between 1 and 512 and provider_revision !~ '[[:cntrl:]]' and btrim(provider_revision) <> ''),
  document_id uuid not null,
  content_sha256 text not null check (content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  byte_length bigint not null check (byte_length > 0),
  mime_type text not null check (char_length(mime_type) between 3 and 160),
  recorded_at timestamptz not null default now(),
  unique (workspace_key, document_id),
  unique (oauth_connection_id, native_id, provider_revision)
);
create index connector_document_bindings_source_idx on public.connector_document_bindings (workspace_key, source_id);

create function public.guard_connector_document_binding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'CONNECTOR_BINDING_IMMUTABLE'; end if;
  perform 1 from public.foundation_oauth_connections
    where oauth_connection_id = new.oauth_connection_id and workspace_key = new.workspace_key
      and provider = new.provider and status = 'active' for share;
  if not found then raise exception 'CONNECTOR_BINDING_CONNECTION_INVALID'; end if;
  return new;
end;
$$;
create trigger connector_document_binding_guard before insert or update or delete
  on public.connector_document_bindings for each row execute function public.guard_connector_document_binding();
alter table public.connector_document_bindings enable row level security;
revoke all on public.connector_document_bindings from public, anon, authenticated, service_role;
grant select, insert on public.connector_document_bindings to service_role;
revoke all on function public.guard_connector_document_binding() from public, anon, authenticated;
commit;
