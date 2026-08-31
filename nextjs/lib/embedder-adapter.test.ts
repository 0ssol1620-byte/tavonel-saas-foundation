import { describe, expect, it } from "vitest";
import { buildBgeM3BaselineProfile } from "./retrieval-profile";
import { digestOf, embedDocumentsForProfile, type EmbedderAdapter, type EmbedderReceipt } from "./embedder-adapter";

function receipt(overrides: Partial<EmbedderReceipt> = {}): EmbedderReceipt {
  return {
    provider: "huggingface", model: "BAAI/bge-m3", revision: "rev-1", dimension: 3, normalize: true,
    inputDigest: "sha256:x", outputDigest: "sha256:y", durationMs: 5, timedOut: false,
    ...overrides,
  };
}

function fakeAdapter(overrides: Partial<EmbedderAdapter> = {}): EmbedderAdapter {
  return {
    identity: () => ({ provider: "huggingface", model: "BAAI/bge-m3", revision: "rev-1", dimension: 3, normalize: true }),
    embedDocuments: async (texts) => ({ status: "ok", vectors: texts.map(() => [0.1, 0.2, 0.3]), receipt: receipt() }),
    embedQuery: async () => ({ status: "ok", vectors: [[0.1, 0.2, 0.3]], receipt: receipt() }),
    ...overrides,
  };
}

describe("embedDocumentsForProfile", () => {
  const profile = buildBgeM3BaselineProfile("pilot-proof", "rev-1");

  it("embeds when the adapter's declared identity matches the profile", async () => {
    const result = await embedDocumentsForProfile(fakeAdapter(), { ...profile, embedding: { ...profile.embedding, dimension: 3 } }, ["a", "b"]);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.vectors).toHaveLength(2);
  });

  it("fails closed before calling the adapter when declared identity disagrees with the profile", async () => {
    let called = false;
    const adapter = fakeAdapter({ embedDocuments: async (texts) => { called = true; return { status: "ok", vectors: texts.map(() => [0.1, 0.2, 0.3]), receipt: receipt() }; } });
    const result = await embedDocumentsForProfile(adapter, profile, ["a"]); // profile dimension is 1024, adapter declares 3
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.failure.kind).toBe("profile_mismatch");
    expect(called).toBe(false);
  });

  it("fails closed when the adapter's declared identity matches but the returned vector dimension does not", async () => {
    const matchingProfile = { ...profile, embedding: { ...profile.embedding, dimension: 3 } };
    const adapter = fakeAdapter({
      embedDocuments: async () => ({ status: "ok", vectors: [[0.1, 0.2]], receipt: receipt({ dimension: 3 }) }),
    });
    const result = await embedDocumentsForProfile(adapter, matchingProfile, ["a"]);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.failure.kind).toBe("runtime_dimension_mismatch");
  });

  it("surfaces a provider error without masking it as a compatibility failure", async () => {
    const matchingProfile = { ...profile, embedding: { ...profile.embedding, dimension: 3 } };
    const adapter = fakeAdapter({
      embedDocuments: async () => ({ status: "error", reason: "RunPod endpoint timed out", receipt: receipt({ timedOut: true }) }),
    });
    const result = await embedDocumentsForProfile(adapter, matchingProfile, ["a"]);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.failure.kind).toBe("provider_error");
      expect(result.receipt?.timedOut).toBe(true);
    }
  });

  it("computes a stable digest for identical input", () => {
    expect(digestOf(["a", "b"])).toBe(digestOf(["a", "b"]));
    expect(digestOf(["a", "b"])).not.toBe(digestOf(["a", "c"]));
  });
});
