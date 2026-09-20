import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_ROUTER_SCHEMA,
  candidateIdentityKey,
  selectAdaptiveRoute,
  stableCanaryBucket,
  type AdaptiveRouteCandidate,
  type AdaptiveRouterControl,
  type AdaptiveRouterPolicy,
  type CandidateConstraintFailure,
  type CandidateIdentity,
} from "./adaptive-router";
import { buildBgeM3BaselineProfile } from "./retrieval-profile";
import { contentAddressedRetrievalProfileIdentity } from "./retrieval-profile-identity";

const NOW = new Date("2026-09-20T00:00:00.000Z");
const PROFILE = contentAddressedRetrievalProfileIdentity(
  buildBgeM3BaselineProfile("pilot-proof", "embed-r1", "rerank-r1"),
);
const OTHER_PROFILE = contentAddressedRetrievalProfileIdentity(
  buildBgeM3BaselineProfile("pilot-proof", "embed-r2", "rerank-r1"),
);

const CONTROL_IDENTITY: CandidateIdentity = {
  provider: "provider-a",
  model: "control-model",
  revision: "2026-09-01",
  endpointId: "us-east/control",
};
const CHALLENGER_IDENTITY: CandidateIdentity = {
  provider: "provider-b",
  model: "challenger-model",
  revision: "2026-09-02",
  endpointId: "us-east/challenger",
};

function candidate(
  identity: CandidateIdentity,
  changes: Partial<Omit<AdaptiveRouteCandidate, "identity">> = {},
): AdaptiveRouteCandidate {
  return {
    identity,
    capabilities: ["text", "citations"],
    region: "us-east",
    retentionDays: 0,
    price: { observedAt: "2026-09-19T23:59:00.000Z", estimatedCostUsdMicros: 500 },
    estimatedLatencyMs: 800,
    circuit: "closed",
    index: { status: "ready", retrievalProfile: PROFILE },
    ...changes,
  };
}

const CONTROL: AdaptiveRouterControl = {
  candidate: CONTROL_IDENTITY,
  requirements: {
    capabilities: ["text", "citations"],
    allowedRegions: ["us-east"],
    maxRetentionDays: 0,
    maxPriceAgeMs: 5 * 60_000,
    budgetUsdMicros: 1_000,
    deadlineMs: 2_000,
    retrievalProfile: PROFILE,
  },
};

function policy(
  mode: AdaptiveRouterPolicy["mode"],
  canaryPermille: number,
  identities: CandidateIdentity[] = [CHALLENGER_IDENTITY],
): AdaptiveRouterPolicy {
  return {
    schemaVersion: ADAPTIVE_ROUTER_SCHEMA,
    policyId: "ask-router",
    version: "v1",
    mode,
    orderedCandidateKeys: identities.map(candidateIdentityKey),
    canaryPermille,
  };
}

function decide(
  routePolicy: AdaptiveRouterPolicy | null,
  candidates: AdaptiveRouteCandidate[] = [candidate(CONTROL_IDENTITY), candidate(CHALLENGER_IDENTITY)],
) {
  return selectAdaptiveRoute({
    tenantId: "tenant-1",
    requestId: "request-1",
    now: NOW,
    control: CONTROL,
    policy: routePolicy
      ? { available: true, policy: routePolicy }
      : { available: false, reason: "unreadable" },
    candidates,
  });
}

