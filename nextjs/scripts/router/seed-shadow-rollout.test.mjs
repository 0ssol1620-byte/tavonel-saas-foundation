import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminConfig, adminRequest } = vi.hoisted(() => ({
  adminConfig: vi.fn(),
  adminRequest: vi.fn(),
}));
vi.mock("../../lib/supabase-admin.ts", () => ({
  readSupabaseAdminConfig: adminConfig,
  supabaseAdminRequest: adminRequest,
}));

import { loadAdaptiveRouterPlan } from "../../lib/adaptive-router-control-plane-store.ts";
import {
  BGE_M3_REVISION,
  BGE_RERANKER_V2_M3_REVISION,
  buildAdaptiveRouterCandidateSet,
  readRetrievalRuntimeEnv,
  selectProductionRetrievalRuntime,
} from "../../lib/retrieval-runtime-config.ts";
import { contentAddressedRetrievalProfileIdentity } from "../../lib/retrieval-profile-identity.ts";
import { buildShadowSeedPlan, shadowSeedPlanSummary } from "./seed-shadow-rollout.mjs";

const NOW = new Date("2026-09-21T09:00:00.000Z");
const WORKSPACE = "pilot-proof";
const COLLECTION = "c0ffee00-0000-4000-8000-000000000001";

function registryEntry(role, model, revision) {
  return {
    registryId: role === "embedder" ? "retrieval-bge-m3" : "retrieval-bge-reranker-v2-m3",
    role, provider: "huggingface", model, revision,
    eligible: true,
    approvalStatus: "approved",
    approvalId: `approval-${role}`,
    approvedAt: "2026-09-20T02:00:00.000Z",
    verifiedAt: "2026-09-21T03:00:00.000Z",
    validUntil: "2026-09-22T03:00:00.000Z",
    license: { status: "approved", approvalId: `license-${role}` },
    providerDataPolicy: { status: "approved", approvalId: `policy-${role}` },
    capabilityReceiptIds: [`capability-${role}`],
    priceSnapshot: {
      snapshotId: "price-2026-09-21", currency: "USD", unit: "gpu_second",
      unitPrice: 0.00042, effectiveAt: "2026-09-21T00:00:00.000Z",
      validUntil: "2026-09-22T00:00:00.000Z",
    },
    lifecycle: { status: "active", permittedUses: ["fixed_retrieval", "adaptive_routing"] },
  };
}

function env(overrides = {}) {
  return {
    TAVONEL_RETRIEVAL_EMBEDDER_URL: "https://control.api.runpod.ai/v2/embed",
    TAVONEL_RETRIEVAL_RERANKER_URL: "https://control.api.runpod.ai/v2/rerank",
    TAVONEL_RUNPOD_API_KEY: "rp-key",
    TAVONEL_RETRIEVAL_MODEL_REGISTRY_JSON: JSON.stringify([
      registryEntry("embedder", "BAAI/bge-m3", BGE_M3_REVISION),
      registryEntry("reranker", "BAAI/bge-reranker-v2-m3", BGE_RERANKER_V2_M3_REVISION),
    ]),
    TAVONEL_ADAPTIVE_RETRIEVAL_CONTROL_JSON: JSON.stringify({
      schemaVersion: "tavonel.adaptive_retrieval_control.v1",
      capabilities: ["retrieval.dense"], region: "us", retentionDays: 0,
      price: { observedAt: "2026-09-21T08:00:00.000Z", estimatedCostUsdMicros: 500 },
      estimatedLatencyMs: 400, circuit: "closed",
      requirements: {
        allowedRegions: ["us"], maxRetentionDays: 0, maxPriceAgeMs: 86_400_000,
        budgetUsdMicros: 5_000, deadlineMs: 5_000,
      },
    }),
    TAVONEL_ADAPTIVE_RETRIEVAL_CHALLENGER_JSON: JSON.stringify([{
      schemaVersion: "tavonel.adaptive_retrieval_challenger.v1",
      provider: "huggingface", endpointId: "challenger-endpoint", region: "us",
      retentionDays: 0,
      price: { observedAt: "2026-09-21T08:00:00.000Z", estimatedCostUsdMicros: 450 },
      estimatedLatencyMs: 380, circuit: "closed", indexStatus: "ready",
    }]),
    ...overrides,
  };
}

function plan(overrides = {}) {
  return buildShadowSeedPlan({
    workspaceKey: WORKSPACE, collectionId: COLLECTION, endpoint: "search",
    now: NOW, env: env(), ...overrides,
  });
}

