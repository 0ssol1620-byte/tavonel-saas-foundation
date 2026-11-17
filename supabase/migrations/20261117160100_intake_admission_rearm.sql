-- WO-CAT-9 (workorders/catalog-v2.md §16): re-arming an expired upload admission works, and a
-- storage allowance that is not a number is refused as missing.
--
-- Ordering: 20261117160100, assigned by the lead, after 20261117160000_catalog_v2_meter_closure.
-- Both functions are redefined from their latest definitions with `create or replace`, which keeps
-- owner, grants and comments; signatures and callers are unchanged:
--   reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text)   20261110040000
--   reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)       20261117160000
-- Rollback: supabase/drafts/rollback-20261117160100-intake-admission-rearm.sql.
--
-- 1. The re-arm. An unconfirmed admission expires at created_at + 10 minutes. Retrying the same
--    file after that re-armed it with expires_at = now + 10 minutes and left created_at, so the new
--    row broke foundation_intake_admissions_check1 (expires_at <= created_at + 15 minutes, 0008) on
--    every re-arm: 23514, answered INTAKE_ADMISSION_FAILED (503). The re-armed row now gets a
--    consistent pair, created_at = now and expires_at = now + 10 minutes. The check is unchanged.
--    created_at therefore means "the start of the admission's current window"; no column keeps the
--    first sighting. Its readers: the minute and day intake quotas in this function (a re-armed,
--    live admission counts in the windows its new transfer falls in), retention_expired_source_
--    candidates (20260927102000; confirmed admissions only, whose bytes arrive after the re-arm)
--    and confirmed_after_create (confirmed_at >= created_at; confirmation follows the re-arm).
--    Nothing reads the first sighting, so nothing loses it.
-- 2. The storage allowance. A map entry that is not a JSON number (a string, an object, a fraction,
--    out of bigint range) was cast and failed with 22P02/22003, or a numeric string was accepted.
--    It is now foundation_storage_limit_missing, as the query and seat meters refuse theirs.
begin;

