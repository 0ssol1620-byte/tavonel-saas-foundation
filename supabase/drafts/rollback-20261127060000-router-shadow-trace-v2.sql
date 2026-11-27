-- Rollback for migration 20261127060000_router_shadow_trace_v2 (WO-RTR-GAPS-1). The lead renumbers both at merge.
--
-- Not a migration: run by hand, as one transaction, against the database where the migration was applied. The
-- ordinary rollback of the router shadow is NOT this file: it is unsetting TAVONEL_ROUTER_SHADOW_ENABLED and
-- redeploying (ADR-012 section 5), which stops every write and keeps the rows
-- (receipts/WO-RTR-GAPS-1/ROLLBACK-DRILL.md). Run this only after the site is on a build whose store writes the
-- v1 key set (or none): a v2 build against the restored v1 writer is refused whole, logs
-- ROUTER_SHADOW_REQUEST_INVALID and compiles exactly as before.
--
-- It refuses, and changes nothing, while the table holds any trace_version 2 row: those rows are append-only
-- evidence for the shadow report (WO-RTR-4), and deleting them is a destructive action that needs a recorded
-- backup first. The operator exports them, records the backup in the campaign ledger, deletes them, and only
-- then runs this file. v1 rows are untouched and stay valid under the restored check.
--
-- Otherwise it restores the 20261124000200 writer body and outcome check, and drops the reader function, the three
-- named checks and the six columns. A missing object stops the rollback (no `if exists`). Afterwards the catalog
-- fingerprint (nextjs/scripts/db/catalog-fingerprints.sql) equals the one of the chain ending before this migration.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it commits, the
-- operator deletes the migration's version row in the same session and writes the version, the time and who ran it
-- into the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if exists (select 1 from public.foundation_router_shadow_traces where trace_version <> 1) then
    raise exception 'rollback_refused_router_shadow_trace_v2_rows_exist';
  end if;
end;
$$;

drop function public.read_router_shadow_traces(timestamptz, integer);

alter table public.foundation_router_shadow_traces
  drop constraint foundation_router_shadow_traces_outcome,
  drop constraint foundation_router_shadow_traces_v2_shape,
  drop constraint foundation_router_shadow_traces_run_outcome,
  drop column trace_version,
  drop column candidate_route,
  drop column pre_page_count,
  drop column pre_source_bytes,
  drop column run_outcome_class,
  drop column run_reason_code;

-- 20261124000200's outcome check, verbatim (unnamed there, so PostgreSQL chooses the same free name again).
alter table public.foundation_router_shadow_traces
  add check (coalesce(case outcome_class
    when 'ok' then reason_code is null and page_index0 is not null
      and page_class in ('native_text', 'raster_text') and recognition_conflict_count = 0
    when 'operational' then page_index0 is null and reason_code in ('OCR_BINDING_INVALID', 'ROUTER_SHADOW_REGION_INVALID')
    when 'semantic' then (page_index0 is null and reason_code = 'OCR_REGIONS_REQUIRED')
      or (page_class = 'unclassifiable' and reason_code = 'UNCLASSIFIABLE_PAGE')
      or (page_class = 'no_text' and reason_code = 'NO_TEXT_PAGE')
      or (page_class in ('native_text', 'raster_text') and reason_code = 'RECOGNITION_CONFLICT'
          and recognition_conflict_count > 0)
    end, false));

-- 20261124000200's writer body, verbatim.
create or replace function public.record_router_shadow_traces(p_workspace_key text, p_rows jsonb)
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
