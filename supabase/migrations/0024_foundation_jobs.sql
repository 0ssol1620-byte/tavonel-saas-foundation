-- Durable job orchestration.
--
-- Every long-running operation in this product currently happens inside one HTTP request:
-- the connector sync route runs with maxDuration = 60 and refuses maxImports > 3, because
-- that is genuinely all a single Vercel function invocation can be trusted to finish. That
-- bound is honest for a diagnostic path and fatal for a real corpus -- a customer connecting
-- a Drive with 10,000 files has no path that terminates.
--
-- This table is the substrate that removes the bound: a request enqueues work and returns a
-- job id immediately, and a worker leases jobs and makes bounded progress across many
-- invocations. Nothing here executes anything; it is the durable state a worker operates on.
--
-- Design constraints, each of which exists because of a specific failure it prevents:
--
--   * Leases, not locks. A worker claims a job by writing a lease that expires. If the
--     worker dies mid-batch, the lease lapses and another worker picks the job up. A lock
--     held by a dead process would strand the job forever.
--
--   * idempotency_key is UNIQUE per workspace. Enqueuing the same logical work twice -- a
--     double-clicked button, a retried request, a webhook delivered twice -- must produce one
--     job, not two. Two concurrent bulk imports of the same connection would race on the
--     cursor and duplicate documents.
--
--   * attempt/max_attempts with available_at. A failing job backs off rather than spinning,
--     and after max_attempts it lands in 'dead' where it stays visible instead of being
--     silently dropped or retried forever.
--
--   * Cursor state lives on the job, not only on the connection. A batch commits its cursor
--     transition together with the rows it produced, so a crash cannot advance the cursor
--     past work that was never durably admitted -- the lost-update failure that makes a
--     "successful" sync silently skip files.
begin;

create type public.foundation_job_type as enum (
  'source_scan',
  'source_import',
  'retrieval_compile'
);

create type public.foundation_job_state as enum (
  'queued',
  'leased',
  'succeeded',
  'failed',
  'dead',
  'canceled'
);

create table public.foundation_jobs (
  job_id text not null check (job_id ~ '^job-[a-f0-9]{32}$'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  job_type public.foundation_job_type not null,
  state public.foundation_job_state not null default 'queued',

  -- What the job operates on. Nullable because not every job type targets a connection
  -- (retrieval_compile targets a collection), and deliberately NOT a foreign key into
  -- foundation_oauth_connections: a job's history must survive the connection being revoked,
  -- or the audit trail disappears exactly when someone needs to ask what it did.
  oauth_connection_id uuid,
  collection_id text check (collection_id is null or collection_id ~ '^collection-[a-f0-9]{32}$'),

  -- Bounded, non-secret job input. The CHECK rejects anything shaped like a credential:
  -- provider tokens live in the secret broker and must never be copied into a queue row.
  payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 8192
    and payload::text !~* '"(secret|password|token|credential|access_token|refresh_token|private[_-]?key)"[[:space:]]*:'
  ),

  -- Enqueue-time deduplication. Same logical work -> same key -> one job.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),

  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),

  -- Backoff / scheduling. A job is eligible when available_at <= now().
  available_at timestamptz not null default now(),

  -- Lease. Both columns move together: a leased job has both, an unleased job has neither.
  leased_by text check (leased_by is null or char_length(leased_by) between 1 and 100),
  lease_expires_at timestamptz,

  -- Progress, for the UI. Never trusted as a completion signal -- state is.
  items_seen integer not null default 0 check (items_seen >= 0),
  items_done integer not null default 0 check (items_done >= 0),

  -- Provider resume token (Drive startPageToken, Dropbox cursor, Graph deltaLink). Stored
  -- on the job so a cursor advance commits with the batch that earned it. Bounded because a
  -- deltaLink is a full URL.
  cursor_token text check (cursor_token is null or char_length(cursor_token) <= 4096),

  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{2,64}$'),
  error_detail text check (error_detail is null or char_length(error_detail) <= 500),

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,

  primary key (workspace_key, job_id),

  -- A lease is all-or-nothing.
  constraint foundation_jobs_lease_paired check (
    (leased_by is null) = (lease_expires_at is null)
  ),
  -- Only a leased job may hold a lease.
  constraint foundation_jobs_lease_state check (
    state = 'leased' or leased_by is null
  ),
  -- A terminal job must say when it finished; a dead or failed one must say why.
  constraint foundation_jobs_terminal_completed check (
    state not in ('succeeded', 'failed', 'dead', 'canceled') or completed_at is not null
  ),
  constraint foundation_jobs_failure_reason check (
    state not in ('failed', 'dead') or error_code is not null
  ),
  constraint foundation_jobs_progress check (items_done <= items_seen)
);

-- One live job per logical unit of work. Terminal jobs are excluded from the constraint so
-- the same work can legitimately be re-run later (tomorrow's scan of the same connection is
-- a new job), while a duplicate enqueue while one is still pending collapses onto it.
create unique index foundation_jobs_idempotency_idx
  on public.foundation_jobs (workspace_key, idempotency_key)
  where state in ('queued', 'leased');

-- The worker's claim query: eligible jobs, oldest first.
create index foundation_jobs_claimable_idx
  on public.foundation_jobs (state, available_at, created_at)
  where state = 'queued';

-- Lease reaping: find leases that lapsed because a worker died.
create index foundation_jobs_lease_expiry_idx
  on public.foundation_jobs (lease_expires_at)
  where state = 'leased';

-- Tenant-scoped listing for the workspace UI.
create index foundation_jobs_workspace_idx
  on public.foundation_jobs (workspace_key, created_at desc);

create index foundation_jobs_connection_idx
  on public.foundation_jobs (workspace_key, oauth_connection_id, created_at desc)
  where oauth_connection_id is not null;

alter table public.foundation_jobs enable row level security;
revoke all on public.foundation_jobs from public, anon, authenticated;
grant select, insert, update on public.foundation_jobs to service_role;

commit;
