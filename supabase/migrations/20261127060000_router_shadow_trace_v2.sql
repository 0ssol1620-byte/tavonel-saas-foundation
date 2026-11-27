-- WO-RTR-GAPS-1: router shadow trace v2. Expand-type; the shadow keeps zero authority.
--
-- Closes ROUTER-AUDIT-1 gaps 1-4 on public.foundation_router_shadow_traces (20261124000200):
--   1. Operational failures the trace never saw are recorded, apart from semantic ones: a stored OCR
--      result that could not be fetched (OCR_RESULT_UNREADABLE) and a reader that never answered inside
--      the compile job's bound (OCR_READ_TIMEOUT) are operational; a document whose reader wrote a review
--      receipt instead of a result (OCR_REVIEW_RECEIPT) is semantic -- since the CDR worker's failure split
--      only a `semantic` OCR failure writes a receipt (foundation-cdr-worker/src/ocr.ts OCR_FAILURE_CATEGORY).
--   2. NO_TEXT_PAGE is split. A page row with no region is now EMPTY_PAGE: in a durable OCR result every
--      page was read (an incomplete set is refused as OCR_PAGES_INCOMPLETE upstream), so a failed read is a
--      document row (1), never a page row. Whether an empty page is blank or holds text the reader missed
--      is not measured. v1 rows keep NO_TEXT_PAGE; the two never mix (trace_version).
--   3. Pre-read features get their own columns (pre_page_count, pre_source_bytes: fixed before any reader
--      runs and the same for every reader), apart from the post-read ones the incumbent produced
--      (page_class, recognition_conflict_count, outcome_class, reason_code).
--   4. Candidate path and outcome: candidate_route is the route the page's evidence row supports;
--      run_outcome_class / run_reason_code are the compile run's outcome, on every row of the run and never
--      attributed to a page route (operational, semantic, or unattributed: a gate that is not reading).
--
-- Expand only. Every new column is nullable or defaulted, no column or row is removed or rewritten, the key
-- formula is unchanged, and the writer accepts the v1 key set exactly as before (trace_version 1, new
-- columns null), so a build still on the v1 store writes as it did; the v2 key set writes trace_version 2.
-- The one constraint replaced is the outcome check, widened only for trace_version 2 rows; every v1 row
-- it admitted it still admits. The reader function is new; table privileges are unchanged (none).
--
-- Ordering against WO-LIFE-1 (branch codex/v34-life-1, reviewed PASS, not merged; its file is
-- 20261124100600_life_router_traces_member_scopes.sql after the B chain): independent in either order.
-- LIFE-1 counts, fingerprints (to_jsonb of the whole row) and deletes trace rows by workspace_key and
-- document_id, fences the table with a trigger and adds a (workspace_key, document_id) index; this file
-- touches none of those, keeps document_id not null on every row, and adds no table. One consequence:
-- a founder reset SEALED before this file is applied fingerprints rows without the new columns and so
-- fails its finalize with database drift (fail closed; abort and prepare again) -- LIFE-1's own
-- pre-apply check (no sealed reset) covers it. The lead renumbers at merge; whichever lands second must
-- keep a later timestamp than the other.
--
-- Rollback: supabase/drafts/rollback-20261127060000-router-shadow-trace-v2.sql (refuses while a v2 row exists).
-- predecessor-hash: public.record_router_shadow_traces cd101869d90ef2f26008d64f0389a152c7376ab4c1b27d1c98059ea27052c1a8
-- predecessor: public.record_router_shadow_traces 20261124000200
begin;

alter table public.foundation_router_shadow_traces
  add column trace_version smallint not null default 1 check (trace_version in (1, 2)),
  add column candidate_route text check (candidate_route is null or candidate_route ~ '^[a-z0-9_]{1,64}$'),
  add column pre_page_count integer check (pre_page_count is null or pre_page_count between 1 and 100000),
  add column pre_source_bytes bigint check (pre_source_bytes is null or pre_source_bytes >= 0),
  add column run_outcome_class text check (run_outcome_class is null
    or run_outcome_class in ('ok', 'operational', 'semantic', 'unattributed')),
  add column run_reason_code text;

-- The 20261124000200 outcome check was created unnamed; it is found by its text, exactly one or the migration stops.
do $$
declare
  v_name text;
begin
  select c.conname into strict v_name
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.foundation_router_shadow_traces'::regclass and c.contype = 'c'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%NO_TEXT_PAGE%';
  execute pg_catalog.format('alter table public.foundation_router_shadow_traces drop constraint %I', v_name);
end;
$$;

