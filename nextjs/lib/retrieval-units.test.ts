import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput, type CollectionOcrRegion } from "./collection-compiler";
import { compileRetrievalUnits } from "./retrieval-units";

function baseInput(documentId: string, versionKey: string, text: string): CollectionOcrInput {
  const sanitizedKey = `immutable/pilot-proof/pilot-proof/${documentId}/${versionKey}/sanitized.pdf`;
  return {
    documentId, versionKey, sanitizedKey,
    ocrJsonKey: `immutable/pilot-proof/pilot-proof/${documentId}/${versionKey}/ocr.json`,
    pageCount: 1, text,
    inputSha256: `sha256:${versionKey}`,
    sourceImmutableKey: sanitizedKey,
  };
}

function buildCandidate() {
  const financeRegions: CollectionOcrRegion[] = [
    {
      regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
      text: "Quarterly financial revenue increased significantly across the fiscal year.",
      bbox1000: [100, 100, 900, 300], confidence: 1, authority: "official",
    },
    {
      regionId: "native-p0002", pageIndex0: 1, pageNumber1: 2, order: 1, blockType: "paragraph",
      text: "The Board approved the governance compliance policy for the organization.",
      bbox1000: [100, 400, 900, 600], confidence: 1, authority: "informal",
    },
  ];
  const financeInput: CollectionOcrInput = {
    ...baseInput("doc-finance-regions", "d".repeat(64), financeRegions.map((r) => r.text).join("\n")),
    pageCount: 2,
    regions: financeRegions,
  };
  const securityInput = baseInput("doc-security-noregions", "e".repeat(64), "Security access control protects private research evidence.");
  return compileCollectionCandidate([financeInput, securityInput]);
}

describe("compileRetrievalUnits", () => {
  it("compiles one SectionView unit per OCR region and none for a region-less document", () => {
    const { units } = compileRetrievalUnits(buildCandidate(), ["section"]);
    expect(units).toHaveLength(2);
    expect(units.every((unit) => unit.unitType === "section")).toBe(true);
    expect(units.every((unit) => unit.documentId === "doc-finance-regions")).toBe(true);
    expect(units.map((unit) => unit.pageNumber1).sort()).toEqual([1, 2]);
    expect(units.every((unit) => unit.contentDigest.startsWith("sha256:"))).toBe(true);
  });

  it("compiles ClaimView units carrying the exact claim sentence, linked to co-occurring entities", () => {
    const { units } = compileRetrievalUnits(buildCandidate(), ["claim"]);
    expect(units).toHaveLength(2);
    const boardClaim = units.find((unit) => unit.text.startsWith("The Board approved"));
    expect(boardClaim).toBeDefined();
    expect(boardClaim!.pageNumber1).toBe(2);
    expect(boardClaim!.bbox1000).toEqual([100, 400, 900, 600]);
    expect(boardClaim!.entityIds).toHaveLength(1);

    const revenueClaim = units.find((unit) => unit.text.startsWith("Quarterly financial"));
    expect(revenueClaim).toBeDefined();
    expect(revenueClaim!.pageNumber1).toBe(1);
    expect(revenueClaim!.entityIds).toHaveLength(1);
    expect(boardClaim!.entityIds).not.toEqual(revenueClaim!.entityIds);
  });

  it("compiles EntityView units per mention, cross-linked back to claims mentioning that entity", () => {
    const { units } = compileRetrievalUnits(buildCandidate(), ["entity"]);
    expect(units).toHaveLength(2);
    expect(units.map((unit) => unit.text).sort()).toEqual(["Quarterly", "The Board"]);
    for (const unit of units) {
      expect(unit.claimIds).toHaveLength(1);
      expect(unit.evidenceIds).toHaveLength(1);
    }
  });

  it("reports table/event/graph_neighborhood/summary as skipped rather than silently empty", () => {
    const { units, skippedViews } = compileRetrievalUnits(buildCandidate(), ["section", "table", "event"]);
    expect(units.every((unit) => unit.unitType === "section")).toBe(true);
    expect(skippedViews.sort()).toEqual(["event", "table"]);
  });

  it("produces the same units on a repeat compile from the same candidate (deterministic rebuild)", () => {
    const candidate = buildCandidate();
    const first = compileRetrievalUnits(candidate, ["section", "claim", "entity"]);
    const second = compileRetrievalUnits(candidate, ["section", "claim", "entity"]);
    expect(first).toEqual(second);
  });

  it("degrades gracefully on Korean text: SectionView/ClaimView still ground, EntityView stays empty rather than mis-detecting", () => {
    // entitiesFor()'s capitalized-Latin-run regex cannot see Korean script at all — that
    // is a pre-existing collection-compiler.ts limitation (Wave 3's model-backed
    // extractor is the real fix), not something this compiler should paper over with a
    // fabricated entity match. What must not regress is section/claim grounding itself.
    const koreanRegions: CollectionOcrRegion[] = [
      {
        regionId: "native-p0001", pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph",
        text: "삼성전자는 이번 분기 매출이 크게 증가했다고 발표했다.",
        bbox1000: [100, 100, 900, 300], confidence: 1, authority: "official",
      },
    ];
    const koreanInput: CollectionOcrInput = {
      ...baseInput("doc-korean-regions", "f".repeat(64), koreanRegions.map((r) => r.text).join("\n")),
      pageCount: 1,
      regions: koreanRegions,
    };
    const other = baseInput("doc-korean-other", "0".repeat(64), "Unrelated filler document text for cardinality.");
    const candidate = compileCollectionCandidate([koreanInput, other]);

    const sections = compileRetrievalUnits(candidate, ["section"]);
    expect(sections.units).toHaveLength(1);
    expect(sections.units[0].text).toBe("삼성전자는 이번 분기 매출이 크게 증가했다고 발표했다.");
    expect(sections.units[0].pageNumber1).toBe(1);
    expect(sections.units[0].bbox1000).toEqual([100, 100, 900, 300]);

    const claims = compileRetrievalUnits(candidate, ["claim"]);
    expect(claims.units).toHaveLength(1);
    expect(claims.units[0].text).toBe("삼성전자는 이번 분기 매출이 크게 증가했다고 발표했다.");
    expect(claims.units[0].entityIds).toEqual([]);

    const entities = compileRetrievalUnits(candidate, ["entity"]);
    expect(entities.units).toEqual([]);
  });
});
