-- Router shadow trace v2 (WO-RTR-GAPS-1, migration 20261127060000).
--
-- What it proves: the v1 key set still writes as before (trace_version 1, new columns null); the v2 key set writes
-- trace_version 2 with its candidate route, pre-read features and run outcome; a row mixing the two key sets is
-- refused whole; operational failures (unreadable result, read timeout) and semantic ones (review receipt) stay in
-- their own class; EMPTY_PAGE is v2 only and NO_TEXT_PAGE v1 only; a run outcome reason belongs to one class; and
-- the reader returns rows without the workspace key to service_role only, at most p_limit + 1.
begin;
select plan(26);

create function pg_temp.v1_row(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'run_kind', 'compile_job', 'run_ref', 'cjob-' || repeat('2', 32),
    'document_id', '0c0c0c0c-0000-4000-8000-00000000000b', 'version_key', repeat('a', 64),
    'page_index0', 0, 'input_sha256', 'sha256:' || repeat('a', 64),
    'ocr_schema_version', 'tavonel.ocr_result.v2', 'reader_revision', null, 'reader_binding_sha256', null,
    'page_class', 'native_text', 'incumbent_route', 'native_text', 'evidence_row_id', 'RT-1',
    'table_version', 1, 'table_sha256', 'sha256:' || repeat('b', 64), 'agrees_with_incumbent', true,
    'cost_usd', null, 'cost_reason', 'COST_UNMEASURED', 'outcome_class', 'ok', 'reason_code', null,
    'recognition_conflict_count', 0) || p_over;
$$;
create function pg_temp.v2_row(p_over jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.v1_row(jsonb_build_object('candidate_route', 'native_text', 'pre_page_count', 3, 'pre_source_bytes', 2048,
    'run_outcome_class', 'ok', 'run_reason_code', null)) || p_over;
$$;
-- A v2 document-level row: no page and nothing a verified document gives.
create function pg_temp.v2_doc(p_class text, p_reason text) returns jsonb language sql as $$
  select pg_temp.v2_row(jsonb_build_object('page_index0', null, 'input_sha256', null, 'ocr_schema_version', null,
    'page_class', null, 'incumbent_route', null, 'evidence_row_id', null, 'candidate_route', null, 'agrees_with_incumbent', null,
    'cost_reason', null, 'recognition_conflict_count', null, 'pre_page_count', null, 'outcome_class', p_class, 'reason_code', p_reason,
    'run_outcome_class', 'unattributed', 'run_reason_code', 'COMPILE_STOPPED'));
$$;
create function pg_temp.call(p_rows jsonb) returns integer language sql as $$
  select public.record_router_shadow_traces('pilot-shadow2', p_rows);
$$;
create function pg_temp.page(p_page integer) returns jsonb language sql as $$
  select jsonb_build_object('page_index0', p_page);
$$;

-- 1. Both key sets.
select is(pg_temp.call(jsonb_build_array(pg_temp.v1_row())), 1, 'a v1 row still writes');
select is((select trace_version::integer from public.foundation_router_shadow_traces where run_ref = 'cjob-' || repeat('2', 32) and page_index0 = 0),
  1, 'it is trace_version 1');
select ok((select candidate_route is null and pre_page_count is null and run_outcome_class is null
             from public.foundation_router_shadow_traces where run_ref = 'cjob-' || repeat('2', 32) and page_index0 = 0),
  'with every v2 column null');
select is(pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(1)))), 1, 'a v2 row writes');
select ok((select trace_version = 2 and candidate_route = 'native_text' and pre_page_count = 3 and pre_source_bytes = 2048
               and run_outcome_class = 'ok' and run_reason_code is null
             from public.foundation_router_shadow_traces where run_ref = 'cjob-' || repeat('2', 32) and page_index0 = 1),
  'trace_version 2 with candidate route, pre-read features and run outcome');
select is(pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(1)))), 0, 'a redelivered v2 row writes nothing (same key formula)');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v1_row(pg_temp.page(9) || jsonb_build_object('candidate_route', 'native_text')))) $$,
  '22023', 'router_shadow_request_invalid', 'a v1 row with one v2 key is refused whole');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(9)) - 'pre_source_bytes')) $$,
  '22023', 'router_shadow_request_invalid', 'a v2 row missing a key is refused, not read as null');

