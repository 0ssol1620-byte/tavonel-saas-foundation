-- Append-only human decisions bound to compiled evidence. The browser names an evidence id;
-- the application re-reads the persisted World and supplies the exact source geometry.
begin;

create table if not exists public.foundation_review_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  workspace_key text not null references public.foundation_billing_accounts(workspace_key) on delete restrict,
  collection_id text not null check (collection_id ~ '^collection-[a-f0-9]{32}$'),
  manifest_digest text not null check (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  evidence_id text not null check (evidence_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  source_id text not null check (source_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  source_version_id text not null check (source_version_id ~ '^[a-f0-9]{32,64}$'),
  page_number integer not null check (page_number between 1 and 100000),
  bbox_1000 integer[] not null check (
    array_length(bbox_1000, 1) = 4
    and bbox_1000[1] between 0 and 999 and bbox_1000[2] between 0 and 999
    and bbox_1000[3] between 1 and 1000 and bbox_1000[4] between 1 and 1000
    and bbox_1000[1] < bbox_1000[3] and bbox_1000[2] < bbox_1000[4]
  ),
  action text not null check (action in ('accept', 'edit', 'reject')),
  reason text not null check (char_length(reason) between 8 and 1000),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists foundation_review_decisions_workspace_collection_created_idx
  on public.foundation_review_decisions (workspace_key, collection_id, created_at desc);
create index if not exists foundation_review_decisions_evidence_created_idx
  on public.foundation_review_decisions (workspace_key, evidence_id, created_at desc);

alter table public.foundation_review_decisions enable row level security;
revoke all on public.foundation_review_decisions from public, anon, authenticated;
grant select, insert on public.foundation_review_decisions to service_role;

commit;
