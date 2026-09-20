import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/20260920120000_atomic_world_activation.sql"),
  "utf8",
).toLowerCase();

describe("atomic Foundation world transition migration", () => {
  it("binds state, monotonic revision and manifest into the CAS", () => {
    expect(sql).toContain("p_expected_current_state text");
    expect(sql).toContain("p_expected_current_revision bigint");
    expect(sql).toContain("p_expected_current_manifest_digest text");
    expect(sql).toContain("and revision = p_expected_current_revision");
    expect(sql).toContain("and manifest_digest = p_expected_current_manifest_digest");
    expect(sql).toContain("world_transition_compare_and_swap_conflict");
  });

  it("serializes absent and existing pointer writers and defers the pointer invariant", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("create constraint trigger foundation_world_versions_pointer_invariant");
    expect(sql).toContain("create constraint trigger foundation_active_worlds_version_invariant");
    expect(sql.match(/deferrable initially deferred/g)).toHaveLength(2);
  });

  it("binds replay to an immutable receipt and current authorization revision", () => {
    expect(sql).toContain("operation_id uuid primary key");
    expect(sql).toContain("unique (workspace_key, collection_id, request_sha256)");
    expect(sql).toContain("foundation_world_transition_receipts_append_only");
    expect(sql).toContain("authorization_revision = v_existing_receipt.authorization_revision");
    expect(sql).toContain("world_transition_idempotency_conflict");
  });

  it("removes service-role access to legacy writers and grants only the atomic writer", () => {
    expect(sql).toContain("revoke execute on function public.promote_foundation_candidate(");
    expect(sql).toContain("revoke execute on function public.rollback_foundation_world(");
    expect(sql).toContain("grant execute on function public.transition_foundation_world_atomic(");
    expect(sql).not.toMatch(
      /grant execute on function public\.transition_foundation_world_atomic[\s\S]*to authenticated/,
    );
  });
});
