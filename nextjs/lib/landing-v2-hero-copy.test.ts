import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPILE_STAGES } from "./compile-stages";
import { EXPLORE_COPY } from "./explore-story";
import {
  LANDING_V2_FILM_STAGES_KO,
  LANDING_V2_HERO_EXTRA,
  landingV2HeroExtra,
} from "./landing-v2-hero-copy";
import { koTermDrift } from "./ko-terms";

/*
  The hero's own copy plays by the copy deck's rules, and this is what holds it to them.

  `lib/landing-v2-copy.ts` is guarded by `landing-v2-copy.test.ts`: no digit in any string, a
  Korean half that is a literal translation, and no forbidden phrasing. This module exists only
  because that one belongs to another lane, so it inherits every one of those rules rather than
  being a place to put a sentence that would not survive them.

  REWRITTEN 2026-09-20 with the founder's centered hero. Four of the five entries this guarded
  belonged to the compiler demo and went with it; what is left is the film label and /explore's
  Entity caveat, which moved to Scene 02 with the World it qualifies.
*/

const root = join(import.meta.dirname, "..");

describe("the Landing V2 hero copy", () => {
  it("offers both languages, and the same keys in each", () => {
    expect(Object.keys(LANDING_V2_HERO_EXTRA.en).sort()).toEqual(Object.keys(LANDING_V2_HERO_EXTRA.ko).sort());
    expect(landingV2HeroExtra()).toBe(LANDING_V2_HERO_EXTRA.en);
    expect(landingV2HeroExtra(false)).toBe(LANDING_V2_HERO_EXTRA.en);
    expect(landingV2HeroExtra(true)).toBe(LANDING_V2_HERO_EXTRA.ko);
    for (const locale of ["en", "ko"] as const) {
      for (const [key, value] of Object.entries(LANDING_V2_HERO_EXTRA[locale])) {
        expect(value.trim().length, `${locale}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  /*
    Contract rule 4, in its structural form: there is nowhere here to type a figure.

    The rule is absolute now rather than exempted by name, which is what it could not be while
    `countsQualifier` -- a receipt about a measurement -- lived in this module. Nothing left here
    is a measurement, so nothing left here may carry a digit.
  */
  it("types no figure into a sentence of its own", () => {
    for (const locale of ["en", "ko"] as const) {
      for (const [key, value] of Object.entries(LANDING_V2_HERO_EXTRA[locale])) {
        expect(/\d/.test(value), `${locale}.${key} states a figure: ${value}`).toBe(false);
      }
    }
    for (const [index, stage] of LANDING_V2_FILM_STAGES_KO.entries()) {
      expect(/\d/.test(stage.label), `ko stage ${index} label states a figure`).toBe(false);
      expect(/\d/.test(stage.line), `ko stage ${index} line states a figure`).toBe(false);
    }
  });

  it("imports the published disclosure rather than respelling it", () => {
    expect(LANDING_V2_HERO_EXTRA.en.entityDisclaimer).toBe(EXPLORE_COPY.entityCaveatShort);
    // And the module reads it rather than holding a copy of the English text.
    const source = readFileSync(join(root, "lib", "landing-v2-hero-copy.ts"), "utf8");
    expect(source).toContain("EXPLORE_COPY.entityCaveatShort");
  });

  /*
    THE SHORT CAVEAT IS SHORTER, NOT WEAKER, AND THE LONG ONE KEEPS ITS FIGURE.

    /explore's paragraph is where the measurement is published, and `corpus-and-entity-honesty`
    holds it to `entity-extraction-eval.json`; that pin is re-read here so the pair cannot drift
    while the landing quotes the short form. What the short form owes is the two facts that make
    an Entity label honest -- the labels are a heuristic, and the parts to judge are the Claims
    and their page-bound evidence -- in a sentence a scene footnote can hold.
  */
  it("states the caveat short without softening it", () => {
    const evaluation = JSON.parse(readFileSync(join(root, "lib", "entity-extraction-eval.json"), "utf8")) as {
      baseline: { truePositives: number; candidates: number };
    };
    const { truePositives, candidates } = evaluation.baseline;
    expect(EXPLORE_COPY.entityDisclaimer).toContain(`${truePositives} of ${candidates}`);
    const short = EXPLORE_COPY.entityCaveatShort;
    expect(short.split(/\s+/).length, "the caveat is one sentence, not a paragraph").toBeLessThanOrEqual(18);
    expect(short).toMatch(/heuristic/i);
    expect(short).toMatch(/claims/i);
    expect(short).toMatch(/evidence/i);
    for (const locale of ["en", "ko"] as const) {
      expect(LANDING_V2_HERO_EXTRA[locale].entityDisclaimer).toMatch(/Claim|휴리스틱|heuristic/i);
    }
  });

  it("is Korean on the Korean side, and keeps the site's vocabulary", () => {
    for (const [key, value] of Object.entries(LANDING_V2_HERO_EXTRA.ko)) {
      expect(/[가-힣]/.test(value), `ko.${key} is not Korean: ${value}`).toBe(true);
      expect(koTermDrift(value), `ko.${key} drifts from KO_TERMS`).toEqual([]);
    }
    for (const stage of LANDING_V2_FILM_STAGES_KO) {
      expect(/[가-힣]/.test(stage.label), `stage label ${stage.label} is not Korean`).toBe(true);
      expect(/[가-힣]/.test(stage.line), `stage line ${stage.line} is not Korean`).toBe(true);
      expect(koTermDrift(stage.line), `${stage.line} drifts from KO_TERMS`).toEqual([]);
    }
  });

  /*
    ONE KOREAN ROW PER LOCKED CUT, AND NOT ONE MORE.

    `components/landing-v2/hero-film.tsx` merges this table into `COMPILE_STAGES` by index, so a
    missing row would caption one of the four cuts in English on /ko and an extra row would be a
    caption with no film -- both of them silently. The two tables are joined by position, so
    position is what is checked. Only the two visible strings live here: `src` and `poster` stay
    in `lib/compile-stages.ts`, which is what stops a locale pointing at a different film
    (landing-01).
  */
  it("gives every locked cut a Korean label and caption, by position", () => {
    expect(LANDING_V2_FILM_STAGES_KO).toHaveLength(COMPILE_STAGES.length);
    for (const stage of LANDING_V2_FILM_STAGES_KO) {
      expect(Object.keys(stage).sort(), "a Korean row may carry copy and nothing else").toEqual(["label", "line"]);
      expect(stage.label.trim().length).toBeGreaterThan(0);
      expect(stage.line.trim().length).toBeGreaterThan(0);
    }
  });
});
