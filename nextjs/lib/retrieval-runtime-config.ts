import {
  createRunPodEmbedderAdapter,
  looksLikeRunPodEmbeddingUrl,
  RUNPOD_EMBEDDER_REQUEST_TIMEOUT_MS,
  type RunPodConnectionConfig,
} from "./embedder-adapter-runpod";
import type { EmbedderAdapter } from "./embedder-adapter";
import {
  createRunPodRerankerAdapter,
  RUNPOD_RERANKER_REQUEST_TIMEOUT_MS,
} from "./reranker-adapter-runpod";
import type { RerankerAdapter } from "./reranker-adapter";
import { governEmbedderAdapter, governRerankerAdapter } from "./retrieval-model-provider-governance";
import { buildBgeM3BaselineProfile, type RetrievalProfile } from "./retrieval-profile";
import {
  readRetrievalModelRegistry,
  selectRegisteredRetrievalModel,
  type RetrievalModelSelection,
} from "./retrieval-model-registry";
import {
  candidateIdentityKey,
  selectAdaptiveRoute,
  type AdaptiveRouteCandidate,
  type AdaptiveRouterControl,
  type AdaptiveRouterDecision,
  type AdaptiveRouterPolicySnapshot,
} from "./adaptive-router";
import {
  contentAddressedRetrievalProfileIdentity,
  sameRetrievalProfileIdentity,
  type RetrievalProfileIdentity,
} from "./retrieval-profile-identity";
import { createHash } from "node:crypto";
import { loadAdaptiveRouterPlan } from "./adaptive-router-control-plane-store";

// Wires the Wave 2 GPU backend: two official Hugging Face Text Embeddings Inference (TEI)
// containers (ghcr.io/huggingface/text-embeddings-inference:89-1.8.3 -- the Ada Lovelace
// build, matching RunPod's ADA_24 pool; NOT the newer 89-1.9.x line, which bumped its CUDA
// floor to 12.9 and crash-loops on any RunPod ADA_24 host whose driver predates that,
// observed directly via stream-worker-logs on first deploy) deployed as separate RunPod
// Load Balancer
// Serverless endpoints, never one container serving both roles. This is deliberately NOT
// the custom retrieval-runtime/ Flash service that Wave 2 also built and tested -- that
// service remains in the repo (audited, passing) as a preserved alternative backend, but
// nothing currently deploys or calls it. The official TEI image needed no Dockerfile, no
// container registry credential, and no custom handler, so it shipped first; switching to
// retrieval-runtime/ later is a data change (point these URLs at it) once it is deployed,
// not a code change, per the adapter-first architecture (see embedder-adapter-runpod.ts).
//
// Revisions are pinned here AND passed as the TEI containers' own MODEL_ID/REVISION env
// vars at deploy time (create-endpoint) -- both must be updated together, or the profile's
// claimed identity and the running worker's actual identity silently diverge.
export const BGE_M3_REVISION = "142964af7e05de16511657561de8e8750fc153a0";
export const BGE_RERANKER_V2_M3_REVISION = "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e";
export const BGE_M3_REGISTRY_ID = "retrieval-bge-m3";
export const BGE_RERANKER_V2_M3_REGISTRY_ID = "retrieval-bge-reranker-v2-m3";

export type RetrievalRuntimeEnv = {
  embedderUrl: string;
  rerankerUrl: string;
  apiKey: string;
};

// Fail-closed, matching readProductCoreV2Env's pattern (core-runtime-v2.ts): a caller gets
// null and must refuse to proceed, never a partially-configured adapter that looks live
// but silently can't reach anything.
//
// Names follow this project's existing TAVONEL_-prefixed convention (TAVONEL_R2_*,
// TAVONEL_SESSION_SECRET, ...) rather than the bare RUNPOD_API_KEY this module used
// before anyone had actually looked at what was already configured in Vercel --
// TAVONEL_RUNPOD_API_KEY already existed there (Production-only; add Preview scope to
// exercise this from a branch deployment). The two URL vars are new since the TEI
// endpoints they point at were only just deployed.
export function readRetrievalRuntimeEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RetrievalRuntimeEnv | null {
  const embedderUrl = env.TAVONEL_RETRIEVAL_EMBEDDER_URL?.trim() ?? "";
  const rerankerUrl = env.TAVONEL_RETRIEVAL_RERANKER_URL?.trim() ?? "";
  const apiKey = env.TAVONEL_RUNPOD_API_KEY?.trim() ?? "";
  if (!looksLikeRunPodEmbeddingUrl(embedderUrl) || !looksLikeRunPodEmbeddingUrl(rerankerUrl)
    || apiKey.length === 0) return null;
  return { embedderUrl, rerankerUrl, apiKey };
}