describe("router shadow rollout seed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("produces a deterministic dry-run plan from the same scope and configuration", () => {
    expect(shadowSeedPlanSummary(plan())).toEqual(shadowSeedPlanSummary(plan()));
    const summary = shadowSeedPlanSummary(plan());
    expect(summary).toMatchObject({
      mode: "shadow",
      candidateBasisPoints: 0,
      policyRevision: 1,
      validFrom: "2026-09-21T09:00:00.000Z",
      validUntil: "2026-10-21T09:00:00.000Z",
    });
    // The control key must be in the ordered list: the attempt-decision trigger requires both
    // control_id and chosen_id to be members, and in shadow the chosen candidate is the control.
    expect(summary.orderedCandidateKeys[0]).toBe(summary.controlKey);
    expect(summary.orderedCandidateKeys).toHaveLength(2);
    expect(shadowSeedPlanSummary(plan({ endpoint: "ask" })).scopeDigest).not.toBe(summary.scopeDigest);
  });

  it("refuses to seed shadow when no challenger is declared", () => {
    expect(() => plan({ env: env({ TAVONEL_ADAPTIVE_RETRIEVAL_CHALLENGER_JSON: undefined }) }))
      .toThrow(/at least one declared challenger/);
  });

  it("refuses when the adaptive control configuration is absent", () => {
    expect(() => plan({ env: env({ TAVONEL_ADAPTIVE_RETRIEVAL_CONTROL_JSON: undefined }) }))
      .toThrow(/adaptive control configuration/);
  });

  it("emits a shadow-entry evidence receipt that claims no measurement", () => {
    const receipt = plan().evidenceReceipt;
    expect(receipt).toMatchObject({
      schemaVersion: "tavonel.adaptive_router_evidence.v1",
      stage: "shadow_entry",
      measurement: "none",
      thresholdResults: {},
    });
    expect(receipt.evidenceDigest).toBeUndefined();
  });

  it("seeds a policy envelope the runtime accepts as a shadow plan", async () => {
    const seeded = plan();
    const evidenceDigest = `sha256:${"a".repeat(64)}`;
    const policyDigest = `sha256:${"b".repeat(64)}`;

    // Rebuild the request path's own control and candidate set, exactly as
    // resolveConfiguredProductionRetrievalRuntime does, and resolve the seeded policy with it.
    const runtimeEnv = env();
    const fixed = selectProductionRetrievalRuntime(WORKSPACE, {
      env: readRetrievalRuntimeEnv(runtimeEnv),
      registry: JSON.parse(runtimeEnv.TAVONEL_RETRIEVAL_MODEL_REGISTRY_JSON),
      now: NOW,
    });
    const profileIdentity = contentAddressedRetrievalProfileIdentity(fixed.profile);
    const candidateSet = buildAdaptiveRouterCandidateSet({
      fixed, profileIdentity,
      embedderIdentity: fixed.embedder.identity(),
      endpointId: fixed.embedder.endpointId(),
      env: runtimeEnv,
    });

    adminConfig.mockReturnValue({ url: "https://example.supabase.co", serviceRoleKey: "s".repeat(48) });
    adminRequest.mockImplementation(async (_config, _path, init) => {
      const request = JSON.parse(init.body);
      expect(request.p_scope_digest).toBe(seeded.scopeDigest);
      return Response.json({
        policyId: seeded.policyId,
        policyRevision: seeded.policyRevision,
        rolloutRevision: 1,
        rolloutState: "shadow",
        policyDigest,
        evidenceDigest,
        thresholdsDigest: seeded.thresholdsDigest,
        scopeDigest: seeded.scopeDigest,
        candidateSetDigest: seeded.candidateSetDigest,
        indexStateDigest: seeded.indexStateDigest,
        controlRevision: seeded.controlRevision,
        candidateRevision: seeded.candidateRevision,
        rollbackRevision: seeded.rollbackRevision,
        validFrom: seeded.validFrom,
        validUntil: seeded.validUntil,
        assignment: {
          assignmentId: "22222222-2222-4222-8222-222222222222",
          variant: "control",
          modelRevision: seeded.controlRevision,
          assignmentDigest: request.p_assignment_digest,
        },
        policy: seeded.policyBody(evidenceDigest),
      });
    });

    const loaded = await loadAdaptiveRouterPlan({
      scope: seeded.scope,
      requestId: "request-1",
      control: candidateSet.control,
      candidates: candidateSet.candidates,
      now: NOW,
    }, { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "s".repeat(48) });

    expect(loaded.ok).toBe(true);
    expect(loaded.adaptive?.policy).toMatchObject({
      available: true,
      policy: { mode: "shadow", canaryPermille: 0, policyId: seeded.policyId },
    });
    expect(loaded.adaptive?.controlPlaneLineage.scopeDigest).toBe(seeded.scopeDigest);
  });
});
