-- Gate 11: a compile job's recorded candidate digest is permanent.
--
-- 20260930010000 finds the Worlds a deleted document was compiled into through one persisted
-- fact: foundation_compile_jobs.candidate_manifest_digest. advance_foundation_compile_job
-- (20260911120200) replaced that value whenever an advance carried a different one, and a
-- same-rank advance is accepted, so a late or redelivered compile turn could move a
-- review_required job from D1 to D2. D1 -- possibly the active World -- then had no job naming
-- it: a later source deletion neither enqueued its candidate-world.json nor invalidated its
-- pointer and units, and the activation guard did not refuse it.
--
-- Now, on every write path (the RPC, a direct UPDATE, anything later): once the column is set
-- it can be neither replaced nor cleared. Writing the same value again is a no-op and passes,
-- so a redelivered advance with the digest it already recorded, and every advance that carries
-- no digest (the RPC coalesces), still moves the job to review_required, ready, failed or
-- cancelled. Only a divergent digest is refused, and the recorded one stays.
--
-- Jobs whose digest was already replaced before this migration are not repaired: the earlier
-- value was never persisted anywhere else (foundation_compile_job_events does not carry it).
--
-- Re-runnable: create or replace, drop trigger if exists.
begin;

create or replace function public.refuse_compile_job_candidate_digest_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'compile_job_candidate_digest_immutable';
end;
$$;

drop trigger if exists foundation_compile_jobs_candidate_digest_immutable on public.foundation_compile_jobs;
create trigger foundation_compile_jobs_candidate_digest_immutable
  before update on public.foundation_compile_jobs
  for each row
  when (old.candidate_manifest_digest is not null
        and new.candidate_manifest_digest is distinct from old.candidate_manifest_digest)
  execute function public.refuse_compile_job_candidate_digest_change();

revoke all on function public.refuse_compile_job_candidate_digest_change()
  from public, anon, authenticated, service_role;

commit;
