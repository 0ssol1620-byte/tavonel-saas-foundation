import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildRouterShadowReport,
  renderRouterShadowReportMarkdown,
  ROUTER_SHADOW_REPORT_SCHEMA,
  ROUTER_SHADOW_REVIEW_AFTER_COMPILES,
  toPublicRouterShadowSummary,
} from "../../lib/router-shadow-report.ts";
import { parseShadowReportArgs, readShadowTraces, renderShadowReport } from "./shadow-report.mjs";

/*
  WO-RTR-GAPS-1: the RTR-4 report over foundation_router_shadow_traces. What it proves: counts from real row shapes
  (v1 and v2), pre-read features apart from post-read ones, the candidate path and run outcomes, a truncated or
  malformed read is never complete or ready, and the public summary is a separate type that carries no route
  feature, class, reason, evidence row, cost or threshold.
*/

const NOW = new Date("2026-11-27T12:00:00.000Z");
const SINCE = new Date(0);
const JOB = `cjob-${"1".repeat(32)}`;
const DOC = "0c0c0c0c-0000-4000-8000-00000000000a";
const TABLE = `sha256:${"b".repeat(64)}`;

function page(index, over = {}) {
  return {
    run_kind: "compile_job", run_ref: JOB, document_id: DOC, version_key: "a".repeat(64), page_index0: index,
    page_class: "native_text", incumbent_route: "native_text", evidence_row_id: "RT-1", candidate_route: "native_text",
    agrees_with_incumbent: true, cost_usd: null, cost_reason: "COST_UNMEASURED", outcome_class: "ok", reason_code: null,
    table_sha256: TABLE, trace_version: 2, pre_page_count: 3, pre_source_bytes: 3000, run_outcome_class: "ok",
    run_reason_code: null, created_at: "2026-11-27T10:00:00.000Z", input_sha256: `sha256:${"a".repeat(64)}`,
    ocr_schema_version: "tavonel.ocr_result.v2", reader_revision: null, reader_binding_sha256: null,
    recognition_conflict_count: 0, table_version: 1, ...over,
  };
}
const documentRow = (over) => page(null, { page_class: null, incumbent_route: null, evidence_row_id: null, candidate_route: null,
  agrees_with_incumbent: null, cost_reason: null, pre_page_count: null, recognition_conflict_count: null, input_sha256: null,
  ocr_schema_version: null, ...over });

const rows = () => [
  page(0),
  page(1, { page_class: "raster_text", incumbent_route: "rapidocr_raster", evidence_row_id: "RT-3", candidate_route: "rapidocr_raster" }),
  page(2, { page_class: "no_text", incumbent_route: "rapidocr_raster", evidence_row_id: "RT-3", candidate_route: "rapidocr_raster",
    outcome_class: "semantic", reason_code: "EMPTY_PAGE" }),
  documentRow({ document_id: "0c0c0c0c-0000-4000-8000-00000000000b", outcome_class: "operational", reason_code: "OCR_READ_TIMEOUT", pre_source_bytes: 10 }),
  // A second run whose Core timed out, and a v1-only run (no outcome, no candidate recorded).
  page(0, { run_ref: `cjob-${"2".repeat(32)}`, run_outcome_class: "operational", run_reason_code: "CORE_TIMEOUT" }),
  page(0, { run_ref: `cjob-${"3".repeat(32)}`, trace_version: 1, candidate_route: null, pre_page_count: null, pre_source_bytes: null,
    run_outcome_class: null, run_reason_code: null, document_id: "0c0c0c0c-0000-4000-8000-00000000000c" }),
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildRouterShadowReport", () => {
  it("counts runs, pages, classes, failures, candidate routes and run outcomes from the rows", () => {
    const report = buildRouterShadowReport({ rows: rows(), truncated: false, since: SINCE, now: NOW });
    expect(report.schemaVersion).toBe(ROUTER_SHADOW_REPORT_SCHEMA);
    expect(report.authority).toBe("none");
    expect(report.read).toEqual({ rows: 6, rowsInvalid: 0, complete: true, incompleteReason: null });
    expect(report.compiles).toEqual({ traced: 3, reviewAfter: ROUTER_SHADOW_REVIEW_AFTER_COMPILES, readyForReview: false });
    expect(report.traceVersions).toEqual({ 1: 1, 2: 5 });
    expect(report.postRead).toMatchObject({ admissibleAsRoutingInput: false, pages: 5,
      pageClasses: { native_text: 3, raster_text: 1, no_text: 1 },
      pageOutcomes: { ok: 4, "semantic:EMPTY_PAGE": 1 },
      documentFailures: { operational: { OCR_READ_TIMEOUT: 1 }, semantic: {} } });
    expect(report.candidatePath).toEqual({ pagesWithCandidate: 4, byCandidateRoute: { native_text: 2, rapidocr_raster: 2 },
      agreesWithIncumbent: { true: 5 }, costMeasuredPages: 0, costUnmeasuredPages: 5, costUsdMeasured: null });
    expect(report.runOutcomes).toEqual({ runsWithOutcome: 2, runsWithoutOutcome: 1,
      byOutcome: { "ok:-": 1, "operational:CORE_TIMEOUT": 1 } });
  });

  it("keeps pre-read features apart: one entry per document version, measured only where both values exist", () => {
    const { preRead } = buildRouterShadowReport({ rows: rows(), truncated: false, since: SINCE, now: NOW });
    // DOC (3 pages, 3000 B, seen in two runs) counts once; document b has bytes but no page count; c has neither.
    expect(preRead).toEqual({ admissibleAsRoutingInput: true, documents: 3,
      pagesPerDocument: { n: 1, min: 3, median: 3, max: 3 }, sourceBytesPerPage: { n: 1, min: 1000, median: 1000, max: 1000 } });
  });

  it("an empty read is complete but measures nothing: null spreads, zero counts, not ready", () => {
    const report = buildRouterShadowReport({ rows: [], truncated: false, since: SINCE, now: NOW });
    expect(report.preRead.pagesPerDocument).toBeNull();
    expect(report.compiles.readyForReview).toBe(false);
  });

  it("a truncated or malformed read is incomplete and never ready, whatever the count", () => {
    const many = Array.from({ length: ROUTER_SHADOW_REVIEW_AFTER_COMPILES }, (_, i) => page(0, { run_ref: `cjob-${i.toString(16).padStart(32, "0")}` }));
    expect(buildRouterShadowReport({ rows: many, truncated: false, since: SINCE, now: NOW }).compiles.readyForReview).toBe(true);
    const cut = buildRouterShadowReport({ rows: many, truncated: true, since: SINCE, now: NOW });
    expect(cut.read).toMatchObject({ complete: false, incompleteReason: "TRUNCATED" });
    expect(cut.compiles.readyForReview).toBe(false);
    const bad = buildRouterShadowReport({ rows: [...many, { run_ref: JOB }, page(0, { outcome_class: "fine" }), "x"], truncated: false, since: SINCE, now: NOW });
    expect(bad.read).toMatchObject({ rowsInvalid: 3, complete: false, incompleteReason: "ROWS_INVALID" });
    expect(bad.compiles.readyForReview).toBe(false);
  });
});

