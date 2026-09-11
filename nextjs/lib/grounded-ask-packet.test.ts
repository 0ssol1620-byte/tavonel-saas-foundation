import { describe, expect, it } from "vitest";
import { answerFromContextPacket } from "./grounded-ask";
import { buildContextPacket, parseContextPacket, type RankedRetrievalUnit } from "./context-packet";

/*
  Audit R4-02: the compiled path's answer.

  Before this, /ask's compiled branch returned a ContextPacket, retrieval diagnostics and the
  code GROUNDED_ANSWER with no `answer` field at all -- only the excerpt-concatenation fallback
  produced prose. That was survivable only while the compiled branch was unreachable (R4-01);
  wiring it without this would have shipped a "successful" answer with nothing in it.

  What is asserted here is the answer's own rules, not the pipeline's: the text is the cited
  excerpts in the packet's rank order, a unit with no evidence binding cannot be cited, an
  answer with no citations abstains, and the receipt binds to the world version.
*/

const COLLECTION = `collection-${"a".repeat(32)}`;
const MANIFEST = `sha256:${"1".repeat(64)}`;

function unit(overrides: Partial<RankedRetrievalUnit> & { unitId: string }): RankedRetrievalUnit {
  return {
    text: `text for ${overrides.unitId}`,
    claimIds: ["claim-one"],
    entityIds: ["entity-one"],
    sourceVersionId: "c".repeat(64),
    evidenceIds: [`evidence-${overrides.unitId}`],
    pageNumber1: 3,
    bbox1000: [10, 20, 30, 40],
    authority: "official_policy",
    lexicalRank: 1,
    ...overrides,
  };
}

function packetOf(units: RankedRetrievalUnit[], abstentionReasons: string[] = []) {
  return buildContextPacket(units, {
    worldId: COLLECTION,
    worldVersion: MANIFEST,
    retrievalProfile: "bge-m3-v1",
    question: "what is the notice period",
    abstentionReasons,
  });
}

const meta = { collectionId: COLLECTION, manifestDigest: MANIFEST };

describe("an answer built from a ContextPacket", () => {
  it("is the cited excerpts in the packet's own order, with a receipt bound to the world", () => {
    const answer = answerFromContextPacket(
      packetOf([unit({ unitId: "u1", text: "The notice period is thirty days." }), unit({ unitId: "u2", text: "Renewal is automatic." })]),
      meta,
    );
    expect(answer.status).toBe("grounded");
    expect(answer.reason).toBeNull();
    // Rank order is the pipeline's final order (RRF, then reranker, then the World Gate). The
    // answer does not re-rank: two orders for one answer is one order too many.
    expect(answer.answer).toBe("The notice period is thirty days.\n\nRenewal is automatic.");
    expect(answer.citations.map((citation) => citation.unitId)).toEqual(["u1", "u2"]);
    expect(answer.citations[0]).toMatchObject({
      evidenceId: "evidence-u1",
      pageNumber1: 3,
      bbox1000: [10, 20, 30, 40],
      authority: "official_policy",
    });
    // Per-source ranks, not an invented 0-1 relevance the compiled path never measured.
    expect(answer.citations[0].retrieval).toMatchObject({ lexicalRank: 1, denseRank: null, rerankerScore: null });
    expect(answer.receipt).toMatchObject({
      collectionId: COLLECTION,
      manifestDigest: MANIFEST,
      retrieval: "bge-m3-v1",
      candidatePromotion: false,
    });
    expect(answer.receipt.outputSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("hashes the same answer to the same digest and a different one differently", () => {
    const first = answerFromContextPacket(packetOf([unit({ unitId: "u1" })]), meta);
    const same = answerFromContextPacket(packetOf([unit({ unitId: "u1" })]), meta);
    const other = answerFromContextPacket(packetOf([unit({ unitId: "u1", text: "different" })]), meta);
    expect(same.receipt.outputSha256).toBe(first.receipt.outputSha256);
    expect(other.receipt.outputSha256).not.toBe(first.receipt.outputSha256);
  });

  it("abstains on an empty packet and carries the pipeline's reason when it gave one", () => {
    const empty = answerFromContextPacket(packetOf([]), meta);
    expect(empty.status).toBe("abstained");
    expect(empty.answer).toBe("");
    expect(empty.citations).toEqual([]);
    expect(empty.reason).toBe("NO_REGION_BOUND_EVIDENCE_MATCH");

    const gated = answerFromContextPacket(packetOf([], ["every candidate was rejected by the World Gate"]), meta);
    expect(gated.reason).toBe("every candidate was rejected by the World Gate");
  });

  it("cannot cite a unit with no evidence binding, and abstains rather than claiming one", () => {
    /*
      The World Gate already rejects NO_EVIDENCE_BOUND units, so this should be unreachable.
      Refusing them here too means a gate regression degrades into an abstention instead of
      into an answer with an uncited claim in it.
    */
    const mixed = answerFromContextPacket(
      packetOf([unit({ unitId: "u1", evidenceIds: [], text: "unbound" }), unit({ unitId: "u2", text: "bound" })]),
      meta,
    );
    expect(mixed.citations.map((citation) => citation.unitId)).toEqual(["u2"]);
    expect(mixed.answer).toBe("bound");

    const allUnbound = answerFromContextPacket(packetOf([unit({ unitId: "u1", evidenceIds: [] })]), meta);
    expect(allUnbound.status).toBe("abstained");
    expect(allUnbound.citations).toEqual([]);
  });

  it("drops a unit with no text rather than emitting an empty excerpt as evidence", () => {
    const answer = answerFromContextPacket(packetOf([unit({ unitId: "u1", text: "   " }), unit({ unitId: "u2", text: "real" })]), meta);
    expect(answer.citations).toHaveLength(1);
    expect(answer.answer).toBe("real");
  });

  it("truncates a long excerpt the same way the fallback path does", () => {
    const long = "x".repeat(600);
    const answer = answerFromContextPacket(packetOf([unit({ unitId: "u1", text: long })]), meta);
    expect(answer.citations[0].excerpt).toHaveLength(420);
    expect(answer.citations[0].excerpt.endsWith("...")).toBe(true);
  });

  it("only ever cites evidence the packet actually contains", () => {
    // verifyGroundedCitations is the enforcement point the seam promises. This builder cannot
    // invent an id, so the assertion is that every cited id is in the packet -- the property
    // that must keep holding if the builder ever changes.
    const packet = packetOf([unit({ unitId: "u1" }), unit({ unitId: "u2" })]);
    const answer = answerFromContextPacket(packet, meta);
    const known = new Set(packet.items.flatMap((item) => item.evidenceIds));
    expect(answer.citations.every((citation) => known.has(citation.evidenceId))).toBe(true);
    // And the packet it answered from is still a valid packet, not a reshaped copy.
    expect(parseContextPacket(JSON.parse(JSON.stringify(packet)))).not.toBeNull();
  });
});
