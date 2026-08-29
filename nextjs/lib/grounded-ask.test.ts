import { describe, expect, it } from "vitest";
import { answerGroundedQuestion } from "./grounded-ask";

const collectionId = "collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const manifestDigest = `sha256:${"b".repeat(64)}`;

function artifact() {
  const rows = [
    {
      chunkId: "chunk-1",
      logicalId: "claim-1",
      text: "2026년 분기 매출은 120억원으로 증가했습니다.",
      sourceId: "source-1",
      sourceVersionId: "version-1",
      evidenceId: "evidence-1",
      pageNumber1: 2,
      bbox1000: [100, 200, 900, 300],
      authority: "official",
      authorityTier: "official",
      authorityScore: 1,
      claimIds: ["claim-semantic-1"],
      entityIds: [],
      entityNames: [],
      languages: ["ko"],
      temporalRefs: ["2026"],
      retrievalTerms: ["2026", "분기", "매출", "증가"],
    },
    {
      chunkId: "chunk-2",
      logicalId: "claim-2",
      text: "The TAVONEL board approved the security policy in August 2026.",
      sourceId: "source-2",
      sourceVersionId: "version-2",
      evidenceId: "evidence-2",
      pageNumber1: 4,
      bbox1000: [120, 220, 880, 360],
      authority: "contractual",
      authorityTier: "official",
      authorityScore: 1,
      claimIds: ["claim-semantic-2"],
      entityIds: ["entity-tavonel"],
      entityNames: ["TAVONEL"],
      languages: ["en"],
      temporalRefs: ["2026"],
      retrievalTerms: ["tavonel", "board", "approved", "security", "policy", "august", "2026"],
    },
  ];
  return {
    collectionId,
    manifestDigest,
    package: {
      files: [
        {
          path: "rag/chunks.jsonl",
          content: `${rows.map(row => JSON.stringify(row)).join("\n")}\n`,
        },
      ],
    },
  };
}

describe("active-world grounded Ask", () => {
  it("retrieves Korean evidence with exact page and region citations", () => {
    const result = answerGroundedQuestion(
      artifact(),
      "분기 매출은 얼마인가요?"
    );
    expect(result?.status).toBe("grounded");
    expect(result?.citations[0]).toEqual(
      expect.objectContaining({
        evidenceId: "evidence-1",
        pageNumber1: 2,
        bbox1000: [100, 200, 900, 300],
        authority: "official",
      })
    );
    expect(result?.receipt.outputSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result?.receipt.retrieval).toBe("adaptive-multilingual-region-v2");
    expect(result?.citations[0].claimIds).toEqual(["claim-semantic-1"]);
  });

  it("retrieves English evidence without allowing prompt text to create a citation", () => {
    const result = answerGroundedQuestion(
      artifact(),
      "When was the 2026 security policy approved?"
    );
    expect(result?.status).toBe("grounded");
    expect(result?.citations[0].sourceId).toBe("source-2");
    expect(result?.answer).toContain("August 2026");
    expect(result?.citations[0].relevanceBreakdown.temporal).toBe(1);
    expect(result?.citations[0].authorityTier).toBe("official");
  });

  it("uses multilingual expansion and entity graph without inventing new evidence", () => {
    const translated = answerGroundedQuestion(artifact(), "revenue increase");
    expect(translated?.citations[0].sourceId).toBe("source-1");
    expect(translated?.citations[0].relevanceBreakdown.lexical).toBeGreaterThan(0);

    const entity = answerGroundedQuestion(artifact(), "TAVONEL");
    expect(entity?.citations[0].sourceId).toBe("source-2");
    expect(entity?.citations[0].relevanceBreakdown.graph).toBe(1);
    expect(entity?.citations[0].entityIds).toEqual(["entity-tavonel"]);
  });

  it("uses authority only as a tie-breaker, never as evidence eligibility", () => {
    const tied = artifact();
    const rows = tied.package.files[0].content.trim().split("\n").map(row => JSON.parse(row));
    rows.push({
      ...rows[1],
      chunkId: "chunk-0",
      logicalId: "claim-0",
      sourceId: "source-informal",
      sourceVersionId: "version-informal",
      evidenceId: "evidence-informal",
      authority: "informal",
      authorityTier: "informal",
      authorityScore: 0.4,
      claimIds: ["claim-semantic-informal"],
    });
    tied.package.files[0].content = `${rows.map(row => JSON.stringify(row)).join("\n")}\n`;
    const result = answerGroundedQuestion(tied, "security policy");
    expect(result?.citations[0].sourceId).toBe("source-2");
    expect(answerGroundedQuestion(tied, "quantum gravity")?.status).toBe("abstained");
  });

  it("abstains when no region-bound evidence matches", () => {
    const result = answerGroundedQuestion(artifact(), "양자 중력 실험 결과");
    expect(result).toEqual(
      expect.objectContaining({
        status: "abstained",
        reason: "NO_REGION_BOUND_EVIDENCE_MATCH",
        citations: [],
      })
    );
  });

  it("rejects a chunk whose bbox is missing instead of inventing a citation", () => {
    const invalid = artifact();
    invalid.package.files[0].content = `${JSON.stringify({ chunkId: "chunk-1", logicalId: "claim-1", text: "Revenue increased.", sourceId: "source-1", sourceVersionId: "version-1", evidenceId: "evidence-1", pageNumber1: 1, authority: "official" })}\n`;
    expect(answerGroundedQuestion(invalid, "revenue increase")).toBeNull();
  });
});
