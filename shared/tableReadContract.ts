/**
 * `tavonel.table_read.v1`: one page of output from the proposed table reader lane
 * `foundation_table_reader_v1` (table/limits plan 2026-10-17 §C1-§C4, task T2, ladder stage 0).
 *
 * Contract only. No reader produces this document, nothing persists it, and nothing reads it in
 * the product path. The authoritative reader `foundation_ocr_gpu_v1` keeps emitting paragraph
 * regions only, and the capability manifest keeps `no_table_or_formula_extraction` until the
 * rollout stage (§C6-§C7). Passing this validator is not table support and claims none.
 *
 * Validation follows `qualifyOcrResult` in the worker's `ocr.ts`: exact keys at every level,
 * bounded sizes, `sha256:` digests, and bbox1000 as integers 0-1000 with x1<x2 and y1<y2
 * (ADR-001). It adds one rule of its own: a table, cell or formula the reader could not read is
 * reported with a reasonCode. It is never dropped silently, repaired, clamped or filled in.
 *
 * - A document that is absent, malformed, or bound to another input fails whole (`ok: false`).
 * - A table or formula that cannot be used becomes a refusal; the rest of the page survives.
 * - A cell without its own bbox keeps `bbox1000: null`, is located by its table's bbox, and it
 *   and its table are flagged `cell_located_by_table_bbox_only`. No coordinate is ever derived:
 *   every box in the result is a box the document carried.
 * - A cell whose text no other reader measured is `TABLE_CELL_TEXT_UNCONFIRMED`: shown as
 *   evidence, never promoted to a fact. Agreement with OCR is not accuracy.
 */

export const TABLE_READ_SCHEMA = "tavonel.table_read.v1" as const;
export const CELL_LOCATED_BY_TABLE_BBOX_ONLY = "cell_located_by_table_bbox_only" as const;

/**
 * Every reasonCode and the kind of failure it is (§C4). Operational failure (the reader is not
 * there) and semantic failure (the reader was wrong) are different problems with different
 * recoveries; `evidence` is the retryable binding class, like `OcrEvidenceRetryableError`.
 * `TABLE_READ_SCHEMA_INVALID` is not in §C4's table: it is the code for a document whose shape
 * is wrong, which none of the seven describes.
 */
export const TABLE_READ_REASON_CLASS = {
  TABLE_READER_UNAVAILABLE: "operational",
  TABLE_BINDING_MISMATCH: "evidence",
  TABLE_READ_SCHEMA_INVALID: "semantic",
  TABLE_OUTPUT_TRUNCATED: "semantic",
  TABLE_GRID_INVALID: "semantic",
  TABLE_REGION_UNLOCATED: "semantic",
  TABLE_CELL_TEXT_UNCONFIRMED: "semantic",
  FORMULA_LATEX_INVALID: "semantic",
} as const;
export type TableReadReasonCode = keyof typeof TABLE_READ_REASON_CLASS;
export type DocumentFailureCode = "TABLE_READER_UNAVAILABLE" | "TABLE_BINDING_MISMATCH" | "TABLE_READ_SCHEMA_INVALID";
/** The codes a refusal may carry. A refusal names a region; the document-level codes do not. */
export type RefusalReasonCode = "TABLE_OUTPUT_TRUNCATED" | "TABLE_GRID_INVALID" | "TABLE_REGION_UNLOCATED" | "FORMULA_LATEX_INVALID";
const REFUSAL_CODES: ReadonlySet<string> = new Set<RefusalReasonCode>([
  "TABLE_OUTPUT_TRUNCATED", "TABLE_GRID_INVALID", "TABLE_REGION_UNLOCATED", "FORMULA_LATEX_INVALID",
]);
const TABLE_REFUSAL_CODES: ReadonlySet<string> = new Set(["TABLE_OUTPUT_TRUNCATED", "TABLE_GRID_INVALID", "TABLE_REGION_UNLOCATED"]);

// Wire-shape bounds, sized so one page cannot carry an unbounded document. Not product limits and
// not calibrated; a real page that hits one fails as TABLE_READ_SCHEMA_INVALID and says so.
const MAX_TABLES = 64;
const MAX_CELLS = 10_000;
const MAX_GRID_EXTENT = 1_000;
const MAX_TEXT = 20_000;
const MAX_FORMULAS = 256;
const MAX_REFUSALS = 256;
const MAX_CONFIRMED_BY = 64;
const MAX_FLAGS = 32;

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const FLAG = /^[a-z][a-z0-9_]{0,63}$/;
const PAGE_STATUSES = new Set(["read", "no_table", "unreadable"]);
const DISPLAYS = new Set(["inline", "block"]);

