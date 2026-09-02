-- Append-only run events. Job state remains the authority; this ledger records every
-- observable transition so reconnecting clients can replay rather than infer progress.
begin;

create table public.foundation_job_events (
  event_sequence bigint generated always as identity,
  workspace_key text not null,
  job_id text not null,
  event_type text not null check (event_type in ('enqueued', 'state_changed', 'progressed', 'attempted', 'failed', 'completed')),
  state public.foundation_job_state not null,
  attempt integer not null check (attempt >= 0),
  items_seen integer not null check (items_seen >= 0),
  items_done integer not null check (items_done >= 0 and items_done <= items_seen),
  error_code text,
  occurred_at timestamptz not null default now(),
  primary key (workspace_key, job_id, event_sequence),
  foreign key (workspace_key, job_id)
    references public.foundation_jobs (workspace_key, job_id) on delete restrict
);

create index foundation_job_events_replay_idx
  on public.foundation_job_events (workspace_key, job_id, event_sequence);

create or replace function public.record_foundation_job_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    v_type := 'enqueued';
  elsif new.state in ('succeeded', 'canceled') and new.state is distinct from old.state then
    v_type := 'completed';
  elsif new.state in ('failed', 'dead') and new.state is distinct from old.state then
    v_type := 'failed';
  elsif new.state is distinct from old.state then
    v_type := 'state_changed';
  elsif new.attempt is distinct from old.attempt then
    v_type := 'attempted';
  elsif new.items_seen is distinct from old.items_seen or new.items_done is distinct from old.items_done then
    v_type := 'progressed';
  else
    return new;
  end if;

  insert into public.foundation_job_events (
    workspace_key, job_id, event_type, state, attempt, items_seen, items_done, error_code
  ) values (
    new.workspace_key, new.job_id, v_type, new.state, new.attempt,
    new.items_seen, new.items_done, new.error_code
  );
  return new;
end;
$$;

create trigger foundation_jobs_record_event
after insert or update on public.foundation_jobs
for each row execute function public.record_foundation_job_event();

create or replace function public.reject_foundation_job_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'foundation_job_events is append-only';
end;
$$;

create trigger foundation_job_events_append_only
before update or delete on public.foundation_job_events
for each row execute function public.reject_foundation_job_event_mutation();

alter table public.foundation_job_events enable row level security;
revoke all on public.foundation_job_events from public, anon, authenticated;
grant select, insert on public.foundation_job_events to service_role;
revoke all on function public.record_foundation_job_event() from public, anon, authenticated;
revoke all on function public.reject_foundation_job_event_mutation() from public, anon, authenticated;

commit;

