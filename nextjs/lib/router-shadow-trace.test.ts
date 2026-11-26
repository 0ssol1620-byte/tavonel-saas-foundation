import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_TABLE, EVIDENCE_TABLE_SHA256, classifyPages, tableSha256, validateEvidenceTable } from "./router-shadow-trace";

const native = (p: number) => ({ regionId: `native-p${String(p + 1).padStart(4, "0")}`, pageIndex0: p });
const ocr = (p: number, l = 1) => ({ regionId: `ocr-p${String(p + 1).padStart(4, "0")}-l${String(l).padStart(5, "0")}`, pageIndex0: p });

describe("router shadow classifier", () => {
  it("classifies native, raster, empty and mixed pages from region ids", () => {
    const r = classifyPages(4, [native(0), ocr(1), ocr(1, 2), native(3), ocr(3, 1)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pages.map((p) => p.pageClass)).toEqual(["native_text", "raster_text", "no_text", "unclassifiable"]);
    expect(r.pages[0]).toMatchObject({ evidenceRowId: "RT-1", incumbentRoute: "native_text", agreesWithIncumbent: true, costUsd: null, costReason: "COST_UNMEASURED" });
    expect(r.pages[1]).toMatchObject({ evidenceRowId: "RT-3", agreesWithIncumbent: true });
    expect(r.pages[2]).toMatchObject({ evidenceRowId: "RT-3" });
  });

  it("never defaults an unknown id, a mismatched page number or a mixed page to a class", () => {
    const r = classifyPages(3, [{ regionId: "weird-1", pageIndex0: 0 }, { regionId: "native-p0001", pageIndex0: 1 }, { regionId: "ocr-p0003-l00001", pageIndex0: 2 }, native(2)]);
    expect(r.ok && r.pages.map((p) => p.pageClass)).toEqual(["unclassifiable", "unclassifiable", "unclassifiable"]);
    if (r.ok) expect(r.pages[0]).toMatchObject({ evidenceRowId: null, evidenceRoute: null, agreesWithIncumbent: null, costReason: "NO_EVIDENCE_ROW" });
  });

  it.each([
    [0, []], [-1, []], [1.5, []], [NaN, []], [Infinity, []], ["2", []], [null, []], [100_001, []],
  ])("refuses page count %s", (count, regions) => {
    expect(classifyPages(count, regions)).toEqual({ ok: false, code: "PAGE_COUNT_INVALID" });
  });

  it.each([
    [undefined], [null], ["x"], [{}], [[null]], [[{ regionId: 1, pageIndex0: 0 }]], [[{ regionId: "native-p0001" }]],
    [[{ regionId: "native-p0001", pageIndex0: 1 }]], [[{ regionId: "native-p0001", pageIndex0: -1 }]],
    [[{ regionId: "native-p0001", pageIndex0: 0.5 }]], [[{ regionId: "native-p0001", pageIndex0: NaN }]],
  ])("refuses malformed regions %j", (regions) => {
    expect(classifyPages(1, regions)).toEqual({ ok: false, code: "REGION_INVALID" });
  });

  it("carries no text, bbox or region content in a decision", () => {
    const r = classifyPages(1, [{ ...native(0), text: "secret", bbox: [1, 2, 3, 4] }]);
    expect(JSON.stringify(r)).not.toMatch(/secret|bbox|regionId/);
  });

  it("hashes the real table file by content, independent of key order", () => {
    const file = JSON.parse(readFileSync(join(__dirname, "router-evidence-table.v1.json"), "utf8"));
    expect(EVIDENCE_TABLE_SHA256).toBe(tableSha256(validateEvidenceTable(file)));
    const reordered = validateEvidenceTable(Object.fromEntries(Object.entries(file).reverse()));
    expect(tableSha256(reordered)).toBe(EVIDENCE_TABLE_SHA256);
    expect(tableSha256({ ...EVIDENCE_TABLE, tableVersion: 2 })).not.toBe(EVIDENCE_TABLE_SHA256);
    expect(EVIDENCE_TABLE_SHA256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("makes no unobservable stratum selectable and fails closed on a malformed table", () => {
    expect(Object.values(EVIDENCE_TABLE.classes).map((c) => c.rowId).sort()).not.toContain("RT-2a");
    const bad = [
      null, { ...EVIDENCE_TABLE, schemaVersion: "x" }, { ...EVIDENCE_TABLE, tableVersion: 1.5 },
      { ...EVIDENCE_TABLE, rows: [...EVIDENCE_TABLE.rows, EVIDENCE_TABLE.rows[0]] },
      { ...EVIDENCE_TABLE, rows: [{ id: "RT-1", route: "a", costUsdPerPage: NaN }, EVIDENCE_TABLE.rows[1]] },
      { ...EVIDENCE_TABLE, classes: { native_text: { rowId: "RT-9", incumbentRoute: "x" } } },
    ];
    for (const t of bad) expect(() => validateEvidenceTable(t)).toThrow("ROUTER_EVIDENCE_TABLE_INVALID");
  });

  it("reports a measured cost and disagreement from a supplied table, not a hand estimate", () => {
    const t = validateEvidenceTable({ ...EVIDENCE_TABLE, rows: [{ id: "RT-1", route: "other", costUsdPerPage: 0.01 }, EVIDENCE_TABLE.rows[1]] });
    const r = classifyPages(1, [native(0)], t);
    expect(r.ok && r.pages[0]).toMatchObject({ agreesWithIncumbent: false, costUsd: 0.01, costReason: null });
    expect(r.ok && r.tableSha256).toBe(tableSha256(t));
  });
});
