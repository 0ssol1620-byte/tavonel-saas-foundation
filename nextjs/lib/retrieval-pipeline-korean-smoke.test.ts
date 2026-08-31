import { describe, expect, it } from "vitest";
import { expandedTokens } from "./lexical-tokens";
import { reciprocalRankFusion, toRankedList, type RankedList } from "./rank-fusion";
import { rankByStructuralOverlap } from "./structure-search";
import { applyWorldGate, type ActiveWorldLookup } from "./world-gate";
import { buildContextPacket, type RankedRetrievalUnit } from "./context-packet";
import { generateGroundedAnswer, type GeneratorAdapter } from "./generator-adapter";

// End-to-end composition smoke test across the full non-GPU retrieval path (lexical ->
// structure -> RRF -> World Gate -> ContextPacket -> GeneratorAdapter with the citation
// guard) against a Korean/English/mixed-language corpus. Real dense retrieval needs the
// pinned RunPod embedder (see embedder-adapter-runpod.ts) and cannot run in this
// environment -- this test is honest about that boundary and only exercises the fusion
// sources that are pure logic: lexical (simulated, see simulateLexicalRank below) and
// structure (rankByStructuralOverlap, real production code).

// Postgres FTS itself is not executable here (no local Postgres/Docker). This function
// stands in for what a GIN-indexed search_vector @@ to_tsquery(...) match would return --
// "does the doc's precomputed search_tokens contain any of the query's expanded tokens" --
// using the SAME tokenizer (lexical-tokens.ts) real search_tokens are built from
// (0022_retrieval_lexical_search.sql). It is test-only scaffolding, not a second scorer
// shipped anywhere in production code.
function simulateLexicalRank(query: string, corpus: Array<{ id: string; searchTokens: string[] }>): RankedList {
  const queryTokens = new Set(expandedTokens(query));
  const scored = corpus
    .map((doc) => ({ id: doc.id, overlap: doc.searchTokens.filter((token) => queryTokens.has(token)).length }))
    .filter((doc) => doc.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || left.id.localeCompare(right.id));
  return toRankedList(scored.map((doc) => doc.id));
}

const DOC_A_KO = {
  id: "unit-a",
  text: "삼성전자는 이번 분기 매출이 크게 증가했다고 발표했다.",
  searchTokens: expandedTokens("삼성전자는 이번 분기 매출이 크게 증가했다고 발표했다."),
  claimIds: ["claim-a-revenue"],
  entityIds: ["entity-samsung"],
};
const DOC_B_EN = {
  id: "unit-b",
  text: "The contract may be terminated within a 30 day notice period.",
  searchTokens: expandedTokens("The contract may be terminated within a 30 day notice period."),
  claimIds: ["claim-b-termination"],
  entityIds: [],
};
const DOC_C_MIXED = {
  id: "unit-c",
  text: "Acme Corp의 매출(revenue)이 지난해 대비 20% 증가했습니다.",
  searchTokens: expandedTokens("Acme Corp의 매출(revenue)이 지난해 대비 20% 증가했습니다."),
  claimIds: ["claim-c-revenue"],
  entityIds: ["entity-acme"],
};
const DOC_D_IDENTIFIER = {
  id: "unit-d",
  text: "Invoice ID INV20260093 was issued on 2026-08-01.",
  searchTokens: expandedTokens("Invoice ID INV20260093 was issued on 2026-08-01."),
  claimIds: [],
  entityIds: [],
};

const CORPUS = [DOC_A_KO, DOC_B_EN, DOC_C_MIXED, DOC_D_IDENTIFIER];

