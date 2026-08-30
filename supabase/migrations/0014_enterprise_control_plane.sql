-- Enterprise control plane. Provider credentials never belong in this schema: only
-- externally managed secret references and non-sensitive configuration metadata are stored.
begin;

create type public.enterprise_org_role as enum (
  'owner', 'admin', 'security_admin', 'billing_admin', 'member', 'viewer'
);
create type public.enterprise_workspace_role as enum (
  'owner', 'admin', 'editor', 'operator', 'viewer'
);
create type public.enterprise_identity_protocol as enum ('saml', 'scim');
create type public.enterprise_identity_status as enum ('disabled', 'configured', 'active', 'error');
create type public.enterprise_region as enum ('us', 'eu', 'apac');

create table public.enterprise_organizations (
  organization_id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.enterprise_organization_memberships (
  organization_id uuid not null references public.enterprise_organizations(organization_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.enterprise_org_role not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index enterprise_org_memberships_user_idx
  on public.enterprise_organization_memberships (user_id, organization_id);

create table public.enterprise_workspaces (
  workspace_key text primary key check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  organization_id uuid not null references public.enterprise_organizations(organization_id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 120),
  region public.enterprise_region not null default 'apac',
  dedicated_deployment boolean not null default false,
  deployment_reference text check (
    deployment_reference is null or deployment_reference ~ '^(vercel|gcp|aws|azure|runpod)://[A-Za-z0-9._/@:+-]{3,500}$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (dedicated_deployment or deployment_reference is null)
);
create index enterprise_workspaces_org_idx
  on public.enterprise_workspaces (organization_id, workspace_key);

create table public.enterprise_workspace_memberships (
  workspace_key text not null references public.enterprise_workspaces(workspace_key) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.enterprise_workspace_role not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_key, user_id)
);
create index enterprise_workspace_memberships_user_idx
  on public.enterprise_workspace_memberships (user_id, workspace_key);

create table public.enterprise_identity_configs (
  organization_id uuid not null references public.enterprise_organizations(organization_id) on delete cascade,
  protocol public.enterprise_identity_protocol not null,
  status public.enterprise_identity_status not null default 'disabled',
  provider text not null check (provider in ('generic', 'okta', 'entra_id', 'google_workspace', 'onelogin')),
  configuration jsonb not null default '{}'::jsonb check (
    jsonb_typeof(configuration) = 'object'
    and octet_length(configuration::text) <= 16384
    and configuration::text !~* '"(secret|password|token|credential|private[_-]?key)"[[:space:]]*:'
  ),
  secret_reference text check (
    secret_reference is null or secret_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]{3,500}$'
  ),
  last_verified_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,64}$'),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (organization_id, protocol),
  check (status <> 'active' or (secret_reference is not null and last_verified_at is not null))
);

create table public.enterprise_governance_policies (
  organization_id uuid primary key references public.enterprise_organizations(organization_id) on delete cascade,
  retention_days integer not null default 365 check (retention_days between 1 and 3650),
  deleted_object_grace_days integer not null default 30 check (deleted_object_grace_days between 0 and 90),
  audit_retention_days integer not null default 2555 check (audit_retention_days between 365 and 3650),
  export_format text not null default 'jsonl' check (export_format in ('jsonl', 'csv')),
  export_signing_required boolean not null default true,
  legal_hold_enabled boolean not null default false,
  allowed_regions public.enterprise_region[] not null default array['apac']::public.enterprise_region[]
    check (cardinality(allowed_regions) between 1 and 3),
  dedicated_deployment_required boolean not null default false,
  rto_minutes integer not null default 240 check (rto_minutes between 15 and 10080),
  rpo_minutes integer not null default 1440 check (rpo_minutes between 5 and 10080),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.enterprise_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.enterprise_organizations(organization_id) on delete restrict,
  workspace_key text references public.enterprise_workspaces(workspace_key) on delete restrict,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,95}$'),
  target_type text not null check (target_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  target_id text not null check (char_length(target_id) between 1 and 160),
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'service', 'system')),
  outcome text not null default 'succeeded' check (outcome in ('succeeded', 'denied', 'failed')),
  request_id text check (request_id is null or request_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
  source_ip_hash text check (source_ip_hash is null or source_ip_hash ~ '^sha256:[a-f0-9]{64}$'),
  details jsonb not null default '{}'::jsonb check (
    jsonb_typeof(details) = 'object'
    and octet_length(details::text) <= 16384
    and details::text !~* '"(content|text|secret|password|token|credential|private[_-]?key)"[[:space:]]*:'
  ),
  occurred_at timestamptz not null default now(),
  check ((actor_kind = 'user') = (actor_user_id is not null))
);
create index enterprise_audit_org_time_idx
  on public.enterprise_audit_events (organization_id, occurred_at desc, event_id);
