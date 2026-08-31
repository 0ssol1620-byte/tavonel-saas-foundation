// RerankerAdapter is the replaceable seam for the cross-encoder rerank stage. It must not
// be assumed to be the same model as the embedder (see Wave 1 RetrievalProfile.reranker,
// which is pinned independently), and its score is a relevance signal, not a truth
// confidence — the World Gate, not this score, decides what enters a ContextPacket.
export type RerankerModelIdentity = {
  provider: string;
  model: string;
  revision: string;
  runtimeImage?: string;
};

export type RerankerCandidate = {
  id: string;
  text: string;
};

export type RerankedCandidate = {
  id: string;
  score: number;
};

export type RerankerReceipt = {
  provider: string;
  model: string;
  revision: string;
  runtimeImage?: string;
  candidateCount: number;
  inputDigest: string;
  outputDigest: string | null;
  durationMs: number;
  timedOut: boolean;
};

export type RerankerResult =
  | { status: "ok"; ranked: RerankedCandidate[]; receipt: RerankerReceipt }
  | { status: "error"; reason: string; receipt: RerankerReceipt };

export type RerankerInvokeOptions = {
  topK?: number;
  timeoutMs?: number;
};

export type RerankerAdapter = {
  identity(): RerankerModelIdentity;
  rerank(query: string, candidates: RerankerCandidate[], options?: RerankerInvokeOptions): Promise<RerankerResult>;
};

export type FusedCandidate = { id: string; text: string; fusedRank: number };

// A reranker failure must degrade the retrieval, never the tenant's ability to get an
// answer at all: fall back to the RRF-fused order (still a real, defensible ranking) and
// say so, rather than either failing the whole request or silently pretending the
// reranker ran. Distinguish this from a security/integrity failure (profile mismatch,
// ACL violation) — those must fail closed; provider unavailability degrades instead.
export type RerankOutcome = {
  ranked: Array<{ id: string; text: string; rerankerScore: number | null }>;
  rerankerApplied: boolean;
  reason: string | null;
  receipt: RerankerReceipt | null;
};

export async function rerankWithFallback(
  adapter: RerankerAdapter,
  query: string,
  fused: FusedCandidate[],
  options?: RerankerInvokeOptions,
): Promise<RerankOutcome> {
  if (fused.length === 0) {
    return { ranked: [], rerankerApplied: false, reason: "no candidates to rerank", receipt: null };
  }
  const sortedFused = [...fused].sort((left, right) => left.fusedRank - right.fusedRank);
  const result = await adapter.rerank(
    query,
    sortedFused.map((candidate) => ({ id: candidate.id, text: candidate.text })),
    options,
  );
  if (result.status === "error") {
    return {
      ranked: sortedFused.map((candidate) => ({ id: candidate.id, text: candidate.text, rerankerScore: null })),
      rerankerApplied: false,
      reason: result.reason,
      receipt: result.receipt,
    };
  }
  const textById = new Map(sortedFused.map((candidate) => [candidate.id, candidate.text]));
  const scoreById = new Map(result.ranked.map((candidate) => [candidate.id, candidate.score]));
  const missing = sortedFused.filter((candidate) => !scoreById.has(candidate.id));
  if (missing.length > 0) {
    return {
      ranked: sortedFused.map((candidate) => ({ id: candidate.id, text: candidate.text, rerankerScore: null })),
      rerankerApplied: false,
      reason: `reranker response omitted ${missing.length} of ${sortedFused.length} candidates`,
      receipt: result.receipt,
    };
  }
  const topK = options?.topK ?? result.ranked.length;
  const ranked = [...result.ranked]
    .sort((left, right) => right.score - left.score)
    .slice(0, topK)
    .map((candidate) => ({
      id: candidate.id,
      text: textById.get(candidate.id) ?? "",
      rerankerScore: candidate.score,
    }));
  return { ranked, rerankerApplied: true, reason: null, receipt: result.receipt };
}
