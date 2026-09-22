/**
 * The committed GDP.pdf run report, and the rules that decide whether it may be rendered.
 *
 * `content/benchmarks/gdp-pdf.json` is a copy of the run report the evaluation lane produced. It
 * is not edited here: the page reads it, this module validates it, and
 * `gdp-pdf-page-data.test.ts` recomputes its sha256 against `GDP_PDF_ARTIFACT_SHA256` so a
 * silently swapped artifact fails the suite rather than the reader.
 *
 * Three things this file exists to prevent, all of them constitution rules rather than taste:
 *
 *   1. A rate without its denominator. Every summary carries `n`, and every rate on it carries
 *      the count it was computed from. A summary with `macro_all_pass` and no
 *      `macro_all_pass_count` is refused, and so is one whose rate does not equal its own
 *      count over its own denominator.
 *   2. A number the artifact does not contain. The page's headline sentence is chosen from the
 *      sign of the measured delta by `gdpPdfVerdict`; there is no branch that can print an
 *      improvement the report does not carry. On the committed run the delta is negative, and
 *      the page says so.
 *   3. A deviation that quietly disappears. `gdpPdfDeviations` diffs the run manifest against the
 *      sealed protocol in `eval/gdp-pdf/protocol.json`, so the conditions panel is generated from
 *      the two documents rather than written by hand. A deviation cannot be dropped from the page
 *      without changing one of them.
 *
 * Validation is fail-closed: `gdpPdfReport()` throws on the first invalid artifact, which turns a
 * bad swap into a build failure. It does not fall back to the previous report, and it does not
 * render a partial page.
 */

import report from "../content/benchmarks/gdp-pdf.json";
import protocol from "../eval/gdp-pdf/protocol.json";

/* ------------------------------------------------------------------ the artifact */

/**
 * The sha256 of `content/benchmarks/gdp-pdf.json` as committed, LF-normalised (`.gitattributes`
 * pins `eol=lf` so the working tree, the commit and CI hash the same bytes).
 *
 * Replacing the artifact means replacing this line in the same commit. The test prints the value
 * it computed, so a stale digest names its own fix.
 */
export const GDP_PDF_ARTIFACT_SHA256 =
  "0302712c8a0570492347d604c00a8090bff13b92cd96190d3844798aa258f953" as const;

export const GDP_PDF_ARTIFACT_PATH = "nextjs/content/benchmarks/gdp-pdf.json" as const;

/* ------------------------------------------------------------------ shape */

/** The two arms this page publishes. The sealed protocol names four; two were run. */
export const GDP_PDF_PAGE_ARMS = ["native_pdf", "compiled_context_pdf"] as const;
export type GdpPdfPageArm = (typeof GDP_PDF_PAGE_ARMS)[number];

export const GDP_PDF_ARM_LABEL: Record<GdpPdfPageArm, string> = {
  native_pdf: "PDF alone",
  compiled_context_pdf: "PDF + compiled context",
};

export type GdpPdfSummary = Readonly<{
  n: number;
  macro_all_pass: number;
  macro_all_pass_count: number;
  micro_mean_criteria: number;
  criteria_passed_total: number;
  criteria_total: number;
  subject_failures: number;
  adapter_failures: number;
  judge_failures: number;
  input_tokens_total: number;
  input_tokens_reported_for: number;
  output_tokens_total: number;
  latency_p50_seconds: number;
  latency_p95_seconds: number;
  latency_mean_seconds: number;
  subject_cost_usd_micros_total: number;
  judge_cost_usd_micros_total: number;
  cost_complete: boolean;
}>;

export type GdpPdfArmPair = Readonly<Record<GdpPdfPageArm, GdpPdfSummary>>;

/**
 * One row of the hardest-documents table.
 *
 * Optional on purpose. The report builder computes this ranking for its markdown but does not
 * yet write it into `report.json`; until it does, the page prints why the table is absent rather
 * than inventing rows. No document title and no document content is carried here — the corpus
 * retains third-party rights — only the task id, which is a pointer into the restricted run
 * store.
 */
export type GdpPdfHardestDocument = Readonly<{
  task_id: string;
  domain: string;
  pages: number;
  scanned?: boolean;
  criteria: number;
  native_pdf_passed: number;
  native_pdf_all_pass: boolean;
  compiled_context_pdf_passed?: number;
  compiled_context_pdf_all_pass?: boolean;
}>;

