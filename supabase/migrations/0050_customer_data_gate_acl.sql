-- 0050 — the customer-data gate's durable record, and the ACL a source version carried.
--
-- Why a table at all. `route.privacyPolicy` has spelled `approved_customer_data` since the compile
-- envelope was written, and the only thing standing between that string and real customer bytes is
-- one `!==` comparison in `shared/productCoreCompileEnvelope.ts`. A comparison leaves no trace: if
-- it is ever relaxed, nothing anywhere says who decided that, on what evidence, or when. These two
-- tables are where the evidence lives, so that turning the gate green is an act that writes a row
-- rather than an act that deletes a line.
--
-- Nothing in this migration enables anything. No row is inserted here, no default is permissive,
-- and `activationPolicy.customerData.enabled` is `false` in `nextjs/lib/activation-policy.ts`. The
-- seventeen preconditions are listed in `shared/uskcEnums.ts` and their current status -- EXISTS,
-- PARTIAL or MISSING, with paths -- in `docs/CUSTOMER_DATA_GATE_2026-09-06.md`. Several are MISSING
-- today, so no evidence set can currently produce an allowed decision, which is the intended state.
--
-- Audit trail: gate decisions are recorded as `enterprise_audit_events` (migration 0014), action
-- `customer_data.gate_evaluated`, target_type `workspace`, outcome `succeeded` for an allowed
-- decision and `denied` for a refusal. That table is chosen over
-- `foundation_developer_audit_events` (0012) because it already models `outcome` (a refusal is the
-- event that matters most here and 0012 has nowhere to put one), `actor_kind = 'system'`, and a
-- governed `audit_retention_days`; and because its `action` is a regex rather than 0012's closed
-- enum, so recording a gate event needs no ALTER of a live table. The cost is stated rather than
-- hidden: `enterprise_audit_events.organization_id` is a NOT NULL reference to
-- `enterprise_organizations`, so a workspace with no organization row cannot record a gate event
-- and therefore cannot be approved. That is the fail-closed direction. No third audit table.
--
-- No foreign key to `public.source_versions` yet. That table arrives in 0049 on a sibling branch of
-- the same campaign; a cross-branch FK is the merge hazard the campaign's migration numbering was
-- allocated to avoid. The exact ALTER to add once both are merged is written in
-- docs/CUSTOMER_DATA_GATE_2026-09-06.md. Until then nothing writes these tables, so the referential
-- gap has no live consequence.
begin;