describe("Korean/English/mixed retrieval smoke test (lexical + structure -> RRF)", () => {
  it("KO -> KO: a Korean question about revenue matches the Korean and mixed-language revenue documents", () => {
    const lexical = simulateLexicalRank("매출이 증가했나요?", CORPUS);
    expect(lexical.map((item) => item.id)).toEqual(expect.arrayContaining(["unit-a", "unit-c"]));
    expect(lexical.map((item) => item.id)).not.toContain("unit-b");
  });

  it("KO -> EN: a Korean question about contract termination matches the English contract document via synonym expansion", () => {
    const lexical = simulateLexicalRank("계약 해지 기간은?", CORPUS);
    expect(lexical.map((item) => item.id)).toContain("unit-b");
  });

  it("EN -> KO: an English question about revenue increase matches the Korean and mixed-language documents via synonym expansion", () => {
    const lexical = simulateLexicalRank("Did revenue increase?", CORPUS);
    expect(lexical.map((item) => item.id)).toEqual(expect.arrayContaining(["unit-a", "unit-c"]));
  });

  it("mixed query: a Korean+English mixed query matches the mixed-language document", () => {
    const lexical = simulateLexicalRank("Acme의 revenue 변화", CORPUS);
    expect(lexical.map((item) => item.id)).toContain("unit-c");
  });

  it("exact identifier: an invoice id matches only the document containing it, not the revenue documents", () => {
    const lexical = simulateLexicalRank("INV20260093", CORPUS);
    expect(lexical.map((item) => item.id)).toEqual(["unit-d"]);
  });

  it("KNOWN LIMITATION: a spaced-out Korean compound noun does not match its unspaced form in the corpus", () => {
    // "삼성전자" (no space) is what unit-a actually contains. A user query with a space
    // inserted mid-compound ("삼성 전자") tokenizes to two separate tokens that never equal
    // the single compound token in search_tokens -- this tokenizer does no compound
    // splitting/merging. Documenting this honestly as a gap for a future wave (a Korean
    // n-gram/morphological analyzer, or pg_bigm) rather than silently claiming it works.
    const lexical = simulateLexicalRank("삼성 전자", CORPUS);
    expect(lexical.map((item) => item.id)).not.toContain("unit-a");
  });

  it("composes lexical + structure through real RRF fusion, then the real World Gate and ContextPacket, for a Korean query", () => {
    const lexicalRanks = simulateLexicalRank("매출이 증가했나요?", CORPUS);
    const structureRanks = rankByStructuralOverlap(
      CORPUS.map((doc) => ({ unitId: doc.id, claimIds: doc.claimIds, entityIds: doc.entityIds })),
      { seedClaimIds: ["claim-a-revenue"], seedEntityIds: ["entity-samsung"] },
    );

    const fused = reciprocalRankFusion({ lexical: lexicalRanks, structure: structureRanks }, 60);
    expect(fused[0].id).toBe("unit-a"); // present in both lexical and structure lists

    const activeWorld: ActiveWorldLookup = () => "sha256:" + "a".repeat(64);
    const candidates = fused.map((item) => ({
      unitId: item.id,
      workspaceKey: "pilot-tenantone",
      collectionId: "collection-" + "a".repeat(32),
      worldManifestDigest: "sha256:" + "a".repeat(64),
      evidenceIds: [`evidence-${item.id}`],
    }));
    const gateResult = applyWorldGate("pilot-tenantone", candidates, activeWorld);
    expect(gateResult.eligible.map((item) => item.unitId)).toEqual(fused.map((item) => item.id));

    const corpusById = new Map(CORPUS.map((doc) => [doc.id, doc]));
    const units: RankedRetrievalUnit[] = gateResult.eligible.map((item) => {
      const doc = corpusById.get(item.unitId)!;
      return {
        unitId: item.unitId,
        text: doc.text,
        claimIds: doc.claimIds,
        entityIds: doc.entityIds,
        sourceVersionId: "sv-1",
        evidenceIds: item.evidenceIds,
        pageNumber1: 1,
        bbox1000: [0, 0, 100, 100],
        authority: "unclassified",
      };
    });
    const packet = buildContextPacket(units, {
      worldId: "collection-" + "a".repeat(32),
      worldVersion: "sha256:" + "a".repeat(64),
      retrievalProfile: "bge-m3-v1",
      question: "매출이 증가했나요?",
    });
    expect(packet.items.map((item) => item.unitId)).toContain("unit-a");

    const adapter: GeneratorAdapter = {
      identity: () => ({ provider: "openai", model: "gpt-5.6", revision: "rev-1" }),
      generate: async () => ({
        status: "ok",
        candidate: {
          answer: "예, 매출이 증가했습니다.",
          citations: [{ evidenceId: "evidence-unit-a", quote: "매출이 크게 증가했다" }],
        },
        receipt: {
          provider: "openai", model: "gpt-5.6", revision: "rev-1",
          inputDigest: "sha256:x", outputDigest: "sha256:y", durationMs: 5, timedOut: false,
        },
      }),
    };
    return generateGroundedAnswer(adapter, packet).then((outcome) => {
      expect(outcome.status).toBe("grounded");
    });
  });
});
