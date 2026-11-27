-- WO-METER-NULLPLAN-1: a billing account that no plan was ever projected into is metered at Free's allowance on
-- queries (KQU) and storage, not uncapped.
--
-- DRAFT. Not applied by its author; the lead dispatches the hosted DB rehearsal (supabase/tests/meter_unplanned_billing_row.sql
-- is the proof) before this reaches any project. Ordering: 20261127070000, after 20261127050000 (WO-SEAT-RACE-1, the same
-- hole in the seat meter; the two files redefine different functions and apply in either order).
--
-- The hole (receipts/WO-SEAT-RACE-1/NOTES.md "Sibling, NOT fixed"): Paddle does not order its webhooks. transaction.completed
-- reaches apply_foundation_billing_event_v4's allowance branch, which inserts the workspace's billing account with access_plan
-- and plan_code both null; only a projected subscription event sets them. foundation_workspace_capped_plan returns null for
-- that row, and both meters below read null as "no cap": a new Personal or Developer buyer's workspace was uncapped on queries
-- and storage until the subscription event projected -- seconds normally, for good when it is refused or quarantined.
--
-- access_plan tells the classes apart (it has two writers, both the subscription projection, both always write a level, and
-- nothing writes it back to null; receipts/WO-SEAT-RACE-1/NOTES.md). When foundation_workspace_capped_plan is null:
--
--   no billing account (Free)                                   uncapped at these meters, bounded by the free
--                                                               evaluation in the app                            (unchanged)
--   an account with access_plan set (legacy plan, plan_code
--   null; or a v2 plan whose holder has an operator grant)      uncapped                                          (unchanged)
--   an account with access_plan null:
--       its holder has an active operator grant, or an active
--       owner of the workspace does (the founder's workspace)   uncapped                                          (unchanged)
--       otherwise                                               Free's allowance: 100 KQU a calendar month,
--                                                               1,000,000,000 stored bytes                        (NEW)
--
-- The two numbers are Free's line of the price book PB-2026-11-V22 (TAVONEL_CANONICAL_MASTERPLAN_V5_6_V34_2026-11-16.md, the
-- table under "Public target price book"; founder direction 2026-11-18: prices are that book). Free is not a catalog offer
-- (nextjs/lib/billing-catalog.ts PRICE_BOOK_EXTRA has no allowance), so, as 20261127020000 did for seats, they are constants
-- here and nothing changes in the maps the server sends. A GB is the SI gigabyte intake-admission.ts uses.
--
-- What the customer meets is the existing refusal of each meter: {"status":"exhausted"} (402 KQU_ALLOWANCE_EXHAUSTED) and
-- foundation_storage_allowance_exhausted (STORAGE_ALLOWANCE_EXHAUSTED). Once the subscription event projects, the plan's own
-- allowance applies and the units already counted this month count toward it. Nothing is backfilled or deleted: a workspace
-- already holding more than 1 GB keeps it and cannot add a file until the plan lands. A credit-pack-only account (the retired
-- 0005 purchase branch: credits, no plan) is in the NEW row too; no plan it bought ever carried a query or storage allowance.
--
-- foundation_workspace_capped_plan is not touched (the seat meter and workspace_payer_for_members read it). Every other line
-- of both bodies is the predecessor's, unchanged.
--
-- Expand-type and idempotent: create or replace on the existing signatures (owner, grants and comments kept), no table, grant
-- or caller change. Rollback: supabase/drafts/rollback-20261127070000-meters-unplanned-billing-row.sql.
-- predecessor-hash: public.admit_foundation_knowledge_query 70ef39e5d312041668c1db5ffeb6a5371cf734d9aab00635d87b5e0423322087
-- predecessor: public.admit_foundation_knowledge_query 20261117160000
-- predecessor-hash: public.reserve_foundation_intake_admission b3a41a542878694cce9e5f1bf77f8e2b172d089349d3c6a1c1a8835cf4a178a9
-- predecessor: public.reserve_foundation_intake_admission 20261117160100
begin;

