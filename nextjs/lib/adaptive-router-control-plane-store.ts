import { canonicalize, sha256 } from "./collection-compiler";
import {
  ADAPTIVE_ROUTER_SCHEMA,
  candidateIdentityKey,
  type AdaptiveRouterControl,
  type AdaptiveRouterPolicy,
} from "./adaptive-router";
import type {
  AdaptiveRetrievalRuntimeCandidate,
  AdaptiveRetrievalRuntimeInput,
} from "./retrieval-runtime-config";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export type AdaptiveRouterScope = Readonly<{
  workspaceKey: string;
  collectionId: string;
  endpoint: "ask" | "search";
  retrievalProfileDigest: string;
}>;

export type AdaptiveRouterPlanInput = Readonly<{
  scope: AdaptiveRouterScope;
  requestId: string;
  control: AdaptiveRouterControl;
  candidates: readonly AdaptiveRetrievalRuntimeCandidate[];
  now?: Date;
}>;

export type AdaptiveRouterPlanLoadResult =
  | Readonly<{
      ok: true;
      adaptive: Omit<AdaptiveRetrievalRuntimeInput, "requestId"> | undefined;
      reason?: "not_configured" | "policy_unavailable";
    }>
  | Readonly<{
      ok: false;
      code: "ADAPTIVE_ROUTER_CONTROL_PLANE_FAILED" | "ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID";
    }>;

function digest(value: unknown): string {
  return `sha256:${sha256(canonicalize(value))}`;
}

export function adaptiveRouterScopeDigest(scope: AdaptiveRouterScope): string {
  return digest({ schemaVersion: "tavonel.adaptive_router_scope.v1", ...scope });
}

export function adaptiveRouterCandidateSetDigest(
  candidates: readonly AdaptiveRetrievalRuntimeCandidate[],
): string {
  return digest({
    schemaVersion: "tavonel.adaptive_router_candidate_set.v1",
    candidates: candidates.map(({ candidate }) => ({
      identity: candidate.identity,
      capabilities: candidate.capabilities,
      region: candidate.region,
      retentionDays: candidate.retentionDays,
    })),
  });
}

export function adaptiveRouterIndexStateDigest(
  candidates: readonly AdaptiveRetrievalRuntimeCandidate[],
): string {
  return digest({
    schemaVersion: "tavonel.adaptive_router_index_state.v1",
    indexes: candidates.map(({ candidate }) => ({
      candidateKey: candidateIdentityKey(candidate.identity),
      status: candidate.index.status,
      retrievalProfile: candidate.index.retrievalProfile,
    })),
  });
}

export function adaptiveRouterThresholdsDigest(
  control: AdaptiveRouterControl,
  policy: AdaptiveRouterPolicy,
): string {
  return digest({
    schemaVersion: "tavonel.adaptive_router_thresholds.v1",
    requirements: control.requirements,
    mode: policy.mode,
    canaryPermille: policy.canaryPermille,
    orderedCandidateKeys: policy.orderedCandidateKeys,
  });
}

