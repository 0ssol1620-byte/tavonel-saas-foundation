import { describe, expect, it } from "vitest";
import {
  BGE_M3_BASELINE_PROFILE_ID,
  buildBgeM3BaselineProfile,
  checkEmbeddingCompatibility,
  computeRetrievalProfileDigest,
  parseRetrievalProfile,
} from "./retrieval-profile";

describe("RetrievalProfile", () => {
  it("builds a deterministic BGE-M3 baseline profile whose digest is reproducible", () => {
    const first = buildBgeM3BaselineProfile("pilot-proof", "rev-1");
    const second = buildBgeM3BaselineProfile("pilot-proof", "rev-1");
    expect(first).toEqual(second);
    expect(first.id).toBe(BGE_M3_BASELINE_PROFILE_ID);
    expect(first.fusion).toEqual({ algorithm: "rrf", k: 60 });
    expect(first.profileDigest).toBe(computeRetrievalProfileDigest(first));

    const differentRevision = buildBgeM3BaselineProfile("pilot-proof", "rev-2");
    expect(differentRevision.profileDigest).not.toBe(first.profileDigest);
  });

  it("pins the embedder and reranker to independent revisions when both are given", () => {
    const profile = buildBgeM3BaselineProfile("pilot-proof", "embed-rev", "rerank-rev");
    expect(profile.embedding.revision).toBe("embed-rev");
    expect(profile.reranker?.revision).toBe("rerank-rev");
  });

  it("round-trips a valid profile through the fail-closed parser", () => {
    const profile = buildBgeM3BaselineProfile("pilot-proof", "rev-1");
    expect(parseRetrievalProfile(profile)).toEqual(profile);
    expect(parseRetrievalProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
  });

  it("rejects a profile whose digest does not match its own content", () => {
    const profile = buildBgeM3BaselineProfile("pilot-proof", "rev-1");
    expect(parseRetrievalProfile({ ...profile, profileDigest: `sha256:${"0".repeat(64)}` })).toBeNull();
  });

  it("rejects a fusion algorithm other than rrf for v1", () => {
    const profile = buildBgeM3BaselineProfile("pilot-proof", "rev-1");
    const tampered = { ...profile, fusion: { algorithm: "weighted-sum", k: 60 } };
    expect(parseRetrievalProfile(tampered)).toBeNull();
  });

  it("rejects an out-of-range or malformed embedding dimension", () => {
    const profile = buildBgeM3BaselineProfile("pilot-proof", "rev-1");
    expect(parseRetrievalProfile({ ...profile, embedding: { ...profile.embedding, dimension: 0 } })).toBeNull();
    expect(parseRetrievalProfile({ ...profile, embedding: { ...profile.embedding, dimension: 1.5 } })).toBeNull();
  });

  it("rejects duplicate or unknown view kinds", () => {
    const profile = buildBgeM3BaselineProfile("pilot-proof", "rev-1");
    expect(parseRetrievalProfile({ ...profile, views: ["section", "section"] })).toBeNull();
    expect(parseRetrievalProfile({ ...profile, views: ["section", "paragraph"] })).toBeNull();
  });

  it("flags an incompatible runtime embedding space instead of silently mixing vector spaces", () => {
    const profile = buildBgeM3BaselineProfile("pilot-proof", "rev-1");
    expect(checkEmbeddingCompatibility(profile, {
      provider: "huggingface", model: "BAAI/bge-m3", revision: "rev-1", dimension: 1024, normalize: true,
    })).toEqual({ compatible: true });

    const dimensionMismatch = checkEmbeddingCompatibility(profile, {
      provider: "huggingface", model: "Qwen/Qwen3-Embedding-0.6B", revision: "rev-x", dimension: 1536, normalize: true,
    });
    expect(dimensionMismatch.compatible).toBe(false);

    const revisionMismatch = checkEmbeddingCompatibility(profile, {
      provider: "huggingface", model: "BAAI/bge-m3", revision: "rev-2", dimension: 1024, normalize: true,
    });
    expect(revisionMismatch.compatible).toBe(false);
  });
});
