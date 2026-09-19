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
 * Two entries are not written here at all. `countsQualifier` is `EXPLORE_COPY`'s own sentence,
 * imported verbatim -- BA-034 requires the engine to be named wherever those comparison figures
 * are published, and a second spelling of that qualifier would be a second, weaker disclosure.
 * `entityDisclaimer` is likewise /explore's, reused as the title of every heuristic Entity chip.
 * Both carry figures of their own, which is why the guard exempts them by name: they are receipts
 * about a measurement, not sentences this lane wrote.
 */

export type LandingV2HeroExtraCopy = {
  /** The filing line under the page thumbnail: the form, then the date it was filed. */
  filedFormat: string;
  /** Alt text for the READ strip. Carries no figure (contract rule 4). */
  readStripAlt: string;
  /** What the chips beside the claim are, stated as the sample's compiler emits them. */
  boundObjectsCaption: string;
  /** The Use beat's citation line. `{form}` and `{page}` come from the answer's own record. */
  askCitationFormat: string;
  /** BA-034: the engine that produced the comparison figures, printed beside them. */
  countsQualifier: string;
  /** The Entity caveat, carried on every heuristic chip as its title. */
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
    askCitationFormat: "↳ {form} · p.{page}",
    countsQualifier: EXPLORE_COPY.countsQualifier,
    entityDisclaimer: EXPLORE_COPY.entityDisclaimer,
  },
  ko: {
    filedFormat: "{form} · {filingDate} 제출",
    readStripAlt: "이 Compiled World를 읽어 온 원본 공시 문서 페이지의 해당 영역입니다.",
    boundObjectsCaption: "이 영역에 묶인 객체들이며, 이 샘플의 컴파일러가 내보내는 그대로입니다.",
    askCitationFormat: "↳ {form} · {page}쪽",
    countsQualifier: "이 저장소의 TypeScript 컬렉션 컴파일러가 내보내는 그대로입니다",
    entityDisclaimer:
      "이 고정 샘플의 개체 이름은 대문자 토큰 휴리스틱에서 나온 것이며, 해석기가 만든 것이 아닙니다. 기록된 평가에서 기준 이름 16개 중 3개가 참양성이었습니다. 검토되지 않은 개체는 샘플 구조로만 보여 줍니다. 여기서 판단할 부분은 Claim과 페이지에 묶인 근거입니다.",
  },
};

/** The hero's own copy, in the language the page is written in. */
export function landingV2HeroExtra(korean?: boolean): LandingV2HeroExtraCopy {
  return LANDING_V2_HERO_EXTRA[korean ? "ko" : "en"];
}
