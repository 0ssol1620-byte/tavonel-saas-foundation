-- Execute only against an isolated PostgreSQL/Supabase database after all migrations.
-- Static fixture checks are not a substitute for running these pgTAP assertions.
begin;
select plan(22);

create function pg_temp.global_docs(p_count integer)
returns text[] language sql immutable as $fn$
  select array_agg('00000000-0000-4000-8000-' || lpad(i::text,12,'0') order by i)
  from generate_series(1,p_count) as i;
$fn$;

select has_column('public','foundation_compile_jobs','compilation_mode','durable compilation mode exists');
select ok(not has_function_privilege('anon','public.enqueue_foundation_global_collection_job(text,text,uuid,text[],text,text,integer,integer)','execute'),'anonymous callers cannot enqueue global work');
select ok(not has_function_privilege('authenticated','public.enqueue_foundation_global_collection_job(text,text,uuid,text[],text,text,integer,integer)','execute'),'authenticated clients cannot bypass server authorization');
select ok(has_function_privilege('service_role','public.enqueue_foundation_global_collection_job(text,text,uuid,text[],text,text,integer,integer)','execute'),'service worker can enqueue authorized global work');

select is((select created from public.enqueue_foundation_global_collection_job(
  'cjob-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(13),'global-test-idempotency','corpus-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',0,1)),
  true,'first whole collection creates one durable job');
select is((select compilation_mode from public.foundation_compile_jobs where job_id='cjob-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  'global_collection','job mode is set atomically');
select is((select cardinality(document_ids) from public.foundation_compile_jobs where job_id='cjob-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  13,'every document survives the 12/13 boundary');
select is((select created from public.enqueue_foundation_global_collection_job(
  'cjob-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(13),'global-test-idempotency','corpus-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',0,1)),
  false,'retry does not create another job');
select is((select job_id from public.enqueue_foundation_global_collection_job(
  'cjob-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(13),'global-test-idempotency','corpus-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',0,1)),
  'cjob-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','retry returns its original job');
select is((select created from public.enqueue_foundation_global_collection_job(
  'cjob-cccccccccccccccccccccccccccccccc','pilot-globalother','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(13),'global-test-idempotency','corpus-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',0,1)),
  true,'same corpus and key in another workspace create separate work');
select isnt((select job_id from public.foundation_compile_jobs where workspace_key='pilot-globalother' and corpus_id='corpus-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  'cjob-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','cross-workspace replay never returns the first workspace job');

select throws_ok($$select public.enqueue_foundation_global_collection_job(
  'cjob-dddddddddddddddddddddddddddddddd','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(13) || '00000000-0000-4000-8000-000000000001'::text,'invalid-global-key','corpus-dddddddddddddddddddddddddddddddd',0,1)$$,
  '22023',null,'duplicate documents are refused');
select throws_ok($$select public.enqueue_foundation_global_collection_job(
  'cjob-dddddddddddddddddddddddddddddddd','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(13) || null::text,'invalid-global-key','corpus-dddddddddddddddddddddddddddddddd',0,1)$$,
  '22023',null,'null document entries are refused');
select throws_ok($$select public.enqueue_foundation_global_collection_job(
  'cjob-dddddddddddddddddddddddddddddddd','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  null,'invalid-global-key','corpus-dddddddddddddddddddddddddddddddd',0,1)$$,
  '22023',null,'null membership is refused');
select throws_ok($$select public.enqueue_foundation_global_collection_job(
  'cjob-dddddddddddddddddddddddddddddddd','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  array[]::text[],'invalid-global-key','corpus-dddddddddddddddddddddddddddddddd',0,1)$$,
  '22023',null,'empty membership is refused');
select throws_ok($$select public.enqueue_foundation_global_collection_job(
  'cjob-dddddddddddddddddddddddddddddddd','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(129),'invalid-global-key','corpus-dddddddddddddddddddddddddddddddd',0,1)$$,
  '22023',null,'global document limit is not silently raised');
select throws_ok($$select public.enqueue_foundation_global_collection_job(
  'cjob-dddddddddddddddddddddddddddddddd','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(13),'invalid-global-key','corpus-dddddddddddddddddddddddddddddddd',1,2)$$,
  '22023',null,'global jobs cannot masquerade as an ordinary batch slot');
select throws_ok($$select public.enqueue_foundation_global_collection_job(
  'cjob-dddddddddddddddddddddddddddddddd','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(12),'different-global-key','corpus-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',0,1)$$,
  '23505',null,'existing slot rejects changed membership and identity');
select is((select document_ids from public.foundation_compile_jobs where job_id='cjob-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  pg_temp.global_docs(13),'refused conflict leaves the accepted collection unchanged');

select lives_ok($$select public.enqueue_foundation_compile_job(
  'cjob-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(13),'legacy-global-key','corpus-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',0,1)$$,
  'legacy job fixture can be created');
select throws_ok($$select public.enqueue_foundation_global_collection_job(
  'cjob-ffffffffffffffffffffffffffffffff','pilot-globaltest','00000000-0000-4000-8000-000000000001',
  pg_temp.global_docs(13),'legacy-global-key','corpus-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',0,1)$$,
  '23505',null,'legacy batch is never silently adopted as a global collection');
select is((select compilation_mode from public.foundation_compile_jobs where job_id='cjob-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
  'document_batch','failed adoption leaves legacy mode unchanged');

select * from finish();
rollback;
