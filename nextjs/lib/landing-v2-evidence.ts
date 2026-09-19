import { LANDING_V2_COPY, type LandingV2Locale } from "./landing-v2-copy";
import type { EvidenceRecord } from "./landing-v2-proof";

/**
 * The four strings Scene 04 needs that `lib/landing-v2-copy.ts` does not carry, and the two
 * labels it assembles out of a record.
 *
 * This file exists rather than an edit to the copy deck because Scene 04 is a lane and the copy
 * deck is another lane's file. Everything here is either a string that module has no entry for
 * or a substitution into a format string that module already owns -- nothing below is a second
 * spelling of a sentence the site already publishes.
 */

/*
  WHY THERE IS A SECOND REGION UNIT HERE.

  `LANDING_V2_COPY[locale].evidence.regionUnit` reads "bbox, per mille of the page", and it is
  correct where the hero uses it: the hero prints `region.coordinates`, which is the compiler's
  own `bbox1000` -- 30, 291, 971, 380.

  Scene 04 prints `record.region.normalizedLabel` instead, because §14 specifies the inspector's
  REGION row as `0.114, 0.282 → 0.781, 0.394` and `buildEvidenceRecord()` formats exactly that.
  Those are fractions of the page, not per mille, so printing them under the per-mille noun would
  state the wrong unit for the number beside it -- off by a factor of a thousand, on the one
  scene whose whole subject is that a coordinate means something. The unit here names the unit
  that is actually on the row. See the report's truth decisions: the copy deck should grow a
  second unit noun so both spellings live in one place.
*/
export const LANDING_V2_EVIDENCE_UI: Record<
  LandingV2Locale,
  { copied: string; copyFailed: string; normalizedUnit: string }
> = {
  en: {
    copied: "Copied",
    /*
      A clipboard write fails on an insecure origin, under a permission policy, or in a browser
      that does not recognise the gesture. "No silent fallback": the control says what a reader
      has to do instead rather than reporting a copy that did not happen -- the same rule
      `components/docs-copy-button.tsx` already follows.
    */
    copyFailed: "Select and copy",
    normalizedUnit: "bbox, as a fraction of the page",
  },
  ko: {
    copied: "복사됨",
    copyFailed: "직접 선택해 복사하세요",
    normalizedUnit: "bbox, 페이지 크기 대비 비율",
  },
};

/** Put a record's figures into a format string the copy deck owns. */
function fill(format: string, values: Record<string, string | number>): string {
  return format.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}

/**
 * The two assembled labels Scene 04 prints: which page of how many, and §4.1's region label.
 *
 * Both formats are the hero's (`pageOfFormat`, `regionLabelFormat`) rather than new strings, so
 * the landing has one spelling of "p.4 of 80" and one spelling of the signature label. The
 * coordinates substituted into the region label are the normalized ones this scene shows, so the
 * label and the REGION row cannot disagree about the box.
 */
export function evidenceLabels(
  locale: LandingV2Locale,
  record: EvidenceRecord,
): { pageOf: string; regionLabel: string } {
  const hero = LANDING_V2_COPY[locale].hero;
  return {
    pageOf: fill(hero.pageOfFormat, { page: record.source.page, pageCount: record.source.pageCount }),
    regionLabel: fill(hero.regionLabelFormat, {
      form: record.source.form,
      page: record.source.page,
      coordinates: record.region.normalizedLabel,
    }),
  };
}