export function buildProductionRetrievalProfile(workspaceKey: string): RetrievalProfile {
  return buildBgeM3BaselineProfile(workspaceKey, BGE_M3_REVISION, BGE_RERANKER_V2_M3_REVISION);
}

export function createProductionEmbedderAdapter(env: RetrievalRuntimeEnv, workspaceKey: string): EmbedderAdapter {
  const config: RunPodConnectionConfig = { url: env.embedderUrl, apiKey: env.apiKey };
  const adapter = createRunPodEmbedderAdapter(
    { provider: "huggingface", model: "BAAI/bge-m3", revision: BGE_M3_REVISION, dimension: 1024, normalize: true },
    config,
  );
  return governEmbedderAdapter(adapter, {
    tenantId: workspaceKey,
    provider: "runpod",
    model: "BAAI/bge-m3",
    maximumUnits: Math.ceil(RUNPOD_EMBEDDER_REQUEST_TIMEOUT_MS / 1_000) + 5,
    reservationSeconds: 60,
  });
}

export function createProductionRerankerAdapter(env: RetrievalRuntimeEnv, workspaceKey: string): RerankerAdapter {
  const config: RunPodConnectionConfig = { url: env.rerankerUrl, apiKey: env.apiKey };
  const adapter = createRunPodRerankerAdapter(
    { provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision: BGE_RERANKER_V2_M3_REVISION },
    config,
  );
  return governRerankerAdapter(adapter, {
    tenantId: workspaceKey,
    provider: "runpod",
    model: "BAAI/bge-reranker-v2-m3",
    maximumUnits: Math.ceil(RUNPOD_RERANKER_REQUEST_TIMEOUT_MS / 1_000) + 5,
    reservationSeconds: 60,
  });
}

export type RetrievalRuntimeFallback = {
  component: "dense" | "reranker";
  mode: "lexical_structure" | "rrf_fused_order";
  reason: RetrievalModelSelection["reason"] | "RUNTIME_NOT_CONFIGURED";
};

export type ProductionRetrievalRuntime = {
  profile: RetrievalProfile;
  embedder: EmbedderAdapter | null;
  reranker: RerankerAdapter | null;
  decision: {
    schemaVersion: "retrieval-model-route/v1";
    evaluatedAt: string;
    registrySource: "TAVONEL_RETRIEVAL_MODEL_REGISTRY_JSON";
    selections: RetrievalModelSelection[];
    fallbacks: RetrievalRuntimeFallback[];
    /** Internal adaptive lineage. It is persisted in receipts, never returned in public DTOs. */
    router?: AdaptiveRouterDecision;
  };
  /** Internal only. Public Ask/Search DTOs continue to expose the bounded route projection. */
  routerDecision: AdaptiveRouterDecision | null;
  /** Exact immutable control-plane row identifiers used by pre-dispatch attempt receipts. */
  controlPlaneLineage: AdaptiveRouterControlPlaneLineage | null;
};

export type AdaptiveRouterControlPlaneLineage = Readonly<{
  policyId: string;
  policyVersion: string;
  policyRevision: number;
  rolloutRevision: number;
  assignmentId: string;
  policyDigest: string;
  evidenceDigest: string;
  scopeDigest: string;
  assignmentDigest: string;
  thresholdsDigest: string;
  indexStateDigest: string;
  controlId: string;
}>;

export type AdaptiveRetrievalRuntimeCandidate = {
  candidate: AdaptiveRouteCandidate;
  /** Trusted deployment binding for the adapter endpoint; never supplied by a request. */
  endpointId: string;
  runtime: ProductionRetrievalRuntime;
};

export type AdaptiveRetrievalRuntimeInput = {
  requestId: string;
  control: AdaptiveRouterControl;
  policy: AdaptiveRouterPolicySnapshot;
  candidates: readonly AdaptiveRetrievalRuntimeCandidate[];
  controlPlaneLineage: AdaptiveRouterControlPlaneLineage;
};

export type ProductionRetrievalRuntimeResolution =
  | { ok: true; runtime: ProductionRetrievalRuntime }
  | { ok: false; code: Extract<AdaptiveRouterDecision, { kind: "refuse" }>["code"]
      | "ADAPTIVE_ROUTER_CONTROL_PLANE_FAILED" | "ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID" };

