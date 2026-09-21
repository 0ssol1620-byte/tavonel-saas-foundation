import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HeroProof from "../components/landing-v2/hero-proof";
import { HERO_PROOF_COPY } from "./hero-proof-copy";
import { HERO_STATS } from "./hero-stats";
import { sampleEvidencePage } from "./evidence-regions";

/*
  GAP #1: the home hero's live Evidence Inspector, and the rules it is not allowed to break.

  The panel reuses `components/evidence/region-highlight.tsx`, whose own contract is held by
  `lib/evidence-regions.test.ts`. What this file holds is the three things that are true because
  it is in the hero: it works before hydration, it mounts nothing heavy at any width, and it
  neither grades the reading nor draws a structure this deployment does not extract.
*/

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const html = renderToStaticMarkup(createElement(HeroProof, {}));
const korean = renderToStaticMarkup(createElement(HeroProof, { korean: true }));

describe("the home hero's evidence panel", () => {
  it("serves a whole region in the server render, before any script runs", () => {
    const view = sampleEvidencePage();
    const first = view.regions[0]!;
    /* The excerpt, the locator and the source line are all in the HTML with JavaScript off. */
    expect(html).toContain(first.excerpt.slice(0, 40));
    expect(html).toContain(`p.${view.source.page} of ${view.source.pageCount}`);
    expect(html).toContain(view.source.filename);
    expect(html).toContain(view.source.digest);
  });

  it("draws the real page raster and the real boxes, with no page of its own invention", () => {
    const view = sampleEvidencePage();
    expect(view.image, "the sample World publishes no raster for its chosen page").toBeTruthy();
    expect(html).toContain(view.image!.src);
    for (const region of view.regions) {
      expect(html).toContain(`left:${region.bbox1000[0] / 10}%`);
    }
  });

  it("is keyboard operable: one real button per region, in document order", () => {
    const view = sampleEvidencePage();
    const buttons = html.match(/<button[^>]*aria-pressed=/g) ?? [];
    expect(buttons).toHaveLength(view.regions.length);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("mounts no canvas and no WebGL, at any width", () => {
    for (const markup of [html, korean]) {
      for (const heavy of ["<canvas", "webgl", "<video", "<iframe", "requestanimationframe"]) {
        expect(markup.toLowerCase(), `the hero panel mounts ${heavy}`).not.toContain(heavy);
      }
    }
    /*
      And nothing under it can pull one in. The 900px rule is satisfied by there being nothing to
      fall back FROM: the panel's whole module graph is the region highlight and two data modules.
    */
    for (const path of [
      "components/landing-v2/hero-proof.tsx",
      "components/evidence/region-highlight.tsx",
    ]) {
      const text = source(path)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/.*$/gm, " ");
      for (const heavy of ["three", "react-three", "canvas", "WebGL", "dynamic("]) {
        expect(text, `${path} reaches for ${heavy}`).not.toContain(heavy);
      }
    }
  });

  it("renders no table, no row and no cell", () => {
    /* The capability manifest records `no_table_or_formula_extraction`; a lattice over a filing
       page would show a structure nothing here extracts. */
    for (const markup of [html, korean]) {
      for (const tag of [
        "<table",
        "<thead",
        "<tbody",
        "<tr",
        "<td",
        "<th",
        'role="grid"',
        'role="row"',
        'role="cell"',
      ]) {
        expect(markup, `the hero panel renders ${tag}`).not.toContain(tag);
      }
    }
  });

  it("never says accuracy, and claims no confidence for a region", () => {
    for (const markup of [html, korean]) {
      const text = markup.replace(/<[^>]*>/g, " ").toLowerCase();
      for (const word of ["accuracy", "accurate", "정확도", "confidence", "신뢰도"]) {
        expect(text, `the hero panel says "${word}"`).not.toContain(word);
      }
    }
  });

  it("carries no animation and no transition of its own, so reduced motion has nothing to undo", () => {
    const css = source("app/landing-v2.css");
    const block = css.slice(css.indexOf(".lv2-hero-proof"));
    const ours =
      block.match(/\.lv2-hero-(?:proof|inspector|stats|stat-value|stat-label)[^{]*\{[^}]*\}/g) ?? [];
    expect(ours.length).toBeGreaterThan(0);
    for (const rule of ours) {
      expect(rule, "the hero panel animates").not.toMatch(/animation|transition|@keyframes/);
    }
  });

  it("puts a label and a source link on every figure, in both languages", () => {
    for (const [markup, locale] of [
      [html, "en"],
      [korean, "ko"],
    ] as const) {
      const copy = HERO_PROOF_COPY[locale];
      expect(markup).toContain(copy.stripLabel);
      expect(markup).toContain(copy.caption.slice(0, 30));
      for (const [index, entry] of HERO_STATS.entries()) {
        expect(markup).toContain(entry.value);
        expect(markup).toContain(copy.stats[index]!);
        expect(markup).toContain(`href="${entry.href.replace("&", "&amp;")}"`);
      }
    }
  });

  it("adds no heading: the hero already has the page's only h1", () => {
    for (const markup of [html, korean]) {
      expect(markup).not.toMatch(/<h[1-6][\s>]/);
    }
  });
});

/*
  THE 360px STACKING RULE, read off the stylesheet.

  There is no layout engine in this test runner, so the geometry is asserted where it is written:
  the strip is declared one column, and every rule that gives it more than one is inside a
  `min-width` query at or above the width it is allowed at. A `max-width` query that widened it,
  or a default multi-column declaration, would put four columns on a 360px phone -- which is the
  overflow the founder's phone check finds, and this assertion finds it first.
*/
describe("the hero panel's geometry below 900px", () => {
  const css = source("app/landing-v2.css");
  const block = css.slice(css.indexOf("the hero's proof panel"));

  it("declares one column by default and widens only inside a min-width query", () => {
    expect(block).toMatch(/\.lv2-hero-stats\s*\{[^}]*grid-template-columns:\s*1fr/);
    const widened = [
      ...block.matchAll(/\.lv2-hero-stats\s*\{\s*grid-template-columns:\s*repeat\((\d)/g),
    ];
    expect(widened.length).toBeGreaterThan(0);
    for (const match of widened) {
      const before = block.slice(0, match.index);
      const query = before.lastIndexOf("@media");
      expect(query, "a multi-column strip outside any media query").toBeGreaterThan(-1);
      const declared = before.slice(query, before.indexOf("{", query));
      const min = Number(declared.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
      expect(min, `columns widened at ${declared.trim()}`).toBeGreaterThan(360);
      /* Four columns are the desktop composition and may not appear below the 900px line. */
      if (match[1] === "4") expect(min).toBeGreaterThanOrEqual(900);
    }
  });

  it("puts no max-width query on the panel that could widen it on a phone", () => {
    for (const match of block.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\r?\n\}/g)) {
      expect(match[2], `a max-width: ${match[1]}px rule widens the hero panel`).not.toContain(
        "grid-template-columns: repeat",
      );
    }
  });

  it("lets every cell wrap rather than overflow at 360px", () => {
    /* A digest and a Korean label are the two strings that overflow a 360px column if they are
       allowed to be one unbreakable word. */
    expect(block).toMatch(/\.lv2-hero-stat-value\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(block).not.toMatch(/\.lv2-hero-stats[^{]*\{[^}]*(?:min-width|width):\s*\d{3,}px/);
  });

  /*
    THE ONE THING THIS RUNNER CANNOT MEASURE, PINNED WHERE IT CAN.

    Product QA found the hero pushing /ko 125px sideways at 360px while / was clean, and no test
    here could see it: there is no layout engine in vitest. The cause was a cascade collision that
    IS visible in the text. `app/one-path.css` gives every Korean text element
    `word-break: keep-all` and `overflow-wrap: break-word` at (0,1,1), which outranks the
    `.locator` class at (0,1,0) -- and `break-word`, unlike `anywhere`, contributes no soft-wrap
    opportunity to min-content sizing. So on /ko the 64-character digest kept a 511px min-content,
    that became the base size of the detail's grid track, and the panel overflowed a 282px column.

    `.detail .locator` at (0,2,0) is what wins it back. This asserts the rule is still there and
    still specific enough, which is the half a unit test can hold; the width itself is Product QA's.
  */
  it("keeps the locator breakable on a Korean page, where `anywhere` alone loses the cascade", () => {
    const module = source("components/evidence/region-highlight.module.css");
    const rule = module.match(/\.detail\s+\.locator\s*\{[^}]*\}/)?.[0];
    expect(rule, "the (0,2,0) locator rule is gone; /ko will overflow at 360px again").toBeTruthy();
    expect(rule).toMatch(/word-break:\s*break-all/);
    /* The site rule it has to outrank, still in the file it comes from. */
    expect(source("app/one-path.css")).toMatch(/:lang\(ko\)[^{]*\{[^}]*word-break:\s*keep-all/);
  });
});
