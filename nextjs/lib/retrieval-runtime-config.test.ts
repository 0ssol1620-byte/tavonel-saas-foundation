import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BGE_M3_REVISION,
  BGE_RERANKER_V2_M3_REVISION,
  buildProductionRetrievalProfile,
  createProductionEmbedderAdapter,
  createProductionRerankerAdapter,
  readRetrievalRuntimeEnv,
  retrievalRoutingRequestId,
  selectAdaptiveProductionRetrievalRuntime,
  selectProductionRetrievalRuntime,
} from "./retrieval-runtime-config";
import {
  ADAPTIVE_ROUTER_SCHEMA,
  candidateIdentityKey,
  type AdaptiveRouteCandidate,
  type AdaptiveRouterPolicySnapshot,
} from "./adaptive-router";
import { contentAddressedRetrievalProfileIdentity } from "./retrieval-profile-identity";

const ENV_KEYS = ["TAVONEL_RETRIEVAL_EMBEDDER_URL", "TAVONEL_RETRIEVAL_RERANKER_URL", "TAVONEL_RUNPOD_API_KEY"] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(clearEnv);

describe("readRetrievalRuntimeEnv", () => {
  it("returns null when any of the three variables is missing", () => {
    clearEnv();
    expect(readRetrievalRuntimeEnv()).toBeNull();
    process.env.TAVONEL_RETRIEVAL_EMBEDDER_URL = "https://embed.api.runpod.ai";
    expect(readRetrievalRuntimeEnv()).toBeNull();
    process.env.TAVONEL_RETRIEVAL_RERANKER_URL = "https://rerank.api.runpod.ai";
    expect(readRetrievalRuntimeEnv()).toBeNull();
  });

  it("returns the trimmed config once all three are set", () => {
    process.env.TAVONEL_RETRIEVAL_EMBEDDER_URL = " https://embed.api.runpod.ai ";
    process.env.TAVONEL_RETRIEVAL_RERANKER_URL = "https://rerank.api.runpod.ai";
    process.env.TAVONEL_RUNPOD_API_KEY = "test-key";
    expect(readRetrievalRuntimeEnv()).toEqual({
      embedderUrl: "https://embed.api.runpod.ai",
      rerankerUrl: "https://rerank.api.runpod.ai",
      apiKey: "test-key",
    });
  });

  it("rejects a non-URL value rather than passing it through", () => {
    process.env.TAVONEL_RETRIEVAL_EMBEDDER_URL = "not-a-url";
    process.env.TAVONEL_RETRIEVAL_RERANKER_URL = "https://rerank.api.runpod.ai";
    process.env.TAVONEL_RUNPOD_API_KEY = "test-key";
    expect(readRetrievalRuntimeEnv()).toBeNull();
  });

  it("rejects HTTPS endpoints outside the RunPod allowlist before taking a spend hold", () => {
    process.env.TAVONEL_RETRIEVAL_EMBEDDER_URL = "https://evil.example.com/embed";
    process.env.TAVONEL_RETRIEVAL_RERANKER_URL = "https://rerank.api.runpod.ai";
    process.env.TAVONEL_RUNPOD_API_KEY = "test-key";
    expect(readRetrievalRuntimeEnv()).toBeNull();
  });
});

describe("buildProductionRetrievalProfile", () => {
  it("pins the embedder and reranker to independent revisions, not a shared one", () => {
    const profile = buildProductionRetrievalProfile("pilot-proof");
    expect(profile.embedding.model).toBe("BAAI/bge-m3");
    expect(profile.embedding.revision).toBe(BGE_M3_REVISION);
    expect(profile.reranker?.model).toBe("BAAI/bge-reranker-v2-m3");
    expect(profile.reranker?.revision).toBe(BGE_RERANKER_V2_M3_REVISION);
    expect(profile.embedding.revision).not.toBe(profile.reranker?.revision);
  });
});

describe("createProductionEmbedderAdapter / createProductionRerankerAdapter", () => {
  const env = { embedderUrl: "https://embed.api.runpod.ai", rerankerUrl: "https://rerank.api.runpod.ai", apiKey: "test-key" };

  it("builds an embedder adapter whose declared identity matches the production profile", () => {
    const adapter = createProductionEmbedderAdapter(env, "pilot-proof");
    const profile = buildProductionRetrievalProfile("pilot-proof");
    expect(adapter.identity()).toEqual({
      provider: profile.embedding.provider,
      model: profile.embedding.model,
      revision: profile.embedding.revision,
      dimension: profile.embedding.dimension,
      normalize: profile.embedding.normalize,
    });
  });

  it("builds a reranker adapter whose declared identity matches the production profile", () => {
    const adapter = createProductionRerankerAdapter(env, "pilot-proof");
    const profile = buildProductionRetrievalProfile("pilot-proof");
    expect(adapter.identity()).toEqual({
      provider: profile.reranker?.provider,
      model: profile.reranker?.model,
      revision: profile.reranker?.revision,
    });
  });
});

