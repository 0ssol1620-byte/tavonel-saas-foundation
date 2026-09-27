-- Gates 10 and 11: customer-requested and retention-expired deletion of uploaded sources.
--
-- The connector deletion machinery (20260920132000, 20260921110000, 20260921120000) is reused
-- whole: tombstone -> R2 prefix inventory attestation -> one-object claim/begin/finalize with the
-- legal-hold lock and append-only receipts. Three things kept it connector-only, and this
-- migration changes exactly those three:
--
--   1. source_deletion_tombstones required an OAuth connection and a provider reason. Two upload
--      kinds are added, each with an explicit document_id and a shape check per kind.
--   2. The inventory candidate and attestation derived the document set from
--      connector_document_bindings, which an upload does not have. Both now read one helper that
--      answers the tombstone's own document_id for an upload and the bindings for a connector. An
--      upload tombstone can therefore never attest "zero documents".
--   3. Nothing stopped a deleted upload from being re-admitted. The intake reserve/confirm RPCs are
--      wrapped (renamed, not copied, so their bodies stay byte-identical) with a tombstone check
--      under the same per-workspace intake lock the deletion request takes.
--
-- And four holes that made it unsafe to switch on (sections 1a-1c, and the claim order in 2):
--   - self-service workspaces read their hold from an operator-only table instead of "unknown";
--   - connector_documents_blocked, which every serving path calls, now sees upload tombstones;
--   - inventory failures are recorded per tombstone and rotate it to the back of the queue;
--   - the purge claim rotates a failing object to the back instead of re-claiming it first.
--
-- A presigned PUT issued before the tombstone commits stays valid for up to 300 seconds, and an
-- unconfirmed admission's window closes at expires_at. eligible_at is therefore never earlier than
-- 15 minutes after both, so the attested listing is taken after every outstanding PUT has expired.
--
-- Create-once (add column, rename function): not part of the replay step in db-rehearsal.yml.
begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Tombstone kinds
-- ---------------------------------------------------------------------------------------------

alter table public.source_deletion_tombstones
  alter column oauth_connection_id drop not null,
  alter column provider drop not null,
  add column document_id uuid,
  add column requested_by_user_id uuid,
  add column request_manifest_sha256 text
    check (request_manifest_sha256 is null or request_manifest_sha256 ~ '^sha256:[a-f0-9]{64}$');

-- Deliberately not `if exists`: if the inline check carried another name, the old check would
-- survive, every upload tombstone would be refused, and that has to be loud at migration time.
alter table public.source_deletion_tombstones drop constraint source_deletion_tombstones_reason_check;
alter table public.source_deletion_tombstones add constraint source_deletion_tombstones_reason_check
  check (reason in ('provider_deleted', 'provider_inaccessible', 'customer_requested', 'retention_expired'));

alter table public.source_deletion_tombstones add constraint source_deletion_tombstones_kind_shape check (
  (reason in ('provider_deleted', 'provider_inaccessible')
    and oauth_connection_id is not null and provider is not null
    and document_id is null and requested_by_user_id is null and request_manifest_sha256 is null)
  or (reason = 'customer_requested'
    and oauth_connection_id is null and provider is null
    and document_id is not null and source_id = document_id::text
    and requested_by_user_id is not null and request_manifest_sha256 is not null)
  or (reason = 'retention_expired'
    and oauth_connection_id is null and provider is null
    and document_id is not null and source_id = document_id::text
    and requested_by_user_id is null and request_manifest_sha256 is null)
);

create unique index source_deletion_tombstones_upload_document_idx
  on public.source_deletion_tombstones (workspace_key, document_id) where document_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 1a. Self-service workspaces: a readable hold instead of "no enterprise policy = unknown"
-- ---------------------------------------------------------------------------------------------
--
-- source_legal_hold_state answered "unknown" for every workspace without exactly one enterprise
-- policy, so a self-service workspace could never delete anything. It still does whenever an
-- enterprise row exists but is not exactly one readable policy. What changes: a workspace that is
-- in foundation_workspaces and in no enterprise organization has no enterprise policy that could
-- hold it, so its hold is read from source_operator_legal_holds, an operator-only table (no RPC
-- writes it). An open operator hold is "active" for every workspace, enterprise or not.

create table public.source_operator_legal_holds (
  hold_id uuid primary key default gen_random_uuid(),
  workspace_key text not null references public.foundation_workspaces(workspace_key) on delete restrict,
  reason text not null check (char_length(reason) between 1 and 500),
  placed_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  check (released_at is null or released_at >= placed_at)
);
create index source_operator_legal_holds_open_idx
  on public.source_operator_legal_holds (workspace_key) where released_at is null;
alter table public.source_operator_legal_holds enable row level security;
revoke all on public.source_operator_legal_holds from public, anon, authenticated, service_role;
grant select on public.source_operator_legal_holds to service_role;

