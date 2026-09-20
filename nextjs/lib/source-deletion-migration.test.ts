import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "../supabase/migrations/20260920132000_legal_hold_deletion_sweeper.sql",
  "utf8",
);
const claimFunction = migration.match(
  /create or replace function public\.claim_source_deletion_sweep[\s\S]+?\n\$\$;/i,
)?.[0] ?? "";

describe("legal-hold deletion migration", () => {
  it("persists active holds, fails closed for unknown policy, and sweeps only inactive tenants", () => {
    expect(migration).toMatch(/'status', case when v_hold = 'active' then 'held' else 'recorded' end/i);
    expect(migration.match(/SOURCE_LEGAL_HOLD_STATE_UNKNOWN/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toMatch(/v_count <> 1 or v_hold is null then return 'unknown'/i);
    expect(migration).toMatch(/claim_source_deletion_sweep[\s\S]+source_legal_hold_state\(o\.workspace_key\) = 'inactive'/i);
    expect(migration).toMatch(/deleted_object_grace_days[\s\S]+eligible_at/i);
  });

  it("keeps tombstones and receipts append-only and service-only", () => {
    expect(migration).toMatch(/source_deletion_tombstones_append_only[\s\S]+before update or delete/i);
    expect(migration).toMatch(/source_deletion_receipts_append_only[\s\S]+before update or delete/i);
    expect(migration).toMatch(/revoke all on public\.source_deletion_tombstones[\s\S]+from public, anon, authenticated, service_role/i);
  });

  it("prevents connector re-sync resurrection both before and during binding insert", () => {
    expect(migration).toMatch(/connector_source_import_allowed/i);
    expect(migration).toMatch(/connector_binding_no_resurrection[\s\S]+before insert or update on public\.connector_document_bindings/i);
    expect(migration).toMatch(/raise exception 'SOURCE_TOMBSTONED'/i);
    expect(migration).toMatch(/reject_tombstoned_connector_binding[\s\S]+pg_advisory_xact_lock[\s\S]+v_deletion_id/i);
  });

  it("accepts never-imported removals but rejects every existing cross-tenant identity mismatch", () => {
    expect(migration).toMatch(/foundation_oauth_connections c[\s\S]+c\.oauth_connection_id = p_oauth_connection_id[\s\S]+c\.workspace_key = p_workspace_key[\s\S]+c\.provider::text = p_provider/i);
    expect(migration).toMatch(/connector_document_bindings b where b\.source_id = p_source_id[\s\S]+b\.workspace_key is distinct from p_workspace_key[\s\S]+b\.oauth_connection_id is distinct from p_oauth_connection_id[\s\S]+b\.provider is distinct from p_provider/i);
    expect(migration).toMatch(/sources s where s\.source_id = p_source_id[\s\S]+s\.workspace_id is distinct from p_workspace_key[\s\S]+s\.tenant_id is distinct from p_workspace_key[\s\S]+SOURCE_DELETION_BINDING_MISMATCH/i);
  });

  it("takes the source deletion lock before a late artifact checks the tombstone", () => {
    expect(migration).toMatch(/enqueue_source_deletion_object[\s\S]+v_deletion_id := 'sha256:'[\s\S]+pg_advisory_xact_lock[\s\S]+source_deletion_tombstones/i);
    expect(migration).toMatch(/source_versions_deletion_inventory[\s\S]+before insert on public\.source_versions/i);
    expect(migration).toMatch(/source_representations_deletion_inventory[\s\S]+before insert on public\.source_representations/i);
  });

  it("serializes hold activation, deletion intent, and the physical-purge lease", () => {
    expect(migration).toMatch(/guard_legal_hold_against_source_deletion[\s\S]+delete_started_at is not null[\s\S]+purge_claim_expires_at > pg_catalog\.clock_timestamp\(\)[\s\S]+SOURCE_DELETION_IN_PROGRESS/i);
    expect(migration).toMatch(/request_connector_source_deletion[\s\S]+tavonel\.source_legal_hold\.v1[\s\S]+v_hold := public\.source_legal_hold_state/i);
    expect(migration).toMatch(/claim_source_deletion_sweep[\s\S]+tavonel\.source_legal_hold\.v1[\s\S]+source_legal_hold_state\(v_candidate\.workspace_key\) <> 'inactive'/i);
    expect(migration).toMatch(/legal_hold_waits_for_source_deletion[\s\S]+before insert or update of legal_hold_enabled/i);
  });

  it("leases one deterministic object and binds finalize to the unexpired claim", () => {
    expect(migration).toMatch(/pg_advisory_xact_lock/i);
    expect(migration).toMatch(/'status', 'replayed'/i);
    expect(migration).toMatch(/'status', 'recorded'/i);
    expect(migration).toMatch(/p_limit is distinct from 1/i);
    expect(migration).toMatch(/order by o\.deletion_id, o\.object_key[\s\S]+limit 1 for update of o skip locked/i);
    expect(migration).toMatch(/purge_claim_id = gen_random_uuid\(\)/i);
    expect(migration).toMatch(/begin_source_deletion_object[\s\S]+delete_started_at = coalesce\(delete_started_at/i);
    expect(claimFunction).not.toMatch(/delete_started_at = coalesce/i);
    expect(migration).toMatch(/foundation_jobs j[\s\S]+job_type = 'source_import'[\s\S]+lease_expires_at > pg_catalog\.clock_timestamp\(\)/i);
    expect(migration).toMatch(/p_claim_id uuid[\s\S]+SOURCE_DELETION_LEASE_INVALID/i);
    expect(migration).toMatch(/SOURCE_DELETION_OBJECT_CONFLICT[\s\S]+action = 'object_purged'[\s\S]+status', 'replayed'[\s\S]+SOURCE_DELETION_LEASE_INVALID/i);
  });

  it("fails closed until a complete R2 artifact inventory is independently attested", () => {
    expect(migration).toMatch(/create table public\.source_deletion_inventory_attestations/i);
    expect(migration).toMatch(/attestation_kind = 'complete_r2_prefix_inventory_v1'/i);
    expect(migration).toMatch(/claim_source_deletion_sweep[\s\S]+exists \([\s\S]+source_deletion_inventory_attestations/i);
    expect(migration).toMatch(/source_deletion_inventory_attestations_append_only/i);
    expect(migration).toMatch(/source_deletion_sweep_status[\s\S]+'inventoryIncomplete'[\s\S]+from public\.source_deletion_tombstones t[\s\S]+not exists \([\s\S]+source_deletion_inventory_attestations/i);
    expect(migration).not.toMatch(/source_deletion_sweep_status[\s\S]+'inventoryIncomplete'[\s\S]+from public\.source_deletion_objects o/iu);
  });
});
