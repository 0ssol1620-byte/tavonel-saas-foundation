import type { CollectionOcrInput } from "./collection-compiler";
import { classifyPages, EVIDENCE_TABLE, tableSha256, type EvidenceTable } from "./router-shadow-trace";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  Store half of the router shadow (ADR-012 section 5, WO-RTR-2). Zero authority: what it computes is
  never read by the compile, and a write that fails is logged with a reason code and nothing else.

  TAVONEL_ROUTER_SHADOW_ENABLED=true and TAVONEL_ROUTER_SHADOW_COHORT=<workspace key>[,<key>...].
  Anything else is off, and off means no computation and no store call -- not a degraded trace.
  A cohort that is unset, empty, malformed or holds `*` (or any non-key) is off for every workspace.

  Rows go to foundation_router_shadow_traces through record_router_shadow_traces (migration
  20261123130000, provisional slot). They carry ids, digests, the page class and the evidence row:
  no text, no bbox, no region content. The key is computed by the database from (run, document
  version, page, table digest), so a redelivered compile writes nothing twice. INTERNAL ONLY: no
  public DTO, route or client bundle imports this module (router-shadow-hook.test.ts checks it).
*/

type Env = Readonly<Record<string, string | undefined>>;

const COHORT_KEY = /^pilot-[A-Za-z0-9]{1,16}$/;
const COMPILE_JOB = /^cjob-[a-f0-9]{32}$/;
const INVOCATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** One RPC call's row bound; the database refuses above it too. A compile above it is skipped and says so. */
export const ROUTER_SHADOW_MAX_ROWS = 20_000;
// ponytail: the result waits at most this long for a write still in flight when the compile finishes; Core never waits on it.
const STORE_TIMEOUT_MS = 2_000;

export type RouterShadowDocument =
  | { documentId: string; versionKey: string; failure: "OCR_BINDING_INVALID" | "OCR_REGIONS_REQUIRED" }
  | { documentId: string; versionKey: string; input: CollectionOcrInput };

export type RouterShadowRun = { kind: "compile_job" | "invocation"; ref: string };

export type RouterShadowRow = {
  run_kind: RouterShadowRun["kind"];
  run_ref: string;
  document_id: string;
  version_key: string;
  page_index0: number | null;
  input_sha256: string | null;
  ocr_schema_version: string | null;
  reader_revision: string | null;
  reader_binding_sha256: string | null;
  page_class: string | null;
  incumbent_route: string | null;
  evidence_row_id: string | null;
  table_version: number;
  table_sha256: string;
  agrees_with_incumbent: boolean | null;
  cost_usd: number | null;
  cost_reason: string | null;
  outcome_class: "ok" | "operational" | "semantic";
  reason_code: string | null;
  recognition_conflict_count: number | null;
};

function log(level: "info" | "error", line: Record<string, string | number>) {
  try {
    console[level](JSON.stringify(line));
  } catch { /* telemetry never breaks a compile */ }
}

/** True only for an exact `true` flag and a cohort of well-formed workspace keys that names this one. */
export function routerShadowEnabled(workspaceKey: string, env: Env = process.env): boolean {
  if (env.TAVONEL_ROUTER_SHADOW_ENABLED !== "true") return false;
  const keys = (env.TAVONEL_ROUTER_SHADOW_COHORT ?? "").split(",").map((key) => key.trim());
  if (!keys.every((key) => COHORT_KEY.test(key))) {
    log("error", { event: "router_shadow_misconfigured", code: "ROUTER_SHADOW_COHORT_INVALID" });
    return false;
  }
  return keys.includes(workspaceKey);
}

/** The compile job when the caller is the durable worker, else this invocation. Anything else is no run. */
export function routerShadowRun(compileJobId: string | null, invocationId: string): RouterShadowRun | null {
  if (compileJobId !== null) return COMPILE_JOB.test(compileJobId) ? { kind: "compile_job", ref: compileJobId } : null;
  return INVOCATION.test(invocationId) ? { kind: "invocation", ref: invocationId } : null;
}

/**
 * Pure. One row per page of a verified document, one document-level row for a document that never got
 * that far. null when the compile has more than ROUTER_SHADOW_MAX_ROWS rows: counted before any is built.
 */
