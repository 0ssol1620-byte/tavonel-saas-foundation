-- Rollback for migration 20261117160200_intake_admission_rearm_checks (WO-CAT-10).
--
-- Not a migration: run by hand, as one transaction, against the database where 20261117160200 was
-- applied. It undoes exactly that change and refuses to run over anything else, including itself:
-- a second run finds the restored body, not the one it guards on, and stops.
--
-- Order: this rollback comes before the rollback of 20261117160100 (and so before those of
-- 20261117160000 and 20261110040000); 20261117160100's rollback guards on the body this file restores
-- and refuses until it has run.
--
--   1. Asserts the functions are the ones 20261117160200 left (md5 of pg_get_functiondef):
--        reserve_foundation_intake_admission_unchecked(text,uuid,uuid,text,integer,text)  240678b7f388b6e4b6f75dbe3cf0191e
--        reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)     5c2fd1f532fd30259819b8fafe421532
--      (the wrapper is 20261117160100's, untouched by 20261117160200). Anything else stops here.
--   2. Restores the inner function of 20261117160100 with `create or replace`, which keeps owner,
--      grants and comments.
--   3. Asserts the restored body is byte-for-byte the earlier one, and the wrapper is unchanged:
--        reserve_foundation_intake_admission_unchecked(text,uuid,uuid,text,integer,text)  7a71d28126582df7b7ec34b07b4b3cff
--        reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)     5c2fd1f532fd30259819b8fafe421532
--
-- No table changes and no row is written by the migration. What the rollback brings back: an
-- expired, unconfirmed admission is re-armed before the trial, paid and quota checks again
-- (decision CAT-D15 is then open). Recording it: this file does not edit
-- supabase_migrations.schema_migrations. After it commits, the operator runs
--   delete from supabase_migrations.schema_migrations where version = '20261117160200';
-- in the same session, and writes the version, the time, the md5s above and who ran it into the
-- campaign ledger.
\set ON_ERROR_STOP on
begin;

do $guard$
declare
  v_expected jsonb := '{"reserve_foundation_intake_admission_unchecked(text,uuid,uuid,text,integer,text)": "240678b7f388b6e4b6f75dbe3cf0191e",
    "reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)": "5c2fd1f532fd30259819b8fafe421532"}';
  v_key text;
begin
  for v_key in select jsonb_object_keys(v_expected) loop
    if to_regprocedure('public.' || v_key) is null
      or md5(pg_get_functiondef(to_regprocedure('public.' || v_key))) <> v_expected ->> v_key then
      raise exception 'rollback-20261117160200 refused: public.% is not the function 20261117160200 left', v_key;
    end if;
  end loop;
end
$guard$;

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

do $verify$
declare
  v_expected jsonb := '{"reserve_foundation_intake_admission_unchecked(text,uuid,uuid,text,integer,text)": "7a71d28126582df7b7ec34b07b4b3cff",
    "reserve_foundation_intake_admission(text,uuid,uuid,text,integer,text,jsonb)": "5c2fd1f532fd30259819b8fafe421532"}';
  v_key text;
begin
  for v_key in select jsonb_object_keys(v_expected) loop
    if md5(pg_get_functiondef(to_regprocedure('public.' || v_key))) <> v_expected ->> v_key then
      raise exception 'rollback-20261117160200: restored public.% differs from its earlier definition', v_key;
    end if;
  end loop;
end
$verify$;

commit;
