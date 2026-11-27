/*
  The RTR-4 shadow report over foundation_router_shadow_traces (ADR-012 section 5 "Sample", WO-RTR-4). Pure: rows in,
  report out; the operator CLI (scripts/router/shadow-report.mjs) reads the rows and is this module's only importer.

  Two types, never one type with a filter (constitution: public and internal DTOs are separate types):
  - RouterShadowReportInternal: class mix, candidate routes, evidence-row agreement, reasons, run outcomes and pre-read
    feature ranges. Operator receipts only (receipts/WO-RTR-4/), never a route, page or client bundle.
  - RouterShadowSummaryPublic: counts and readiness. No class, route, evidence row, reason, cost, feature or threshold.

  Pre-read and post-read stay apart (ROUTER-AUDIT-1 gap 3): only `preRead` may ever inform a routing rule; `postRead` is
  the incumbent's own output and is marked inadmissible. Nothing here is a rate: every figure is a count, so no
  denominator is hidden, and an empty set gives null, never 0. The shadow has zero authority; so does this report.
*/

export const ROUTER_SHADOW_REPORT_SCHEMA = "tavonel.router_shadow_report.v2";
export const ROUTER_SHADOW_SUMMARY_SCHEMA = "tavonel.router_shadow_summary.v1";
/** ADR-012 section 5: review once at least this many compiles are traced. A count, not a calibrated threshold. */
export const ROUTER_SHADOW_REVIEW_AFTER_COMPILES = 100;

/** One row as read_router_shadow_traces returns it (20261127060000): the table row without workspace and trace key. */
export type RouterShadowTraceRow = {
  run_kind: string;
  run_ref: string;
  document_id: string;
  version_key: string;
  page_index0: number | null;
  page_class: string | null;
  incumbent_route: string | null;
  evidence_row_id: string | null;
  candidate_route: string | null;
  agrees_with_incumbent: boolean | null;
  cost_usd: number | null;
  cost_reason: string | null;
  outcome_class: "ok" | "operational" | "semantic";
  reason_code: string | null;
  table_sha256: string;
  trace_version: 1 | 2;
  pre_page_count: number | null;
  pre_source_bytes: number | null;
  run_outcome_class: string | null;
  run_reason_code: string | null;
  created_at: string;
};

type Counts = Record<string, number>;
type Spread = { n: number; min: number; median: number; max: number } | null;

export type RouterShadowReportInternal = {
  schemaVersion: typeof ROUTER_SHADOW_REPORT_SCHEMA;
  generatedAt: string;
  window: { since: string; until: string };
  authority: "none";
  read: { rows: number; rowsInvalid: number; complete: boolean; incompleteReason: "TRUNCATED" | "ROWS_INVALID" | null };
  compiles: { traced: number; reviewAfter: number; readyForReview: boolean };
  traceVersions: Counts;
  evidenceTables: Counts;
  preRead: {
    admissibleAsRoutingInput: true;
    documents: number;
    pagesPerDocument: Spread;
    sourceBytesPerPage: Spread;
  };
  postRead: {
    admissibleAsRoutingInput: false;
    why: "page class, conflicts and page reasons are the incumbent reader's own output";
    pages: number;
    pageClasses: Counts;
    pageOutcomes: Counts;
    documentFailures: { operational: Counts; semantic: Counts };
  };
  candidatePath: {
    pagesWithCandidate: number;
    byCandidateRoute: Counts;
    agreesWithIncumbent: Counts;
    costMeasuredPages: number;
    costUnmeasuredPages: number;
    costUsdMeasured: number | null;
  };
  runOutcomes: { runsWithOutcome: number; runsWithoutOutcome: number; byOutcome: Counts };
};

export type RouterShadowSummaryPublic = {
  schemaVersion: typeof ROUTER_SHADOW_SUMMARY_SCHEMA;
  generatedAt: string;
  authority: "none";
  tracedCompiles: number;
  tracedPages: number;
  complete: boolean;
  reviewReady: boolean;
};

const OUTCOMES = new Set(["ok", "operational", "semantic"]);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** A row the report can count. Anything else is counted as invalid and makes the read incomplete, never guessed. */
export function isRouterShadowTraceRow(value: unknown): value is RouterShadowTraceRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return isText(row.run_ref) && isText(row.document_id) && isText(row.version_key) && isText(row.table_sha256)
    && OUTCOMES.has(row.outcome_class as string) && (row.trace_version === 1 || row.trace_version === 2)
    && (row.page_index0 === null || isCount(row.page_index0))
    && (row.pre_page_count === null || isCount(row.pre_page_count))
    && (row.pre_source_bytes === null || isCount(row.pre_source_bytes))
    && (row.cost_usd === null || (typeof row.cost_usd === "number" && Number.isFinite(row.cost_usd) && row.cost_usd >= 0));
}