-- Placing a hold waits for, and refuses against, an in-flight purge exactly like the enterprise
-- policy trigger (20260920132000). Rows are never deleted; the only update is releasing.
create or replace function public.guard_source_operator_legal_hold()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'source_operator_legal_hold_append_only'; end if;
  if tg_op = 'UPDATE' then
    if old.released_at is not null or new.released_at is null
      or new.hold_id is distinct from old.hold_id or new.workspace_key is distinct from old.workspace_key
      or new.reason is distinct from old.reason or new.placed_at is distinct from old.placed_at then
      raise exception 'source_operator_legal_hold_append_only';
    end if;
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || new.workspace_key, 0));
  if exists (
    select 1 from public.source_deletion_objects
     where workspace_key = new.workspace_key and purged_at is null
       and (delete_started_at is not null or purge_claim_expires_at > pg_catalog.clock_timestamp())
  ) then
    raise exception 'SOURCE_DELETION_IN_PROGRESS';
  end if;
  return new;
end;
$$;

create trigger source_operator_legal_holds_guard
  before insert or update or delete on public.source_operator_legal_holds
  for each row execute function public.guard_source_operator_legal_hold();

create or replace function public.source_legal_hold_state(p_workspace_key text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_hold boolean; v_count integer;
begin
  if exists (select 1 from public.source_operator_legal_holds h
              where h.workspace_key = p_workspace_key and h.released_at is null) then
    return 'active';
  end if;
  if not exists (select 1 from public.enterprise_workspaces w where w.workspace_key = p_workspace_key) then
    return case when exists (select 1 from public.foundation_workspaces f where f.workspace_key = p_workspace_key)
      then 'inactive' else 'unknown' end;
  end if;
  -- Enterprise workspaces: unchanged from 20260920132000.
  select count(*), pg_catalog.bool_or(p.legal_hold_enabled)
    into v_count, v_hold
    from public.enterprise_workspaces w
    join public.enterprise_governance_policies p on p.organization_id = w.organization_id
   where w.workspace_key = p_workspace_key;
  if v_count <> 1 or v_hold is null then return 'unknown'; end if;
  return case when v_hold then 'active' else 'inactive' end;
exception when others then
  return 'unknown';
end;
$$;

-- The enterprise policy's grace, or for a self-service workspace the column default of
-- enterprise_governance_policies.deleted_object_grace_days (0014: 30 days). Null means unknown.
create or replace function public.source_deletion_grace_days(p_workspace_key text)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v_days integer; v_count integer;
begin
  if not exists (select 1 from public.enterprise_workspaces w where w.workspace_key = p_workspace_key) then
    return case when exists (select 1 from public.foundation_workspaces f where f.workspace_key = p_workspace_key)
      then 30 end;
  end if;
  select count(*), pg_catalog.min(p.deleted_object_grace_days) into v_count, v_days
    from public.enterprise_workspaces w
    join public.enterprise_governance_policies p on p.organization_id = w.organization_id
   where w.workspace_key = p_workspace_key;
  return case when v_count = 1 then v_days end;
end;
$$;

-- An enterprise assignment can change the effective hold state without updating the policy.
-- Workspace identity is immutable. Serialize INSERT/DELETE with an in-flight purge and never turn an active or unreadable
-- enterprise hold into an inactive self-service state by deleting its assignment.
create function public.guard_enterprise_workspace_source_hold_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_workspace_key text;
begin
  if tg_op = 'UPDATE' then
    if old.workspace_key is distinct from new.workspace_key then
      raise exception 'ENTERPRISE_WORKSPACE_KEY_IMMUTABLE';
    end if;
    return new;
  end if;
  v_workspace_key := case when tg_op = 'DELETE' then old.workspace_key else new.workspace_key end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || v_workspace_key, 0));
  if exists (
    select 1 from public.source_deletion_objects
     where workspace_key = v_workspace_key and purged_at is null
       and (delete_started_at is not null or purge_claim_expires_at > pg_catalog.clock_timestamp())
  ) then
    raise exception 'SOURCE_DELETION_IN_PROGRESS';
  end if;
  if tg_op = 'DELETE' then
    if public.source_legal_hold_state(v_workspace_key) <> 'inactive' then
      raise exception 'SOURCE_LEGAL_HOLD_ACTIVE_OR_UNKNOWN';
    end if;
    return old;
  end if;
  return new;
end;
$$;

create trigger enterprise_workspace_source_hold_transition
  before insert or update or delete on public.enterprise_workspaces
  for each row execute function public.guard_enterprise_workspace_source_hold_transition();
