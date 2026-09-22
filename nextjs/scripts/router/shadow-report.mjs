#!/usr/bin/env node
/**
 * Read-only shadow evidence report over the adaptive router control plane.
 *
 * This is the artifact a canary decision cites. It reads; it never writes, and it never calls a
 * provider. Every rate it prints carries its denominator, and a rate over zero rows is reported
 * as `null` rather than as 0%.
 *
 *   pnpm router:shadow:report -- --hours 24 [--markdown]
 */

import { pathToFileURL } from "node:url";

import { readSupabaseAdminConfig, supabaseAdminRequest } from "../../lib/supabase-admin.ts";

export const SHADOW_REPORT_SCHEMA = "tavonel.router_shadow_report.v1";
const DEFAULT_WINDOW_HOURS = 24;

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = String(row[key]);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6));
}

/**
 * Aggregate already-fetched control-plane rows. Pure, so the shape of the artifact is tested
 * against fixtures without a database.
 */
export function buildShadowReport(input) {
  const { heads, policies, receipts, events, assignments, decisions, outcomes } = input;
  const since = input.since.toISOString();
  const recentAssignments = assignments.filter((row) => row.assigned_at >= since);
  const recentDecisions = decisions.filter((row) => row.admitted_at >= since);
  const shadowPolicyIds = new Set(heads.filter((row) => row.state === "shadow").map((row) => row.policy_id));
  const outcomeById = new Map(outcomes.map((row) => [row.attempt_id, row]));

  // In shadow the executed candidate is always the control. `shadow_id` names the candidate the
  // policy would have preferred, so a non-null shadow_id is a disagreement between the policy's
  // preference and what actually answered. It is NOT a quality comparison: the challenger was
  // never dispatched, so nothing here says whether it would have been better.
  const withShadow = recentDecisions.filter((row) => row.shadow_id !== null && row.shadow_id !== undefined);
  const chosenIsControl = recentDecisions.filter((row) => row.chosen_id === row.control_id);
  const succeeded = recentDecisions.filter((row) => outcomeById.get(row.attempt_id)?.outcome === "succeeded");
  const failureClasses = countBy(
    recentDecisions.map((row) => outcomeById.get(row.attempt_id) ?? { failure_class: "no_outcome_row" }),
    "failure_class",
  );

  return {
    schemaVersion: SHADOW_REPORT_SCHEMA,
    generatedAt: input.now.toISOString(),
    window: { since, hours: input.hours },
    rollout: {
      headsByState: countBy(heads, "state"),
      heads: heads.map((row) => ({
        policyId: row.policy_id, state: row.state, rolloutRevision: row.rollout_revision,
        policyRevision: row.policy_revision, scopeDigest: row.scope_digest,
        validFrom: row.valid_from, validUntil: row.valid_until,
      })),
      policyRevisions: policies.length,
      evidenceReceipts: receipts.length,
      stateEvents: events.map((row) => ({
        policyId: row.policy_id, from: row.from_state, to: row.to_state,
        rolloutRevision: row.rollout_revision, receiptDigest: row.receipt_digest,
        recordedAt: row.recorded_at,
      })),
    },
    assignments: {
      total: assignments.length,
      inWindow: recentAssignments.length,
      byVariant: countBy(assignments, "variant"),
      byVariantInWindow: countBy(recentAssignments, "variant"),
      shadowPolicies: [...shadowPolicyIds],
    },
    attempts: {
      inWindow: recentDecisions.length,
      executedControl: chosenIsControl.length,
      executedControlRate: rate(chosenIsControl.length, recentDecisions.length),
      withShadowProposal: withShadow.length,
      shadowProposalRate: rate(withShadow.length, recentDecisions.length),
      succeeded: succeeded.length,
      successRate: rate(succeeded.length, recentDecisions.length),
      failureClasses,
      byEndpoint: countBy(recentDecisions, "endpoint"),
      byRole: countBy(recentDecisions, "attempted_role"),
    },
    canaryReadiness: canaryReadiness({
      heads, receipts, assignments: recentAssignments, decisions: recentDecisions, withShadow,
    }),
  };
}

/**
 * What still blocks `shadow -> canary`. These are the control plane's own preconditions read back
 * as a checklist; passing them is necessary, never sufficient. Whether the evidence supports the
 * transition is a founder judgement, not this script's.
 */
