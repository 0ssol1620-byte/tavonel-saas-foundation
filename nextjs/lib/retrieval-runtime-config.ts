import { createRunPodEmbedderAdapter, type RunPodConnectionConfig } from "./embedder-adapter-runpod";
import type { EmbedderAdapter } from "./embedder-adapter";
import { createRunPodRerankerAdapter } from "./reranker-adapter-runpod";
import type { RerankerAdapter } from "./reranker-adapter";
import { buildBgeM3BaselineProfile, type RetrievalProfile } from "./retrieval-profile";

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

export function createProductionEmbedderAdapter(env: RetrievalRuntimeEnv): EmbedderAdapter {
  const config: RunPodConnectionConfig = { url: env.embedderUrl, apiKey: env.apiKey };
  return createRunPodEmbedderAdapter(
    { provider: "huggingface", model: "BAAI/bge-m3", revision: BGE_M3_REVISION, dimension: 1024, normalize: true },
    config,
  );
}

export function createProductionRerankerAdapter(env: RetrievalRuntimeEnv): RerankerAdapter {
  const config: RunPodConnectionConfig = { url: env.rerankerUrl, apiKey: env.apiKey };
  return createRunPodRerankerAdapter(
    { provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision: BGE_RERANKER_V2_M3_REVISION },
    config,
  );
}
