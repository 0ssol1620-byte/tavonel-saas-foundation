-- Migration 20261105080000, and the compare-and-set lease the worker sends as a PATCH.
--
-- cjob-157f2f23 (2026-11-05): seq 158 `failed`, then seq 159 `structuring` from a duplicate
-- runner that had passed a bare stale-lease clock check. Job J walks to failed and the late row is
-- refused; job K shows that two runners holding the same read of the row take the lease once.
begin;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values ('00000000-0000-0000-0000-000000000000', 'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5', 'authenticated',
  'authenticated', 'post-terminal-event@example.invalid', '$2a$10$fixture', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_intake_admissions (
  workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
  created_at, updated_at, expires_at, confirmed_at
) values ('pilot-d5d5d5d5d5d54d5d', '0d500000-0000-4000-8000-00000000000a', 'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5',
  'quarantine/pilot-d5d5d5d5d5d54d5d/0d500000-0000-4000-8000-00000000000a/source', 10, 'application/pdf',
  now(), now(), now() + interval '10 minutes', now());

insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids,
  idempotency_key, state, documents_total)
values ('cjob-' || repeat('d', 32), 'pilot-d5d5d5d5d5d54d5d', 'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5',
  array['0d500000-0000-4000-8000-00000000000a'], 'post-terminal-j', 'structuring', 1);

-- The shape recordCompileJobSizeLimit / recordCompileJobDeferral POST to the table.
create function pg_temp.size_row(p_job text) returns void language sql as $$
  insert into public.foundation_compile_job_events (job_id, workspace_key, event_type, state, documents_total,
    documents_ready, detail)
  values (p_job, 'pilot-d5d5d5d5d5d54d5d', 'state_changed', 'structuring', 1, 1,
    '{"reason":"JSON_TOO_LARGE","sizeLimit":{"object":"candidate-world.json","bytes":134576916,"bound":33554432}}');
$$;

select ok(exists (select 1 from pg_trigger where tgrelid = 'public.foundation_compile_job_events'::regclass
    and tgname = 'foundation_compile_job_events_post_terminal' and tgenabled = 'O'),
  'the guard sits on the event table, so it covers every writer');

select lives_ok($$select pg_temp.size_row('cjob-' || repeat('d', 32))$$, 'a live job still takes a size row');

select is((select changed from public.advance_foundation_compile_job('cjob-' || repeat('d', 32), 'pilot-d5d5d5d5d5d54d5d',
    'failed', 1, null, 'JSON_TOO_LARGE')), true, 'the job fails');
select is((select count(*)::integer from public.foundation_compile_job_events
   where job_id = 'cjob-' || repeat('d', 32) and event_type = 'failed' and state = 'failed'), 1,
  'and its own terminal row is written');

select throws_ok($$select pg_temp.size_row('cjob-' || repeat('d', 32))$$,
  'P0001', 'compile_job_post_terminal_event', 'a structuring row after failed is refused');
select is((select state::text from public.foundation_compile_job_events where job_id = 'cjob-' || repeat('d', 32)
   order by event_sequence desc limit 1), 'failed', 'so the last event is still failed');
select is((select state::text from public.foundation_compile_jobs where job_id = 'cjob-' || repeat('d', 32)),
  'failed', 'and the job did not move');

-- ---------------------------------------------------------------------------
-- The lease: compare-and-set on the row as read (claimCompileJobLease's PATCH)
-- ---------------------------------------------------------------------------
insert into public.foundation_compile_jobs (job_id, workspace_key, created_by_user_id, document_ids,
  idempotency_key, state, documents_total, updated_at)
values ('cjob-' || repeat('e', 32), 'pilot-d5d5d5d5d5d54d5d', 'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5',
  array['0d500000-0000-4000-8000-00000000000a'], 'post-terminal-k', 'structuring', 1, '2026-11-05 07:11:15.548+00');

create function pg_temp.claim() returns integer language sql as $$
  with leased as (
    update public.foundation_compile_jobs set state = 'structuring', documents_ready = 1
     where job_id = 'cjob-' || repeat('e', 32) and workspace_key = 'pilot-d5d5d5d5d5d54d5d'
       and state = 'structuring' and updated_at = '2026-11-05 07:11:15.548+00'
    returning 1)
  select count(*)::integer from leased;
$$;

select is(pg_temp.claim(), 1, 'the first runner holding the stale read takes the lease');
select is(pg_temp.claim(), 0, 'the second runner holding the same read matches nothing');

select * from finish();
rollback;