export type GdpPdfManifest = Readonly<{
  dataset_revision: string;
  sealed_revision: string;
  sealed_revision_unreachable?: string;
  task_set_digest: string;
  task_count_in_catalog: number;
  tasks_attempted: number;
  epoch: number;
  judge: string;
  seed: string;
  official_comparable: boolean;
  prompt_template_digests: Readonly<Record<string, string>>;
  surface: Readonly<{
    surface: string;
    declared_model: string;
    tools: readonly string[];
    official_comparable: boolean;
    official_comparable_reason?: string;
  }>;
}>;

export type GdpPdfReport = Readonly<{
  arms: GdpPdfArmPair;
  paired: GdpPdfArmPair;
  per_domain: Readonly<Record<string, GdpPdfArmPair>>;
  pairwise_delta: Readonly<{ macro_delta_pp: number; micro_delta_pp: number; paired_n: number }>;
  compiled_available_subset?: Readonly<
    { n: number; macro_delta_pp?: number; micro_delta_pp?: number } & Partial<GdpPdfArmPair>
  >;
  manifest: GdpPdfManifest;
  official_comparable: boolean;
  cells_recorded: number;
  hardest_documents?: readonly GdpPdfHardestDocument[];
  /*
    Packet size, as measured. `packets_truncated_by_budget` is the count of compiled packets that
    hit the adapter's character budget and were cut before the model saw them -- a condition of
    the run, published beside the result rather than argued against it.
  */
  packet_size?: Readonly<{ n: number; packets_truncated_by_budget?: number }>;
}>;

/* ------------------------------------------------------------------ validation */

const COUNT_FIELDS = [
  "n",
  "macro_all_pass_count",
  "criteria_passed_total",
  "criteria_total",
  "subject_failures",
  "adapter_failures",
  "judge_failures",
  "input_tokens_total",
  "input_tokens_reported_for",
  "output_tokens_total",
  "subject_cost_usd_micros_total",
  "judge_cost_usd_micros_total",
] as const;

const RATE_TO_COUNT = [["macro_all_pass", "macro_all_pass_count"]] as const;

const RATE_FIELDS = ["macro_all_pass", "micro_mean_criteria"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Every refusal this module knows how to state, as a list rather than a throw, so the test can
 * assert on the message and the caller can decide what a failure means.
 *
 * A summary is checked for four things, in the order a reader would notice them missing: the
 * denominator, then the counts, then each rate against the count it claims to summarise, then
 * the internal consistency of the criteria totals.
 */
function validateSummary(where: string, value: unknown, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${where}: expected a summary object`);
    return;
  }

  if (!isFiniteNumber(value.n) || !Number.isInteger(value.n) || value.n <= 0) {
    problems.push(`${where}: missing denominator (n)`);
  }

  for (const field of COUNT_FIELDS) {
    const count = value[field];
    if (count === undefined) {
      problems.push(`${where}.${field}: missing count`);
      continue;
    }
    if (!isFiniteNumber(count) || !Number.isInteger(count)) {
      problems.push(`${where}.${field}: count is not an integer`);
      continue;
    }
    if (count < 0) problems.push(`${where}.${field}: negative count`);
  }

  for (const field of RATE_FIELDS) {
    const rate = value[field];
    if (!isFiniteNumber(rate)) {
      problems.push(`${where}.${field}: missing rate`);
      continue;
    }
    if (rate < 0 || rate > 1) problems.push(`${where}.${field}: rate outside 0..1`);
  }

  for (const [rateField, countField] of RATE_TO_COUNT) {
    const rate = value[rateField];
    const count = value[countField];
    if (isFiniteNumber(rate) && count === undefined) {
      problems.push(`${where}.${rateField}: rate without its count (${countField})`);
      continue;
    }
    if (isFiniteNumber(rate) && isFiniteNumber(count) && isFiniteNumber(value.n) && value.n > 0) {
      if (Math.abs(rate - count / value.n) > 1e-9) {
        problems.push(`${where}.${rateField}: rate does not equal ${countField} / n`);
      }
    }
  }

  if (
    isFiniteNumber(value.criteria_passed_total) &&
    isFiniteNumber(value.criteria_total) &&
    value.criteria_passed_total > value.criteria_total
  ) {
    problems.push(`${where}: criteria_passed_total exceeds criteria_total`);
  }

  if (typeof value.cost_complete !== "boolean") {
    problems.push(`${where}.cost_complete: expected a boolean`);
  }

  for (const field of ["latency_p50_seconds", "latency_p95_seconds", "latency_mean_seconds"]) {
    const seconds = value[field];
    if (!isFiniteNumber(seconds)) problems.push(`${where}.${field}: missing latency`);
    else if (seconds < 0) problems.push(`${where}.${field}: negative latency`);
  }
}

/** Both arms, exactly — an arm the page has no label for is refused, not skipped. */
function validateArmPair(where: string, value: unknown, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${where}: expected an object of arm summaries`);
    return;
  }
  for (const arm of Object.keys(value)) {
    if (!(GDP_PDF_PAGE_ARMS as readonly string[]).includes(arm)) {
      problems.push(`${where}: unknown arm "${arm}"`);
    }
  }
  for (const arm of GDP_PDF_PAGE_ARMS) {
    if (value[arm] === undefined) {
      problems.push(`${where}: missing arm "${arm}"`);
      continue;
    }
    validateSummary(`${where}.${arm}`, value[arm], problems);
  }
}