function bump(counts: Counts, key: string | null | boolean) {
  const name = String(key);
  counts[name] = (counts[name] ?? 0) + 1;
}

function spread(values: number[]): Spread {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { n: sorted.length, min: sorted[0]!, median, max: sorted.at(-1)! };
}

export function buildRouterShadowReport(input: {
  rows: readonly unknown[];
  truncated: boolean;
  since: Date;
  now: Date;
}): RouterShadowReportInternal {
  const rows = input.rows.filter(isRouterShadowTraceRow);
  const rowsInvalid = input.rows.length - rows.length;
  const complete = !input.truncated && rowsInvalid === 0;
  const runs = new Set<string>();
  const traceVersions: Counts = {};
  const evidenceTables: Counts = {};
  const pageClasses: Counts = {};
  const pageOutcomes: Counts = {};
  const failures = { operational: {} as Counts, semantic: {} as Counts };
  const byCandidateRoute: Counts = {};
  const agrees: Counts = {};
  const runOutcome = new Map<string, string | null>();
  const documents = new Map<string, { pages: number | null; bytes: number | null }>();
  let pages = 0;
  let pagesWithCandidate = 0;
  let costMeasured = 0;
  let costUnmeasured = 0;
  let costUsd = 0;

  for (const row of rows) {
    const run = `${row.run_kind}|${row.run_ref}`;
    runs.add(run);
    bump(traceVersions, String(row.trace_version));
    bump(evidenceTables, row.table_sha256);
    // A run's outcome is the one its v2 rows carry; a run seen only in v1 rows has none (not measured, not "ok").
    if (row.trace_version === 2 && !runOutcome.get(run)) runOutcome.set(run, `${row.run_outcome_class}:${row.run_reason_code ?? "-"}`);
    else if (!runOutcome.has(run)) runOutcome.set(run, null);
    // Pre-read features belong to the document version, so a version compiled twice counts once.
    const documentKey = `${row.document_id}|${row.version_key}`;
    const known = documents.get(documentKey) ?? { pages: null, bytes: null };
    documents.set(documentKey, { pages: known.pages ?? row.pre_page_count, bytes: known.bytes ?? row.pre_source_bytes });

    if (row.page_index0 === null) {
      if (row.outcome_class !== "ok") bump(failures[row.outcome_class], row.reason_code);
      continue;
    }
    pages += 1;
    bump(pageClasses, row.page_class);
    bump(pageOutcomes, row.outcome_class === "ok" ? "ok" : `${row.outcome_class}:${row.reason_code}`);
    // v1 rows did not store the candidate route; the evidence row named it, so they count as "no candidate recorded".
    if (row.candidate_route !== null) {
      pagesWithCandidate += 1;
      bump(byCandidateRoute, row.candidate_route);
    }
    bump(agrees, row.agrees_with_incumbent);
    if (row.cost_usd === null) costUnmeasured += 1;
    else {
      costMeasured += 1;
      costUsd += row.cost_usd;
    }
  }

  const byOutcome: Counts = {};
  let runsWithoutOutcome = 0;
  for (const outcome of runOutcome.values()) {
    if (outcome === null) runsWithoutOutcome += 1;
    else bump(byOutcome, outcome);
  }
  const perDocument = [...documents.values()];
  const traced = runs.size;
  return {
    schemaVersion: ROUTER_SHADOW_REPORT_SCHEMA,
    generatedAt: input.now.toISOString(),
    window: { since: input.since.toISOString(), until: input.now.toISOString() },
    authority: "none",
    read: { rows: input.rows.length, rowsInvalid, complete,
      incompleteReason: input.truncated ? "TRUNCATED" : rowsInvalid > 0 ? "ROWS_INVALID" : null },
    compiles: { traced, reviewAfter: ROUTER_SHADOW_REVIEW_AFTER_COMPILES,
      readyForReview: complete && traced >= ROUTER_SHADOW_REVIEW_AFTER_COMPILES },
    traceVersions,
    evidenceTables,
    preRead: {
      admissibleAsRoutingInput: true,
      documents: perDocument.length,
      pagesPerDocument: spread(perDocument.flatMap((d) => (d.pages === null ? [] : [d.pages]))),
      sourceBytesPerPage: spread(perDocument.flatMap((d) => (d.pages === null || d.bytes === null ? [] : [Math.round(d.bytes / d.pages)]))),
    },
    postRead: {
      admissibleAsRoutingInput: false,
      why: "page class, conflicts and page reasons are the incumbent reader's own output",
      pages,
      pageClasses,
      pageOutcomes,
      documentFailures: failures,
    },
    candidatePath: {
      pagesWithCandidate,
      byCandidateRoute,
      agreesWithIncumbent: agrees,
      costMeasuredPages: costMeasured,
      costUnmeasuredPages: costUnmeasured,
      costUsdMeasured: costMeasured === 0 ? null : Number(costUsd.toFixed(6)),
    },
    runOutcomes: { runsWithOutcome: runOutcome.size - runsWithoutOutcome, runsWithoutOutcome, byOutcome },
  };
}

