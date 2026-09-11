import { describe, expect, it } from "vitest";
import {
  percentile,
  rate,
  scoreQuestion,
  summarize,
  validateQuestionSet,
  type EvalQuestion,
  type PathOutcome,
} from "./metrics";

const GOLD = { documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r12" };
const OTHER_GOLD = { documentId: "doc-b", pageNumber1: 9, regionId: "doc-b-p9-r3" };

const CORPUS = new Map([
  ["doc-a-p4-r12", { documentId: "doc-a", pageNumber1: 4 }],
  ["doc-a-p4-r13", { documentId: "doc-a", pageNumber1: 4 }],
  ["doc-b-p9-r3", { documentId: "doc-b", pageNumber1: 9 }],
]);

function answerable(overrides: Partial<EvalQuestion> = {}): EvalQuestion {
  return { id: "A01", kind: "answerable", question: "what?", gold: [GOLD], ...overrides };
}

function outcome(overrides: Partial<PathOutcome> = {}): PathOutcome {
  return { status: "grounded", locators: [], latencyMs: 5, abstentionReasons: [], ...overrides };
}

describe("rate", () => {
  it("carries its numerator, denominator and population", () => {
    expect(rate(3, 4, "citations")).toEqual({ value: 0.75, numerator: 3, denominator: 4, population: "citations" });
  });

  it("is null with no denominator rather than reporting 0%", () => {
    expect(rate(0, 0, "citations")).toBeNull();
  });

  it("refuses a numerator larger than its denominator", () => {
    expect(() => rate(5, 4, "citations")).toThrow(/cannot exceed/);
  });

  it("refuses a non-integer count", () => {
    expect(() => rate(1.5, 4, "citations")).toThrow(/non-negative integer/);
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
  });

  it("is null on an empty sample rather than 0 ms", () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  it("refuses a fraction outside (0, 1]", () => {
    expect(() => percentile([1], 0)).toThrow(/fraction/);
    expect(() => percentile([1], 1.2)).toThrow(/fraction/);
  });
});

describe("scoreQuestion", () => {
  it("scores a hit on the gold region", () => {
    const scored = scoreQuestion(
      answerable(),
      outcome({ locators: [{ documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r12" }] }),
    );
    expect(scored.regionHits).toBe(1);
    expect(scored.regionPrecision).toBe(1);
    expect(scored.goldRegionRecall).toBe(1);
    expect(scored.topLocatorHit).toBe(true);
    expect(scored.unnecessaryAbstention).toBe(false);
  });

  it("reports the precision ceiling so a raw precision cannot be read alone", () => {
    const scored = scoreQuestion(
      answerable(),
      outcome({
        locators: [
          { documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r12" },
          { documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r13" },
          { documentId: "doc-b", pageNumber1: 9, regionId: "doc-b-p9-r3" },
          { documentId: "doc-b", pageNumber1: 9, regionId: null },
        ],
      }),
    );
    // One gold region, four citations returned: precision cannot exceed a quarter.
    expect(scored.maxRegionPrecision).toBe(0.25);
    expect(scored.regionPrecision).toBe(0.25);
    expect(scored.anyGoldHit).toBe(true);
  });

  it("distinguishes hit@k from hit@1", () => {
    const scored = scoreQuestion(
      answerable(),
      outcome({
        locators: [
          { documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r13" },
          { documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r12" },
        ],
      }),
    );
    expect(scored.topLocatorHit).toBe(false);
    expect(scored.anyGoldHit).toBe(true);
  });

  it("separates a right page from a right region", () => {
    const scored = scoreQuestion(
      answerable(),
      outcome({ locators: [{ documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r13" }] }),
    );
    expect(scored.regionHits).toBe(0);
    expect(scored.pageHits).toBe(1);
    expect(scored.regionPrecision).toBe(0);
    expect(scored.pagePrecision).toBe(1);
  });

  it("reports null precision, not zero, when a path returned nothing", () => {
    const scored = scoreQuestion(answerable(), outcome({ status: "abstained" }));
    expect(scored.regionPrecision).toBeNull();
    expect(scored.topLocatorHit).toBeNull();
    expect(scored.unnecessaryAbstention).toBe(true);
  });

  it("counts an answered unanswerable question as an unsupported answer", () => {
    const scored = scoreQuestion(
      { id: "U01", kind: "unanswerable", question: "wrong period?", gold: [] },
      outcome({ locators: [{ documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r12" }] }),
    );
    expect(scored.unsupportedAnswer).toBe(true);
    expect(scored.goldRegionRecall).toBeNull();
    expect(scored.unnecessaryAbstention).toBe(false);
  });

  it("requires a multi-hop answer to cite at least two gold documents", () => {
    const question = answerable({ id: "M01", kind: "multihop", gold: [GOLD, OTHER_GOLD] });
    const oneDocument = scoreQuestion(
      question,
      outcome({ locators: [{ documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r12" }] }),
    );
    expect(oneDocument.multiHopSatisfied).toBe(false);
    const bothDocuments = scoreQuestion(
      question,
      outcome({
        locators: [
          { documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r12" },
          { documentId: "doc-b", pageNumber1: 9, regionId: "doc-b-p9-r3" },
        ],
      }),
    );
    expect(bothDocuments.multiHopSatisfied).toBe(true);
  });

  it("throws on a contradictory question rather than scoring it", () => {
    expect(() =>
      scoreQuestion({ id: "U02", kind: "unanswerable", question: "x?", gold: [GOLD] }, outcome()),
    ).toThrow(/unanswerable but carries gold/);
    expect(() => scoreQuestion(answerable({ gold: [] }), outcome())).toThrow(/no gold locator/);
  });

  it("throws on an unusable latency rather than reporting one", () => {
    expect(() => scoreQuestion(answerable(), outcome({ latencyMs: Number.NaN }))).toThrow(/latency/);
  });
});

describe("summarize", () => {
  it("micro-averages over citations and states every denominator", () => {
    const rows = [
      scoreQuestion(
        answerable({ id: "A01" }),
        outcome({
          locators: [
            { documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r12" },
            { documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r13" },
          ],
          latencyMs: 10,
        }),
      ),
      scoreQuestion(
        { id: "U01", kind: "unanswerable", question: "x?", gold: [] },
        outcome({ status: "abstained", latencyMs: 30 }),
      ),
      scoreQuestion(
        answerable({ id: "M01", kind: "multihop", gold: [GOLD, OTHER_GOLD] }),
        outcome({ locators: [{ documentId: "doc-b", pageNumber1: 9, regionId: "doc-b-p9-r3" }], latencyMs: 20 }),
      ),
    ];
    const summary = summarize(rows);
    expect(summary.evidencePrecisionRegion).toEqual({
      value: 2 / 3,
      numerator: 2,
      denominator: 3,
      population: "citations returned for questions with gold evidence",
    });
    expect(summary.goldRegionRecall?.denominator).toBe(3);
    expect(summary.unsupportedAnswerRate).toEqual({
      value: 0,
      numerator: 0,
      denominator: 1,
      population: "deliberately unanswerable questions",
    });
    expect(summary.multiHopSuccessRate?.value).toBe(0);
    expect(summary.latencyP50Ms).toBe(20);
    // A01 returned two citations for one gold region (ceiling 1/2) and M01 one citation for two
    // gold regions (ceiling 1/1): 2 of 3 citations could have been hits at most.
    expect(summary.evidencePrecisionRegionCeiling).toEqual({
      value: 2 / 3,
      numerator: 2,
      denominator: 3,
      population: "citations returned for questions with gold evidence",
    });
    expect(summary.meanCitationsPerAnsweredQuestion).toBe(1.5);
    expect(summary.anyGoldHitRate?.numerator).toBe(2);
  });

  it("reports null, not zero, for every rate when there are no rows", () => {
    const summary = summarize([]);
    expect(summary.questions).toBe(0);
    expect(summary.evidencePrecisionRegion).toBeNull();
    expect(summary.evidencePrecisionRegionCeiling).toBeNull();
    expect(summary.meanCitationsPerAnsweredQuestion).toBeNull();
    expect(summary.anyGoldHitRate).toBeNull();
    expect(summary.unsupportedAnswerRate).toBeNull();
    expect(summary.unnecessaryAbstentionRate).toBeNull();
    expect(summary.multiHopSuccessRate).toBeNull();
    expect(summary.latencyP95Ms).toBeNull();
  });
});

describe("validateQuestionSet", () => {
  it("accepts a set whose every gold locator is in the corpus", () => {
    expect(validateQuestionSet([answerable()], CORPUS)).toEqual([]);
  });

  it("rejects a gold locator the corpus does not contain", () => {
    const problems = validateQuestionSet([answerable({ gold: [{ ...GOLD, regionId: "doc-a-p4-r999" }] })], CORPUS);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not in the corpus/);
  });

  it("rejects a gold locator whose page disagrees with the corpus", () => {
    const problems = validateQuestionSet([answerable({ gold: [{ ...GOLD, pageNumber1: 5 }] })], CORPUS);
    expect(problems[0]).toMatch(/but the corpus has it in doc-a p4/);
  });

  it("rejects a multi-hop question whose gold sits in one document", () => {
    const problems = validateQuestionSet(
      [answerable({ id: "M09", kind: "multihop", gold: [GOLD, { documentId: "doc-a", pageNumber1: 4, regionId: "doc-a-p4-r13" }] })],
      CORPUS,
    );
    expect(problems).toContain("M09 is multihop but its gold locators sit in one document");
  });

  it("rejects a duplicate question id", () => {
    expect(validateQuestionSet([answerable(), answerable()], CORPUS)).toContain("duplicate question id A01");
  });
});
