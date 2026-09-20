import {
  createRunPodEmbedderAdapter,
  RUNPOD_EMBEDDER_REQUEST_TIMEOUT_MS,
  type RunPodConnectionConfig,
} from "./embedder-adapter-runpod";
import type { EmbedderAdapter } from "./embedder-adapter";
import {
  createRunPodRerankerAdapter,
  RUNPOD_RERANKER_REQUEST_TIMEOUT_MS,
} from "./reranker-adapter-runpod";
import type { RerankerAdapter } from "./reranker-adapter";
import { createGovernedModelProviderFetcher } from "./model-provider-dispatch";
import { buildBgeM3BaselineProfile, type RetrievalProfile } from "./retrieval-profile";
import {
  readRetrievalModelRegistry,
  selectRegisteredRetrievalModel,
  type RetrievalModelSelection,
} from "./retrieval-model-registry";

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
export const BGE_M3_REVISION = "5617a9f61b028005a4858fdac845db406aefb181";
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
export function readRetrievalRuntimeEnv(): RetrievalRuntimeEnv | null {
  const embedderUrl = process.env.TAVONEL_RETRIEVAL_EMBEDDER_URL?.trim() ?? "";
  const rerankerUrl = process.env.TAVONEL_RETRIEVAL_RERANKER_URL?.trim() ?? "";
  const apiKey = process.env.TAVONEL_RUNPOD_API_KEY?.trim() ?? "";
  if (!/^https?:\/\//.test(embedderUrl) || !/^https?:\/\//.test(rerankerUrl) || apiKey.length === 0) return null;
  return { embedderUrl, rerankerUrl, apiKey };
}

export function buildProductionRetrievalProfile(workspaceKey: string): RetrievalProfile {
  return buildBgeM3BaselineProfile(workspaceKey, BGE_M3_REVISION, BGE_RERANKER_V2_M3_REVISION);
}

export function createProductionEmbedderAdapter(env: RetrievalRuntimeEnv, workspaceKey: string): EmbedderAdapter {
  const config: RunPodConnectionConfig = { url: env.embedderUrl, apiKey: env.apiKey };
  const fetcher = createGovernedModelProviderFetcher({
    tenantId: workspaceKey,
    provider: "runpod",
    model: "BAAI/bge-m3",
    maximumUnits: Math.ceil(RUNPOD_EMBEDDER_REQUEST_TIMEOUT_MS / 1_000) + 5,
    reservationSeconds: 60,
  });
  return createRunPodEmbedderAdapter(
    { provider: "huggingface", model: "BAAI/bge-m3", revision: BGE_M3_REVISION, dimension: 1024, normalize: true },
    config,
    fetcher,
  );
}

export function createProductionRerankerAdapter(env: RetrievalRuntimeEnv, workspaceKey: string): RerankerAdapter {
  const config: RunPodConnectionConfig = { url: env.rerankerUrl, apiKey: env.apiKey };
  const fetcher = createGovernedModelProviderFetcher({
    tenantId: workspaceKey,
    provider: "runpod",
    model: "BAAI/bge-reranker-v2-m3",
    maximumUnits: Math.ceil(RUNPOD_RERANKER_REQUEST_TIMEOUT_MS / 1_000) + 5,
    reservationSeconds: 60,
  });
  return createRunPodRerankerAdapter(
    { provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision: BGE_RERANKER_V2_M3_REVISION },
    config,
    fetcher,
  );
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
  };
};

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
  };
}
