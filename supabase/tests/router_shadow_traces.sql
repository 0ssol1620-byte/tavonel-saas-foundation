-- Router shadow trace (WO-RTR-2, migration 20261123130000, ADR-012 section 5).
--
-- What it proves: the table has RLS on and no policy, and no role holds any table privilege; only
-- service_role may execute the one writer; the columns carry no text, bbox or region content; the
-- key is computed by the database, so redelivery writes nothing twice while another version of the
-- same page is a new row; a request with a missing or an extra key (text, say) is refused whole;
-- and operational and semantic outcomes cannot be merged -- every reason belongs to one class.
begin;
select plan(37);

-- A valid page row, with the fields a test wants changed merged over it.
create function pg_temp.rt_row(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'run_kind', 'compile_job', 'run_ref', 'cjob-' || repeat('1', 32),
    'document_id', '0c0c0c0c-0000-4000-8000-00000000000a', 'version_key', repeat('a', 64),
    'page_index0', 0, 'input_sha256', 'sha256:' || repeat('a', 64),
    'ocr_schema_version', 'tavonel.ocr_result.v2', 'reader_revision', null, 'reader_binding_sha256', null,
    'page_class', 'native_text', 'incumbent_route', 'native_text', 'evidence_row_id', 'RT-1',
    'table_version', 1, 'table_sha256', 'sha256:' || repeat('b', 64), 'agrees_with_incumbent', true,
    'cost_usd', null, 'cost_reason', 'COST_UNMEASURED', 'outcome_class', 'ok', 'reason_code', null,
    'recognition_conflict_count', 0) || p_over;
$$;
-- A document-level row: no page, nothing a verified document would give.
create function pg_temp.rt_doc(p_class text, p_reason text) returns jsonb language sql as $$
  select pg_temp.rt_row(jsonb_build_object('page_index0', null, 'input_sha256', null, 'ocr_schema_version', null,
    'page_class', null, 'incumbent_route', null, 'evidence_row_id', null, 'agrees_with_incumbent', null,
    'cost_reason', null, 'recognition_conflict_count', null, 'outcome_class', p_class, 'reason_code', p_reason,
    'document_id', '0d0d0d0d-0000-4000-8000-00000000000d'));
$$;
create function pg_temp.rt_call(p_rows jsonb) returns integer language sql as $$
  select public.record_router_shadow_traces('pilot-shadow1', p_rows);
$$;

-- 1. Access.
select has_table('public', 'foundation_router_shadow_traces', 'the trace table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_router_shadow_traces'::regclass), 'RLS is enabled');
-- Written with ok/is only, so the local pgTAP subset runs them as the hosted pgTAP does.
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'foundation_router_shadow_traces'),
  'the table has no policy');
select is((select string_agg(r || ':' || p, ',' order by r, p)
             from unnest(array['anon', 'authenticated', 'service_role']) as r,
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p
            where has_table_privilege(r, 'public.foundation_router_shadow_traces', p)), null,
  'no client role and not service_role holds any table privilege');
select ok(not exists (select 1 from pg_attribute a
                       cross join unnest(array['anon', 'authenticated', 'service_role']) as r
                       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as p
                      where a.attrelid = 'public.foundation_router_shadow_traces'::regclass and a.attnum > 0 and not a.attisdropped
                        and has_column_privilege(r, a.attrelid, a.attnum, p)),
  'nor any column privilege');
select ok(has_function_privilege('service_role', 'public.record_router_shadow_traces(text, jsonb)', 'EXECUTE'), 'service_role may record');
select ok(not has_function_privilege('authenticated', 'public.record_router_shadow_traces(text, jsonb)', 'EXECUTE'), 'a signed-in user may not');
select ok(not has_function_privilege('anon', 'public.record_router_shadow_traces(text, jsonb)', 'EXECUTE'), 'anon may not');

-- 2. No content column.
select is((select string_agg(attname::text, ',' order by attnum) from pg_attribute
             where attrelid = 'public.foundation_router_shadow_traces'::regclass and attnum > 0 and not attisdropped),
  'trace_key,workspace_key,run_kind,run_ref,document_id,version_key,page_index0,input_sha256,'
  || 'ocr_schema_version,reader_revision,reader_binding_sha256,page_class,incumbent_route,evidence_row_id,'
  || 'table_version,table_sha256,agrees_with_incumbent,cost_usd,cost_reason,outcome_class,reason_code,'
  || 'recognition_conflict_count,created_at,'
  -- 20261127060000 (trace v2): route, counts and outcome codes, still no content column.
  || 'trace_version,candidate_route,pre_page_count,pre_source_bytes,run_outcome_class,run_reason_code',
  'ids, digests, class and outcome only: no text, bbox or region column');

-- 3. Writes and redelivery.
select is(pg_temp.rt_call(jsonb_build_array(
  pg_temp.rt_row(),
  pg_temp.rt_row(jsonb_build_object('page_index0', 1, 'page_class', 'no_text', 'incumbent_route', 'rapidocr_raster',
    'evidence_row_id', 'RT-3', 'agrees_with_incumbent', true, 'outcome_class', 'semantic', 'reason_code', 'NO_TEXT_PAGE')),
  pg_temp.rt_doc('operational', 'OCR_BINDING_INVALID'))), 3, 'three rows recorded');
select is(pg_temp.rt_call(jsonb_build_array(
  pg_temp.rt_row(),
  pg_temp.rt_row(jsonb_build_object('page_index0', 1, 'page_class', 'no_text', 'incumbent_route', 'rapidocr_raster',
    'evidence_row_id', 'RT-3', 'agrees_with_incumbent', true, 'outcome_class', 'semantic', 'reason_code', 'NO_TEXT_PAGE')),
  pg_temp.rt_doc('operational', 'OCR_BINDING_INVALID'))), 0, 'a redelivered compile writes nothing');
