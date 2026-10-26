import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pack from "../content/evidence/public-claims-pack.json";
import { carried, CLAIMS_PACK_SHA256, formatFigure, HOME_MEASURES } from "./home-measures";

/*
  The claims pack is generated in the evidence repository and copied here byte for byte. A copy that
  was edited -- a figure nudged, a withheld claim flipped to approved -- hashes differently and
  fails here, before the band can print anything from it.
*/
describe("Home measurement band data", () => {
  it("reads a byte-identical copy of the generated claims pack", () => {
    const bytes = readFileSync(new URL("../content/evidence/public-claims-pack.json", import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(CLAIMS_PACK_SHA256);
  });

  it("prints each headline as the pack states it, with its denominator beside it", () => {
    const text = (index: number, locale: "en" | "ko") => {
      const copy = HOME_MEASURES[index]![locale];
      return [...copy.figure, ...copy.label, ...copy.detail].map(part => (typeof part === "string" ? part : formatFigure(part))).join("");
    };
    // FINAL-SPEC 2026-10-26 D-12: R-01 first, then R-02 -- the same facts, word for word, in receipt order.
    expect(HOME_MEASURES.map(measure => measure.receipt.id)).toEqual(["R-01", "R-02", "R-03"]);
    expect(text(1, "en")).toBe("0broken links in compiled outputOf 1,000 documents offered, 596 compiled and 404 were refused for a link that could not be resolved. These guarantees describe the structure of the compiled output. They are a separate measure from whether the extracted text is correct.");
    expect(text(0, "en")).toContain("80.6olmOCR-Bench score with recovery; 53.7 with only recovery switched off");
    expect(text(0, "en")).toContain("1,403 documents, 8,413 checks.");
    expect(text(2, "en")).toContain("36.9%of checks passed on low-quality scans194 of 526 checks on low-quality scans; 1,380 of 1,394 on standard digital documents.");
    expect(text(2, "en")).toContain("The spread runs from 99.0% to 36.9%.");
    expect(text(2, "ko")).toContain("저품질 스캔본 검사 526개 중 194개");
  });

  /*
    decision.md A-11 / brief move 7: the constraint wording is the pack's, carried, never re-authored.
    Each fact ends on its claim's must-say exactly as generated, in both languages; a band that
    paraphrased one ("Structure only; ...") fails here.
  */
  it("ends each fact on its claim's must-say, verbatim from the generated pack", () => {
    const claims = (pack as { claims: { id: string; must_say?: string; must_say_en?: string }[] }).claims;
    const detail = (index: number, locale: "en" | "ko") =>
      HOME_MEASURES[index]![locale].detail.map(part => (typeof part === "string" ? part : formatFigure(part))).join("");
    HOME_MEASURES.forEach((measure, index) => {
      const claim = claims.find(entry => entry.id === measure.claim)!;
      expect(claim.must_say_en, measure.claim).toBeTruthy();
      expect(claim.must_say, measure.claim).toBeTruthy();
      expect(detail(index, "en").endsWith(claim.must_say_en!), measure.claim).toBe(true);
      expect(detail(index, "ko").endsWith(claim.must_say!), measure.claim).toBe(true);
    });
    // The two figures inside the accuracy must-say are figures of that claim, not loose digits.
    const figures = HOME_MEASURES[2]!.en.detail.filter(part => typeof part !== "string").map(part => formatFigure(part as { n: number; d: number }));
    expect(figures.slice(-2)).toEqual(["99.0", "36.9"]);
  });

  it("refuses a must-say number the claim does not carry, or carries at another precision", () => {
    expect(carried("x", "From 99.0% to 36.9%.", [99, 36.9])).toEqual(["From ", { n: 99, d: 1 }, "% to ", { n: 36.9, d: 1 }, "%."]);
    expect(() => carried("x", "From 99.0% to 37%.", [99, 36.9])).toThrow(/"37"/);
    expect(() => carried("x", "Rose to 81.", [80.6])).toThrow(/"81"/);
    expect(() => carried("x", "1403 documents", [1403])).toThrow(/"1403"/);
  });
});
