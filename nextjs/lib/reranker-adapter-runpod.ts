import type { RerankerAdapter, RerankerCandidate, RerankerInvokeOptions, RerankerModelIdentity, RerankerResult } from "./reranker-adapter";
import { looksLikeRunPodEmbeddingUrl, type RunPodConnectionConfig } from "./embedder-adapter-runpod";

// RunPod backend for RerankerAdapter, calling an official Hugging Face Text Embeddings
// Inference (TEI) container (see embedder-adapter-runpod.ts for why TEI over a custom
// image). TEI's POST /rerank takes {"query", "texts"} and returns a bare array of
// {"index", "score"} pairs referencing position in the `texts` array it was given -- TEI
// has no concept of a caller-supplied candidate id, so `index` is mapped back to
// `candidates[index].id` here. Confirmed against TEI's published OpenAPI schema.
export const RUNPOD_RERANKER_REQUEST_TIMEOUT_MS = 30_000;

type RerankRank = { index: number; score: number };

// Validates the response is well-formed (every index in range, no duplicates, finite
// scores) before trusting it enough to map back to candidate ids -- a candidate missing
// from the response is not an error here, it is rerankWithFallback's job (reranker-
// adapter.ts) to notice a partial response and degrade to the RRF-fused order.
function qualifyRerankResponse(payload: unknown, candidateCount: number): RerankRank[] | null {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > candidateCount) return null;
  const seen = new Set<number>();
  for (const entry of payload) {
    if (
      !entry || typeof entry !== "object" ||
      typeof (entry as Record<string, unknown>).index !== "number" ||
      !Number.isInteger((entry as { index: number }).index) ||
      (entry as { index: number }).index < 0 ||
      (entry as { index: number }).index >= candidateCount ||
      seen.has((entry as { index: number }).index) ||
      typeof (entry as Record<string, unknown>).score !== "number" ||
      !Number.isFinite((entry as { score: number }).score)
    ) return null;
    seen.add((entry as { index: number }).index);
  }
  return payload as RerankRank[];
}

async function sha256Hex(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createRunPodRerankerAdapter(
  identity: RerankerModelIdentity,
  config: RunPodConnectionConfig,
  fetcher: typeof fetch = fetch,
): RerankerAdapter {
  return {
    identity: () => identity,
    rerank: (query, candidates, options) => callRerankRoute(config, identity, query, candidates, options, fetcher),
  };
}

async function callRerankRoute(
  config: RunPodConnectionConfig,
  identity: RerankerModelIdentity,
  query: string,
  candidates: RerankerCandidate[],
  options: RerankerInvokeOptions | undefined,
  fetcher: typeof fetch,
): Promise<RerankerResult> {
  const startedAt = Date.now();
  const receiptBase = {
    provider: identity.provider,
    model: identity.model,
    revision: identity.revision,
    runtimeImage: identity.runtimeImage,
    candidateCount: candidates.length,
  };
  const inputDigest = `sha256:${await sha256Hex(JSON.stringify({ query, candidates }))}`;

  if (!looksLikeRunPodEmbeddingUrl(config.url)) {
    return {
      status: "error",
      reason: "RunPod rerank URL failed the allowlist check",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: 0, timedOut: false },
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  const apiKey = (config.apiKey || "").trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetcher(`${config.url.replace(/\/$/, "")}/rerank`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        texts: candidates.map((candidate) => candidate.text),
        // Deliberately never truncates via a topK-shaped request field: rerankWithFallback
        // (reranker-adapter.ts) treats any candidate id missing from the response as an
        // incomplete/failed rerank and degrades to the RRF-fused order -- the adapter must
        // always score every candidate it was given; rerankWithFallback applies topK itself.
        raw_scores: false,
      }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? config.timeoutMs ?? RUNPOD_RERANKER_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      status: "error",
      reason: timedOut ? "RunPod rerank request timed out" : "RunPod rerank request failed (network)",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut },
    };
  }
  if (!response.ok) {
    return {
      status: "error",
      reason: `RunPod rerank endpoint returned HTTP ${response.status}`,
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut: false },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      status: "error",
      reason: "RunPod rerank response is not JSON",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut: false },
    };
  }
  const qualified = qualifyRerankResponse(payload, candidates.length);
  if (!qualified) {
    return {
      status: "error",
      reason: "RunPod rerank response failed schema validation",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut: false },
    };
  }

  const ranked = qualified.map((rank) => ({ id: candidates[rank.index].id, score: rank.score }));
  const outputDigest = `sha256:${await sha256Hex(JSON.stringify(ranked))}`;
  return {
    status: "ok",
    ranked,
    receipt: { ...receiptBase, inputDigest, outputDigest, durationMs: Date.now() - startedAt, timedOut: false },
  };
}