export type Bbox1000 = [number, number, number, number];
export type PageStatus = "read" | "no_table" | "unreadable";

/** What the caller already holds: the persisted ocr.json binding and that page's OCR regions. */
export type TableReadExpectation = {
  sourceImmutableKey: string;
  inputSha256: string;
  readerRevision: string;
  readerBindingSha256: string;
  pageIndex0: number;
  /** Regions from a qualified `ocr.json` (`qualifyOcrResult`); `confirmedBy` is checked against them. */
  ocrRegions: ReadonlyArray<{ regionId: string; pageIndex0: number; text: string; bbox1000: readonly number[] }>;
};

export type QualifiedTableCell = {
  cellId: string;
  rowIndex0: number;
  columnIndex0: number;
  rowSpan: number;
  columnSpan: number;
  text: string;
  /** Exactly what the reader gave. Null stays null. */
  bbox1000: Bbox1000 | null;
  /** The box a SourceRef for this cell points at: its own, or its table's when it has none. */
  locatorBbox1000: Bbox1000;
  confirmedBy: string[];
  qualityFlags: string[];
  /** Null when another reader measured the same text; the code when nothing did. */
  reasonCode: "TABLE_CELL_TEXT_UNCONFIRMED" | null;
};

export type QualifiedTable = {
  tableId: string;
  bbox1000: Bbox1000;
  rowCount: number;
  columnCount: number;
  headerRowCount: number;
  cells: QualifiedTableCell[];
  qualityFlags: string[];
};

export type QualifiedFormula = { formulaId: string; bbox1000: Bbox1000; latex: string; display: "inline" | "block" };
export type TableReadRefusal = { bbox1000: Bbox1000 | null; reasonCode: RefusalReasonCode };

export type TableReadQualification =
  | { ok: false; reasonCode: DocumentFailureCode; detail: string }
  | {
    ok: true;
    pageIndex0: number;
    pageNumber1: number;
    /** Recomputed from what survived validation, not copied from the reader. */
    pageStatus: PageStatus;
    tables: QualifiedTable[];
    formulas: QualifiedFormula[];
    /** The reader's refusals, then the validator's, in document order. */
    refusals: TableReadRefusal[];
  };

type Row = Record<string, unknown>;

class DocumentFailure extends Error {
  constructor(readonly reasonCode: DocumentFailureCode, detail: string) { super(detail); }
}
const invalid = (detail: string): never => { throw new DocumentFailure("TABLE_READ_SCHEMA_INVALID", detail); };
const mismatch = (detail: string): never => { throw new DocumentFailure("TABLE_BINDING_MISMATCH", detail); };

const isRow = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Row, keys: readonly string[]) =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const isCount = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

export function isBbox1000(value: unknown): value is Bbox1000 {
  return Array.isArray(value) && value.length === 4 &&
    value.every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 1000) &&
    value[0] < value[2] && value[1] < value[3];
}
const contains = (outer: readonly number[], inner: readonly number[]) =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
const overlaps = (a: readonly number[], b: readonly number[]) =>
  Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
/** The plan's "공백 정규화" (§C2(2)): whitespace only. No case folding, no Unicode normalization. */
const normalizeSpace = (text: string) => text.replace(/\s+/g, " ").trim();

function statusOf(tableCount: number, refusals: ReadonlyArray<{ reasonCode: string }>): PageStatus {
  if (tableCount > 0) return "read";
  return refusals.some((refusal) => TABLE_REFUSAL_CODES.has(refusal.reasonCode)) ? "unreadable" : "no_table";
}

/**
 * Brace, `\begin`/`\end` and `\left`/`\right` balance, no bare `$`, no control characters.
 * ponytail: a structural check, not a LaTeX parser -- `\frac{a}` passes. The upgrade is the
 * renderer's own parser (KaTeX or similar) once formulas are drawn; no dependency is added for a
 * lane that renders nothing yet.
 */
export function isStructurallyValidLatex(latex: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (!latex.trim() || latex.length > MAX_TEXT || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(latex)) return false;
  const open: string[] = [];
  for (const [token, begin, end] of latex.matchAll(/\\begin\{([A-Za-z*]+)\}|\\end\{([A-Za-z*]+)\}|\\left(?![A-Za-z])|\\right(?![A-Za-z])|\\[\\{}$]|[{}$]/g)) {
    if (begin) open.push(`env:${begin}`);
    else if (end) { if (open.pop() !== `env:${end}`) return false; }
    else if (token === "\\left") open.push("left");
    else if (token === "\\right") { if (open.pop() !== "left") return false; }
    else if (token === "{") open.push("{");
    else if (token === "}") { if (open.pop() !== "{") return false; }
    else if (token === "$") return false;
  }
  return open.length === 0;
}