revoke all on function public.guard_enterprise_workspace_source_hold_transition()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 1b. Serving deny: an upload tombstone blocks every read path at once
-- ---------------------------------------------------------------------------------------------
--
-- Every source, candidate, progress, listing, collection, World, compile, search and Ask path
-- goes through checkConnectorSourceAccess -> connector_documents_blocked. That function only
-- looked at connector bindings, which an upload does not have. Preserve the ACL admission from
-- 20260927101000 while adding the final exists(): a tombstone blocks from the moment it commits and
-- forever after (tombstones are append-only), whether or not any byte has been purged yet.
-- Derived collection artifacts outside the document prefix are never purged, so this deny is
-- the only thing that keeps them from being served.
create or replace function public.connector_documents_blocked(
  p_workspace_key text,
  p_document_ids text[]
) returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_workspace_key is null
    or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_document_ids is null
    or cardinality(p_document_ids) > 2000
    or array_position(p_document_ids, null) is not null then
    raise exception 'CONNECTOR_AUTH_SCOPE_INVALID';
  end if;

  return exists (
    select 1
    from public.connector_document_bindings b
    join public.foundation_oauth_connections c
      on c.oauth_connection_id = b.oauth_connection_id
    left join public.source_versions sv
      on sv.source_version_id = b.source_version_id
    left join public.sources s
      on s.source_id = b.source_id
    where b.workspace_key = p_workspace_key
      and b.document_id::text = any(p_document_ids)
      and (
        c.status <> 'active'
        or c.workspace_key <> b.workspace_key
        or c.provider <> b.provider
        or exists (
          select 1
          from public.connector_source_suspensions css
          where css.source_id = b.source_id
            and css.workspace_key = b.workspace_key
        )
        or sv.tombstoned is true
        or s.tombstoned_at is not null
        or not public.source_version_acl_admits(b.workspace_key, b.source_version_id, b.provider, '[]'::jsonb)
      )
  ) or exists (
    select 1
    from public.source_deletion_tombstones t
    where t.workspace_key = p_workspace_key
      and t.document_id is not null
      and t.document_id::text = any(array(select pg_catalog.lower(d) from pg_catalog.unnest(p_document_ids) d))
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1c. Worker failures: per-item, append-only, and never a reason to skip a deletion
-- ---------------------------------------------------------------------------------------------
--
-- The inventory candidate used to be "the oldest eligible tombstone"; one that could not be
-- attested (empty listing, R2 error, a busy compile) was handed out again on every run and
-- stalled every deletion behind it. Now each failed attempt is recorded here and the candidate
-- order puts the least recently failed tombstone first, so a stuck deletion is retried on every
-- rotation, is visible with its reason, and is never marked done or dropped.
create table public.source_deletion_worker_failures (
  failure_id bigint generated always as identity primary key,
  deletion_id text not null references public.source_deletion_tombstones(deletion_id),
  stage text not null check (stage in ('inventory')),
  code text not null check (code ~ '^[A-Z0-9_]{1,80}$'),
  recorded_at timestamptz not null default clock_timestamp()
);
create index source_deletion_worker_failures_latest_idx
  on public.source_deletion_worker_failures (deletion_id, stage, recorded_at desc);
alter table public.source_deletion_worker_failures enable row level security;
revoke all on public.source_deletion_worker_failures from public, anon, authenticated, service_role;
grant select on public.source_deletion_worker_failures to service_role;
create trigger source_deletion_worker_failures_append_only
  before update or delete on public.source_deletion_worker_failures
  for each row execute function public.prevent_source_deletion_evidence_mutation();

create or replace function public.record_source_deletion_worker_failure(
  p_deletion_id text, p_stage text, p_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$'
    or p_stage is distinct from 'inventory' or p_code is null or p_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'SOURCE_DELETION_FAILURE_INVALID';
  end if;
  insert into public.source_deletion_worker_failures (deletion_id, stage, code)
  values (p_deletion_id, p_stage, p_code)
  returning failure_id into v_id;
  return pg_catalog.jsonb_build_object('failureId', v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. One document-set rule for both tombstone kinds
-- ---------------------------------------------------------------------------------------------

create or replace function public.source_deletion_document_ids(p_deletion_id text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case
    when t.document_id is not null then array[t.document_id]
    else coalesce((
      select pg_catalog.array_agg(distinct b.document_id order by b.document_id)
        from public.connector_document_bindings b
       where b.workspace_key = t.workspace_key and b.source_id = t.source_id
    ), '{}'::uuid[])
  end
  from public.source_deletion_tombstones t
  where t.deletion_id = p_deletion_id;
$$;

-- 20260921120000 took the single oldest eligible tombstone and returned null if it was busy, so
-- one busy or unattestable tombstone stopped every later deletion. Now: least recently failed
-- first (never-failed first), then oldest; a tombstone whose producers are still running is
-- passed over for this run, not returned as "nothing to do". Document sets come from the helper.
-- ponytail: linear scan of unattested eligible tombstones per call; index if that set grows large.
create or replace function public.source_deletion_inventory_candidate()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tombstone public.source_deletion_tombstones%rowtype;
  v_document_ids uuid[];
  v_document_keys text[];
begin
  for v_tombstone in
    select t.*
      from public.source_deletion_tombstones t
     where t.eligible_at <= pg_catalog.clock_timestamp()
       and public.source_legal_hold_state(t.workspace_key) = 'inactive'
       and not exists (
         select 1 from public.source_deletion_inventory_attestations a
          where a.deletion_id = t.deletion_id
       )
     order by (select pg_catalog.max(f.recorded_at) from public.source_deletion_worker_failures f
                where f.deletion_id = t.deletion_id and f.stage = 'inventory') nulls first,
              t.requested_at, t.deletion_id
  loop
    v_document_ids := public.source_deletion_document_ids(v_tombstone.deletion_id);
    v_document_keys := array(select d::text from pg_catalog.unnest(v_document_ids) d);

    -- Do not freeze an inventory while a producer can still write another artifact.
    continue when exists (
      select 1 from public.foundation_compute_reservations r
       where r.workspace_key = v_tombstone.workspace_key
         and r.document_id = any(v_document_ids)
         and r.state::text in ('reserved', 'dispatched')
    ) or exists (
      select 1 from public.foundation_compile_jobs j
       where j.workspace_key = v_tombstone.workspace_key
         and j.document_ids && v_document_keys
         and j.state::text not in ('review_required', 'ready', 'failed', 'cancelled')
    ) or exists (
      select 1 from public.foundation_jobs j
       where j.workspace_key = v_tombstone.workspace_key
         and j.job_type::text = 'source_import'
         and j.state::text in ('queued', 'leased')
    );

    return pg_catalog.jsonb_build_object(
      'deletionId', v_tombstone.deletion_id,
      'workspaceKey', v_tombstone.workspace_key,
      'sourceId', v_tombstone.source_id,
      'documentIds', pg_catalog.to_jsonb(v_document_ids)
    );
  end loop;
  return null;
end;
$$;

create or replace function public.attest_source_deletion_inventory(
  p_deletion_id text,
  p_objects jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tombstone public.source_deletion_tombstones%rowtype;
  v_existing public.source_deletion_inventory_attestations%rowtype;
  v_document_ids uuid[];
  v_document_keys text[];
  v_item jsonb;
  v_key text;
  v_sha text;
  v_size_text text;
  v_size bigint;
  v_count integer;
  v_distinct_count integer;
  v_canonical jsonb;
  v_manifest_payload jsonb;
  v_manifest_sha text;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$'
     or p_objects is null or pg_catalog.jsonb_typeof(p_objects) <> 'array'
     or pg_catalog.jsonb_array_length(p_objects) > 512 then
    raise exception 'SOURCE_DELETION_INVENTORY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_deletion_id, 0));
  select * into v_tombstone
    from public.source_deletion_tombstones
   where deletion_id = p_deletion_id
   for share;
  if not found then raise exception 'SOURCE_DELETION_INVENTORY_TOMBSTONE_MISSING'; end if;
  if v_tombstone.eligible_at > pg_catalog.clock_timestamp() then
    raise exception 'SOURCE_DELETION_INVENTORY_NOT_ELIGIBLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || v_tombstone.workspace_key, 0));
  if public.source_legal_hold_state(v_tombstone.workspace_key) = 'active' then
    raise exception 'SOURCE_LEGAL_HOLD_ACTIVE';
  elsif public.source_legal_hold_state(v_tombstone.workspace_key) <> 'inactive' then
    raise exception 'SOURCE_LEGAL_HOLD_STATE_UNKNOWN';
  end if;

  v_document_ids := public.source_deletion_document_ids(v_tombstone.deletion_id);
  v_document_keys := array(select d::text from pg_catalog.unnest(v_document_ids) d);

  if exists (
    select 1 from public.foundation_compute_reservations r
     where r.workspace_key = v_tombstone.workspace_key
       and r.document_id = any(v_document_ids)
       and r.state::text in ('reserved', 'dispatched')
  ) or exists (
    select 1 from public.foundation_compile_jobs j
     where j.workspace_key = v_tombstone.workspace_key
       and j.document_ids && v_document_keys
       and j.state::text not in ('review_required', 'ready', 'failed', 'cancelled')
  ) or exists (
    select 1 from public.foundation_jobs j
     where j.workspace_key = v_tombstone.workspace_key
       and j.job_type::text = 'source_import'
       and j.state::text in ('queued', 'leased')
  ) then
    raise exception 'SOURCE_DELETION_INVENTORY_NOT_QUIESCENT';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_objects)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or pg_catalog.jsonb_typeof(v_item->'key') <> 'string'
       or pg_catalog.jsonb_typeof(v_item->'sha256') <> 'string'
       or pg_catalog.jsonb_typeof(v_item->'sizeBytes') <> 'number' then
      raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_INVALID';
    end if;
    v_key := v_item->>'key';
    v_sha := v_item->>'sha256';
    v_size_text := v_item->>'sizeBytes';
    if length(v_key) not between 1 and 1024
       or v_key like '/%' or position('..' in v_key) > 0
       or position('\\' in v_key) > 0 or position('//' in v_key) > 0
       or v_sha !~ '^sha256:[a-f0-9]{64}$'
       or v_size_text !~ '^[0-9]+$' then
      raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_INVALID';
    end if;
    v_size := v_size_text::bigint;
    if v_size > 67108864 then raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_TOO_LARGE'; end if;

    if not exists (
      select 1 from pg_catalog.unnest(v_document_ids) d(document_id)
       where pg_catalog.left(v_key, length('quarantine/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'))
               = 'quarantine/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'
          or pg_catalog.left(v_key, length('immutable/' || v_tombstone.workspace_key || '/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'))
               = 'immutable/' || v_tombstone.workspace_key || '/' || v_tombstone.workspace_key || '/' || d.document_id::text || '/'
    ) then
      raise exception 'SOURCE_DELETION_INVENTORY_OBJECT_OUT_OF_SCOPE';
    end if;
  end loop;

  select count(*), count(distinct value->>'key')
    into v_count, v_distinct_count
    from pg_catalog.jsonb_array_elements(p_objects);
  if v_count <> v_distinct_count then raise exception 'SOURCE_DELETION_INVENTORY_DUPLICATE_KEY'; end if;

  -- See 20260921120000. An upload tombstone always names exactly one document, so this refusal
  -- now applies to every upload deletion too: an empty listing is not proof of absence.
  if v_count = 0 and coalesce(pg_catalog.array_length(v_document_ids, 1), 0) > 0 then
    raise exception 'SOURCE_DELETION_INVENTORY_EMPTY';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'key', value->>'key',
        'sha256', value->>'sha256',
        'sizeBytes', (value->>'sizeBytes')::bigint
      ) order by value->>'key'
    ),
    '[]'::jsonb
  ) into v_canonical
  from pg_catalog.jsonb_array_elements(p_objects);

  v_manifest_payload := pg_catalog.jsonb_build_object(
    'schemaVersion', 'tavonel.source_deletion_inventory.v1',
    'deletionId', v_tombstone.deletion_id,
    'workspaceKey', v_tombstone.workspace_key,
    'sourceId', v_tombstone.source_id,
    'objects', v_canonical
  );
  v_manifest_sha := 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_manifest_payload::text, 'UTF8'), 'sha256'), 'hex');

  select * into v_existing from public.source_deletion_inventory_attestations
   where deletion_id = p_deletion_id;
  if found then
    if v_existing.inventory_manifest_sha256 is distinct from v_manifest_sha
       or v_existing.artifact_count is distinct from v_count then
      raise exception 'SOURCE_DELETION_INVENTORY_ATTESTATION_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'replayed', 'manifestSha256', v_manifest_sha, 'artifactCount', v_count);
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(v_canonical)
  loop
    perform public.enqueue_source_deletion_object(
      v_tombstone.workspace_key,
      v_tombstone.source_id,
      v_item->>'key',
      v_item->>'sha256'
    );
  end loop;

  insert into public.source_deletion_inventory_attestations
    (deletion_id, workspace_key, source_id, inventory_manifest_sha256, artifact_count, attestation_kind)
  values
    (v_tombstone.deletion_id, v_tombstone.workspace_key, v_tombstone.source_id,
     v_manifest_sha, v_count, 'complete_r2_prefix_inventory_v1');

  return pg_catalog.jsonb_build_object(
    'status', 'recorded', 'manifestSha256', v_manifest_sha, 'artifactCount', v_count);
