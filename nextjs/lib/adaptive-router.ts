import { canonicalize, sha256 } from "./collection-compiler";
import {
  sameRetrievalProfileIdentity,
  type RetrievalProfileIdentity,
} from "./retrieval-profile-identity";

export const ADAPTIVE_ROUTER_SCHEMA = "tavonel.adaptive_router.v1" as const;

export type CandidateIdentity = Readonly<{
  provider: string;
  model: string;
  revision: string;
  endpointId: string;
}>;

export type AdaptiveRouteCandidate = Readonly<{
  identity: CandidateIdentity;
  capabilities: readonly string[];
  region: string;
  /** Zero means no provider retention for this endpoint and feature set. */
  retentionDays: number;
  price: Readonly<{
    observedAt: string;
    estimatedCostUsdMicros: number;
  }>;
  estimatedLatencyMs: number;
  circuit: "closed" | "open" | "unavailable";
  index: Readonly<{
    status: "ready" | "missing" | "stale" | "unavailable";
    retrievalProfile: RetrievalProfileIdentity;
  }>;
}>;

export type AdaptiveRouterControl = Readonly<{
  candidate: CandidateIdentity;
  requirements: Readonly<{
    capabilities: readonly string[];
    allowedRegions: readonly string[];
    maxRetentionDays: number;
    maxPriceAgeMs: number;
    budgetUsdMicros: number;
    deadlineMs: number;
    retrievalProfile: RetrievalProfileIdentity;
  }>;
}>;

export type AdaptiveRouterPolicy = Readonly<{
  schemaVersion: typeof ADAPTIVE_ROUTER_SCHEMA;
  policyId: string;
  version: string;
  mode: "fixed_control" | "adaptive" | "shadow";
  /** Ordered exact candidate keys; order is the deterministic preference order. */
  orderedCandidateKeys: readonly string[];
  /** 0 disables challenger execution; 10,000 admits every stable tenant/request bucket. */
  canaryPermille: number;
}>;

export type AdaptiveRouterPolicySnapshot =
  | { available: true; policy: AdaptiveRouterPolicy }
  | { available: false; reason: "missing" | "unreadable" | "stale" };

export type CandidateConstraintFailure =
  | "CAPABILITY_MISMATCH"
  | "REGION_MISMATCH"
  | "RETENTION_MISMATCH"
  | "RETRIEVAL_PROFILE_MISMATCH"
  | "PRICE_TIMESTAMP_INVALID"
  | "PRICE_FROM_FUTURE"
  | "PRICE_STALE"
  | "BUDGET_EXCEEDED"
  | "DEADLINE_EXCEEDED"
  | "CIRCUIT_UNAVAILABLE"
  | "INDEX_UNAVAILABLE";

export type CandidateAssessment = Readonly<{
  candidateKey: string;
  eligible: boolean;
  failures: readonly CandidateConstraintFailure[];
}>;

export type AdaptiveRouterDecision =
  | Readonly<{
      schemaVersion: typeof ADAPTIVE_ROUTER_SCHEMA;
      kind: "execute";
      reason:
        | "fixed_control"
        | "fixed_control_policy_unavailable"
        | "fixed_control_canary_holdback"
        | "fixed_control_no_eligible_challenger"
        | "adaptive_canary"
        | "shadow_control";
      policyId: string | null;
      policyVersion: string | null;
      canaryBucket: number | null;
      execution: AdaptiveRouteCandidate;
      /** A shadow proposal is evidence-only. It is never an execution instruction. */
      shadowEvaluation: Readonly<{
        candidate: AdaptiveRouteCandidate;
        dispatchAllowed: false;
      }> | null;
      assessments: readonly CandidateAssessment[];
    }>
  | Readonly<{
      schemaVersion: typeof ADAPTIVE_ROUTER_SCHEMA;
      kind: "refuse";
      code:
        | "ROUTER_INPUT_INVALID"
        | "CANDIDATE_IDENTITY_COLLISION"
        | "CONTROL_CANDIDATE_NOT_FOUND"
        | "CONTROL_SECURITY_MISMATCH"
        | "CONTROL_INTEGRITY_MISMATCH"
        | "CONTROL_UNAVAILABLE";
      assessments: readonly CandidateAssessment[];
    }>;

export type SelectAdaptiveRouteInput = Readonly<{
  tenantId: string;
  requestId: string;
  now: Date;
  control: AdaptiveRouterControl;
  policy: AdaptiveRouterPolicySnapshot;
  candidates: readonly AdaptiveRouteCandidate[];
}>;

const IDENTITY_PART = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const CAPABILITY = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function candidateIdentityKey(identity: CandidateIdentity): string {
  return `sha256:${sha256(canonicalize(identity))}`;
}

