import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerFromContextPacket,
  COMPILED_ANSWER_CHARACTER_LIMIT,
  EVIDENCE_EXCEEDS_ANSWER_LIMIT,
  type PacketAnswer,
} from "./grounded-ask";
import { buildContextPacket, parseContextPacket, type RankedRetrievalUnit } from "./context-packet";

// Lets one test force the real verifier to reject, to prove verification outranks overflow.
// Every other test runs the actual verifyGroundedCitations.
const verifier = vi.hoisted(() => ({ reject: false }));
vi.mock("./context-packet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context-packet")>();
  return {
    ...actual,
    verifyGroundedCitations: (ids: string[], packet: Parameters<typeof actual.verifyGroundedCitations>[1]) =>
      verifier.reject ? { valid: false as const, unknownEvidenceIds: ids } : actual.verifyGroundedCitations(ids, packet),
  };
});
afterEach(() => {
  verifier.reject = false;
});

// The qualifier, the following-sentence exception, the Korean negation, unit and date all sit
// past character 417 -- exactly what the old 417-character answer cut off.
const LEAD = `Renewal notice applies${" to every supplier contract".repeat(15)}`;
const RAW = `${LEAD}, except where the buyer waives notice in writing.\n\n   The 30-day rule does not apply to renewals signed after 2027-01-01.\n이 조항은 2026년 3월 31일 이후 체결된 계약에는 적용되지 않으며, 위약금은 120억원입니다.`;
const FULL = RAW.replace(/\s+/g, " ").trim();

