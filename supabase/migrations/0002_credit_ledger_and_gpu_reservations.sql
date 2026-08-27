-- Apply only after a dedicated review and explicit target-project confirmation.
begin;

create type public.credit_ledger_entry_kind as enum ('purchased', 'reserved', 'settled', 'released', 'expired', 'reversed', 'operator_review');
create type public.gpu_reservation_state as enum ('reserved', 'dispatched', 'settled', 'released', 'operator_review', 'canceled');

create table public.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null unique,
  kind public.credit_ledger_entry_kind not null,
  credit_delta integer not null,
  source_event_id text unique,
  reservation_id uuid,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index credit_ledger_entries_workspace_created_idx on public.credit_ledger_entries (workspace_id, created_at desc);

create table public.gpu_job_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  sanitization_proof_id uuid not null references public.sanitization_proofs(id) on delete restrict,
  idempotency_key text not null unique,
  gpu_class text not null check (gpu_class in ('rtx4090', 'a100', 'h100')),
  reserved_credits integer not null check (reserved_credits >= 2),
  settled_credits integer check (settled_credits >= 0),
  state public.gpu_reservation_state not null default 'reserved',
  max_execution_seconds integer not null check (max_execution_seconds between 5 and 90),
  ttl_seconds integer not null check (ttl_seconds between 5 and 300),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
alter table public.credit_ledger_entries
  add constraint credit_ledger_entries_reservation_id_fkey foreign key (reservation_id) references public.gpu_job_reservations(id) on delete set null;

alter table public.credit_ledger_entries enable row level security;
alter table public.gpu_job_reservations enable row level security;
revoke all on public.credit_ledger_entries, public.gpu_job_reservations from anon, authenticated;

commit;