end;
$$;

-- Body identical to 20260920132000 except the order: never-claimed objects first, then the one
-- whose last claim expired longest ago. A claim that fails (R2 error, lease lost) leaves its
-- expiry behind, so the failing object moves to the back instead of being handed out first on
-- every run. It is still retried every rotation and never finalized without a receipt.
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

-- ---------------------------------------------------------------------------------------------
-- 3. Recording an upload tombstone
-- ---------------------------------------------------------------------------------------------

-- Callers hold, in this order: the deletion lock, the workspace intake lock, the legal-hold lock.
-- request_connector_source_deletion takes deletion -> legal hold, reserve takes intake only, so no
-- two paths wait on each other in opposite orders.
create or replace function public.record_upload_source_tombstone(
  p_workspace_key text, p_document_id uuid, p_reason text, p_requested_by_user_id uuid,
  p_request_manifest_sha256 text, p_eligible_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_source_id text := p_document_id::text;
  v_deletion_id text;
  v_receipt_id text;
  v_payload jsonb;
begin
  v_deletion_id := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'tavonel.source_deletion.v1' || pg_catalog.chr(10) || p_workspace_key || pg_catalog.chr(10) || v_source_id,
    'UTF8'), 'sha256'), 'hex');
  insert into public.source_deletion_tombstones
    (deletion_id, workspace_key, source_id, reason, eligible_at, document_id, requested_by_user_id,
     request_manifest_sha256)
  values (v_deletion_id, p_workspace_key, v_source_id, p_reason, p_eligible_at, p_document_id,
    p_requested_by_user_id, p_request_manifest_sha256);

  -- Serving deny for the upload's ledger rows, exactly as the connector path does.
  update public.sources set tombstoned_at = coalesce(tombstoned_at, clock_timestamp()),
    tombstone_reason = coalesce(tombstone_reason, p_reason) where source_id = v_source_id;
  update public.source_versions set tombstoned = true where source_id = v_source_id;
  perform public.refresh_source_deletion_inventory(p_workspace_key, v_source_id);

  v_payload := pg_catalog.jsonb_build_object('schemaVersion', 'tavonel.source_deletion_receipt.v1',
    'deletionId', v_deletion_id, 'workspaceKey', p_workspace_key, 'sourceId', v_source_id,
    'action', 'tombstoned', 'reason', p_reason, 'documentId', p_document_id,
    'requestedByUserId', p_requested_by_user_id, 'requestManifestSha256', p_request_manifest_sha256,
    'eligibleAt', p_eligible_at);
  v_receipt_id := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'tavonel.source_deletion_receipt.v1' || pg_catalog.chr(10) || v_deletion_id || pg_catalog.chr(10) || 'tombstoned',
    'UTF8'), 'sha256'), 'hex');
  insert into public.source_deletion_receipts
    (receipt_id, deletion_id, workspace_key, source_id, action, payload_sha256)
  values (v_receipt_id, v_deletion_id, p_workspace_key, v_source_id, 'tombstoned',
    'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'));
  return pg_catalog.jsonb_build_object('receiptId', v_receipt_id, 'deletionId', v_deletion_id,
    'status', 'recorded', 'eligibleAt', p_eligible_at);
