-- B10: legal-hold-aware source deletion, append-only receipts, and no-resurrection guards.
-- Object removal remains an application-side operation. These functions make claim/finalize
-- durable around that non-transactional boundary and never infer that a missing policy is safe.
begin;

create table public.source_deletion_tombstones (
  deletion_id text primary key check (deletion_id ~ '^sha256:[a-f0-9]{64}$'),
  workspace_key text not null,
  source_id text not null unique,
  oauth_connection_id uuid not null,
  provider text not null check (provider in ('google_drive', 'dropbox', 'microsoft_graph')),
  reason text not null check (reason in ('provider_deleted', 'provider_inaccessible')),
  requested_at timestamptz not null default clock_timestamp(),
  eligible_at timestamptz not null,
  unique (deletion_id, workspace_key, source_id)
);

create table public.source_deletion_objects (
  deletion_id text not null references public.source_deletion_tombstones(deletion_id),
  workspace_key text not null,
  source_id text not null,
  object_key text not null check (length(object_key) between 1 and 1024),
  object_sha256 text not null check (object_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  purged_at timestamptz,
  delete_started_at timestamptz,
  purge_claim_id uuid,
  purge_claim_expires_at timestamptz,
  check ((purge_claim_id is null) = (purge_claim_expires_at is null)),
  check (purged_at is null or (delete_started_at is not null and purge_claim_id is null)),
  foreign key (deletion_id, workspace_key, source_id)
    references public.source_deletion_tombstones(deletion_id, workspace_key, source_id),
  primary key (deletion_id, object_key)
);

create table public.source_deletion_receipts (
  receipt_id text primary key check (receipt_id ~ '^sha256:[a-f0-9]{64}$'),
  deletion_id text not null references public.source_deletion_tombstones(deletion_id),
  workspace_key text not null,
  source_id text not null,
  action text not null check (action in ('tombstoned', 'object_purged')),
  object_key text,
  object_sha256 text check (object_sha256 is null or object_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  object_already_absent boolean,
  payload_sha256 text not null check (payload_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  check ((action = 'tombstoned' and object_key is null and object_sha256 is null and object_already_absent is null)
      or (action = 'object_purged' and object_key is not null and object_sha256 is not null and object_already_absent is not null)),
  foreign key (deletion_id, workspace_key, source_id)
    references public.source_deletion_tombstones(deletion_id, workspace_key, source_id)
);

-- Physical deletion is disabled until a separate producer proves the complete R2 artifact
-- inventory for this source. The current live CDR/OCR path does not yet write every immutable
-- artifact to source_versions/source_representations, so a database-only snapshot is not proof.
create table public.source_deletion_inventory_attestations (
  deletion_id text primary key references public.source_deletion_tombstones(deletion_id),
  workspace_key text not null,
  source_id text not null,
  inventory_manifest_sha256 text not null check (inventory_manifest_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  artifact_count integer not null check (artifact_count >= 0),
  attestation_kind text not null check (attestation_kind = 'complete_r2_prefix_inventory_v1'),
  attested_at timestamptz not null default clock_timestamp(),
  foreign key (deletion_id, workspace_key, source_id)
    references public.source_deletion_tombstones(deletion_id, workspace_key, source_id)
);

create unique index source_deletion_receipts_tombstone_once_idx
  on public.source_deletion_receipts (deletion_id) where action = 'tombstoned';
create unique index source_deletion_receipts_object_once_idx
  on public.source_deletion_receipts (deletion_id, object_key) where action = 'object_purged';

create index source_deletion_objects_pending_idx
  on public.source_deletion_objects (deletion_id, object_key) where purged_at is null;

alter table public.source_deletion_tombstones enable row level security;
alter table public.source_deletion_objects enable row level security;
alter table public.source_deletion_receipts enable row level security;
alter table public.source_deletion_inventory_attestations enable row level security;
revoke all on public.source_deletion_tombstones, public.source_deletion_objects, public.source_deletion_receipts,
  public.source_deletion_inventory_attestations
  from public, anon, authenticated, service_role;
grant select on public.source_deletion_tombstones, public.source_deletion_objects, public.source_deletion_receipts,
  public.source_deletion_inventory_attestations
  to service_role;

create or replace function public.prevent_source_deletion_evidence_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'source_deletion_evidence_append_only';
end;
$$;

create trigger source_deletion_tombstones_append_only
  before update or delete on public.source_deletion_tombstones
  for each row execute function public.prevent_source_deletion_evidence_mutation();
create trigger source_deletion_receipts_append_only
  before update or delete on public.source_deletion_receipts
  for each row execute function public.prevent_source_deletion_evidence_mutation();
create trigger source_deletion_inventory_attestations_append_only
  before update or delete on public.source_deletion_inventory_attestations
  for each row execute function public.prevent_source_deletion_evidence_mutation();

create or replace function public.source_legal_hold_state(p_workspace_key text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_hold boolean; v_count integer;
begin
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

create or replace function public.connector_source_import_allowed(p_workspace_key text, p_source_id text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_workspace_key is null or p_source_id is null or length(p_source_id) > 128 then
    raise exception 'CONNECTOR_SOURCE_IMPORT_SCOPE_INVALID';
  end if;
  return not exists (
    select 1 from public.source_deletion_tombstones t
     where t.workspace_key = p_workspace_key and t.source_id = p_source_id
  );
end;
$$;

create or replace function public.reject_tombstoned_connector_binding()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_deletion_id text;
begin
  v_deletion_id := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'tavonel.source_deletion.v1' || pg_catalog.chr(10) || new.workspace_key || pg_catalog.chr(10) || new.source_id,
    'UTF8'), 'sha256'), 'hex');
  -- Serialize with request_connector_source_deletion. Without the matching lock an import can
  -- pass the existence check before the tombstone commits and then recreate the binding.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_deletion_id, 0));
  if not public.connector_source_import_allowed(new.workspace_key, new.source_id) then
    raise exception 'SOURCE_TOMBSTONED';
  end if;
  return new;
end;
$$;

create trigger connector_binding_no_resurrection
  before insert or update on public.connector_document_bindings
  for each row execute function public.reject_tombstoned_connector_binding();

create or replace function public.guard_legal_hold_against_source_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_workspace record;
begin
  if new.legal_hold_enabled is not true
    or (tg_op = 'UPDATE' and old.legal_hold_enabled is not distinct from new.legal_hold_enabled) then
    return new;
  end if;
  for v_workspace in
    select workspace_key from public.enterprise_workspaces
     where organization_id = new.organization_id order by workspace_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || v_workspace.workspace_key, 0));
    if exists (
      select 1 from public.source_deletion_objects
       where workspace_key = v_workspace.workspace_key and purged_at is null
         and (delete_started_at is not null
           or purge_claim_expires_at > pg_catalog.clock_timestamp())
    ) then
      raise exception 'SOURCE_DELETION_IN_PROGRESS';
    end if;
  end loop;
  return new;
