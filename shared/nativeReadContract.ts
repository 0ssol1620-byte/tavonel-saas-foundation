/**
 * `tavonel.native_read.v1`: the table cells of one DOCX, XLSX or PPTX, read natively by the CDR
 * quarantine service's `POST /v1/native-read` (WO-E-TBL-1; ADR-2026-11-18-structured-table-routes,
 * route A). Producer: `quarantine-sidecar/cdr-cloudrun/native_read_child.py`, which runs the Core
 * native parser vendored at a pinned Core SHA. `tests/test_native_reader.py` there checks that the
 * schema name, the reason codes and their classes below are the producer's, value for value.
 *
 * Contract only on this side. The route is held behind `TAVONEL_CDR_NATIVE_READ` (default off), no
 * worker calls it, nothing persists this document and nothing in the product path reads it. The
 * capability manifest keeps `no_table_or_formula_extraction`; this document is not table support
 * and claims none.
 *
 * What it covers: table cells of DOCX, XLSX and PPTX. Not CSV (the Core parser does not read it),
 * not HTML/SRT/VTT (not routed), not paragraph text, images or charts. It never carries a bounding
 * box: a cell is located by its container (sheet, slide or body ordinal), its table's index and,
 * in a workbook, its cell address. A formula carries its source and the value the file cached,
 * never a value computed by the reader; `cachedValueState` is never "verified".
 *
 * A read that did not happen is `native_read: "unavailable"` with a reason, never an empty
 * `tables` list. `operational` reasons are the reader's or its sandbox's; `document` reasons are
 * this file's, and retrying the same bytes will not change them.
 */

export const NATIVE_READ_SCHEMA = "tavonel.native_read.v1" as const;

export const NATIVE_READ_REASON_CLASS = {
  unsupported_format: "document",
  office_package_refused: "document",
  parser_refused: "document",
  output_limit: "document",
  reader_absent: "operational",
  reader_integrity_failed: "operational",
  sandbox_unavailable: "operational",
  input_binding_mismatch: "operational",
  reader_timeout: "operational",
  reader_resource_limit: "operational",
  reader_crashed: "operational",
  reader_output_invalid: "operational",
} as const;
export type NativeReadReason = keyof typeof NATIVE_READ_REASON_CLASS;

export type NativeReadUnavailable = {
  schema: typeof NATIVE_READ_SCHEMA;
  native_read: "unavailable";
  reason: NativeReadReason;
  reasonClass: "document" | "operational";
  /** The Core parser's own refusal code (for example `ARCHIVE_RATIO_LIMIT`); only with `parser_refused`. */
  parserCode: string | null;
  inputSha256: string;
};

export type CachedValueState = "cached_unverified" | "cached_declared_stale" | "cached_missing";

export type NativeReadCell = {
  cellId: string;
  rowIndex0: number;
  columnIndex0: number;
  rowSpan: number;
  columnSpan: number;
  kind: "value" | "formula";
  /** The cell's text; null for a formula cell, whose source and cache are in `formula`. */
  text: string | null;
  formula: { source: string; cachedValue: string | null; cachedValueState: CachedValueState } | null;
  location: {
    containerIndex0: number;
    tableIndex0: number;
    nativeObjectId: string;
    /** A1 address in a workbook; null in a document or a presentation. */
    cellAddress: string | null;
  };
  qualityFlags: string[];
};

export type NativeReadTable = {
  tableIndex0: number;
  tableId: string;
  containerIndex0: number;
  nativeObjectId: string;
  /** The sheet range the table spans, in a workbook; null otherwise. */
  range: string | null;
  rowCount: number;
  columnCount: number;
  headerRowCount: number;
  qualityFlags: string[];
  cells: NativeReadCell[];
};

export type NativeReadAvailable = {
  schema: typeof NATIVE_READ_SCHEMA;
  native_read: "available";
  reason: null;
  reasonClass: null;
  parserCode: null;
  inputSha256: string;
  reader: { parser: "akc_native_parsers"; parserVersion: string; coreSha: string; vendorManifestSha256: string };
  documentType: "docx" | "xlsx" | "pptx";
  containerKind: "sheet" | "slide" | "container_ordinal";
  /** Workbook sheets with their visibility; empty for a document or a presentation. */
  containers: Array<{ index0: number; name: string; state: "visible" | "hidden" | "veryHidden"; hiddenRows: number[]; hiddenColumns: string[] }>;
  /** `fullCalcOnLoad`: the workbook declares its own cached values stale. Null outside a workbook. */
  workbookCalculation: { fullCalcOnLoad: boolean } | null;
  coverage: {
    cells: "tables_only";
    formats: Array<"docx" | "pptx" | "xlsx">;
    formulasExecuted: false;
    cachedValues: "reported_unverified";
    externalReferences: "refused";
    macros: "refused";
    boundingBoxes: "not_emitted";
  };
  tables: NativeReadTable[];
  warnings: string[];
};

export type NativeRead = NativeReadAvailable | NativeReadUnavailable;