/** Stable assignment; adding or reordering candidates cannot move a tenant/request bucket. */
export function stableCanaryBucket(
  tenantId: string,
  requestId: string,
  buckets = 10_000,
): number {
  if (!tenantId || !requestId || !Number.isSafeInteger(buckets) || buckets < 1 || buckets > 1_000_000) {
    throw new RangeError("invalid canary bucket input");
  }
  const digest = sha256(canonicalize({ schema: ADAPTIVE_ROUTER_SCHEMA, tenantId, requestId }));
  return Number(BigInt(`0x${digest.slice(0, 16)}`) % BigInt(buckets));
}

function validNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAFE;
}

function validIdentity(identity: CandidateIdentity): boolean {
  return [identity.provider, identity.model, identity.revision, identity.endpointId]
    .every((part) => IDENTITY_PART.test(part));
}

function validProfileIdentity(identity: RetrievalProfileIdentity): boolean {
  return IDENTITY_PART.test(identity.id) && SHA256_DIGEST.test(identity.digest);
}

function validCandidate(candidate: AdaptiveRouteCandidate): boolean {
  return validIdentity(candidate.identity)
    && candidate.capabilities.length > 0
    && candidate.capabilities.every((capability) => CAPABILITY.test(capability))
    && new Set(candidate.capabilities).size === candidate.capabilities.length
    && IDENTITY_PART.test(candidate.region)
    && validNonNegativeInteger(candidate.retentionDays)
    && validNonNegativeInteger(candidate.price.estimatedCostUsdMicros)
    && Number.isFinite(Date.parse(candidate.price.observedAt))
    && validNonNegativeInteger(candidate.estimatedLatencyMs)
    && validProfileIdentity(candidate.index.retrievalProfile);
}

function validControl(control: AdaptiveRouterControl): boolean {
  const requirements = control.requirements;
  return validIdentity(control.candidate)
    && requirements.capabilities.length > 0
    && requirements.capabilities.every((capability) => CAPABILITY.test(capability))
    && new Set(requirements.capabilities).size === requirements.capabilities.length
    && requirements.allowedRegions.length > 0
    && requirements.allowedRegions.every((region) => IDENTITY_PART.test(region))
    && new Set(requirements.allowedRegions).size === requirements.allowedRegions.length
    && validNonNegativeInteger(requirements.maxRetentionDays)
    && validNonNegativeInteger(requirements.maxPriceAgeMs)
    && validNonNegativeInteger(requirements.budgetUsdMicros)
    && validNonNegativeInteger(requirements.deadlineMs)
    && validProfileIdentity(requirements.retrievalProfile);
}

function validPolicy(policy: AdaptiveRouterPolicy): boolean {
  return policy.schemaVersion === ADAPTIVE_ROUTER_SCHEMA
    && IDENTITY_PART.test(policy.policyId)
    && IDENTITY_PART.test(policy.version)
    && ["fixed_control", "adaptive", "shadow"].includes(policy.mode)
    && Number.isSafeInteger(policy.canaryPermille)
    && policy.canaryPermille >= 0
    && policy.canaryPermille <= 10_000
    && new Set(policy.orderedCandidateKeys).size === policy.orderedCandidateKeys.length
    && policy.orderedCandidateKeys.every((key) => SHA256_DIGEST.test(key));
}

function assessCandidate(
  candidate: AdaptiveRouteCandidate,
  control: AdaptiveRouterControl,
  nowMs: number,
): CandidateAssessment {
  const failures: CandidateConstraintFailure[] = [];
  const requirements = control.requirements;
  const capabilities = new Set(candidate.capabilities);
  if (!requirements.capabilities.every((capability) => capabilities.has(capability))) {
    failures.push("CAPABILITY_MISMATCH");
  }
  if (!requirements.allowedRegions.includes(candidate.region)) failures.push("REGION_MISMATCH");
  if (candidate.retentionDays > requirements.maxRetentionDays) failures.push("RETENTION_MISMATCH");
  if (!sameRetrievalProfileIdentity(candidate.index.retrievalProfile, requirements.retrievalProfile)) {
    failures.push("RETRIEVAL_PROFILE_MISMATCH");
  }

  const observedAt = Date.parse(candidate.price.observedAt);
  if (!Number.isFinite(observedAt)) failures.push("PRICE_TIMESTAMP_INVALID");
  else if (observedAt > nowMs) failures.push("PRICE_FROM_FUTURE");
  else if (nowMs - observedAt > requirements.maxPriceAgeMs) failures.push("PRICE_STALE");
  if (candidate.price.estimatedCostUsdMicros > requirements.budgetUsdMicros) failures.push("BUDGET_EXCEEDED");
  if (candidate.estimatedLatencyMs > requirements.deadlineMs) failures.push("DEADLINE_EXCEEDED");
  if (candidate.circuit !== "closed") failures.push("CIRCUIT_UNAVAILABLE");
  if (candidate.index.status !== "ready") failures.push("INDEX_UNAVAILABLE");
  return {
    candidateKey: candidateIdentityKey(candidate.identity),
    eligible: failures.length === 0,
    failures,
  };
}