end;
$$;

create trigger legal_hold_waits_for_source_deletion
  before insert or update of legal_hold_enabled on public.enterprise_governance_policies
  for each row execute function public.guard_legal_hold_against_source_deletion();

create or replace function public.prevent_governance_scope_reassignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.organization_id is distinct from new.organization_id then
    raise exception 'GOVERNANCE_SCOPE_REASSIGNMENT_FORBIDDEN';
  end if;
  return new;
end;
$$;

create trigger enterprise_workspace_governance_scope_immutable
  before update of organization_id on public.enterprise_workspaces
  for each row execute function public.prevent_governance_scope_reassignment();
create trigger enterprise_policy_governance_scope_immutable
  before update of organization_id on public.enterprise_governance_policies
  for each row execute function public.prevent_governance_scope_reassignment();

create or replace function public.enqueue_source_deletion_object(
  p_workspace_key text, p_source_id text, p_object_key text, p_object_sha256 text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_deletion_id text;
  v_existing_sha256 text;
begin
  if p_workspace_key is null or p_source_id is null or p_object_key is null
    or length(p_object_key) not between 1 and 1024
    or p_object_sha256 !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'SOURCE_DELETION_OBJECT_INVALID';
  end if;
  v_deletion_id := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'tavonel.source_deletion.v1' || pg_catalog.chr(10) || p_workspace_key || pg_catalog.chr(10) || p_source_id,
    'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_deletion_id, 0));
  perform 1 from public.source_deletion_tombstones
   where deletion_id = v_deletion_id and workspace_key = p_workspace_key and source_id = p_source_id;
  if not found then return false; end if;
  insert into public.source_deletion_objects
    (deletion_id, workspace_key, source_id, object_key, object_sha256)
  values (v_deletion_id, p_workspace_key, p_source_id, p_object_key, p_object_sha256)
  on conflict (deletion_id, object_key) do nothing;
  select object_sha256 into v_existing_sha256 from public.source_deletion_objects
   where deletion_id = v_deletion_id and object_key = p_object_key;
  if v_existing_sha256 is distinct from p_object_sha256 then
    raise exception 'SOURCE_DELETION_OBJECT_DIGEST_CONFLICT';
  end if;
  return true;
end;
$$;

create or replace function public.refresh_source_deletion_inventory(p_workspace_key text, p_source_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_object record;
begin
  for v_object in
    select 'quarantine/' || b.workspace_key || '/' || b.document_id || '/source' as object_key,
           b.content_sha256 as object_sha256
      from public.connector_document_bindings b
     where b.source_id = p_source_id and b.workspace_key = p_workspace_key
    union all
    select v.immutable_object_key, v.content_sha256 from public.source_versions v
     where v.source_id = p_source_id
    union all
    select r.object_key, r.content_sha256 from public.source_representations r
      join public.source_versions v on v.source_version_id = r.source_version_id
     where v.source_id = p_source_id
  loop
    perform public.enqueue_source_deletion_object(
      p_workspace_key, p_source_id, v_object.object_key, v_object.object_sha256);
  end loop;
end;
$$;

create or replace function public.capture_late_source_version_for_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_source public.sources%rowtype;
begin
  select * into v_source from public.sources where source_id = new.source_id;
  if not found then raise exception 'SOURCE_VERSION_SOURCE_MISSING'; end if;
  if public.enqueue_source_deletion_object(v_source.workspace_id, new.source_id,
      new.immutable_object_key, new.content_sha256) then
    new.tombstoned := true;
  end if;
  return new;
end;
$$;

create trigger source_versions_deletion_inventory
  before insert on public.source_versions
  for each row execute function public.capture_late_source_version_for_deletion();

create or replace function public.capture_late_source_representation_for_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_source_id text; v_workspace_key text;
begin
  select v.source_id, s.workspace_id into v_source_id, v_workspace_key
    from public.source_versions v join public.sources s on s.source_id = v.source_id
   where v.source_version_id = new.source_version_id;
  if not found then raise exception 'SOURCE_REPRESENTATION_VERSION_MISSING'; end if;
  perform public.enqueue_source_deletion_object(
    v_workspace_key, v_source_id, new.object_key, new.content_sha256);
  return new;
end;
$$;

create trigger source_representations_deletion_inventory
  before insert on public.source_representations
  for each row execute function public.capture_late_source_representation_for_deletion();

create or replace function public.request_connector_source_deletion(
  p_workspace_key text,
  p_source_id text,
  p_oauth_connection_id uuid,
  p_provider text,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hold text;
  v_deletion_id text;
  v_receipt_id text;
  v_payload jsonb;
  v_payload_sha256 text;
  v_existing public.source_deletion_tombstones%rowtype;
  v_grace_days integer;
  v_eligible_at timestamptz;
begin
  if p_workspace_key is null or p_workspace_key !~ '^pilot-[A-Za-z0-9]{1,16}$'
    or p_source_id is null or p_source_id !~ '^src-[a-f0-9]{64}$'
    or p_oauth_connection_id is null or p_provider is null
    or p_provider not in ('google_drive', 'dropbox', 'microsoft_graph')
    or p_reason is null or p_reason not in ('provider_deleted', 'provider_inaccessible') then
    raise exception 'SOURCE_DELETION_INPUT_INVALID';
  end if;
  v_deletion_id := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'tavonel.source_deletion.v1' || pg_catalog.chr(10) || p_workspace_key || pg_catalog.chr(10) || p_source_id,
    'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_deletion_id, 0));
  -- Legal-hold activation takes the same workspace lock and refuses while pending deletion
  -- objects exist. Whichever intent wins this lock becomes authoritative; the other fails closed.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || p_workspace_key, 0));
  -- The hold state and retention grace must be read while holding the same workspace lock
  -- used by policy activation. Reading either before the lock would let this transaction
  -- persist a purgeable intent from a stale policy snapshot.
  v_hold := public.source_legal_hold_state(p_workspace_key);
  if v_hold = 'unknown' then raise exception 'SOURCE_LEGAL_HOLD_STATE_UNKNOWN'; end if;
  select p.deleted_object_grace_days into v_grace_days
    from public.enterprise_workspaces w
    join public.enterprise_governance_policies p on p.organization_id = w.organization_id
   where w.workspace_key = p_workspace_key;
  if v_grace_days is null or v_grace_days < 0 then raise exception 'SOURCE_LEGAL_HOLD_STATE_UNKNOWN'; end if;
  v_eligible_at := pg_catalog.clock_timestamp() + pg_catalog.make_interval(days => v_grace_days);

  -- A provider may report deletion before a source was imported, so neither binding nor source
  -- is mandatory. The connection is mandatory; any existing binding/source must agree exactly.
  perform 1 from public.foundation_oauth_connections c
   where c.oauth_connection_id = p_oauth_connection_id and c.workspace_key = p_workspace_key
     and c.provider::text = p_provider;
  if not found then raise exception 'SOURCE_DELETION_CONNECTION_MISMATCH'; end if;
  if exists (
    select 1 from public.connector_document_bindings b where b.source_id = p_source_id
      and (b.workspace_key is distinct from p_workspace_key
        or b.oauth_connection_id is distinct from p_oauth_connection_id
        or b.provider is distinct from p_provider)
  ) or exists (
    select 1 from public.sources s where s.source_id = p_source_id
      and (s.workspace_id is distinct from p_workspace_key or s.tenant_id is distinct from p_workspace_key)
  ) then raise exception 'SOURCE_DELETION_BINDING_MISMATCH'; end if;

  select * into v_existing from public.source_deletion_tombstones where deletion_id = v_deletion_id;
  if found then
    if v_existing.workspace_key is distinct from p_workspace_key or v_existing.source_id is distinct from p_source_id
      or v_existing.oauth_connection_id is distinct from p_oauth_connection_id
      or v_existing.provider is distinct from p_provider or v_existing.reason is distinct from p_reason then
      raise exception 'SOURCE_DELETION_IDEMPOTENCY_CONFLICT';
    end if;
    perform public.refresh_source_deletion_inventory(p_workspace_key, p_source_id);
    select receipt_id into v_receipt_id from public.source_deletion_receipts
     where deletion_id = v_deletion_id and action = 'tombstoned' and object_key is null;
    if v_receipt_id is null then raise exception 'SOURCE_DELETION_RECEIPT_MISSING'; end if;
    return pg_catalog.jsonb_build_object('receiptId', v_receipt_id, 'deletionId', v_deletion_id,
      'status', case when v_hold = 'active' then 'held' else 'replayed' end,
      'eligibleAt', v_existing.eligible_at);
  end if;

  insert into public.source_deletion_tombstones
    (deletion_id, workspace_key, source_id, oauth_connection_id, provider, reason, eligible_at)
  values (v_deletion_id, p_workspace_key, p_source_id, p_oauth_connection_id, p_provider, p_reason,
    v_eligible_at);

  update public.sources set tombstoned_at = coalesce(tombstoned_at, clock_timestamp()),
    tombstone_reason = coalesce(tombstone_reason, p_reason) where source_id = p_source_id;
  update public.source_versions set tombstoned = true where source_id = p_source_id;

  perform public.refresh_source_deletion_inventory(p_workspace_key, p_source_id);

  v_payload := pg_catalog.jsonb_build_object('schemaVersion', 'tavonel.source_deletion_receipt.v1',
    'deletionId', v_deletion_id, 'workspaceKey', p_workspace_key, 'sourceId', p_source_id,
    'action', 'tombstoned', 'reason', p_reason);
  v_payload_sha256 := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  v_receipt_id := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'tavonel.source_deletion_receipt.v1' || pg_catalog.chr(10) || v_deletion_id || pg_catalog.chr(10) || 'tombstoned',
    'UTF8'), 'sha256'), 'hex');
  insert into public.source_deletion_receipts
    (receipt_id, deletion_id, workspace_key, source_id, action, payload_sha256)
  values (v_receipt_id, v_deletion_id, p_workspace_key, p_source_id, 'tombstoned', v_payload_sha256);
  return pg_catalog.jsonb_build_object('receiptId', v_receipt_id, 'deletionId', v_deletion_id,
    'status', case when v_hold = 'active' then 'held' else 'recorded' end,
    'eligibleAt', v_eligible_at);
