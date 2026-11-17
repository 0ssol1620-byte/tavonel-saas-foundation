-- WO-CAT-5: storage meter. A workspace on a v2 plan is refused an admission that would take its
-- retained source bytes past the plan's storage allowance (STORAGE_ALLOWANCE_EXHAUSTED).
--
-- Where the check sits. reserve_foundation_intake_admission is the tombstone wrapper of
-- 20260927102000; the inner _unchecked function (latest body 20261110040000) is not touched, so
-- its md5 pin (supabase/tests/intake_admission_paid_over_trial.sql, the 20261110040000 rollback
-- guard) still holds. The wrapper takes the per-workspace intake lock first, and the inner
-- function inserts the admission under that same lock in the same transaction, so two admissions
-- that together cross the allowance are serialized and the second one reads the first's row.
--
-- Signatures. A seven-argument wrapper adds p_storage_limits: the catalog's allowance per v2
-- offer code, in bytes ({"personal": 10000000000, ...}, built by nextjs/lib/intake-admission.ts
-- from BILLING_OFFERS, the one place the numbers live). The plan is read here, under the lock,
-- from foundation_billing_accounts.plan_code (one account per workspace; no resolver exists at
-- this base, WO-CAT-3B adds one in TypeScript). The six-argument wrapper keeps working and passes
-- no allowances: a legacy, owner or trial admission behaves exactly as before, and a v2
-- workspace is refused (foundation_storage_limit_missing) rather than admitted uncapped.
--
-- What counts. Retained bytes = requested_bytes of the workspace's admissions that are confirmed
-- or still live (the predicate the rate and daily quotas already use, 0032), minus every
-- admission with a deletion tombstone: an upload tombstone by document_id, a connector tombstone
-- through the document's binding. requested_bytes is NOT NULL (0008) and confirmation refuses an
-- object whose observed length differs (0051), so no admission has an unknown size and nothing
-- is estimated. A tombstone frees the bytes when it is recorded, not when the purge finishes.
--
-- Who is capped. Only a workspace whose billing account carries a v2 plan_code. Null plan_code
-- (legacy observer_access / studio_access, trial, no account) and an owner grant are never
-- refused here. A replay of a live or confirmed admission is answered by the inner function
-- unchanged and is not checked again; re-arming an expired, unconfirmed one is checked.

create function public.reserve_foundation_intake_admission(
  p_workspace_key text, p_document_id uuid, p_user_id uuid, p_object_key text,
  p_requested_bytes integer, p_declared_mime_type text, p_storage_limits jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan_code text;
  v_limit bigint;
  v_retained bigint;
begin
  -- The same lock the inner function takes first; re-entrant within this transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = p_workspace_key and t.document_id = p_document_id) then
    raise exception 'foundation_intake_source_deleted';
  end if;
  select a.plan_code into v_plan_code
    from public.foundation_billing_accounts a where a.workspace_key = p_workspace_key;
  if v_plan_code is not null
    and not exists (select 1 from public.foundation_account_access_grants g
                     where g.user_id = p_user_id and g.active = true and g.trial_exempt = true)
    and not exists (select 1 from public.foundation_intake_admissions a
                     where a.workspace_key = p_workspace_key and a.document_id = p_document_id
                       and (a.confirmed_at is not null or a.expires_at > pg_catalog.clock_timestamp())) then
    v_limit := (p_storage_limits ->> v_plan_code)::bigint;
    if v_limit is null or v_limit < 0 then
      raise exception 'foundation_storage_limit_missing';
    end if;
    -- ponytail: sums the workspace's admissions on every capped admission; keep a running total if this shows up in latency.
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
    if v_retained + p_requested_bytes > v_limit then
      raise exception 'foundation_storage_allowance_exhausted';
    end if;
  end if;
  return public.reserve_foundation_intake_admission_unchecked(p_workspace_key, p_document_id, p_user_id,
    p_object_key, p_requested_bytes, p_declared_mime_type);
end;
$$;

-- The old signature: same grants (create or replace keeps them), no allowances passed.
create or replace function public.reserve_foundation_intake_admission(
  p_workspace_key text, p_document_id uuid, p_user_id uuid, p_object_key text,
  p_requested_bytes integer, p_declared_mime_type text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.reserve_foundation_intake_admission(p_workspace_key, p_document_id, p_user_id,
    p_object_key, p_requested_bytes, p_declared_mime_type, null::jsonb);
end;
$$;

revoke all on function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb)
  to service_role;

comment on function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text, jsonb) is
  'Intake admission: tombstone check, then the v2 storage allowance (WO-CAT-5), then the inner function.';