export function buildRouterShadowRows(run: RouterShadowRun, documents: readonly RouterShadowDocument[],
  table: EvidenceTable = EVIDENCE_TABLE): RouterShadowRow[] | null {
  const total = documents.reduce((sum, document) => sum + ("failure" in document ? 1 : document.input.pageCount), 0);
  if (!(total <= ROUTER_SHADOW_MAX_ROWS)) return null;
  const rows: RouterShadowRow[] = [];
  const tableFields = { table_version: table.tableVersion, table_sha256: tableSha256(table) };
  for (const document of documents) {
    const base = { run_kind: run.kind, run_ref: run.ref, document_id: document.documentId.toLowerCase(),
      version_key: document.versionKey.toLowerCase() };
    const empty = { page_index0: null, input_sha256: null, ocr_schema_version: null, reader_revision: null,
      reader_binding_sha256: null, page_class: null, incumbent_route: null, evidence_row_id: null,
      agrees_with_incumbent: null, cost_usd: null, cost_reason: null, recognition_conflict_count: null };
    if ("failure" in document) {
      // An OCR body that cannot be read or bound is ours (operational); a v1 read without regions is the reader's (semantic).
      rows.push({ ...base, ...empty, ...tableFields,
        outcome_class: document.failure === "OCR_BINDING_INVALID" ? "operational" : "semantic", reason_code: document.failure });
      continue;
    }
    const { input } = document;
    const regions = input.regions ?? [];
    const classified = classifyPages(input.pageCount, regions, table);
    if (!classified.ok) {
      rows.push({ ...base, ...empty, ...tableFields, outcome_class: "operational", reason_code: "ROUTER_SHADOW_REGION_INVALID" });
      continue;
    }
    const conflicts = new Map<number, number>();
    for (const region of regions) {
      if (region.recognitionConflict !== undefined) conflicts.set(region.pageIndex0, (conflicts.get(region.pageIndex0) ?? 0) + 1);
    }
    for (const page of classified.pages) {
      const conflictCount = conflicts.get(page.pageIndex0) ?? 0;
      const reason = page.pageClass === "unclassifiable" ? "UNCLASSIFIABLE_PAGE"
        : page.pageClass === "no_text" ? "NO_TEXT_PAGE"
          : conflictCount > 0 ? "RECOGNITION_CONFLICT" : null;
      rows.push({ ...base, page_index0: page.pageIndex0, input_sha256: input.inputSha256.toLowerCase(),
        ocr_schema_version: input.ocrSchemaVersion ?? null, reader_revision: input.readerRevision ?? null,
        reader_binding_sha256: input.readerBindingSha256 ?? null, page_class: page.pageClass,
        incumbent_route: page.incumbentRoute, evidence_row_id: page.evidenceRowId, ...tableFields,
        agrees_with_incumbent: page.agreesWithIncumbent, cost_usd: page.costUsd, cost_reason: page.costReason,
        outcome_class: reason === null ? "ok" : "semantic", reason_code: reason, recognition_conflict_count: conflictCount });
    }
  }
  return rows;
}

/**
 * Records this compile's trace. Never throws and never rejects: every failure is a logged reason code.
 * `documents` is a thunk so a workspace outside the cohort pays for nothing.
 */
export async function recordRouterShadowTrace(workspaceKey: string, run: RouterShadowRun | null,
  documents: () => readonly RouterShadowDocument[], env: Env = process.env): Promise<void> {
  try {
    if (!routerShadowEnabled(workspaceKey, env)) return;
    // Yield first, so the rows are built while the compile awaits its own I/O, not before it goes on.
    await Promise.resolve();
    const fail = (code: string, pages = 0) => log("error", { event: "router_shadow_failed", code, pages });
    if (!run) return fail("ROUTER_SHADOW_RUN_INVALID");
    const config = readSupabaseAdminConfig(env);
    if (!config) return fail("ROUTER_SHADOW_STORE_NOT_CONFIGURED");
    const rows = buildRouterShadowRows(run, documents());
    if (!rows) return fail("ROUTER_SHADOW_SKIPPED_BUDGET");
    let response: Response;
    try {
      response = await supabaseAdminRequest(config, "/rest/v1/rpc/record_router_shadow_traces", {
        method: "POST", body: JSON.stringify({ p_workspace_key: workspaceKey, p_rows: rows }),
        signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      });
    } catch {
      return fail("ROUTER_SHADOW_STORE_UNREACHABLE", rows.length);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { code?: unknown } | null;
      return fail(body?.code === "PGRST202" || body?.code === "42883" ? "ROUTER_SHADOW_MIGRATION_ABSENT"
        : body?.code === "23514" || body?.code === "22023" ? "ROUTER_SHADOW_REQUEST_INVALID" : "ROUTER_SHADOW_STORE_FAILED",
      rows.length);
    }
    const inserted = await response.json().catch(() => null);
    if (!Number.isInteger(inserted) || (inserted as number) < 0 || (inserted as number) > rows.length) {
      return fail("ROUTER_SHADOW_RESPONSE_INVALID", rows.length);
    }
    // Counts only: no workspace, document, class or digest leaves through the log.
    log("info", { event: "router_shadow_recorded", pages: rows.length, inserted: inserted as number });
  } catch {
    log("error", { event: "router_shadow_failed", code: "ROUTER_SHADOW_COMPUTE_FAILED", pages: 0 });
  }
}