describe("selectAdaptiveProductionRetrievalRuntime", () => {
  const workspaceKey = "pilot-proof";
  const now = new Date("2026-09-20T12:00:00.000Z");

  it("derives the same stable assignment key from equivalent query whitespace", () => {
    expect(retrievalRoutingRequestId("collection-a", "  계약\t조건  ")).toBe(
      retrievalRoutingRequestId("collection-a", "계약 조건"),
    );
    expect(retrievalRoutingRequestId("collection-a", "계약 조건")).not.toBe(
      retrievalRoutingRequestId("collection-b", "계약 조건"),
    );
  });

  function fixture(indexStatus: AdaptiveRouteCandidate["index"]["status"] = "ready") {
    const baseRuntime = selectProductionRetrievalRuntime(workspaceKey, { env: null, registry: null, now });
    const embedder = {
      identity: () => ({ ...baseRuntime.profile.embedding }),
      endpointId: () => "control-endpoint",
      embedDocuments: vi.fn(), embedQuery: vi.fn(),
    };
    const reranker = {
      identity: () => ({ ...baseRuntime.profile.reranker! }),
      rerank: vi.fn(),
    };
    const controlRuntime = { ...baseRuntime, embedder, reranker };
    const profileIdentity = contentAddressedRetrievalProfileIdentity(controlRuntime.profile);
    const control: AdaptiveRouteCandidate = {
      identity: {
        provider: controlRuntime.profile.embedding.provider,
        model: controlRuntime.profile.embedding.model,
        revision: controlRuntime.profile.embedding.revision,
        endpointId: "control-endpoint",
      },
      capabilities: ["retrieval"], region: "us", retentionDays: 0,
      price: { observedAt: now.toISOString(), estimatedCostUsdMicros: 10 },
      estimatedLatencyMs: 100, circuit: "closed",
      index: { status: "ready", retrievalProfile: profileIdentity },
    };
    const challenger: AdaptiveRouteCandidate = {
      ...control,
      identity: { ...control.identity, endpointId: "challenger-endpoint" },
      index: { status: indexStatus, retrievalProfile: profileIdentity },
    };
    const challengerRuntime = {
      ...controlRuntime,
      embedder: { ...embedder, endpointId: () => "challenger-endpoint" },
      decision: { ...controlRuntime.decision, evaluatedAt: "challenger" },
    };
    return {
      controlRuntime,
      challengerRuntime,
      control,
      challenger,
      controlPlaneLineage: {
        policyId: "11111111-1111-4111-8111-111111111111",
        policyVersion: "revision-1",
        policyRevision: 1,
        rolloutRevision: 1,
        assignmentId: "22222222-2222-4222-8222-222222222222",
        policyDigest: `sha256:${"1".repeat(64)}`,
        evidenceDigest: `sha256:${"2".repeat(64)}`,
        scopeDigest: `sha256:${"3".repeat(64)}`,
        assignmentDigest: `sha256:${"4".repeat(64)}`,
        thresholdsDigest: `sha256:${"5".repeat(64)}`,
        indexStateDigest: `sha256:${"6".repeat(64)}`,
        controlId: candidateIdentityKey(control.identity),
      },
      controlSpec: {
        candidate: control.identity,
        requirements: {
          capabilities: ["retrieval"], allowedRegions: ["us"], maxRetentionDays: 0,
          maxPriceAgeMs: 60_000, budgetUsdMicros: 100, deadlineMs: 1_000,
          retrievalProfile: profileIdentity,
        },
      },
    };
  }

  function policy(mode: "adaptive" | "shadow", challenger: AdaptiveRouteCandidate): AdaptiveRouterPolicySnapshot {
    return { available: true, policy: {
      schemaVersion: ADAPTIVE_ROUTER_SCHEMA,
      policyId: "policy-1", version: "revision-1", mode,
      orderedCandidateKeys: [candidateIdentityKey(challenger.identity)],
      canaryPermille: 10_000,
    } };
  }

  it("records a shadow challenger while executing the fixed control", () => {
    const f = fixture();
    const selected = selectAdaptiveProductionRetrievalRuntime(workspaceKey, {
      requestId: "request-1", control: f.controlSpec,
      controlPlaneLineage: f.controlPlaneLineage,
      policy: policy("shadow", f.challenger),
      candidates: [
        { candidate: f.control, endpointId: f.control.identity.endpointId, runtime: f.controlRuntime },
        { candidate: f.challenger, endpointId: f.challenger.identity.endpointId, runtime: f.challengerRuntime },
      ],
    }, now);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.runtime.decision.evaluatedAt).toBe(f.controlRuntime.decision.evaluatedAt);
    expect(selected.runtime.routerDecision).toMatchObject({
      kind: "execute", reason: "shadow_control",
      execution: { identity: f.control.identity },
      shadowEvaluation: { candidate: { identity: f.challenger.identity }, dispatchAllowed: false },
    });
    expect(selected.runtime.decision.router).toEqual(selected.runtime.routerDecision);
  });

  it("keeps the fixed control when the challenger index is missing", () => {
    const f = fixture("missing");
    const selected = selectAdaptiveProductionRetrievalRuntime(workspaceKey, {
      requestId: "request-2", control: f.controlSpec,
      controlPlaneLineage: f.controlPlaneLineage,
      policy: policy("adaptive", f.challenger),
      candidates: [
        { candidate: f.control, endpointId: f.control.identity.endpointId, runtime: f.controlRuntime },
        { candidate: f.challenger, endpointId: f.challenger.identity.endpointId, runtime: f.challengerRuntime },
      ],
    }, now);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.runtime.routerDecision).toMatchObject({
      kind: "execute", reason: "fixed_control_no_eligible_challenger",
      execution: { identity: f.control.identity },
    });
  });

  it("executes an admitted canary deterministically", () => {
    const f = fixture();
    const input = {
      requestId: "stable-request", control: f.controlSpec,
      controlPlaneLineage: f.controlPlaneLineage,
      policy: policy("adaptive", f.challenger),
      candidates: [
        { candidate: f.control, endpointId: f.control.identity.endpointId, runtime: f.controlRuntime },
        { candidate: f.challenger, endpointId: f.challenger.identity.endpointId, runtime: f.challengerRuntime },
      ],
    } as const;
    const first = selectAdaptiveProductionRetrievalRuntime(workspaceKey, input, now);
    const second = selectAdaptiveProductionRetrievalRuntime(workspaceKey, input, now);
    expect(first).toEqual(second);
    expect(first.ok && first.runtime.decision.evaluatedAt).toBe("challenger");
    expect(first.ok && first.runtime.routerDecision).toMatchObject({ reason: "adaptive_canary" });
  });

  it("refuses a runtime whose exact profile digest differs from the routed index", () => {
    const f = fixture();
    const incompatible = buildProductionRetrievalProfile(workspaceKey);
    incompatible.embedding = { ...incompatible.embedding, revision: "other-revision" };
    incompatible.profileDigest = `sha256:${"0".repeat(64)}`;
    const selected = selectAdaptiveProductionRetrievalRuntime(workspaceKey, {
      requestId: "request-3", control: f.controlSpec,
      controlPlaneLineage: f.controlPlaneLineage,
      policy: policy("adaptive", f.challenger),
      candidates: [
        { candidate: f.control, endpointId: f.control.identity.endpointId, runtime: f.controlRuntime },
        { candidate: f.challenger, endpointId: f.challenger.identity.endpointId, runtime: { ...f.challengerRuntime, profile: incompatible } },
      ],
    }, now);
    expect(selected).toEqual({ ok: false, code: "CONTROL_INTEGRITY_MISMATCH" });
  });

  it("refuses a candidate label that does not match its actual adapter or endpoint binding", () => {
    const f = fixture();
    const selected = selectAdaptiveProductionRetrievalRuntime(workspaceKey, {
      requestId: "request-4", control: f.controlSpec,
      controlPlaneLineage: f.controlPlaneLineage,
      policy: policy("adaptive", f.challenger),
      candidates: [
        { candidate: f.control, endpointId: f.control.identity.endpointId, runtime: f.controlRuntime },
        { candidate: f.challenger, endpointId: f.challenger.identity.endpointId, runtime: f.controlRuntime },
      ],
    }, now);
    expect(selected).toEqual({ ok: false, code: "CONTROL_INTEGRITY_MISMATCH" });
  });
});