const SECURITY_FAILURES = new Set<CandidateConstraintFailure>([
  "CAPABILITY_MISMATCH",
  "REGION_MISMATCH",
  "RETENTION_MISMATCH",
]);
const INTEGRITY_FAILURES = new Set<CandidateConstraintFailure>([
  "RETRIEVAL_PROFILE_MISMATCH",
]);

function refuse(
  code: Extract<AdaptiveRouterDecision, { kind: "refuse" }>["code"],
  assessments: readonly CandidateAssessment[] = [],
): AdaptiveRouterDecision {
  return { schemaVersion: ADAPTIVE_ROUTER_SCHEMA, kind: "refuse", code, assessments };
}

export function selectAdaptiveRoute(input: SelectAdaptiveRouteInput): AdaptiveRouterDecision {
  const nowMs = input.now.getTime();
  if (!input.tenantId || !input.requestId || !Number.isFinite(nowMs) || !validControl(input.control)
    || input.candidates.some((candidate) => !validCandidate(candidate))) {
    return refuse("ROUTER_INPUT_INVALID");
  }

  const byKey = new Map<string, AdaptiveRouteCandidate>();
  for (const candidate of input.candidates) {
    const key = candidateIdentityKey(candidate.identity);
    if (byKey.has(key)) return refuse("CANDIDATE_IDENTITY_COLLISION");
    byKey.set(key, candidate);
  }

  const controlKey = candidateIdentityKey(input.control.candidate);
  const controlCandidate = byKey.get(controlKey);
  if (!controlCandidate) return refuse("CONTROL_CANDIDATE_NOT_FOUND");

  const assessments = input.candidates.map((candidate) => assessCandidate(candidate, input.control, nowMs));
  const assessmentByKey = new Map(assessments.map((assessment) => [assessment.candidateKey, assessment]));
  const controlAssessment = assessmentByKey.get(controlKey)!;
  if (controlAssessment.failures.some((failure) => SECURITY_FAILURES.has(failure))) {
    return refuse("CONTROL_SECURITY_MISMATCH", assessments);
  }
  if (controlAssessment.failures.some((failure) => INTEGRITY_FAILURES.has(failure))) {
    return refuse("CONTROL_INTEGRITY_MISMATCH", assessments);
  }
  if (!controlAssessment.eligible) return refuse("CONTROL_UNAVAILABLE", assessments);

  if (!input.policy.available || !validPolicy(input.policy.policy)) {
    return {
      schemaVersion: ADAPTIVE_ROUTER_SCHEMA,
      kind: "execute",
      reason: "fixed_control_policy_unavailable",
      policyId: null,
      policyVersion: null,
      canaryBucket: null,
      execution: controlCandidate,
      shadowEvaluation: null,
      assessments,
    };
  }

  const policy = input.policy.policy;
  const challenger = policy.orderedCandidateKeys
    .filter((key) => key !== controlKey)
    .map((key) => ({ candidate: byKey.get(key), assessment: assessmentByKey.get(key) }))
    .find((item) => item.candidate && item.assessment?.eligible)?.candidate ?? null;
  const canaryBucket = stableCanaryBucket(input.tenantId, input.requestId);

  if (policy.mode === "shadow") {
    return {
      schemaVersion: ADAPTIVE_ROUTER_SCHEMA,
      kind: "execute",
      reason: "shadow_control",
      policyId: policy.policyId,
      policyVersion: policy.version,
      canaryBucket,
      execution: controlCandidate,
      shadowEvaluation: challenger ? { candidate: challenger, dispatchAllowed: false } : null,
      assessments,
    };
  }

  if (policy.mode === "adaptive" && challenger && canaryBucket < policy.canaryPermille) {
    return {
      schemaVersion: ADAPTIVE_ROUTER_SCHEMA,
      kind: "execute",
      reason: "adaptive_canary",
      policyId: policy.policyId,
      policyVersion: policy.version,
      canaryBucket,
      execution: challenger,
      shadowEvaluation: null,
      assessments,
    };
  }

  const reason = policy.mode === "fixed_control"
    ? "fixed_control"
    : challenger
      ? "fixed_control_canary_holdback"
      : "fixed_control_no_eligible_challenger";
  return {
    schemaVersion: ADAPTIVE_ROUTER_SCHEMA,
    kind: "execute",
    reason,
    policyId: policy.policyId,
    policyVersion: policy.version,
    canaryBucket,
    execution: controlCandidate,
    shadowEvaluation: null,
    assessments,
  };
}
