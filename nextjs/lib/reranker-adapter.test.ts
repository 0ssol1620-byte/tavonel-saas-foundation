import { describe, expect, it } from "vitest";
import { rerankWithFallback, type FusedCandidate, type RerankerAdapter, type RerankerReceipt } from "./reranker-adapter";

function receipt(overrides: Partial<RerankerReceipt> = {}): RerankerReceipt {
  return {
    provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision: "rev-1",
    candidateCount: 2, inputDigest: "sha256:x", outputDigest: "sha256:y", durationMs: 5, timedOut: false,
    ...overrides,
  };
}

const fused: FusedCandidate[] = [
  { id: "a", text: "Payment terms are net 30 days.", fusedRank: 2 },
  { id: "b", text: "The Board approved the policy.", fusedRank: 1 },
];

describe("rerankWithFallback", () => {
  it("reorders by reranker score and marks rerankerApplied true on success", async () => {
    const adapter: RerankerAdapter = {
      identity: () => ({ provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision: "rev-1" }),
      rerank: async () => ({ status: "ok", ranked: [{ id: "a", score: 0.9 }, { id: "b", score: 0.4 }], receipt: receipt() }),
    };
    const outcome = await rerankWithFallback(adapter, "payment terms", fused);
    expect(outcome.rerankerApplied).toBe(true);
    expect(outcome.reason).toBeNull();
    expect(outcome.ranked.map((c) => c.id)).toEqual(["a", "b"]);
    expect(outcome.ranked[0].rerankerScore).toBe(0.9);
  });

  it("respects topK after reordering", async () => {
    const adapter: RerankerAdapter = {
      identity: () => ({ provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision: "rev-1" }),
      rerank: async () => ({ status: "ok", ranked: [{ id: "a", score: 0.2 }, { id: "b", score: 0.9 }], receipt: receipt() }),
    };
    const outcome = await rerankWithFallback(adapter, "q", fused, { topK: 1 });
    expect(outcome.ranked).toHaveLength(1);
    expect(outcome.ranked[0].id).toBe("b");
  });

  it("degrades to the RRF-fused order on provider failure, and says so rather than failing the request", async () => {
    const adapter: RerankerAdapter = {
      identity: () => ({ provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision: "rev-1" }),
      rerank: async () => ({ status: "error", reason: "RunPod endpoint unavailable", receipt: receipt({ timedOut: true }) }),
    };
    const outcome = await rerankWithFallback(adapter, "q", fused);
    expect(outcome.rerankerApplied).toBe(false);
    expect(outcome.reason).toBe("RunPod endpoint unavailable");
    // Fused order, not reranked: fusedRank 1 (b) before fusedRank 2 (a).
    expect(outcome.ranked.map((c) => c.id)).toEqual(["b", "a"]);
    expect(outcome.ranked.every((c) => c.rerankerScore === null)).toBe(true);
  });

  it("degrades to the fused order rather than trusting a response that silently dropped candidates", async () => {
    const adapter: RerankerAdapter = {
      identity: () => ({ provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision: "rev-1" }),
      rerank: async () => ({ status: "ok", ranked: [{ id: "a", score: 0.9 }], receipt: receipt() }),
    };
    const outcome = await rerankWithFallback(adapter, "q", fused);
    expect(outcome.rerankerApplied).toBe(false);
    expect(outcome.reason).toMatch(/omitted/);
  });

  it("handles an empty candidate list without calling the adapter", async () => {
    let called = false;
    const adapter: RerankerAdapter = {
      identity: () => ({ provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision: "rev-1" }),
      rerank: async () => { called = true; return { status: "ok", ranked: [], receipt: receipt() }; },
    };
    const outcome = await rerankWithFallback(adapter, "q", []);
    expect(outcome.ranked).toEqual([]);
    expect(called).toBe(false);
  });
});
