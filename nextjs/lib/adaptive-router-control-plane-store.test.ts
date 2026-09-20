import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminConfig, adminRequest } = vi.hoisted(() => ({
  adminConfig: vi.fn(),
  adminRequest: vi.fn(),
}));
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: adminConfig,
  supabaseAdminRequest: adminRequest,
}));

import { ADAPTIVE_ROUTER_SCHEMA, candidateIdentityKey } from "./adaptive-router";
import {
  adaptiveRouterCandidateSetDigest,
  adaptiveRouterIndexStateDigest,
  adaptiveRouterScopeDigest,
  adaptiveRouterThresholdsDigest,
  loadAdaptiveRouterPlan,
  type AdaptiveRouterPlanInput,
} from "./adaptive-router-control-plane-store";
import { selectProductionRetrievalRuntime } from "./retrieval-runtime-config";
import { contentAddressedRetrievalProfileIdentity } from "./retrieval-profile-identity";

const now = new Date("2026-09-20T12:00:00.000Z");
const policyId = "11111111-1111-4111-8111-111111111111";
const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "s".repeat(48) };

function fixture(): AdaptiveRouterPlanInput {
  const runtime = selectProductionRetrievalRuntime("pilot-proof", { env: null, registry: null, now });
  const profile = contentAddressedRetrievalProfileIdentity(runtime.profile);
  const base = {
    capabilities: ["retrieval"], region: "us", retentionDays: 0,
    price: { observedAt: now.toISOString(), estimatedCostUsdMicros: 10 },
    estimatedLatencyMs: 100, circuit: "closed" as const,
    index: { status: "ready" as const, retrievalProfile: profile },
  };
  const control = { ...base, identity: {
    provider: "runpod", model: "control", revision: "1", endpointId: "control",
  } };
  const challenger = { ...base, identity: {
    provider: "runpod", model: "challenger", revision: "2", endpointId: "challenger",
  } };
  return {
    scope: { workspaceKey: "pilot-proof", collectionId: "collection-1", endpoint: "ask", retrievalProfileDigest: profile.digest },
    requestId: "request-1",
    now,
    control: { candidate: control.identity, requirements: {
      capabilities: ["retrieval"], allowedRegions: ["us"], maxRetentionDays: 0,
      maxPriceAgeMs: 60_000, budgetUsdMicros: 100, deadlineMs: 1_000,
      retrievalProfile: profile,
    } },
    candidates: [
      { candidate: control, endpointId: control.identity.endpointId, runtime },
      { candidate: challenger, endpointId: challenger.identity.endpointId,
        runtime: { ...runtime, decision: { ...runtime.decision, evaluatedAt: "challenger" } } },
    ],
  };
}

function rpcReceipt(input: AdaptiveRouterPlanInput, variant: "control" | "candidate" = "candidate") {
  const routerPolicy = {
    schemaVersion: ADAPTIVE_ROUTER_SCHEMA,
    policyId,
    version: "revision-7",
    mode: "adaptive" as const,
    orderedCandidateKeys: [candidateIdentityKey(input.candidates[1].candidate.identity)],
    canaryPermille: 2_500,
  };
  const request = JSON.parse(adminRequest.mock.calls.at(-1)?.[2]?.body ?? "{}");
  return {
    policyId, policyRevision: 7, rolloutRevision: 3, rolloutState: "canary",
    policyDigest: `sha256:${"1".repeat(64)}`,
    evidenceDigest: `sha256:${"2".repeat(64)}`,
    thresholdsDigest: adaptiveRouterThresholdsDigest(input.control, routerPolicy),
    scopeDigest: adaptiveRouterScopeDigest(input.scope),
    candidateSetDigest: adaptiveRouterCandidateSetDigest(input.candidates),
    indexStateDigest: adaptiveRouterIndexStateDigest(input.candidates),
    controlRevision: 10, candidateRevision: 11, rollbackRevision: 9,
    validFrom: "2026-09-20T11:00:00.000Z", validUntil: "2026-09-20T13:00:00.000Z",
    assignment: {
      assignmentId: "22222222-2222-4222-8222-222222222222",
      variant,
      modelRevision: variant === "candidate" ? 11 : 10,
      assignmentDigest: request.p_assignment_digest,
    },
    policy: { schemaVersion: "tavonel.adaptive_router_policy.v1", routerPolicy },
  };
}