end;
$$;

create or replace function public.lock_upload_source_deletion(p_workspace_key text, p_document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to('tavonel.source_deletion.v1' || pg_catalog.chr(10) || p_workspace_key
      || pg_catalog.chr(10) || p_document_id::text, 'UTF8'), 'sha256'), 'hex'), 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || p_workspace_key, 0));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Customer-requested deletion (gate 11)
-- ---------------------------------------------------------------------------------------------

create or replace function public.request_customer_source_deletion(
  p_workspace_key text,
  p_document_id uuid,
  p_requested_by_user_id uuid,
  p_request_manifest_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admission public.foundation_intake_admissions%rowtype;
  v_existing public.source_deletion_tombstones%rowtype;
  v_hold text;
  v_grace_days integer;
  v_now timestamptz;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,32}$'
    or p_document_id is null or p_requested_by_user_id is null
    or p_request_manifest_sha256 is null or p_request_manifest_sha256 !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'CUSTOMER_SOURCE_DELETE_INPUT_INVALID';
  end if;
  perform public.lock_upload_source_deletion(p_workspace_key, p_document_id);

  -- Authorization is repeated here, not trusted from the caller: an owner or admin who is an
  -- active member of this workspace, read under the same transaction that writes the tombstone.
  perform 1 from public.foundation_workspace_members m
   where m.workspace_key = p_workspace_key and m.user_id = p_requested_by_user_id
     and m.state = 'active' and m.role in ('owner', 'admin');
  if not found then raise exception 'CUSTOMER_SOURCE_DELETE_FORBIDDEN'; end if;

  -- The admission is the proof that this workspace uploaded this document. Its primary key is
  -- (workspace_key, document_id), so another tenant's document id is simply not found.
  select * into v_admission from public.foundation_intake_admissions
   where workspace_key = p_workspace_key and document_id = p_document_id;
  if not found then raise exception 'CUSTOMER_SOURCE_NOT_FOUND'; end if;

  select * into v_existing from public.source_deletion_tombstones
   where workspace_key = p_workspace_key and document_id = p_document_id;
  if found then
    return pg_catalog.jsonb_build_object(
      'receiptId', (select r.receipt_id from public.source_deletion_receipts r
                     where r.deletion_id = v_existing.deletion_id and r.action = 'tombstoned'),
      'deletionId', v_existing.deletion_id, 'status', 'replayed', 'eligibleAt', v_existing.eligible_at);
  end if;

  -- A connector-bound document is deleted by its connector (and re-sync would resurrect it).
  if exists (select 1 from public.connector_document_bindings b
              where b.workspace_key = p_workspace_key and b.document_id = p_document_id) then
    raise exception 'CUSTOMER_SOURCE_CONNECTOR_BOUND';
  end if;
  if exists (select 1 from public.sources s where s.source_id = p_document_id::text
              and (s.workspace_id is distinct from p_workspace_key or s.tenant_id is distinct from p_workspace_key)) then
    raise exception 'SOURCE_DELETION_BINDING_MISMATCH';
  end if;

  v_hold := public.source_legal_hold_state(p_workspace_key);
  if v_hold = 'active' then raise exception 'SOURCE_LEGAL_HOLD_ACTIVE'; end if;
  if v_hold <> 'inactive' then raise exception 'SOURCE_LEGAL_HOLD_STATE_UNKNOWN'; end if;
  v_grace_days := public.source_deletion_grace_days(p_workspace_key);
  if v_grace_days is null or v_grace_days < 0 then raise exception 'SOURCE_LEGAL_HOLD_STATE_UNKNOWN'; end if;

  v_now := pg_catalog.clock_timestamp();
  return public.record_upload_source_tombstone(p_workspace_key, p_document_id, 'customer_requested',
    p_requested_by_user_id, p_request_manifest_sha256,
    greatest(v_now + pg_catalog.make_interval(days => v_grace_days), v_now + interval '15 minutes',
      v_admission.expires_at + interval '15 minutes'));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Retention-expired deletion (gate 10)
