import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  answerGroundedQuestion,
  EVIDENCE_EXCEEDS_ANSWER_LIMIT,
  FALLBACK_ANSWER_CHARACTER_LIMIT,
  type GroundedAnswer,
} from "./grounded-ask";

const collectionId = "collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const manifestDigest = `sha256:${"b".repeat(64)}`;

// The qualifier, the following-sentence exception, the Korean negation, unit and date all sit
// past character 417 -- exactly what the old 417-character answer cut off.
const LEAD = `Renewal notice applies${" to every supplier contract".repeat(15)}`;
const RAW = `${LEAD}, except where the buyer waives notice in writing.\n\n   The 30-day rule does not apply to renewals signed after 2027-01-01.\n이 조항은 2026년 3월 31일 이후 체결된 계약에는 적용되지 않으며, 위약금은 120억원입니다.`;
const FULL = RAW.replace(/\s+/g, " ").trim();

function row(chunkId: string, text: string) {
  return {
    chunkId,
    logicalId: `logical-${chunkId}`,
    text,
    sourceId: `source-${chunkId}`,
    sourceVersionId: `version-${chunkId}`,
    evidenceId: `evidence-${chunkId}`,
    pageNumber1: 7,
    bbox1000: [50, 60, 950, 400],
    authority: "official",
    authorityTier: "official",
    authorityScore: 1,
    claimIds: [`claim-${chunkId}`],
    entityIds: [],
    entityNames: [],
    languages: ["en"],
    temporalRefs: [],
    retrievalTerms: ["renewal", "clause"],
  };
}

function artifactOf(rows: ReturnType<typeof row>[]) {
  return {
    collectionId,
    manifestDigest,
    package: { files: [{ path: "rag/chunks.jsonl", content: `${rows.map(item => JSON.stringify(item)).join("\n")}\n` }] },
  };
}

// Exactly `length` normalized characters with the same token set, so equal-scored chunks tie
// and keep chunkId order -- the ranking itself is not what these tests move.
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

function expectedSha({ receipt: _receipt, ...unsigned }: GroundedAnswer) {
  return `sha256:${createHash("sha256").update(canonical(unsigned)).digest("hex")}`;
}

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

  // WO-ASK-0: these cases used to abstain with EVIDENCE_EXCEEDS_ANSWER_LIMIT. The lead ruling
  // replaced that rule: each cited region contributes a verbatim window, and the answer marks a cut.
  it("answers a long region with a verbatim window that holds the question's words, cut edges marked", () => {
    expect(FULL.indexOf("except where the buyer")).toBeGreaterThan(417);
    const result = answerGroundedQuestion(artifactOf([row("chunk-a", RAW)]), "renewal notice");
    expect(result?.status).toBe("grounded");
    expect(result?.reason).toBeNull();
    const citation = result!.citations[0]!;
    expect(RAW.slice(citation.window.start, citation.window.end)).toBe(citation.excerpt);
    expect(citation.window.regionLength).toBe(RAW.length);
    expect(citation.excerpt.length).toBeLessThanOrEqual(416);
    expect(citation.excerpt.startsWith("Renewal notice applies")).toBe(true);
    // The region continues past the window, so the answer says so in-band.
    expect(result?.answer).toBe(`${citation.excerpt} …`);
    expect(result?.receipt.outputSha256).toBe(expectedSha(result!));
  });

  it("changes the answer and receipt when text inside the window changes, and keeps the citation when text outside it does", () => {
    const before = answerGroundedQuestion(artifactOf([row("chunk-a", RAW)]), "renewal notice");
    const inside = answerGroundedQuestion(artifactOf([row("chunk-a", RAW.replace("every supplier", "every vendors"))]), "renewal notice");
    const outside = answerGroundedQuestion(artifactOf([row("chunk-a", RAW.replace("120억원", "130억원"))]), "renewal notice");
    expect(inside?.answer).not.toBe(before?.answer);
    expect(inside?.receipt.outputSha256).not.toBe(before?.receipt.outputSha256);
    expect(outside?.citations[0].excerpt).toBe(before?.citations[0].excerpt);
    expect(outside?.answer.endsWith(" …")).toBe(true);
  });

  it("answers within the fallback envelope however long the evidence, keeping every citation and its metadata in order", () => {
    expect(FALLBACK_ANSWER_CHARACTER_LIMIT).toBe(1264);
    for (const sizes of [[1264], [1265], [800, 462], [800, 463], [60, 90, 1200], [420, 420, 421]]) {
      const ids = sizes.map((_, index) => `chunk-${"abc"[index]}`);
      const texts = sizes.map(sized);
      const result = answerGroundedQuestion(artifactOf(ids.map((id, index) => row(id, texts[index]!))), "renewal clause");
      expect(result?.status, String(sizes)).toBe("grounded");
      expect(result?.reason, String(sizes)).toBeNull();
      expect(result?.answer.length, String(sizes)).toBeLessThanOrEqual(FALLBACK_ANSWER_CHARACTER_LIMIT);
      expect(result?.citations.map(citation => citation.evidenceId), String(sizes)).toEqual(ids.map(id => `evidence-${id}`));
      result!.citations.forEach((citation, index) => {
        expect(texts[index]!.slice(citation.window.start, citation.window.end)).toBe(citation.excerpt);
        expect(citation.excerpt.length).toBeLessThanOrEqual(416);
      });
      expect(result?.receipt.outputSha256).toBe(expectedSha(result!));
    }
    const long = answerGroundedQuestion(artifactOf([row("chunk-a", sized(60)), row("chunk-b", sized(90)), row("chunk-c", sized(1200))]), "renewal clause");
    expect(long?.citations[2]).toMatchObject({
      sourceId: "source-chunk-c",
      sourceVersionId: "version-chunk-c",
      pageNumber1: 7,
      bbox1000: [50, 60, 950, 400],
      authority: "official",
      claimIds: ["claim-chunk-c"],
    });
  });

  it("keeps a region that fits whole, verbatim, with no cut marker", () => {
    const text = "Renewal clause applies.\n\n   Notice is 30 days.";
    const result = answerGroundedQuestion(artifactOf([row("chunk-a", text)]), "renewal clause");
    expect(result?.citations[0].excerpt).toBe(text);
    expect(result?.answer).toBe(text);
  });

  it("keeps the no-match abstention, and never produces the retired overflow reason", () => {
    const result = answerGroundedQuestion(artifactOf([row("chunk-a", sized(5000))]), "양자 중력 실험 결과");
    expect(result).toMatchObject({ status: "abstained", answer: "", reason: "NO_REGION_BOUND_EVIDENCE_MATCH", citations: [] });
    expect(answerGroundedQuestion(artifactOf([row("chunk-a", sized(5000))]), "renewal clause")?.reason).not.toBe(EVIDENCE_EXCEEDS_ANSWER_LIMIT);
  });
});
