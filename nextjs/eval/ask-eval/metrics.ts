/**
 * Ask-eval metrics: the arithmetic, separated from the run so it can be tested without a corpus.
 *
 * Two rules shape every function here, and both come from CLAUDE.md's evidence section:
 *
 *   1. Every rate carries its denominator. A rate is `{ value, numerator, denominator }`, never a
 *      bare number, so a figure can never be read without the population it was measured over.
 *   2. A rate with no denominator is `null`, not 0. Returning 0% for "we asked nothing" is the
 *      single most common way an eval harness reports a success it never measured.
 *
 * Nothing here judges whether a cited region *supports* an answer. That is entailment, it is not
 * automated anywhere in this repository (see world-gate.ts's own note), and audit Q05 asks for it
 * to be scored by a person in a separate column. `rubric.md` and the exported CSV are that column.
 */

export type GoldLocator = { documentId: string; pageNumber1: number; regionId: string };

/** One citation as a path returned it, reduced to the locator fields both paths can produce. */
export type ReturnedLocator = {
  documentId: string;
  pageNumber1: number | null;
  regionId: string | null;
};

export type QuestionKind = "answerable" | "multihop" | "unanswerable";

export type EvalQuestion = {
  id: string;
  kind: QuestionKind;
  question: string;
  gold: GoldLocator[];
  reason?: string;
  why?: string;
  hops?: string;
};

export type PathOutcome = {
  /** `abstained` covers both an explicit abstention and a path that returned no citation at all. */
  status: "grounded" | "abstained";
  locators: ReturnedLocator[];
  latencyMs: number;
  /** Whatever the path itself said about why it declined, verbatim. */
  abstentionReasons: string[];
};

export type ScoredQuestion = {
  id: string;
  kind: QuestionKind;
  status: "grounded" | "abstained";
  returnedCount: number;
  goldCount: number;
  /** Distinct gold regions this question has, and how many of them the path returned. */
  goldRegionsTotal: number;
  goldRegionsFound: number;
  regionHits: number;
  pageHits: number;
  documentHits: number;
  /** Share of returned citations that land on a gold region. `null` when nothing was returned. */
  regionPrecision: number | null;
  /** Share of returned citations that land on a gold (document, page). `null` when nothing was returned. */
  pagePrecision: number | null;
  /** Share of gold regions that were returned. `null` when the question has no gold (unanswerable). */
  goldRegionRecall: number | null;
  /** Did the first citation land on a gold region? `null` when nothing was returned or no gold exists. */
  topLocatorHit: boolean | null;
  /** Did ANY returned citation land on a gold region -- hit@k rather than hit@1. */
  anyGoldHit: boolean | null;
  /**
   * The highest region precision this question could have scored, given how many gold regions it
   * has and how many citations the path returned. A path that returns 10 citations for a question
   * with one gold region cannot exceed 0.1, so a raw precision figure without this beside it says
   * more about `contextLimit` than about retrieval.
   */
  maxRegionPrecision: number | null;
  distinctDocumentsReturned: number;
  /** Multi-hop only: citations covered at least two distinct gold documents. */
  multiHopSatisfied: boolean | null;
  /** An unanswerable question that was answered anyway. */
  unsupportedAnswer: boolean;
  /** A question with gold evidence that was declined. */
  unnecessaryAbstention: boolean;
  latencyMs: number;
};

export type Rate = { value: number; numerator: number; denominator: number; population: string };

export function rate(numerator: number, denominator: number, population: string): Rate | null {
  if (!Number.isInteger(numerator) || numerator < 0) throw new Error("rate numerator must be a non-negative integer");
  if (!Number.isInteger(denominator) || denominator < 0) throw new Error("rate denominator must be a non-negative integer");
  if (numerator > denominator) throw new Error("rate numerator cannot exceed its denominator");
  // No denominator means the question was never asked. That is not a zero.
  if (denominator === 0) return null;
  return { value: numerator / denominator, numerator, denominator, population };
}