-- 2. Gap 1: operational and semantic document failures, each in its own class.
select is(pg_temp.call(jsonb_build_array(
  pg_temp.v2_doc('operational', 'OCR_RESULT_UNREADABLE'),
  pg_temp.v2_doc('operational', 'OCR_READ_TIMEOUT') || jsonb_build_object('document_id', '0c0c0c0c-0000-4000-8000-00000000000c'),
  pg_temp.v2_doc('semantic', 'OCR_REVIEW_RECEIPT') || jsonb_build_object('document_id', '0c0c0c0c-0000-4000-8000-00000000000d'))),
  3, 'unreadable result and read timeout (operational), review receipt (semantic) recorded');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v2_doc('semantic', 'OCR_READ_TIMEOUT'))) $$,
  '23514', null, 'a read timeout is operational, never semantic');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v2_doc('operational', 'OCR_REVIEW_RECEIPT'))) $$,
  '23514', null, 'a review receipt is semantic, never operational');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v1_row(jsonb_build_object('page_index0', null, 'input_sha256', null,
    'ocr_schema_version', null, 'page_class', null, 'incumbent_route', null, 'evidence_row_id', null, 'agrees_with_incumbent', null,
    'cost_reason', null, 'recognition_conflict_count', null, 'outcome_class', 'operational', 'reason_code', 'OCR_READ_TIMEOUT',
    'document_id', '0c0c0c0c-0000-4000-8000-0000000000ee')))) $$,
  '23514', null, 'the v2 reasons are not v1 reasons');

-- 3. Gap 2: EMPTY_PAGE (v2) and NO_TEXT_PAGE (v1) never mix.
select is(pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(2) || jsonb_build_object('page_class', 'no_text',
  'incumbent_route', 'rapidocr_raster', 'evidence_row_id', 'RT-3', 'candidate_route', 'rapidocr_raster',
  'outcome_class', 'semantic', 'reason_code', 'EMPTY_PAGE')))), 1, 'a v2 empty page is EMPTY_PAGE');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(9) || jsonb_build_object('page_class', 'no_text',
  'incumbent_route', 'rapidocr_raster', 'evidence_row_id', 'RT-3', 'candidate_route', 'rapidocr_raster',
  'outcome_class', 'semantic', 'reason_code', 'NO_TEXT_PAGE')))) $$, '23514', null, 'a v2 row never says NO_TEXT_PAGE');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v1_row(pg_temp.page(9) || jsonb_build_object('page_class', 'no_text',
  'incumbent_route', 'rapidocr_raster', 'evidence_row_id', 'RT-3', 'outcome_class', 'semantic', 'reason_code', 'EMPTY_PAGE')))) $$,
  '23514', null, 'a v1 row never says EMPTY_PAGE');

-- 4. Gap 3 and 4: shape of the v2 fields.
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(9) || jsonb_build_object('pre_page_count', null)))) $$,
  '23514', null, 'a v2 page row carries its page count');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(9) || jsonb_build_object('candidate_route', null)))) $$,
  '23514', null, 'a page with an evidence row names its candidate route');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(9) || jsonb_build_object('run_outcome_class', null)))) $$,
  '23514', null, 'a v2 row carries its run outcome');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(9) || jsonb_build_object('run_outcome_class', 'semantic',
  'run_reason_code', 'CORE_TIMEOUT')))) $$, '23514', null, 'a Core timeout is an operational run outcome, never semantic');
select throws_ok($$ select pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(9) || jsonb_build_object('run_outcome_class', 'operational',
  'run_reason_code', null)))) $$, '23514', null, 'an operational run outcome says why');
select is(pg_temp.call(jsonb_build_array(pg_temp.v2_row(pg_temp.page(3) || jsonb_build_object('run_outcome_class', 'operational',
  'run_reason_code', 'CORE_TIMEOUT')))), 1, 'a page read fine in a run whose Core timed out keeps its own ok outcome');

-- 5. The reader.
select ok(has_function_privilege('service_role', 'public.read_router_shadow_traces(timestamptz, integer)', 'EXECUTE'), 'service_role may read');
select ok(not has_function_privilege('authenticated', 'public.read_router_shadow_traces(timestamptz, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.read_router_shadow_traces(timestamptz, integer)', 'EXECUTE'), 'no client role may');
select is((select count(*)::integer from public.read_router_shadow_traces('-infinity', 2)), 3, 'at most p_limit + 1 rows, so a cut read is visible');
select ok(not exists (select 1 from public.read_router_shadow_traces('-infinity', 50000) as r(item) where item ? 'workspace_key' or item ? 'trace_key'),
  'no workspace key or trace key leaves');
select throws_ok($$ select * from public.read_router_shadow_traces('-infinity', 50001) $$, '22023', 'router_shadow_request_invalid',
  'a read above the bound is refused');

select * from finish();
rollback;
