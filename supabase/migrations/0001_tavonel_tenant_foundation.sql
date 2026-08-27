-- This migration is intentionally not applied by this project. Apply only to the dedicated
-- Supabase project after the project, region, environment, and service-role secret are approved.
begin;

create extension if not exists pgcrypto;

create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.entitlement_status as enum ('trialing', 'active', 'past_due', 'paused', 'canceled', 'inactive');
create type public.document_state as enum ('requested', 'quarantined', 'sanitized', 'rejected', 'candidate_ready');
create type public.candidate_state as enum ('pending_review', 'approved', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,64}$'),
  name text not null,
  upload_bytes_limit bigint not null check (upload_bytes_limit >= 0),
  document_limit integer not null check (document_limit >= 0),
  max_document_bytes bigint not null check (max_document_bytes >= 0),
  paddle_product_id text unique,
  paddle_price_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_entitlements (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  status public.entitlement_status not null default 'inactive',
  source text not null check (source in ('paddle', 'manual', 'trial')),
  upload_bytes_limit bigint not null default 0 check (upload_bytes_limit >= 0),
  upload_bytes_used bigint not null default 0 check (upload_bytes_used >= 0),
  document_limit integer not null default 0 check (document_limit >= 0),
  document_count integer not null default 0 check (document_count >= 0),
  valid_until timestamptz,
  last_event_occurred_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  original_filename text not null check (char_length(original_filename) between 1 and 512),
  declared_mime_type text not null,
  observed_mime_type text,
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'),
  quarantine_object_key text not null unique,
  canonical_object_key text unique,
  state public.document_state not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_workspace_created_idx on public.documents (workspace_id, created_at desc);

create table public.sanitization_proofs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.documents(id) on delete cascade,
  input_sha256 text not null check (input_sha256 ~ '^[a-f0-9]{64}$'),
  output_sha256 text not null check (output_sha256 ~ '^[a-f0-9]{64}$'),
  output_mime_type text not null,
  sanitizer_version text not null,
  immutable_object_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.knowledge_graph_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  sanitization_proof_id uuid not null references public.sanitization_proofs(id) on delete restrict,
  state public.candidate_state not null default 'pending_review',
  summary_object_key text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);
create index knowledge_graph_candidates_workspace_idx on public.knowledge_graph_candidates (workspace_id, created_at desc);

create table public.paddle_customers (
  paddle_customer_id text primary key,
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.paddle_subscriptions (
  paddle_subscription_id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  paddle_customer_id text not null references public.paddle_customers(paddle_customer_id) on delete restrict,
  paddle_product_id text,
  paddle_price_id text,
  status public.entitlement_status not null,
  scheduled_change_at timestamptz,
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.billing_events (
  paddle_event_id text primary key,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.role = 'owner'
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid := gen_random_uuid();
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''));

  insert into public.workspaces (id, owner_id, name, slug)
  values (
    new_workspace_id,
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), 'Personal') || '''s workspace',
    'ws-' || replace(new_workspace_id::text, '-', '')
  );

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  insert into public.workspace_entitlements (workspace_id, source, status)
  values (new_workspace_id, 'trial', 'inactive');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.plans enable row level security;
alter table public.workspace_entitlements enable row level security;
alter table public.documents enable row level security;
alter table public.sanitization_proofs enable row level security;
alter table public.knowledge_graph_candidates enable row level security;
alter table public.paddle_customers enable row level security;
alter table public.paddle_subscriptions enable row level security;
alter table public.billing_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function public.is_workspace_member(uuid), public.is_workspace_owner(uuid) to authenticated;
grant select on public.profiles, public.workspaces, public.workspace_memberships, public.plans,
  public.workspace_entitlements, public.documents, public.sanitization_proofs,
  public.knowledge_graph_candidates, public.paddle_customers, public.paddle_subscriptions to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

create policy profiles_select_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy workspaces_select_member on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy memberships_select_member on public.workspace_memberships for select to authenticated using (public.is_workspace_member(workspace_id));
create policy plans_select_authenticated on public.plans for select to authenticated using (true);
create policy entitlements_select_member on public.workspace_entitlements for select to authenticated using (public.is_workspace_member(workspace_id));
create policy documents_select_member on public.documents for select to authenticated using (public.is_workspace_member(workspace_id));
create policy proofs_select_document_member on public.sanitization_proofs for select to authenticated using (
  exists (select 1 from public.documents d where d.id = document_id and public.is_workspace_member(d.workspace_id))
);
create policy candidates_select_member on public.knowledge_graph_candidates for select to authenticated using (public.is_workspace_member(workspace_id));
create policy paddle_customers_select_self on public.paddle_customers for select to authenticated using (user_id = auth.uid());
create policy paddle_subscriptions_select_member on public.paddle_subscriptions for select to authenticated using (public.is_workspace_member(workspace_id));

commit;
