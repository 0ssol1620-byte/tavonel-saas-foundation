import { describe, expect, it } from "vitest";
import { buildContextPacket, type ContextPacket, type RankedRetrievalUnit } from "./context-packet";
import { generateGroundedAnswer, type GeneratorAdapter, type GeneratorReceipt } from "./generator-adapter";

function receipt(overrides: Partial<GeneratorReceipt> = {}): GeneratorReceipt {
  return {
    provider: "openai",
    model: "gpt-5.6",
    revision: "rev-1",
    inputDigest: "sha256:x",
    outputDigest: "sha256:y",
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

const units: RankedRetrievalUnit[] = [
  {
    unitId: "retrieval-unit-a",
    text: "Payment terms are net 30 days.",
    claimIds: ["claim-a"],
    entityIds: [],
    sourceVersionId: "sv-a",
    evidenceIds: ["evidence-a"],
    pageNumber1: 3,
    bbox1000: [10, 20, 300, 400],
    authority: "contractual",
  },
];

function packet(): ContextPacket {
  return buildContextPacket(units, {
    worldId: "world-1",
    worldVersion: "v1",
    retrievalProfile: "bge-m3-v1",
    question: "What are the payment terms?",
  });
}

describe("generateGroundedAnswer", () => {
  it("returns a grounded answer when every cited evidence id exists in the packet", async () => {
    const adapter: GeneratorAdapter = {
      identity: () => ({ provider: "openai", model: "gpt-5.6", revision: "rev-1" }),
      generate: async () => ({
        status: "ok",
        candidate: {
          answer: "Payment terms are net 30 days.",
          citations: [{ evidenceId: "evidence-a", quote: "net 30 days" }],
        },
        receipt: receipt(),
      }),
    };
    const outcome = await generateGroundedAnswer(adapter, packet());
    expect(outcome.status).toBe("grounded");
    if (outcome.status === "grounded") {
      expect(outcome.citations).toHaveLength(1);
      expect(outcome.citations[0].pageNumber1).toBe(3);
      expect(outcome.citations[0].bbox1000).toEqual([10, 20, 300, 400]);
      expect(outcome.citations[0].authority).toBe("contractual");
    }
  });

  it("rejects the answer when the generator cites an evidence id that does not exist in the packet (citation-hallucination guard)", async () => {
    const adapter: GeneratorAdapter = {
      identity: () => ({ provider: "openai", model: "gpt-5.6", revision: "rev-1" }),
      generate: async () => ({
        status: "ok",
        candidate: {
          answer: "Payment terms are net 45 days.",
          citations: [{ evidenceId: "evidence-invented-by-model", quote: "net 45 days" }],
        },
        receipt: receipt(),
      }),
    };
    const outcome = await generateGroundedAnswer(adapter, packet());
    expect(outcome.status).toBe("abstained");
    if (outcome.status === "abstained") {
      expect(outcome.reason).toMatch(/^FABRICATED_CITATION_REJECTED/);
      expect(outcome.reason).toContain("evidence-invented-by-model");
    }
  });

  it("rejects the whole answer if even one of several citations is fabricated", async () => {
    const adapter: GeneratorAdapter = {
      identity: () => ({ provider: "openai", model: "gpt-5.6", revision: "rev-1" }),
      generate: async () => ({
        status: "ok",
        candidate: {
          answer: "Mixed real and invented citation.",
          citations: [
            { evidenceId: "evidence-a", quote: "net 30 days" },
            { evidenceId: "evidence-fabricated", quote: "made up" },
          ],
        },
        receipt: receipt(),
      }),
    };
    const outcome = await generateGroundedAnswer(adapter, packet());
    expect(outcome.status).toBe("abstained");
  });

  it("abstains without calling the adapter when the packet has no context to ground on", async () => {
    let called = false;
    const adapter: GeneratorAdapter = {
      identity: () => ({ provider: "openai", model: "gpt-5.6", revision: "rev-1" }),
      generate: async () => {
        called = true;
        return { status: "ok", candidate: { answer: "", citations: [] }, receipt: receipt() };
      },
    };
    const emptyPacket = buildContextPacket([], {
      worldId: "world-1",
      worldVersion: "v1",
      retrievalProfile: "bge-m3-v1",
      question: "anything",
    });
    const outcome = await generateGroundedAnswer(adapter, emptyPacket);
    expect(outcome.status).toBe("abstained");
    if (outcome.status === "abstained") expect(outcome.reason).toBe("NO_CONTEXT_TO_GROUND");
    expect(called).toBe(false);
  });

  it("abstains with a distinct reason on a provider failure, rather than confusing it with a fabricated citation", async () => {
    const adapter: GeneratorAdapter = {
      identity: () => ({ provider: "openai", model: "gpt-5.6", revision: "rev-1" }),
      generate: async () => ({ status: "error", reason: "RunPod endpoint unavailable", receipt: receipt({ timedOut: true }) }),
    };
    const outcome = await generateGroundedAnswer(adapter, packet());
    expect(outcome.status).toBe("abstained");
    if (outcome.status === "abstained") {
      expect(outcome.reason).toBe("GENERATOR_PROVIDER_ERROR: RunPod endpoint unavailable");
      expect(outcome.receipt?.timedOut).toBe(true);
    }
  });
});
