import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASELINE_MODEL_ID,
  deriveBaselineSchema,
  inputsDigest,
  MAX_CLASSES,
  MAX_PROPERTIES,
  verifiedEvidence,
  type EvidenceUnit,
} from "./ontology-derivation";

const unit = (evidenceId: string, text: string, documentId = "doc-a", page = 1): EvidenceUnit =>
  ({ evidenceId, documentId, page, bbox: [10, 20, 900, 80], text });

const UNITS: EvidenceUnit[] = [
  unit("e1", "Apple Inc. is listed on The Nasdaq Stock Market and reports to the Securities Exchange Commission."),
  unit("e2", "Contoso Holdings Inc. is listed on The London Stock Market under the symbol CNT."),
  unit("e3", "Fabrikam Industries Inc. is listed on The Tokyo Stock Market since the spin-off.", "doc-b", 2),
  unit("e4", "The Securities Exchange Act and the Investment Company Act apply; the Sarbanes Oxley Act also applies."),
];

/* The repository's public SEC sample: five Apple filings, their text-layer regions with page and box. */
const SEC_UNITS: EvidenceUnit[] = (JSON.parse(readFileSync(resolve(import.meta.dirname, "explore-sample.w4.inputs.json"), "utf8")) as Array<{
  documentId: string; regions: Array<{ regionId: string; pageNumber1: number; bbox1000: [number, number, number, number]; text: string }>;
}>).flatMap((filing) => filing.regions.filter((region) => region.text.trim().length > 0).map((region) => ({
  evidenceId: region.regionId, documentId: filing.documentId, page: region.pageNumber1, bbox: region.bbox1000, text: region.text,
})));

describe("deterministic baseline deriver", () => {
  it("proposes a class for a head word with three distinct names and a property for a repeated joining phrase", () => {
    const { candidates, receipt } = deriveBaselineSchema(UNITS);
    const keys = candidates.map((candidate) => `${candidate.kind}:${candidate.key}`);
    expect(keys).toContain("class:market");
    expect(keys).toContain("class:organization");
    expect(keys).toContain("class:act");
    expect(keys).toContain("property:organization_listed_on_market");
    const property = candidates.find((candidate) => candidate.key === "organization_listed_on_market")!;
    expect([property.domainKey, property.rangeKey, property.label]).toEqual(["organization", "market", "listed on"]);
    expect(receipt).toMatchObject({ deriver: "baseline", modelId: BASELINE_MODEL_ID, promptSha256: null, priceSnapshot: { usd: 0 } });
  });

  it("binds every quote verbatim to its unit, page and box, and never carries a state", () => {
    const { candidates } = deriveBaselineSchema(UNITS);
    const index = new Map(UNITS.map((item) => [item.evidenceId, item]));
    for (const candidate of candidates) {
      expect(candidate.evidence.length).toBeGreaterThan(0);
      expect(verifiedEvidence(candidate.evidence, index)).toEqual(candidate.evidence);
      expect(candidate).not.toHaveProperty("state");
    }
  });

  it("is deterministic and does not depend on input order", () => {
    const first = deriveBaselineSchema(UNITS);
    const second = deriveBaselineSchema([...UNITS].reverse());
    expect(second.receiptSha256).toBe(first.receiptSha256);
    expect(first.receipt.inputsSha256).toBe(inputsDigest(UNITS));
  });

  it("proposes nothing from evidence that names nothing, rather than inventing a type", () => {
    const { candidates, receipt } = deriveBaselineSchema([unit("e1", "the quarter ended with lower costs and higher margins.")]);
    expect(candidates).toEqual([]);
    expect([receipt.classes, receipt.properties]).toEqual([0, 0]);
  });

  it("on the public SEC sample: within the caps, every evidence item verbatim, byte-identical twice", () => {
    const first = deriveBaselineSchema(SEC_UNITS);
    const second = deriveBaselineSchema([...SEC_UNITS].reverse());
    const index = new Map(SEC_UNITS.map((item) => [item.evidenceId, item]));
    expect(first.receipt.documents).toBe(5);
    expect(first.receipt.classes).toBeLessThanOrEqual(MAX_CLASSES);
    expect(first.receipt.properties).toBeLessThanOrEqual(MAX_PROPERTIES);
    expect(first.receipt.classes).toBeGreaterThan(0);
    const evidence = first.candidates.flatMap((candidate) => candidate.evidence);
    expect(first.candidates.reduce((sum, candidate) => sum + verifiedEvidence(candidate.evidence, index).length, 0)).toBe(evidence.length);
    expect(second.receiptSha256).toBe(first.receiptSha256);
  });
});

describe("verbatim evidence check", () => {
  const index = new Map(UNITS.map((item) => [item.evidenceId, item]));
  const good = { evidenceId: "e1", documentId: "doc-a", page: 1, bbox: [10, 20, 900, 80] as [number, number, number, number], quote: "Apple Inc." };

  it("drops a quote that is not in the unit, a wrong page, a wrong box, a wrong document and an unknown unit", () => {
    expect(verifiedEvidence([good], index)).toEqual([good]);
    for (const bad of [
      { ...good, quote: "Apple Incorporated" },
      { ...good, page: 2 },
      { ...good, bbox: [10, 20, 900, 81] as [number, number, number, number] },
      { ...good, documentId: "doc-b" },
      { ...good, evidenceId: "e9" },
      { ...good, quote: "" },
    ]) expect(verifiedEvidence([bad], index)).toEqual([]);
  });
});

describe("Arena script (scripts/ontology-derivation-arena.mjs)", () => {
  it("runs the baseline arm on the SEC sample: deterministic, all evidence verbatim, model arm NOT_RUN without a receipt", () => {
    const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/ontology-derivation-arena.mjs"],
      { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" });
    const summary = JSON.parse(out) as { deterministic: boolean; modelArm: string;
      baseline: { evidenceItems: number; evidenceValid: number; typeRecall: string; promptSha256: null } };
    expect(summary.deterministic).toBe(true);
    expect(summary.baseline.evidenceValid).toBe(summary.baseline.evidenceItems);
    expect(summary.baseline.promptSha256).toBeNull();
    expect(summary.baseline.typeRecall).toMatch(/^NOT_MEASURED/);
    expect(summary.modelArm).toMatch(/^NOT_RUN/);
  }, 60_000);
});