/** `CanonicalTable.validate_grid` (Core `akc_cir/models.py`), the same rules in the same order. */
function gridError(table: Row, cells: Row[]): string | null {
  const rows = table.rowCount as number, columns = table.columnCount as number;
  if ((table.headerRowCount as number) > rows) return "headerRowCount exceeds rowCount";
  if (!cells.length) return "table must contain at least one cell";
  const occupied = new Map<string, string>();
  for (const cell of cells) {
    const rowEnd = (cell.rowIndex0 as number) + (cell.rowSpan as number);
    const columnEnd = (cell.columnIndex0 as number) + (cell.columnSpan as number);
    if (rowEnd > rows || columnEnd > columns) return `cell ${cell.cellId as string} span exceeds table dimensions`;
    for (let row = cell.rowIndex0 as number; row < rowEnd; row += 1) {
      for (let column = cell.columnIndex0 as number; column < columnEnd; column += 1) {
        const key = `${row},${column}`;
        const holder = occupied.get(key);
        if (holder) return `cell ${cell.cellId as string} overlaps ${holder} at ${key}`;
        occupied.set(key, cell.cellId as string);
      }
    }
  }
  return null;
}

/** Shape, bounds and internal consistency. Throws TABLE_READ_SCHEMA_INVALID. */
function checkShape(doc: Row): { tables: Row[]; formulas: Row[]; refusals: Row[] } {
  if (!exactKeys(doc, [
    "schemaVersion", "sourceImmutableKey", "inputSha256", "readerRevision", "readerBindingSha256",
    "pageIndex0", "pageNumber1", "pageStatus", "tables", "formulas", "refusals",
  ])) invalid("document keys are not the table_read.v1 set");
  if (doc.schemaVersion !== TABLE_READ_SCHEMA) invalid("schemaVersion is not tavonel.table_read.v1");
  if (!isText(doc.sourceImmutableKey, 1024) || !doc.sourceImmutableKey) invalid("sourceImmutableKey is not a key");
  for (const field of ["inputSha256", "readerRevision", "readerBindingSha256"] as const) {
    if (typeof doc[field] !== "string" || !DIGEST.test(doc[field] as string)) invalid(`${field} is not a sha256 digest`);
  }
  if (!isCount(doc.pageIndex0, 0, 999_999) || doc.pageNumber1 !== (doc.pageIndex0 as number) + 1) invalid("pageNumber1 must equal pageIndex0 + 1");
  if (!PAGE_STATUSES.has(doc.pageStatus as string)) invalid("pageStatus is not read, no_table or unreadable");
  const list = (name: string, max: number) => {
    const value = doc[name];
    if (!Array.isArray(value) || value.length > max || !value.every(isRow)) invalid(`${name} is not a bounded list of objects`);
    return value as Row[];
  };
  const tables = list("tables", MAX_TABLES), formulas = list("formulas", MAX_FORMULAS), refusals = list("refusals", MAX_REFUSALS);

  const ids = new Set<string>();
  const uniqueId = (value: unknown, what: string) => {
    if (typeof value !== "string" || !ID.test(value) || ids.has(value)) invalid(`${what} is missing, malformed or repeated`);
    ids.add(value as string);
  };
  const flags = (value: unknown, what: string) => {
    if (!Array.isArray(value) || value.length > MAX_FLAGS || value.some((flag) => typeof flag !== "string" || !FLAG.test(flag))) invalid(`${what} qualityFlags are malformed`);
  };
  for (const table of tables) {
    if (!exactKeys(table, ["tableId", "bbox1000", "rowCount", "columnCount", "headerRowCount", "cells", "qualityFlags"])) invalid("table keys are not the table_read.v1 set");
    uniqueId(table.tableId, "tableId");
    // The table's bbox is any value here: a missing or unusable one is TABLE_REGION_UNLOCATED, not a schema error.
    if (!isCount(table.rowCount, 1, MAX_GRID_EXTENT) || !isCount(table.columnCount, 1, MAX_GRID_EXTENT) ||
      !isCount(table.headerRowCount, 0, MAX_GRID_EXTENT)) invalid(`table ${table.tableId as string} dimensions are not bounded integers`);
    flags(table.qualityFlags, `table ${table.tableId as string}`);
    if (!Array.isArray(table.cells) || table.cells.length > MAX_CELLS || !table.cells.every(isRow)) invalid(`table ${table.tableId as string} cells are not a bounded list`);
    for (const cell of table.cells as Row[]) {
      if (!exactKeys(cell, ["cellId", "rowIndex0", "columnIndex0", "rowSpan", "columnSpan", "text", "bbox1000", "confirmedBy"])) invalid("cell keys are not the table_read.v1 set");
      uniqueId(cell.cellId, "cellId");
      if (!isCount(cell.rowIndex0, 0, MAX_GRID_EXTENT) || !isCount(cell.columnIndex0, 0, MAX_GRID_EXTENT) ||
        !isCount(cell.rowSpan, 1, MAX_GRID_EXTENT) || !isCount(cell.columnSpan, 1, MAX_GRID_EXTENT)) invalid(`cell ${cell.cellId as string} position is not bounded integers`);
      if (!isText(cell.text, MAX_TEXT)) invalid(`cell ${cell.cellId as string} text is not a bounded string`);
      // A cell's bbox is null or an array; an array that is not a usable box is TABLE_REGION_UNLOCATED.
      if (cell.bbox1000 !== null && !Array.isArray(cell.bbox1000)) invalid(`cell ${cell.cellId as string} bbox1000 is neither null nor a box`);
      if (!Array.isArray(cell.confirmedBy) || cell.confirmedBy.length > MAX_CONFIRMED_BY ||
        cell.confirmedBy.some((id) => typeof id !== "string" || !ID.test(id)) ||
        new Set(cell.confirmedBy).size !== cell.confirmedBy.length) invalid(`cell ${cell.cellId as string} confirmedBy is malformed`);
    }
  }
  for (const formula of formulas) {
    if (!exactKeys(formula, ["formulaId", "bbox1000", "latex", "display"])) invalid("formula keys are not the table_read.v1 set");
    uniqueId(formula.formulaId, "formulaId");
    if (!isBbox1000(formula.bbox1000)) invalid(`formula ${formula.formulaId as string} bbox1000 is not a box`);
    if (typeof formula.latex !== "string" || !DISPLAYS.has(formula.display as string)) invalid(`formula ${formula.formulaId as string} latex or display is malformed`);
  }
  for (const refusal of refusals) {
    if (!exactKeys(refusal, ["bbox1000", "reasonCode"]) || !REFUSAL_CODES.has(refusal.reasonCode as string) ||
      (refusal.bbox1000 !== null && !isBbox1000(refusal.bbox1000))) invalid("refusal is not a located or null-located refusal code");
    // A region the reader refused and read at once: half a truncated table must not pass as a table.
    if (refusal.bbox1000 !== null && TABLE_REFUSAL_CODES.has(refusal.reasonCode as string) &&
      tables.some((table) => isBbox1000(table.bbox1000) && overlaps(table.bbox1000, refusal.bbox1000 as Bbox1000))) {
      invalid(`a ${refusal.reasonCode as string} refusal overlaps a table the reader emitted`);
    }
  }
  if (statusOf(tables.length, refusals as Array<{ reasonCode: string }>) !== doc.pageStatus) invalid("pageStatus contradicts the tables and refusals");
  return { tables, formulas, refusals };
}

