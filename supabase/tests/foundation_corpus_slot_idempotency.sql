-- Run with Supabase CLI db test after 0042_corpus_slot_race_revalidation.sql.
--
-- The bug this file exists for could not be seen from the migration text. Both halves were
-- individually right: the document set is a job's identity, and a corpus is partitioned
-- deterministically into compile-sized parts. Together they meant that compiling twelve
-- documents and then including those same twelve as part 0 of a corpus produced one key, and
-- the corpus adopted the standalone job as its first part. The corpus was then short a part
-- that it believed it had, and nothing raised.
--
-- So the scenario is reproduced literally: standalone [1..12], then corpus [1..128] whose
-- first batch is exactly [1..12], then the assertions that they are two different jobs.
begin;
select plan(25);

-- The production key derivation, written once here so the test cannot drift into asserting a
-- key shape the application does not use. Identical to compileIdempotencyKey in
-- lib/compile-job-store.ts and to the backfill expression in 0041.
create function pg_temp.compile_key(
  p_workspace text,
  p_docs text[],
  p_corpus text default null,
  p_batch integer default null
) returns text language sql immutable as $fn$
  select encode(
    sha256(convert_to(
      'compile-identity/2' || E'\n' ||
      case
        when p_corpus is null then 'standalone' || E'\n' || p_workspace
        else 'corpus-part' || E'\n' || p_workspace || E'\n' || p_corpus || E'\n' || p_batch::text
      end || E'\n' ||
      (select string_agg(d, E'\n' order by d) from (select distinct unnest(p_docs) as d) s),
      'UTF8')),
    'hex');
$fn$;

-- [1..12] and [13..24]: the first two batches a 128-document corpus is partitioned into.
create function pg_temp.docs(p_from integer, p_to integer)
returns text[] language sql immutable as $fn$
  select array_agg('doc-' || lpad(n::text, 3, '0') order by n) from generate_series(p_from, p_to) as n;
$fn$;

-- ---------------------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------------------
select has_function('public', 'enqueue_foundation_compile_job', 'enqueue RPC exists');
select ok(
  not has_function_privilege('anon',
    'public.enqueue_foundation_compile_job(text, text, uuid, text[], text, text, integer, integer)', 'execute'),
  'anon cannot enqueue a compile'
);

-- The two namespaces are the reason the collision cannot recur. Asserted on the derivation
-- itself, because every other assertion in this file depends on it being true.
select isnt(
  pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12)),
  pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12), 'corpus-' || repeat('a', 32), 0),
  'the same documents standalone and as a corpus part are different identities'
);
select isnt(
  pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12), 'corpus-' || repeat('a', 32), 0),
  pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12), 'corpus-' || repeat('a', 32), 1),
  'the same documents in two slots of one corpus are different identities'
);
select isnt(
  pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12), 'corpus-' || repeat('a', 32), 0),
  pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12), 'corpus-' || repeat('b', 32), 0),
  'slot zero of two different corpora are different identities'
);
select is(
  pg_temp.compile_key('pilot-slottest01', array['doc-002', 'doc-001', 'doc-002']),
  pg_temp.compile_key('pilot-slottest01', array['doc-001', 'doc-002']),
  'order and duplicates do not change a standalone identity'
);

-- ---------------------------------------------------------------------------------------
-- A. The customer compiles twelve documents on their own.
-- ---------------------------------------------------------------------------------------
select is(
  (select created from public.enqueue_foundation_compile_job(
     'cjob-' || repeat('1', 32), 'pilot-slottest01',
     '77777777-7777-7777-7777-777777777777', pg_temp.docs(1, 12),
     pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12)))),
  true,
  'A: the standalone compile is created');

select is(
  (select created from public.enqueue_foundation_compile_job(
     'cjob-' || repeat('2', 32), 'pilot-slottest01',
     '77777777-7777-7777-7777-777777777777', pg_temp.docs(1, 12),
     pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12)))),
  false,
  'A: resubmitting the same standalone selection is the same job, not a second charge');

-- ---------------------------------------------------------------------------------------
-- B and C. The same twelve documents arrive again as batch 0 of a 128-document corpus.
--
-- This is the regression. Before 0041 the next call returned created = false and handed back
-- the standalone job from A.
-- ---------------------------------------------------------------------------------------
select is(
  (select created from public.enqueue_foundation_compile_job(
     'cjob-' || repeat('3', 32), 'pilot-slottest01',
     '77777777-7777-7777-7777-777777777777', pg_temp.docs(1, 12),
     pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12), 'corpus-' || repeat('a', 32), 0),
     'corpus-' || repeat('a', 32), 0, 11)),
  true,
  'C: corpus batch 0 is created as its own job and does not adopt the standalone one');

select is(
  (select corpus_id from public.enqueue_foundation_compile_job(
     'cjob-' || repeat('4', 32), 'pilot-slottest01',
     '77777777-7777-7777-7777-777777777777', pg_temp.docs(1, 12),
     pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12), 'corpus-' || repeat('a', 32), 0),
     'corpus-' || repeat('a', 32), 0, 11)),
  'corpus-' || repeat('a', 32),
  'C: a repeated corpus enqueue answers with the slot it was asked for');

select is(
  (select count(*)::integer from public.foundation_compile_jobs
    where workspace_key = 'pilot-slottest01' and document_ids = pg_temp.docs(1, 12)),
  2,
  'C: the standalone job and the corpus part both exist');

select is(
  (select count(*)::integer from public.foundation_compile_jobs
    where workspace_key = 'pilot-slottest01' and corpus_id is null),
  1,
  'C: the standalone job was not absorbed into the corpus');

