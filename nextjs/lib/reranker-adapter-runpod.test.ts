import { describe, expect, it, vi } from "vitest";
import { createRunPodRerankerAdapter } from "./reranker-adapter-runpod";
import type { RerankerCandidate, RerankerModelIdentity } from "./reranker-adapter";
import type { RunPodConnectionConfig } from "./embedder-adapter-runpod";

const identity: RerankerModelIdentity = {
  provider: "huggingface",
  model: "BAAI/bge-reranker-v2-m3",
  revision: "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e",
};

const config: RunPodConnectionConfig = { url: "https://api.runpod.ai/v2/fake-endpoint", apiKey: "test-key" };
const candidates: RerankerCandidate[] = [
  { id: "a", text: "Payment terms are net 30 days." },
  { id: "b", text: "The Board approved the policy." },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createRunPodRerankerAdapter", () => {
  it("returns ranked candidates and a receipt on success", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      return jsonResponse({
        schemaVersion: "tavonel.rerank_result.v1",
        status: "ok",
        ranked: [{ id: "a", score: 0.9 }, { id: "b", score: 0.4 }],
      });
    });
    const adapter = createRunPodRerankerAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.rerank("payment terms", candidates);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.ranked).toEqual([{ id: "a", score: 0.9 }, { id: "b", score: 0.4 }]);
      expect(result.receipt.outputDigest).not.toBeNull();
    }
    const [url] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.runpod.ai/v2/fake-endpoint/rerank");
  });

  it("fails closed on a URL that does not pass the allowlist, without ever calling fetch", async () => {
    const fetcher = vi.fn();
    const adapter = createRunPodRerankerAdapter(identity, { url: "https://evil.example.com" }, fetcher as unknown as typeof fetch);
    const result = await adapter.rerank("q", candidates);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.reason).toMatch(/allowlist/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports a non-ok HTTP status as a provider error", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 503 }));
    const adapter = createRunPodRerankerAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.rerank("q", candidates);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.reason).toContain("HTTP 503");
  });

  it("rejects a response containing an id that was never in the candidate set", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        schemaVersion: "tavonel.rerank_result.v1",
        status: "ok",
        ranked: [{ id: "a", score: 0.9 }, { id: "invented-by-worker", score: 0.4 }],
      }),
    );
    const adapter = createRunPodRerankerAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.rerank("q", candidates);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.reason).toMatch(/schema validation/);
  });

  it("rejects a response with a duplicate id", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        schemaVersion: "tavonel.rerank_result.v1",
        status: "ok",
        ranked: [{ id: "a", score: 0.9 }, { id: "a", score: 0.4 }],
      }),
    );
    const adapter = createRunPodRerankerAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.rerank("q", candidates);
    expect(result.status).toBe("error");
  });

  it("accepts a response that omits some candidates as status ok -- rerankWithFallback decides what to do with an incomplete set", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ schemaVersion: "tavonel.rerank_result.v1", status: "ok", ranked: [{ id: "a", score: 0.9 }] }),
    );
    const adapter = createRunPodRerankerAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.rerank("q", candidates);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.ranked).toEqual([{ id: "a", score: 0.9 }]);
  });

  it("rejects the wrong schemaVersion", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ schemaVersion: "tavonel.rerank_result.v0", status: "ok", ranked: [{ id: "a", score: 0.9 }] }),
    );
    const adapter = createRunPodRerankerAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.rerank("q", candidates);
    expect(result.status).toBe("error");
  });

  it("surfaces a network failure as a provider error rather than throwing", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const adapter = createRunPodRerankerAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.rerank("q", candidates);
    expect(result.status).toBe("error");
    expect(result.receipt.timedOut).toBe(false);
  });
});
