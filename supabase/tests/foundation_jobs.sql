-- Run with Supabase CLI db test after 0025_foundation_job_rpc.sql.
--
-- The job layer's correctness is entirely about concurrency and failure, which static
-- assertions on the migration text cannot reach. Everything here executes the real RPCs
-- against real rows: a second worker must not claim a leased job, an expired lease must be
-- reclaimable, a stale worker must not be able to advance a cursor it no longer owns, and a
-- retry must back off rather than spin.
begin;
select plan(27);

-- ---------------------------------------------------------------------------------------
-- Shape and security
-- ---------------------------------------------------------------------------------------
select has_table('public', 'foundation_jobs', 'jobs table exists');
select has_function('public', 'enqueue_foundation_job', 'enqueue RPC exists');
select has_function('public', 'claim_foundation_job', 'claim RPC exists');
select has_function('public', 'complete_foundation_job_batch', 'batch completion RPC exists');
select ok(
  not has_function_privilege('anon', 'public.claim_foundation_job(text, integer, public.foundation_job_type[])', 'execute'),
  'anon cannot claim jobs'
);
select ok(
  not has_table_privilege('authenticated', 'public.foundation_jobs', 'select'),
  'authenticated cannot read the jobs table directly'
);

-- ---------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88888888-8888-8888-8888-888888888888',
  'authenticated', 'authenticated', 'jobs-fixture@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

-- ---------------------------------------------------------------------------------------
-- Enqueue and deduplication
-- ---------------------------------------------------------------------------------------
select is(
  (select public.enqueue_foundation_job(
    'job-' || repeat('a', 32), 'pilot-jobstest1', 'source_scan',
    'scan:conn-1', '88888888-8888-8888-8888-888888888888') ->> 'created'),
  'true',
  'first enqueue creates the job'
);

select is(
  (select public.enqueue_foundation_job(
    'job-' || repeat('b', 32), 'pilot-jobstest1', 'source_scan',
    'scan:conn-1', '88888888-8888-8888-8888-888888888888') ->> 'job_id'),
  'job-' || repeat('a', 32),
  'a duplicate enqueue collapses onto the live job instead of creating a second'
);

select is(
  (select count(*)::integer from public.foundation_jobs where workspace_key = 'pilot-jobstest1'),
  1,
  'only one job row exists after the duplicate enqueue'
);

select throws_ok(
  $$select public.enqueue_foundation_job(
      'not-a-job-id', 'pilot-jobstest1', 'source_scan', 'scan:x',
      '88888888-8888-8888-8888-888888888888')$$,
  'foundation_job_id_invalid',
  'a malformed job id is rejected'
);

select throws_ok(
  $$select public.enqueue_foundation_job(
      'job-' || repeat('c', 32), 'not-a-workspace', 'source_scan', 'scan:y',
      '88888888-8888-8888-8888-888888888888')$$,
  'foundation_job_workspace_invalid',
  'a malformed workspace key is rejected'
);

-- ---------------------------------------------------------------------------------------
-- Claiming
-- ---------------------------------------------------------------------------------------
select is(
  (select public.claim_foundation_job('worker-1', 120) ->> 'job_id'),
  'job-' || repeat('a', 32),
  'a worker claims the queued job'
);

select is(
  (select state::text from public.foundation_jobs where job_id = 'job-' || repeat('a', 32)),
  'leased',
  'the claimed job is leased'
);

select is(
  (select attempt from public.foundation_jobs where job_id = 'job-' || repeat('a', 32)),
  1,
  'claiming increments the attempt counter'
);

-- The central concurrency guarantee: nobody else may take a live lease.
select is(
  (select public.claim_foundation_job('worker-2', 120) ->> 'claimed'),
  'false',
  'a second worker cannot claim a job whose lease is still live'
);

