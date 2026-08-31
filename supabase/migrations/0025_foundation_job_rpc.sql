-- Atomic job claim and completion.
--
-- Claiming has to be one statement. A read-then-write claim ("select a queued job, then
-- update it to leased") lets two workers read the same row before either writes, and both
-- proceed to import the same files -- the duplicate-document failure this whole design
-- exists to prevent. `for update skip locked` makes the claim atomic and lets concurrent
-- workers pass over each other's rows instead of serialising behind them.
--
-- The same reason the search RPCs exist (0023) applies here: the application reaches
-- Postgres only through PostgREST, so a multi-statement transaction is not available to it.
-- These functions are that transaction.
begin;

-- Enqueue, deduplicating on (workspace_key, idempotency_key) against live jobs.
--
-- Returns the existing job id when one is already queued or leased for the same key, so a
-- double-clicked "Import" produces one job and the second caller learns which. That is why
-- it returns the id rather than a boolean: the caller needs to poll something either way.
create or replace function public.enqueue_foundation_job(
  p_job_id text,
  p_workspace_key text,
  p_job_type public.foundation_job_type,
  p_idempotency_key text,
  p_created_by uuid,
  p_oauth_connection_id uuid default null,
  p_collection_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if p_job_id !~ '^job-[a-f0-9]{32}$' then
    raise exception 'foundation_job_id_invalid';
  end if;
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' then
    raise exception 'foundation_job_workspace_invalid';
  end if;

  select job_id into v_existing
  from public.foundation_jobs
  where workspace_key = p_workspace_key
    and idempotency_key = p_idempotency_key
    and state in ('queued', 'leased')
  limit 1;

  if v_existing is not null then
    return jsonb_build_object('job_id', v_existing, 'created', false);
  end if;

  insert into public.foundation_jobs (
    job_id, workspace_key, job_type, idempotency_key, created_by,
    oauth_connection_id, collection_id, payload
  ) values (
    p_job_id, p_workspace_key, p_job_type, p_idempotency_key, p_created_by,
    p_oauth_connection_id, p_collection_id, coalesce(p_payload, '{}'::jsonb)
  );

  return jsonb_build_object('job_id', p_job_id, 'created', true);
end;
$$;

-- Claim one eligible job atomically.
--
-- Eligible means: queued and due, OR leased with an expired lease. The second case is how a
-- job recovers from a worker that died mid-batch -- without it, a crash would strand the job
-- in 'leased' forever. Reclaiming increments attempt, so a job that repeatedly kills its
-- worker still walks toward 'dead' instead of looping.
create or replace function public.claim_foundation_job(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_job_types public.foundation_job_type[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.foundation_jobs%rowtype;
begin
  if p_worker_id is null or char_length(p_worker_id) not between 1 and 100 then
    raise exception 'foundation_job_worker_invalid';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 10 and 900 then
    raise exception 'foundation_job_lease_out_of_bounds';
  end if;

  select * into v_job
  from public.foundation_jobs
  where (
      (state = 'queued' and available_at <= now())
      or (state = 'leased' and lease_expires_at < now())
    )
    and (p_job_types is null or job_type = any(p_job_types))
  order by available_at asc, created_at asc
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  update public.foundation_jobs
  set state = 'leased',
      leased_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt = attempt + 1,
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where workspace_key = v_job.workspace_key and job_id = v_job.job_id;

  return jsonb_build_object(
    'claimed', true,
    'job_id', v_job.job_id,
    'workspace_key', v_job.workspace_key,
    'job_type', v_job.job_type,
    'attempt', v_job.attempt + 1,
    'max_attempts', v_job.max_attempts,
    'oauth_connection_id', v_job.oauth_connection_id,
    'collection_id', v_job.collection_id,
    'payload', v_job.payload,
    'cursor_token', v_job.cursor_token,
    'items_seen', v_job.items_seen,
    'items_done', v_job.items_done
  );
end;
$$;

-- Commit one batch of progress and either keep the lease or release the job.
--
-- The cursor advance happens HERE, in the same statement that records the batch's progress,
-- and only ever moves forward on a batch the caller has already durably admitted. That is
-- the lost-update guard: a worker that scanned a page but crashed before admitting its rows
-- never reaches this call, so the cursor stays where it was and the page is re-read.
--
-- p_outcome:
--   'progress'  - batch done, more work remains; lease extended
--   'succeeded' - job complete
--   'retry'     - transient failure; requeued with backoff, or 'dead' at max_attempts
--   'failed'    - permanent failure; terminal immediately, no retry
create or replace function public.complete_foundation_job_batch(
  p_workspace_key text,
  p_job_id text,
  p_worker_id text,
  p_outcome text,
  p_items_seen_delta integer default 0,
  p_items_done_delta integer default 0,
  p_cursor_token text default null,
  p_lease_seconds integer default 120,
  p_error_code text default null,
  p_error_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.foundation_jobs%rowtype;
  v_backoff integer;
  v_next_state public.foundation_job_state;
begin
  if p_outcome not in ('progress', 'succeeded', 'retry', 'failed') then
    raise exception 'foundation_job_outcome_invalid';
  end if;

  select * into v_job
  from public.foundation_jobs
  where workspace_key = p_workspace_key and job_id = p_job_id
  for update;

  if not found then
    raise exception 'foundation_job_not_found';
  end if;

  -- Only the lease holder may report on a job. A worker whose lease expired and was
  -- reclaimed by someone else must not be able to overwrite the new holder's progress or
  -- advance the cursor from a stale position.
  if v_job.state <> 'leased' or v_job.leased_by is distinct from p_worker_id then
    raise exception 'foundation_job_lease_not_held';
  end if;

  if p_outcome = 'progress' then
    update public.foundation_jobs
    set items_seen = items_seen + greatest(coalesce(p_items_seen_delta, 0), 0),
        items_done = items_done + greatest(coalesce(p_items_done_delta, 0), 0),
        cursor_token = coalesce(p_cursor_token, cursor_token),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    where workspace_key = p_workspace_key and job_id = p_job_id;
    return jsonb_build_object('state', 'leased');
  end if;

  if p_outcome = 'succeeded' then
    update public.foundation_jobs
    set state = 'succeeded',
        items_seen = items_seen + greatest(coalesce(p_items_seen_delta, 0), 0),
        items_done = items_done + greatest(coalesce(p_items_done_delta, 0), 0),
        cursor_token = coalesce(p_cursor_token, cursor_token),
        leased_by = null,
        lease_expires_at = null,
        completed_at = now(),
        updated_at = now()
    where workspace_key = p_workspace_key and job_id = p_job_id;
    return jsonb_build_object('state', 'succeeded');
  end if;

  if p_error_code is null then
    raise exception 'foundation_job_error_code_required';
  end if;

  if p_outcome = 'failed' then
    v_next_state := 'failed';
  elsif v_job.attempt >= v_job.max_attempts then
    -- Out of attempts: park it visibly rather than retrying forever or dropping it.
    v_next_state := 'dead';
  else
    v_next_state := 'queued';
  end if;

  -- Exponential backoff, capped. 2^attempt seconds, ceiling 15 minutes.
  v_backoff := least(power(2, least(v_job.attempt, 10))::integer, 900);

  update public.foundation_jobs
  set state = v_next_state,
      items_seen = items_seen + greatest(coalesce(p_items_seen_delta, 0), 0),
      items_done = items_done + greatest(coalesce(p_items_done_delta, 0), 0),
      -- A retry resumes from the last committed cursor, so partial progress is not lost.
      cursor_token = coalesce(p_cursor_token, cursor_token),
      leased_by = null,
      lease_expires_at = null,
      available_at = case when v_next_state = 'queued' then now() + make_interval(secs => v_backoff) else available_at end,
      error_code = p_error_code,
      error_detail = left(p_error_detail, 500),
      completed_at = case when v_next_state in ('failed', 'dead') then now() else null end,
      updated_at = now()
  where workspace_key = p_workspace_key and job_id = p_job_id;

  return jsonb_build_object('state', v_next_state, 'retry_in_seconds', case when v_next_state = 'queued' then v_backoff else null end);
end;
$$;

revoke all on function public.enqueue_foundation_job(text, text, public.foundation_job_type, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_foundation_job(text, integer, public.foundation_job_type[]) from public, anon, authenticated;
revoke all on function public.complete_foundation_job_batch(text, text, text, text, integer, integer, text, integer, text, text) from public, anon, authenticated;

grant execute on function public.enqueue_foundation_job(text, text, public.foundation_job_type, text, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.claim_foundation_job(text, integer, public.foundation_job_type[]) to service_role;
grant execute on function public.complete_foundation_job_batch(text, text, text, text, integer, integer, text, integer, text, text) to service_role;

commit;
