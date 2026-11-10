-- Migration 20261110041500: allow PDF members to be approved up to 500 pages (ADR-0006, site half).
--
-- A PDF longer than one CDR request is read as page ranges of at most 80 pages
-- (FOUNDATION_SOURCE_SEGMENT_PAGES; the CDR's SEGMENTED_MAX_DOCUMENT_PAGES and the worker's
-- MAX_SEGMENTED_SOURCE_PAGES are 500). Only PDF is segmented -- not DOCX, whose page count is
-- Word's own saved number and is never verified before processing -- so only a PDF may be
-- approved past 80 pages; every other format keeps the 80-page bound, and a member whose pages
-- cannot be counted is still approved at exactly 80 (foundation_intake_approval_files_unknown_ceiling,
-- untouched). The set bound follows: 128 members x 500 pages = 64,000.
--
-- This widens what the table and function accept; it approves nothing by itself. Intake quotes
-- past 80 pages only once shared/intakeCeiling.ts SEGMENTED_INTAKE_ENABLED is true, which is its
-- own release after the worker runs segmented (docs/runbooks/RELEASE_ORDER.md).
--
-- Bytes are not changed here. byte_length stays 1..5,242,880 and the admission function
-- (reserve_foundation_intake_admission_unchecked) is not touched: no processor path above 5 MiB
-- has been measured.
--
-- The function is patched in place from its installed definition, the same way
-- 20261003130000_intake_approval_file_cap.sql did, so it builds on whatever body production runs
-- and refuses to run against one it does not recognise. Rollback:
-- supabase/drafts/rollback-20261110041500-intake-approval-segmented-page-ceiling.sql.

alter table public.foundation_intake_approval_files
  drop constraint if exists foundation_intake_approval_files_approved_max_pages_check;
alter table public.foundation_intake_approval_files
  add constraint foundation_intake_approval_files_approved_max_pages_check
  check (approved_max_pages between 1 and 500);

-- Only the segmented format may pass 80 pages.
alter table public.foundation_intake_approval_files
  add constraint foundation_intake_approval_files_segmented_format_check
  check (approved_max_pages <= 80 or declared_mime_type = 'application/pdf');

alter table public.foundation_intake_approvals
  drop constraint if exists foundation_intake_approvals_aggregate_maximum_pages_check;
alter table public.foundation_intake_approvals
  add constraint foundation_intake_approvals_aggregate_maximum_pages_check
  check (aggregate_maximum_pages between 1 and 64000);

do $$
declare
  v_definition text;
  v_old_bound text := $q$(v_entry->>'approvedMaxPages')::integer not between 1 and 80$q$;
  v_new_bound text := $q$(v_entry->>'approvedMaxPages')::integer not between 1 and 500$q$;
  v_old_unknown text := $q$    if v_entry->>'pageBasis' = 'unknown' and (v_entry->>'approvedMaxPages')::integer <> 80 then$q$;
  v_new_unknown text := $q$    if (v_entry->>'approvedMaxPages')::integer > 80 and v_entry->>'mimeType' <> 'application/pdf' then
      raise exception 'foundation_intake_approval_invalid';
    end if;
    if v_entry->>'pageBasis' = 'unknown' and (v_entry->>'approvedMaxPages')::integer <> 80 then$q$;
begin
  v_definition := pg_get_functiondef(
    'public.create_foundation_intake_approval(text,uuid,text,text,text,integer,jsonb)'::regprocedure
  );
  if position(v_new_bound in v_definition) > 0 and position(v_new_unknown in v_definition) > 0 then
    return;
  end if;
  if position(v_old_bound in v_definition) = 0 or position(v_old_unknown in v_definition) = 0
     or position(v_new_bound in v_definition) > 0 then
    raise exception 'foundation_intake_approval_segmented_ceiling_definition_unexpected';
  end if;
  execute replace(replace(v_definition, v_old_bound, v_new_bound), v_old_unknown, v_new_unknown);
end
$$;
