import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/20260920132100_adaptive_router_control_plane.sql"),
  "utf8",
).toLowerCase();

describe("adaptive router control-plane migration", () => {
  it("stores immutable policies, evidence, rollout history, assignments, revocations, and events", () => {
    for (const table of [
      "adaptive_router_evidence_receipts",
      "adaptive_router_policy_revisions",
      "adaptive_router_rollout_revisions",
      "adaptive_router_state_events",
      "adaptive_router_assignments",
      "adaptive_router_revocations",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`create trigger ${table}_append_only`);
    }
    expect(sql).toContain("unique (policy_id, policy_revision, assignment_key_digest, subject_digest)");
    expect(sql).toContain("global_kill_switch");
    expect(sql).toContain("references public.adaptive_router_evidence_receipts(evidence_digest)");
    expect(sql).toContain("create trigger adaptive_router_revocations_serialize before insert");
  });

  it("binds policy scope, thresholds, candidates, index state, revisions, evidence, and validity", () => {
    for (const binding of [
      "policy_digest", "evidence_digest", "thresholds_digest", "scope_digest",
      "candidate_set_digest", "index_state_digest", "control_revision",
      "candidate_revision", "rollback_revision", "valid_from", "valid_until",
    ]) expect(sql).toContain(binding);
    expect(sql).toContain("adaptive_router_policy_binding_invalid");
    expect(sql).toContain("adaptive_router_evidence_binding_invalid");
    expect(sql).toContain("adaptive_router_evidence_not_current");
    expect(sql).toContain("adaptive_router_canonical_digest_v1");
    expect(sql).toContain("receipt, array['evidencedigest']::text[], 'tavonel.adaptive_router_evidence.v1'");
    expect(sql).toContain("policy, array['policydigest']::text[], 'tavonel.adaptive_router_policy.v1'");
    expect(sql).toContain("p_domain || pg_catalog.chr(31)");
  });

  it("completes lineage binding only after the adaptive records exist", () => {
    expect(sql).toContain("foundation_model_attempt_decisions_policy_fkey");
    expect(sql).toContain("foundation_model_attempt_decisions_rollout_fkey");
    expect(sql).toContain("foundation_model_attempt_decisions_assignment_fkey");
    expect(sql).toContain("adaptive_router_assignments_lineage_key");
    expect(sql).toContain("foundation_model_attempt_decisions_control_lineage");
    expect(sql).toContain("model_attempt_decision_control_binding_invalid");
    expect(sql).toContain("v_assignment.assignment_digest is distinct from new.assignment_digest");
    expect(sql).toContain("orderedcandidatekeys') ? new.chosen_id");
    expect(sql).toContain("v_head.rollout_revision is distinct from new.rollout_revision");
    expect(sql).toContain("v_head.state not in ('shadow', 'canary', 'active')");
    expect(sql).toContain("r.revocation_kind = 'global_kill_switch'");
    expect(sql.indexOf("create table public.adaptive_router_assignments"))
      .toBeLessThan(sql.indexOf("foundation_model_attempt_decisions_assignment_fkey"));
    expect(sql).toMatch(/grant execute on function public\.admit_model_attempt_decision_v2\(jsonb\) to service_role/i);
    expect(sql).toMatch(/grant execute on function public\.record_model_attempt_outcome_v2\(jsonb\) to service_role/i);
  });

  it("uses a serialized revision-and-state CAS with the constrained rollout graph", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("adaptive_router_transition_compare_and_swap_conflict");
    expect(sql).toContain("p_expected_state = 'none' and p_next_state = 'shadow'");
    expect(sql).toContain("p_expected_state = 'shadow' and p_next_state in ('canary', 'disabled')");
    expect(sql).toContain("p_expected_state = 'canary' and p_next_state in ('active', 'rolled_back', 'disabled')");
    expect(sql).toContain("p_expected_state = 'active' and p_next_state in ('rolled_back', 'disabled')");
    expect(sql).toContain("p_expected_state = 'rolled_back' and p_next_state = 'disabled'");
    expect(sql).toContain("adaptive_router_transition_idempotency_conflict");
    const headMutation = sql.indexOf("if p_expected_state = 'none' then", sql.indexOf("insert into public.adaptive_router_rollout_revisions"));
    const affectedRows = sql.indexOf("get diagnostics v_changed = row_count", headMutation);
    const closeWriterGate = sql.indexOf("set_config('app.adaptive_router_transition', '0', true)", headMutation);
    expect(affectedRows).toBeGreaterThan(headMutation);
    expect(affectedRows).toBeLessThan(closeWriterGate);
  });

  it("fails resolution closed on ambiguity, expiry, kill switches, and revocation", () => {
    expect(sql).toContain("if v_match_count <> 1 then raise exception 'adaptive_router_policy_unavailable'");
    expect(sql).toContain("h.state in ('shadow', 'canary', 'active')");
    expect(sql).toContain("adaptive_router_kill_switch_engaged");
    expect(sql).toContain("adaptive_router_assignment_revoked");
    expect(sql).toContain("adaptive_router_assignment_conflict");
  });

  it("keeps tables and both privileged RPCs service-role only", () => {
    expect(sql.match(/enable row level security/g)).toHaveLength(7);
    expect(sql).toMatch(/revoke all on public\.adaptive_router_policy_revisions[\s\S]*from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.transition_adaptive_router_rollout_v1[\s\S]*to service_role/i);
    expect(sql).toMatch(/grant execute on function public\.resolve_adaptive_router_policy_v1[\s\S]*to service_role/i);
    expect(sql).not.toMatch(/grant execute on function public\.(transition|resolve)_adaptive_router_[\s\S]*to (anon|authenticated)/i);
  });
});
