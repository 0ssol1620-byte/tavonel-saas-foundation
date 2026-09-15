-- Run with `supabase test db` after 20260911120200_compile_job_candidate_manifest_digest.sql.
--
-- The column exists so `candidateAwaitingActivation` can be answered from the database instead
-- of only from the request that happens to have loaded the candidate. Three things have to hold
-- for that to be true, and none of them can be seen from the migration text:
--
--   1. the digest the worker passes is what ends up in the row;
--   2. a malformed digest is refused rather than stored, because a freshness block comparing a
--      junk string against the active pointer answers "a candidate is waiting" for ever;
--   3. the later advance that carries no digest does not erase it -- the job reaches `ready`
--      through a second call, and a wiped digest would silently take the flag back to false.
--
-- One job walks the real path a worker walks (lib/compile-job-worker.ts: building_world with the
-- collection id and the digest, then the settling advance with neither). Everything is rolled
-- back.
begin;
select plan(9);

select has_column(
  'public', 'foundation_compile_jobs', 'candidate_manifest_digest',
  'the compile job has somewhere to record the artifact it produced'
);

select is(
  (select created from public.enqueue_foundation_compile_job(
     'cjob-' || repeat('1', 32), 'pilot-digest01',
     '77777777-7777-7777-7777-777777777777', array['doc-001'],
     'digest-fixture-idempotency-key')),
  true,
  'the job under test is created'
);
select is(
  (select candidate_manifest_digest from public.foundation_compile_jobs
    where job_id = 'cjob-' || repeat('1', 32)),
  null::text,
  'a job that has not compiled anything records no digest, rather than a placeholder'
);

select is(
  (select changed from public.advance_foundation_compile_job(
     'cjob-' || repeat('1', 32), 'pilot-digest01', 'building_world', 1,
     'collection-' || repeat('a', 32), null, null, null,
     'sha256:' || repeat('b', 64))),
  true,
  'the advance that carries the digest is applied'
);
select is(
  (select candidate_manifest_digest from public.foundation_compile_jobs
    where job_id = 'cjob-' || repeat('1', 32)),
  'sha256:' || repeat('b', 64),
  'the digest the worker passed is the digest the row holds'
);

-- 23514 is a CHECK violation, and it is the SQLSTATE rather than a message because the
-- constraint name is not part of any contract. throws_ok runs the statement in a subtransaction,
-- so the refusal leaves the digest above untouched -- which the last assertion then re-reads.
select throws_ok(
  $$select public.advance_foundation_compile_job(
      'cjob-' || repeat('1', 32), 'pilot-digest01', 'building_world', 1,
      null, null, null, null, 'not-a-digest')$$,
  '23514',
  null,
  'a digest that is not a sha256 is refused by the column, not stored for a reader to trip over'
);

-- Deploy order, asserted rather than assumed (integration stage-B repair, 2026-09-11).
--
-- The worker that is running in production when this migration is applied sends eight named
-- arguments, because the ninth is added by the release that follows. The ninth parameter's
-- `default null` is the whole of what keeps that call resolving instead of answering PGRST202
-- and stalling the compile queue, and a later edit that drops the default would not be visible
-- in any other assertion here -- every other call in this fixture passes all nine.
--
-- Eight positional arguments, ending at p_queue_job_id, is exactly the shape PostgREST builds
-- from the deployed worker's body. 'review_required' is forward of 'building_world' and short of
-- the settling advance below, so this lands as a real state change rather than as a refusal.
select is(
  (select changed from public.advance_foundation_compile_job(
     'cjob-' || repeat('1', 32), 'pilot-digest01', 'review_required', 1,
     'collection-' || repeat('a', 32), null, null, null)),
  true,
  'the eight-argument call the deployed worker makes still resolves after the ninth is added'
);

select is(
  (select changed from public.advance_foundation_compile_job(
     'cjob-' || repeat('1', 32), 'pilot-digest01', 'ready', 1,
     'collection-' || repeat('a', 32))),
  true,
  'the settling advance is applied'
);
select is(
  (select candidate_manifest_digest from public.foundation_compile_jobs
    where job_id = 'cjob-' || repeat('1', 32)),
  'sha256:' || repeat('b', 64),
  'an advance with no digest leaves the recorded one alone instead of nulling it'
);

select * from finish();
rollback;