export const ADAPTIVE_RETRIEVAL_CONTROL_ENV = "TAVONEL_ADAPTIVE_RETRIEVAL_CONTROL_JSON";
/**
 * Declared shadow challengers, as a JSON array.
 *
 * A challenger is a *second deployment of the control's exact embedding space*: provider,
 * endpoint, region, retention, price, latency and circuit may differ, but model and revision are
 * inherited from the control and cannot be restated here. A different embedding family cannot be
 * a retrieval challenger while a single compiled index exists, because its vectors are not
 * comparable to the index the query is answered from; that needs a second compiled index in the
 * challenger's space, not a configuration entry.
 *
 * Shadow never dispatches a challenger (`shadowEvaluation.dispatchAllowed` is `false`), so these
 * entries carry the control's runtime. If a later rollout state ever selected one for execution,
 * `selectAdaptiveProductionRetrievalRuntime` refuses with CONTROL_INTEGRITY_MISMATCH because the
 * bound adapter's endpoint is not the chosen endpoint. Declaring a challenger cannot silently
 * route customer traffic to it.
 */
export const ADAPTIVE_RETRIEVAL_CHALLENGER_ENV = "TAVONEL_ADAPTIVE_RETRIEVAL_CHALLENGER_JSON";

type AdaptiveControlConfig = {
  capabilities: string[];
  region: string;
  retentionDays: number;
  price: { observedAt: string; estimatedCostUsdMicros: number };
  estimatedLatencyMs: number;
  circuit: "closed" | "open" | "unavailable";
  requirements: {
    allowedRegions: string[];
    maxRetentionDays: number;
    maxPriceAgeMs: number;
    budgetUsdMicros: number;
    deadlineMs: number;
  };
};

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function readAdaptiveControlConfig(env: Readonly<Record<string, string | undefined>>): AdaptiveControlConfig | null {
  const encoded = env[ADAPTIVE_RETRIEVAL_CONTROL_ENV]?.trim();
  if (!encoded) return null;
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const price = row.price as Record<string, unknown> | undefined;
  const requirements = row.requirements as Record<string, unknown> | undefined;
  if (row.schemaVersion !== "tavonel.adaptive_retrieval_control.v1"
    || !Array.isArray(row.capabilities) || row.capabilities.length === 0
    || !row.capabilities.every((item) => typeof item === "string")
    || typeof row.region !== "string" || row.region.length === 0
    || !nonNegativeInteger(row.retentionDays)
    || !price || typeof price.observedAt !== "string" || !Number.isFinite(Date.parse(price.observedAt))
    || !nonNegativeInteger(price.estimatedCostUsdMicros)
    || !nonNegativeInteger(row.estimatedLatencyMs)
    || !["closed", "open", "unavailable"].includes(String(row.circuit))
    || !requirements || !Array.isArray(requirements.allowedRegions)
    || requirements.allowedRegions.length === 0
    || !requirements.allowedRegions.every((item) => typeof item === "string")
    || !nonNegativeInteger(requirements.maxRetentionDays)
    || !nonNegativeInteger(requirements.maxPriceAgeMs)
    || !nonNegativeInteger(requirements.budgetUsdMicros)
    || !nonNegativeInteger(requirements.deadlineMs)) return null;
  return {
    capabilities: row.capabilities as string[], region: row.region,
    retentionDays: row.retentionDays, price: price as AdaptiveControlConfig["price"],
    estimatedLatencyMs: row.estimatedLatencyMs,
    circuit: row.circuit as AdaptiveControlConfig["circuit"],
    requirements: requirements as AdaptiveControlConfig["requirements"],
  };
}

type AdaptiveChallengerConfig = {
  provider: string;
  endpointId: string;
  region: string;
  retentionDays: number;
  price: { observedAt: string; estimatedCostUsdMicros: number };
  estimatedLatencyMs: number;
  circuit: "closed" | "open" | "unavailable";
  indexStatus: "ready" | "missing" | "stale" | "unavailable";
};