/** The document is about the bytes, reader and page the caller holds. Throws TABLE_BINDING_MISMATCH. */
function checkBinding(doc: Row, expected: TableReadExpectation) {
  for (const field of ["sourceImmutableKey", "inputSha256", "readerRevision", "readerBindingSha256", "pageIndex0"] as const) {
    if (doc[field] !== expected[field]) mismatch(`${field} does not match the expected binding`);
  }
}

/**
 * `confirmedBy` is the second reader's measurement (§C2(2)): every named OCR region is on this
 * page, inside this table's box, used by one cell only, and together the regions read the same
 * text. A confirmation that does not hold means the document was joined to other OCR output, so
 * it fails whole -- it is never quietly downgraded to "unconfirmed". Throws TABLE_BINDING_MISMATCH.
 */
function checkConfirmations(tables: Row[], expected: TableReadExpectation) {
  const regions = new Map(expected.ocrRegions.map((region) => [region.regionId, region]));
  const used = new Set<string>();
  for (const table of tables) {
    for (const cell of table.cells as Row[]) {
      const confirmedBy = cell.confirmedBy as string[];
      if (!confirmedBy.length) continue;
      const texts: string[] = [];
      for (const regionId of confirmedBy) {
        const region = regions.get(regionId);
        if (!region || region.pageIndex0 !== expected.pageIndex0) mismatch(`cell ${cell.cellId as string} names OCR region ${regionId}, which is not on this page`);
        if (used.has(regionId)) mismatch(`OCR region ${regionId} confirms more than one cell`);
        if (isBbox1000(table.bbox1000) && !contains(table.bbox1000, region!.bbox1000)) mismatch(`OCR region ${regionId} lies outside table ${table.tableId as string}`);
        used.add(regionId);
        texts.push(region!.text);
      }
      if (normalizeSpace(texts.join(" ")) !== normalizeSpace(cell.text as string)) mismatch(`cell ${cell.cellId as string} text differs from the OCR regions that confirm it`);
    }
  }
}