create or replace function public.reserve_foundation_intake_admission_unchecked(
  p_workspace_key text,
  p_document_id uuid,
  p_user_id uuid,
  p_object_key text,
  p_requested_bytes integer,
  p_declared_mime_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.foundation_intake_admissions%rowtype;
  v_trial public.foundation_self_service_trials%rowtype;
  v_policy public.foundation_trial_policy%rowtype;
  v_owner boolean := false;
  v_paid boolean := false;
  v_is_trial boolean := false;
  minute_count integer;
  minute_bytes bigint;
  day_count integer;
  day_bytes bigint;
  trial_file_count integer;
  expires_at_value timestamptz;
  v_minute_count_limit integer := 20;
  v_minute_byte_limit bigint := 524288000; -- 500 MiB
  v_day_count_limit integer := 200;
  v_day_byte_limit bigint := 2147483648; -- 2 GiB
begin
  if p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_object_key <> ('quarantine/' || p_workspace_key || '/' || p_document_id::text || '/source')
    or p_requested_bytes < 1
    or char_length(p_declared_mime_type) < 3 or char_length(p_declared_mime_type) > 160 then
    raise exception 'foundation_intake_admission_invalid';
  end if;
  -- The processing ceiling, not an application preference. Admitting more than the CDR worker and
  -- the rasterizer will read is not a larger limit, it is a refusal the customer cannot see.
  if p_requested_bytes > 5242880 then -- 5 MiB
    raise exception 'foundation_intake_file_too_large';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('foundation-intake:' || p_workspace_key, 0));

  select * into existing from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and document_id = p_document_id for update;
  if found then
    if existing.user_id <> p_user_id or existing.object_key <> p_object_key
      or existing.declared_mime_type <> p_declared_mime_type then
      raise exception 'foundation_intake_idempotency_conflict';
    end if;
    if existing.confirmed_at is not null then
      return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
        'expiresAt', existing.expires_at, 'idempotentReplay', true, 'confirmed', true);
    end if;
    if existing.expires_at <= clock_timestamp() then
      -- A re-arm opens a new window, so created_at moves with expires_at: the table's check
      -- (expires_at <= created_at + 15 minutes, 0008) cannot hold for an expired row otherwise.
      expires_at_value := clock_timestamp() + interval '10 minutes';
      update public.foundation_intake_admissions
      set requested_bytes = p_requested_bytes, created_at = expires_at_value - interval '10 minutes',
        expires_at = expires_at_value
      where workspace_key = p_workspace_key and document_id = p_document_id
      returning * into existing;
    end if;
    return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
      'expiresAt', existing.expires_at, 'idempotentReplay', false, 'confirmed', false);
  end if;

  select exists(
    select 1 from public.foundation_account_access_grants
     where user_id = p_user_id and active = true and trial_exempt = true
  ) into v_owner;

  -- An active paid plan is this workspace's entitlement, whatever trial row it also carries. Every
  -- trial that converts keeps its row ('converted', 0045) and every lapsed one keeps 'expired', so
  -- reading the trial first refused every paying customer who had ever evaluated. The paid test is
  -- the one billingProductDecision (nextjs/lib/billing-product-access.ts) and
  -- reserve_foundation_compute_v3 (0045) already apply. Without it the trial branch below is
  -- unchanged: an expired or converted trial and no plan is still refused.
  if not v_owner then
    select exists(
      select 1 from public.foundation_billing_accounts a
       where a.workspace_key = p_workspace_key and a.user_id = p_user_id
         and a.billing_hold = false
         and a.access_plan in ('observer_access', 'studio_access')
         and a.subscription_status in ('active', 'trialing')
         and (a.subscription_cancel_at is null or a.subscription_cancel_at > clock_timestamp())
    ) into v_paid;
  end if;

  if not v_owner and not v_paid then
    select * into v_trial from public.foundation_self_service_trials
     where user_id = p_user_id and workspace_key = p_workspace_key for update;
    if found then
      v_is_trial := true;
      if v_trial.status <> 'trialing' or v_trial.expires_at <= clock_timestamp() then
        raise exception 'foundation_trial_not_active';
      end if;
      -- Free evaluation is bounded independently, and never above the processing ceiling. The
      -- guard above already refuses everything this one would; it stays so the trial bound is
      -- still stated here if the two numbers ever diverge again.
      if p_requested_bytes > 5242880 then -- min(50 MiB trial bound, 5 MiB processing ceiling)
        raise exception 'foundation_trial_file_too_large';
      end if;
      select * into v_policy from public.foundation_trial_policy where policy_key = 'default';
      select count(*) into trial_file_count
        from public.foundation_intake_admissions
       where workspace_key = p_workspace_key
         and (confirmed_at is not null or expires_at > clock_timestamp());
      if trial_file_count >= v_policy.file_limit then
        raise exception 'foundation_trial_file_limit_exceeded';
      end if;
      -- Trial already has a three-file / fifty-page contract; keep transfer velocity modest too.
      v_minute_count_limit := 5;
      v_minute_byte_limit := 104857600; -- 100 MiB
      v_day_count_limit := 10;
      v_day_byte_limit := 157286400; -- 150 MiB
    end if;
  end if;

  select count(*), coalesce(sum(requested_bytes), 0) into minute_count, minute_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '1 minute'
    and (confirmed_at is not null or expires_at > clock_timestamp());
  if minute_count >= v_minute_count_limit or minute_bytes + p_requested_bytes > v_minute_byte_limit then
    raise exception 'foundation_intake_rate_limited';
  end if;

  select count(*), coalesce(sum(requested_bytes), 0) into day_count, day_bytes
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and created_at >= clock_timestamp() - interval '24 hours'
    and (confirmed_at is not null or expires_at > clock_timestamp());
  if day_count >= v_day_count_limit or day_bytes + p_requested_bytes > v_day_byte_limit then
    raise exception 'foundation_intake_daily_quota_exceeded';
  end if;

  expires_at_value := clock_timestamp() + interval '10 minutes';
  insert into public.foundation_intake_admissions (
    workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type, expires_at
  ) values (
    p_workspace_key, p_document_id, p_user_id, p_object_key, p_requested_bytes, p_declared_mime_type, expires_at_value
  );
  return jsonb_build_object('documentId', p_document_id, 'objectKey', p_object_key,
    'expiresAt', expires_at_value, 'idempotentReplay', false, 'confirmed', false,
    'intakeClass', case when v_is_trial then 'trial' when v_owner then 'owner' else 'paid' end);
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

commit;
