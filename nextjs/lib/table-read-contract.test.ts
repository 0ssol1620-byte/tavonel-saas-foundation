/**
 * `tavonel.table_read.v1` (table/limits plan 2026-10-17 §C2-§C4, task T2; lane P2-19).
 *
 * The contract for a table reader lane that does not exist yet. Three things are pinned here:
 * every reasonCode has a failure path that produces it, a cell without its own box is flagged and
 * never given a derived one, and every fixture says it is synthetic. Nothing here turns table
 * extraction on; the last block checks that the capability manifest still says so.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_MANIFEST } from "../../shared/capabilityManifest";
import {
  CELL_LOCATED_BY_TABLE_BBOX_ONLY,
  TABLE_READ_REASON_CLASS,
  isStructurallyValidLatex,
  qualifyTableRead,
  type TableReadExpectation,
  type TableReadQualification,
  type TableReadReasonCode,
} from "../../shared/tableReadContract";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Fixture = { synthetic: true; expected: TableReadExpectation; document: Json; qualification: TableReadQualification };

const FIXTURES = resolve(import.meta.dirname, "fixtures", "table-read");
const fixtureNames = readdirSync(FIXTURES).sort();
const load = (name: string): Fixture => JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"));
const READ = "synthetic-read-table-and-formula.json";

/** A fresh, mutable copy of the read fixture, with the mutation applied. */
function variant(mutate: (doc: Json, expected: TableReadExpectation) => void) {
  const { document, expected } = load(READ);
  mutate(document, expected);
  return qualifyTableRead(document, expected);
}
const table = (doc: Json) => doc.tables[0];
const cellOf = (doc: Json, id: string) => table(doc).cells.find((cell: Json) => cell.cellId === id);
const okResult = (result: TableReadQualification) => {
  if (!result.ok) throw new Error(`expected ok, got ${result.reasonCode}: ${result.detail}`);
  return result;
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Every bbox in a value, as JSON. */
function boxes(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    if (value.length === 4 && value.every((n) => typeof n === "number")) found.push(JSON.stringify(value));
    else value.forEach((item) => boxes(item, found));
  } else if (value && typeof value === "object") Object.values(value).forEach((item) => boxes(item, found));
  return found;
}

describe("the fixtures", () => {
  it("are synthetic-*.json files that each carry \"synthetic\": true", () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(3);
    for (const name of fixtureNames) {
      expect(name).toMatch(/^synthetic-[a-z0-9-]+\.json$/);
      const raw = readFileSync(resolve(FIXTURES, name), "utf8");
      // The literal, not a truthy value: a fixture without the label is not one of these.
      expect(JSON.parse(raw).synthetic, name).toBe(true);
      expect(raw, name).toContain('"synthetic": true');
    }
  });

  it.each(fixtureNames)("%s qualifies to its hand-written result", (name) => {
    const { document, expected, qualification } = load(name);
    expect(qualifyTableRead(deepFreeze(document), deepFreeze(expected))).toEqual(qualification);
  });

  it("keep the label on the fixture, never on the reader document", () => {
    // The document's keys are exact; a reader that wrote "synthetic" into its output would fail.
    const result = variant((doc) => { doc.synthetic = true; });
    expect(result).toMatchObject({ ok: false, reasonCode: "TABLE_READ_SCHEMA_INVALID" });
  });
});

