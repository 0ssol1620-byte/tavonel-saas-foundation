import { describe, expect, it } from "vitest";
import { exploreSampleArtifact } from "./explore-sample";
import evaluation from "./entity-extraction-eval.json";

/*
  What the entity extractor is actually worth, measured before anyone improves it.

  `entitiesFor` is a capitalised-token regex. That it is noisy was obvious from reading it; how
  noisy was not, and "obviously noisy" is not a number you can regress against. So this file
  fixes a baseline against a reviewed set, and the rule that goes with it is: the regex is not
  tuned. Tuning a heuristic against the one corpus you measured it on produces a heuristic that
  fits that corpus, and the improvement is unfalsifiable because the measurement moved with it.

  What the baseline says, on three real documents:

      precision 0.20   -- three real identifiers, twelve false ones
      recall    1.00   -- every gold entity was found

  Recall 1.0 is the least impressive true statement here. Every gold entity in this corpus is
  an uppercase alphanumeric identifier -- FP-200, CN-2026-03, PG-11 -- which is the easiest
  case a capitalisation heuristic can be handed. A corpus of person or organisation names would
  not behave like this, and nothing here claims otherwise.

  Limitations, stated because they bound every figure above:

  - Three documents, fifteen candidates. This is a reviewed precision set, not a benchmark.
  - The labels were made by the session that wrote the extractor's evaluation, not by an
    independent reviewer, and not blind. `docs/audit` conventions call that a weak label set.
  - Gold was drawn from the same corpus the extractor ran on, so recall measures "did it find
    what a reader can see", not "does it generalise".

  These numbers are therefore evidence that the output is low-confidence. They are not evidence
  that it is 20% good, and they are certainly not a benchmark row.
*/

type Candidate = { value: string; verdict: "true-entity" | "false-positive"; code?: string };

const CANDIDATES = evaluation.observed.candidates as Candidate[];
const GOLD = evaluation.corpus.gold.map((entry) => entry.value);
const TAXONOMY = new Set(evaluation.falsePositiveTaxonomy.map((entry) => entry.code));

/** The Entity labels the production compiler emitted for the /explore sample. */
function compiledEntities(): string[] {
  const files = (exploreSampleArtifact as unknown as {
    package: { files: Array<{ path: string; content: string }> };
  }).package.files;
  const model = JSON.parse(files.find((file) => file.path === "canonical/model.json")!.content) as {
    nodes: Array<{ kind: string; label: string }>;
  };
  return model.nodes.filter((node) => node.kind === "Entity").map((node) => node.label);
}

describe("the reviewed set describes the extractor that exists", () => {
  it("labels exactly the candidates the compiler produces", () => {
    /*
      The evaluation is only worth something while it is about the current extractor. If the
      regex changes and this file does not, the baseline below is measuring a program that no
      longer runs -- which is the failure mode of every checked-in benchmark.
    */
    expect([...compiledEntities()].sort()).toEqual([...CANDIDATES.map((c) => c.value)].sort());
  });

  it("gives every false positive a reason from the taxonomy", () => {
    for (const candidate of CANDIDATES) {
      if (candidate.verdict !== "false-positive") continue;
      expect(candidate.code, candidate.value).toBeTruthy();
      expect(TAXONOMY, candidate.value).toContain(candidate.code!);
    }
  });

  it("labels every gold entity as found", () => {
    for (const value of GOLD) {
      const candidate = CANDIDATES.find((entry) => entry.value === value);
      expect(candidate, `${value} is gold and unlabelled`).toBeTruthy();
      expect(candidate!.verdict).toBe("true-entity");
    }
  });
});

describe("the baseline", () => {
  const truePositives = CANDIDATES.filter((c) => c.verdict === "true-entity").length;
  const falsePositives = CANDIDATES.filter((c) => c.verdict === "false-positive").length;
  const precision = truePositives / CANDIDATES.length;
  const recall = GOLD.filter((value) =>
    CANDIDATES.some((c) => c.value === value && c.verdict === "true-entity")).length / GOLD.length;

  it("is what the recorded numbers say it is", () => {
    expect(CANDIDATES).toHaveLength(evaluation.baseline.candidates);
    expect(truePositives).toBe(evaluation.baseline.truePositives);
    expect(falsePositives).toBe(evaluation.baseline.falsePositives);
    expect(precision).toBeCloseTo(evaluation.baseline.precision, 5);
    expect(recall).toBeCloseTo(evaluation.baseline.recall, 5);
  });

  it("does not silently improve", () => {
    /*
      Deliberately an equality, not a floor.

      A floor would let someone tune the regex until this corpus goes green and call it an
      improvement. Any change to the extractor breaks this assertion and has to arrive with a
      re-measured set and a reviewer -- which is the only thing that makes "it got better"
      mean anything.

      It broke, and the number went down. Gap-matrix row D7-01 removed `entitiesFor`'s
      `.slice(0, 8)`, and the manual's ninth candidate -- MPa, a pressure unit -- appeared. The
      0.2 recorded on 2026-09-04 was measured through that cap, so it was a measurement of
      truncated output that reported the extractor as slightly better than it is. The regex did
      not change; what changed is that all of its output is now visible. The MPa label is
      recorded in the eval file as awaiting an independent reviewer.
    */
    expect(precision).toBe(0.1875);
  });
});

describe("what the extractor cannot do, recorded rather than fixed", () => {
  it("resolves an identifier across documents only by exact string", () => {
    // FP-200 is in all three documents and is one entity. That is the whole of the identity
    // logic: `stableId("entity", label.toLowerCase())`.
    const labels = compiledEntities();
    expect(labels.filter((label) => label === "FP-200")).toHaveLength(1);
    const exact = evaluation.identityCases.find((entry) => entry.code === "EXACT_STRING_ACROSS_DOCUMENTS");
    expect(exact!.holds).toBe(true);
  });

  it("does not resolve surface variants or cross-part occurrences", () => {
    for (const code of ["SURFACE_VARIANT", "CROSS_PART"]) {
      const entry = evaluation.identityCases.find((item) => item.code === code);
      expect(entry, code).toBeTruthy();
      expect(entry!.holds, `${code} is recorded as holding; nothing implements it`).toBe(false);
    }
  });

  it("has no defence against ordinary OCR noise", () => {
    /*
      Not a test of a fix. These three cases are what a scanner does to an identifier, and the
      extractor gets all three wrong in different ways -- a different entity, a truncated one,
      and silence. Written down so the next person does not discover them as a surprise.
    */
    expect(evaluation.ocrNoiseCases.length).toBeGreaterThanOrEqual(3);
    for (const item of evaluation.ocrNoiseCases) {
      expect(item.resolvesToGold, item.code).toBe(false);
    }
  });
});
