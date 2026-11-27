import { afterEach, describe, expect, it, vi } from "vitest";

import { parseShadowReportArgs, readShadowTraces, renderShadowReport } from "./shadow-report.mjs";

/* WO-RTR-GAPS-1: the operator CLI half of the RTR-4 report (the aggregation is tested in lib/router-shadow-report.test.ts). */

const NOW = new Date("2026-11-27T12:00:00.000Z");
const SINCE = new Date(0);
const row = (index) => ({ run_kind: "compile_job", run_ref: `cjob-${"1".repeat(32)}`, document_id: "0c0c0c0c-0000-4000-8000-00000000000a",
  version_key: "a".repeat(64), page_index0: index, page_class: "native_text", incumbent_route: "native_text", evidence_row_id: "RT-1",
  candidate_route: "native_text", agrees_with_incumbent: true, cost_usd: null, cost_reason: "COST_UNMEASURED", outcome_class: "ok",
  reason_code: null, table_sha256: `sha256:${"b".repeat(64)}`, trace_version: 2, pre_page_count: 3, pre_source_bytes: 3000,
  run_outcome_class: "ok", run_reason_code: null, created_at: "2026-11-27T10:00:00.000Z" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the CLI half", () => {
  const CONFIG = { url: "https://db.example", serviceRoleKey: "k".repeat(40) };

  it("reads through the RPC with the window and the bound, and says when the read was cut", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([row(0), row(1), row(2)]), { status: 200 }));
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

describe("output", () => {
  it("--public prints the public summary type only; the default is the internal report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([row(0), row(1)]), { status: 200 })));
    const read = await readShadowTraces({ url: "https://db.example", serviceRoleKey: "k".repeat(40) }, SINCE);
    const { buildRouterShadowReport } = await import("../../lib/router-shadow-report.ts");
    const report = buildRouterShadowReport({ ...read, since: SINCE, now: NOW });
    const publicText = renderShadowReport(report, "public").replace(/"schemaVersion": "[^"]*"/, "");
    expect(JSON.parse(renderShadowReport(report, "public"))).toMatchObject({ tracedCompiles: 1, tracedPages: 2, authority: "none" });
    expect(publicText).not.toMatch(/native_text|RT-\d|sha256|cost|candidate|route|class|reason|pre_/i);
    expect(JSON.parse(renderShadowReport(report, "json")).candidatePath.byCandidateRoute).toEqual({ native_text: 2 });
  });
});
