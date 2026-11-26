import { describe, expect, it } from "vitest";
import { markedWindow } from "./ask-evidence-window";
import { buildContextPacket, type RankedRetrievalUnit } from "./context-packet";
import { answerFromContextPacket, answerGroundedQuestion, COMPILED_ANSWER_CHARACTER_LIMIT, FALLBACK_ANSWER_CHARACTER_LIMIT } from "./grounded-ask";
import {
  ASKED_COMPANY_SOURCE,
  ASKED_LINE,
  DISTRACTOR_SOURCE,
  SYNTHETIC_COLLECTION_ID,
  SYNTHETIC_MANIFEST_DIGEST,
  SYNTHETIC_QUESTION,
  syntheticArtifact,
  syntheticRegions,
  type SyntheticRegion,
} from "./__fixtures__/ask-synthetic/statement-world";

// WO-ASK-0: the observed case, on a synthetic World, through the real retrievers.
describe("Ask on a synthetic twelve-statement World (fallback retriever)", () => {
  it("answers with the asked company's region first and a window that holds the asked line", () => {
    const answer = answerGroundedQuestion(syntheticArtifact(), SYNTHETIC_QUESTION);
    expect(answer?.status).toBe("grounded");
    expect(answer?.reason).toBeNull();
    expect(answer?.citations[0]?.sourceId).toBe(ASKED_COMPANY_SOURCE);
    expect(answer?.citations.map(citation => citation.sourceId)).not.toContain(DISTRACTOR_SOURCE);
    // Every cited region is the asked company's; the statement region's window holds the line.
    const statement = answer?.citations.find(citation => citation.evidenceId === "evidence-chunk-quillmore-b-statement");
    expect(statement?.sourceId).toBe(ASKED_COMPANY_SOURCE);
    expect(statement?.excerpt).toContain(ASKED_LINE);
    expect(answer?.answer).toContain(ASKED_LINE);
  });

  it("returns each window as a verbatim substring of its stored region, with the region's page and box", () => {
    const regions = new Map(syntheticRegions().map(region => [`evidence-${region.chunkId}`, region.text]));
    const answer = answerGroundedQuestion(syntheticArtifact(), SYNTHETIC_QUESTION)!;
    const stored = new Map(syntheticArtifact().package.files[0]!.content.trim().split("\n").map(line => {
      const row = JSON.parse(line) as { evidenceId: string; pageNumber1: number; bbox1000: number[] };
      return [row.evidenceId, row];
    }));
    for (const citation of answer.citations) {
      const text = regions.get(citation.evidenceId)!;
      expect(text.slice(citation.window.start, citation.window.end)).toBe(citation.excerpt);
      expect(citation.window.regionLength).toBe(text.length);
      expect(citation.window.end - citation.window.start).toBeLessThan(text.length);
      expect(citation.excerpt.length).toBeLessThanOrEqual(420);
      expect(citation.pageNumber1).toBe(stored.get(citation.evidenceId)!.pageNumber1);
      expect(citation.bbox1000).toEqual(stored.get(citation.evidenceId)!.bbox1000);
    }
    // The answer is the windows in rank order, each cut edge marked in-band with "…".
    expect(answer.answer).toBe(answer.citations.map(citation => markedWindow(regions.get(citation.evidenceId)!, citation.window)).join("\n\n"));
    expect(answer.answer).toContain("…");
    expect(answer.answer.length).toBeLessThanOrEqual(FALLBACK_ANSWER_CHARACTER_LIMIT);
  });

  it("puts no score, threshold or feature in the window it adds", () => {
    const answer = answerGroundedQuestion(syntheticArtifact(), SYNTHETIC_QUESTION)!;
    for (const citation of answer.citations) expect(Object.keys(citation.window).sort()).toEqual(["end", "regionLength", "start"]);
  });

  it("still abstains when no evidence matches", () => {
    const answer = answerGroundedQuestion(syntheticArtifact(), "양자 중력 실험 결과");
    expect(answer).toMatchObject({ status: "abstained", answer: "", reason: "NO_REGION_BOUND_EVIDENCE_MATCH", citations: [] });
  });

  it("never ranks a region that matches only the year above the named company's region", () => {
    const answer = answerGroundedQuestion(syntheticArtifact(), "Brakewell 2022")!;
    expect(answer.citations[0]?.sourceId).toBe("source-brakewell");
    expect(answer.citations.every(citation => citation.sourceId === "source-brakewell")).toBe(true);
  });

  it("refuses an over-long or empty question as before", () => {
    expect(answerGroundedQuestion(syntheticArtifact(), "q".repeat(501))).toBeNull();
    expect(answerGroundedQuestion(syntheticArtifact(), "   ")).toBeNull();
  });

  it("answers 10,000 regions inside the answer envelope", () => {
    const base = syntheticRegions();
    const many: SyntheticRegion[] = Array.from({ length: 10_000 }, (_, index) => {
      const region = base[index % base.length]!;
      return { ...region, chunkId: `${region.chunkId}-${index}` };
    });
    const started = performance.now();
    const answer = answerGroundedQuestion(syntheticArtifact(many), SYNTHETIC_QUESTION)!;
    expect(performance.now() - started).toBeLessThan(30_000);
    expect(answer.status).toBe("grounded");
    expect(answer.citations[0]?.sourceId).toBe(ASKED_COMPANY_SOURCE);
    expect(answer.answer.length).toBeLessThanOrEqual(FALLBACK_ANSWER_CHARACTER_LIMIT);
  });
});