describe("adaptive router service-role control-plane loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminConfig.mockReturnValue({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  });

  it("authenticates through the admin client and converts a stable candidate assignment into an adaptive plan", async () => {
    const input = fixture();
    adminRequest.mockImplementation(async () => Response.json(rpcReceipt(input)));
    const result = await loadAdaptiveRouterPlan(input, env);
    expect(result.ok && result.adaptive?.policy).toMatchObject({
      available: true,
      policy: { policyId, canaryPermille: 10_000 },
    });
    const [, path, init] = adminRequest.mock.calls[0];
    expect(path).toBe("/rest/v1/rpc/resolve_adaptive_router_policy_v1");
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({
      p_scope_digest: adaptiveRouterScopeDigest(input.scope),
      p_assignment_key_digest: expect.stringMatching(/^sha256:/),
      p_subject_digest: expect.stringMatching(/^sha256:/),
      p_assignment_digest: expect.stringMatching(/^sha256:/),
    }));
  });

  it("keeps the fixed control when the service role is not configured or policy is revoked", async () => {
    const input = fixture();
    adminConfig.mockReturnValueOnce(null);
    await expect(loadAdaptiveRouterPlan(input, {})).resolves.toEqual({
      ok: true, adaptive: undefined, reason: "not_configured",
    });
    adminRequest.mockResolvedValueOnce(Response.json(
      { message: "adaptive_router_kill_switch_engaged" }, { status: 409 },
    ));
    await expect(loadAdaptiveRouterPlan(input, env)).resolves.toEqual({
      ok: true, adaptive: undefined, reason: "policy_unavailable",
    });
  });

  it("loads a shadow head as evidence-only policy without changing its threshold", async () => {
    const input = fixture();
    adminRequest.mockImplementation(async () => {
      const receipt = rpcReceipt(input, "control");
      const routerPolicy = { ...receipt.policy.routerPolicy, mode: "shadow" as const };
      return Response.json({
        ...receipt,
        rolloutState: "shadow",
        thresholdsDigest: adaptiveRouterThresholdsDigest(input.control, routerPolicy),
        policy: { ...receipt.policy, routerPolicy },
      });
    });
    const result = await loadAdaptiveRouterPlan(input, env);
    expect(result.ok && result.adaptive?.policy).toMatchObject({
      available: true,
      policy: { mode: "shadow", canaryPermille: 2_500 },
    });
  });

  it("rejects an adaptive policy that has no executable challenger", async () => {
    const full = fixture();
    const input = { ...full, candidates: full.candidates.slice(0, 1) };
    adminRequest.mockImplementation(async () => {
      const receipt = rpcReceipt(full);
      const routerPolicy = {
        ...receipt.policy.routerPolicy,
        orderedCandidateKeys: [candidateIdentityKey(input.control.candidate)],
      };
      return Response.json({
        ...receipt,
        candidateSetDigest: adaptiveRouterCandidateSetDigest(input.candidates),
        indexStateDigest: adaptiveRouterIndexStateDigest(input.candidates),
        thresholdsDigest: adaptiveRouterThresholdsDigest(input.control, routerPolicy),
        assignment: {
          ...receipt.assignment,
          assignmentDigest: JSON.parse(adminRequest.mock.calls.at(-1)?.[2]?.body ?? "{}").p_assignment_digest,
        },
        policy: { ...receipt.policy, routerPolicy },
      });
    });
    await expect(loadAdaptiveRouterPlan(input, env)).resolves.toEqual({
      ok: false, code: "ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID",
    });
  });

  it("fails closed on an unbound digest, expired validity, or malformed assignment", async () => {
    const input = fixture();
    adminRequest.mockImplementationOnce(async () => Response.json({
      ...rpcReceipt(input), candidateSetDigest: `sha256:${"f".repeat(64)}`,
    }));
    await expect(loadAdaptiveRouterPlan(input, env)).resolves.toEqual({
      ok: false, code: "ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID",
    });
    adminRequest.mockImplementationOnce(async () => Response.json({
      ...rpcReceipt(input), validUntil: "2026-09-20T11:59:59.000Z",
    }));
    await expect(loadAdaptiveRouterPlan(input, env)).resolves.toEqual({
      ok: false, code: "ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID",
    });
  });

  it("does not expose database or transport errors", async () => {
    adminRequest.mockRejectedValueOnce(new Error("secret database detail"));
    await expect(loadAdaptiveRouterPlan(fixture(), env)).resolves.toEqual({
      ok: false, code: "ADAPTIVE_ROUTER_CONTROL_PLANE_FAILED",
    });
  });
});
