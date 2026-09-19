import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPLORE_COPY } from "./explore-story";
import { LANDING_V2_HERO_EXTRA, landingV2HeroExtra, type LandingV2HeroExtraCopy } from "./landing-v2-hero-copy";
import { koTermDrift } from "./ko-terms";

/*
  The hero's own copy plays by the copy deck's rules, and this is what holds it to them.

  `lib/landing-v2-copy.ts` is guarded by `landing-v2-copy.test.ts`: no digit in any string, a
  Korean half that is a literal translation, and no forbidden phrasing. This module exists only
  because that one belongs to another lane, so it inherits every one of those rules rather than
  being a place to put a sentence that would not survive them.
*/

const root = join(import.meta.dirname, "..");

/*
  The one entry that is a published receipt rather than a sentence this lane wrote.

  `entityDisclaimer` used to be here too, because /explore's paragraph carries its own measured
  figure. F3 (2026-09-19) points the hero at `EXPLORE_COPY.entityCaveatShort` instead -- the same
  caveat in one sentence, with the figure left on /explore beside its receipt -- so the hero's
  copy of it has no digit in it and is swept by the no-figure rule like everything else here.
*/
const IMPORTED_DISCLOSURES: (keyof LandingV2HeroExtraCopy)[] = ["countsQualifier"];

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

    Every digit the hero prints is read from the compiled World by `lib/landing-v2-hero.ts` and
    rendered inside an element marked `data-derived="1"`, which is what `e2e/landing-v2.spec.ts`
    walks. The two disclosures are exempt by name and not by pattern: they carry a measured
    figure about the measurement itself, they are imported or translated verbatim from
    `EXPLORE_COPY`, and softening one on the way across would be the thing the exemption is
    watched for.
  */
  it("types no figure into a sentence of its own", () => {
    for (const locale of ["en", "ko"] as const) {
      for (const [key, value] of Object.entries(LANDING_V2_HERO_EXTRA[locale])) {
        if (IMPORTED_DISCLOSURES.includes(key as keyof LandingV2HeroExtraCopy)) continue;
        expect(/\d/.test(value), `${locale}.${key} states a figure: ${value}`).toBe(false);
      }
    }
  });

  it("imports the published disclosures rather than respelling them", () => {
    expect(LANDING_V2_HERO_EXTRA.en.countsQualifier).toBe(EXPLORE_COPY.countsQualifier);
    expect(LANDING_V2_HERO_EXTRA.en.entityDisclaimer).toBe(EXPLORE_COPY.entityCaveatShort);
    // And the module reads them rather than holding a copy of the English text.
    const source = readFileSync(join(root, "lib", "landing-v2-hero-copy.ts"), "utf8");
    expect(source).toContain("EXPLORE_COPY.countsQualifier");
    expect(source).toContain("EXPLORE_COPY.entityCaveatShort");
  });

  /*
    F3: THE SHORT CAVEAT IS SHORTER, NOT WEAKER, AND THE LONG ONE KEEPS ITS FIGURE.

    /explore's paragraph is where the measurement is published, and `corpus-and-entity-honesty`
    holds it to `entity-extraction-eval.json`; that pin is re-read here so the pair cannot drift
    while the hero quotes the short form. What the short form owes is the two facts that make an
    Entity chip honest -- the labels are a heuristic, and the parts to judge are the Claims and
    their page-bound evidence -- in a sentence a 245px column can hold. 18 words is the bound the
    campaign lead set; the Korean is the literal translation of it and states no figure either.
  */
  it("states the caveat short without softening it", () => {
    const evaluation = JSON.parse(readFileSync(join(root, "lib", "entity-extraction-eval.json"), "utf8")) as {
      baseline: { truePositives: number; candidates: number };
    };
    const { truePositives, candidates } = evaluation.baseline;
    expect(EXPLORE_COPY.entityDisclaimer).toContain(`${truePositives} of ${candidates}`);
    const short = EXPLORE_COPY.entityCaveatShort;
    expect(short.split(/\s+/).length, "the hero caveat is one sentence, not a paragraph").toBeLessThanOrEqual(18);
    expect(short).toMatch(/heuristic/i);
    expect(short).toMatch(/claims/i);
    expect(short).toMatch(/evidence/i);
    for (const locale of ["en", "ko"] as const) {
      expect(/\d/.test(LANDING_V2_HERO_EXTRA[locale].entityDisclaimer), `${locale} caveat states a figure`).toBe(false);
      expect(LANDING_V2_HERO_EXTRA[locale].entityDisclaimer).toMatch(/Claim|휴리스틱|heuristic/i);
    }
  });

  it("is Korean on the Korean side, and keeps the site's vocabulary", () => {
    for (const [key, value] of Object.entries(LANDING_V2_HERO_EXTRA.ko)) {
      expect(/[가-힣]/.test(value), `ko.${key} is not Korean: ${value}`).toBe(true);
      expect(koTermDrift(value), `ko.${key} drifts from KO_TERMS`).toEqual([]);
    }
  });

  /*
    The two format strings keep their slots.

    A format that stopped naming `{form}` would render a citation with a hole in it, and a data
    module that went back to assembling the sentence itself would put English on the Korean page
    -- which is the defect these formats exist to have fixed.
  */
  it("keeps every slot the component fills", () => {
    for (const locale of ["en", "ko"] as const) {
      for (const slot of ["{form}", "{filingDate}"]) {
        expect(LANDING_V2_HERO_EXTRA[locale].filedFormat, `${locale} filed line drops ${slot}`).toContain(slot);
      }
      /* `askCitationFormat` left with the Use beat's answer panel (F2): the hero has no
         citation line of its own any more, and a format nothing fills is a string to keep in
         step for nothing. */
    }
  });
});
