-- Rollback for migration 20261127070000_meters_unplanned_billing_row (WO-METER-NULLPLAN-1).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261127070000 was
-- applied. It undoes exactly that change and refuses to run over anything else, including itself:
-- a second run finds the restored bodies, not the ones it guards on, and stops.
--
--   1. Asserts both functions are the bodies 20261127070000 installed (md5 of pg_get_functiondef with
--      carriage returns removed; measured on a local PG 17.2 cluster, the hosted rehearsal confirms it):
--        admit_foundation_knowledge_query(text,jsonb)                                   2e0fc6169fb0eed6c0f016dc7fccc2eb
--        reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)     76e0d93f04a8338a8d74d927a1298f5e
--   2. Restores, with `create or replace` (owner and grants kept), the body 20261117160000 installed for the
--      query meter and the body 20261117160100 installed for the storage wrapper, copied from those files.
--   3. Asserts the restored bodies are the ones the older rollback drafts guard on:
--        admit_foundation_knowledge_query(text,jsonb)                                   29216601286ba470e074b645b5e6fd7d
--          (supabase/drafts/rollback-20261117160000-catalog-v2-meter-closure.sql)
--        reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)     5c2fd1f532fd30259819b8fafe421532
--          (supabase/drafts/rollback-20261117160100-*.sql and rollback-20261117160200-*.sql)
--
-- What the rollback brings back: a workspace whose billing account holds no plan level (transaction.completed
-- landed before its subscription event, or that event never projected) is uncapped again on queries and
-- storage. Units and admissions recorded while the Free allowance applied are not touched (the migration
-- wrote no row).
--
-- Recording it: this file does not edit supabase_migrations.schema_migrations. After it commits, the
-- operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261127070000';
-- in the same session, and writes the version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
declare
  v_key text;
  v_expected jsonb := '{"admit_foundation_knowledge_query(text,jsonb)": "2e0fc6169fb0eed6c0f016dc7fccc2eb",
    "reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)": "76e0d93f04a8338a8d74d927a1298f5e"}';
begin
  for v_key in select jsonb_object_keys(v_expected) loop
    if to_regprocedure('public.' || v_key) is null
      or md5(replace(pg_get_functiondef(to_regprocedure('public.' || v_key)), E'\r', '')) <> v_expected ->> v_key then
      raise exception 'rollback-20261127070000 refused: public.% is not the function 20261127070000 installed', v_key;
    end if;
  end loop;
end
$guard$;

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

do $verify$
declare
  v_key text;
  v_expected jsonb := '{"admit_foundation_knowledge_query(text,jsonb)": "29216601286ba470e074b645b5e6fd7d",
    "reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)": "5c2fd1f532fd30259819b8fafe421532"}';
begin
  for v_key in select jsonb_object_keys(v_expected) loop
    if md5(replace(pg_get_functiondef(to_regprocedure('public.' || v_key)), E'\r', '')) <> v_expected ->> v_key then
      raise exception 'rollback-20261127070000: public.% was not restored to its earlier body', v_key;
    end if;
  end loop;
end
$verify$;

commit;
