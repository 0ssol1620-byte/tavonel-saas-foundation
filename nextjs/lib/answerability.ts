import { tokens } from "./lexical-tokens";

/*
  E2 (PROGRAM-2026-11-04 §4.E): the answerability gate -- "can this World answer this question?",
  decided before anything is said, from the evidence the World Gate let through.

  Pure and deterministic. No model, no network, no clock. It does not score an answer and it has no
  single blind number: the verdict is a fixed rule order over named features, each reported next to
  the status so a reader can see which rule fired.

    1. no evidence passed the World Gate                      -> NOT_IN_WORLD  (NO_EVIDENCE)
    2. a held conflict is in the packet                       -> CONFLICTED    (HELD_CONFLICT)
       never resolved here: an authoritative conflict is not auto-resolved on insufficient evidence.
    3. the question asks for an amount and no evidence item
       states one (with every year the question names)         -> NOT_IN_WORLD  (NO_NUMERIC_ANCHOR)
    4. share of the question's terms found in the evidence
       is below the pre-registered threshold                   -> PARTIAL       (TERM_COVERAGE_BELOW_THRESHOLD)
    5. otherwise                                               -> ANSWERABLE

  OUT_OF_SCHEMA belongs to the contract and is never produced here: it needs a certified schema
  (C1), and none exists yet. `worldCoverage` is carried through unchanged; `unprocessedSources` is
  null when the caller did not read it, and null says so rather than claiming zero (v4 §13.9).

  The threshold is a parameter, never a default: it is set on the E1 calibration split and judged on
  the holdout (eval/ask-quality/e2/PREREG-E2.json). This file's bytes are pinned by that
  pre-registration; changing a rule here is a new pre-registration, not a fix.
*/

export const ANSWERABILITY_SCHEMA = "tavonel.answerability.v1" as const;

export type AnswerabilityStatus = "ANSWERABLE" | "PARTIAL" | "NOT_IN_WORLD" | "CONFLICTED" | "OUT_OF_SCHEMA";
export type AnswerabilityReason = "NO_EVIDENCE" | "HELD_CONFLICT" | "NO_NUMERIC_ANCHOR" | "TERM_COVERAGE_BELOW_THRESHOLD";

export type AnswerabilityInput = Readonly<{
  question: string;
  /** The World-Gate-passed evidence the answer would cite, full text (not the 420-character preview). */
  evidence: ReadonlyArray<Readonly<{ evidenceId: string; text: string }>>;
  /** Held conflicts in the packet; null when the path that answered carries no conflict information. */
  heldConflicts: number | null;
  worldCoverage: Readonly<{ processedSources: number; unprocessedSources: number | null }>;
}>;

/** Internal DTO. Carries the threshold and the question's own words: never a public response field. */
export type Answerability = {
  schema: typeof ANSWERABILITY_SCHEMA;
  status: AnswerabilityStatus;
  reason: AnswerabilityReason | null;
  coveredTerms: string[];
  missingTerms: string[];
  /** covered / question terms; null when the question has no terms. */
  termCoverage: number | null;
  coverageThreshold: number;
  evidenceCount: number;
  numericQuestion: boolean;
  /** Rule 3's finding; null when the question does not ask for an amount or no evidence exists. */
  numericAnchor: boolean | null;
  questionYears: string[];
  conflicts: number | null;
  worldCoverage: { processedSources: number; unprocessedSources: number | null };
};

// Asks for an amount: quantity words or a currency/percent unit. English and Korean only; a question
// in another language is not numeric to this rule, so rule 3 does not fire on it (it never refuses
// more than it can read).
const NUMERIC_QUESTION = /\b(?:how (?:much|many)|amount|number of|total|percent(?:age)?|ratio|dollars?|usd|eur|krw|jpy)\b|얼마|몇|금액|비율|퍼센트/iu;
const YEAR = /\b(?:19|20|21)\d{2}\b/g;
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
// Digits that name a date or a document part rather than state an amount.
const NON_AMOUNT = [
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?\\b`, "gi"),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  /\b(?:Item|Note|Part|Schedule|Exhibit|Page)\s+\d{1,3}(?:\.\d+)?[A-C]?\b/gi,
  /\b(?:19|20|21)\d{2}\b/g,
];

function statesAmount(text: string): boolean {
  return /\d/.test(NON_AMOUNT.reduce((current, pattern) => current.replace(pattern, " "), text));
}

export function evaluateAnswerability(input: AnswerabilityInput, params: Readonly<{ coverageThreshold: number }>): Answerability {
  const threshold = params.coverageThreshold;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("coverageThreshold must be a number in [0, 1]");
  if (input.heldConflicts !== null && (!Number.isInteger(input.heldConflicts) || input.heldConflicts < 0)) {
    throw new Error("heldConflicts must be null or a non-negative integer");
  }

  const terms = [...new Set(tokens(input.question))];
  const evidenceTerms = new Set(input.evidence.flatMap(item => tokens(item.text)));
  const coveredTerms = terms.filter(term => evidenceTerms.has(term));
  const missingTerms = terms.filter(term => !evidenceTerms.has(term));
  const termCoverage = terms.length === 0 ? null : coveredTerms.length / terms.length;
  const numericQuestion = NUMERIC_QUESTION.test(input.question.normalize("NFKC"));
  const questionYears = [...new Set(input.question.normalize("NFKC").match(YEAR) ?? [])];
  const numericAnchor = numericQuestion && input.evidence.length > 0
    ? input.evidence.some(item => {
      const text = item.text.normalize("NFKC");
      const years = new Set(text.match(YEAR) ?? []);
      return statesAmount(text) && questionYears.every(year => years.has(year));
    })
    : null;

  let status: AnswerabilityStatus = "ANSWERABLE";
  let reason: AnswerabilityReason | null = null;
  if (input.evidence.length === 0) [status, reason] = ["NOT_IN_WORLD", "NO_EVIDENCE"];
  else if (input.heldConflicts !== null && input.heldConflicts > 0) [status, reason] = ["CONFLICTED", "HELD_CONFLICT"];
  else if (numericAnchor === false) [status, reason] = ["NOT_IN_WORLD", "NO_NUMERIC_ANCHOR"];
  else if (termCoverage !== null && termCoverage < threshold) [status, reason] = ["PARTIAL", "TERM_COVERAGE_BELOW_THRESHOLD"];

  return {
    schema: ANSWERABILITY_SCHEMA,
    status,
    reason,
    coveredTerms,
    missingTerms,
    termCoverage,
    coverageThreshold: threshold,
    evidenceCount: input.evidence.length,
    numericQuestion,
    numericAnchor,
    questionYears,
    conflicts: input.heldConflicts,
    worldCoverage: { ...input.worldCoverage },
  };
}

/** The statuses the gate would refuse on (PREREG-E2 primary refusal set). */
export const REFUSING_STATUSES: ReadonlySet<AnswerabilityStatus> = new Set(["NOT_IN_WORLD", "PARTIAL", "OUT_OF_SCHEMA"]);