describe("adaptive router", () => {
  it("matches the fixed control by its full content-addressed identity", () => {
    const result = decide(policy("fixed_control", 10_000));
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.reason).toBe("fixed_control");
    expect(result.execution.identity).toEqual(CONTROL_IDENTITY);

    const revisedControl = candidate({ ...CONTROL_IDENTITY, revision: "2026-09-03" });
    expect(decide(policy("fixed_control", 10_000), [revisedControl])).toMatchObject({
      kind: "refuse",
      code: "CONTROL_CANDIDATE_NOT_FOUND",
    });
  });

  it("falls back to the eligible fixed control when policy state is unavailable", () => {
    expect(decide(null)).toMatchObject({
      kind: "execute",
      reason: "fixed_control_policy_unavailable",
      execution: { identity: CONTROL_IDENTITY },
      policyId: null,
      policyVersion: null,
    });
  });

  it("uses a stable tenant/request bucket and admits an eligible challenger only inside the canary", () => {
    const firstBucket = stableCanaryBucket("tenant-1", "request-1");
    expect(stableCanaryBucket("tenant-1", "request-1")).toBe(firstBucket);
    expect(stableCanaryBucket("tenant-1", "request-1", 1)).toBe(0);

    const admitted = decide(policy("adaptive", 10_000));
    expect(admitted).toMatchObject({
      kind: "execute",
      reason: "adaptive_canary",
      execution: { identity: CHALLENGER_IDENTITY },
      canaryBucket: firstBucket,
    });
    expect(decide(policy("adaptive", 0))).toMatchObject({
      kind: "execute",
      reason: "fixed_control_canary_holdback",
      execution: { identity: CONTROL_IDENTITY },
      canaryBucket: firstBucket,
    });
  });

  it("uses declared priority deterministically, independent of candidate input order", () => {
    const secondIdentity: CandidateIdentity = {
      provider: "provider-c", model: "second", revision: "r1", endpointId: "us-east/second",
    };
    const routePolicy = policy("adaptive", 10_000, [secondIdentity, CHALLENGER_IDENTITY]);
    const candidates = [
      candidate(CONTROL_IDENTITY),
      candidate(CHALLENGER_IDENTITY),
      candidate(secondIdentity),
    ];
    const forward = decide(routePolicy, candidates);
    const reversed = decide(routePolicy, [...candidates].reverse());
    expect(forward.kind).toBe("execute");
    expect(reversed.kind).toBe("execute");
    if (forward.kind !== "execute" || reversed.kind !== "execute") return;
    expect(forward.execution.identity).toEqual(secondIdentity);
    expect(reversed.execution.identity).toEqual(secondIdentity);
  });

  it("never dispatches a challenger in shadow mode", () => {
    const result = decide(policy("shadow", 10_000));
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.reason).toBe("shadow_control");
    expect(result.execution.identity).toEqual(CONTROL_IDENTITY);
    expect(result.shadowEvaluation).toEqual({
      candidate: candidate(CHALLENGER_IDENTITY),
      dispatchAllowed: false,
    });
  });

  it.each<{
    name: string;
    change: Partial<Omit<AdaptiveRouteCandidate, "identity">>;
    failure: CandidateConstraintFailure;
  }>([
    { name: "capability", change: { capabilities: ["text"] }, failure: "CAPABILITY_MISMATCH" },
    { name: "region", change: { region: "eu-west" }, failure: "REGION_MISMATCH" },
    { name: "retention", change: { retentionDays: 30 }, failure: "RETENTION_MISMATCH" },
    { name: "retrieval profile", change: { index: { status: "ready", retrievalProfile: OTHER_PROFILE } }, failure: "RETRIEVAL_PROFILE_MISMATCH" },
    { name: "stale price", change: { price: { observedAt: "2026-09-19T23:00:00.000Z", estimatedCostUsdMicros: 500 } }, failure: "PRICE_STALE" },
    { name: "future price", change: { price: { observedAt: "2026-09-20T00:01:00.000Z", estimatedCostUsdMicros: 500 } }, failure: "PRICE_FROM_FUTURE" },
    { name: "budget", change: { price: { observedAt: "2026-09-19T23:59:00.000Z", estimatedCostUsdMicros: 1_001 } }, failure: "BUDGET_EXCEEDED" },
    { name: "deadline", change: { estimatedLatencyMs: 2_001 }, failure: "DEADLINE_EXCEEDED" },
    { name: "circuit", change: { circuit: "open" }, failure: "CIRCUIT_UNAVAILABLE" },
    { name: "index", change: { index: { status: "stale", retrievalProfile: PROFILE } }, failure: "INDEX_UNAVAILABLE" },
  ])("excludes a challenger with a $name constraint failure", ({ change, failure }) => {
    const result = decide(policy("adaptive", 10_000), [
      candidate(CONTROL_IDENTITY),
      candidate(CHALLENGER_IDENTITY, change),
    ]);
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.reason).toBe("fixed_control_no_eligible_challenger");
    expect(result.execution.identity).toEqual(CONTROL_IDENTITY);
    expect(result.assessments.find((item) => item.candidateKey === candidateIdentityKey(CHALLENGER_IDENTITY)))
      .toMatchObject({ eligible: false, failures: expect.arrayContaining([failure]) });
  });

  it.each([
    ["capability", { capabilities: ["text"] }, "CONTROL_SECURITY_MISMATCH"],
    ["region", { region: "eu-west" }, "CONTROL_SECURITY_MISMATCH"],
    ["retention", { retentionDays: 1 }, "CONTROL_SECURITY_MISMATCH"],
    ["retrieval profile", { index: { status: "ready", retrievalProfile: OTHER_PROFILE } }, "CONTROL_INTEGRITY_MISMATCH"],
  ] as const)("hard-refuses a control $name mismatch", (_name, change, code) => {
    expect(decide(policy("adaptive", 10_000), [
      candidate(CONTROL_IDENTITY, change),
      candidate(CHALLENGER_IDENTITY),
    ])).toMatchObject({ kind: "refuse", code });
  });

  it("refuses operationally unavailable control instead of bypassing it with a challenger", () => {
    expect(decide(policy("adaptive", 10_000), [
      candidate(CONTROL_IDENTITY, { circuit: "open" }),
      candidate(CHALLENGER_IDENTITY),
    ])).toMatchObject({ kind: "refuse", code: "CONTROL_UNAVAILABLE" });
  });

  it("refuses duplicate exact identities as an integrity collision", () => {
    expect(decide(policy("adaptive", 10_000), [
      candidate(CONTROL_IDENTITY),
      candidate(CONTROL_IDENTITY, { estimatedLatencyMs: 900 }),
    ])).toMatchObject({ kind: "refuse", code: "CANDIDATE_IDENTITY_COLLISION" });
  });
});