/** Built field by field from the internal report: nothing internal can ride along by accident. */
export function toPublicRouterShadowSummary(report: RouterShadowReportInternal): RouterShadowSummaryPublic {
  return {
    schemaVersion: ROUTER_SHADOW_SUMMARY_SCHEMA,
    generatedAt: report.generatedAt,
    authority: "none",
    tracedCompiles: report.compiles.traced,
    tracedPages: report.postRead.pages,
    complete: report.read.complete,
    reviewReady: report.compiles.readyForReview,
  };
}

const line = (counts: Counts) => (Object.keys(counts).length === 0 ? "none" : Object.entries(counts)
  .sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key} ${value}`).join(", "));
const spreadLine = (value: Spread) => (value === null ? "not measured" : `n ${value.n}, min ${value.min}, median ${value.median}, max ${value.max}`);

export function renderRouterShadowReportMarkdown(report: RouterShadowReportInternal): string {
  const r = report;
  return [
    `# Router shadow report (internal) - ${r.generatedAt}`,
    "",
    `Window ${r.window.since} to ${r.window.until}. Authority: none. Every figure is a count over the rows read.`,
    "",
    `- rows read: ${r.read.rows} (invalid ${r.read.rowsInvalid}); complete: ${r.read.complete}${r.read.incompleteReason ? ` (${r.read.incompleteReason})` : ""}`,
    `- compiles traced: ${r.compiles.traced}; review after: ${r.compiles.reviewAfter}; ready for review: ${r.compiles.readyForReview}`,
    `- trace versions: ${line(r.traceVersions)}`,
    `- evidence tables: ${line(r.evidenceTables)}`,
    "",
    "## Pre-read features (admissible as routing input)",
    "",
    `- documents: ${r.preRead.documents}`,
    `- pages per document: ${spreadLine(r.preRead.pagesPerDocument)}`,
    `- source bytes per page: ${spreadLine(r.preRead.sourceBytesPerPage)}`,
    "",
    "## Post-read outcome of the incumbent (NOT admissible as routing input)",
    "",
    `- pages: ${r.postRead.pages}`,
    `- page classes: ${line(r.postRead.pageClasses)}`,
    `- page outcomes: ${line(r.postRead.pageOutcomes)}`,
    `- document failures, operational: ${line(r.postRead.documentFailures.operational)}`,
    `- document failures, semantic: ${line(r.postRead.documentFailures.semantic)}`,
    "",
    "## Candidate path",
    "",
    `- pages with a recorded candidate route: ${r.candidatePath.pagesWithCandidate} of ${r.postRead.pages}`,
    `- by candidate route: ${line(r.candidatePath.byCandidateRoute)}`,
    `- candidate agrees with incumbent: ${line(r.candidatePath.agreesWithIncumbent)}`,
    `- cost measured on ${r.candidatePath.costMeasuredPages} pages, not measured on ${r.candidatePath.costUnmeasuredPages}; `
      + `measured total USD: ${r.candidatePath.costUsdMeasured ?? "not measured"}`,
    "",
    "## Run outcomes",
    "",
    `- runs with an outcome: ${r.runOutcomes.runsWithOutcome}; without (v1 rows only): ${r.runOutcomes.runsWithoutOutcome}`,
    `- by outcome: ${line(r.runOutcomes.byOutcome)}`,
    "",
  ].join("\n");
}
