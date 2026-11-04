/**
 * E1 ask-quality scoring: the arithmetic, the receipt and the fixture answerer, with no I/O.
 *
 * Every rule here is the one PREREG.json registers, and `PREREG.json#scoring` names this file.
 * `run_eval.mjs` is the CLI around it; `metrics.test.ts` pins it.
 *
 * Inherited from ../ask-eval/metrics.ts and reused, not re-implemented: `rate` (a rate with no
 * denominator is null, never 0) and `percentile` (nearest rank, null on an empty sample).
 */
import { createHash } from "node:crypto";
import { percentile, rate } from "../ask-eval/metrics";

export type QuestionSetId = "xbrl-numeric" | "human" | "unanswerable";

export type NumericGold = { value: number; unit: string; decimals: number | null };
export type Gold = { numeric?: NumericGold; acceptableAnswers?: string[]; spans: string[] };

export type EvalQuestion = {
  id: string;
  set: QuestionSetId;
  kind: "answerable" | "unanswerable";
  answerType: "numeric" | "text";
  split?: "calibration" | "holdout";
  corpusRef: string;
  question: string;
  gold: Gold | null;
  humanVerified?: boolean;
};

export type Citation = { text: string; evidenceId?: string | null; pageNumber1?: number | null };

export type AnswererResponse = {
  answer: string;
  /** A structured value, when the answerer produces one. `evidence_excerpts` never does. */
  numeric?: { value: number; unit: string | null } | null;
  citations: Citation[];
  abstained: boolean;
  latencyMs: number;
  /** Whatever the answerer reports about how it answered (retrieval path, answer mode), verbatim. */
  meta?: Record<string, string | null>;
};

/** The pluggable answerer. `ask` receives the question text and the corpus it is asked of. */
export type Answerer = {
  id: string;
  kind: "fixture" | "live";
  ask(question: string, corpusRef: string): Promise<AnswererResponse>;
};

// ------------------------------------------------------------------------------------ text

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does `text` contain the gold span? A span that is a number ("15,819", "4.500") must appear as a
 * whole number -- "1,394,328" does not contain "394,328". Any other span is a normalized substring.
 */
export function containsSpan(text: string, span: string): boolean {
  const haystack = normalizeText(text);
  const needle = normalizeText(span);
  if (needle.length === 0) return false;
  if (/^[\d.,]+$/.test(needle)) {
    return new RegExp(`(?<![\\d.,])${escapeRegExp(needle)}(?![\\d]|[.,]\\d)`).test(haystack);
  }
  return haystack.includes(needle);
}

// --------------------------------------------------------------------------------- numbers

const SCALE: Record<string, number> = { thousand: 3, million: 6, billion: 9, trillion: 12 };

export type ExtractedNumber = { value: number; unit: string | null };

