-- The compile job records the manifest digest it produced, so "a newer World is waiting for a
-- person" is a fact in the database rather than something only the current request can see.
--
-- Evidence: `nextjs/lib/world-store.ts` `getWorldFreshness` and its own docstring, plus the
-- `/docs` sentence generated from it (`nextjs/lib/docs-content.ts`): "`candidateAwaitingActivation`
-- is also conservative: it is computed from versions the workspace has promoted at least once
-- plus the candidate this request already loaded, so it can read false while an unpromoted
-- candidate exists that this request did not see." That is exactly the gap. A compile that
-- finished and is waiting for approval writes its artifact to object storage and the job row to
-- `foundation_compile_jobs`, and the digest of that artifact -- the one thing that identifies
-- the candidate -- was nowhere in the database. `foundation_world_versions` only learns a digest
-- at promotion, which is the event the flag is supposed to be waiting for.
--
-- So: one nullable column, written by the only writer the job lifecycle has
-- (`advance_foundation_compile_job`, called from `lib/compile-job-worker.ts` with
-- `run.payload.manifestDigest`), read by the freshness block. Nullable because every job that
-- already exists has no digest and no backfill can invent one -- a compile that ran before this
-- migration keeps reading as it does today rather than being given a value nobody measured.
--
-- Why the function is dropped and recreated rather than replaced: a ninth parameter with a
-- DEFAULT does not replace the eight-parameter function, it creates a second overload, and a
-- PostgREST call by named arguments would then be ambiguous (42725). Dropping also drops the
-- ACL, so 0038's revoke/grant pair is restated below -- not a new privilege, the same one.
--
-- Re-runnable: `add column if not exists`, `drop constraint if exists` before the check,
-- `drop function if exists` on the old signature, `create or replace` on the new one.
begin;

alter table public.foundation_compile_jobs
  add column if not exists candidate_manifest_digest text;
alter table public.foundation_compile_jobs
  drop constraint if exists foundation_compile_jobs_candidate_digest_shape;
alter table public.foundation_compile_jobs
  add constraint foundation_compile_jobs_candidate_digest_shape check (
    candidate_manifest_digest is null
    or candidate_manifest_digest ~ '^sha256:[a-f0-9]{64}$'
  );

comment on column public.foundation_compile_jobs.candidate_manifest_digest is
  'Digest of the candidate artifact this job produced, once it has produced one. Null on every job that predates the column and on every job that has not reached building_world. Never a promotion record: foundation_world_versions is still the only place a promoted digest lives.';

drop function if exists public.advance_foundation_compile_job(
  text, text, public.foundation_compile_state, integer, text, text, jsonb, text);

create or replace function public.advance_foundation_compile_job(
  p_job_id text,
  p_workspace_key text,
  p_state public.foundation_compile_state,
  p_documents_ready integer default null,
  p_collection_id text default null,
  p_error_code text default null,
  p_blocked jsonb default null,
  p_queue_job_id text default null,
  p_candidate_manifest_digest text default null
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
         -- Same rule as collection_id: an advance that does not carry a digest does not erase
         -- the one the compile already recorded, and an advance that carries a new one replaces
         -- it, because a job that recompiled produced a different artifact.
         candidate_manifest_digest = coalesce(p_candidate_manifest_digest, candidate_manifest_digest),
         settled_at = case when p_state in ('ready', 'failed', 'cancelled') then now() else null end
   where foundation_compile_jobs.job_id = p_job_id
     and foundation_compile_jobs.workspace_key = p_workspace_key;

  return query select p_job_id, p_state, true;
end;
$$;

revoke all on function public.advance_foundation_compile_job(
  text, text, public.foundation_compile_state, integer, text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.advance_foundation_compile_job(
  text, text, public.foundation_compile_state, integer, text, text, jsonb, text, text)
  to service_role;

commit;
