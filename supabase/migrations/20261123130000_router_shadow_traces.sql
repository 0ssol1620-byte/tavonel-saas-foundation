-- WO-RTR-2 (ADR-012 section 5): the router shadow's per-page decision trace. Zero authority.
--
-- Ordering: PROVISIONAL. 20261123130000 is later than every migration on the train head
-- (20261118120000), and later than 20261123120000_workspace_payer_for_members on the train
-- branch (fnd-int 7d0a529d); the lead renames it at merge, together with
-- supabase/drafts/rollback-20261123130000-router-shadow-traces.sql.
--
-- What a row is: one page of one document version in one compile run, classified from the region
-- ids the OCR worker wrote (native / raster / no text / unclassifiable), with the evidence-table row
-- that class falls under and the digest of that table. A document that never reached page
-- classification has one document-level row (page_index0 null) saying why. Operational and
-- semantic outcomes are told apart by outcome_class, and each reason code is bound to its class
-- by a check, so the two are never merged.
--
-- What a row is not: no text, no bbox, no region content, no score. Nothing here is read by the
-- compile, by any customer path or by any public DTO; the app writes it from
-- nextjs/lib/router-shadow-store.ts only while TAVONEL_ROUTER_SHADOW_ENABLED=true and the
-- workspace is in TAVONEL_ROUTER_SHADOW_COHORT.
--
-- Idempotent: trace_key is computed here, never accepted from the caller, as
-- sha256(run | document | version | page | table digest), and the write is insert-if-absent, so
-- a redelivered compile writes nothing twice.
--
-- Client access: none. RLS enabled with no policy; no table privilege for any role. service_role
-- reaches the table only through record_router_shadow_traces (security definer, empty search_path).
-- Rows are append-only: nothing here updates or deletes them.
begin;