function sized(length: number) {
  return `Renewal clause ${"-".repeat(length)}`.slice(0, length);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function expectedSha({ receipt: _receipt, ...unsigned }: PacketAnswer) {
  return `sha256:${createHash("sha256").update(canonical(unsigned)).digest("hex")}`;
}

/*
  Audit R4-02: the compiled path's answer.

  Before this, /ask's compiled branch returned a ContextPacket, retrieval diagnostics and the
  code GROUNDED_ANSWER with no `answer` field at all -- only the excerpt-concatenation fallback
  produced prose. That was survivable only while the compiled branch was unreachable (R4-01);
  wiring it without this would have shipped a "successful" answer with nothing in it.

  What is asserted here is the answer's own rules, not the pipeline's: the text is the complete
  cited evidence in the packet's rank order (the 420-character excerpt is only its preview), a
  unit with no evidence binding cannot be cited, an answer with no citations abstains, evidence
  too long for the answer envelope abstains with its citations kept, and the receipt binds to
  the world version.
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

  it("answers with the complete cited evidence while the citation preview stays bounded", () => {
    expect(FULL.indexOf("except where the buyer")).toBeGreaterThan(417);
    const answer = answerFromContextPacket(packetOf([unit({ unitId: "u1", text: RAW }), unit({ unitId: "u2", text: "Renewal is automatic." })]), meta);
    // Explicit, so an abstention (empty answer) can never satisfy the preservation checks below.
    expect(answer.status).toBe("grounded");
    expect(answer.reason).toBeNull();
    expect(answer.answer).toBe(`${FULL}\n\nRenewal is automatic.`);
    for (const kept of [
      "except where the buyer waives notice in writing.",
      "The 30-day rule does not apply to renewals signed after 2027-01-01.",
      "적용되지 않으며",
      "2026년 3월 31일",
      "120억원",
    ])
      expect(answer.answer).toContain(kept);
    expect(answer.citations.map((citation) => citation.unitId)).toEqual(["u1", "u2"]);
    expect(answer.citations[0].excerpt).toBe(`${FULL.slice(0, 417)}...`);
    expect(answer.citations[0].excerpt).toHaveLength(420);
    expect(answer.receipt.outputSha256).toBe(expectedSha(answer));
  });

  it("changes the answer and receipt when only text past character 417 changes", () => {
    const before = answerFromContextPacket(packetOf([unit({ unitId: "u1", text: RAW })]), meta);
    const after = answerFromContextPacket(packetOf([unit({ unitId: "u1", text: RAW.replace("2027-01-01", "2028-01-01") })]), meta);
    expect(before.status).toBe("grounded");
    expect(after.status).toBe("grounded");
    expect(after.citations[0].excerpt).toBe(before.citations[0].excerpt);
    expect(after.answer).toContain("2028-01-01");
    expect(after.answer).not.toBe(before.answer);
    expect(after.receipt.outputSha256).not.toBe(before.receipt.outputSha256);
  });

  it("accepts evidence of exactly the compiled limit and abstains one character over it", () => {
    expect(COMPILED_ANSWER_CHARACTER_LIMIT).toBe(4218);
    const exact = answerFromContextPacket(packetOf([unit({ unitId: "u1", text: sized(4218) })]), meta);
    expect(exact.status).toBe("grounded");
    expect(exact.answer).toHaveLength(4218);

    const over = answerFromContextPacket(packetOf([unit({ unitId: "u1", text: sized(4219) })]), meta);
    expect(over).toMatchObject({ status: "abstained", answer: "", reason: EVIDENCE_EXCEEDS_ANSWER_LIMIT });
    expect(over.citations.map((citation) => citation.unitId)).toEqual(["u1"]);
    expect(over.citations[0].excerpt).toHaveLength(420);
    expect(over.receipt.outputSha256).toBe(expectedSha(over));
  });

  it("counts the nine double-newline separators of a full default packet", () => {
    const ten = Array.from({ length: 10 }, (_, index) => unit({ unitId: `u${index}`, text: sized(420) }));
    const fits = answerFromContextPacket(packetOf(ten), meta);
    expect(fits.status).toBe("grounded");
    expect(fits.answer).toHaveLength(4218);

    // 4,201 characters of evidence, 4,219 with separators: every item fits a preview, the whole does not.
    ten[9] = unit({ unitId: "u9", text: sized(421) });
    const over = answerFromContextPacket(packetOf(ten), meta);
    expect(over).toMatchObject({ status: "abstained", answer: "", reason: EVIDENCE_EXCEEDS_ANSWER_LIMIT });
    expect(over.citations.map((citation) => citation.unitId)).toEqual(ten.map((item) => item.unitId));
  });

  it("abstains rather than dropping a later oversized item, and keeps every verified citation in order", () => {
    const answer = answerFromContextPacket(
      packetOf([unit({ unitId: "u1", text: "The notice period is thirty days." }), unit({ unitId: "u2", text: sized(5000) })]),
      meta,
    );
    expect(answer.status).toBe("abstained");
    expect(answer.answer).toBe("");
    expect(answer.reason).toBe(EVIDENCE_EXCEEDS_ANSWER_LIMIT);
    expect(answer.citations.map((citation) => citation.unitId)).toEqual(["u1", "u2"]);
    expect(answer.citations[1]).toMatchObject({
      evidenceId: "evidence-u2",
      evidenceIds: ["evidence-u2"],
      sourceVersionId: "c".repeat(64),
      pageNumber1: 3,
      bbox1000: [10, 20, 30, 40],
      authority: "official_policy",
      claimIds: ["claim-one"],
      entityIds: ["entity-one"],
    });
    expect(answer.citations[1].excerpt).toHaveLength(420);
  });

  it("does not count an unbound or empty unit toward the limit", () => {
    const answer = answerFromContextPacket(
      packetOf([
        unit({ unitId: "u1", evidenceIds: [], text: sized(9000) }),
        unit({ unitId: "u2", text: `   ${"\n".repeat(9000)}` }),
        unit({ unitId: "u3", text: "bound" }),
      ]),
      meta,
    );
    expect(answer).toMatchObject({ status: "grounded", answer: "bound", reason: null });
    expect(answer.citations.map((citation) => citation.unitId)).toEqual(["u3"]);
  });

  it("lets citation verification outrank overflow and never retains an unverified citation", () => {
    verifier.reject = true;
    const answer = answerFromContextPacket(packetOf([unit({ unitId: "u1", text: sized(5000) })]), meta);
    expect(answer).toMatchObject({ status: "abstained", answer: "", reason: "CITED_EVIDENCE_NOT_IN_PACKET", citations: [] });

    const short = answerFromContextPacket(packetOf([unit({ unitId: "u1" })]), meta);
    expect(short).toMatchObject({ status: "abstained", answer: "", reason: "CITED_EVIDENCE_NOT_IN_PACKET", citations: [] });
  });
});