export function validateGdpPdfReport(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ["report: expected an object"];

  validateArmPair("arms", value.arms, problems);
  validateArmPair("paired", value.paired, problems);

  if (!isRecord(value.per_domain)) {
    problems.push("per_domain: expected an object of domains");
  } else {
    for (const [domain, pair] of Object.entries(value.per_domain)) {
      validateArmPair(`per_domain.${domain}`, pair, problems);
    }
  }

  const delta = value.pairwise_delta;
  if (!isRecord(delta)) {
    problems.push("pairwise_delta: missing");
  } else {
    for (const field of ["macro_delta_pp", "micro_delta_pp"]) {
      if (!isFiniteNumber(delta[field])) problems.push(`pairwise_delta.${field}: missing`);
    }
    if (!isFiniteNumber(delta.paired_n) || !Number.isInteger(delta.paired_n) || delta.paired_n <= 0) {
      problems.push("pairwise_delta: missing denominator (paired_n)");
    }
  }

  const manifest = value.manifest;
  if (!isRecord(manifest)) {
    problems.push("manifest: missing");
  } else {
    for (const field of ["dataset_revision", "sealed_revision", "task_set_digest", "judge", "seed"]) {
      if (typeof manifest[field] !== "string" || (manifest[field] as string).length === 0) {
        problems.push(`manifest.${field}: missing`);
      }
    }
    for (const field of ["task_count_in_catalog", "tasks_attempted", "epoch"]) {
      const count = manifest[field];
      if (!isFiniteNumber(count) || !Number.isInteger(count)) problems.push(`manifest.${field}: missing count`);
      else if (count < 0) problems.push(`manifest.${field}: negative count`);
    }
    if (!isRecord(manifest.prompt_template_digests)) problems.push("manifest.prompt_template_digests: missing");
    if (!isRecord(manifest.surface)) {
      problems.push("manifest.surface: missing");
    } else {
      for (const field of ["surface", "declared_model"]) {
        if (typeof manifest.surface[field] !== "string") problems.push(`manifest.surface.${field}: missing`);
      }
      if (!Array.isArray(manifest.surface.tools)) problems.push("manifest.surface.tools: missing");
    }
  }

  if (typeof value.official_comparable !== "boolean") problems.push("official_comparable: missing");
  if (!isFiniteNumber(value.cells_recorded) || value.cells_recorded < 0) {
    problems.push("cells_recorded: missing count");
  }

  if (value.hardest_documents !== undefined) {
    if (!Array.isArray(value.hardest_documents)) {
      problems.push("hardest_documents: expected an array");
    } else {
      value.hardest_documents.forEach((row, index) => {
        const at = `hardest_documents[${index}]`;
        if (!isRecord(row)) {
          problems.push(`${at}: expected an object`);
          return;
        }
        if (typeof row.task_id !== "string" || row.task_id.length === 0) problems.push(`${at}.task_id: missing`);
        if (typeof row.domain !== "string" || row.domain.length === 0) problems.push(`${at}.domain: missing`);
        for (const field of ["pages", "criteria", "native_pdf_passed"]) {
          const count = row[field];
          if (!isFiniteNumber(count) || !Number.isInteger(count)) problems.push(`${at}.${field}: missing count`);
          else if (count < 0) problems.push(`${at}.${field}: negative count`);
        }
      });
    }
  }

  return problems;
}

