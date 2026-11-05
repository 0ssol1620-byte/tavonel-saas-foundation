-- Terminal is the last word in a compile job's event log.
--
-- cjob-157f2f236a3efc6984585b399852c60d (2026-11-05): seq 158 was `failed`, and seq 159 -- a
-- `structuring` size row a duplicate runner appended 17 s later -- was the last frame the
-- workspace applied, so it showed "Structuring what was read." over a settled job.
-- advance_foundation_compile_job already refuses to move a terminal row; the event table had
-- no such rule, and recordCompileJobDeferral / recordCompileJobSizeLimit insert into it directly.
--
-- Now, on every write path into foundation_compile_job_events: once the job is ready, failed or
-- cancelled, a row whose state differs from that terminal state is refused with
-- `compile_job_post_terminal_event`. The terminal transition's own row (written by
-- record_foundation_compile_job_event inside the same UPDATE) carries the terminal state and
-- passes. FOR SHARE waits for an in-flight transition to commit, so a row cannot slip in behind
-- a `failed` that was being written at the same moment.
--
-- Deploy order is free: the application treats the refusal as an unrecorded event, and without
-- this migration it simply is not refused. Re-runnable: create or replace, drop trigger if exists.
begin;

create or replace function public.refuse_foundation_compile_post_terminal_event()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_state public.foundation_compile_state;
begin
  select state into v_state
    from public.foundation_compile_jobs
   where job_id = new.job_id
     for share;
  if v_state in ('ready', 'failed', 'cancelled') and new.state is distinct from v_state then
    raise exception 'compile_job_post_terminal_event';
  end if;
  return new;
end;
$$;

drop trigger if exists foundation_compile_job_events_post_terminal on public.foundation_compile_job_events;
create trigger foundation_compile_job_events_post_terminal
  before insert on public.foundation_compile_job_events
  for each row
  execute function public.refuse_foundation_compile_post_terminal_event();

revoke all on function public.refuse_foundation_compile_post_terminal_event()
  from public, anon, authenticated, service_role;

commit;
