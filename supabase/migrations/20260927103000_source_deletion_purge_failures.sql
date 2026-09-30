-- Gate 11: purge-stage failures leave append-only evidence, and the customer's receipt shows it.
--
-- 20260927102000 recorded inventory failures only. A purge attempt that failed after its claim
-- (R2 HEAD/DELETE error, lost lease, finalize error) left nothing behind but an expired claim, so
-- an object the production bucket refuses to delete -- the `immutable/` prefix is under a 365-day
-- object lock (docs/evidence/production/TAVONEL_FOUNDER_TEST_RESET_2026-09-23.md) -- was
-- indistinguishable from one that was simply never tried. Now:
--   - source_deletion_worker_failures accepts stage 'purge', bound to one attested object;
--   - record_source_deletion_purge_failure writes it only for the claim that made the attempt;
--   - customer_source_deletion_status reports each unpurged object's last failure.
-- Nothing here marks an object purged, skips it, or changes the claim order.
--
-- Create-once (add column, named constraints): not part of the replay step in db-rehearsal.yml.
begin;

alter table public.source_deletion_worker_failures add column object_key text;

-- Deliberately not `if exists`: the inline check from 20260927102000 has this default name, and a
-- surviving 'inventory'-only check would make every purge failure record fail loudly anyway.
alter table public.source_deletion_worker_failures drop constraint source_deletion_worker_failures_stage_check;
alter table public.source_deletion_worker_failures add constraint source_deletion_worker_failures_stage_check
  check (stage in ('inventory', 'purge'));
alter table public.source_deletion_worker_failures add constraint source_deletion_worker_failures_stage_shape
  check ((stage = 'inventory' and object_key is null) or (stage = 'purge' and object_key is not null));
alter table public.source_deletion_worker_failures add constraint source_deletion_worker_failures_object_fk
  foreign key (deletion_id, object_key) references public.source_deletion_objects(deletion_id, object_key);

create index source_deletion_worker_failures_object_idx
  on public.source_deletion_worker_failures (deletion_id, object_key, recorded_at desc) where stage = 'purge';

-- Evidence is bound to the attempt: the caller must hold the claim that was handed out for this
-- object (expired is fine -- the claim id stays until the next claim replaces it). A purged object
-- has nothing left to fail.
create function public.record_source_deletion_purge_failure(
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
  return pg_catalog.jsonb_build_object('failureId', v_id);
end;
$$;

-- Body identical to 20260927102000 plus three per-object fields. The failure fields describe only
-- an object still waiting for its receipt; a later success does not erase the history row.
create or replace function public.customer_source_deletion_status(p_workspace_key text, p_document_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'deletionId', t.deletion_id, 'workspaceKey', t.workspace_key, 'documentId', t.document_id,
    'reason', t.reason, 'requestedAt', t.requested_at, 'eligibleAt', t.eligible_at,
    'requestManifestSha256', t.request_manifest_sha256,
    'tombstoneReceiptId', (select r.receipt_id from public.source_deletion_receipts r
                            where r.deletion_id = t.deletion_id and r.action = 'tombstoned'),
    'inventoryManifestSha256', a.inventory_manifest_sha256,
    'artifactCount', a.artifact_count,
    'attestedAt', a.attested_at,
    'objects', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'objectKey', o.object_key, 'objectSha256', o.object_sha256, 'purgedAt', o.purged_at,
        'receiptId', r.receipt_id, 'objectAlreadyAbsent', r.object_already_absent,
        'purgeFailureCount', case when r.receipt_id is null then f.failures else 0 end,
        'lastPurgeFailureCode', case when r.receipt_id is null then f.last_code end,
        'lastPurgeFailureAt', case when r.receipt_id is null then f.last_at end) order by o.object_key)
        from public.source_deletion_objects o
        left join public.source_deletion_receipts r
          on r.deletion_id = o.deletion_id and r.action = 'object_purged' and r.object_key = o.object_key
        left join lateral (
          select pg_catalog.count(*)::integer as failures,
                 (pg_catalog.array_agg(w.code order by w.recorded_at desc, w.failure_id desc))[1] as last_code,
                 pg_catalog.max(w.recorded_at) as last_at
            from public.source_deletion_worker_failures w
           where w.deletion_id = o.deletion_id and w.stage = 'purge' and w.object_key = o.object_key
        ) f on true
       where o.deletion_id = t.deletion_id), '[]'::jsonb))
  from public.source_deletion_tombstones t
  left join public.source_deletion_inventory_attestations a on a.deletion_id = t.deletion_id
  where t.workspace_key = p_workspace_key and t.document_id = p_document_id;
$$;

revoke all on function public.record_source_deletion_purge_failure(text, text, uuid, text),
  public.customer_source_deletion_status(text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_source_deletion_purge_failure(text, text, uuid, text),
  public.customer_source_deletion_status(text, uuid)
  to service_role;

commit;
