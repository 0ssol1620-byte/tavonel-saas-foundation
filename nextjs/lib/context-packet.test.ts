import { describe, expect, it } from "vitest";
import { buildContextPacket, parseContextPacket, verifyGroundedCitations, type RankedRetrievalUnit } from "./context-packet";

function unit(overrides: Partial<RankedRetrievalUnit> = {}): RankedRetrievalUnit {
  return {
    unitId: "retrieval-unit-a",
    text: "Payment terms are net 30 days.",
    claimIds: ["claim-1"],
    entityIds: ["entity-1"],
    sourceVersionId: "a".repeat(64),
    evidenceIds: ["evidence-1"],
    pageNumber1: 2,
    bbox1000: [100, 100, 900, 200],
    authority: "official",
    lexicalRank: 1,
    rerankerScore: 0.94,
    ...overrides,
  };
}

describe("ContextPacket", () => {
  it("assembles ranked units into the shared packet contract", () => {
    const packet = buildContextPacket([unit()], {
      worldId: "collection-abc",
      worldVersion: "sha256:" + "a".repeat(64),
      retrievalProfile: "bge-m3-v1",
      question: "What are the payment terms?",
    });
    expect(packet.items).toHaveLength(1);
    expect(packet.items[0].retrieval).toEqual({ lexicalRank: 1, denseRank: null, structureRank: null, rerankerScore: 0.94 });
    expect(packet.heldConflicts).toEqual([]);
    expect(packet.abstentionReasons).toEqual([]);
  });

  it("round-trips through the fail-closed parser", () => {
    const packet = buildContextPacket([unit()], {
      worldId: "collection-abc", worldVersion: "sha256:" + "a".repeat(64),
      retrievalProfile: "bge-m3-v1", question: "q",
    });
    expect(parseContextPacket(JSON.parse(JSON.stringify(packet)))).toEqual(packet);
    expect(parseContextPacket({ ...packet, items: [{ unitId: "x" }] })).toBeNull();
    expect(parseContextPacket(null)).toBeNull();
  });

  it("carries held conflicts and abstention reasons through untouched", () => {
    const packet = buildContextPacket([], {
      worldId: "collection-abc", worldVersion: "sha256:" + "a".repeat(64),
      retrievalProfile: "bge-m3-v1", question: "q",
      heldConflicts: [{ claimIds: ["claim-1", "claim-2"], reason: "payment term conflict: 30 vs 45 days" }],
      abstentionReasons: ["NO_REGION_BOUND_EVIDENCE_MATCH"],
    });
    expect(packet.heldConflicts).toHaveLength(1);
    expect(packet.abstentionReasons).toEqual(["NO_REGION_BOUND_EVIDENCE_MATCH"]);
  });

  it("rejects a citation to evidence the packet never retrieved", () => {
    const packet = buildContextPacket([unit()], {
      worldId: "collection-abc", worldVersion: "sha256:" + "a".repeat(64),
      retrievalProfile: "bge-m3-v1", question: "q",
    });
    expect(verifyGroundedCitations(["evidence-1"], packet)).toEqual({ valid: true });
    const result = verifyGroundedCitations(["evidence-1", "evidence-invented-by-model"], packet);
    expect(result).toEqual({ valid: false, unknownEvidenceIds: ["evidence-invented-by-model"] });
  });
});