/** `[]` means none declared. `null` means declared but unreadable, and suspends adaptive routing. */
function readAdaptiveChallengerConfigs(
  env: Readonly<Record<string, string | undefined>>,
): AdaptiveChallengerConfig[] | null {
  const encoded = env[ADAPTIVE_RETRIEVAL_CHALLENGER_ENV]?.trim();
  if (!encoded) return [];
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { return null; }
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows: AdaptiveChallengerConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const price = row.price as Record<string, unknown> | undefined;
    if (row.schemaVersion !== "tavonel.adaptive_retrieval_challenger.v1"
      || typeof row.provider !== "string" || row.provider.length === 0
      || typeof row.endpointId !== "string" || row.endpointId.length === 0
      || typeof row.region !== "string" || row.region.length === 0
      || !nonNegativeInteger(row.retentionDays)
      || !price || typeof price.observedAt !== "string" || !Number.isFinite(Date.parse(price.observedAt))
      || !nonNegativeInteger(price.estimatedCostUsdMicros)
      || !nonNegativeInteger(row.estimatedLatencyMs)
      || !["closed", "open", "unavailable"].includes(String(row.circuit))
      || !["ready", "missing", "stale", "unavailable"].includes(String(row.indexStatus))) return null;
    rows.push({
      provider: row.provider, endpointId: row.endpointId, region: row.region,
      retentionDays: row.retentionDays, price: price as AdaptiveChallengerConfig["price"],
      estimatedLatencyMs: row.estimatedLatencyMs,
      circuit: row.circuit as AdaptiveChallengerConfig["circuit"],
      indexStatus: row.indexStatus as AdaptiveChallengerConfig["indexStatus"],
    });
  }
  return rows;
}

export type AdaptiveRouterCandidateSet = {
  control: AdaptiveRouterControl;
  candidates: readonly AdaptiveRetrievalRuntimeCandidate[];
};

/**
 * The single construction of the router's control and candidate set. The request path and the
 * control-plane seeding script both call this, so a seeded policy's candidate-set, index-state
 * and thresholds digests are the ones the runtime will recompute, or the policy is rejected.
 */
export function buildAdaptiveRouterCandidateSet(input: {
  fixed: ProductionRetrievalRuntime;
  profileIdentity: RetrievalProfileIdentity;
  embedderIdentity: { provider: string; model: string; revision: string };
  endpointId: string;
  env?: Readonly<Record<string, string | undefined>>;
}): AdaptiveRouterCandidateSet | null {
  const env = input.env ?? process.env;
  const config = readAdaptiveControlConfig(env);
  const challengers = readAdaptiveChallengerConfigs(env);
  if (!config || !challengers) return null;
  const index = { status: "ready" as const, retrievalProfile: input.profileIdentity };
  const candidate: AdaptiveRouteCandidate = {
    identity: { provider: input.embedderIdentity.provider, model: input.embedderIdentity.model,
      revision: input.embedderIdentity.revision, endpointId: input.endpointId },
    capabilities: config.capabilities,
    region: config.region,
    retentionDays: config.retentionDays,
    price: config.price,
    estimatedLatencyMs: config.estimatedLatencyMs,
    circuit: config.circuit,
    index,
  };
  const control: AdaptiveRouterControl = {
    candidate: candidate.identity,
    requirements: {
      capabilities: config.capabilities,
      allowedRegions: config.requirements.allowedRegions,
      maxRetentionDays: config.requirements.maxRetentionDays,
      maxPriceAgeMs: config.requirements.maxPriceAgeMs,
      budgetUsdMicros: config.requirements.budgetUsdMicros,
      deadlineMs: config.requirements.deadlineMs,
      retrievalProfile: input.profileIdentity,
    },
  };
  const candidates: AdaptiveRetrievalRuntimeCandidate[] = [
    { candidate, endpointId: input.endpointId, runtime: input.fixed },
  ];
  for (const challenger of challengers) {
    // Model and revision are the control's: a challenger declares a second endpoint for the
    // same embedding space, never a second model. Its runtime is the control's, so execution
    // of a challenger fails the endpoint-identity check rather than answering from it.
    if (challenger.endpointId === input.endpointId) return null;
    candidates.push({
      candidate: {
        identity: { provider: challenger.provider, model: input.embedderIdentity.model,
          revision: input.embedderIdentity.revision, endpointId: challenger.endpointId },
        capabilities: config.capabilities,
        region: challenger.region,
        retentionDays: challenger.retentionDays,
        price: challenger.price,
        estimatedLatencyMs: challenger.estimatedLatencyMs,
        circuit: challenger.circuit,
        index: { status: challenger.indexStatus, retrievalProfile: input.profileIdentity },
      },
      endpointId: challenger.endpointId,
      runtime: input.fixed,
    });
  }
  return { control, candidates };
}