describe("a cell without its own bbox", () => {
  const result = okResult(qualifyTableRead(load(READ).document, load(READ).expected));
  const [qualified] = result.tables;
  const cell = (id: string) => qualified.cells.find((item) => item.cellId === id)!;

  it("keeps bbox1000 null, is located by its table's box and is flagged", () => {
    for (const id of ["t1-c4", "t1-c6"]) {
      expect(cell(id).bbox1000).toBeNull();
      expect(cell(id).locatorBbox1000).toEqual(qualified.bbox1000);
      expect(cell(id).qualityFlags).toEqual([CELL_LOCATED_BY_TABLE_BBOX_ONLY]);
    }
    expect(qualified.qualityFlags).toEqual([CELL_LOCATED_BY_TABLE_BBOX_ONLY]);
  });

  it("is not given the box of the OCR region that confirmed its text", () => {
    // t1-c4 is confirmed by r-0005, which has a measured box. That box stays the OCR reader's;
    // the cell is still located by the table only.
    expect(cell("t1-c4").confirmedBy).toEqual(["r-0005"]);
    expect(cell("t1-c4").locatorBbox1000).not.toEqual([300, 240, 500, 280]);
  });

  it("leaves a cell that has a box unflagged and pointing at its own box", () => {
    expect(cell("t1-c1").qualityFlags).toEqual([]);
    expect(cell("t1-c1").locatorBbox1000).toEqual([100, 200, 300, 240]);
  });

  it("does not flag a table whose every cell has a box", () => {
    const all = okResult(variant((doc) => {
      cellOf(doc, "t1-c4").bbox1000 = [300, 240, 500, 280];
      cellOf(doc, "t1-c6").bbox1000 = [300, 280, 500, 320];
    }));
    expect(all.tables[0].qualityFlags).toEqual([]);
    expect(all.tables[0].cells.every((item) => item.qualityFlags.length === 0)).toBe(true);
  });

  it.each(fixtureNames)("%s: every box in the result is a box the document carried", (name) => {
    const { document, expected } = load(name);
    const carried = new Set(boxes(document));
    for (const box of boxes(qualifyTableRead(document, expected))) expect(carried, box).toContain(box);
  });

  it("is never repaired by clamping a box that falls outside its table", () => {
    const result = okResult(variant((doc) => { cellOf(doc, "t1-c1").bbox1000 = [60, 200, 300, 240]; }));
    expect(result.tables).toEqual([]);
    expect(result.refusals).toEqual([{ bbox1000: [80, 180, 520, 330], reasonCode: "TABLE_REGION_UNLOCATED" }]);
  });
});

/*
  One failure path per reasonCode -- and the block after this one fails if a code is added to
  TABLE_READ_REASON_CLASS without a row here.
*/
type Case = [label: string, code: TableReadReasonCode, run: () => TableReadQualification, check: (result: TableReadQualification) => void];
const documentFailure = (code: TableReadReasonCode) => (result: TableReadQualification) =>
  expect(result).toMatchObject({ ok: false, reasonCode: code });
const refusedTable = (code: TableReadReasonCode, bbox1000: number[] | null) => (result: TableReadQualification) => {
  const ok = okResult(result);
  expect(ok.tables, "a refused table emits no cells").toEqual([]);
  expect(ok.refusals).toContainEqual({ bbox1000, reasonCode: code });
  expect(ok.pageStatus).toBe("unreadable");
  expect(ok.formulas.map((formula) => formula.formulaId), "the rest of the page survives").toEqual(["f1"]);
};