end;
$$;

create or replace function public.claim_source_deletion_sweep(p_limit integer default 1)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_candidate public.source_deletion_objects%rowtype;
begin
  -- One external object per transaction keeps workspace-lock ordering trivial and guarantees
  -- enough of the 120-second lease remains for bounded HEAD + DELETE + finalize I/O.
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
   order by o.deletion_id, o.object_key
   limit 1 for update of o skip locked;
  if not found then return; end if;

  -- Policy activation takes this same lock, then rejects an unexpired lease. Re-read the
  -- policy under the lock before minting that lease so hold activation and purge claim have
  -- a single, deterministic winner.
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

create or replace function public.begin_source_deletion_object(
  p_deletion_id text, p_object_key text, p_object_sha256 text, p_claim_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_object public.source_deletion_objects%rowtype; v_hold text;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$'
    or p_object_key is null or length(p_object_key) not between 1 and 1024
    or p_object_sha256 is null or p_object_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_claim_id is null then raise exception 'SOURCE_DELETION_BEGIN_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_deletion_id || pg_catalog.chr(10) || p_object_key, 0));
  select * into v_object from public.source_deletion_objects
   where deletion_id = p_deletion_id and object_key = p_object_key for update;
  if not found or v_object.object_sha256 is distinct from p_object_sha256 then
    raise exception 'SOURCE_DELETION_OBJECT_CONFLICT';
  end if;
  if v_object.purged_at is not null then
    return pg_catalog.jsonb_build_object('status', 'replayed');
  end if;
  if v_object.purge_claim_id is distinct from p_claim_id
    or v_object.purge_claim_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'SOURCE_DELETION_LEASE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || v_object.workspace_key, 0));
  v_hold := public.source_legal_hold_state(v_object.workspace_key);
  if v_hold = 'active' then raise exception 'SOURCE_LEGAL_HOLD_ACTIVE'; end if;
  if v_hold <> 'inactive' then raise exception 'SOURCE_LEGAL_HOLD_STATE_UNKNOWN'; end if;
  update public.source_deletion_objects set delete_started_at = coalesce(delete_started_at, clock_timestamp())
   where deletion_id = p_deletion_id and object_key = p_object_key
     and purge_claim_id = p_claim_id and purge_claim_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'SOURCE_DELETION_LEASE_INVALID'; end if;
  return pg_catalog.jsonb_build_object('status', 'started');
end;
$$;

create or replace function public.source_deletion_sweep_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'inventoryIncomplete', exists (
      select 1
        from public.source_deletion_tombstones t
       where t.eligible_at <= pg_catalog.clock_timestamp()
         and public.source_legal_hold_state(t.workspace_key) = 'inactive'
         and not exists (
           select 1 from public.source_deletion_inventory_attestations a
            where a.deletion_id = t.deletion_id and a.workspace_key = t.workspace_key
              and a.source_id = t.source_id
         )
    )
  );