create index enterprise_audit_workspace_time_idx
  on public.enterprise_audit_events (workspace_key, occurred_at desc) where workspace_key is not null;

create table public.enterprise_daily_metrics (
  organization_id uuid not null references public.enterprise_organizations(organization_id) on delete cascade,
  workspace_key text not null references public.enterprise_workspaces(workspace_key) on delete cascade,
  metric_date date not null,
  active_users integer not null default 0 check (active_users >= 0),
  documents_processed integer not null default 0 check (documents_processed >= 0),
  gpu_seconds bigint not null default 0 check (gpu_seconds >= 0),
  gpu_cost_micros bigint not null default 0 check (gpu_cost_micros >= 0),
  revenue_micros bigint not null default 0 check (revenue_micros >= 0),
  credits_consumed bigint not null default 0 check (credits_consumed >= 0),
  job_failures integer not null default 0 check (job_failures >= 0),
  compiled_at timestamptz not null default now(),
  primary key (organization_id, workspace_key, metric_date)
);
create index enterprise_daily_metrics_org_date_idx
  on public.enterprise_daily_metrics (organization_id, metric_date desc);

create or replace function public.enterprise_has_permission(
  p_organization_id uuid,
  p_workspace_key text,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enterprise_organizations o
    join public.enterprise_organization_memberships om
      on om.organization_id = o.organization_id and om.user_id = auth.uid()
    left join public.enterprise_workspace_memberships wm
      on wm.workspace_key = p_workspace_key and wm.user_id = auth.uid()
    where o.organization_id = p_organization_id
      and o.status = 'active'
      and (p_workspace_key is null or exists (
        select 1 from public.enterprise_workspaces ew
        where ew.workspace_key = p_workspace_key and ew.organization_id = p_organization_id
      ))
      and case p_permission
        when 'organization:read' then om.role in ('owner','admin','security_admin','billing_admin','member','viewer')
        when 'members:write' then om.role in ('owner','admin')
        when 'identity:read' then om.role in ('owner','admin','security_admin')
        when 'identity:write' then om.role in ('owner','admin','security_admin')
        when 'audit:read' then om.role in ('owner','admin','security_admin')
        when 'audit:export' then om.role in ('owner','admin','security_admin')
        when 'billing:read' then om.role in ('owner','admin','billing_admin')
        when 'policy:read' then om.role in ('owner','admin','security_admin')
        when 'policy:write' then om.role in ('owner','admin','security_admin')
        when 'workspace:read' then om.role in ('owner','admin') or wm.role in ('owner','admin','editor','operator','viewer')
        when 'workspace:operate' then om.role in ('owner','admin') or wm.role in ('owner','admin','editor','operator')
        when 'workspace:write' then om.role in ('owner','admin') or wm.role in ('owner','admin','editor')
        else false
      end
  );
$$;