-- ---------------------------------------------------------------------------------------------

-- One document per call, so one transaction holds one workspace's locks (the claim RPC keeps the
-- same rule). Only confirmed admissions in a workspace with exactly one readable, inactive legal
-- hold policy qualify; rejected and expired admissions are skipped because their bytes may already
-- be gone and an empty listing would stall the attestation queue (SOURCE_DELETION_INVENTORY_EMPTY).
--
-- Self-service workspaces have no retention_days, so retention never selects them. The
-- selection is one function so the dry run (what the canary operator reviews) and the write
-- can never disagree. p_workspace_key scopes both to one canary workspace; null is fleet-wide,
-- which the route refuses unless explicitly armed (docs/CUSTOMER_DATA_GATE_2026-09-06.md §7).
create or replace function public.retention_expired_source_candidates(p_workspace_key text, p_limit integer)
returns table (workspace_key text, document_id uuid, created_at timestamptz, expires_at timestamptz,
  retention_days integer, deleted_object_grace_days integer)
language sql stable security definer set search_path = '' as $$
  select a.workspace_key, a.document_id, a.created_at, a.expires_at, p.retention_days, p.deleted_object_grace_days
    from public.foundation_intake_admissions a
    join public.enterprise_workspaces w on w.workspace_key = a.workspace_key
    join public.enterprise_governance_policies p on p.organization_id = w.organization_id
   where (p_workspace_key is null or a.workspace_key = p_workspace_key)
     and a.confirmed_at is not null
     and a.state::text not in ('rejected', 'expired')
     and a.created_at < pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => p.retention_days)
     and public.source_legal_hold_state(a.workspace_key) = 'inactive'
     and not exists (select 1 from public.source_deletion_tombstones t
                      where t.workspace_key = a.workspace_key and t.document_id = a.document_id)
     and not exists (select 1 from public.connector_document_bindings b
                      where b.workspace_key = a.workspace_key and b.document_id = a.document_id)
     and not exists (select 1 from public.sources s where s.source_id = a.document_id::text
                      and (s.workspace_id is distinct from a.workspace_key or s.tenant_id is distinct from a.workspace_key))
   order by a.created_at, a.workspace_key, a.document_id
   limit least(greatest(coalesce(p_limit, 0), 0), 100);
