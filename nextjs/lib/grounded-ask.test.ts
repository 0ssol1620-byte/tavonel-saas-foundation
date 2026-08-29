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
    },
    {
      chunkId: "chunk-2",
      logicalId: "claim-2",
      text: "The board approved the security policy in August 2026.",
      sourceId: "source-2",
      sourceVersionId: "version-2",
      evidenceId: "evidence-2",
      pageNumber1: 4,
      bbox1000: [120, 220, 880, 360],
      authority: "contractual",
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
  });

  it("retrieves English evidence without allowing prompt text to create a citation", () => {
    const result = answerGroundedQuestion(
      artifact(),
      "When was the security policy approved?"
    );
    expect(result?.status).toBe("grounded");
    expect(result?.citations[0].sourceId).toBe("source-2");
    expect(result?.answer).toContain("August 2026");
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
