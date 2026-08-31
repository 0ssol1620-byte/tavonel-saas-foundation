import { describe, expect, it, vi } from "vitest";
import { createRunPodEmbedderAdapter, looksLikeRunPodEmbeddingUrl, type RunPodConnectionConfig } from "./embedder-adapter-runpod";
import type { EmbedderModelIdentity } from "./embedder-adapter";

const identity: EmbedderModelIdentity = {
  provider: "huggingface",
  model: "BAAI/bge-m3",
  revision: "5617a9f61b028005a4858fdac845db406aefb181",
  dimension: 3,
  normalize: true,
};

const config: RunPodConnectionConfig = { url: "https://api.runpod.ai/v2/fake-endpoint", apiKey: "test-key" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function validPayload(vectorCount: number) {
  return {
    schemaVersion: "tavonel.embedding_result.v1",
    status: "ok",
    dimension: 3,
    vectors: Array.from({ length: vectorCount }, () => [0.1, 0.2, 0.3]),
  };
}

describe("looksLikeRunPodEmbeddingUrl", () => {
  it("accepts an https api.runpod.ai URL", () => {
    expect(looksLikeRunPodEmbeddingUrl("https://api.runpod.ai/v2/abc")).toBe(true);
  });

  it("accepts a load-balanced *.api.runpod.ai subdomain", () => {
    expect(looksLikeRunPodEmbeddingUrl("https://abc123.api.runpod.ai")).toBe(true);
  });

  it("accepts localhost for local flash dev iteration", () => {
    expect(looksLikeRunPodEmbeddingUrl("http://localhost:8888/main")).toBe(true);
  });

  it("rejects a non-RunPod host even over https", () => {
    expect(looksLikeRunPodEmbeddingUrl("https://evil.example.com/v2/abc")).toBe(false);
  });

  it("rejects plain http to a real host (not localhost)", () => {
    expect(looksLikeRunPodEmbeddingUrl("http://api.runpod.ai/v2/abc")).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(looksLikeRunPodEmbeddingUrl("not a url")).toBe(false);
  });
});

describe("createRunPodEmbedderAdapter", () => {
  it("returns vectors and a populated receipt on success, sending a Bearer header", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      return jsonResponse(validPayload(2));
    });
    const adapter = createRunPodEmbedderAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.embedDocuments(["a", "b"]);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.vectors).toHaveLength(2);
      expect(result.receipt.outputDigest).not.toBeNull();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.runpod.ai/v2/fake-endpoint/embed/documents");
  });

  it("wraps a single query string into a one-element array and calls the query route", async () => {
    const fetcher = vi.fn(async (_url: string) => jsonResponse(validPayload(1)));
    const adapter = createRunPodEmbedderAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.embedQuery("hello");
    expect(result.status).toBe("ok");
    const [url] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.runpod.ai/v2/fake-endpoint/embed/query");
  });

  it("omits the Authorization header when no api key is configured", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
      return jsonResponse(validPayload(1));
    });
    const adapter = createRunPodEmbedderAdapter(identity, { url: config.url }, fetcher as unknown as typeof fetch);
    await adapter.embedQuery("hello");
  });

  it("fails closed on a URL that does not pass the allowlist, without ever calling fetch", async () => {
    const fetcher = vi.fn();
    const adapter = createRunPodEmbedderAdapter(identity, { url: "https://evil.example.com" }, fetcher as unknown as typeof fetch);
    const result = await adapter.embedDocuments(["a"]);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.reason).toMatch(/allowlist/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("still records a real, distinguishing inputDigest on an allowlist rejection (auditor-sol Wave 2 finding #5)", async () => {
    const adapter = createRunPodEmbedderAdapter(identity, { url: "https://evil.example.com" }, vi.fn() as unknown as typeof fetch);
    const resultA = await adapter.embedDocuments(["document A"]);
    const resultB = await adapter.embedDocuments(["a completely different document B"]);
    expect(resultA.receipt.inputDigest).not.toBe("");
    expect(resultA.receipt.inputDigest).not.toBe(resultB.receipt.inputDigest);
  });

  it("reports a non-ok HTTP status as a provider error", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 500 }));
    const adapter = createRunPodEmbedderAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.embedDocuments(["a"]);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.reason).toContain("HTTP 500");
  });

  it("reports a non-JSON response as a provider error rather than throwing", async () => {
    const fetcher = vi.fn(async () => new Response("not json", { status: 200 }));
    const adapter = createRunPodEmbedderAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.embedDocuments(["a"]);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.reason).toMatch(/not JSON/);
  });

  it("rejects a response with the wrong schemaVersion rather than trusting it", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...validPayload(1), schemaVersion: "tavonel.embedding_result.v0" }));
    const adapter = createRunPodEmbedderAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.embedDocuments(["a"]);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.reason).toMatch(/schema validation/);
  });

  it("rejects a response whose declared dimension disagrees with the adapter's identity", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...validPayload(1), dimension: 4, vectors: [[0.1, 0.2, 0.3, 0.4]] }));
    const adapter = createRunPodEmbedderAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.embedDocuments(["a"]);
    expect(result.status).toBe("error");
  });

  it("rejects a response that returns fewer vectors than inputs, rather than silently misaligning them", async () => {
    const fetcher = vi.fn(async () => jsonResponse(validPayload(1)));
    const adapter = createRunPodEmbedderAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.embedDocuments(["a", "b", "c"]);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.reason).toContain("1 vectors for 3 inputs");
  });

  it("surfaces a network failure as a provider error with a receipt, not an unhandled rejection", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const adapter = createRunPodEmbedderAdapter(identity, config, fetcher as unknown as typeof fetch);
    const result = await adapter.embedDocuments(["a"]);
    expect(result.status).toBe("error");
    expect(result.receipt.timedOut).toBe(false);
  });
});