$$;

create or replace function public.request_retention_expired_source_deletion(p_workspace_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into v_row from public.retention_expired_source_candidates(p_workspace_key, 1);
  if not found then return pg_catalog.jsonb_build_object('status', 'idle'); end if;

  perform public.lock_upload_source_deletion(v_row.workspace_key, v_row.document_id);
  -- Re-read under the locks: a hold enabled or a request recorded since the scan wins.
  if public.source_legal_hold_state(v_row.workspace_key) <> 'inactive' then
    return pg_catalog.jsonb_build_object('status', 'held', 'workspaceKey', v_row.workspace_key);
  end if;
  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = v_row.workspace_key and t.document_id = v_row.document_id) then
    return pg_catalog.jsonb_build_object('status', 'raced');
  end if;
  return public.record_upload_source_tombstone(v_row.workspace_key, v_row.document_id, 'retention_expired',
    null, null,
    greatest(v_now + pg_catalog.make_interval(days => v_row.deleted_object_grace_days),
      v_now + interval '15 minutes', v_row.expires_at + interval '15 minutes'))
    || pg_catalog.jsonb_build_object('workspaceKey', v_row.workspace_key, 'documentId', v_row.document_id,
      'retentionDays', v_row.retention_days);
end;
$$;

-- The server uses this exact candidate form. A reviewed candidate is never silently replaced by
-- the next eligible document if a concurrent request removes it or governance values change.
create function public.request_retention_expired_source_deletion_exact(
  p_workspace_key text, p_document_id uuid, p_expected_created_at timestamptz,
  p_expected_retention_days integer, p_expected_grace_days integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_now timestamptz;
begin
  if p_workspace_key is null or p_document_id is null or p_expected_created_at is null
    or p_expected_retention_days is null or p_expected_grace_days is null then
    return pg_catalog.jsonb_build_object('status', 'changed');
  end if;
  perform public.lock_upload_source_deletion(p_workspace_key, p_document_id);
  select * into v_row from public.retention_expired_source_candidates(p_workspace_key, 25)
    where workspace_key = p_workspace_key and document_id = p_document_id
      and created_at = p_expected_created_at and retention_days = p_expected_retention_days
      and deleted_object_grace_days = p_expected_grace_days;
  if not found then return pg_catalog.jsonb_build_object('status', 'changed'); end if;
  v_now := pg_catalog.clock_timestamp();
  return public.record_upload_source_tombstone(p_workspace_key, p_document_id, 'retention_expired',
    null, null,
    greatest(v_now + pg_catalog.make_interval(days => v_row.deleted_object_grace_days),
      v_now + interval '15 minutes', v_row.expires_at + interval '15 minutes'))
    || pg_catalog.jsonb_build_object('workspaceKey', p_workspace_key, 'documentId', p_document_id,
      'retentionDays', v_row.retention_days);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Status, for the customer's receipt
-- ---------------------------------------------------------------------------------------------

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
        'receiptId', r.receipt_id, 'objectAlreadyAbsent', r.object_already_absent) order by o.object_key)
        from public.source_deletion_objects o
        left join public.source_deletion_receipts r
          on r.deletion_id = o.deletion_id and r.action = 'object_purged' and r.object_key = o.object_key
       where o.deletion_id = t.deletion_id), '[]'::jsonb))
  from public.source_deletion_tombstones t
  left join public.source_deletion_inventory_attestations a on a.deletion_id = t.deletion_id
  where t.workspace_key = p_workspace_key and t.document_id = p_document_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. No resurrection through intake
