import { afterEach, describe, expect, it } from "vitest";
import {
  BGE_M3_REVISION,
  BGE_RERANKER_V2_M3_REVISION,
  buildProductionRetrievalProfile,
  createProductionEmbedderAdapter,
  createProductionRerankerAdapter,
  readRetrievalRuntimeEnv,
} from "./retrieval-runtime-config";

const ENV_KEYS = ["RETRIEVAL_RUNPOD_EMBEDDER_URL", "RETRIEVAL_RUNPOD_RERANKER_URL", "RUNPOD_API_KEY"] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(clearEnv);

describe("readRetrievalRuntimeEnv", () => {
  it("returns null when any of the three variables is missing", () => {
    clearEnv();
    expect(readRetrievalRuntimeEnv()).toBeNull();
    process.env.RETRIEVAL_RUNPOD_EMBEDDER_URL = "https://embed.api.runpod.ai";
    expect(readRetrievalRuntimeEnv()).toBeNull();
    process.env.RETRIEVAL_RUNPOD_RERANKER_URL = "https://rerank.api.runpod.ai";
    expect(readRetrievalRuntimeEnv()).toBeNull();
  });

  it("returns the trimmed config once all three are set", () => {
    process.env.RETRIEVAL_RUNPOD_EMBEDDER_URL = " https://embed.api.runpod.ai ";
    process.env.RETRIEVAL_RUNPOD_RERANKER_URL = "https://rerank.api.runpod.ai";
    process.env.RUNPOD_API_KEY = "test-key";
    expect(readRetrievalRuntimeEnv()).toEqual({
      embedderUrl: "https://embed.api.runpod.ai",
      rerankerUrl: "https://rerank.api.runpod.ai",
      apiKey: "test-key",
    });
  });

  it("rejects a non-URL value rather than passing it through", () => {
    process.env.RETRIEVAL_RUNPOD_EMBEDDER_URL = "not-a-url";
    process.env.RETRIEVAL_RUNPOD_RERANKER_URL = "https://rerank.api.runpod.ai";
    process.env.RUNPOD_API_KEY = "test-key";
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
    const adapter = createProductionEmbedderAdapter(env);
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
    const adapter = createProductionRerankerAdapter(env);
    const profile = buildProductionRetrievalProfile("pilot-proof");
    expect(adapter.identity()).toEqual({
      provider: profile.reranker?.provider,
      model: profile.reranker?.model,
      revision: profile.reranker?.revision,
    });
  });
});
