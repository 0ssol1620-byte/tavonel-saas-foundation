import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_FAMILIES,
  NORTH_STAR,
  RECEIPT_FIELDS,
  qualifiedBenchmarkRecords,
  readBenchmarkRecords,
  validateBenchmarkReceipt,
  type BenchmarkReceipt,
} from "./benchmark-registry";

/**
 * The benchmark registry, and the page that publishes its protocol.
 *
 * `/benchmarks` is the one public surface on this site whose entire job is to describe how a
 * number would have to be produced before it may be shown. That makes two failure modes worth a
 * test each: the validator quietly accepting an incomplete record, and the page describing a
 * protocol the validator does not actually enforce.
 */

/*
  A complete record, in the shape a real one takes and with nothing measured.

  Every digest here is a run of one hex character. That is deliberate and load-bearing: this
  object exists to exercise the *shape* check, it is never rendered, and if it were ever pasted
  into benchmark-registry.records.json the digests would not resolve to any bytes anyone holds.
  The last test in this file asserts it is not in that file.
*/
const SHAPE_FIXTURE: BenchmarkReceipt = {
  datasetName: "FIXTURE-ONLY shape record",
  datasetVersion: "0",
  corpusDigest: `sha256:${"a".repeat(64)}`,
  denominator: { population: "fixture pages", count: 3 },
  modelId: "fixture-model",
  modelRevision: "fixture-revision",
  inputMode: "page image",
  promptDigest: `sha256:${"b".repeat(64)}`,
  configDigest: `sha256:${"c".repeat(64)}`,
  compilerVersion: "fixture-compiler",
  hardware: "fixture host",
  gpu: "none",
  runtime: "fixture runtime",
  priceSnapshot: "fixture price list",
  rawResultDigest: `sha256:${"d".repeat(64)}`,
  worldDigest: `sha256:${"e".repeat(64)}`,
  runReceiptDigest: `sha256:${"f".repeat(64)}`,
  date: "2026-09-05",
  metrics: [
    { family: "evidence", name: "evidence coverage", value: 1, unit: "ratio", denominator: { population: "fixture claims", count: 2 } },
  ],
  comparisonBasis: "same_condition",
  publishedFailures: [{ label: "Fixture", detail: "This record measures nothing." }],
};

/** The fixture minus one key, as plain data the validator has to reject. */
function without(key: string): unknown {
  const copy: Record<string, unknown> = { ...SHAPE_FIXTURE };
  delete copy[key];
  return copy;
}

function withOverride(patch: Record<string, unknown>): unknown {
  return { ...SHAPE_FIXTURE, ...patch };
}

function problemsOf(candidate: unknown, presentation?: "result" | "quotation"): string[] {
  const result = validateBenchmarkReceipt(candidate, presentation);
  return result.ok ? [] : result.problems;
}

