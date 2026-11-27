import { describe, expect, it } from "vitest";
import fixture from "../scripts/fixtures/extraction-loss.synthetic.inputs.json";
import {
  compileCollectionCandidate,
  compileCollectionCandidateWithLossReport,
  validateCollectionOcrInput,
  type CollectionOcrInput,
} from "./collection-compiler";
import {
  compareCountsToReadModel,
  coreV2LossReport,
  EXTRACTION_LOSS_REPORT_FLAG,
  extractionLossReportEnabled,
} from "./extraction-loss-report";

const INPUTS = (fixture as unknown[]).map((raw) => validateCollectionOcrInput(raw)) as CollectionOcrInput[];

describe("extraction loss report flag", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(extractionLossReportEnabled({})).toBe(false);
    expect(extractionLossReportEnabled({ [EXTRACTION_LOSS_REPORT_FLAG]: "true" })).toBe(false);
    expect(extractionLossReportEnabled({ [EXTRACTION_LOSS_REPORT_FLAG]: "0" })).toBe(false);
    expect(extractionLossReportEnabled({ [EXTRACTION_LOSS_REPORT_FLAG]: "1" })).toBe(true);
  });
});

describe("the report never changes what compiles", () => {
  it("fixture inputs are valid", () => {
    expect(INPUTS.every((item) => item !== null)).toBe(true);
  });

  it("flag-off and collecting compiles return byte-identical artifacts", () => {
    const plain = compileCollectionCandidate(INPUTS);
    const withReport = compileCollectionCandidateWithLossReport(INPUTS).artifact;
    expect(JSON.stringify(withReport)).toBe(JSON.stringify(plain));
    expect(withReport.manifestDigest).toBe(plain.manifestDigest);
  });

  it("keeps the report out of the artifact, so no customer-facing JSON can carry it", () => {
    const { artifact } = compileCollectionCandidateWithLossReport(INPUTS);
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain("extraction_loss");
    expect(serialized).not.toContain("claimFilter");
    expect(serialized).not.toContain("notMeasured");
  });
});

describe("a known entity lost at the claim filter shows up in the counters", () => {
  const { artifact, report } = compileCollectionCandidateWithLossReport(INPUTS);

  it("counts the excluded piece with a short reason, not its text", () => {
    // "Acme Holdings Ltd." is 18 characters: below the 20-character claim floor.
    expect(report.claimFilter?.reasons.below_min_length).toBeGreaterThanOrEqual(1);
    expect(report.claimFilter?.reasons.above_max_length).toBe(1);
    expect(JSON.stringify(report)).not.toContain("Acme");
    expect(JSON.stringify(report)).not.toContain("Northwind");
  });

  it("shows the mention that only a claim-gated extractor would lose", () => {
    expect(report.mentions?.inClaimExcludedPieces).toBeGreaterThanOrEqual(1);
    // The fallback reads entities from the whole region, so the entity itself survives here.
    const model = JSON.parse(artifact.package.files.find((file) => file.path === "canonical/model.json")!.content) as {
      nodes: Array<{ kind: string; label: string }>;
    };
    const claims = model.nodes.filter((node) => node.kind === "Claim").map((node) => node.label);
    expect(model.nodes.some((node) => node.kind === "Entity" && node.label.startsWith("Acme Holdings"))).toBe(true);
    expect(claims.some((label) => label.startsWith("Acme Holdings Ltd"))).toBe(false);
  });

  it("conserves every stage: nothing leaves without being counted", () => {
    const filter = report.claimFilter!;
    expect(report.sentenceSplit!.piecesSplit).toBe(filter.allowed + filter.excluded);
    const dedup = report.dedup!;
    expect(dedup.claims.distinct - dedup.claims.droppedByBudget).toBe(report.stored.claims);
    expect(dedup.entities.newObjects).toBe(report.stored.entities);
    expect(report.grounding!.regionsAnchored).toBe(report.read.regionsRead);
    expect(report.read.regionsByBlockType).toEqual({ paragraph: report.read.regionsRead });
    // Allowed pieces become claims or are dropped as duplicates; budget drops follow distinct claims.
    expect(filter.allowed - dedup.claims.duplicateInDocument).toBe(dedup.claims.distinct);
  });

  it("reports an entity seen in two documents as merged, not new", () => {
    expect(report.dedup!.entities.mergedIntoExisting).toBeGreaterThanOrEqual(1);
    expect(report.dedup!.entities.held).toBeNull();
  });
});

describe("not measured is null, never 0", () => {
  const report = coreV2LossReport(INPUTS, {
    documents: 2, entities: 8, claims: 16, topics: null, evidence: 4, relations: 9,
  });

  it("leaves every Core funnel stage null and names them", () => {
    expect(report.engine).toBe("core_v2");
    expect(report.sentenceSplit).toBeNull();
    expect(report.claimFilter).toBeNull();
    expect(report.mentions).toBeNull();
    expect(report.grounding).toBeNull();
    expect(report.dedup).toBeNull();
    expect(report.notMeasured).toEqual({
      stages: ["sentenceSplit", "claimFilter", "mentions", "grounding", "dedup"],
      reason: "core_funnel_not_reported",
    });
  });

  it("keeps topics null, reads regions from the inputs and the stored counts as given", () => {
    expect(report.stored.topics).toBeNull();
    expect(report.stored.entities).toBe(8);
    expect(report.read.regionsRead).toBe(4);
    expect(report.countEquality).toEqual({ checked: false, agree: null, mismatches: [] });
  });
});

describe("UI-vs-API count equality", () => {
  const counts = { documents: 1, entities: 2, claims: 1, topics: null, evidence: 1, relations: 0 };
  const objects = [
    { type: "Document" }, { type: "Entity" }, { type: "Entity" }, { type: "Claim" }, { type: "Evidence" },
  ];

  it("agrees when the read model exposes the same objects; a null topic count is not compared", () => {
    expect(compareCountsToReadModel(counts, objects)).toEqual({ checked: true, agree: true, mismatches: [] });
  });

  it("names the kind that disagrees", () => {
    const result = compareCountsToReadModel(counts, objects.filter((object, index) => index !== 2));
    expect(result).toEqual({ checked: true, agree: false, mismatches: [{ kind: "entities", artifact: 2, readModel: 1 }] });
  });
});
