import { EXPLORE_COPY } from "./explore-story";

/**
 * The words the recomposed hero needs that the campaign's copy deck does not carry.
 *
 * `lib/landing-v2-copy.ts` belongs to the copy lane and is closed to this one, so the strings the
 * 2026-09-19 hero recomposition introduced live here instead of being typed into a component. The
 * rules that govern that module govern this one, and `landing-v2-hero-copy.test.ts` enforces
 * both: no figure is typed into a sentence (every digit reaches the page through
 * `lib/landing-v2-hero.ts`, inside an element marked `data-derived`), and the Korean half is a
 * literal translation of the English above it rather than a second claim (D12).
 *
 * One entry is not written here at all. `countsQualifier` is `EXPLORE_COPY`'s own sentence,
 * imported verbatim -- BA-034 requires the engine to be named wherever those comparison figures
 * are published, and a second spelling of that qualifier would be a second, weaker disclosure. It
 * carries a figure of its own, which is why the guard exempts it by name: it is a receipt about a
 * measurement, not a sentence this lane wrote.
 *
 * `entityDisclaimer` is /explore's too, and since F3 (2026-09-19) it is the SHORT form --
 * `EXPLORE_COPY.entityCaveatShort`, declared beside the long paragraph rather than derived from
 * it. The hero prints the caveat under two chips in a 245px column; the 45-word paragraph was the
 * tallest block in that column and read there as a footnote. It carries no figure, so unlike the
 * qualifier it is swept by the no-digit rule like everything else in this file.
 */

export type LandingV2HeroExtraCopy = {
  /** The filing line under the page thumbnail: the form, then the date it was filed. */
  filedFormat: string;
  /** Alt text for the READ strip. Carries no figure (contract rule 4). */
  readStripAlt: string;
  /** What the chips beside the claim are, stated as the sample's compiler emits them. */
  boundObjectsCaption: string;
  /** BA-034: the engine that produced the comparison figures, printed beside them. */
  countsQualifier: string;
  /** The Entity caveat in one sentence, printed under the chips and carried as their title. */
  entityDisclaimer: string;
};

export const LANDING_V2_HERO_EXTRA: Record<"en" | "ko", LandingV2HeroExtraCopy> = {
  en: {
    filedFormat: "{form} · filed {filingDate}",
    readStripAlt: "The region of the original filing page this Compiled World was read from.",
    /*
      C7: it read "objects bound to this region, ..." -- lowercase, with no count in front of the
      noun, so on screen it was a sentence with a word missing. It is a caption, not a fragment of
      one, so it is capitalised and stopped. No count is added: a figure here would need its own
      receipt and a `data-derived` wrapper to say something the list beside it already shows.
    */
    boundObjectsCaption: "Objects bound to this region, as this sample's compiler emits them.",
    countsQualifier: EXPLORE_COPY.countsQualifier,
    entityDisclaimer: EXPLORE_COPY.entityCaveatShort,
  },
  ko: {
    filedFormat: "{form} · {filingDate} 제출",
    readStripAlt: "이 Compiled World를 읽어 온 원본 공시 문서 페이지의 해당 영역입니다.",
    boundObjectsCaption: "이 영역에 묶인 객체들이며, 이 샘플의 컴파일러가 내보내는 그대로입니다.",
    countsQualifier: "이 저장소의 TypeScript 컬렉션 컴파일러가 내보내는 그대로입니다",
    /* F3: the literal translation of `EXPLORE_COPY.entityCaveatShort`, with no figure in it. */
    entityDisclaimer: "이 샘플의 개체 이름은 휴리스틱입니다. 여기서 판단할 부분은 Claim과 페이지에 묶인 근거입니다.",
  },
};

/** The hero's own copy, in the language the page is written in. */
export function landingV2HeroExtra(korean?: boolean): LandingV2HeroExtraCopy {
  return LANDING_V2_HERO_EXTRA[korean ? "ko" : "en"];
}