function qualifyTable(table: Row): QualifiedTable | TableReadRefusal {
  if (!isBbox1000(table.bbox1000)) return { bbox1000: null, reasonCode: "TABLE_REGION_UNLOCATED" };
  const box = table.bbox1000;
  const cells = table.cells as Row[];
  if (gridError(table, cells)) return { bbox1000: box, reasonCode: "TABLE_GRID_INVALID" };
  // A cell box that is unusable or falls outside its table is not clamped into place.
  if (cells.some((cell) => cell.bbox1000 !== null && (!isBbox1000(cell.bbox1000) || !contains(box, cell.bbox1000)))) {
    return { bbox1000: box, reasonCode: "TABLE_REGION_UNLOCATED" };
  }
  const qualityFlags = [...(table.qualityFlags as string[])];
  if (cells.some((cell) => cell.bbox1000 === null) && !qualityFlags.includes(CELL_LOCATED_BY_TABLE_BBOX_ONLY)) {
    qualityFlags.push(CELL_LOCATED_BY_TABLE_BBOX_ONLY);
  }
  return {
    tableId: table.tableId as string,
    bbox1000: [...box],
    rowCount: table.rowCount as number,
    columnCount: table.columnCount as number,
    headerRowCount: table.headerRowCount as number,
    qualityFlags,
    cells: cells.map((cell) => {
      const own = cell.bbox1000 as Bbox1000 | null;
      const confirmedBy = [...(cell.confirmedBy as string[])];
      return {
        cellId: cell.cellId as string,
        rowIndex0: cell.rowIndex0 as number,
        columnIndex0: cell.columnIndex0 as number,
        rowSpan: cell.rowSpan as number,
        columnSpan: cell.columnSpan as number,
        text: cell.text as string,
        bbox1000: own ? [...own] : null,
        locatorBbox1000: [...(own ?? box)],
        confirmedBy,
        qualityFlags: own ? [] : [CELL_LOCATED_BY_TABLE_BBOX_ONLY],
        reasonCode: confirmedBy.length ? null : "TABLE_CELL_TEXT_UNCONFIRMED",
      };
    }),
  };
}

/**
 * Qualify one page of table reader output. `payload` undefined or null means the reader produced
 * nothing -- TABLE_READER_UNAVAILABLE, which must never be read as "this page has no table".
 */
export function qualifyTableRead(payload: unknown, expected: TableReadExpectation): TableReadQualification {
  if (payload === undefined || payload === null) {
    return { ok: false, reasonCode: "TABLE_READER_UNAVAILABLE", detail: "no table reader output for this page" };
  }
  try {
    if (!isRow(payload)) invalid("document is not an object");
    const doc = payload as Row;
    const { tables, formulas, refusals } = checkShape(doc);
    checkBinding(doc, expected);
    checkConfirmations(tables, expected);

    const outRefusals: TableReadRefusal[] = refusals.map((refusal) => ({
      bbox1000: refusal.bbox1000 === null ? null : [...(refusal.bbox1000 as Bbox1000)],
      reasonCode: refusal.reasonCode as RefusalReasonCode,
    }));
    const outTables: QualifiedTable[] = [];
    for (const table of tables) {
      const result = qualifyTable(table);
      if ("reasonCode" in result) outRefusals.push(result);
      else outTables.push(result);
    }
    const outFormulas: QualifiedFormula[] = [];
    for (const formula of formulas) {
      const box = [...(formula.bbox1000 as Bbox1000)] as Bbox1000;
      if (isStructurallyValidLatex(formula.latex as string)) {
        outFormulas.push({ formulaId: formula.formulaId as string, bbox1000: box, latex: formula.latex as string, display: formula.display as "inline" | "block" });
      } else outRefusals.push({ bbox1000: box, reasonCode: "FORMULA_LATEX_INVALID" });
    }
    return {
      ok: true,
      pageIndex0: doc.pageIndex0 as number,
      pageNumber1: doc.pageNumber1 as number,
      pageStatus: statusOf(outTables.length, outRefusals),
      tables: outTables,
      formulas: outFormulas,
      refusals: outRefusals,
    };
  } catch (error) {
    if (error instanceof DocumentFailure) return { ok: false, reasonCode: error.reasonCode, detail: error.message };
    throw error;
  }
}
