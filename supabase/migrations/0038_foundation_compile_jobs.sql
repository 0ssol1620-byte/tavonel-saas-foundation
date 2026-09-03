-- Durable, server-owned compile orchestration.
--
-- What this replaces: the browser uploaded, then polled the document list every 1.5 seconds
-- for up to fifteen minutes, and when every document reported an immutable OCR output the
-- browser itself called /api/collections/compile. Closing the tab abandoned the run after the
-- reading had already been paid for, and nothing anywhere recorded that a compile had been
-- intended. Masterplan 6.3 puts that state machine on the server; this table is where it lives.
--
-- Why a second table rather than another job_type on foundation_jobs: that queue models
-- execution -- queued, leased, attempts, backoff -- and its states answer "is a worker running
-- this". A customer asks a different question, and 6.4 names the thirteen answers they are
-- allowed to get. Both exist here: this row carries the customer-facing lifecycle, and it
-- points at the queue job that does the work, so neither has to pretend to be the other.
begin;

create type public.foundation_compile_state as enum (
  'draft',
  'preflight',
  'awaiting_confirmation',
  'uploading',
  'sanitizing',
  'reading',
  'structuring',
  'resolving',
  'building_world',
  'review_required',
  'ready',
  'failed',
  'cancelled'
);

create table public.foundation_compile_jobs (
  job_id text primary key check (job_id ~ '^cjob-[a-f0-9]{32}$'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  created_by_user_id uuid not null,

  -- The document set is the job's identity. Order does not matter to the compiler and must
  -- not matter here either, so the application sorts before hashing into idempotency_key.
  --
  -- The bound is structural, not the product limit. COMPILE_MAX_DOCUMENTS in
  -- lib/compile-limits.ts is the single authority on how many sources a compile accepts, and
  -- writing 12 here as well would recreate the exact defect this branch spent a pass removing:
  -- one limit, spelled in three places, disagreeing with itself. This check exists so a bug
  -- cannot enqueue an unbounded array.
  document_ids text[] not null check (
    cardinality(document_ids) between 1 and 1000
    and array_position(document_ids, null) is null
  ),

  -- Two submissions of the same document set by the same workspace are one job. Without this
  -- a double-clicked button, a retried fetch or an at-least-once delivery starts a second
  -- compile of the same sources and bills for both.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),

  state public.foundation_compile_state not null default 'draft',
  collection_id text check (collection_id is null or collection_id ~ '^collection-[a-f0-9]{32}$'),

  -- The queue row actually doing the work, once one exists.
  queue_job_id text check (queue_job_id is null or queue_job_id ~ '^job-[a-f0-9]{32}$'),

  -- Machine-readable failure, never a sentence. The UI owns the wording.
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),

  -- Masterplan 6.5. Per-document blockers, so the customer is offered "continue with 124"
  -- rather than told the batch failed. Bounded, and it may not carry a credential.
  blocked jsonb not null default '[]'::jsonb check (
    jsonb_typeof(blocked) = 'array'
    and octet_length(blocked::text) <= 16384
  ),

  -- Masterplan 6.5's decision point, recorded rather than inferred.
  --
  -- A job with blockers stops and waits. The worker never resolves them itself, which is the
  -- whole point: silently compiling 124 of 128 and reporting success is how a customer ends
  -- up trusting a World that is missing four documents they never heard about again.
  --
  -- 'continue' is the low-friction answer and is refused when any blocker is a security
  -- blocker; those may only leave the set through 'remove_blocked', which is an explicit act
  -- naming the files and leaving an actor and a timestamp behind.
  blocked_resolution text check (
    blocked_resolution is null
    or blocked_resolution in ('continue', 'remove_blocked', 'retry_eligible')
  ),
  blocked_resolved_at timestamptz,
  blocked_resolved_by uuid,

  documents_total integer not null check (documents_total >= 0),
  documents_ready integer not null default 0 check (documents_ready >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set once the row reaches a terminal state, so a sweeper can find abandoned work.
  settled_at timestamptz,

  constraint foundation_compile_jobs_ready_within_total
    check (documents_ready <= documents_total),
  constraint foundation_compile_jobs_terminal_is_settled
    check ((state in ('ready', 'failed', 'cancelled')) = (settled_at is not null)),
  constraint foundation_compile_jobs_ready_has_collection
    check (state <> 'ready' or collection_id is not null),
  -- A decision without an actor is not a decision anyone can be shown later.
  constraint foundation_compile_jobs_resolution_is_attributed
    check ((blocked_resolution is null) = (blocked_resolved_at is null)
       and (blocked_resolution is null) = (blocked_resolved_by is null))
);