function validPolicy(value: unknown): value is AdaptiveRouterPolicy {
  if (!value || typeof value !== "object") return false;
  const policy = value as Partial<AdaptiveRouterPolicy>;
  return policy.schemaVersion === ADAPTIVE_ROUTER_SCHEMA
    && typeof policy.policyId === "string" && UUID.test(policy.policyId)
    && typeof policy.version === "string" && IDENTITY.test(policy.version)
    && (policy.mode === "fixed_control" || policy.mode === "adaptive" || policy.mode === "shadow")
    && Number.isSafeInteger(policy.canaryPermille) && Number(policy.canaryPermille) >= 0
    && Number(policy.canaryPermille) <= 10_000
    && Array.isArray(policy.orderedCandidateKeys)
    && policy.orderedCandidateKeys.length > 0
    && policy.orderedCandidateKeys.every((key) => typeof key === "string" && DIGEST.test(key))
    && new Set(policy.orderedCandidateKeys).size === policy.orderedCandidateKeys.length;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function unavailableMessage(message: string): boolean {
  return message.includes("adaptive_router_policy_unavailable")
    || message.includes("adaptive_router_kill_switch_engaged")
    || message.includes("adaptive_router_assignment_revoked");
}

export async function loadAdaptiveRouterPlan(
  input: AdaptiveRouterPlanInput,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<AdaptiveRouterPlanLoadResult> {
  const now = input.now ?? new Date();
  if (!input.scope.workspaceKey || !input.scope.collectionId || !input.requestId
    || !DIGEST.test(input.scope.retrievalProfileDigest) || !Number.isFinite(now.getTime())
    || input.candidates.length === 0
    || input.candidates.some(({ candidate, endpointId }) => endpointId !== candidate.identity.endpointId)) {
    return { ok: false, code: "ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID" };
  }
  const config = readSupabaseAdminConfig(env);
  if (!config) return { ok: true, adaptive: undefined, reason: "not_configured" };

  const scopeDigest = adaptiveRouterScopeDigest(input.scope);
  const assignmentKeyDigest = digest({
    schemaVersion: "tavonel.adaptive_router_assignment_key.v1",
    requestId: input.requestId,
  });
  const subjectDigest = digest({
    schemaVersion: "tavonel.adaptive_router_subject.v1",
    workspaceKey: input.scope.workspaceKey,
  });
  const assignmentDigest = digest({
    schemaVersion: "tavonel.adaptive_router_assignment.v1",
    scopeDigest,
    assignmentKeyDigest,
    subjectDigest,
  });

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/resolve_adaptive_router_policy_v1", {
      method: "POST",
      body: JSON.stringify({
        p_scope_digest: scopeDigest,
        p_assignment_key_digest: assignmentKeyDigest,
        p_subject_digest: subjectDigest,
        p_assignment_digest: assignmentDigest,
      }),
    });
  } catch {
    return { ok: false, code: "ADAPTIVE_ROUTER_CONTROL_PLANE_FAILED" };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : "";
    return unavailableMessage(message)
      ? { ok: true, adaptive: undefined, reason: "policy_unavailable" }
      : { ok: false, code: "ADAPTIVE_ROUTER_CONTROL_PLANE_FAILED" };
  }

  const value = await response.json().catch(() => null) as Record<string, unknown> | null;
  const assignment = value?.assignment as Record<string, unknown> | null;
  const envelope = value?.policy as Record<string, unknown> | null;
  const routerPolicy = envelope?.routerPolicy;
  const validFrom = Date.parse(String(value?.validFrom ?? ""));
  const validUntil = Date.parse(String(value?.validUntil ?? ""));
  if (!value || !assignment || !envelope || !validPolicy(routerPolicy)
    || !UUID.test(String(value.policyId ?? "")) || value.policyId !== routerPolicy.policyId
    || !positiveSafeInteger(value.policyRevision) || !positiveSafeInteger(value.rolloutRevision)
    || (value.rolloutState !== "shadow" && value.rolloutState !== "canary" && value.rolloutState !== "active")
    || !DIGEST.test(String(value.policyDigest ?? ""))
    || !DIGEST.test(String(value.evidenceDigest ?? ""))
    || value.scopeDigest !== scopeDigest
    || value.candidateSetDigest !== adaptiveRouterCandidateSetDigest(input.candidates)
    || value.indexStateDigest !== adaptiveRouterIndexStateDigest(input.candidates)
    || value.thresholdsDigest !== adaptiveRouterThresholdsDigest(input.control, routerPolicy)
    || !positiveSafeInteger(value.controlRevision)
    || !positiveSafeInteger(value.candidateRevision)
    || !positiveSafeInteger(value.rollbackRevision)
    || !Number.isFinite(validFrom) || !Number.isFinite(validUntil)
    || now.getTime() < validFrom || now.getTime() >= validUntil
    || !UUID.test(String(assignment.assignmentId ?? ""))
    || (assignment.variant !== "control" && assignment.variant !== "candidate")
    || !positiveSafeInteger(assignment.modelRevision)
    || assignment.assignmentDigest !== assignmentDigest
    || (assignment.variant === "control" && assignment.modelRevision !== value.controlRevision)
    || (assignment.variant === "candidate" && assignment.modelRevision !== value.candidateRevision)) {
    return { ok: false, code: "ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID" };
  }

  const candidateKeys = new Set(input.candidates.map(({ candidate }) => candidateIdentityKey(candidate.identity)));
  const controlKey = candidateIdentityKey(input.control.candidate);
  const challengerKeys = routerPolicy.orderedCandidateKeys.filter((key) => key !== controlKey);
  if (!candidateKeys.has(controlKey)
    || routerPolicy.orderedCandidateKeys.some((key) => !candidateKeys.has(key))
    || ((routerPolicy.mode === "shadow" || routerPolicy.mode === "adaptive") && challengerKeys.length === 0)
    || (value.rolloutState === "shadow") !== (routerPolicy.mode === "shadow")) {
    return { ok: false, code: "ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID" };
  }

  const assignedPolicy: AdaptiveRouterPolicy = value.rolloutState === "shadow"
    ? routerPolicy
    : { ...routerPolicy, canaryPermille: assignment.variant === "candidate" ? 10_000 : 0 };
  return {
    ok: true,
    adaptive: {
      control: input.control,
      policy: { available: true, policy: assignedPolicy },
      candidates: input.candidates,
      controlPlaneLineage: {
        policyId: String(value.policyId),
        policyVersion: routerPolicy.version,
        policyRevision: Number(value.policyRevision),
        rolloutRevision: Number(value.rolloutRevision),
        assignmentId: String(assignment.assignmentId),
        policyDigest: String(value.policyDigest),
        evidenceDigest: String(value.evidenceDigest),
        scopeDigest,
        assignmentDigest,
        thresholdsDigest: String(value.thresholdsDigest),
        indexStateDigest: String(value.indexStateDigest),
        controlId: controlKey,
      },
    },
  };
}
