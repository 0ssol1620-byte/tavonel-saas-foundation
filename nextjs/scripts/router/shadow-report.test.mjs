import { describe, expect, it } from "vitest";

import {
  buildShadowReport,
  renderShadowReportMarkdown,
  SHADOW_REPORT_SCHEMA,
} from "./shadow-report.mjs";

const NOW = new Date("2026-09-21T12:00:00.000Z");
const SINCE = new Date("2026-09-20T12:00:00.000Z");
const POLICY = "fe95f7ce-c997-4dd7-8dc9-771982d292ce";
const CONTROL = `sha256:${"c".repeat(64)}`;
const CHALLENGER = `sha256:${"d".repeat(64)}`;

function decision(id, at, overrides = {}) {
  return {
    attempt_id: id, admitted_at: at, endpoint: "search", attempted_role: "embedder",
    control_id: CONTROL, chosen_id: CONTROL, shadow_id: CHALLENGER, policy_id: POLICY,
    ...overrides,
  };
}

function fixtures(overrides = {}) {
  return {
    heads: [{
      policy_id: POLICY, state: "shadow", rollout_revision: 1, policy_revision: 1,
      scope_digest: `sha256:${"a".repeat(64)}`,
      valid_from: "2026-09-20T00:00:00.000Z", valid_until: "2026-10-20T00:00:00.000Z",
    }],
    policies: [{ policy_id: POLICY, policy_revision: 1, candidate_basis_points: 0 }],
    receipts: [{
      receipt_id: "972319cd-36aa-4ebc-8cce-1386c91e5b8b",
      evidence_digest: `sha256:${"b".repeat(64)}`,
      measured_at: "2026-09-20T00:00:00.000Z",
      receipt: { stage: "shadow_entry", measurement: "none" },
    }],
    events: [{
      policy_id: POLICY, from_state: "none", to_state: "shadow", rollout_revision: 1,
      receipt_digest: `sha256:${"e".repeat(64)}`, recorded_at: "2026-09-20T00:00:01.000Z",
    }],
    assignments: [
      { assignment_id: "1", policy_id: POLICY, variant: "control", assigned_at: "2026-09-20T13:00:00.000Z" },
      { assignment_id: "2", policy_id: POLICY, variant: "control", assigned_at: "2026-09-21T11:00:00.000Z" },
      { assignment_id: "3", policy_id: POLICY, variant: "control", assigned_at: "2026-09-19T11:00:00.000Z" },
    ],
    decisions: [
      decision("a1", "2026-09-21T10:00:00.000Z"),
      decision("a2", "2026-09-21T10:05:00.000Z", { shadow_id: null }),
      decision("a3", "2026-09-19T10:00:00.000Z"),
    ],
    outcomes: [
      { attempt_id: "a1", outcome: "succeeded", failure_class: "none", completed_at: "2026-09-21T10:00:01.000Z" },
      { attempt_id: "a2", outcome: "failed", failure_class: "provider_unavailable", completed_at: "2026-09-21T10:05:01.000Z" },
    ],
    ...overrides,
  };
}

function report(overrides = {}) {
  return buildShadowReport({ ...fixtures(overrides), now: NOW, since: SINCE, hours: 24 });
}

describe("router shadow evidence report", () => {
  it("counts rollout state, assignments and attempts inside the window only", () => {
    const value = report();
    expect(value.schemaVersion).toBe(SHADOW_REPORT_SCHEMA);
    expect(value.rollout.headsByState).toEqual({ shadow: 1 });
    expect(value.assignments).toMatchObject({
      total: 3, inWindow: 2, byVariantInWindow: { control: 2 },
    });
    expect(value.attempts).toMatchObject({
      inWindow: 2, executedControl: 2, withShadowProposal: 1, succeeded: 1,
    });
  });

  it("carries a denominator with every rate and refuses a rate over zero rows", () => {
    expect(report().attempts).toMatchObject({
      shadowProposalRate: 0.5, successRate: 0.5, executedControlRate: 1,
    });
    const empty = report({ decisions: [], outcomes: [] }).attempts;
    expect(empty).toMatchObject({
      inWindow: 0, shadowProposalRate: null, successRate: null, executedControlRate: null,
    });
  });

  it("names an attempt with no outcome row rather than counting it as a success", () => {
    expect(report({ outcomes: [] }).attempts.failureClasses).toEqual({ no_outcome_row: 2 });
  });

  it("blocks canary while the only evidence is the shadow-entry receipt", () => {
    const readiness = report().canaryReadiness;
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(" ")).toMatch(/shadow-entry receipt, which measures nothing/);
    expect(readiness.controlPlanePreconditions.join(" ")).toMatch(/p_expected_state='shadow'/);
  });

  it("blocks canary when shadow never produced a proposal or a rollout head", () => {
    expect(report({ decisions: [] }).canaryReadiness.blockers.join(" "))
      .toMatch(/no model attempt decision was admitted/);
    expect(report({ heads: [] }).canaryReadiness.blockers.join(" "))
      .toMatch(/no rollout head is in state shadow/);
  });

  it("clears every control-plane blocker once measured evidence and traffic exist", () => {
    const measured = report({
      receipts: [{
        receipt_id: "r2", evidence_digest: `sha256:${"f".repeat(64)}`,
        measured_at: "2026-09-21T09:00:00.000Z",
        receipt: { stage: "shadow_comparison", thresholdResults: { availability: "passed" } },
      }],
    }).canaryReadiness;
    expect(measured).toMatchObject({ ready: true, blockers: [] });
  });

  it("renders markdown that states the challenger was never dispatched", () => {
    const markdown = renderShadowReportMarkdown(report());
    expect(markdown).toMatch(/carried a shadow proposal: 1 \/ 2/);
    expect(markdown).toMatch(/never dispatched/);
    expect(markdown).toMatch(/BLOCKED:/);
  });
});