-- ---------------------------------------------------------------------------------------
-- Lease ownership
-- ---------------------------------------------------------------------------------------
select throws_ok(
  $$select public.complete_foundation_job_batch(
      'pilot-jobstest1', 'job-' || repeat('a', 32), 'worker-2', 'progress', 10, 10, 'stolen-cursor')$$,
  'foundation_job_lease_not_held',
  'a worker that does not hold the lease cannot report progress or move the cursor'
);

select is(
  (select cursor_token from public.foundation_jobs where job_id = 'job-' || repeat('a', 32)),
  null,
  'the rejected write left the cursor untouched'
);

-- ---------------------------------------------------------------------------------------
-- Batch progress
-- ---------------------------------------------------------------------------------------
select is(
  (select public.complete_foundation_job_batch(
    'pilot-jobstest1', 'job-' || repeat('a', 32), 'worker-1', 'progress', 200, 180, 'page-token-2') ->> 'state'),
  'leased',
  'a progress batch keeps the lease'
);

select is(
  (select cursor_token from public.foundation_jobs where job_id = 'job-' || repeat('a', 32)),
  'page-token-2',
  'the cursor advanced with the batch that earned it'
);

select is(
  (select items_seen || '/' || items_done from public.foundation_jobs where job_id = 'job-' || repeat('a', 32)),
  '200/180',
  'progress counters accumulate'
);

-- ---------------------------------------------------------------------------------------
-- Retry and backoff
-- ---------------------------------------------------------------------------------------
select is(
  (select public.complete_foundation_job_batch(
    'pilot-jobstest1', 'job-' || repeat('a', 32), 'worker-1', 'retry', 0, 0, null, 120, 'PROVIDER_RATE_LIMIT') ->> 'state'),
  'queued',
  'a transient failure requeues the job'
);

select ok(
  (select available_at > now() from public.foundation_jobs where job_id = 'job-' || repeat('a', 32)),
  'the requeued job is scheduled into the future, not retried immediately'
);

select is(
  (select cursor_token from public.foundation_jobs where job_id = 'job-' || repeat('a', 32)),
  'page-token-2',
  'a retry resumes from the last committed cursor rather than restarting'
);

select throws_ok(
  $$select public.complete_foundation_job_batch(
      'pilot-jobstest1', 'job-' || repeat('a', 32), 'worker-1', 'retry')$$,
  'foundation_job_lease_not_held',
  'a released job cannot be reported on again'
);

-- ---------------------------------------------------------------------------------------
-- Expired lease reclaim
-- ---------------------------------------------------------------------------------------
insert into public.foundation_jobs (
  job_id, workspace_key, job_type, idempotency_key, created_by,
  state, leased_by, lease_expires_at, available_at
) values (
  'job-' || repeat('d', 32), 'pilot-jobstest1', 'source_import', 'import:conn-1',
  '88888888-8888-8888-8888-888888888888',
  'leased', 'dead-worker', now() - interval '1 minute', now() - interval '5 minutes'
);

select is(
  (select public.claim_foundation_job('worker-3', 120, array['source_import']::public.foundation_job_type[]) ->> 'job_id'),
  'job-' || repeat('d', 32),
  'a job whose lease expired is reclaimable, so a crashed worker cannot strand it'
);

select is(
  (select leased_by from public.foundation_jobs where job_id = 'job-' || repeat('d', 32)),
  'worker-3',
  'the reclaimed job belongs to the new worker'
);

-- ---------------------------------------------------------------------------------------
-- Payload safety
-- ---------------------------------------------------------------------------------------
select throws_ok(
  $$insert into public.foundation_jobs (
      job_id, workspace_key, job_type, idempotency_key, created_by, payload
    ) values (
      'job-' || repeat('e', 32), 'pilot-jobstest1', 'source_scan', 'scan:secret',
      '88888888-8888-8888-8888-888888888888',
      '{"access_token":"ya29.secret"}'::jsonb
    )$$,
  'new row for relation "foundation_jobs" violates check constraint "foundation_jobs_payload_check"',
  'a credential-shaped payload is refused at the schema level'
);

select * from finish();
rollback;