create unique index foundation_compile_jobs_idempotency_idx
  on public.foundation_compile_jobs (workspace_key, idempotency_key);

-- The customer's own list, newest first.
create index foundation_compile_jobs_workspace_idx
  on public.foundation_compile_jobs (workspace_key, created_at desc);

-- What a worker asks for: anything not finished.
create index foundation_compile_jobs_open_idx
  on public.foundation_compile_jobs (state, updated_at)
  where state not in ('ready', 'failed', 'cancelled');

-- Append-only transition log. This is what a reconnecting client replays from, which is why
-- the sequence is monotonic per job: it is the Last-Event-ID an SSE consumer sends back.
create table public.foundation_compile_job_events (
  event_sequence bigint generated always as identity,
  job_id text not null references public.foundation_compile_jobs (job_id) on delete cascade,
  workspace_key text not null,
  event_type text not null check (event_type in ('created', 'state_changed', 'progressed', 'blocked', 'resolved', 'failed', 'completed', 'cancelled')),
  state public.foundation_compile_state not null,
  documents_total integer not null check (documents_total >= 0),
  documents_ready integer not null check (documents_ready >= 0),
  error_code text,
  detail jsonb not null default '{}'::jsonb check (
    jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 8192
  ),
  occurred_at timestamptz not null default now(),
  -- Also the replay index: a reconnecting consumer scans this job's events from a
  -- sequence, which is exactly a prefix scan of this key. A second index would be the same
  -- index under a different name.
  primary key (job_id, event_sequence)
);

create or replace function public.record_foundation_compile_job_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    v_type := 'created';
  elsif new.state = 'cancelled' and new.state is distinct from old.state then
    v_type := 'cancelled';
  elsif new.state = 'failed' and new.state is distinct from old.state then
    v_type := 'failed';
  elsif new.state = 'ready' and new.state is distinct from old.state then
    v_type := 'completed';
  elsif new.state is distinct from old.state then
    v_type := 'state_changed';
  elsif new.blocked_resolution is distinct from old.blocked_resolution and new.blocked_resolution is not null then
    v_type := 'resolved';
  elsif new.blocked is distinct from old.blocked then
    v_type := 'blocked';
  elsif new.documents_ready is distinct from old.documents_ready then
    v_type := 'progressed';
  else
    return new;
  end if;

  insert into public.foundation_compile_job_events (
    job_id, workspace_key, event_type, state, documents_total, documents_ready, error_code, detail
  ) values (
    new.job_id, new.workspace_key, v_type, new.state,
    new.documents_total, new.documents_ready, new.error_code,
    jsonb_build_object(
      'collectionId', new.collection_id,
      'blocked', new.blocked,
      'blockedResolution', new.blocked_resolution
    )
  );
  return new;
end;
$$;

create trigger foundation_compile_jobs_record_event
after insert or update on public.foundation_compile_jobs
for each row execute function public.record_foundation_compile_job_event();

create or replace function public.touch_foundation_compile_job()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger foundation_compile_jobs_touch
before update on public.foundation_compile_jobs
for each row execute function public.touch_foundation_compile_job();

create or replace function public.reject_foundation_compile_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'foundation_compile_job_events is append-only';
end;
$$;

create trigger foundation_compile_job_events_append_only
before update or delete on public.foundation_compile_job_events
for each row execute function public.reject_foundation_compile_event_mutation();

