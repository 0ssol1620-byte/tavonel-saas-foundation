begin;

-- V2 is additive. The existing v1 reader remains the sole production authority until every
-- admission, compile, derived-read and checkout boundary is deliberately migrated.
create table public.customer_data_release_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  schema_version text not null default 'tavonel.customer_data_gate.v2'
    check (schema_version = 'tavonel.customer_data_gate.v2'),
  scope text not null check (scope in ('direct_upload', 'connector')),
  release_revision text not null check (release_revision ~ '^[0-9a-f]{40}$'),
  allowed boolean not null default false,
  receipt_sha256 text check (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  evidence jsonb not null default '[]'::jsonb check (
    jsonb_typeof(evidence) = 'array'
    and jsonb_array_length(evidence) <= 17
    and octet_length(evidence::text) <= 65536
    and evidence::text !~* '"(secret|password|token|credential|access[_-]?key|private[_-]?key)"[[:space:]]*:'
  ),
  missing text[] not null default '{}'::text[] check (array_position(missing, null) is null),
  evaluated_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  operator_actor text not null check (char_length(operator_actor) between 3 and 128),
  decision_reason text not null check (char_length(decision_reason) between 3 and 2048),
  constraint scoped_release_allowed_complete check (
    allowed = false or (
      receipt_sha256 is not null and cardinality(missing) = 0
      and jsonb_array_length(evidence) = case scope when 'direct_upload' then 12 else 17 end
    )
  ),
  constraint scoped_release_refusal_named check (allowed = true or cardinality(missing) > 0)
);

create index customer_data_release_decisions_latest_idx
  on public.customer_data_release_decisions (scope, release_revision, recorded_at desc, allowed asc);

create table public.customer_data_workspace_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  schema_version text not null default 'tavonel.customer_data_gate.v2'
    check (schema_version = 'tavonel.customer_data_gate.v2'),
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  scope text not null check (scope in ('direct_upload', 'connector')),
  release_revision text not null check (release_revision ~ '^[0-9a-f]{40}$'),
  allowed boolean not null default false,
  user_id uuid,
  release_receipt_sha256 text check (release_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  terms_version text check (char_length(terms_version) between 1 and 128),
  terms_receipt_sha256 text check (terms_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  processing_terms_receipt_sha256 text check (processing_terms_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  grant_receipt_sha256 text check (grant_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  granted_at timestamptz,
  expires_at timestamptz,
  recorded_at timestamptz not null default now(),
  operator_actor text not null check (char_length(operator_actor) between 3 and 128),
  decision_reason text not null check (char_length(decision_reason) between 3 and 2048),
  constraint scoped_workspace_allowed_complete check (
    allowed = false or (
      user_id is not null and release_receipt_sha256 is not null
      and terms_version is not null and terms_receipt_sha256 is not null
      and processing_terms_receipt_sha256 is not null
      and grant_receipt_sha256 is not null
      and granted_at is not null and expires_at is not null and expires_at > granted_at
    )
  )
);

create index customer_data_workspace_decisions_latest_idx
  on public.customer_data_workspace_decisions
  (tenant_id, workspace_id, scope, recorded_at desc, allowed asc);

alter table public.customer_data_release_decisions enable row level security;
alter table public.customer_data_workspace_decisions enable row level security;
revoke all on public.customer_data_release_decisions, public.customer_data_workspace_decisions
  from public, anon, authenticated, service_role;
grant select, insert on public.customer_data_release_decisions, public.customer_data_workspace_decisions
  to service_role;
create policy customer_data_release_decisions_no_client_access
  on public.customer_data_release_decisions as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy customer_data_workspace_decisions_no_client_access
  on public.customer_data_workspace_decisions as restrictive for all to anon, authenticated
  using (false) with check (false);

commit;