describe("benchmark receipt validation", () => {
  it("accepts a record that carries every field", () => {
    const result = validateBenchmarkReceipt(SHAPE_FIXTURE);
    expect(result.ok ? null : result.problems).toBeNull();
  });

  it("rejects a record missing any one of its six digests", () => {
    const digestFields = RECEIPT_FIELDS.filter((field) => field.kind === "digest").map((field) => field.key);
    expect(digestFields).toEqual([
      "corpusDigest",
      "promptDigest",
      "configDigest",
      "rawResultDigest",
      "worldDigest",
      "runReceiptDigest",
    ]);
    for (const field of digestFields) {
      expect(problemsOf(without(field)), `${field} may not be optional`).toContain(`${field} is not a sha256 digest`);
    }
  });

  it("rejects a description written where a digest belongs", () => {
    expect(problemsOf(withOverride({ corpusDigest: "the same corpus as last time" })))
      .toContain("corpusDigest is not a sha256 digest");
    // Right length, wrong algorithm label, and an uppercase hex tail: all three are refused,
    // because "sha256:" is the form every other digest on this site is published in.
    expect(problemsOf(withOverride({ worldDigest: `md5:${"a".repeat(64)}` })))
      .toContain("worldDigest is not a sha256 digest");
    expect(problemsOf(withOverride({ worldDigest: `sha256:${"A".repeat(64)}` })))
      .toContain("worldDigest is not a sha256 digest");
  });

  it("rejects a rate with no population behind it", () => {
    expect(problemsOf(without("denominator"))).toContain("denominator is missing");
    expect(problemsOf(withOverride({ denominator: { population: "documents" } })))
      .toContain("denominator has no positive integer count");
    expect(problemsOf(withOverride({ denominator: { count: 1797 } })))
      .toContain("denominator does not name the population it was measured over");
    expect(problemsOf(withOverride({ denominator: { population: "documents", count: 0 } })))
      .toContain("denominator has no positive integer count");
  });

  it("rejects a metric that carries no denominator of its own", () => {
    const metrics = [{ family: "identity", name: "false merge", value: 0.01, unit: "rate" }];
    expect(problemsOf(withOverride({ metrics }))).toContain("metrics[0].denominator is missing");
  });

  it("rejects a metric whose family is not one of the eight", () => {
    const metrics = [{ ...SHAPE_FIXTURE.metrics[0], family: "vibes" }];
    expect(problemsOf(withOverride({ metrics })))
      .toContain('metrics[0] declares family "vibes", which is not one of the eight families');
  });

  it("rejects a record that reports nothing", () => {
    expect(problemsOf(withOverride({ metrics: [] }))).toContain("metrics is empty, so the record reports nothing");
    expect(problemsOf(without("metrics"))).toContain("metrics is missing");
  });

  it("refuses to present somebody else's published score as a result", () => {
    const quoted = withOverride({ comparisonBasis: "quoted", quotedSource: "Vendor leaderboard, 2026-01-01" });
    expect(problemsOf(quoted, "result"))
      .toContain("a quoted score is somebody else's measurement and cannot be presented as a result");
    // The same record is a legitimate quotation, so the refusal is about the role, not the record.
    expect(problemsOf(quoted, "quotation")).toEqual([]);
  });

  it("refuses a quotation that does not say whose number it is", () => {
    expect(problemsOf(withOverride({ comparisonBasis: "quoted" }), "quotation"))
      .toContain("a quoted score must name whose it is and where they published it");
  });

  it("refuses to dress a run of our own up as a quotation", () => {
    expect(problemsOf(SHAPE_FIXTURE, "quotation")).toContain("a run we executed is a result, not a quotation");
  });

  it("rejects a comparison basis it does not recognise", () => {
    expect(problemsOf(withOverride({ comparisonBasis: "roughly the same" })))
      .toContain("comparisonBasis is neither same_condition nor quoted");
  });

  it("requires the record to have considered what failed", () => {
    expect(problemsOf(without("publishedFailures"))).toContain("publishedFailures is missing");
    // An empty list is a legitimate answer to the question; never having asked is not.
    expect(problemsOf(withOverride({ publishedFailures: [] }))).toEqual([]);
  });

  it("requires an ISO calendar date, because a run without one cannot be placed beside another", () => {
    expect(problemsOf(withOverride({ date: "September 2026" }))).toContain("date is not an ISO calendar date");
  });

  it("reports every problem at once rather than the first", () => {
    const problems = problemsOf({ datasetName: "half a record" });
    expect(problems.length).toBeGreaterThan(10);
  });

  it("rejects things that are not records at all", () => {
    for (const candidate of [null, undefined, 7, "sha256", [SHAPE_FIXTURE]]) {
      expect(problemsOf(candidate)).toEqual(["the record is not an object"]);
    }
  });
});

describe("the receipt contract and the family taxonomy", () => {
  it("describes every field of a receipt, so the page cannot promise less than the validator checks", () => {
    const described = RECEIPT_FIELDS.map((field) => field.key).sort();
    // `quotedSource` is conditional on comparisonBasis and is checked separately.
    const actual = Object.keys(SHAPE_FIXTURE).sort();
    expect(described).toEqual(actual);
  });

  it("gives every field a label and a reason it is pinned", () => {
    for (const field of RECEIPT_FIELDS) {
      expect(field.label.length, field.key).toBeGreaterThan(2);
      expect(field.pins.length, field.key).toBeGreaterThan(20);
    }
  });

  it("carries the eight families of the taxonomy, each with a definition and its metrics", () => {
    expect(BENCHMARK_FAMILIES).toHaveLength(8);
    expect(BENCHMARK_FAMILIES.map((family) => family.id)).toEqual([
      "document_reading",
      "evidence",
      "identity",
      "knowledge",
      "temporal",
      "recompilation",
      "ask",
      "operations",
    ]);
    for (const family of BENCHMARK_FAMILIES) {
      expect(family.definition.length, family.id).toBeGreaterThan(60);
      expect(family.metrics.length, family.id).toBeGreaterThan(2);
    }
  });

  it("states the north star as a definition and attaches no value to it", () => {
    expect(NORTH_STAR.name).toBe("Verified Fresh Knowledge Coverage");
    expect(NORTH_STAR.definition).toContain("passes validation");
    expect(NORTH_STAR.supporting.length).toBeGreaterThan(5);
    expect(JSON.stringify(NORTH_STAR)).not.toMatch(/\d+(\.\d+)?\s*%/);
  });
});

