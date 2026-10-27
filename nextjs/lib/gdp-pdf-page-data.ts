/**
 * The committed GDP.pdf run reports, and the rules that decide whether one may be rendered.
 *
 * Each file under `content/benchmarks/` named in `GDP_PDF_RUNS` is a copy of a run report the
 * evaluation lane produced. None is edited here: the page reads them, this module validates them,
 * and `gdp-pdf-page-data.test.ts` recomputes every sha256 in the list so a silently swapped
 * artifact fails the suite rather than the reader. A new run is a new file and a new first row;
 * an older report is never rewritten (historical evidence is not overwritten).
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

import v2 from "../content/benchmarks/gdp-pdf.json";
import protocol from "../eval/gdp-pdf/protocol.json";

/* ------------------------------------------------------------------ the artifacts */

export type GdpPdfRun = Readonly<{
  /** The run's own name on the page. */
  id: string;
  /** Repository path of the committed report. */
  path: string;
  /**
   * The sha256 of that file as committed, LF-normalised (`.gitattributes` pins `eol=lf` for
   * `content/benchmarks/*.json`, so the working tree, the commit and CI hash the same bytes). The
   * test prints the value it computed, so a stale digest names its own fix.
   */
  sha256: string;
  /** The parsed report, untrusted until `validateGdpPdfReport` passes it. */
  report: unknown;
}>;

/**
 * Every published run, NEWEST FIRST. The page renders the first in full and the rest in its
 * "Previous runs" table. The reports carry no run timestamp (only `manifest.seed`), so the order
 * is this list's, set by the commit that adds a run.
 *
 * v2 is the 2026-09-21 two-arm run (seed gdp-pdf-20260921). Its file keeps its name and its bytes
 * for good: a later run is added above it, and v2 stays on the page as a previous run.
 */
export const GDP_PDF_RUNS: readonly GdpPdfRun[] = [
  {
    id: "v2",
    path: "nextjs/content/benchmarks/gdp-pdf.json",
    sha256: "0302712c8a0570492347d604c00a8090bff13b92cd96190d3844798aa258f953",
    report: v2,
  },
];

/** The newest run's artifact, under the names the page and its receipts already use. */
export const GDP_PDF_ARTIFACT_SHA256 = GDP_PDF_RUNS[0]!.sha256;
export const GDP_PDF_ARTIFACT_PATH = GDP_PDF_RUNS[0]!.path;

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

  /* The subset is optional, but an arm it does carry is drawn in figure 2, so it is held like any other. */
  const subset = value.compiled_available_subset;
  if (subset !== undefined) {
    if (!isRecord(subset)) problems.push("compiled_available_subset: expected an object");
    else for (const arm of GDP_PDF_PAGE_ARMS) {
      if (subset[arm] !== undefined) validateSummary(`compiled_available_subset.${arm}`, subset[arm], problems);
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
export function gdpPdfReport(run: GdpPdfRun = GDP_PDF_RUNS[0]!): GdpPdfReport {
  const problems = validateGdpPdfReport(run.report);
  if (problems.length > 0) {
    throw new Error(`${run.path} is not a publishable run report:\n- ${problems.join("\n- ")}`);
  }
  return run.report as GdpPdfReport;
}

export type GdpPdfPreviousRun = Readonly<{
  id: string;
  path: string;
  sha256: string;
  seed: string;
  model: string;
  native: Readonly<{ count: number; n: number }>;
  compiled: Readonly<{ count: number; n: number }>;
  macroDeltaPp: number;
  pairedN: number;
  deviations: number;
}>;

/**
 * The "Previous runs" table: every run after the newest, each validated like the newest and read
 * from its own report. Empty while one run is published, and the page then prints no table.
 */
export function gdpPdfPreviousRuns(runs: readonly GdpPdfRun[] = GDP_PDF_RUNS): GdpPdfPreviousRun[] {
  return runs.slice(1).map((run) => {
    const report = gdpPdfReport(run);
    const { native_pdf: native, compiled_context_pdf: compiled } = report.arms;
    return {
      id: run.id,
      path: run.path,
      sha256: run.sha256,
      seed: report.manifest.seed,
      model: report.manifest.surface.declared_model,
      native: { count: native.macro_all_pass_count, n: native.n },
      compiled: { count: compiled.macro_all_pass_count, n: compiled.n },
      macroDeltaPp: report.pairwise_delta.macro_delta_pp,
      pairedN: report.pairwise_delta.paired_n,
      deviations: gdpPdfDeviations(report).length,
    };
  });
}

/* ------------------------------------------------------------------ the two figures */

/**
 * Figure 1, the two-arm design, read from the manifest: one PDF per task, the same model in both
 * arms, one judge. The judge string carries a parenthetical about the official protocol, which the
 * conditions table prints in full; the figure names the model only.
 */
export function gdpPdfDesignFigure(run: GdpPdfReport = gdpPdfReport()) {
  const tasks = run.manifest.tasks_attempted;
  const model = run.manifest.surface.declared_model;
  const judge = run.manifest.judge.split(" ")[0]!;
  return {
    tasks,
    model,
    judge,
    alt: `Two-arm design. For each of ${tasks} tasks the same PDF goes to ${model} alone and to ${model} with TAVONEL's compiled context added; one judge, ${judge}, grades both answers against the task's rubric.`,
  };
}

export type GdpPdfPassBar = Readonly<{ arm: GdpPdfPageArm; count: number; n: number }>;
export type GdpPdfPassGroup = Readonly<{ id: "all" | "compiled_available"; n: number; bars: readonly GdpPdfPassBar[] }>;

/**
 * Figure 2, all-criteria pass per arm: every task run, and beside it the subset whose compiled
 * packet could be assembled, when the report carries that subset with its counts. Each bar is a
 * count over its own denominator, never a rate without one.
 */
export function gdpPdfPassFigure(run: GdpPdfReport = gdpPdfReport()) {
  const group = (id: GdpPdfPassGroup["id"], pair: Partial<GdpPdfArmPair>): GdpPdfPassGroup | null => {
    const bars = GDP_PDF_PAGE_ARMS.map((arm) => pair[arm]).filter((summary): summary is GdpPdfSummary => summary !== undefined);
    if (bars.length !== GDP_PDF_PAGE_ARMS.length || bars.some((summary) => summary.n !== bars[0]!.n)) return null;
    return { id, n: bars[0]!.n, bars: GDP_PDF_PAGE_ARMS.map((arm, index) => ({ arm, count: bars[index]!.macro_all_pass_count, n: bars[index]!.n })) };
  };
  const groups = [group("all", run.arms), run.compiled_available_subset ? group("compiled_available", run.compiled_available_subset) : null]
    .filter((entry): entry is GdpPdfPassGroup => entry !== null);
  const phrase = ({ id, n, bars }: GdpPdfPassGroup) =>
    `${id === "all" ? `over all ${n} tasks` : `over the ${n} tasks whose compiled packet could be assembled`}, ${bars.map((bar) => `${GDP_PDF_ARM_LABEL[bar.arm]} ${bar.count} of ${bar.n}`).join(", ")}`;
  return { groups, alt: `All-criteria pass per arm: ${groups.map(phrase).join("; ")}.` };
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
