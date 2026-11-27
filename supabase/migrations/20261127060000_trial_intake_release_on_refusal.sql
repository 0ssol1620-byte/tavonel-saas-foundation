-- WO-TRIAL-RELEASE-1 (first-5-minutes audit #20): an upload the server refuses after its intake admission
-- was reserved no longer holds a slot of the free evaluation's three files.
--
-- DRAFT. Not applied by its author; the lead dispatches the hosted DB rehearsal
-- (supabase/tests/trial_intake_release_on_refusal.sql is the proof) before this reaches any project.
-- Ordering: 20261127060000, after production's head 20261127055721 (the seat-race migration, repo 20261127050000)
-- and before the meter lane's 20261127070000 and LF-2's 20261127110000 (review-MIGRATIONS-3 r1 N1; was 20261127030000).
--
-- The lifecycle, and what was wrong. The capability route reserves the admission
-- (reserve_foundation_intake_admission -> _unchecked, 10-minute window), then the compute hold
-- (reserve_foundation_compute_v3). A compute refusal (trial page limit, spend stop, credits, ...) rolls
-- back the hold only: the admission stayed live, unconfirmed, for its window, and every count of
-- _unchecked (trial file count, minute and day quotas) and the storage sum of the wrapper count
-- `confirmed_at is not null or expires_at > now`, never `state`. The route never released it, and
-- refuse_foundation_intake_admission (0051) only set state = 'rejected'. An admission that EXPIRED
-- unconfirmed is already not counted (that predicate), and its retry is re-armed through every check
-- (20261117160200); that half needed no change.
--
-- The fix: a refusal closes the window, so the existing predicate stops counting it -- no count is
-- rewritten and no second notion of "counted" exists.
--   1. refuse_foundation_intake_admission: an unconfirmed admission's expires_at becomes
--      least(expires_at, now). Confirmed ones (the CDR refusal of a file that arrived, the only caller
--      until now) are unchanged: state = 'rejected', window kept, still counted.
--   2. reserve_foundation_intake_admission_unchecked: the re-arm of an expired admission (the path a
--      refused one now takes on retry, through every check a first reservation passes, under the same
--      workspace lock) also turns state 'rejected' back into 'requested'. Nothing else changes.
--   3. confirm_foundation_intake_admission (the wrapper the server calls): a rejected, unconfirmed
--      admission cannot be confirmed (foundation_intake_admission_refused). Without it an upload URL
--      issued earlier for the same document could still confirm a file the counts had released.
-- The route (nextjs/app/api/uploads/capability/route.ts) calls (1) after a compute refusal of an
-- unconfirmed admission. A failed release leaves the slot held until the window ends (the old answer).
--
-- Paid and owner workspaces: no trial count applies. The visible difference is (1): a refused, never
-- uploaded admission leaves the minute/day quotas and the storage sum at once rather than after ten
-- minutes. Every confirmed or live admission is counted exactly as before.
--
-- Expand-type and idempotent: create or replace on existing signatures, no table, type or grant change
-- (create or replace keeps owner, grants and comments).
-- Rollback: supabase/drafts/rollback-20261127060000-trial-intake-release-on-refusal.sql.
-- predecessor-hash: public.refuse_foundation_intake_admission 535c4af9f82972822d1fa5ed01bc63f065eb8871bd8912e99e2fb2f935eb787e
-- predecessor: public.refuse_foundation_intake_admission 0051
-- predecessor-hash: public.reserve_foundation_intake_admission_unchecked 206c8e6b16c2d4eed4ceffd084a9f282ab96bb29bff404f6de008d2baded4c40
-- predecessor: public.reserve_foundation_intake_admission_unchecked 20261124000100
-- predecessor-hash: public.confirm_foundation_intake_admission bf07499c88fbcce984c391b26baf17d03b57dce5ead25d883d3f4b629e4b750f
-- predecessor: public.confirm_foundation_intake_admission 20260927102000
begin;

create or replace function public.refuse_foundation_intake_admission(
  p_workspace_key text,
  p_document_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admission public.foundation_intake_admissions%rowtype;
begin
  if p_reason_code !~ '^[A-Z][A-Z0-9_]{2,79}$' then
    raise exception 'foundation_intake_refusal_invalid';
  end if;
  select * into admission
  from public.foundation_intake_admissions
  where workspace_key = p_workspace_key and document_id = p_document_id
  for update;
  if not found then
    raise exception 'foundation_intake_refusal_not_found';
  end if;
  -- Queue delivery is at-least-once, so this says the same thing twice without changing anything
  -- the second time. A source already read cannot be un-read by a late refusal, either.
  if admission.state in ('ocr_ready', 'sanitized') then
    return jsonb_build_object('status', 'ignored', 'documentId', admission.document_id, 'state', admission.state);
  end if;
  -- An admission refused before its upload was confirmed never held a file: its window closes now,
  -- so the trial file count, the minute and day quotas and the storage sum (each reads confirmed or
  -- live admissions only) stop counting it at once instead of after ten minutes. A confirmed one
  -- (a CDR refusal of a file that arrived) keeps its window and stays counted.
  update public.foundation_intake_admissions
  set state = 'rejected', updated_at = now(),
      expires_at = case when confirmed_at is null then least(expires_at, clock_timestamp()) else expires_at end
  where workspace_key = p_workspace_key and document_id = p_document_id
  returning * into admission;
  return jsonb_build_object('status', 'refused', 'documentId', admission.document_id, 'state', admission.state);
end;
$$;

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
  v_rearm boolean := false;
  v_payer uuid;
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
    if existing.expires_at > clock_timestamp() then
      return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
        'expiresAt', existing.expires_at, 'idempotentReplay', false, 'confirmed', false);
    end if;
    -- Expired and unconfirmed: re-armed below, only after every check a first reservation passes.
    -- It is the candidate, counted once: the counts below skip it (neither confirmed nor live).
    v_rearm := true;
  end if;

  -- The workspace payer's grant and plan for an active admin or member, the caller's own otherwise
  -- (unchanged). The admission row keeps the uploader in user_id.
  v_payer := public.foundation_workspace_payer(p_workspace_key, p_user_id);

  select exists(
    select 1 from public.foundation_account_access_grants
     where user_id = v_payer and active = true and trial_exempt = true
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
       where a.workspace_key = p_workspace_key and a.user_id = v_payer
         and a.billing_hold = false
         and a.access_plan in ('observer_access', 'studio_access')
         and a.subscription_status in ('active', 'trialing')
         and (a.subscription_cancel_at is null or a.subscription_cancel_at > clock_timestamp())
    ) into v_paid;
  end if;

  if not v_owner and not v_paid then
    -- A free evaluation is one person's: a member never draws on the owner's, nor uploads unpaid.
    if v_payer <> p_user_id then raise exception 'foundation_subscription_required'; end if;
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
  if v_rearm then
    -- A re-arm opens a new window, so created_at moves with expires_at: the table's check
    -- (expires_at <= created_at + 15 minutes, 0008) cannot hold for an expired row otherwise.
    update public.foundation_intake_admissions
    set requested_bytes = p_requested_bytes, created_at = expires_at_value - interval '10 minutes',
      expires_at = expires_at_value,
      -- A refused upload retried is a request again, never a confirmable refusal.
      state = case when existing.state = 'rejected' then 'requested'::public.foundation_intake_state
                   else existing.state end
    where workspace_key = p_workspace_key and document_id = p_document_id
    returning * into existing;
    return jsonb_build_object('documentId', existing.document_id, 'objectKey', existing.object_key,
      'expiresAt', existing.expires_at, 'idempotentReplay', false, 'confirmed', false);
  end if;
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

create or replace function public.confirm_foundation_intake_admission(
  p_workspace_key text, p_document_id uuid, p_user_id uuid,
  p_source_sha256 text default null, p_observed_bytes bigint default null, p_observed_mime text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = p_workspace_key and t.document_id = p_document_id) then
    raise exception 'foundation_intake_source_deleted';
  end if;
  -- A refused admission is no longer counted, so it can never become a file either.
  if exists (select 1 from public.foundation_intake_admissions a
              where a.workspace_key = p_workspace_key and a.document_id = p_document_id
                and a.state::text = 'rejected' and a.confirmed_at is null) then
    raise exception 'foundation_intake_admission_refused';
  end if;
  return public.confirm_foundation_intake_admission_unchecked(p_workspace_key, p_document_id, p_user_id,
    p_source_sha256, p_observed_bytes, p_observed_mime);
end;
$$;

commit;
