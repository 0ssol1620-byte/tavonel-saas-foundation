-- Gate 11: an object the bucket refuses to delete waits a day instead of heading every sweep.
--
-- The `immutable/` prefix is under a bucket object lock (docs/audit/R2_RETENTION_POLICY_2026-09-30.md).
-- 20260927102000 moved a failed claim to the back of the order, but with nothing else due the
-- locked object was still handed out every 15 minutes, and each run returned 503 for a refusal
-- that cannot change within minutes. Now:
--   - source_deletion_objects.purge_not_before holds the earliest time the object may be claimed;
--   - record_source_deletion_purge_failure sets it to now + 24 hours, only for
--     SOURCE_DELETE_OBJECT_LOCKED, and never shortens a later value. The delay is fixed, so a
--     locked object is still retried daily and reports its receipt the day the lock lapses;
--   - the same explicit refusal fences the finished attempt: R2 answered and deleted nothing, so
--     the claim, its expiry and delete_started_at are cleared. A stale begin or finalize with the
--     former claim is refused (SOURCE_DELETION_LEASE_INVALID), a retry needs a new claim once due,
--     and an operator legal hold is no longer refused with SOURCE_DELETION_IN_PROGRESS for an
--     attempt that is over. Every other code (timeouts, ambiguous R2 errors) keeps the claim and
--     the started state, because whether the object was deleted is unknown;
--   - claim_source_deletion_sweep skips an object that is not yet due, so another eligible
--     object is claimed instead.
-- Nothing here marks an object purged or relaxes the tombstone, attestation, legal-hold,
-- import-lease or lease checks. begin/finalize are unchanged.
--
-- Create-once (add column): not part of the replay step in db-rehearsal.yml.
begin;

alter table public.source_deletion_objects add column purge_not_before timestamptz;

-- Body identical to 20260927103000 plus the deferral/fence update after the evidence row. It runs
-- under the same per-object lock as begin/finalize, so no receipt can land in between.
create or replace function public.record_source_deletion_purge_failure(
  p_deletion_id text, p_object_key text, p_claim_id uuid, p_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_object public.source_deletion_objects%rowtype; v_id bigint;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$'
    or p_object_key is null or length(p_object_key) not between 1 and 1024
    or p_claim_id is null or p_code is null or p_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'SOURCE_DELETION_FAILURE_INVALID';
  end if;
  -- Same per-object lock as begin/finalize, so a failure never interleaves with a receipt.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_deletion_id || pg_catalog.chr(10) || p_object_key, 0));
  select * into v_object from public.source_deletion_objects
   where deletion_id = p_deletion_id and object_key = p_object_key for update;
  if not found then raise exception 'SOURCE_DELETION_OBJECT_CONFLICT'; end if;
  if v_object.purged_at is not null then raise exception 'SOURCE_DELETION_ALREADY_PURGED'; end if;
  if v_object.purge_claim_id is distinct from p_claim_id then raise exception 'SOURCE_DELETION_LEASE_INVALID'; end if;
  insert into public.source_deletion_worker_failures (deletion_id, stage, code, object_key)
  values (p_deletion_id, 'purge', p_code, p_object_key)
  returning failure_id into v_id;
  if p_code = 'SOURCE_DELETE_OBJECT_LOCKED' then
    update public.source_deletion_objects
       set purge_not_before = greatest(purge_not_before, pg_catalog.clock_timestamp() + interval '24 hours'),
           purge_claim_id = null, purge_claim_expires_at = null, delete_started_at = null
     where deletion_id = p_deletion_id and object_key = p_object_key;
  end if;
  return pg_catalog.jsonb_build_object('failureId', v_id);
end;
$$;

-- Body identical to 20260927102000 plus the purge_not_before predicate.
create or replace function public.claim_source_deletion_sweep(p_limit integer default 1)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_candidate public.source_deletion_objects%rowtype;
begin
  if p_limit is distinct from 1 then raise exception 'SOURCE_DELETION_LIMIT_INVALID'; end if;

  select o.* into v_candidate
    from public.source_deletion_objects o
    join public.source_deletion_tombstones t on t.deletion_id = o.deletion_id
   where o.purged_at is null
     and t.eligible_at <= pg_catalog.clock_timestamp()
     and exists (
       select 1 from public.source_deletion_inventory_attestations a
        where a.deletion_id = o.deletion_id and a.workspace_key = o.workspace_key
          and a.source_id = o.source_id
     )
     and public.source_legal_hold_state(o.workspace_key) = 'inactive'
     and (o.purge_claim_expires_at is null or o.purge_claim_expires_at <= pg_catalog.clock_timestamp())
     and (o.purge_not_before is null or o.purge_not_before <= pg_catalog.clock_timestamp())
     and not exists (
       select 1 from public.foundation_jobs j
        where j.workspace_key = o.workspace_key and j.job_type = 'source_import'
          and j.state = 'leased' and j.lease_expires_at > pg_catalog.clock_timestamp()
     )
   order by o.purge_claim_expires_at nulls first, o.deletion_id, o.object_key
   limit 1 for update of o skip locked;
  if not found then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || v_candidate.workspace_key, 0));
  if public.source_legal_hold_state(v_candidate.workspace_key) <> 'inactive' then return; end if;
  if exists (
    select 1 from public.foundation_jobs j
     where j.workspace_key = v_candidate.workspace_key and j.job_type = 'source_import'
       and j.state = 'leased' and j.lease_expires_at > pg_catalog.clock_timestamp()
  ) then return; end if;

  update public.source_deletion_objects
     set purge_claim_id = gen_random_uuid(),
         purge_claim_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds'
   where deletion_id = v_candidate.deletion_id and object_key = v_candidate.object_key
   returning * into v_candidate;

  return next pg_catalog.jsonb_build_object('deletionId', v_candidate.deletion_id,
    'workspaceKey', v_candidate.workspace_key, 'sourceId', v_candidate.source_id,
    'objectKey', v_candidate.object_key, 'objectSha256', v_candidate.object_sha256,
    'legalHoldState', 'inactive', 'claimId', v_candidate.purge_claim_id,
    'claimExpiresAt', v_candidate.purge_claim_expires_at);
end;
$$;

-- create or replace preserves grants; restated so this file states them.
revoke all on function public.record_source_deletion_purge_failure(text, text, uuid, text),
  public.claim_source_deletion_sweep(integer)
  from public, anon, authenticated;
grant execute on function public.record_source_deletion_purge_failure(text, text, uuid, text),
  public.claim_source_deletion_sweep(integer)
  to service_role;

commit;
