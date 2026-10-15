import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAIMS_PACK_SHA256, formatFigure, HOME_MEASURES } from "./home-measures";

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
    expect(text(0, "en")).toBe("0broken links in compiled outputOf 1,000 documents offered, 596 compiled and 404 were refused for a link that could not be resolved. Structure only; text correctness is measured separately.");
    expect(text(1, "en")).toContain("80.6olmOCR-Bench score with recovery; 53.7 with only recovery switched off");
    expect(text(1, "en")).toContain("1,403 documents (8,413 checks)");
    expect(text(2, "en")).toContain("36.9%of checks passed on low-quality scans194 of 526 checks");
    expect(text(2, "en")).toContain("1,380 of 1,394 (99.0%)");
    expect(text(2, "ko")).toContain("검사 526개 중 194개");
  });
});
