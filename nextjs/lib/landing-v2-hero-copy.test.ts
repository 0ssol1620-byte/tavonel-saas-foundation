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

/** The two entries that are published receipts rather than sentences this lane wrote. */
const IMPORTED_DISCLOSURES: (keyof LandingV2HeroExtraCopy)[] = ["countsQualifier", "entityDisclaimer"];

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
    expect(LANDING_V2_HERO_EXTRA.en.entityDisclaimer).toBe(EXPLORE_COPY.entityDisclaimer);
    /*
      The Korean counterpart carries the SAME figures, re-derived from the same receipt.

      The English sentence is imported by reference and `lib/corpus-and-entity-honesty.test.ts`
      holds it to `entity-extraction-eval.json`. The Korean is a hand translation, so the figures
      in it are typed characters -- and the page's digit walk cannot see them, because they ride
      in a `title` attribute and `undeclaredText` strips attributes with the tags. Typing the pair
      into this test would only move the hand-copy one file along: the figure already moved once
      (3 of 15 -> 3 of 16, 2026-09-06, gap-matrix row D7-01), and the next re-derivation has to
      fail here rather than ship a Korean sentence stating a measurement nobody re-read.
    */
    const evaluation = JSON.parse(readFileSync(join(root, "lib", "entity-extraction-eval.json"), "utf8")) as {
      baseline: { truePositives: number; candidates: number };
    };
    const { truePositives, candidates } = evaluation.baseline;
    expect(EXPLORE_COPY.entityDisclaimer).toContain(`${truePositives} of ${candidates}`);
    // Korean counts the set first, then the hits: "기준 이름 N개 중 M개".
    expect(
      LANDING_V2_HERO_EXTRA.ko.entityDisclaimer,
      "the KO disclaimer states a pair the evaluation does not",
    ).toContain(`${candidates}개 중 ${truePositives}개`);
    // And the module reads them rather than holding a copy of the English text.
    const source = readFileSync(join(root, "lib", "landing-v2-hero-copy.ts"), "utf8");
    expect(source).toContain("EXPLORE_COPY.countsQualifier");
    expect(source).toContain("EXPLORE_COPY.entityDisclaimer");
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
      for (const slot of ["{form}", "{page}"]) {
        expect(LANDING_V2_HERO_EXTRA[locale].askCitationFormat, `${locale} citation drops ${slot}`).toContain(slot);
      }
    }
  });
});