/**
 * The validated report, or a throw. There is no third outcome: a page that cannot prove its
 * numbers does not render a reduced version of itself.
 */
export function gdpPdfReport(): GdpPdfReport {
  const problems = validateGdpPdfReport(report);
  if (problems.length > 0) {
    throw new Error(`${GDP_PDF_ARTIFACT_PATH} is not a publishable run report:\n- ${problems.join("\n- ")}`);
  }
  return report as unknown as GdpPdfReport;
}

/* ------------------------------------------------------------------ the headline sentence */

export type GdpPdfVerdict = "improved" | "no_difference" | "worse";

/**
 * Below this many percentage points the two arms are reported as indistinguishable rather than
 * as a direction. It is a rounding floor, not a significance test: the page has no confidence
 * interval and does not pretend to one.
 */
const DELTA_FLOOR_PP = 0.05;

export function gdpPdfVerdict(deltaPp: number): GdpPdfVerdict {
  if (!Number.isFinite(deltaPp)) throw new Error("gdpPdfVerdict: delta is not a number");
  if (Math.abs(deltaPp) < DELTA_FLOOR_PP) return "no_difference";
  return deltaPp > 0 ? "improved" : "worse";
}

/**
 * The page's h1, chosen by the same sign as the sentence under it.
 *
 * A headline written by hand is the one line that survives an artifact swap while ceasing to be
 * true, which is exactly the failure this page is about. It is a function for the same reason
 * the sentence is.
 */
export function gdpPdfHeadline(deltaPp: number): string {
  const verdict = gdpPdfVerdict(deltaPp);
  if (verdict === "no_difference") return "Compiled context made no measurable difference.";
  if (verdict === "improved") return "Compiled context beat the PDF alone.";
  return "Compiled context did not beat the PDF.";
}

/**
 * The headline sentence, chosen by the sign of the measured delta.
 *
 * Three branches, one of which is the one the committed artifact takes. There is no default
 * sentence and no positive phrasing reachable from a negative delta — the reason this is a
 * function and not page copy.
 */
export function gdpPdfDeltaSentence(deltaPp: number, pairedN: number, metric: string): string {
  const verdict = gdpPdfVerdict(deltaPp);
  const size = Math.abs(deltaPp).toFixed(1);
  const over = `over the ${pairedN} task${pairedN === 1 ? "" : "s"} run in both arms`;
  if (verdict === "no_difference") {
    return `Adding TAVONEL's compiled context to the PDF moved ${metric} by less than ${DELTA_FLOOR_PP} percentage points ${over}. On this run it made no measurable difference.`;
  }
  if (verdict === "improved") {
    return `Adding TAVONEL's compiled context to the PDF raised ${metric} by ${size} percentage points ${over}.`;
  }
  return `Adding TAVONEL's compiled context to the PDF lowered ${metric} by ${size} percentage points ${over}. The compiled arm scored worse than the PDF alone, and that is the result.`;
}

/* ------------------------------------------------------------------ conditions */

export type GdpPdfDeviation = Readonly<{
  id: string;
  label: string;
  official: string;
  actual: string;
  note?: string;
}>;

/**
 * The run conditions that differ from the sealed official condition, computed by diffing the run
 * manifest against `eval/gdp-pdf/protocol.json` rather than listed by hand.
 *
 * A row appears because the two documents disagree. Removing a row from the page means changing
 * the run or the protocol, which is the only honest way to lose one.
 */