$$;

create or replace function public.finalize_source_deletion_object(
  p_deletion_id text, p_object_key text, p_object_sha256 text, p_object_already_absent boolean,
  p_claim_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_object public.source_deletion_objects%rowtype;
  v_updated public.source_deletion_objects%rowtype;
  v_receipt public.source_deletion_receipts%rowtype;
  v_hold text;
  v_receipt_id text;
  v_payload jsonb;
  v_payload_sha256 text;
begin
  if p_deletion_id is null or p_deletion_id !~ '^sha256:[a-f0-9]{64}$'
    or p_object_key is null or length(p_object_key) not between 1 and 1024
    or p_object_sha256 is null or p_object_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or p_object_already_absent is null or p_claim_id is null then
    raise exception 'SOURCE_DELETION_FINALIZE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_deletion_id || pg_catalog.chr(10) || p_object_key, 0));
  select * into v_object from public.source_deletion_objects
   where deletion_id = p_deletion_id and object_key = p_object_key for update;
  if not found or v_object.object_sha256 is distinct from p_object_sha256 then
    raise exception 'SOURCE_DELETION_OBJECT_CONFLICT';
  end if;
  select * into v_receipt from public.source_deletion_receipts
   where deletion_id = p_deletion_id and action = 'object_purged' and object_key = p_object_key;
  if found then
    if v_receipt.object_sha256 is distinct from p_object_sha256
      or v_receipt.object_already_absent is distinct from p_object_already_absent then
      raise exception 'SOURCE_DELETION_FINALIZE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('receiptId', v_receipt.receipt_id, 'status', 'replayed');
  end if;
  if v_object.purge_claim_id is distinct from p_claim_id
    or v_object.purge_claim_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'SOURCE_DELETION_LEASE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'tavonel.source_legal_hold.v1' || pg_catalog.chr(10) || v_object.workspace_key, 0));
  v_hold := public.source_legal_hold_state(v_object.workspace_key);
  if v_hold = 'active' then raise exception 'SOURCE_LEGAL_HOLD_ACTIVE'; end if;
  if v_hold <> 'inactive' then raise exception 'SOURCE_LEGAL_HOLD_STATE_UNKNOWN'; end if;

  v_payload := pg_catalog.jsonb_build_object('schemaVersion', 'tavonel.source_deletion_receipt.v1',
    'deletionId', p_deletion_id, 'workspaceKey', v_object.workspace_key, 'sourceId', v_object.source_id,
    'action', 'object_purged', 'objectKey', p_object_key, 'objectSha256', p_object_sha256,
    'objectAlreadyAbsent', p_object_already_absent);
  v_payload_sha256 := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  v_receipt_id := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'tavonel.source_deletion_receipt.v1' || pg_catalog.chr(10) || p_deletion_id || pg_catalog.chr(10) || p_object_key,
    'UTF8'), 'sha256'), 'hex');
  update public.source_deletion_objects set purged_at = clock_timestamp(),
    purge_claim_id = null, purge_claim_expires_at = null
   where deletion_id = p_deletion_id and object_key = p_object_key
     and object_sha256 = p_object_sha256 and purge_claim_id = p_claim_id
     and purge_claim_expires_at > pg_catalog.clock_timestamp()
     and delete_started_at is not null and purged_at is null
   returning * into v_updated;
  if not found then raise exception 'SOURCE_DELETION_LEASE_INVALID'; end if;
  insert into public.source_deletion_receipts
    (receipt_id, deletion_id, workspace_key, source_id, action, object_key, object_sha256, object_already_absent, payload_sha256)
  values (v_receipt_id, p_deletion_id, v_object.workspace_key, v_object.source_id, 'object_purged',
    p_object_key, p_object_sha256, p_object_already_absent, v_payload_sha256);
  return pg_catalog.jsonb_build_object('receiptId', v_receipt_id, 'status', 'recorded');
end;
$$;

revoke all on function public.source_legal_hold_state(text), public.connector_source_import_allowed(text, text),
  public.request_connector_source_deletion(text, text, uuid, text, text), public.claim_source_deletion_sweep(integer),
  public.begin_source_deletion_object(text, text, text, uuid), public.source_deletion_sweep_status(),
  public.finalize_source_deletion_object(text, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.connector_source_import_allowed(text, text),
  public.request_connector_source_deletion(text, text, uuid, text, text), public.claim_source_deletion_sweep(integer),
  public.begin_source_deletion_object(text, text, text, uuid), public.source_deletion_sweep_status(),
  public.finalize_source_deletion_object(text, text, text, boolean, uuid)
  to service_role;
revoke execute on function public.source_legal_hold_state(text), public.prevent_source_deletion_evidence_mutation(),
  public.reject_tombstoned_connector_binding(), public.guard_legal_hold_against_source_deletion(),
  public.enqueue_source_deletion_object(text, text, text, text),
  public.refresh_source_deletion_inventory(text, text),
  public.capture_late_source_version_for_deletion(),
  public.capture_late_source_representation_for_deletion(),
  public.prevent_governance_scope_reassignment()
  from public, anon, authenticated, service_role;

commit;