const FAILURES: Case[] = [
  ["no reader output (undefined)", "TABLE_READER_UNAVAILABLE", () => qualifyTableRead(undefined, load(READ).expected), documentFailure("TABLE_READER_UNAVAILABLE")],
  ["no reader output (null)", "TABLE_READER_UNAVAILABLE", () => qualifyTableRead(null, load(READ).expected), documentFailure("TABLE_READER_UNAVAILABLE")],

  ["another sanitized PDF", "TABLE_BINDING_MISMATCH", () => variant((doc) => { doc.inputSha256 = `sha256:${"0".repeat(64)}`; }), documentFailure("TABLE_BINDING_MISMATCH")],
  ["another reader revision", "TABLE_BINDING_MISMATCH", () => variant((doc) => { doc.readerRevision = `sha256:${"1".repeat(64)}`; }), documentFailure("TABLE_BINDING_MISMATCH")],
  ["another reader binding", "TABLE_BINDING_MISMATCH", () => variant((doc) => { doc.readerBindingSha256 = `sha256:${"2".repeat(64)}`; }), documentFailure("TABLE_BINDING_MISMATCH")],
  ["another source key", "TABLE_BINDING_MISMATCH", () => variant((doc) => { doc.sourceImmutableKey = "synthetic/table-read/source-0002/sanitized.pdf"; }), documentFailure("TABLE_BINDING_MISMATCH")],
  ["another page", "TABLE_BINDING_MISMATCH", () => variant((doc) => { doc.pageIndex0 = 1; doc.pageNumber1 = 2; }), documentFailure("TABLE_BINDING_MISMATCH")],
  ["confirmedBy names an OCR region that does not exist", "TABLE_BINDING_MISMATCH", () => variant((doc) => { cellOf(doc, "t1-c1").confirmedBy = ["r-9999"]; }), documentFailure("TABLE_BINDING_MISMATCH")],
  ["confirmedBy names a region on another page", "TABLE_BINDING_MISMATCH", () => variant((doc) => { cellOf(doc, "t1-c6").confirmedBy = ["r-0101"]; }), documentFailure("TABLE_BINDING_MISMATCH")],
  ["one OCR region confirms two cells", "TABLE_BINDING_MISMATCH", () => variant((doc) => { cellOf(doc, "t1-c6").text = "12"; cellOf(doc, "t1-c6").confirmedBy = ["r-0005"]; }), documentFailure("TABLE_BINDING_MISMATCH")],
  ["a confirming region outside the table", "TABLE_BINDING_MISMATCH", () => variant((doc) => { cellOf(doc, "t1-c6").text = "Synthetic page heading"; cellOf(doc, "t1-c6").confirmedBy = ["r-0001"]; }), documentFailure("TABLE_BINDING_MISMATCH")],
  ["a confirming region with other text", "TABLE_BINDING_MISMATCH", () => variant((doc) => { cellOf(doc, "t1-c4").text = "13"; }), documentFailure("TABLE_BINDING_MISMATCH")],

  ["a payload that is not an object", "TABLE_READ_SCHEMA_INVALID", () => qualifyTableRead("[]", load(READ).expected), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["an extra document key", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { doc.confidence = 1; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["a missing cell key", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { delete cellOf(doc, "t1-c1").confirmedBy; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["another schema version", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { doc.schemaVersion = "tavonel.table_read.v2"; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["a bare hex digest", "TABLE_READ_SCHEMA_INVALID", () => variant((doc, expected) => { doc.inputSha256 = "5e".repeat(32); expected.inputSha256 = doc.inputSha256; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["pageNumber1 not pageIndex0 + 1", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { doc.pageNumber1 = 3; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["a repeated cellId", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { cellOf(doc, "t1-c6").cellId = "t1-c5"; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["a non-integer span", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { cellOf(doc, "t1-c1").rowSpan = 1.5; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["\"read\" with no table", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { doc.tables = []; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["\"no_table\" beside a truncated table", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => {
    doc.pageStatus = "no_table"; doc.tables = []; doc.refusals = [{ bbox1000: [80, 180, 520, 330], reasonCode: "TABLE_OUTPUT_TRUNCATED" }];
  }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["a refusal with a document-level code", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { doc.refusals = [{ bbox1000: null, reasonCode: "TABLE_READER_UNAVAILABLE" }]; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["a refusal with the cell-level code", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { doc.refusals = [{ bbox1000: null, reasonCode: "TABLE_CELL_TEXT_UNCONFIRMED" }]; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["a truncated refusal over a table the reader still emitted", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => {
    doc.refusals = [{ bbox1000: [80, 180, 520, 330], reasonCode: "TABLE_OUTPUT_TRUNCATED" }];
  }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["a formula without a box", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => { doc.formulas[0].bbox1000 = null; }), documentFailure("TABLE_READ_SCHEMA_INVALID")],
  ["more tables than one page carries", "TABLE_READ_SCHEMA_INVALID", () => variant((doc) => {
    doc.tables = Array.from({ length: 65 }, (_, index) => ({ ...table(doc), tableId: `t${index}`, cells: [] }));
  }), documentFailure("TABLE_READ_SCHEMA_INVALID")],

  ["the reader's output hit the token limit", "TABLE_OUTPUT_TRUNCATED", () => {
    const { document, expected } = load("synthetic-unreadable-truncated.json");
    return qualifyTableRead(document, expected);
  }, (result) => {
    const ok = okResult(result);
    expect(ok.pageStatus).toBe("unreadable");
    expect(ok.tables).toEqual([]);
    expect(ok.refusals).toEqual([{ bbox1000: [80, 180, 920, 700], reasonCode: "TABLE_OUTPUT_TRUNCATED" }]);
  }],
  ["a second, truncated table beside a read one", "TABLE_OUTPUT_TRUNCATED", () => variant((doc) => {
    doc.refusals = [{ bbox1000: [80, 600, 920, 900], reasonCode: "TABLE_OUTPUT_TRUNCATED" }];
  }), (result) => {
    const ok = okResult(result);
    expect(ok.pageStatus).toBe("read");
    expect(ok.tables.map((item) => item.tableId)).toEqual(["t1"]);
    expect(ok.refusals).toEqual([{ bbox1000: [80, 600, 920, 900], reasonCode: "TABLE_OUTPUT_TRUNCATED" }]);
  }],

  ["two cells on one slot", "TABLE_GRID_INVALID", () => variant((doc) => { cellOf(doc, "t1-c6").rowIndex0 = 1; }), refusedTable("TABLE_GRID_INVALID", [80, 180, 520, 330])],
  ["a span past the last column", "TABLE_GRID_INVALID", () => variant((doc) => { cellOf(doc, "t1-c6").columnSpan = 2; }), refusedTable("TABLE_GRID_INVALID", [80, 180, 520, 330])],
  ["more header rows than rows", "TABLE_GRID_INVALID", () => variant((doc) => { table(doc).headerRowCount = 4; }), refusedTable("TABLE_GRID_INVALID", [80, 180, 520, 330])],
  ["a table with no cells", "TABLE_GRID_INVALID", () => variant((doc) => { table(doc).cells = []; }), refusedTable("TABLE_GRID_INVALID", [80, 180, 520, 330])],

  ["a table with no box", "TABLE_REGION_UNLOCATED", () => variant((doc) => { table(doc).bbox1000 = null; }), refusedTable("TABLE_REGION_UNLOCATED", null)],
  ["a table box past 1000", "TABLE_REGION_UNLOCATED", () => variant((doc) => { table(doc).bbox1000 = [80, 180, 1001, 330]; }), refusedTable("TABLE_REGION_UNLOCATED", null)],
  ["a table box with x1 >= x2", "TABLE_REGION_UNLOCATED", () => variant((doc) => { table(doc).bbox1000 = [520, 180, 80, 330]; }), refusedTable("TABLE_REGION_UNLOCATED", null)],
  ["a cell box outside its table", "TABLE_REGION_UNLOCATED", () => variant((doc) => { cellOf(doc, "t1-c1").bbox1000 = [100, 150, 300, 240]; }), refusedTable("TABLE_REGION_UNLOCATED", [80, 180, 520, 330])],
  ["a cell box of three numbers", "TABLE_REGION_UNLOCATED", () => variant((doc) => { cellOf(doc, "t1-c1").bbox1000 = [100, 200, 300]; }), refusedTable("TABLE_REGION_UNLOCATED", [80, 180, 520, 330])],

  ["a cell no OCR region confirms", "TABLE_CELL_TEXT_UNCONFIRMED", () => qualifyTableRead(load(READ).document, load(READ).expected), (result) => {
    const cells = okResult(result).tables[0].cells;
    const unconfirmed = cells.filter((item) => item.reasonCode === "TABLE_CELL_TEXT_UNCONFIRMED");
    expect(unconfirmed.map((item) => item.cellId)).toEqual(["t1-c6"]);
    // Shown as evidence -- still in the table -- with nothing confirming it.
    expect(unconfirmed[0].confirmedBy).toEqual([]);
    expect(cells.filter((item) => item.reasonCode === null)).toHaveLength(5);
  }],

  ["an unclosed brace", "FORMULA_LATEX_INVALID", () => variant((doc) => { doc.formulas[0].latex = "\\frac{a}{b"; }), (result) => {
    const ok = okResult(result);
    expect(ok.formulas).toEqual([]);
    expect(ok.refusals).toEqual([{ bbox1000: [100, 400, 600, 460], reasonCode: "FORMULA_LATEX_INVALID" }]);
    expect(ok.tables.map((item) => item.tableId), "the table survives").toEqual(["t1"]);
    expect(ok.pageStatus).toBe("read");
  }],
];

describe("every reasonCode has a failure path", () => {
  it("covers each code in TABLE_READ_REASON_CLASS, and no other", () => {
    expect([...new Set(FAILURES.map(([, code]) => code))].sort()).toEqual(Object.keys(TABLE_READ_REASON_CLASS).sort());
  });

  it.each(FAILURES)("%s -> %s", (_label, code, run, check) => {
    const result = run();
    check(result);
    if (!result.ok) expect(result.reasonCode).toBe(code);
  });

  it("never reads a missing reader as a page without tables", () => {
    const result = qualifyTableRead(undefined, load(READ).expected);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("pageStatus");
  });

  it("keeps operational failure apart from the reader being wrong", () => {
    expect(TABLE_READ_REASON_CLASS.TABLE_READER_UNAVAILABLE).toBe("operational");
    expect(TABLE_READ_REASON_CLASS.TABLE_BINDING_MISMATCH).toBe("evidence");
    for (const code of ["TABLE_OUTPUT_TRUNCATED", "TABLE_GRID_INVALID", "TABLE_REGION_UNLOCATED", "TABLE_CELL_TEXT_UNCONFIRMED", "FORMULA_LATEX_INVALID"] as const) {
      expect(TABLE_READ_REASON_CLASS[code]).toBe("semantic");
    }
  });
});

describe("confirmations", () => {
  it("accept a cell whose text spans two OCR lines, joined in order", () => {
    const result = okResult(variant((doc, expected) => {
      expected.ocrRegions = [...expected.ocrRegions, { regionId: "r-0007", pageIndex0: 0, text: "7", bbox1000: [300, 280, 400, 320] },
        { regionId: "r-0008", pageIndex0: 0, text: "units", bbox1000: [400, 280, 500, 320] }];
      Object.assign(cellOf(doc, "t1-c6"), { text: "7  units", confirmedBy: ["r-0007", "r-0008"] });
    }));
    expect(result.tables[0].cells.find((item) => item.cellId === "t1-c6")!.reasonCode).toBeNull();
  });

  it("normalize whitespace only -- case is not folded", () => {
    expect(variant((doc) => { cellOf(doc, "t1-c1").text = " Region\n"; })).toMatchObject({ ok: true });
    expect(variant((doc) => { cellOf(doc, "t1-c1").text = "region"; })).toMatchObject({ ok: false, reasonCode: "TABLE_BINDING_MISMATCH" });
  });
});

describe("the LaTeX structure check", () => {
  it.each(["x = \\frac{a}{b}", "\\{a\\}", "a \\\\ {b}", "\\left( x \\right)", "a \\leftarrow b", "\\begin{matrix} a & b \\end{matrix}", "\\$5"])("accepts %s", (latex) => {
    expect(isStructurallyValidLatex(latex)).toBe(true);
  });
  it.each(["", "  ", "\\frac{a}{b", "a}", "$x$", "\\left( x", "x \\right)", "\\begin{matrix} a", "\\begin{matrix} a \\end{cases}", "a\u0000b"])("refuses %j", (latex) => {
    expect(isStructurallyValidLatex(latex)).toBe(false);
  });
});

describe("posture: this contract turns nothing on", () => {
  it("leaves no_table_or_formula_extraction on every read format and no table reader in any plan", () => {
    const read = CAPABILITY_MANIFEST.entries.filter((entry) => entry.readerPlan.length > 0);
    expect(read.length).toBeGreaterThan(0);
    for (const entry of read) {
      expect(entry.knownLimitations, entry.mime).toContain("no_table_or_formula_extraction");
      expect(entry.readerPlan.some((provider) => provider.includes("table")), entry.mime).toBe(false);
    }
  });
});
