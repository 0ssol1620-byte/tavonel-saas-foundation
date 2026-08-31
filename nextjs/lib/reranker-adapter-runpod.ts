import type { RerankerAdapter, RerankerCandidate, RerankerInvokeOptions, RerankerModelIdentity, RerankerResult } from "./reranker-adapter";
import { looksLikeRunPodEmbeddingUrl, type RunPodConnectionConfig } from "./embedder-adapter-runpod";

// RunPod backend for RerankerAdapter, mirroring embedder-adapter-runpod.ts: Bearer auth,
// AbortSignal timeouts, a URL allowlist, and strict response validation. A malformed or
// unexpected response here becomes a provider_error that rerankWithFallback
// (reranker-adapter.ts) degrades to the RRF-fused order for -- never a trusted rerank.
export const RUNPOD_RERANKER_REQUEST_TIMEOUT_MS = 30_000;
const RERANK_RESULT_SCHEMA = "tavonel.rerank_result.v1";

type RerankResultPayload = {
  schemaVersion: typeof RERANK_RESULT_SCHEMA;
  status: "ok";
  ranked: Array<{ id: string; score: number }>;
};

function qualifyRerankResult(payload: unknown, expectedIds: Set<string>): RerankResultPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const result = payload as Partial<RerankResultPayload>;
  if (
    result.schemaVersion !== RERANK_RESULT_SCHEMA ||
    result.status !== "ok" ||
    !Array.isArray(result.ranked) ||
    result.ranked.length < 1 ||
    result.ranked.length > 10_000
  ) return null;
  const seen = new Set<string>();
  for (const entry of result.ranked) {
    if (
      !entry || typeof entry !== "object" ||
      typeof (entry as Record<string, unknown>).id !== "string" ||
      !expectedIds.has((entry as { id: string }).id) ||
      seen.has((entry as { id: string }).id) ||
      typeof (entry as Record<string, unknown>).score !== "number" ||
      !Number.isFinite((entry as { score: number }).score)
    ) return null;
    seen.add((entry as { id: string }).id);
  }
  return result as RerankResultPayload;
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
      body: JSON.stringify({ data: { query, candidates, topK: options?.topK } }),
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
  const expectedIds = new Set(candidates.map((candidate) => candidate.id));
  const qualified = qualifyRerankResult(payload, expectedIds);
  if (!qualified) {
    return {
      status: "error",
      reason: "RunPod rerank response failed schema validation",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut: false },
    };
  }

  const outputDigest = `sha256:${await sha256Hex(JSON.stringify(qualified.ranked))}`;
  return {
    status: "ok",
    ranked: qualified.ranked,
    receipt: { ...receiptBase, inputDigest, outputDigest, durationMs: Date.now() - startedAt, timedOut: false },
  };
}