/** Nearest-rank percentile. `null` on an empty sample, because a p95 of nothing is not 0 ms. */
export function percentile(values: number[], fraction: number): number | null {
  if (fraction <= 0 || fraction > 1) throw new Error("percentile fraction must be in (0, 1]");
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function goldRegionKeys(gold: GoldLocator[]): Set<string> {
  return new Set(gold.map((item) => item.regionId));
}

function goldPageKeys(gold: GoldLocator[]): Set<string> {
  return new Set(gold.map((item) => `${item.documentId}#${item.pageNumber1}`));
}

function goldDocumentKeys(gold: GoldLocator[]): Set<string> {
  return new Set(gold.map((item) => item.documentId));
}

/**
 * Score one question against one path's outcome.
 *
 * Throws rather than guessing on a contradictory question: an `unanswerable` question carrying gold
 * locators, or an answerable one carrying none, is a bug in the question set, and silently scoring
 * it would put a made-up number in the report.
 */
export function scoreQuestion(question: EvalQuestion, outcome: PathOutcome): ScoredQuestion {
  if (question.kind === "unanswerable" && question.gold.length > 0) {
    throw new Error(`question ${question.id} is marked unanswerable but carries gold locators`);
  }
  if (question.kind !== "unanswerable" && question.gold.length === 0) {
    throw new Error(`question ${question.id} is marked ${question.kind} but carries no gold locator`);
  }
  if (!Number.isFinite(outcome.latencyMs) || outcome.latencyMs < 0) {
    throw new Error(`question ${question.id} has no usable latency`);
  }

  const regions = goldRegionKeys(question.gold);
  const pages = goldPageKeys(question.gold);
  const documents = goldDocumentKeys(question.gold);

  const returnedCount = outcome.locators.length;
  const regionHits = outcome.locators.filter((item) => item.regionId !== null && regions.has(item.regionId)).length;
  const pageHits = outcome.locators.filter(
    (item) => item.pageNumber1 !== null && pages.has(`${item.documentId}#${item.pageNumber1}`),
  ).length;
  const documentHits = outcome.locators.filter((item) => documents.has(item.documentId)).length;

  const hitGoldRegions = new Set(
    outcome.locators.map((item) => item.regionId).filter((id): id is string => id !== null && regions.has(id)),
  );
  const hitGoldDocuments = new Set(outcome.locators.map((item) => item.documentId).filter((id) => documents.has(id)));

  const first = outcome.locators[0];
  return {
    id: question.id,
    kind: question.kind,
    status: outcome.status,
    returnedCount,
    goldCount: question.gold.length,
    goldRegionsTotal: regions.size,
    goldRegionsFound: hitGoldRegions.size,
    regionHits,
    pageHits,
    documentHits,
    regionPrecision: returnedCount === 0 ? null : regionHits / returnedCount,
    pagePrecision: returnedCount === 0 ? null : pageHits / returnedCount,
    goldRegionRecall: question.gold.length === 0 ? null : hitGoldRegions.size / regions.size,
    topLocatorHit:
      returnedCount === 0 || question.gold.length === 0
        ? null
        : first.regionId !== null && regions.has(first.regionId),
    anyGoldHit: returnedCount === 0 || question.gold.length === 0 ? null : regionHits > 0,
    maxRegionPrecision:
      returnedCount === 0 || question.gold.length === 0
        ? null
        : Math.min(regions.size, returnedCount) / returnedCount,
    distinctDocumentsReturned: new Set(outcome.locators.map((item) => item.documentId)).size,
    multiHopSatisfied: question.kind === "multihop" ? hitGoldDocuments.size >= 2 : null,
    unsupportedAnswer: question.kind === "unanswerable" && outcome.status === "grounded",
    unnecessaryAbstention: question.gold.length > 0 && outcome.status === "abstained",
    latencyMs: outcome.latencyMs,
  };
}

export type PathSummary = {
  questions: number;
  /** Mean region-level evidence precision over the questions that returned at least one citation. */
  evidencePrecisionRegion: Rate | null;
  evidencePrecisionPage: Rate | null;
  /**
   * The best region precision this path could have scored on this question set at the number of
   * citations it actually returned. Read `evidencePrecisionRegion` against this, never alone.
   */
  evidencePrecisionRegionCeiling: Rate | null;
  meanCitationsPerAnsweredQuestion: number | null;
  goldRegionRecall: Rate | null;
  topLocatorHitRate: Rate | null;
  /** hit@k: a gold region appeared anywhere in the returned citations. */
  anyGoldHitRate: Rate | null;
  unsupportedAnswerRate: Rate | null;
  unnecessaryAbstentionRate: Rate | null;
  multiHopSuccessRate: Rate | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
};

/**
 * Micro-averaged rates: every rate is a count over a count, so it survives being read out of
 * context. `evidencePrecisionRegion` is (gold-region citations) / (citations returned) across the
 * answerable and multi-hop questions -- the unanswerable ones have no gold region by construction
 * and would drag a precision figure to zero for the wrong reason.
 */
export function summarize(rows: ScoredQuestion[]): PathSummary {
  const withGold = rows.filter((row) => row.goldCount > 0);
  const unanswerable = rows.filter((row) => row.kind === "unanswerable");
  const multihop = rows.filter((row) => row.kind === "multihop");
  const answered = withGold.filter((row) => row.returnedCount > 0);

  const citations = answered.reduce((sum, row) => sum + row.returnedCount, 0);
  const regionHits = answered.reduce((sum, row) => sum + row.regionHits, 0);
  const pageHits = answered.reduce((sum, row) => sum + row.pageHits, 0);
  const goldTotal = withGold.reduce((sum, row) => sum + row.goldRegionsTotal, 0);
  const goldFound = withGold.reduce((sum, row) => sum + row.goldRegionsFound, 0);

  return {
    questions: rows.length,
    evidencePrecisionRegion: rate(regionHits, citations, "citations returned for questions with gold evidence"),
    evidencePrecisionPage: rate(pageHits, citations, "citations returned for questions with gold evidence"),
    evidencePrecisionRegionCeiling: rate(
      answered.reduce((sum, row) => sum + Math.min(row.goldRegionsTotal, row.returnedCount), 0),
      citations,
      "citations returned for questions with gold evidence",
    ),
    meanCitationsPerAnsweredQuestion: answered.length === 0 ? null : citations / answered.length,
    goldRegionRecall: rate(goldFound, goldTotal, "gold regions across questions with gold evidence"),
    topLocatorHitRate: rate(
      answered.filter((row) => row.topLocatorHit === true).length,
      answered.length,
      "questions with gold evidence that returned at least one citation",
    ),
    anyGoldHitRate: rate(
      answered.filter((row) => row.anyGoldHit === true).length,
      answered.length,
      "questions with gold evidence that returned at least one citation",
    ),
    unsupportedAnswerRate: rate(
      unanswerable.filter((row) => row.unsupportedAnswer).length,
      unanswerable.length,
      "deliberately unanswerable questions",
    ),
    unnecessaryAbstentionRate: rate(
      withGold.filter((row) => row.unnecessaryAbstention).length,
      withGold.length,
      "questions with gold evidence in the corpus",
    ),
    multiHopSuccessRate: rate(
      multihop.filter((row) => row.multiHopSatisfied === true).length,
      multihop.length,
      "multi-hop questions spanning at least two filings",
    ),
    latencyP50Ms: percentile(rows.map((row) => row.latencyMs), 0.5),
    latencyP95Ms: percentile(rows.map((row) => row.latencyMs), 0.95),
  };
}

/**
 * Fail-closed check that the question set actually describes this corpus.
 *
 * Returns a problem per bad locator rather than throwing, so the runner can print all of them at
 * once; the runner then refuses to produce a report if the list is non-empty. A gold locator that
 * does not exist would silently become a miss and understate precision -- an invented number in
 * the other direction is still an invented number.
 */
export function validateQuestionSet(
  questions: EvalQuestion[],
  corpus: ReadonlyMap<string, { documentId: string; pageNumber1: number }>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.id)) problems.push(`duplicate question id ${question.id}`);
    seen.add(question.id);
    if (question.kind === "unanswerable" && question.gold.length > 0) {
      problems.push(`${question.id} is unanswerable but carries gold locators`);
    }
    if (question.kind !== "unanswerable" && question.gold.length === 0) {
      problems.push(`${question.id} is ${question.kind} but carries no gold locator`);
    }
    if (question.kind === "multihop" && new Set(question.gold.map((item) => item.documentId)).size < 2) {
      problems.push(`${question.id} is multihop but its gold locators sit in one document`);
    }
    for (const locator of question.gold) {
      const region = corpus.get(locator.regionId);
      if (!region) {
        problems.push(`${question.id} cites region ${locator.regionId}, which is not in the corpus`);
        continue;
      }
      if (region.documentId !== locator.documentId || region.pageNumber1 !== locator.pageNumber1) {
        problems.push(
          `${question.id} cites ${locator.regionId} as ${locator.documentId} p${locator.pageNumber1}, ` +
            `but the corpus has it in ${region.documentId} p${region.pageNumber1}`,
        );
      }
    }
  }
  return problems;
}