/*
  Enqueue, idempotently.

  Returns the existing row when the same workspace submits the same document set again, so a
  double-clicked button, a retried fetch and an at-least-once redelivery all converge on one
  job instead of three compiles and three charges. The caller cannot tell the difference, and
  should not need to: `created` says which happened, for telemetry only.
*/
create or replace function public.enqueue_foundation_compile_job(
  p_job_id text,
  p_workspace_key text,
  p_created_by_user_id uuid,
  p_document_ids text[],
  p_idempotency_key text
)
returns table (job_id text, state public.foundation_compile_state, created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.foundation_compile_jobs%rowtype;
begin
  select * into v_existing
    from public.foundation_compile_jobs
   where workspace_key = p_workspace_key
     and idempotency_key = p_idempotency_key;

  if found then
    return query select v_existing.job_id, v_existing.state, false;
    return;
  end if;

  insert into public.foundation_compile_jobs (
    job_id, workspace_key, created_by_user_id, document_ids, idempotency_key,
    state, documents_total
  ) values (
    p_job_id, p_workspace_key, p_created_by_user_id, p_document_ids, p_idempotency_key,
    'preflight', cardinality(p_document_ids)
  );

  return query select p_job_id, 'preflight'::public.foundation_compile_state, true;
end;
$$;

/*
  Advance a job, and refuse to move it backwards or out of a terminal state.

  A worker runs at-least-once: the same advance can arrive twice, and a redelivery of an
  older message can arrive after a newer one. Ordering is enforced here rather than in the
  worker, because only the database sees every writer.
*/
create or replace function public.advance_foundation_compile_job(
  p_job_id text,
  p_workspace_key text,
  p_state public.foundation_compile_state,
  p_documents_ready integer default null,
  p_collection_id text default null,
  p_error_code text default null,
  p_blocked jsonb default null,
  p_queue_job_id text default null
)
returns table (job_id text, state public.foundation_compile_state, changed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.foundation_compile_jobs%rowtype;
  v_rank_current integer;
  v_rank_next integer;
  v_order public.foundation_compile_state[] := array[
    'draft', 'preflight', 'awaiting_confirmation', 'uploading', 'sanitizing', 'reading',
    'structuring', 'resolving', 'building_world', 'review_required', 'ready'
  ]::public.foundation_compile_state[];
begin
  select * into v_row
    from public.foundation_compile_jobs
   where foundation_compile_jobs.job_id = p_job_id
     and foundation_compile_jobs.workspace_key = p_workspace_key
   for update;

  if not found then
    return;
  end if;

  -- Terminal is terminal. A late redelivery cannot resurrect a cancelled or finished job.
  if v_row.state in ('ready', 'failed', 'cancelled') then
    return query select v_row.job_id, v_row.state, false;
    return;
  end if;

  -- 'failed' and 'cancelled' may be reached from anywhere; forward progress may not go back.
  if p_state not in ('failed', 'cancelled') then
    v_rank_current := array_position(v_order, v_row.state);
    v_rank_next := array_position(v_order, p_state);
    if v_rank_current is not null and v_rank_next is not null and v_rank_next < v_rank_current then
      return query select v_row.job_id, v_row.state, false;
      return;
    end if;
  end if;

  update public.foundation_compile_jobs
     set state = p_state,
         documents_ready = coalesce(p_documents_ready, documents_ready),
         collection_id = coalesce(p_collection_id, collection_id),
         error_code = case when p_state = 'failed' then coalesce(p_error_code, error_code) else null end,
         blocked = coalesce(p_blocked, blocked),
         queue_job_id = coalesce(p_queue_job_id, queue_job_id),
         settled_at = case when p_state in ('ready', 'failed', 'cancelled') then now() else null end
   where foundation_compile_jobs.job_id = p_job_id
     and foundation_compile_jobs.workspace_key = p_workspace_key;

  return query select p_job_id, p_state, true;
end;
$$;

/*
  Record the customer's answer to a partial failure (masterplan 6.5).

  The four offers -- continue with what read cleanly, remove the blocked files, retry the ones
  that can be retried, cancel -- are three writes here plus the cancel path in
  advance_foundation_compile_job. What this function will not do is let 'continue' past a
  security blocker. An encrypted archive, a nested archive or a file that failed sanitation
  leaves the set only through 'remove_blocked', which names it and leaves an actor behind; a
  one-click "continue" that quietly drops it is precisely the auto-skip 6.5 forbids.

  'retry_eligible' clears the input blockers and leaves the job where it was, so the worker
  looks at those documents again on its next turn. It refuses to clear a security blocker,
  because retrying a file that failed sanitation is not a recovery, it is a second attempt at
  the same rejection.
*/
create or replace function public.resolve_foundation_compile_job_blockers(
  p_job_id text,
  p_workspace_key text,
  p_actor_user_id uuid,
  p_resolution text
)
returns table (job_id text, state public.foundation_compile_state, blocked jsonb, applied boolean, refusal text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.foundation_compile_jobs%rowtype;
  v_security integer;
  v_remaining jsonb;
begin
  if p_resolution not in ('continue', 'remove_blocked', 'retry_eligible') then
    return query select p_job_id, null::public.foundation_compile_state, null::jsonb, false, 'RESOLUTION_UNKNOWN';
    return;
  end if;

  select * into v_row
    from public.foundation_compile_jobs
   where foundation_compile_jobs.job_id = p_job_id
     and foundation_compile_jobs.workspace_key = p_workspace_key
   for update;

  if not found then
    return;
  end if;

  if v_row.state in ('ready', 'failed', 'cancelled') then
    return query select v_row.job_id, v_row.state, v_row.blocked, false, 'JOB_ALREADY_SETTLED';
    return;
  end if;

  if jsonb_array_length(v_row.blocked) = 0 then
    return query select v_row.job_id, v_row.state, v_row.blocked, false, 'NO_BLOCKERS';
    return;
  end if;

  select count(*) into v_security
    from jsonb_array_elements(v_row.blocked) as entry
   where entry ->> 'kind' = 'security';

  if v_security > 0 and p_resolution = 'continue' then
    return query select v_row.job_id, v_row.state, v_row.blocked, false, 'SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL';
    return;
  end if;

  if p_resolution = 'retry_eligible' then
    -- Keep the security blockers; drop the ordinary ones so the worker re-examines them.
    select coalesce(jsonb_agg(entry), '[]'::jsonb) into v_remaining
      from jsonb_array_elements(v_row.blocked) as entry
     where entry ->> 'kind' = 'security';

    update public.foundation_compile_jobs
       set blocked = v_remaining,
           blocked_resolution = null,
           blocked_resolved_at = null,
           blocked_resolved_by = null
     where foundation_compile_jobs.job_id = p_job_id
       and foundation_compile_jobs.workspace_key = p_workspace_key;

    return query select p_job_id, v_row.state, v_remaining, true, null::text;
    return;
  end if;

  update public.foundation_compile_jobs
     set blocked_resolution = p_resolution,
         blocked_resolved_at = now(),
         blocked_resolved_by = p_actor_user_id
   where foundation_compile_jobs.job_id = p_job_id
     and foundation_compile_jobs.workspace_key = p_workspace_key;

  return query select p_job_id, v_row.state, v_row.blocked, true, null::text;
end;
$$;

alter table public.foundation_compile_jobs enable row level security;
alter table public.foundation_compile_job_events enable row level security;
revoke all on public.foundation_compile_jobs from public, anon, authenticated;
revoke all on public.foundation_compile_job_events from public, anon, authenticated;
grant select, insert, update on public.foundation_compile_jobs to service_role;
grant select, insert on public.foundation_compile_job_events to service_role;
revoke all on function public.record_foundation_compile_job_event() from public, anon, authenticated;
revoke all on function public.touch_foundation_compile_job() from public, anon, authenticated;
revoke all on function public.reject_foundation_compile_event_mutation() from public, anon, authenticated;
revoke all on function public.enqueue_foundation_compile_job(text, text, uuid, text[], text) from public, anon, authenticated;
revoke all on function public.advance_foundation_compile_job(text, text, public.foundation_compile_state, integer, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.enqueue_foundation_compile_job(text, text, uuid, text[], text) to service_role;
grant execute on function public.advance_foundation_compile_job(text, text, public.foundation_compile_state, integer, text, text, jsonb, text) to service_role;
revoke all on function public.resolve_foundation_compile_job_blockers(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_foundation_compile_job_blockers(text, text, uuid, text) to service_role;

commit;