alter table public.foundation_router_shadow_traces
  -- Operational and semantic stay separate classes; each reason belongs to exactly one. v1 reasons are unchanged.
  add constraint foundation_router_shadow_traces_outcome check (coalesce(case outcome_class
    when 'ok' then reason_code is null and page_index0 is not null
      and page_class in ('native_text', 'raster_text') and recognition_conflict_count = 0
    when 'operational' then page_index0 is null and (reason_code in ('OCR_BINDING_INVALID', 'ROUTER_SHADOW_REGION_INVALID')
      or (trace_version = 2 and reason_code in ('OCR_RESULT_UNREADABLE', 'OCR_READ_TIMEOUT')))
    when 'semantic' then (page_index0 is null and (reason_code = 'OCR_REGIONS_REQUIRED'
        or (trace_version = 2 and reason_code = 'OCR_REVIEW_RECEIPT')))
      or (page_class = 'unclassifiable' and reason_code = 'UNCLASSIFIABLE_PAGE')
      or (page_class = 'no_text' and reason_code = case trace_version when 1 then 'NO_TEXT_PAGE' else 'EMPTY_PAGE' end)
      or (page_class in ('native_text', 'raster_text') and reason_code = 'RECOGNITION_CONFLICT'
          and recognition_conflict_count > 0)
    end, false)),
  -- A v1 row carries none of the v2 fields; a v2 row carries its run outcome, a page row its page count, and a
  -- candidate route exactly when it has an evidence row.
  add constraint foundation_router_shadow_traces_v2_shape check (coalesce(case trace_version
    when 1 then candidate_route is null and pre_page_count is null and pre_source_bytes is null
      and run_outcome_class is null and run_reason_code is null
    else run_outcome_class is not null and (page_index0 is null) = (pre_page_count is null)
      and (candidate_route is null) = (evidence_row_id is null)
    end, false)),
  add constraint foundation_router_shadow_traces_run_outcome check (coalesce(case run_outcome_class
    when 'ok' then run_reason_code is null
    when 'operational' then run_reason_code in ('CORE_TIMEOUT', 'CORE_FAILED', 'INPUT_UNREADABLE', 'COMPILE_THREW')
    when 'semantic' then run_reason_code in ('CORE_REJECTED', 'INPUT_REFUSED')
    when 'unattributed' then run_reason_code = 'COMPILE_STOPPED'
    end, run_outcome_class is null and run_reason_code is null));

-- Each element carries exactly the v1 key set or exactly the v2 key set; anything else refuses the call whole.
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
  v_keys_v2 constant text[] := v_keys || array['candidate_route', 'pre_page_count', 'pre_source_bytes',
    'run_outcome_class', 'run_reason_code'];
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
           is distinct from (select pg_catalog.array_agg(k order by k) from pg_catalog.unnest(
             case when e.item ? 'run_outcome_class' then v_keys_v2 else v_keys end) as k)
  ) then
    raise exception 'router_shadow_request_invalid' using errcode = '22023';
  end if;

  insert into public.foundation_router_shadow_traces (
    trace_key, workspace_key, run_kind, run_ref, document_id, version_key, page_index0, input_sha256,
    ocr_schema_version, reader_revision, reader_binding_sha256, page_class, incumbent_route, evidence_row_id,
    table_version, table_sha256, agrees_with_incumbent, cost_usd, cost_reason, outcome_class, reason_code,
    recognition_conflict_count, trace_version, candidate_route, pre_page_count, pre_source_bytes,
    run_outcome_class, run_reason_code)
  select 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat_ws('|',
           r.run_ref, r.document_id::text, r.version_key, coalesce(r.page_index0::text, 'document'), r.table_sha256), 'UTF8')), 'hex'),
         p_workspace_key, r.run_kind, r.run_ref, r.document_id, r.version_key, r.page_index0, r.input_sha256,
         r.ocr_schema_version, r.reader_revision, r.reader_binding_sha256, r.page_class, r.incumbent_route, r.evidence_row_id,
         r.table_version, r.table_sha256, r.agrees_with_incumbent, r.cost_usd, r.cost_reason, r.outcome_class, r.reason_code,
         r.recognition_conflict_count, case when e.item ? 'run_outcome_class' then 2 else 1 end, r.candidate_route,
         r.pre_page_count, r.pre_source_bytes, r.run_outcome_class, r.run_reason_code
    from pg_catalog.jsonb_array_elements(p_rows) as e(item)
   cross join lateral pg_catalog.jsonb_to_record(e.item) as r(
      run_kind text, run_ref text, document_id uuid, version_key text, page_index0 integer, input_sha256 text,
      ocr_schema_version text, reader_revision text, reader_binding_sha256 text, page_class text, incumbent_route text,
      evidence_row_id text, table_version integer, table_sha256 text, agrees_with_incumbent boolean, cost_usd numeric,
      cost_reason text, outcome_class text, reason_code text, recognition_conflict_count integer, candidate_route text,
      pre_page_count integer, pre_source_bytes bigint, run_outcome_class text, run_reason_code text)
  on conflict (trace_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.record_router_shadow_traces(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_router_shadow_traces(text, jsonb) to service_role;

-- The RTR-4 report's only read path (nextjs/scripts/router/shadow-report.mjs). service_role only; the table keeps
-- no privilege for any role. Rows newer than p_since, oldest first, at most p_limit + 1 so the caller can tell a
-- truncated read from a complete one. No workspace key leaves: the report aggregates across the cohort.
create function public.read_router_shadow_traces(p_since timestamptz, p_limit integer)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_since is null or p_limit is null or p_limit < 1 or p_limit > 50000 then
    raise exception 'router_shadow_request_invalid' using errcode = '22023';
  end if;
  return query
    select pg_catalog.to_jsonb(t) - 'workspace_key' - 'trace_key'
      from public.foundation_router_shadow_traces t
     where t.created_at >= p_since
     order by t.created_at, t.trace_key
     limit p_limit + 1;
end;
$$;

revoke all on function public.read_router_shadow_traces(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.read_router_shadow_traces(timestamptz, integer) to service_role;

commit;
