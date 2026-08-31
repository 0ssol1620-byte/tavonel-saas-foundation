-- attempt counts consecutive failed claims, not successfully completed pages. Reset it after
-- every committed progress batch so a large healthy corpus does not consume its retry budget.
begin;

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

  if v_job.state <> 'leased' or v_job.leased_by is distinct from p_worker_id then
    raise exception 'foundation_job_lease_not_held';
  end if;

  if p_outcome = 'progress' then
    update public.foundation_jobs
    set state = 'queued',
        attempt = 0,
        items_seen = items_seen + greatest(coalesce(p_items_seen_delta, 0), 0),
        items_done = items_done + greatest(coalesce(p_items_done_delta, 0), 0),
        cursor_token = coalesce(p_cursor_token, cursor_token),
        leased_by = null,
        lease_expires_at = null,
        available_at = now(),
        error_code = null,
        error_detail = null,
        updated_at = now()
    where workspace_key = p_workspace_key and job_id = p_job_id;
    return jsonb_build_object('state', 'queued');
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
    v_next_state := 'dead';
  else
    v_next_state := 'queued';
  end if;

  v_backoff := least(power(2, least(v_job.attempt, 10))::integer, 900);

  update public.foundation_jobs
  set state = v_next_state,
      items_seen = items_seen + greatest(coalesce(p_items_seen_delta, 0), 0),
      items_done = items_done + greatest(coalesce(p_items_done_delta, 0), 0),
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

revoke all on function public.complete_foundation_job_batch(text, text, text, text, integer, integer, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.complete_foundation_job_batch(text, text, text, text, integer, integer, text, integer, text, text) to service_role;

commit;