/**
 * Digits that name something rather than state an amount (PREREG v2 scoring.numericExactMatch):
 * dates ("June 30, 2025", "Dec. 28", "2025-06-30", "6/30/2025"), filing forms ("10-K", "8-K/A")
 * and document references ("Item 8", "Note 12"). v1 read the 30 in "fiscal year ended June 30,
 * 2025" as a second number, so an answer that restated its own question could not match.
 */
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
export const NON_AMOUNT_PATTERNS: RegExp[] = [
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?\\b`, "gi"),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  /\b(?:10-KT?|10-Q|8-K|20-F|6-K|S-1)(?:\/A)?\b/gi,
  /\b(?:Item|Note|Part|Schedule|Exhibit)\s+\d{1,3}(?:\.\d+)?[A-C]?\b/gi,
];

export function stripNonAmounts(text: string): string {
  return NON_AMOUNT_PATTERNS.reduce((current, pattern) => current.replace(pattern, " "), text);
}

/**
 * Every number a free-text answer states, with its scale word and an inferred unit, after
 * `stripNonAmounts`. A bare 4-digit integer from 1900 to 2100 with no currency sign, scale word or
 * separator is read as a year and skipped -- "in fiscal 2025, revenue was $47,061 million" states
 * one amount.
 */
export function extractNumbers(answer: string): ExtractedNumber[] {
  const text = stripNonAmounts(answer);
  const pattern =
    /(\(|-|−)?\s*(\$|USD\s?)?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*\)?\s*(thousand|million|billion|trillion)?(\s*(?:per (?:diluted |basic )?share|shares))?/gi;
  const out: ExtractedNumber[] = [];
  for (const match of text.matchAll(pattern)) {
    const [, negative, currency, integer, fraction, scaleWord, unitWord] = match;
    const plain = `${integer.replace(/,/g, "")}${fraction ?? ""}`;
    if (!currency && !scaleWord && !integer.includes(",") && !fraction && /^(19|20|21)\d{2}$/.test(plain)) continue;
    const exponent = scaleWord ? SCALE[scaleWord.toLowerCase()] : 0;
    const magnitude = Number(`${plain}e${exponent}`);
    const unit = unitWord
      ? /per/i.test(unitWord) ? "USD/shares" : "shares"
      : currency ? "USD" : null;
    out.push({ value: negative ? -magnitude : magnitude, unit });
  }
  return out;
}

export type NumericVerdict = {
  match: boolean;
  reason: "MATCH" | "NO_VALUE" | "NOT_A_SINGLE_VALUE" | "UNIT_MISMATCH" | "VALUE_MISMATCH";
};

/**
 * Exact match at the precision the source reported. XBRL `decimals = d` means the value is known to
 * 10^-d, so an answer within half a unit of that place is the same number (394,328 million matches
 * 394328000000 at d = -6; $394.3 billion does not). `decimals = null` (INF) demands equality.
 *
 * The answer's value is its structured `numeric` when given; otherwise the one distinct number its
 * text states. Text that states several numbers -- an excerpt dump -- has not answered with one.
 * A unit the answer states must equal the gold unit; an answer that states none is judged on value.
 */
export function numericExactMatch(gold: NumericGold, response: Pick<AnswererResponse, "answer" | "numeric">): NumericVerdict {
  let candidate: ExtractedNumber;
  if (response.numeric) candidate = { value: response.numeric.value, unit: response.numeric.unit };
  else {
    const found = extractNumbers(response.answer);
    const distinct = [...new Map(found.map((item) => [`${item.value}|${item.unit}`, item])).values()];
    if (distinct.length === 0) return { match: false, reason: "NO_VALUE" };
    if (distinct.length > 1) return { match: false, reason: "NOT_A_SINGLE_VALUE" };
    candidate = distinct[0];
  }
  if (!Number.isFinite(candidate.value)) return { match: false, reason: "NO_VALUE" };
  if (candidate.unit !== null && candidate.unit !== gold.unit) return { match: false, reason: "UNIT_MISMATCH" };
  const difference = Math.abs(candidate.value - gold.value);
  // Strictly inside half a unit: the half-unit boundary itself rounds away from the gold value.
  const equal = gold.decimals === null
    ? difference <= 1e-9 * Math.max(1, Math.abs(gold.value))
    : difference < 0.5 * 10 ** -gold.decimals;
  return equal ? { match: true, reason: "MATCH" } : { match: false, reason: "VALUE_MISMATCH" };
}

// ------------------------------------------------------------------------------ abstention

/** Abstained: the answerer said so, or it returned neither an answer nor a citation. */
export function classifyAbstention(response: Pick<AnswererResponse, "abstained" | "answer" | "citations">): boolean {
  return response.abstained || (response.answer.trim().length === 0 && response.citations.length === 0);
}

// ------------------------------------------------------------------------------- per question

export type ScoredRow = {
  id: string;
  set: QuestionSetId;
  kind: "answerable" | "unanswerable";
  split: string | null;
  abstained: boolean;
  /** Answerable only: answered and right. `null` for unanswerable questions. */
  correct: boolean | null;
  /** Numeric questions only. */
  numericMatch: boolean | null;
  numericReason: NumericVerdict["reason"] | null;
  citations: number;
  /** Answerable only: citations whose text contains a gold span. */
  citationsWithGoldSpan: number | null;
  /** Answerable only: every gold span is non-numeric or has >= 4 digits (PREREG v2 stratum). */
  goldSpanFourDigitsPlus: boolean | null;
  latencyMs: number;
  meta: Record<string, string | null> | null;
};

export function scoreQuestion(question: EvalQuestion, response: AnswererResponse): ScoredRow {
  if (question.kind === "unanswerable" && question.gold !== null) throw new Error(`${question.id}: unanswerable question carries gold`);
  if (question.kind === "answerable" && (question.gold === null || question.gold.spans.length === 0)) {
    throw new Error(`${question.id}: answerable question carries no gold span`);
  }
  if (question.answerType === "numeric" && question.kind === "answerable" && !question.gold?.numeric) {
    throw new Error(`${question.id}: numeric question carries no numeric gold`);
  }
  if (!Number.isFinite(response.latencyMs) || response.latencyMs < 0) throw new Error(`${question.id}: answerer returned no usable latency`);

  const abstained = classifyAbstention(response);
  const gold = question.gold;
  let numericMatch: boolean | null = null;
  let numericReason: NumericVerdict["reason"] | null = null;
  if (question.kind === "answerable" && gold?.numeric) {
    const verdict = abstained ? { match: false, reason: "NO_VALUE" as const } : numericExactMatch(gold.numeric, response);
    numericMatch = verdict.match;
    numericReason = verdict.reason;
  }
  let correct: boolean | null = null;
  if (question.kind === "answerable" && gold) {
    if (abstained) correct = false;
    else if (question.answerType === "numeric") correct = numericMatch === true;
    else correct = (gold.acceptableAnswers ?? []).some((answer) => containsSpan(response.answer, answer));
  }
  return {
    id: question.id,
    set: question.set,
    kind: question.kind,
    split: question.split ?? null,
    abstained,
    correct,
    numericMatch,
    numericReason,
    citations: response.citations.length,
    citationsWithGoldSpan:
      question.kind === "answerable" && gold
        ? response.citations.filter((citation) => gold.spans.some((span) => containsSpan(citation.text, span))).length
        : null,
    goldSpanFourDigitsPlus:
      question.kind === "answerable" && gold
        ? gold.spans.every((span) => !/^[\d.,]+$/.test(span.trim()) || (span.match(/\d/g) ?? []).length >= 4)
        : null,
    latencyMs: response.latencyMs,
    meta: response.meta ?? null,
  };
}

/** Questions are asked one at a time, in file order: concurrency would make latency a load test. */
export async function runEval(questions: EvalQuestion[], answerer: Answerer): Promise<ScoredRow[]> {
  const rows: ScoredRow[] = [];
  for (const question of questions) rows.push(scoreQuestion(question, await answerer.ask(question.question, question.corpusRef)));
  return rows;
}

// --------------------------------------------------------------------------------- statistics

export const Z95 = 1.959963984540054;

/** Wilson score interval. `null` when n = 0: an interval around nothing is not [0, 0]. */
export function wilson(successes: number, n: number, z = Z95): { low: number; high: number } | null {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || successes < 0 || successes > n) {
    throw new Error("wilson needs integers 0 <= successes <= n");
  }
  if (n === 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export type MetricRow = {
  id: string;
  label: string;
  numeratorLabel: string;
  denominatorLabel: string;
  numerator: number;
  denominator: number;
  value: number | null;
  ci95: { low: number; high: number; method: "wilson" } | null;
};

function metric(id: string, label: string, numeratorLabel: string, denominatorLabel: string, k: number, n: number): MetricRow {
  const checked = rate(k, n, denominatorLabel);
  const interval = wilson(k, n);
  return {
    id, label, numeratorLabel, denominatorLabel, numerator: k, denominator: n,
    value: checked === null ? null : checked.value,
    ci95: interval === null ? null : { ...interval, method: "wilson" },
  };
}

const count = (rows: ScoredRow[], test: (row: ScoredRow) => boolean) => rows.filter(test).length;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const SETS = ["xbrl-numeric", "human"] as const;

/** Metric ids every receipt must carry, in order (PREREG v2 `metrics`). */
export const REQUIRED_METRIC_IDS = [
  ...SETS.flatMap((set) => [`correct_over_answerable.${set}`, `abstained_over_answerable.${set}`]),
  "correct_abstention_over_unanswerable",
  "wrong_answer_over_unanswerable",
  ...SETS.flatMap((set) => [`citation_precision.${set}`, `citation_precision_4plus_digit_spans.${set}`, `gold_span_recall.${set}`]),
  "numeric_exact_match_over_numeric",
];

/**
 * The E1 metrics: PROGRAM §4.E's list plus, from PREREG v2, abstention on answerable questions and
 * gold-span recall -- without them an answerer that abstains on everything loses nothing on any
 * registered row, and E2's "no loss of correct answers" gate would pass vacuously. Answerable
 * metrics are reported per question set and never pooled (PROGRAM §4.E risk: XBRL may skew easy).
 */
export function summarize(rows: ScoredRow[]): MetricRow[] {
  const out: MetricRow[] = [];
  for (const set of SETS) {
    const answerable = rows.filter((row) => row.set === set && row.kind === "answerable");
    out.push(metric(`correct_over_answerable.${set}`, `Correct / answerable (${set})`, "answered and correct", `answerable ${set} questions`, count(answerable, (row) => row.correct === true), answerable.length));
    out.push(metric(`abstained_over_answerable.${set}`, `Abstained / answerable (${set})`, "abstained", `answerable ${set} questions`, count(answerable, (row) => row.abstained), answerable.length));
  }
  const unanswerable = rows.filter((row) => row.kind === "unanswerable");
  out.push(metric("correct_abstention_over_unanswerable", "Correct abstention / unanswerable", "abstained", "unanswerable questions", count(unanswerable, (row) => row.abstained), unanswerable.length));
  out.push(metric("wrong_answer_over_unanswerable", "Wrong answer / unanswerable", "answered anyway", "unanswerable questions", count(unanswerable, (row) => !row.abstained), unanswerable.length));
  for (const set of SETS) {
    const cited = rows.filter((row) => row.set === set && row.kind === "answerable");
    const precision = (id: string, label: string, subset: ScoredRow[], denominator: string) =>
      metric(id, label, "citations containing a gold span", denominator, sum(subset.map((row) => row.citationsWithGoldSpan ?? 0)), sum(subset.map((row) => row.citations)));
    out.push(precision(`citation_precision.${set}`, `Citation precision (${set})`, cited, `citations returned for answerable ${set} questions`));
    // 3-digit spans ("212") recur by accident across a filing's tables; this stratum excludes them.
    out.push(precision(`citation_precision_4plus_digit_spans.${set}`, `Citation precision, gold spans >= 4 digits (${set})`, cited.filter((row) => row.goldSpanFourDigitsPlus === true), `citations returned for answerable ${set} questions whose gold spans have >= 4 digits`));
    out.push(metric(`gold_span_recall.${set}`, `Gold-span recall (${set})`, "questions with >= 1 citation containing a gold span", `answerable ${set} questions`, count(cited, (row) => (row.citationsWithGoldSpan ?? 0) > 0), cited.length));
  }
  const numeric = rows.filter((row) => row.numericMatch !== null);
  out.push(metric("numeric_exact_match_over_numeric", "Numeric exact match / numeric questions", "exact match at reported precision", "answerable numeric questions", count(numeric, (row) => row.numericMatch === true), numeric.length));
  return out;
}

export function latency(rows: ScoredRow[]) {
  const values = rows.map((row) => row.latencyMs);
  return { n: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), method: "nearest-rank" as const };
}

// ------------------------------------------------------------------------------------ receipt

export const RECEIPT_SCHEMA = "tavonel.ask_quality_receipt.v1";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Canonical JSON: keys sorted at every depth, so equal content has one digest. */
export function canonicalJson(value: unknown): string {
  const sort = (input: unknown): Json => {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort((input as Record<string, unknown>)[key])]));
    }
    return input as Json;
  };
  return JSON.stringify(sort(value));
}

export type QuestionSetRef = { id: QuestionSetId; path: string; sha256: string | null; status: "FROZEN" | "NOT_FROZEN"; questionsScored: number };

export type Receipt = {
  schema: typeof RECEIPT_SCHEMA;
  status: "IMPLEMENTED_NOT_PROVEN";
  preregSha256: string;
  questionSets: QuestionSetRef[];
  answerer: { id: string; kind: "fixture" | "live" };
  gitSha: string;
  gitDirty: boolean;
  runStartedAt: string;
  metrics: MetricRow[];
  latency: ReturnType<typeof latency>;
  rows: ScoredRow[];
  receiptSha256: string;
};

export function buildReceipt(input: Omit<Receipt, "schema" | "status" | "metrics" | "latency" | "receiptSha256">): Receipt {
  const body: Omit<Receipt, "receiptSha256"> = {
    schema: RECEIPT_SCHEMA,
    status: "IMPLEMENTED_NOT_PROVEN",
    ...input,
    metrics: summarize(input.rows),
    latency: latency(input.rows),
  };
  return { ...body, receiptSha256: createHash("sha256").update(canonicalJson(body)).digest("hex") };
}

const SHA = /^[a-f0-9]{64}$/;

/** Every problem with a receipt, as a list. Empty means valid. */
export function validateReceipt(value: unknown): string[] {
  const errors: string[] = [];
  if (value === null || typeof value !== "object") return ["receipt is not an object"];
  const receipt = value as Partial<Receipt>;
  if (receipt.schema !== RECEIPT_SCHEMA) errors.push("schema");
  if (receipt.status !== "IMPLEMENTED_NOT_PROVEN") errors.push("status");
  if (!SHA.test(receipt.preregSha256 ?? "")) errors.push("preregSha256");
  if (!/^[a-f0-9]{7,40}$/.test(receipt.gitSha ?? "")) errors.push("gitSha");
  if (!receipt.answerer || typeof receipt.answerer.id !== "string" || !["fixture", "live"].includes(receipt.answerer.kind)) errors.push("answerer");
  if (!Array.isArray(receipt.questionSets) || receipt.questionSets.length === 0) errors.push("questionSets");
  for (const set of receipt.questionSets ?? []) {
    if (set.status === "FROZEN" && !SHA.test(set.sha256 ?? "")) errors.push(`questionSets.${set.id}.sha256`);
  }
  if (!Array.isArray(receipt.metrics) || receipt.metrics.map((row) => row.id).join("|") !== REQUIRED_METRIC_IDS.join("|")) errors.push("metrics");
  for (const row of receipt.metrics ?? []) {
    const where = `metrics.${row.id}`;
    if (!Number.isInteger(row.numerator) || !Number.isInteger(row.denominator) || row.numerator < 0 || row.numerator > row.denominator) errors.push(`${where}.counts`);
    if (!row.denominatorLabel) errors.push(`${where}.denominatorLabel`);
    if (row.denominator === 0 ? row.value !== null || row.ci95 !== null : row.value === null || row.ci95 === null) errors.push(`${where}.value`);
    if (row.ci95 && !(row.ci95.low <= (row.value ?? -1) && (row.value ?? 2) <= row.ci95.high)) errors.push(`${where}.ci95`);
  }
  if (!receipt.latency || !Number.isInteger(receipt.latency.n)) errors.push("latency");
  if (!Array.isArray(receipt.rows)) errors.push("rows");
  if (receipt.receiptSha256 !== undefined) {
    const { receiptSha256, ...body } = receipt;
    if (createHash("sha256").update(canonicalJson(body)).digest("hex") !== receiptSha256) errors.push("receiptSha256");
  } else errors.push("receiptSha256");
  return errors;
}

const fmt = (value: number | null, digits = 4) => (value === null ? "n/a" : value.toFixed(digits));

/** The markdown table. Every metric row carries its numerator and denominator in its own columns. */
export function renderMarkdown(receipt: Receipt): string {
  const lines = [
    `# Ask quality receipt -- ${receipt.answerer.id}`,
    "",
    `Status: **${receipt.status}**. ${receipt.answerer.kind === "fixture" ? "FIXTURE answerer: these numbers exercise the harness and say nothing about TAVONEL." : "Live answerer."}`,
    "",
    `- receipt sha256: \`${receipt.receiptSha256}\``,
    `- prereg sha256: \`${receipt.preregSha256}\``,
    `- git: \`${receipt.gitSha}\`${receipt.gitDirty ? " (dirty tree)" : ""}; run started ${receipt.runStartedAt}`,
    ...receipt.questionSets.map((set) => `- set \`${set.id}\`: ${set.status}, scored ${set.questionsScored}${set.sha256 ? `, sha256 \`${set.sha256}\`` : ""}`),
    "",
    "| metric | numerator | denominator | value | Wilson 95% CI |",
    "|---|---|---|---|---|",
    ...receipt.metrics.map((row) =>
      `| ${row.label} | ${row.numerator} (${row.numeratorLabel}) | ${row.denominator} (${row.denominatorLabel}) | ${fmt(row.value)} | ${row.ci95 ? `${fmt(row.ci95.low)}–${fmt(row.ci95.high)}` : "n/a"} |`),
    `| Latency p50 / p95 (ms, ${receipt.latency.method}) | -- | ${receipt.latency.n} (all questions asked) | ${fmt(receipt.latency.p50Ms, 0)} / ${fmt(receipt.latency.p95Ms, 0)} | -- |`,
    "",
    "Citation precision counts citations, which cluster within questions; the Wilson interval treats them as independent and is narrower than the truth.",
    "",
  ];
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------ fixture

/**
 * A deterministic answerer that knows the gold and answers by a hash of the question, so every
 * scoring branch is exercised: correct structured value, correct free text, wrong value, abstention,
 * a citation with and without the gold span. Its latency is simulated. It measures nothing.
 */
export function createFixtureAnswerer(questions: EvalQuestion[]): Answerer {
  const byKey = new Map(questions.map((question) => [`${question.corpusRef}\n${question.question}`, question]));
  return {
    id: "fixture-v1",
    kind: "fixture",
    async ask(text, corpusRef) {
      const question = byKey.get(`${corpusRef}\n${text}`);
      if (!question) throw new Error(`fixture has no question for ${corpusRef}`);
      const bucket = createHash("sha256").update(question.id).digest()[0];
      const latencyMs = 40 + bucket;
      const abstain = { answer: "", citations: [], abstained: true, latencyMs };
      if (question.kind === "unanswerable") {
        return bucket % 2 === 0 ? abstain : { answer: "$1,000 million", citations: [{ text: "unrelated 1,000" }], abstained: false, latencyMs };
      }
      const gold = question.gold as Gold;
      const span = { text: `... ${gold.spans[0]} ...` };
      const miss = { text: "no gold here" };
      switch (bucket % 4) {
        case 0:
          return abstain;
        case 1:
          return gold.numeric
            ? { answer: "", numeric: { value: gold.numeric.value, unit: gold.numeric.unit }, citations: [span, miss], abstained: false, latencyMs }
            : { answer: gold.acceptableAnswers?.[0] ?? "", citations: [span, miss], abstained: false, latencyMs };
        case 2:
          return gold.numeric
            ? { answer: "", numeric: { value: gold.numeric.value * 1.1 + 1, unit: gold.numeric.unit }, citations: [miss], abstained: false, latencyMs }
            : { answer: "something else", citations: [miss], abstained: false, latencyMs };
        default:
          return { answer: gold.numeric ? `${gold.numeric.value}` : (gold.acceptableAnswers?.[0] ?? ""), citations: [span], abstained: false, latencyMs };
      }
    },
  };
}