select is((select count(*)::integer from public.foundation_router_shadow_traces), 3, 'still three rows');
select is((select trace_key from public.foundation_router_shadow_traces where page_index0 = 0),
  'sha256:' || encode(sha256(convert_to('cjob-' || repeat('1', 32) || '|0c0c0c0c-0000-4000-8000-00000000000a|' || repeat('a', 64)
    || '|0|sha256:' || repeat('b', 64), 'UTF8')), 'hex'),
  'the key is sha256(run | document | version | page | table digest), computed by the database');
select is(pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('version_key', repeat('c', 64),
  'input_sha256', 'sha256:' || repeat('c', 64))))), 1, 'another version of the same page is another row');
select is(pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('table_sha256', 'sha256:' || repeat('e', 64))))), 1,
  'another evidence table is another row');
select is(pg_temp.rt_call(jsonb_build_array(
  pg_temp.rt_row(jsonb_build_object('page_index0', 2, 'page_class', 'unclassifiable', 'incumbent_route', null,
    'evidence_row_id', null, 'agrees_with_incumbent', null, 'cost_reason', 'NO_EVIDENCE_ROW',
    'outcome_class', 'semantic', 'reason_code', 'UNCLASSIFIABLE_PAGE')),
  pg_temp.rt_row(jsonb_build_object('page_index0', 3, 'ocr_schema_version', 'tavonel.ocr_result.v3',
    'reader_revision', 'sha256:' || repeat('d', 64), 'reader_binding_sha256', 'sha256:' || repeat('d', 64),
    'page_class', 'raster_text', 'incumbent_route', 'rapidocr_raster', 'evidence_row_id', 'RT-3',
    'outcome_class', 'semantic', 'reason_code', 'RECOGNITION_CONFLICT', 'recognition_conflict_count', 2)),
  pg_temp.rt_doc('semantic', 'OCR_REGIONS_REQUIRED') || jsonb_build_object('document_id', '0e0e0e0e-0000-4000-8000-00000000000e'))),
  3, 'unclassifiable, conflict and v1 rows recorded');

-- 4. Requests refused whole.
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'text', 'secret')))) $$,
  '22023', 'router_shadow_request_invalid', 'a row carrying text is refused, not stripped');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9)) - 'page_class')) $$,
  '22023', 'router_shadow_request_invalid', 'a row missing a key is refused, not read as null');
select throws_ok($$ select pg_temp.rt_call('[]'::jsonb) $$, '22023', 'router_shadow_request_invalid', 'an empty request is refused');
select throws_ok($$ select pg_temp.rt_call(pg_temp.rt_row()) $$, '22023', 'router_shadow_request_invalid', 'a non-array request is refused');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array('"x"'::jsonb)) $$, '22023', 'router_shadow_request_invalid', 'a non-object row is refused');
select throws_ok($$ select public.record_router_shadow_traces('*', jsonb_build_array(pg_temp.rt_row())) $$,
  '22023', 'router_shadow_request_invalid', 'a malformed workspace key is refused');

-- 5. Operational and semantic are never merged; nulls never slip a check.
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'reason_code', 'NO_TEXT_PAGE')))) $$,
  '23514', null, 'an ok row carries no reason');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'outcome_class', 'operational', 'reason_code', 'OCR_BINDING_INVALID')))) $$,
  '23514', null, 'an operational outcome is never attributed to a page');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_doc('semantic', 'OCR_BINDING_INVALID'))) $$,
  '23514', null, 'a binding failure is operational, never semantic');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_doc('operational', 'OCR_REGIONS_REQUIRED'))) $$,
  '23514', null, 'a read without regions is semantic, never operational');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'outcome_class', 'semantic', 'reason_code', null)))) $$,
  '23514', null, 'a semantic outcome without a reason is refused');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'outcome_class', 'semantic', 'reason_code', null,
  'recognition_conflict_count', 1)))) $$,
  '23514', null, 'a null reason is refused even where the rest of the row fits a conflict (a null check would pass)');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'outcome_class', 'semantic', 'reason_code', 'NO_TEXT_PAGE')))) $$,
  '23514', null, 'a native page is not a no-text page');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'outcome_class', 'semantic', 'reason_code', 'RECOGNITION_CONFLICT')))) $$,
  '23514', null, 'a conflict reason needs a conflict');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'cost_reason', null)))) $$,
  '23514', null, 'a page without a cost says why');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'page_class', 'unclassifiable',
  'outcome_class', 'semantic', 'reason_code', 'UNCLASSIFIABLE_PAGE')))) $$,
  '23514', null, 'an unclassifiable page has no evidence row');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'ocr_schema_version', 'tavonel.ocr_result.v3')))) $$,
  '23514', null, 'a v3 page names its reader');
select throws_ok($$ select pg_temp.rt_call(jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 9, 'run_ref', '0c0c0c0c-0000-4000-8000-00000000000a')))) $$,
  '23514', null, 'a compile-job run names a compile job');

-- 6. As the roles themselves.
set local role service_role;
select throws_ok($$ select count(*) from public.foundation_router_shadow_traces $$, '42501', null, 'service_role cannot read the table directly');
select is(public.record_router_shadow_traces('pilot-shadow1', jsonb_build_array(pg_temp.rt_row(jsonb_build_object('page_index0', 7)))), 1,
  'service_role records through the function');
set local role authenticated;
select throws_ok($$ select public.record_router_shadow_traces('pilot-shadow1', '[]'::jsonb) $$, '42501', null, 'a signed-in user cannot record');
reset role;

select * from finish();
rollback;