describe("public summary: a separate type with no route feature", () => {
  it("carries exactly counts and readiness", () => {
    const summary = toPublicRouterShadowSummary(buildRouterShadowReport({ rows: rows(), truncated: false, since: SINCE, now: NOW }));
    expect(Object.keys(summary).sort()).toEqual(["authority", "complete", "generatedAt", "reviewReady", "schemaVersion", "tracedCompiles", "tracedPages"]);
    expect(summary).toMatchObject({ authority: "none", tracedCompiles: 3, tracedPages: 5, complete: true, reviewReady: false });
    const text = renderShadowReport(buildRouterShadowReport({ rows: rows(), truncated: false, since: SINCE, now: NOW }), "public")
      .replace(/"schemaVersion": "[^"]*"/, "");
    expect(text).not.toMatch(/native_text|raster|no_text|RT-\d|EMPTY_PAGE|OCR_|CORE_|sha256|cost|candidate|route|class|reason|pre_|threshold|reviewAfter|100/i);
  });

  it("the internal markdown keeps pre-read and post-read under separate headings, post-read marked inadmissible", () => {
    const markdown = renderRouterShadowReportMarkdown(buildRouterShadowReport({ rows: rows(), truncated: false, since: SINCE, now: NOW }));
    expect(markdown).toContain("## Pre-read features (admissible as routing input)");
    expect(markdown).toContain("## Post-read outcome of the incumbent (NOT admissible as routing input)");
    expect(markdown).toContain("document failures, operational: OCR_READ_TIMEOUT 1");
  });
});

describe("the CLI half", () => {
  const CONFIG = { url: "https://db.example", serviceRoleKey: "k".repeat(40) };

  it("reads through the RPC with the window and the bound, and says when the read was cut", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([page(0), page(1), page(2)]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const read = await readShadowTraces(CONFIG, SINCE, 2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.example/rest/v1/rpc/read_router_shadow_traces");
    expect(JSON.parse(init.body)).toEqual({ p_since: "1970-01-01T00:00:00.000Z", p_limit: 2 });
    expect(read.rows).toHaveLength(2);
    expect(read.truncated).toBe(true);
  });

  it("a store error fails the report and echoes no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "secret detail" }), { status: 500 })));
    await expect(readShadowTraces(CONFIG, SINCE)).rejects.toThrow(/^read_router_shadow_traces -> HTTP 500$/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(readShadowTraces(CONFIG, SINCE)).rejects.toThrow("not a row list");
  });

  it("parses the window and the output", () => {
    expect(parseShadowReportArgs([], NOW)).toEqual({ since: new Date(0), output: "json" });
    expect(parseShadowReportArgs(["--hours", "24", "--markdown"], NOW)).toEqual({ since: new Date("2026-11-26T12:00:00.000Z"), output: "markdown" });
    expect(parseShadowReportArgs(["--public"], NOW).output).toBe("public");
    expect(() => parseShadowReportArgs(["--hours", "-1"], NOW)).toThrow("--hours");
  });
});