export function gdpPdfDeviations(run: GdpPdfReport = gdpPdfReport()): GdpPdfDeviation[] {
  const { manifest } = run;
  const official = protocol.officialComparableCondition;
  const rows: GdpPdfDeviation[] = [];

  if (official.tools === "disabled" && manifest.surface.tools.length > 0) {
    rows.push({
      id: "surface",
      label: "Surface",
      official: "No tools. The model receives the question and the PDF and answers in one turn.",
      actual: `${manifest.surface.surface} — the ${manifest.surface.tools.join(", ")} tool${manifest.surface.tools.length === 1 ? " is" : "s are"} enabled, so the model pages through the PDF agentically.`,
      note: manifest.surface.official_comparable_reason,
    });
  }

  if (!manifest.judge.startsWith(official.judgeModelAlias)) {
    rows.push({
      id: "judge",
      label: "Judge",
      official: official.judgeModelAlias,
      actual: manifest.judge,
      note: "The grading model is not the one the official protocol names, so a score here and a score there were not marked by the same marker.",
    });
  }

  if (manifest.dataset_revision !== protocol.dataset.revision) {
    rows.push({
      id: "dataset_revision",
      label: "Dataset revision",
      official: protocol.dataset.revision,
      actual: manifest.dataset_revision,
      note: manifest.sealed_revision_unreachable,
    });
  }

  if (manifest.epoch !== official.epochs) {
    rows.push({
      id: "epochs",
      label: "Epochs",
      official: `${official.epochs} epochs per task`,
      actual: `${manifest.epoch} epoch per task`,
      note: "A single epoch measures one draw from a non-deterministic model. The official condition averages five.",
    });
  }

  if (manifest.tasks_attempted !== manifest.task_count_in_catalog) {
    rows.push({
      id: "tasks",
      label: "Tasks",
      official: `${manifest.task_count_in_catalog} tasks in the catalogue`,
      actual: `${manifest.tasks_attempted} attempted in this run`,
      note: "Every rate on this page is over the tasks actually run, never over the catalogue.",
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ formatting */

export const gdpPdfPercent = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

export const gdpPdfPoints = (pp: number): string => `${pp > 0 ? "+" : pp < 0 ? "−" : ""}${Math.abs(pp).toFixed(1)} pp`;

export const gdpPdfSeconds = (seconds: number): string => `${seconds.toFixed(1)}s`;

export const gdpPdfTokens = (tokens: number): string => tokens.toLocaleString("en-US");

/** USD micros to a dollar figure. List-price equivalent; the page says so beside every one. */
export const gdpPdfUsd = (micros: number): string => `$${(micros / 1_000_000).toFixed(4)}`;

/**
 * What the run's own failure counters say the page cannot claim.
 *
 * Generated from the counters rather than written once and left behind: an adapter failure means
 * "no compiled packet existed for this document", which is a different finding from "the packet
 * did not help", and the distinction survives only if the count is read.
 */
export function gdpPdfFailureNotes(run: GdpPdfReport = gdpPdfReport()): string[] {
  const notes: string[] = [];
  for (const arm of GDP_PDF_PAGE_ARMS) {
    const summary = run.arms[arm];
    if (summary.adapter_failures > 0) {
      notes.push(
        `${GDP_PDF_ARM_LABEL[arm]}: ${summary.adapter_failures} of ${summary.n} task${summary.n === 1 ? "" : "s"} scored zero because the arm could not be assembled, not because the answer was wrong. The zeros stay in the denominator, as the sealed failure policy requires.`,
      );
    }
    if (summary.subject_failures > 0) {
      notes.push(`${GDP_PDF_ARM_LABEL[arm]}: ${summary.subject_failures} of ${summary.n} task${summary.n === 1 ? "" : "s"} failed in the model call and scored zero.`);
    }
    if (summary.judge_failures > 0) {
      notes.push(`${GDP_PDF_ARM_LABEL[arm]}: ${summary.judge_failures} of ${summary.n} task${summary.n === 1 ? "" : "s"} could not be graded and scored zero.`);
    }
    if (!summary.cost_complete) {
      notes.push(
        `${GDP_PDF_ARM_LABEL[arm]}: the cost column is incomplete. The price snapshot carries no cache-token price, so the figure covers uncached input and output only and understates the run.`,
      );
    }
    if (summary.input_tokens_reported_for < summary.n) {
      notes.push(
        `${GDP_PDF_ARM_LABEL[arm]}: input tokens were reported for ${summary.input_tokens_reported_for} of ${summary.n} task${summary.n === 1 ? "" : "s"}, so the token total is a floor.`,
      );
    }
  }
  return notes;
}
