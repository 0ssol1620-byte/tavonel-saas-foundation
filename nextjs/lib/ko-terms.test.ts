/*
  The term table, and the Korean copy that reads it.

  This asserted the table and the chrome only. `app/ko/page.tsx` still carried all three drifts
  the table names and belonged to another lane, so asserting against it would have been a red
  suite rather than a stricter rule. n54 lands that correction and n34 gives the proof block a
  Korean string record, so the file list below is the change the old comment said would be the
  only one needed -- and a fourth Korean surface is one row, not a new test.
*/
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KO_AMBIGUOUS, KO_TERMS, koTermDrift } from "./ko-terms";
import { KO_CHROME } from "./site-navigation";

/** Every file that renders Korean public copy. Add a surface here as it is translated. */
const KO_SURFACES = ["../app/ko/page.tsx", "./proof-copy.ts"];

describe("the Korean term table", () => {
  it("spells each English term exactly one way", () => {
    const spellings = Object.values(KO_TERMS);
    expect(new Set(spellings).size, "two English terms sharing one Korean spelling is a drift too")
      .toBe(Object.keys(KO_TERMS).length);
    expect(KO_TERMS.parser).toBe("파서");
    expect(KO_TERMS.activate, "D9: activate, never promote").toBe("활성화");
    expect(KO_TERMS.use, "쓰다 is not a spelling of use").toBe("사용");
  });

  it("names a replacement for every banned spelling, and does not ban its own", () => {
    for (const entry of KO_AMBIGUOUS) {
      expect(entry.because.length, entry.wrong).toBeGreaterThan(20);
      expect(entry.instead, entry.wrong).not.toBe(entry.wrong);
      if (entry.instead) expect(koTermDrift(entry.instead), entry.instead).toEqual([]);
    }
  });

  it("finds the drift it was written for, and nothing in copy that is already correct", () => {
    expect(koTermDrift("AI가 쓰는 지식으로 만듭니다.").map((entry) => entry.instead)).toEqual(["사용하는 지식"]);
    expect(koTermDrift("고객이 parser나 모델을 고르지 않아도 됩니다.").length).toBe(2);
    expect(koTermDrift("검토·승인된 결과를 AI가 사용할 수 있게 준비합니다.")).toEqual([]);
  });

  it.each(KO_SURFACES)("is true of the Korean copy in %s", (file) => {
    const copy = readFileSync(resolve(import.meta.dirname, file), "utf8");
    expect(koTermDrift(copy).map((entry) => entry.wrong + " -> " + entry.instead)).toEqual([]);
  });

  it("is already true of the Korean chrome", () => {
    const chrome = [
      KO_CHROME.tagline,
      KO_CHROME.stateLine,
      KO_CHROME.signIn,
      ...Object.values(KO_CHROME.cta),
      ...Object.values(KO_CHROME.footerGroups),
    ].join("\n");
    expect(koTermDrift(chrome)).toEqual([]);
    expect(chrome, "the chrome already spells the artifact the way the table does").toContain(KO_TERMS["Compiled World"]);
  });
});