-- The ACL a source version carried at the moment it was read.
--
-- Read `shared/aclSnapshot.ts` for the rule this supports: derived knowledge may never be more
-- permissive than every source evidence governing it. Storage is not enforcement -- no retrieval
-- path filters by these principals today, and no connector captures them at ingestion. The
-- precondition `per_source_acl_preserved` therefore stays MISSING until both exist.
create table if not exists public.source_acl_snapshots (
  acl_snapshot_id uuid primary key default gen_random_uuid(),
  schema_version text not null default 'tavonel.acl_snapshot.v1'
    check (schema_version = 'tavonel.acl_snapshot.v1'),
  source_version_id text not null check (source_version_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_id text not null check (provider_id ~ '^[a-z][a-z0-9_]{1,63}$'),

  -- Principal identities only. A principal id is an address, never a credential, and the guard
  -- below is the same one 0012 and 0014 use to keep secrets out of an audit body.
  --
  -- Every element carries a kind and a permission from the frozen vocabulary. Without this, a row
  -- written by a connector could carry `"permission":"admin"`, and a value `intersectAcl` cannot
  -- rank is a value it must refuse rather than compare -- the storage boundary refuses it too, so
  -- the vocabulary is not enforced in only one place.
  principals jsonb not null check (
    jsonb_typeof(principals) = 'array'
    and jsonb_array_length(principals) <= 2000
    and octet_length(principals::text) <= 262144
    and principals::text !~* '"(secret|password|token|credential|access[_-]?key|private[_-]?key)"[[:space:]]*:'
    and not (principals @? '$[*] ? (!(@.kind == "user" || @.kind == "group" || @.kind == "domain" || @.kind == "anyone"))')
    and not (principals @? '$[*] ? (!(@.permission == "read" || @.permission == "write" || @.permission == "owner"))')
  ),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  captured_at timestamptz not null,
  recorded_at timestamptz not null default now(),

  -- Re-capturing an unchanged ACL is the same fact, not a second one.
  unique (source_version_id, provider_id, snapshot_sha256)
);
create index if not exists source_acl_snapshot_version_idx
  on public.source_acl_snapshots (source_version_id, captured_at desc);

-- One row per gate evaluation, allowed or refused.
--
-- A refusal is kept, not discarded: "which precondition was missing on which date" is the only
-- record that shows the gate was ever actually closed. `missing` names them, from the frozen list.
create table if not exists public.customer_data_gate_receipts (
  gate_receipt_id uuid primary key default gen_random_uuid(),
  schema_version text not null default 'tavonel.customer_data_gate.v1'
    check (schema_version = 'tavonel.customer_data_gate.v1'),
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),

  -- Fail closed at the column, not only in the application: a row is refused unless something
  -- writes `true`, and `true` is unwritable without all seventeen and a receipt digest.
  allowed boolean not null default false,
  satisfied_count integer not null default 0 check (satisfied_count between 0 and 17),
  receipt_sha256 text check (receipt_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  missing text[] not null default '{}'::text[] check (
    array_position(missing, null) is null
    and missing <@ array[
      'tenant_isolation_suite_passed', 'encryption_at_rest_verified', 'encryption_in_transit_verified',
      'connector_credentials_in_secret_manager', 'no_secrets_in_receipts_or_logs_verified',
      'malware_scan_and_quarantine_active', 'archive_bomb_limits_enforced',
      'compile_receipts_signed_and_audited', 'deletion_tombstone_propagation_verified',
      'retention_controls_configured', 'data_export_and_delete_available', 'audit_log_active',
      'least_privilege_connector_scopes_verified', 'per_provider_isolation_verified',
      'dpa_and_privacy_notice_published', 'per_source_acl_preserved', 'founder_approval_receipt_recorded'
    ]::text[]
  ),

  -- What was checked, so a later reader can re-derive receipt_sha256 instead of trusting it. The
  -- evidence values are paths, receipt digests and test ids; the guard keeps a credential from
  -- being pasted into one.
  evidence jsonb not null default '[]'::jsonb check (
    jsonb_typeof(evidence) = 'array'
    and jsonb_array_length(evidence) <= 17
    and octet_length(evidence::text) <= 65536
    and evidence::text !~* '"(secret|password|token|credential|access[_-]?key|private[_-]?key)"[[:space:]]*:'
  ),
  evaluated_at timestamptz not null,
  recorded_at timestamptz not null default now(),

  constraint customer_data_gate_allowed_is_complete check (
    allowed = false
    or (satisfied_count = 17 and receipt_sha256 is not null and cardinality(missing) = 0)
  ),
  constraint customer_data_gate_refusal_names_a_reason check (
    allowed = true or cardinality(missing) >= 1
  )
);
create index if not exists customer_data_gate_receipt_workspace_idx
  on public.customer_data_gate_receipts (workspace_id, evaluated_at desc);

alter table public.source_acl_snapshots enable row level security;
alter table public.customer_data_gate_receipts enable row level security;

revoke all on public.source_acl_snapshots, public.customer_data_gate_receipts
  from public, anon, authenticated;
grant select, insert on public.source_acl_snapshots, public.customer_data_gate_receipts to service_role;

-- Explicit default-deny for client roles, in the style 0003 established for billing_events. RLS
-- with no policy already denies; saying so restrictively means a later permissive policy added to
-- one of these tables cannot open it by accident.
create policy source_acl_snapshots_no_client_access on public.source_acl_snapshots
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy customer_data_gate_receipts_no_client_access on public.customer_data_gate_receipts
  as restrictive for all to anon, authenticated using (false) with check (false);

commit;