export function retrievalRoutingRequestId(collectionId: string, query: string): string {
  const normalized = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${collectionId}\n${normalized}`, "utf8").digest("hex");
}

/** The sole production route selector: adapters are constructed only after registry admission. */
export function selectProductionRetrievalRuntime(
  workspaceKey: string,
  options: { env?: RetrievalRuntimeEnv | null; registry?: unknown; now?: Date } = {},
): ProductionRetrievalRuntime {
  const now = options.now ?? new Date();
  const env = options.env === undefined ? readRetrievalRuntimeEnv() : options.env;
  const registry = options.registry === undefined ? readRetrievalModelRegistry() : options.registry;
  const profile = buildProductionRetrievalProfile(workspaceKey);
  const requests = [
    {
      registryId: BGE_M3_REGISTRY_ID,
      role: "embedder" as const,
      provider: profile.embedding.provider,
      model: profile.embedding.model,
      revision: profile.embedding.revision,
    },
    {
      registryId: BGE_RERANKER_V2_M3_REGISTRY_ID,
      role: "reranker" as const,
      provider: profile.reranker!.provider,
      model: profile.reranker!.model,
      revision: profile.reranker!.revision,
    },
  ];
  const selections = requests.map((request) => selectRegisteredRetrievalModel(registry, request, now));
  const [embedding, reranker] = selections;
  const fallbacks: RetrievalRuntimeFallback[] = [];
  if (!env || !embedding.selected) {
    fallbacks.push({
      component: "dense",
      mode: "lexical_structure",
      reason: env ? embedding.reason : "RUNTIME_NOT_CONFIGURED",
    });
  }
  if (!env || !reranker.selected) {
    fallbacks.push({
      component: "reranker",
      mode: "rrf_fused_order",
      reason: env ? reranker.reason : "RUNTIME_NOT_CONFIGURED",
    });
  }
  return {
    profile,
    embedder: env && embedding.selected ? createProductionEmbedderAdapter(env, workspaceKey) : null,
    reranker: env && reranker.selected ? createProductionRerankerAdapter(env, workspaceKey) : null,
    decision: {
      schemaVersion: "retrieval-model-route/v1",
      evaluatedAt: now.toISOString(),
      registrySource: "TAVONEL_RETRIEVAL_MODEL_REGISTRY_JSON",
      selections,
      fallbacks,
    },
    routerDecision: null,
    controlPlaneLineage: null,
  };
}

/**
 * Bind a pure adaptive-router decision to executable retrieval adapters.
 *
 * The decision and runtime are joined by both exact candidate identity and the content-addressed
 * retrieval profile. A display/profile name alone is never sufficient: selecting an adapter from
 * another embedding space would make pgvector scores meaningless. Shadow decisions are retained
 * on the runtime for receipts, while the router's `execution` candidate remains the fixed control.
 */
export function selectAdaptiveProductionRetrievalRuntime(
  workspaceKey: string,
  input: AdaptiveRetrievalRuntimeInput,
  now = new Date(),
): ProductionRetrievalRuntimeResolution {
  const decision = selectAdaptiveRoute({
    tenantId: workspaceKey,
    requestId: input.requestId,
    now,
    control: input.control,
    policy: input.policy,
    candidates: input.candidates.map(({ candidate }) => candidate),
  });
  if (decision.kind === "refuse") return { ok: false, code: decision.code };

  const executionKey = candidateIdentityKey(decision.execution.identity);
  const selected = input.candidates.find(({ candidate }) =>
    candidateIdentityKey(candidate.identity) === executionKey
  );
  if (!selected) return { ok: false, code: "CONTROL_CANDIDATE_NOT_FOUND" };

  const embedderIdentity = selected.runtime.embedder?.identity();
  const adapterEndpointId = selected.runtime.embedder?.endpointId?.();
  const rerankerIdentity = selected.runtime.reranker?.identity();
  const expectedReranker = selected.runtime.profile.reranker;
  if (
    selected.endpointId !== decision.execution.identity.endpointId ||
    adapterEndpointId !== decision.execution.identity.endpointId ||
    !embedderIdentity ||
    embedderIdentity.provider !== decision.execution.identity.provider ||
    embedderIdentity.model !== decision.execution.identity.model ||
    embedderIdentity.revision !== decision.execution.identity.revision ||
    embedderIdentity.dimension !== selected.runtime.profile.embedding.dimension ||
    embedderIdentity.normalize !== selected.runtime.profile.embedding.normalize ||
    (expectedReranker === null) !== (rerankerIdentity === undefined) ||
    (expectedReranker !== null && (
      !rerankerIdentity ||
      rerankerIdentity.provider !== expectedReranker.provider ||
      rerankerIdentity.model !== expectedReranker.model ||
      rerankerIdentity.revision !== expectedReranker.revision
    ))
  ) {
    return { ok: false, code: "CONTROL_INTEGRITY_MISMATCH" };
  }

  let runtimeProfile;
  try {
    runtimeProfile = contentAddressedRetrievalProfileIdentity(selected.runtime.profile);
  } catch {
    return { ok: false, code: "CONTROL_INTEGRITY_MISMATCH" };
  }
  if (!sameRetrievalProfileIdentity(runtimeProfile, decision.execution.index.retrievalProfile)) {
    return { ok: false, code: "CONTROL_INTEGRITY_MISMATCH" };
  }
  return {
    ok: true,
    runtime: {
      ...selected.runtime,
      decision: { ...selected.runtime.decision, router: decision },
      routerDecision: decision,
      controlPlaneLineage: input.controlPlaneLineage,
    },
  };
}

/** Request-facing seam. With no authenticated adaptive plan, fixed control remains exact. */
export function resolveProductionRetrievalRuntime(
  workspaceKey: string,
  options: {
    requestId: string;
    adaptive?: Omit<AdaptiveRetrievalRuntimeInput, "requestId">;
    env?: RetrievalRuntimeEnv | null;
    registry?: unknown;
    now?: Date;
  },
): ProductionRetrievalRuntimeResolution {
  if (!options.adaptive) {
    return {
      ok: true,
      runtime: selectProductionRetrievalRuntime(workspaceKey, options),
    };
  }
  return selectAdaptiveProductionRetrievalRuntime(workspaceKey, {
    requestId: options.requestId,
    ...options.adaptive,
  }, options.now);
}

/**
 * Resolve an authenticated per-request plan. Adaptive routing remains off unless deployment
 * supplies complete control metadata and the service-role control plane returns a digest-bound
 * current policy. A missing index skips adaptive admission and leaves legacy control behavior.
 */
export async function resolveConfiguredProductionRetrievalRuntime(input: {
  workspaceKey: string;
  collectionId: string;
  endpoint: "ask" | "search";
  query: string;
  indexStatus: "missing" | "compiled" | "failed";
  env?: Readonly<Record<string, string | undefined>>;
  registry?: unknown;
  now?: Date;
}): Promise<ProductionRetrievalRuntimeResolution> {
  const envSource = input.env ?? process.env;
  const now = input.now ?? new Date();
  const runtimeEnv = readRetrievalRuntimeEnv(envSource);
  const fixed = selectProductionRetrievalRuntime(input.workspaceKey, {
    env: runtimeEnv,
    registry: input.registry,
    now,
  });
  const requestId = retrievalRoutingRequestId(input.collectionId, input.query);
  const embedderIdentity = fixed.embedder?.identity();
  const endpointId = fixed.embedder?.endpointId?.();
  if (input.indexStatus !== "compiled" || !embedderIdentity || !endpointId) {
    return { ok: true, runtime: fixed };
  }

  let profileIdentity;
  try { profileIdentity = contentAddressedRetrievalProfileIdentity(fixed.profile); }
  catch { return { ok: false, code: "CONTROL_INTEGRITY_MISMATCH" }; }
  const candidateSet = buildAdaptiveRouterCandidateSet({
    fixed, profileIdentity, embedderIdentity, endpointId, env: envSource,
  });
  if (!candidateSet) return { ok: true, runtime: fixed };
  const { control, candidates } = candidateSet;
  const loaded = await loadAdaptiveRouterPlan({
    scope: { workspaceKey: input.workspaceKey, collectionId: input.collectionId,
      endpoint: input.endpoint, retrievalProfileDigest: profileIdentity.digest },
    requestId, control, candidates, now,
  }, envSource);
  if (!loaded.ok) return loaded;
  if (!loaded.adaptive) return { ok: true, runtime: fixed };
  return resolveProductionRetrievalRuntime(input.workspaceKey, {
    requestId, adaptive: loaded.adaptive, env: runtimeEnv, registry: input.registry, now,
  });
}