create or replace function public.append_enterprise_audit_event(
  p_organization_id uuid,
  p_workspace_key text,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_actor_user_id uuid,
  p_outcome text,
  p_request_id text,
  p_details jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_event_id uuid;
begin
  if p_actor_user_id is null or p_actor_user_id <> auth.uid() then
    raise exception 'enterprise_audit_actor_invalid';
  end if;
  if not public.enterprise_has_permission(p_organization_id, p_workspace_key, 'organization:read') then
    raise exception 'enterprise_access_denied';
  end if;
  insert into public.enterprise_audit_events (
    organization_id, workspace_key, action, target_type, target_id,
    actor_user_id, outcome, request_id, details
  ) values (
    p_organization_id, p_workspace_key, p_action, p_target_type, p_target_id,
    p_actor_user_id, p_outcome, p_request_id, coalesce(p_details, '{}'::jsonb)
  ) returning event_id into v_event_id;
  return v_event_id;
end;
$$;

create or replace function public.apply_enterprise_identity_config(
  p_organization_id uuid,
  p_workspace_key text,
  p_actor_user_id uuid,
  p_protocol public.enterprise_identity_protocol,
  p_provider text,
  p_status public.enterprise_identity_status,
  p_configuration jsonb,
  p_secret_reference text,
  p_request_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.enterprise_organization_memberships m
    join public.enterprise_workspaces w on w.organization_id = m.organization_id
    where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
      and m.role in ('owner','admin','security_admin') and w.workspace_key = p_workspace_key
  ) then raise exception 'enterprise_permission_required'; end if;
  if p_status not in ('disabled','configured') then raise exception 'enterprise_identity_activation_requires_verification'; end if;
  insert into public.enterprise_identity_configs (
    organization_id, protocol, status, provider, configuration, secret_reference,
    last_verified_at, last_error_code, updated_by, updated_at
  ) values (
    p_organization_id, p_protocol, p_status, p_provider, p_configuration, p_secret_reference,
    null, null, p_actor_user_id, now()
  ) on conflict (organization_id, protocol) do update set
    status = excluded.status, provider = excluded.provider, configuration = excluded.configuration,
    secret_reference = excluded.secret_reference, last_verified_at = null, last_error_code = null,
    updated_by = excluded.updated_by, updated_at = now();
  insert into public.enterprise_audit_events (
    organization_id, workspace_key, action, target_type, target_id,
    actor_user_id, actor_kind, outcome, request_id, details
  ) values (
    p_organization_id, p_workspace_key, 'identity.configured', 'identity_config', p_protocol::text,
    p_actor_user_id, 'user', 'succeeded', p_request_id,
    jsonb_build_object('provider', p_provider, 'desiredStatus', p_status)
  );
  return p_status::text;
end;
$$;

create or replace function public.apply_enterprise_governance_policy(
  p_organization_id uuid,
  p_workspace_key text,
  p_actor_user_id uuid,
  p_retention_days integer,
  p_deleted_object_grace_days integer,
  p_audit_retention_days integer,
  p_export_format text,
  p_export_signing_required boolean,
  p_legal_hold_enabled boolean,
  p_allowed_regions public.enterprise_region[],
  p_dedicated_deployment_required boolean,
  p_rto_minutes integer,
  p_rpo_minutes integer,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.enterprise_organization_memberships m
    join public.enterprise_workspaces w on w.organization_id = m.organization_id
    where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
      and m.role in ('owner','admin','security_admin') and w.workspace_key = p_workspace_key
  ) then raise exception 'enterprise_permission_required'; end if;
  insert into public.enterprise_governance_policies (
    organization_id, retention_days, deleted_object_grace_days, audit_retention_days,
    export_format, export_signing_required, legal_hold_enabled, allowed_regions,
    dedicated_deployment_required, rto_minutes, rpo_minutes, updated_by, updated_at
  ) values (
    p_organization_id, p_retention_days, p_deleted_object_grace_days, p_audit_retention_days,
    p_export_format, p_export_signing_required, p_legal_hold_enabled, p_allowed_regions,
    p_dedicated_deployment_required, p_rto_minutes, p_rpo_minutes, p_actor_user_id, now()
  ) on conflict (organization_id) do update set
    retention_days = excluded.retention_days,
    deleted_object_grace_days = excluded.deleted_object_grace_days,
    audit_retention_days = excluded.audit_retention_days,
    export_format = excluded.export_format,
    export_signing_required = excluded.export_signing_required,
    legal_hold_enabled = excluded.legal_hold_enabled,
    allowed_regions = excluded.allowed_regions,
    dedicated_deployment_required = excluded.dedicated_deployment_required,
    rto_minutes = excluded.rto_minutes, rpo_minutes = excluded.rpo_minutes,
    updated_by = excluded.updated_by, updated_at = now();
  insert into public.enterprise_audit_events (
    organization_id, workspace_key, action, target_type, target_id,
    actor_user_id, actor_kind, outcome, request_id, details
  ) values (
    p_organization_id, p_workspace_key, 'governance.policy_updated', 'organization', p_organization_id::text,
    p_actor_user_id, 'user', 'succeeded', p_request_id,
    jsonb_build_object('retentionDays', p_retention_days, 'allowedRegions', p_allowed_regions,
      'dedicatedDeploymentRequired', p_dedicated_deployment_required)
  );
  return true;
end;
$$;

alter table public.enterprise_organizations enable row level security;
alter table public.enterprise_organization_memberships enable row level security;
alter table public.enterprise_workspaces enable row level security;
alter table public.enterprise_workspace_memberships enable row level security;
alter table public.enterprise_identity_configs enable row level security;
alter table public.enterprise_governance_policies enable row level security;
alter table public.enterprise_audit_events enable row level security;
alter table public.enterprise_daily_metrics enable row level security;

revoke all on public.enterprise_organizations, public.enterprise_organization_memberships,
  public.enterprise_workspaces, public.enterprise_workspace_memberships,
  public.enterprise_identity_configs, public.enterprise_governance_policies,
  public.enterprise_audit_events, public.enterprise_daily_metrics
  from public, anon, authenticated;
grant select, insert, update, delete on public.enterprise_organizations,
  public.enterprise_organization_memberships, public.enterprise_workspaces,
  public.enterprise_workspace_memberships, public.enterprise_identity_configs,
  public.enterprise_governance_policies, public.enterprise_audit_events,
  public.enterprise_daily_metrics to service_role;

revoke all on function public.enterprise_has_permission(uuid, text, text) from public, anon;
grant execute on function public.enterprise_has_permission(uuid, text, text) to authenticated, service_role;
revoke all on function public.append_enterprise_audit_event(uuid, text, text, text, text, uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.append_enterprise_audit_event(uuid, text, text, text, text, uuid, text, text, jsonb)
  to authenticated, service_role;
revoke all on function public.apply_enterprise_identity_config(uuid, text, uuid, public.enterprise_identity_protocol, text, public.enterprise_identity_status, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_enterprise_identity_config(uuid, text, uuid, public.enterprise_identity_protocol, text, public.enterprise_identity_status, jsonb, text, text)
  to service_role;
revoke all on function public.apply_enterprise_governance_policy(uuid, text, uuid, integer, integer, integer, text, boolean, boolean, public.enterprise_region[], boolean, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.apply_enterprise_governance_policy(uuid, text, uuid, integer, integer, integer, text, boolean, boolean, public.enterprise_region[], boolean, integer, integer, text)
  to service_role;

-- Audit history is append-only, including for service_role. Mutation must fail at the database boundary.
create or replace function public.reject_enterprise_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'enterprise_audit_immutable'; end;
$$;
create trigger enterprise_audit_immutable_before_change
  before update or delete on public.enterprise_audit_events
  for each row execute function public.reject_enterprise_audit_mutation();
revoke all on function public.reject_enterprise_audit_mutation() from public, anon, authenticated;

commit;