function packetOf(regions: SyntheticRegion[]) {
  const units: RankedRetrievalUnit[] = regions.map((region, index) => ({
    unitId: `unit-${region.chunkId}`,
    text: region.text,
    claimIds: [],
    entityIds: [],
    sourceVersionId: `version-${region.sourceId}`,
    evidenceIds: [`evidence-${region.chunkId}`],
    pageNumber1: 1,
    bbox1000: [40, 60 + index, 960, 400 + index],
    authority: "unclassified",
  }));
  return buildContextPacket(units, {
    worldId: SYNTHETIC_COLLECTION_ID, worldVersion: "ws_synthetic", retrievalProfile: "profile-synthetic",
    question: SYNTHETIC_QUESTION,
  });
}

describe("Ask on the synthetic World (compiled builder)", () => {
  const meta = { collectionId: SYNTHETIC_COLLECTION_ID, manifestDigest: SYNTHETIC_MANIFEST_DIGEST };

  it("answers with a verbatim window of every cited region instead of abstaining on length", () => {
    const regions = syntheticRegions().filter(region => [ASKED_COMPANY_SOURCE, DISTRACTOR_SOURCE].includes(region.sourceId));
    const answer = answerFromContextPacket(packetOf(regions), meta);
    expect(answer.status).toBe("grounded");
    expect(answer.reason).toBeNull();
    expect(answer.citations).toHaveLength(regions.length);
    answer.citations.forEach((citation, index) => {
      expect(regions[index]!.text.slice(citation.window.start, citation.window.end)).toBe(citation.excerpt);
      expect(citation.pageNumber1).toBe(1);
      expect(citation.bbox1000).toEqual([40, 60 + index, 960, 400 + index]);
    });
    expect(answer.answer).toContain(ASKED_LINE);
    expect(answer.answer.length).toBeLessThanOrEqual(COMPILED_ANSWER_CHARACTER_LIMIT);
  });

  it("finds the asked line when only the named company's regions are cited (no entity term stands out)", () => {
    const regions = syntheticRegions().filter(region => region.sourceId === ASKED_COMPANY_SOURCE);
    const answer = answerFromContextPacket(packetOf(regions), meta);
    const statement = answer.citations.find(citation => citation.evidenceId === "evidence-chunk-quillmore-b-statement");
    expect(statement?.excerpt).toContain(ASKED_LINE);
  });

  it("keeps the pipeline's order: the window never promotes a region, matching or not", () => {
    const unrelated: SyntheticRegion = { chunkId: "chunk-unrelated", sourceId: "source-unrelated", company: "", text: "Unrelated caption.\n".repeat(60) };
    const regions = [unrelated, ...syntheticRegions().filter(region => region.sourceId === ASKED_COMPANY_SOURCE)];
    const answer = answerFromContextPacket(packetOf(regions), meta);
    expect(answer.citations.map(citation => citation.evidenceId)).toEqual(regions.map(region => `evidence-${region.chunkId}`));
    expect(answer.citations[0]!.window.start).toBe(0);
    expect(answer.citations[0]!.excerpt.startsWith("Unrelated caption.")).toBe(true);
  });

  it("bounds a 1,000,000-character region to one window", () => {
    const huge: SyntheticRegion = { chunkId: "chunk-huge", sourceId: ASKED_COMPANY_SOURCE, company: "", text: `${"Filler line 1,234\n".repeat(55_000)}${ASKED_LINE}\n`.padEnd(1_000_000, "z") };
    const answer = answerFromContextPacket(packetOf([huge]), meta);
    expect(answer.status).toBe("grounded");
    expect(answer.citations[0]!.excerpt).toContain(ASKED_LINE);
    expect(answer.answer.length).toBeLessThanOrEqual(420);
  });

  // The integrity abstention (CITED_EVIDENCE_NOT_IN_PACKET) is held by grounded-ask-packet.test.ts.
  it("still abstains on an empty packet, with nothing cited", () => {
    const empty = buildContextPacket([], { worldId: SYNTHETIC_COLLECTION_ID, worldVersion: "ws", retrievalProfile: "p", question: SYNTHETIC_QUESTION, abstentionReasons: ["no candidate survived retrieval for this question"] });
    expect(answerFromContextPacket(empty, meta)).toMatchObject({ status: "abstained", answer: "", reason: "no candidate survived retrieval for this question", citations: [] });
  });
});