-- ---------------------------------------------------------------------------------------------

alter function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text)
  rename to reserve_foundation_intake_admission_unchecked;
alter function public.confirm_foundation_intake_admission(text, uuid, uuid, text, bigint, text)
  rename to confirm_foundation_intake_admission_unchecked;

create function public.reserve_foundation_intake_admission(
  p_workspace_key text, p_document_id uuid, p_user_id uuid, p_object_key text,
  p_requested_bytes integer, p_declared_mime_type text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  -- The same lock the inner function takes first; re-entrant within this transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = p_workspace_key and t.document_id = p_document_id) then
    raise exception 'foundation_intake_source_deleted';
  end if;
  return public.reserve_foundation_intake_admission_unchecked(p_workspace_key, p_document_id, p_user_id,
    p_object_key, p_requested_bytes, p_declared_mime_type);
end;
$$;

create function public.confirm_foundation_intake_admission(
  p_workspace_key text, p_document_id uuid, p_user_id uuid,
  p_source_sha256 text default null, p_observed_bytes bigint default null, p_observed_mime text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foundation-intake:' || p_workspace_key, 0));
  if exists (select 1 from public.source_deletion_tombstones t
              where t.workspace_key = p_workspace_key and t.document_id = p_document_id) then
    raise exception 'foundation_intake_source_deleted';
  end if;
  return public.confirm_foundation_intake_admission_unchecked(p_workspace_key, p_document_id, p_user_id,
    p_source_sha256, p_observed_bytes, p_observed_mime);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Grants: the server calls the three entry points, the wrappers, and nothing underneath.
-- ---------------------------------------------------------------------------------------------

revoke all on function public.reserve_foundation_intake_admission_unchecked(text, uuid, uuid, text, integer, text),
  public.confirm_foundation_intake_admission_unchecked(text, uuid, uuid, text, bigint, text),
  public.source_deletion_document_ids(text),
  public.record_upload_source_tombstone(text, uuid, text, uuid, text, timestamptz),
  public.lock_upload_source_deletion(text, uuid),
  public.source_deletion_grace_days(text),
  public.guard_source_operator_legal_hold()
  from public, anon, authenticated, service_role;
-- connector_documents_blocked and claim_source_deletion_sweep keep the grants of their earlier
-- migrations (create or replace preserves them); they are repeated here so this file states them.
revoke all on function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text),
  public.confirm_foundation_intake_admission(text, uuid, uuid, text, bigint, text),
  public.request_customer_source_deletion(text, uuid, uuid, text),
  public.request_retention_expired_source_deletion(text),
  public.request_retention_expired_source_deletion_exact(text, uuid, timestamptz, integer, integer),
  public.retention_expired_source_candidates(text, integer),
  public.customer_source_deletion_status(text, uuid),
  public.source_deletion_inventory_candidate(),
  public.attest_source_deletion_inventory(text, jsonb),
  public.record_source_deletion_worker_failure(text, text, text),
  public.source_legal_hold_state(text),
  public.connector_documents_blocked(text, text[]),
  public.claim_source_deletion_sweep(integer)
  from public, anon, authenticated;
revoke all on function public.request_retention_expired_source_deletion(text) from service_role;
grant execute on function public.reserve_foundation_intake_admission(text, uuid, uuid, text, integer, text),
  public.confirm_foundation_intake_admission(text, uuid, uuid, text, bigint, text),
  public.request_customer_source_deletion(text, uuid, uuid, text),
  public.request_retention_expired_source_deletion_exact(text, uuid, timestamptz, integer, integer),
  public.retention_expired_source_candidates(text, integer),
  public.customer_source_deletion_status(text, uuid),
  public.source_deletion_inventory_candidate(),
  public.attest_source_deletion_inventory(text, jsonb),
  public.record_source_deletion_worker_failure(text, text, text),
  -- Read-only; the lifecycle route asks it directly instead of re-implementing it in TypeScript.
  public.source_legal_hold_state(text),
  public.connector_documents_blocked(text, text[]),
  public.claim_source_deletion_sweep(integer)
  to service_role;

commit;