describe("the committed registry", () => {
  it("publishes no records on this deployment", () => {
    expect(qualifiedBenchmarkRecords()).toEqual([]);
  });

  it("fails the build rather than silently dropping a record it cannot publish", () => {
    expect(() => readBenchmarkRecords([without("corpusDigest")]))
      .toThrow(/benchmark-registry\.records\.json\[0\] cannot be published/);
    expect(() => readBenchmarkRecords([SHAPE_FIXTURE, withOverride({ comparisonBasis: "quoted", quotedSource: "x" })]))
      .toThrow(/\[1\] cannot be published/);
  });

  it("keeps the shape fixture out of the file that gets published", () => {
    const file = readFileSync(new URL("./benchmark-registry.records.json", import.meta.url), "utf8");
    expect(file).not.toContain("FIXTURE-ONLY");
    expect(JSON.parse(file).records).toEqual([]);
  });
});

/*
  The page, checked as source.

  Two of these duplicate rules that live in brand-copy.test.ts for the surfaces listed there.
  `/benchmarks` is a new public copy surface and belongs on that list; adding it is a one-line
  edit to a file another lane owns in this campaign, so the rule is enforced here in the meantime
  and the list entry is an integration step. The duplication is deliberate and should be removed
  when the entry lands, not left as two half-rules.
*/
describe("the /benchmarks page", () => {
  const page = readFileSync(new URL("../app/benchmarks/page.tsx", import.meta.url), "utf8");

  it("keeps every barred phrase out of the copy", () => {
    const lower = page.toLowerCase();
    for (const phrase of ["unlock your data", "second brain", "100% accurate", "never hallucinates", "better than rag", "ai brain"]) {
      expect(lower, `SPEC 13.3 bars "${phrase}"`).not.toContain(phrase);
    }
  });

  it("makes no readiness overclaim", () => {
    const lower = page.toLowerCase();
    for (const phrase of ["generally available", "production-ready", "fully automated ontology"]) {
      expect(lower, `"${phrase}" asserts a readiness this deployment has not established`).not.toContain(phrase);
    }
  });

  it("draws the families and the receipt from the registry rather than retyping them", () => {
    expect(page).toContain("BENCHMARK_FAMILIES.map");
    expect(page).toContain("RECEIPT_FIELDS.map");
    expect(page).toContain("qualifiedBenchmarkRecords()");
  });

  it("shows a results table only when a record qualifies", () => {
    expect(page).toContain("records.length > 0 ?");
    const tableAt = page.indexOf("<table");
    const guardAt = page.indexOf("records.length > 0 ?");
    expect(tableAt, "the page must render a table somewhere").toBeGreaterThan(0);
    expect(guardAt, "every table on this page sits behind the record guard").toBeLessThan(tableAt);
  });

  it("hand-types no digest, no metric value and no competitor", () => {
    expect(page).not.toContain("sha256:");
    // A percentage literal in this file would be a number nobody can trace to a receipt.
    expect(page).not.toMatch(/\d+(\.\d+)?\s*%/);
    /*
      Comments are stripped first. The header comment explains that no arena figure and no vendor
      row belongs on this page, and a check that fails on its own rationale is a check nobody
      keeps.
    */
    const shipped = page.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    for (const name of ["OmniDocBench", "Mistral", "Gemini", "GPT-", "Claude", "Qwen", "arena"]) {
      expect(shipped, `${name} has no place on a page that publishes no comparison`).not.toContain(name);
    }
  });

  it("declares its own address and asks to be indexed", () => {
    expect(page).toContain('canonical: "/benchmarks"');
    expect(page).toContain('url: "/benchmarks"');
    expect(page).toContain("robots: { index: true, follow: true }");
  });
});