create or replace function public.admit_foundation_knowledge_query(p_workspace_key text, p_limits jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window timestamptz := pg_catalog.date_trunc('month', v_now, 'UTC');
  v_used integer;
  v_held integer;
  v_hold uuid;
  v_plan text;
  v_entry numeric;
  v_limit integer;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$' then
    raise exception 'knowledge_query_meter_contract_invalid';
  end if;

  insert into public.foundation_knowledge_query_windows (workspace_key, window_started_at)
    values (p_workspace_key, v_window)
    on conflict do nothing;
  -- The lock every admission and settlement of this window queues on.
  select used_units into v_used from public.foundation_knowledge_query_windows
    where workspace_key = p_workspace_key and window_started_at = v_window
    for update;

  -- Whose plan governs: the workspace's, read under that lock. Null counts without a cap.
  v_plan := public.foundation_workspace_capped_plan(p_workspace_key);
  if v_plan is not null then
    -- Nested, not one AND: SQL does not promise to skip the cast of a non-number.
    if pg_catalog.jsonb_typeof(p_limits) = 'object' and pg_catalog.jsonb_typeof(p_limits -> v_plan) = 'number' then
      v_entry := (p_limits ->> v_plan)::numeric;
      if v_entry = pg_catalog.trunc(v_entry) and v_entry between 1 and 2147483647 then
        v_limit := v_entry::integer;
      end if;
    end if;
    if v_limit is null then
      raise exception 'knowledge_query_meter_contract_invalid';
    end if;
  elsif exists (
    -- A billing account no plan was ever projected into, with no operator grant on its holder or an active owner:
    -- Free's allowance (20261127070000).
    select 1 from public.foundation_billing_accounts a
     where a.workspace_key = p_workspace_key and a.access_plan is null
       and not exists (select 1 from public.foundation_account_access_grants g where g.user_id = a.user_id and g.active)
  ) and not exists (
    select 1 from public.foundation_workspace_members m
      join public.foundation_account_access_grants g on g.user_id = m.user_id and g.active
     where m.workspace_key = p_workspace_key and m.role = 'owner' and m.state = 'active'
  ) then
    v_limit := 100;
  end if;

  -- Holds no settlement will ever claim (expired a day ago) are dropped; they never counted.
  delete from public.foundation_knowledge_query_holds
    where workspace_key = p_workspace_key and expires_at < v_now - interval '1 day';
  select pg_catalog.count(*)::integer into v_held from public.foundation_knowledge_query_holds
    where workspace_key = p_workspace_key and window_started_at = v_window and expires_at > v_now;

  if v_limit is not null and v_used + v_held >= v_limit then
    return pg_catalog.jsonb_build_object('status', 'exhausted');
  end if;

  insert into public.foundation_knowledge_query_holds (workspace_key, window_started_at, expires_at)
    values (p_workspace_key, v_window, v_now + interval '5 minutes')
    returning hold_id into v_hold;
  return pg_catalog.jsonb_build_object('status', 'admitted', 'hold_id', v_hold);
end;
$$;

create or replace function public.reserve_foundation_intake_admission(
  p_workspace_key text, p_document_id uuid, p_user_id uuid, p_object_key text,
  p_requested_bytes integer, p_declared_mime_type text, p_storage_limits jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan_code text;
  v_entry numeric;
  v_limit bigint;
  v_retained bigint;
  v_replay boolean;
  v_result jsonb;
begin
  -- The same lock the inner function takes first; re-entrant within this transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = p_workspace_key and t.document_id = p_document_id) then
    raise exception 'foundation_intake_source_deleted';
  end if;
  v_plan_code := public.foundation_workspace_capped_plan(p_workspace_key);
  if v_plan_code is not null then
    -- Only a whole, non-negative JSON number is an allowance; anything else is a missing one, not a
    -- cast error. Typed first, cast after: SQL does not promise to skip the cast of a non-number.
    if pg_catalog.jsonb_typeof(p_storage_limits) = 'object'
      and pg_catalog.jsonb_typeof(p_storage_limits -> v_plan_code) = 'number' then
      v_entry := (p_storage_limits ->> v_plan_code)::numeric;
      if v_entry = pg_catalog.trunc(v_entry) and v_entry between 0 and 9223372036854775807 then
        v_limit := v_entry::bigint;
      end if;
    end if;
    if v_limit is null then
      raise exception 'foundation_storage_limit_missing';
    end if;
  elsif exists (
    -- A billing account no plan was ever projected into, with no operator grant on its holder or an active owner:
    -- Free's allowance (20261127070000).
    select 1 from public.foundation_billing_accounts a
     where a.workspace_key = p_workspace_key and a.access_plan is null
       and not exists (select 1 from public.foundation_account_access_grants g where g.user_id = a.user_id and g.active)
  ) and not exists (
    select 1 from public.foundation_workspace_members m
      join public.foundation_account_access_grants g on g.user_id = m.user_id and g.active
     where m.workspace_key = p_workspace_key and m.role = 'owner' and m.state = 'active'
  ) then
    v_limit := 1000000000;
  end if;
  -- A replay of a live or confirmed admission is answered by the inner function and not checked again.
  v_replay := exists (select 1 from public.foundation_intake_admissions a
                       where a.workspace_key = p_workspace_key and a.document_id = p_document_id
                         and (a.confirmed_at is not null or a.expires_at > pg_catalog.clock_timestamp()));
  v_result := public.reserve_foundation_intake_admission_unchecked(p_workspace_key, p_document_id, p_user_id,
    p_object_key, p_requested_bytes, p_declared_mime_type);
  if v_limit is not null and not v_replay then
    -- ponytail: sums the workspace's admissions on every capped admission; keep a running total if this shows up in latency.
    -- The row just written (or re-armed) is live, so it is in the sum.
    select coalesce(pg_catalog.sum(a.requested_bytes), 0) into v_retained
      from public.foundation_intake_admissions a
     where a.workspace_key = p_workspace_key
       and (a.confirmed_at is not null or a.expires_at > pg_catalog.clock_timestamp())
       and not exists (select 1 from public.source_deletion_tombstones t
                        where t.workspace_key = a.workspace_key and t.document_id = a.document_id)
       and not exists (select 1 from public.connector_document_bindings b
                         join public.source_deletion_tombstones t
                           on t.workspace_key = b.workspace_key and t.source_id = b.source_id
                        where b.workspace_key = a.workspace_key and b.document_id = a.document_id);
    if v_retained > v_limit then
      raise exception 'foundation_storage_allowance_exhausted';
    end if;
  end if;
  return v_result;
end;
$$;

commit;
