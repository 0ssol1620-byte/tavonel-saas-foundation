import { createHash } from "node:crypto";
import rawTable from "./router-evidence-table.v1.json";

/*
  Pure half of the router shadow (ADR-012 section 5). It classifies a page from the region ids the OCR
  worker wrote and looks the class up in the evidence table. It reads nothing, stores nothing, runs no
  model, and its result is internal: it must never reach a public DTO or a client bundle.
  An id it does not recognise is "unclassifiable", never defaulted to a class.
*/

export type ObservablePageClass = "native_text" | "raster_text" | "no_text";
export type PageClass = ObservablePageClass | "unclassifiable";

export type EvidenceRow = { id: string; route: string; costUsdPerPage: number | null };
export type EvidenceTable = {
  schemaVersion: string;
  tableVersion: number;
  classes: Record<string, { rowId: string; incumbentRoute: string }>;
  rows: EvidenceRow[];
  [key: string]: unknown;
};

export type ShadowPageDecision = {
  pageIndex0: number;
  pageClass: PageClass;
  incumbentRoute: string | null;
  evidenceRowId: string | null;
  evidenceRoute: string | null;
  /** null when the page has no class (nothing to compare), never a guessed true. */
  agreesWithIncumbent: boolean | null;
  costUsd: number | null;
  costReason: "COST_UNMEASURED" | "NO_EVIDENCE_ROW" | null;
};

export type ClassifyResult =
  | { ok: true; tableSha256: string; tableVersion: number; pages: ShadowPageDecision[] }
  | { ok: false; code: "PAGE_COUNT_INVALID" | "REGION_INVALID" };

const MAX_PAGES = 100_000;
const NATIVE_ID = /^native-p(\d{4,})$/;
const OCR_ID = /^ocr-p(\d{4,})-l\d{5}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObj(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Fails closed: a malformed table throws at load, it is never repaired. */
export function validateEvidenceTable(table: unknown): EvidenceTable {
  if (!isObj(table) || table.schemaVersion !== "tavonel.router_evidence_table.v1" ||
      !Number.isInteger(table.tableVersion) || !isObj(table.classes) || !Array.isArray(table.rows)) {
    throw new Error("ROUTER_EVIDENCE_TABLE_INVALID");
  }
  const ids = new Set<string>();
  for (const row of table.rows) {
    if (!isObj(row) || typeof row.id !== "string" || typeof row.route !== "string" || ids.has(row.id) ||
        !(row.costUsdPerPage === null || (typeof row.costUsdPerPage === "number" && Number.isFinite(row.costUsdPerPage) && row.costUsdPerPage >= 0))) {
      throw new Error("ROUTER_EVIDENCE_TABLE_INVALID");
    }
    ids.add(row.id);
  }
  for (const entry of Object.values(table.classes)) {
    if (!isObj(entry) || typeof entry.incumbentRoute !== "string" || typeof entry.rowId !== "string" || !ids.has(entry.rowId)) {
      throw new Error("ROUTER_EVIDENCE_TABLE_INVALID");
    }
  }
  return table as unknown as EvidenceTable;
}

export const EVIDENCE_TABLE: EvidenceTable = validateEvidenceTable(rawTable);
export const tableSha256 = (table: EvidenceTable): string => `sha256:${createHash("sha256").update(canonical(table), "utf8").digest("hex")}`;
export const EVIDENCE_TABLE_SHA256: string = tableSha256(EVIDENCE_TABLE);

type PageTally = { native: number; ocr: number; other: number };

/** Class of one page from the ids of its regions; a page with no region is no_text. */
function classOf(tally: PageTally | undefined): PageClass {
  if (!tally) return "no_text";
  if (tally.other > 0 || (tally.native > 0 && tally.ocr > 0)) return "unclassifiable";
  return tally.native > 0 ? "native_text" : "raster_text";
}

function decide(pageIndex0: number, pageClass: PageClass, table: EvidenceTable): ShadowPageDecision {
  const entry = pageClass === "unclassifiable" ? undefined : table.classes[pageClass];
  const row = entry ? table.rows.find((r) => r.id === entry.rowId) : undefined;
  if (!entry || !row) {
    return { pageIndex0, pageClass, incumbentRoute: null, evidenceRowId: null, evidenceRoute: null,
      agreesWithIncumbent: null, costUsd: null, costReason: "NO_EVIDENCE_ROW" };
  }
  return { pageIndex0, pageClass, incumbentRoute: entry.incumbentRoute, evidenceRowId: row.id, evidenceRoute: row.route,
    agreesWithIncumbent: row.route === entry.incumbentRoute, costUsd: row.costUsdPerPage,
    costReason: row.costUsdPerPage === null ? "COST_UNMEASURED" : null };
}

/**
 * pageCount comes from the verified OCR body; regions are its region list. A region whose page index is
 * not an integer inside [0, pageCount) cannot be attributed to a page: the whole result is refused.
 */
export function classifyPages(pageCount: unknown, regions: unknown, table: EvidenceTable = EVIDENCE_TABLE): ClassifyResult {
  if (typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
    return { ok: false, code: "PAGE_COUNT_INVALID" };
  }
  if (!Array.isArray(regions)) return { ok: false, code: "REGION_INVALID" };
  const tallies = new Map<number, PageTally>();
  for (const region of regions) {
    if (!isObj(region) || typeof region.regionId !== "string" || typeof region.pageIndex0 !== "number" ||
        !Number.isInteger(region.pageIndex0) || region.pageIndex0 < 0 || region.pageIndex0 >= pageCount) {
      return { ok: false, code: "REGION_INVALID" };
    }
    const tally = tallies.get(region.pageIndex0) ?? { native: 0, ocr: 0, other: 0 };
    const native = NATIVE_ID.exec(region.regionId);
    const ocr = OCR_ID.exec(region.regionId);
    // The page number inside the id must agree with the page the region claims.
    if (native && Number(native[1]) === region.pageIndex0 + 1) tally.native += 1;
    else if (ocr && Number(ocr[1]) === region.pageIndex0 + 1) tally.ocr += 1;
    else tally.other += 1;
    tallies.set(region.pageIndex0, tally);
  }
  const pages: ShadowPageDecision[] = [];
  for (let i = 0; i < pageCount; i += 1) pages.push(decide(i, classOf(tallies.get(i)), table));
  return { ok: true, tableSha256: tableSha256(table), tableVersion: table.tableVersion, pages };
}