select is(
  (select job_id from public.foundation_compile_jobs
    where workspace_key = 'pilot-slottest01'
      and corpus_id = 'corpus-' || repeat('a', 32) and batch_index = 0),
  'cjob-' || repeat('3', 32),
  'C: the corpus part is the row the corpus enqueue created');

-- The corpus must be able to see all of its parts. The defect showed up here first: part 0
-- was missing from this list while the caller had been told it existed.
select is(
  (select created from public.enqueue_foundation_compile_job(
     'cjob-' || repeat('5', 32), 'pilot-slottest01',
     '77777777-7777-7777-7777-777777777777', pg_temp.docs(13, 24),
     pg_temp.compile_key('pilot-slottest01', pg_temp.docs(13, 24), 'corpus-' || repeat('a', 32), 1),
     'corpus-' || repeat('a', 32), 1, 11)),
  true,
  'C: batch 1 is created alongside batch 0');

select is(
  (select count(*)::integer from public.foundation_compile_jobs
    where workspace_key = 'pilot-slottest01' and corpus_id = 'corpus-' || repeat('a', 32)),
  2,
  'C: the corpus reports exactly the parts that were enqueued into it');

-- ---------------------------------------------------------------------------------------
-- The reverse direction: a corpus part must not satisfy a later standalone compile either.
-- ---------------------------------------------------------------------------------------
select is(
  (select created from public.enqueue_foundation_compile_job(
     'cjob-' || repeat('6', 32), 'pilot-slottest01',
     '77777777-7777-7777-7777-777777777777', pg_temp.docs(13, 24),
     pg_temp.compile_key('pilot-slottest01', pg_temp.docs(13, 24)))),
  true,
  'a standalone compile over a corpus part-s documents is its own job');

select is(
  (select corpus_id from public.foundation_compile_jobs where job_id = 'cjob-' || repeat('6', 32)),
  null::text,
  'that standalone job belongs to no corpus');

-- ---------------------------------------------------------------------------------------
-- A slot that is taken by a different document set is a conflict, not an answer.
-- ---------------------------------------------------------------------------------------
select throws_ok(
  $$select public.enqueue_foundation_compile_job(
      'cjob-' || repeat('7', 32), 'pilot-slottest01',
      '77777777-7777-7777-7777-777777777777',
      (select pg_temp.docs(25, 36)),
      (select pg_temp.compile_key('pilot-slottest01', pg_temp.docs(25, 36), 'corpus-' || repeat('a', 32), 0)),
      'corpus-' || repeat('a', 32), 0, 11)$$,
  '23505',
  null,
  'a slot held by a job over other documents is refused rather than returned');

select is(
  (select document_ids from public.foundation_compile_jobs
    where workspace_key = 'pilot-slottest01'
      and corpus_id = 'corpus-' || repeat('a', 32) and batch_index = 0),
  pg_temp.docs(1, 12),
  'the refused call left the occupant untouched');

-- ---------------------------------------------------------------------------------------
-- Concurrency. Two enqueues of one slot leave one row.
--
-- Real interleaving needs two sessions, which pgTAP does not have. It is covered instead by
-- nextjs/scripts/db/corpus-slot-race.mjs, which holds one transaction open while a second
-- connection blocks on the slot index, and which fails against this chain minus 0042 -- the
-- loser is handed the winner's row as success. What is checked here is the constraint that
-- makes the race safe and the guard that fires when an insert is refused for a reason the
-- identity lookup cannot see -- a duplicate job_id.
-- ---------------------------------------------------------------------------------------
select is(
  (select count(*)::integer from pg_indexes
    where schemaname = 'public' and indexname = 'foundation_compile_jobs_corpus_slot_idx'),
  1,
  'one row per corpus slot is enforced by a unique index, not only by the function');

select throws_ok(
  $$select public.enqueue_foundation_compile_job(
      'cjob-' || repeat('1', 32), 'pilot-slottest01',
      '77777777-7777-7777-7777-777777777777',
      (select pg_temp.docs(40, 51)),
      (select pg_temp.compile_key('pilot-slottest01', pg_temp.docs(40, 51))))$$,
  '23505',
  null,
  'an insert refused for a reason the lookup cannot see fails rather than looping');

select is(
  (select count(*)::integer from public.foundation_compile_jobs where workspace_key = 'pilot-slottest01'),
  -- Four calls above returned created = true and each is asserted individually: cjob-1
  -- (standalone 1..12), cjob-3 (corpus a slot 0), cjob-5 (corpus a slot 1) and cjob-6
  -- (standalone 13..24). cjob-2 and cjob-4 were idempotent answers, cjob-7 and the duplicate
  -- job_id were refused. So four rows, not five.
  4,
  'no failed call left a row behind');

-- ---------------------------------------------------------------------------------------
-- 0042. The result carries the identity back, so a caller can check the row it was given.
-- ---------------------------------------------------------------------------------------
select has_function(
  'public', 'assert_foundation_compile_identity',
  'the identity assertion both lookup paths call exists');

select is(
  public.foundation_canonical_document_ids(array['doc-b', 'doc-a', 'doc-b']),
  array['doc-a', 'doc-b'],
  'document identity ignores the order and multiplicity a caller happens to send');

select is(
  (select idempotency_key from public.enqueue_foundation_compile_job(
     'cjob-' || repeat('8', 32), 'pilot-slottest01',
     '77777777-7777-7777-7777-777777777777', pg_temp.docs(1, 12),
     pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12), 'corpus-' || repeat('a', 32), 0),
     'corpus-' || repeat('a', 32), 0, 11)),
  pg_temp.compile_key('pilot-slottest01', pg_temp.docs(1, 12), 'corpus-' || repeat('a', 32), 0),
  'an existing slot comes back carrying the identity it is stored under');

select * from finish();
rollback;