create table public.foundation_router_shadow_traces (
  trace_key text primary key check (trace_key ~ '^sha256:[a-f0-9]{64}$'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  run_kind text not null check (run_kind in ('compile_job', 'invocation')),
  run_ref text not null,
  document_id uuid not null,
  version_key text not null check (version_key ~ '^[a-f0-9]{64}$'),
  page_index0 integer check (page_index0 is null or page_index0 >= 0),
  input_sha256 text check (input_sha256 is null or input_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  ocr_schema_version text check (ocr_schema_version is null
    or ocr_schema_version in ('tavonel.ocr_result.v2', 'tavonel.ocr_result.v3')),
  reader_revision text check (reader_revision is null or reader_revision ~ '^sha256:[a-f0-9]{64}$'),
  reader_binding_sha256 text check (reader_binding_sha256 is null or reader_binding_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  page_class text check (page_class is null or page_class in ('native_text', 'raster_text', 'no_text', 'unclassifiable')),
  incumbent_route text check (incumbent_route is null or incumbent_route ~ '^[a-z0-9_]{1,64}$'),
  evidence_row_id text check (evidence_row_id is null or evidence_row_id ~ '^[A-Za-z0-9-]{1,16}$'),
  table_version integer not null check (table_version > 0),
  table_sha256 text not null check (table_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  agrees_with_incumbent boolean,
  cost_usd numeric check (cost_usd is null or cost_usd >= 0),
  cost_reason text check (cost_reason is null or cost_reason in ('COST_UNMEASURED', 'NO_EVIDENCE_ROW')),
  outcome_class text not null check (outcome_class in ('ok', 'operational', 'semantic')),
  reason_code text,
  recognition_conflict_count integer check (recognition_conflict_count is null or recognition_conflict_count >= 0),
  created_at timestamptz not null default clock_timestamp(),
  -- Every composite check below is wrapped in coalesce(..., false): a check that evaluates to null
  -- passes in PostgreSQL, so a null where a value belongs would otherwise be admitted.
  check (coalesce((run_kind = 'compile_job' and run_ref ~ '^cjob-[a-f0-9]{32}$')
    or (run_kind = 'invocation' and run_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), false)),
  -- A page row carries everything a verified document gives; a document-level row carries none of it.
  check (coalesce(case when page_index0 is null
    then input_sha256 is null and ocr_schema_version is null and reader_revision is null and reader_binding_sha256 is null
      and page_class is null and incumbent_route is null and evidence_row_id is null and agrees_with_incumbent is null
      and cost_usd is null and cost_reason is null and recognition_conflict_count is null
    else input_sha256 is not null and ocr_schema_version is not null and page_class is not null
      and recognition_conflict_count is not null end, false)),
  -- v3 names its reader; the pair is both or neither.
  check ((reader_revision is null) = (reader_binding_sha256 is null)),
  check (ocr_schema_version is distinct from 'tavonel.ocr_result.v3' or reader_revision is not null),
  -- An unclassifiable page has no evidence row, and nothing is compared for it.
  check (coalesce(page_class is distinct from 'unclassifiable'
    or (incumbent_route is null and evidence_row_id is null and agrees_with_incumbent is null
        and cost_usd is null and cost_reason = 'NO_EVIDENCE_ROW'), false)),
  check (coalesce(page_class is null or page_class = 'unclassifiable'
    or (incumbent_route is not null and evidence_row_id is not null and agrees_with_incumbent is not null
        and ((cost_usd is null and cost_reason = 'COST_UNMEASURED') or (cost_usd is not null and cost_reason is null))), false)),
  -- Operational and semantic are separate classes; each reason belongs to exactly one.
  check (coalesce(case outcome_class
    when 'ok' then reason_code is null and page_index0 is not null
      and page_class in ('native_text', 'raster_text') and recognition_conflict_count = 0
    when 'operational' then page_index0 is null and reason_code in ('OCR_BINDING_INVALID', 'ROUTER_SHADOW_REGION_INVALID')
    when 'semantic' then (page_index0 is null and reason_code = 'OCR_REGIONS_REQUIRED')
      or (page_class = 'unclassifiable' and reason_code = 'UNCLASSIFIABLE_PAGE')
      or (page_class = 'no_text' and reason_code = 'NO_TEXT_PAGE')
      or (page_class in ('native_text', 'raster_text') and reason_code = 'RECOGNITION_CONFLICT'
          and recognition_conflict_count > 0)
    end, false))
);

create index foundation_router_shadow_traces_workspace_idx
  on public.foundation_router_shadow_traces (workspace_key, created_at);

alter table public.foundation_router_shadow_traces enable row level security;
revoke all on public.foundation_router_shadow_traces from public, anon, authenticated, service_role;

-- Every element carries exactly these keys: a missing one is not read as null, an extra one
-- (text, bbox, anything) is not silently dropped -- the call is refused whole.
create function public.record_router_shadow_traces(p_workspace_key text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys constant text[] := array['run_kind', 'run_ref', 'document_id', 'version_key', 'page_index0', 'input_sha256',
    'ocr_schema_version', 'reader_revision', 'reader_binding_sha256', 'page_class', 'incumbent_route',
    'evidence_row_id', 'table_version', 'table_sha256', 'agrees_with_incumbent', 'cost_usd', 'cost_reason',
    'outcome_class', 'reason_code', 'recognition_conflict_count'];
  v_inserted integer;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
     or p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array'
     or pg_catalog.jsonb_array_length(p_rows) < 1 or pg_catalog.jsonb_array_length(p_rows) > 20000 then
    raise exception 'router_shadow_request_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_rows) as e(item)
     where pg_catalog.jsonb_typeof(e.item) <> 'object'
        or (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(e.item) as k)
           is distinct from (select pg_catalog.array_agg(k order by k) from pg_catalog.unnest(v_keys) as k)
  ) then
    raise exception 'router_shadow_request_invalid' using errcode = '22023';
  end if;

  insert into public.foundation_router_shadow_traces (
    trace_key, workspace_key, run_kind, run_ref, document_id, version_key, page_index0, input_sha256,
    ocr_schema_version, reader_revision, reader_binding_sha256, page_class, incumbent_route, evidence_row_id,
    table_version, table_sha256, agrees_with_incumbent, cost_usd, cost_reason, outcome_class, reason_code,
    recognition_conflict_count)
  select 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat_ws('|',
           r.run_ref, r.document_id::text, r.version_key, coalesce(r.page_index0::text, 'document'), r.table_sha256), 'UTF8')), 'hex'),
         p_workspace_key, r.run_kind, r.run_ref, r.document_id, r.version_key, r.page_index0, r.input_sha256,
         r.ocr_schema_version, r.reader_revision, r.reader_binding_sha256, r.page_class, r.incumbent_route, r.evidence_row_id,
         r.table_version, r.table_sha256, r.agrees_with_incumbent, r.cost_usd, r.cost_reason, r.outcome_class, r.reason_code,
         r.recognition_conflict_count
    from pg_catalog.jsonb_to_recordset(p_rows) as r(
      run_kind text, run_ref text, document_id uuid, version_key text, page_index0 integer, input_sha256 text,
      ocr_schema_version text, reader_revision text, reader_binding_sha256 text, page_class text, incumbent_route text,
      evidence_row_id text, table_version integer, table_sha256 text, agrees_with_incumbent boolean, cost_usd numeric,
      cost_reason text, outcome_class text, reason_code text, recognition_conflict_count integer)
  on conflict (trace_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.record_router_shadow_traces(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_router_shadow_traces(text, jsonb) to service_role;

commit;