export function canaryReadiness(input) {
  const shadowHeads = input.heads.filter((row) => row.state === "shadow");
  const blockers = [];
  if (shadowHeads.length === 0) blockers.push("no rollout head is in state shadow");
  if (input.decisions.length === 0) blockers.push("no model attempt decision was admitted in the window");
  if (input.withShadow.length === 0) {
    blockers.push("no attempt carried a shadow proposal: the challenger was never eligible, so "
      + "shadow measured the control against nothing");
  }
  if (input.assignments.length === 0) blockers.push("no assignment was issued in the window");
  const measured = input.receipts.some((row) => row.receipt?.stage !== "shadow_entry");
  if (!measured) {
    blockers.push("the only evidence receipt is the shadow-entry receipt, which measures nothing: "
      + "canary needs a receipt carrying real thresholdResults, valid at the moment of transition");
  }
  return {
    ready: blockers.length === 0,
    blockers,
    // Stated so the runbook's command block and this report cannot drift apart.
    controlPlanePreconditions: [
      "transition_adaptive_router_rollout_v1 with p_expected_state='shadow', p_next_state='canary'",
      "the CAS arguments must equal the current head row exactly (revision, state, every digest)",
      "the bound evidence receipt must be current at transition time (adaptive_router_evidence_not_current)",
      "no global_kill_switch and no policy revocation may be in effect (adaptive_router_kill_switch_engaged)",
      "a canary policy revision needs candidateBasisPoints > 0, which is a new policy revision, "
        + "not an edit: policy rows are append-only",
    ],
  };
}

export function renderShadowReportMarkdown(report) {
  const lines = [
    `# Router shadow evidence — ${report.generatedAt}`,
    "",
    `Window: last ${report.window.hours}h (since ${report.window.since}).`,
    "",
    "## Rollout",
    "",
    `- heads by state: ${JSON.stringify(report.rollout.headsByState)}`,
    `- policy revisions: ${report.rollout.policyRevisions}`,
    `- evidence receipts: ${report.rollout.evidenceReceipts}`,
    `- state events: ${report.rollout.stateEvents.length}`,
    "",
    "## Assignments",
    "",
    `- total: ${report.assignments.total} (in window: ${report.assignments.inWindow})`,
    `- by variant: ${JSON.stringify(report.assignments.byVariant)}`,
    "",
    "## Attempts in window",
    "",
    `- admitted: ${report.attempts.inWindow}`,
    `- executed the control: ${report.attempts.executedControl} / ${report.attempts.inWindow}`,
    `- carried a shadow proposal: ${report.attempts.withShadowProposal} / ${report.attempts.inWindow}`,
    `- succeeded: ${report.attempts.succeeded} / ${report.attempts.inWindow}`,
    `- failure classes: ${JSON.stringify(report.attempts.failureClasses)}`,
    "",
    "A shadow proposal is the candidate the policy preferred. It was never dispatched, so none of",
    "these rows compares the challenger's output quality to the control's.",
    "",
    "## Canary readiness",
    "",
    report.canaryReadiness.ready ? "- no control-plane blocker remains" : "",
    ...report.canaryReadiness.blockers.map((blocker) => `- BLOCKED: ${blocker}`),
  ];
  return `${lines.filter((line) => line !== "").join("\n")}\n`;
}

async function select(config, table, query) {
  const response = await supabaseAdminRequest(config, `/rest/v1/${table}?${query}`, {
    method: "GET",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} -> HTTP ${response.status} ${text}`);
  return JSON.parse(text);
}

export async function readControlPlane(config, since) {
  const sinceIso = since.toISOString();
  const [heads, policies, receipts, events, assignments, decisions, outcomes] = await Promise.all([
    select(config, "adaptive_router_rollout_heads", "select=*&limit=1000"),
    select(config, "adaptive_router_policy_revisions", "select=policy_id,policy_revision,scope_digest,candidate_basis_points,valid_from,valid_until&limit=1000"),
    select(config, "adaptive_router_evidence_receipts", "select=receipt_id,evidence_digest,measured_at,valid_from,valid_until,receipt&limit=1000"),
    select(config, "adaptive_router_state_events", "select=*&order=recorded_at.desc&limit=200"),
    select(config, "adaptive_router_assignments", "select=assignment_id,policy_id,variant,assigned_at&limit=10000"),
    select(config, "foundation_model_attempt_decisions", `select=attempt_id,admitted_at,endpoint,attempted_role,control_id,chosen_id,shadow_id,policy_id&admitted_at=gte.${sinceIso}&limit=10000`),
    select(config, "foundation_model_attempt_outcomes", `select=attempt_id,outcome,failure_class,completed_at&completed_at=gte.${sinceIso}&limit=10000`),
  ]);
  return { heads, policies, receipts, events, assignments, decisions, outcomes };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index < 0 || index === args.length - 1 ? null : args[index + 1];
}

async function main(argv) {
  const args = argv.slice(2);
  const hours = Number(valueAfter(args, "--hours") ?? DEFAULT_WINDOW_HOURS);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours must be a positive number");
  const config = readSupabaseAdminConfig(process.env);
  if (!config) throw new Error("needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const now = new Date();
  const since = new Date(now.getTime() - hours * 3_600_000);
  const report = buildShadowReport({ ...await readControlPlane(config, since), now, since, hours });
  process.stdout.write(args.includes("--markdown")
    ? renderShadowReportMarkdown(report)
    : `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
