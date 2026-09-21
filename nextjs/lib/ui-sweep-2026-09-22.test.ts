import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  The five declarations the 2026-09-22 live sweep of tavonel.com put back, pinned where they can
  be pinned without a build.

  These are not new rules. Each one is a place where an existing rule -- the 12px type floor, the
  44px touch floor, readable leading -- was written for a selector that the failing element did
  not match, so the rule shipped and the defect shipped with it. A static assertion is enough for
  four of them because the defect is a *missing declaration*; `e2e/mobile-landing.spec.ts`
  measures the rendered geometry on the routes themselves.

  The ledger is `docs/audit/UI_SWEEP_2026-09-22.md`; the sweep that produced it is
  `scripts/qa/live-sweep.mjs`.

  Newlines are normalised: this repository checks CSS out with CRLF on Windows and LF in CI.
*/
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const tavonel = read("../app/tavonel.css");
const demo = read("../components/signed-product-demo.module.css");

/*
  Every `@media (pointer: coarse), (max-width: 1079px)` block, concatenated. There are two of
  them in this sheet and the floor rules live in the second, so an `indexOf` reads the wrong one
  and the assertions below would pass or fail for the wrong reason.
*/
const touchBlock = (() => {
  const query = "@media (pointer: coarse), (max-width: 1079px)";
  const blocks: string[] = [];
  for (let at = tavonel.indexOf(query); at !== -1; at = tavonel.indexOf(query, at + 1)) {
    let depth = 0;
    for (let index = tavonel.indexOf("{", at); index < tavonel.length; index += 1) {
      if (tavonel[index] === "{") depth += 1;
      else if (tavonel[index] === "}" && --depth === 0) { blocks.push(tavonel.slice(at, index + 1)); break; }
    }
  }
  expect(blocks.length, "the mobile touch-floor blocks still exist").toBeGreaterThan(0);
  return blocks.join("\n");
})();

describe("UI sweep 2026-09-22", () => {
  /*
    UI-001. `components/policy-layout.tsx` renders its legal nav as `.site-links`, and the floor
    rule names `.site-footer`. Seven links on each of /privacy, /terms, /refunds and
    /subprocessors measured 22px tall at 360px, in both Chromium and WebKit.
  */
  it("gives the legal footer's own nav the 44px floor, and keeps its underline on the text", () => {
    expect(touchBlock, ".site-links a takes the touch floor").toMatch(/\.site-links a,/);
    expect(touchBlock, "and is laid out so the floor is a centred box, not a gap below the words")
      .toMatch(/:is\([^)]*\.site-links a\)\s*\{[^}]*align-items:\s*center/);
    /* `border-bottom` follows the box, so at 44px it would sink 11px under the words. The
       underline is restated as a text decoration, which follows the text instead. */
    expect(touchBlock).toMatch(/\.site-links a\s*\{[^}]*text-decoration:\s*underline/);
    expect(touchBlock).toMatch(/\.site-links a\s*\{[^}]*border-bottom:\s*0/);
  });

  /*
    UI-002. A target is two-dimensional. The chips already carried `min-height: 44px` and still
    measured 40px across on the shortest label -- "All" on /changelog at 360px.
  */
  it("gives the filter chips the floor on both axes", () => {
    expect(touchBlock).toMatch(/:is\(\.docs-langs button, \.changelog-filter button\)\s*\{[^}]*min-width:\s*44px/);
  });

  /*
    UI-003. `.demo code` was `font-size: .88em`, which resolved to 10.56px inside `.checks` (12px)
    and 11.44px inside `.facing dd` (13px). `scripts/check-type-floor.mjs` greps declared px
    values and cannot see a relative size compounding past the floor, so this was only ever
    visible on the rendered page.
  */
  it("floors the demo page's inline code at 12px however small its container is", () => {
    expect(demo).toMatch(/\.demo code \{[^}]*font-size:\s*max\(12px,\s*\.88em\)/);
    expect(demo, "no bare relative size is left to compound").not.toMatch(/\.demo code \{[^}]*font-size:\s*\.88em/);
  });

  /*
    UI-004. The /demo source rows are 62px tall and the link inside each one was 26px, so the only
    thing a thumb could hit was the text. The hit area grows into the row's own padding and an
    equal negative margin takes the growth back, which is the pattern `tavonel.css` already uses
    for links in prose -- the row height and the date's baseline do not move.
  */
  it("grows the demo source links into the row they already sit in", () => {
    const rule = demo.match(/\.sources a \{[^}]*\}/)?.[0] ?? "";
    expect(rule, ".sources a states the floor").toMatch(/min-height:\s*44px/);
    expect(rule, "and takes the growth back so the row does not reflow").toMatch(/margin-block:\s*-9px/);
    /* The evidence and export links are standalone 21px lines with no row padding to grow into,
       so they take the padding themselves: 21 + 2x11.5 = 44, given straight back. */
    const standalone = demo.match(/\.evidence a, \.exportRecord > a \{[^}]*padding-block[^}]*\}/)?.[0] ?? "";
    expect(standalone, ".evidence a / .exportRecord > a grow and give it back").toMatch(/padding-block:\s*11\.5px/);
    expect(standalone).toMatch(/margin-block:\s*-11\.5px/);
  });

  /*
    UI-006. The /changelog permalink wraps a `<time>` and measured 26px. Its header is a baseline
    flex row, so a 44px box would push the row and drop the date off the baseline it shares with
    the surface tag -- it takes the same grow-and-give-back pattern instead.
  */
  it("makes the changelog permalinks tappable without moving their baseline row", () => {
    const rule = touchBlock.match(/\.changelog-entry header a \{[^}]*\}/)?.[0] ?? "";
    expect(rule, "the permalink grows to 26 + 2x9 = 44").toMatch(/padding-block:\s*9px/);
    expect(rule, "and gives the growth back").toMatch(/margin-block:\s*-9px/);
  });

  /*
    UI-005. `.policy-copy h2` set a size and no leading, and the inherited value resolved to
    20.16px on 18px -- 1.12, display leading on a heading that wraps to two and three lines on a
    phone. The type scale's own 24/32 step is 1.33; anything at or above 1.25 is readable here.
  */
  it("gives the legal documents' headings reading leading, not display leading", () => {
    const rule = tavonel.match(/\.policy-copy h2 \{[^}]*\}/)?.[0] ?? "";
    const leading = Number(rule.match(/line-height:\s*([\d.]+)/)?.[1]);
    expect(leading, `.policy-copy h2 declares its leading (rule: ${rule})`).not.toBeNaN();
    expect(leading).toBeGreaterThanOrEqual(1.25);
  });
});
