import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionOcrInput } from "./collection-compiler";
import { buildRouterShadowRows, recordRouterShadowTrace, routerShadowEnabled, routerShadowRun, routerShadowRunOutcome, ROUTER_SHADOW_MAX_ROWS,
  type RouterShadowRunOutcome } from "./router-shadow-store";
import { EVIDENCE_TABLE_SHA256 } from "./router-shadow-trace";

const WS = "pilot-shadow1";
const ON = { TAVONEL_ROUTER_SHADOW_ENABLED: "true", TAVONEL_ROUTER_SHADOW_COHORT: WS,
  NEXT_PUBLIC_SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(40) };
const RUN = { kind: "compile_job" as const, ref: `cjob-${"1".repeat(32)}` };
const DOC = "0C0C0C0C-0000-4000-8000-00000000000A";
const VERSION = "A".repeat(64);
const OK: RouterShadowRunOutcome = { outcome_class: "ok", reason_code: null };
const REF = { documentId: DOC, versionKey: VERSION, sourceBytes: 4096 };

const region = (regionId: string, pageIndex0: number, conflict = false) => ({
  regionId, pageIndex0, pageNumber1: pageIndex0 + 1, order: 0, blockType: "paragraph" as const, text: "secret words",
  bbox1000: [1, 2, 3, 4] as [number, number, number, number], confidence: 1, authority: "official" as const,
  ...(conflict ? { recognitionConflict: {} as never } : {}),
});
const input = (pageCount: number, regions: ReturnType<typeof region>[], extra: Partial<CollectionOcrInput> = {}): CollectionOcrInput => ({
  documentId: DOC, versionKey: VERSION, sanitizedKey: "s", ocrJsonKey: "o", pageCount, text: "secret words",
  inputSha256: `sha256:${VERSION}`, sourceImmutableKey: "s", ocrSchemaVersion: "tavonel.ocr_result.v2", regions, ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("flag and cohort fail closed", () => {
  it.each([
    ["flag unset", { TAVONEL_ROUTER_SHADOW_COHORT: WS }],
    ["flag 1", { ...ON, TAVONEL_ROUTER_SHADOW_ENABLED: "1" }],
    ["flag TRUE", { ...ON, TAVONEL_ROUTER_SHADOW_ENABLED: "TRUE" }],
    ["cohort unset", { TAVONEL_ROUTER_SHADOW_ENABLED: "true" }],
    ["cohort empty", { ...ON, TAVONEL_ROUTER_SHADOW_COHORT: "" }],
    ["cohort *", { ...ON, TAVONEL_ROUTER_SHADOW_COHORT: "*" }],
    ["cohort with *", { ...ON, TAVONEL_ROUTER_SHADOW_COHORT: `${WS},*` }],
    ["cohort all", { ...ON, TAVONEL_ROUTER_SHADOW_COHORT: "all" }],
    ["cohort malformed", { ...ON, TAVONEL_ROUTER_SHADOW_COHORT: `${WS},pilot-` }],
    ["other workspace", { ...ON, TAVONEL_ROUTER_SHADOW_COHORT: "pilot-other" }],
  ])("%s is off", (_name, env) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(routerShadowEnabled(WS, env)).toBe(false);
  });

  it("is on only for a named workspace", () => {
    expect(routerShadowEnabled(WS, ON)).toBe(true);
    expect(routerShadowEnabled(WS, { ...ON, TAVONEL_ROUTER_SHADOW_COHORT: ` pilot-other , ${WS} ` })).toBe(true);
  });

  it("names no run for a malformed compile job, and never falls back to the invocation", () => {
    const invocation = "0c0c0c0c-0000-4000-8000-00000000000a";
    expect(routerShadowRun("cjob-bad", invocation)).toBeNull();
    expect(routerShadowRun(null, invocation)).toEqual({ kind: "invocation", ref: invocation });
    expect(routerShadowRun(null, "not-a-uuid")).toBeNull();
  });
});

describe("rows", () => {
  it("one row per page: native, raster, no text, unclassifiable, conflict; ids and digests only", () => {
    const rows = buildRouterShadowRows(RUN, [{ ...REF, input: input(5, [
      region("native-p0001", 0), region("ocr-p0002-l00001", 1), region("r-1", 3), region("ocr-p0005-l00001", 4, true),
    ]) }], OK)!;
    expect(rows.map((row) => [row.page_index0, row.page_class, row.outcome_class, row.reason_code, row.evidence_row_id, row.recognition_conflict_count]))
      .toEqual([
        [0, "native_text", "ok", null, "RT-1", 0],
        [1, "raster_text", "ok", null, "RT-3", 0],
        [2, "no_text", "semantic", "EMPTY_PAGE", "RT-3", 0],
        [3, "unclassifiable", "semantic", "UNCLASSIFIABLE_PAGE", null, 0],
        [4, "raster_text", "semantic", "RECOGNITION_CONFLICT", "RT-3", 1],
      ]);
    expect(rows[3]).toMatchObject({ incumbent_route: null, candidate_route: null, agrees_with_incumbent: null, cost_usd: null, cost_reason: "NO_EVIDENCE_ROW" });
    // Gap 4: the candidate route is the evidence row's route; gap 3: pre-read features are their own columns.
    expect(rows.map((row) => row.candidate_route)).toEqual(["native_text", "rapidocr_raster", "rapidocr_raster", null, "rapidocr_raster"]);
    expect(rows.every((row) => row.pre_page_count === 5 && row.pre_source_bytes === 4096)).toBe(true);
    expect(rows.every((row) => row.run_outcome_class === "ok" && row.run_reason_code === null)).toBe(true);
    expect(rows[0]).toMatchObject({ document_id: DOC.toLowerCase(), version_key: VERSION.toLowerCase(),
      input_sha256: `sha256:${VERSION.toLowerCase()}`, table_sha256: EVIDENCE_TABLE_SHA256, cost_reason: "COST_UNMEASURED" });
    // Nothing a page says leaves through a row.
    expect(JSON.stringify(rows)).not.toMatch(/secret|bbox|"text"/);
    // Exactly the v2 key set the database writer accepts (20261127060000): a missing or an extra key is refused whole there.
    expect(Object.keys(rows[0]!).sort()).toEqual(["agrees_with_incumbent", "candidate_route", "cost_reason", "cost_usd", "document_id",
      "evidence_row_id", "incumbent_route", "input_sha256", "ocr_schema_version", "outcome_class", "page_class", "page_index0",
      "pre_page_count", "pre_source_bytes", "reader_binding_sha256", "reader_revision", "reason_code", "recognition_conflict_count",
      "run_kind", "run_outcome_class", "run_reason_code", "run_ref", "table_sha256", "table_version", "version_key"]);
  });

  it("keeps operational and semantic document failures apart (gap 1): a failed read is a document row, never a page", () => {
    const failures = ["OCR_BINDING_INVALID", "OCR_RESULT_UNREADABLE", "OCR_READ_TIMEOUT", "OCR_REGIONS_REQUIRED", "OCR_REVIEW_RECEIPT"] as const;
    const rows = buildRouterShadowRows(RUN, failures.map((failure) => ({ ...REF, sourceBytes: null, failure })),
      { outcome_class: "operational", reason_code: "CORE_TIMEOUT" })!;
    expect(rows.map((row) => [row.page_index0, row.page_class, row.pre_page_count, row.pre_source_bytes, row.outcome_class, row.reason_code]))
      .toEqual([[null, null, null, null, "operational", "OCR_BINDING_INVALID"], [null, null, null, null, "operational", "OCR_RESULT_UNREADABLE"],
        [null, null, null, null, "operational", "OCR_READ_TIMEOUT"], [null, null, null, null, "semantic", "OCR_REGIONS_REQUIRED"],
        [null, null, null, null, "semantic", "OCR_REVIEW_RECEIPT"]]);
    // The run's outcome rides on every row and never changes a page or document outcome.
    expect(rows.every((row) => row.run_outcome_class === "operational" && row.run_reason_code === "CORE_TIMEOUT")).toBe(true);
  });

  it("a source size that is not a non-negative integer is not measured: null, never 0", () => {
    for (const sourceBytes of [-1, 1.5, Number.NaN, null]) {
      expect(buildRouterShadowRows(RUN, [{ ...REF, sourceBytes, failure: "OCR_BINDING_INVALID" }], OK)![0]!.pre_source_bytes).toBeNull();
    }
  });

  it("refuses an over-budget compile before building a row", () => {
    expect(buildRouterShadowRows(RUN, [{ ...REF, input: input(ROUTER_SHADOW_MAX_ROWS + 1, []) }], OK)).toBeNull();
    expect(buildRouterShadowRows(RUN, [{ ...REF, input: input(Number.NaN, []) }], OK)).toBeNull();
  });
});

describe("run outcome (gap 4): operational, semantic and unattributed never merge", () => {
  it.each([
    [undefined, "operational", "COMPILE_THREW"],
    [{ ok: true }, "ok", null],
    [{ ok: false, code: "CORE_V2_REJECTED" }, "semantic", "CORE_REJECTED"],
    [{ ok: false, code: "OCR_REGIONS_REQUIRED" }, "semantic", "INPUT_REFUSED"],
    [{ ok: false, code: "OCR_V3_READER_REQUIRED" }, "semantic", "INPUT_REFUSED"],
    [{ ok: false, code: "CORE_V2_TIMEOUT" }, "operational", "CORE_TIMEOUT"],
    [{ ok: false, code: "CORE_V2_UNAVAILABLE" }, "operational", "CORE_FAILED"],
    [{ ok: false, code: "CORE_V2_HTTP_502" }, "operational", "CORE_FAILED"],
    [{ ok: false, code: "CORE_V2_PROJECTION_INVALID" }, "operational", "CORE_FAILED"],
    [{ ok: false, code: "OCR_BINDING_INVALID" }, "operational", "INPUT_UNREADABLE"],
    [{ ok: false, code: "OCR_NOT_READY" }, "unattributed", "COMPILE_STOPPED"],
    [{ ok: false, code: "SOURCE_VERSION_CHANGED" }, "unattributed", "COMPILE_STOPPED"],
    [{ ok: false, code: "CORE_V2_HTTP_5xx" }, "unattributed", "COMPILE_STOPPED"],
  ])("%j -> %s %s", (result, outcomeClass, reason) => {
    expect(routerShadowRunOutcome(result)).toEqual({ outcome_class: outcomeClass, reason_code: reason });
  });
});

describe("recording never fails or reads back into the compile", () => {
  const documents = () => ({ documents: [{ ...REF, input: input(1, [region("native-p0001", 0)]) }], outcome: OK });

  it("off: no computation and no store call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const thunk = vi.fn(documents);
    await recordRouterShadowTrace(WS, RUN, thunk, { ...ON, TAVONEL_ROUTER_SHADOW_ENABLED: "" });
    expect(thunk).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on: one RPC call with the rows, logged by count only", async () => {
    const fetchMock = vi.fn(async () => new Response("1", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await recordRouterShadowTrace(WS, RUN, documents, ON);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/rpc/record_router_shadow_traces");
    const body = JSON.parse(String(init.body));
    expect(body.p_workspace_key).toBe(WS);
    expect(body.p_rows).toHaveLength(1);
    expect(info).toHaveBeenCalledWith(JSON.stringify({ event: "router_shadow_recorded", pages: 1, inserted: 1 }));
  });

  it("on, with no document whose reading is known: no store call and no log", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await recordRouterShadowTrace(WS, RUN, () => ({ documents: [], outcome: OK }), ON);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ["unreachable", async () => { throw new Error("down"); }, "ROUTER_SHADOW_STORE_UNREACHABLE"],
    ["migration absent", async () => new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 }), "ROUTER_SHADOW_MIGRATION_ABSENT"],
    ["refused", async () => new Response(JSON.stringify({ code: "23514" }), { status: 400 }), "ROUTER_SHADOW_REQUEST_INVALID"],
    ["failed", async () => new Response("{}", { status: 500 }), "ROUTER_SHADOW_STORE_FAILED"],
    ["answer not a count", async () => new Response("\"x\"", { status: 200 }), "ROUTER_SHADOW_RESPONSE_INVALID"],
    ["answer above the rows", async () => new Response("2", { status: 200 }), "ROUTER_SHADOW_RESPONSE_INVALID"],
  ])("%s: resolves, logs a reason code and nothing of the page", async (_name, impl, code) => {
    vi.stubGlobal("fetch", vi.fn(impl));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordRouterShadowTrace(WS, RUN, documents, ON)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(JSON.stringify({ event: "router_shadow_failed", code, pages: 1 }));
  });

  it("a throwing document thunk, no store config or no run are logged, not thrown", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await recordRouterShadowTrace(WS, RUN, () => { throw new Error("boom"); }, ON);
    await recordRouterShadowTrace(WS, RUN, documents, { ...ON, SUPABASE_SERVICE_ROLE_KEY: "" });
    await recordRouterShadowTrace(WS, null, documents, ON);
    expect(error.mock.calls.map((call) => JSON.parse(String(call[0])).code))
      .toEqual(["ROUTER_SHADOW_COMPUTE_FAILED", "ROUTER_SHADOW_STORE_NOT_CONFIGURED", "ROUTER_SHADOW_RUN_INVALID"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
