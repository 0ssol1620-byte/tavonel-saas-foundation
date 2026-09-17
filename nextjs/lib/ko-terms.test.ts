/*
  The term table is the thing under test, not the pages that will read it.

  `app/ko/page.tsx` still carries all three drifts this table names, and it belongs to another
  lane in this campaign: asserting against it here would be a red suite rather than a stricter
  rule, and the patch went out as a cross-lane request instead. What is asserted is the table
  itself and the chrome strings that are already translated -- so the day /ko is corrected, the
  only change needed here is the file list.
*/
import { describe, expect, it } from "vitest";
import { KO_AMBIGUOUS, KO_TERMS, koTermDrift } from "./ko-terms";
import { KO_CHROME } from "./site-navigation";

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
