import { EXPLORE_COPY } from "./explore-story";

/**
 * The words the Landing V2 hero needs that the campaign's copy deck does not carry.
 *
 * `lib/landing-v2-copy.ts` belongs to the copy lane and is closed to this one, so the strings the
 * hero introduces live here instead of being typed into a component. The rules that govern that
 * module govern this one, and `landing-v2-hero-copy.test.ts` enforces both: no figure is typed
 * into a sentence, and the Korean half is a literal translation of the English above it rather
 * than a second claim (D12).
 *
 * REWRITTEN 2026-09-20 FOR THE FOUNDER'S CENTERED HERO. The compiler-demo composition -- the
 * region strip, the page locator, the claim card, the entity chips, the arrivals and the
 * comparison counts -- is off the hero, and the five strings only it rendered went with it
 * (`filedFormat`, `readStripAlt`, `boundObjectsCaption`, `countsQualifier`). What the hero needs
 * now is one concise label that identifies the sequence as an illustration and states the
 * evidence the current product preserves.
 *
 * `entityDisclaimer` stays and moves with the objects it qualifies: /explore's own short caveat,
 * imported rather than respelled, printed as a footnote on Scene 02. Contract rule 7 keeps it on
 * the page once; the hero is simply no longer where it belongs.
 */

export type LandingV2HeroExtraCopy = {
  /** /explore's Entity caveat in one sentence, printed once on the page (Scene 02's footnote). */
  entityDisclaimer: string;
};

export const LANDING_V2_HERO_EXTRA: Record<"en" | "ko", LandingV2HeroExtraCopy> = {
  en: {
    entityDisclaimer: EXPLORE_COPY.entityCaveatShort,
  },
  ko: {
    /* The literal translation of `EXPLORE_COPY.entityCaveatShort`, with no figure in it. */
    entityDisclaimer: "이 샘플의 개체 이름은 휴리스틱입니다. 여기서 판단할 부분은 Claim과 페이지에 묶인 근거입니다.",
  },
};

/**
 * The Korean label and caption for each of the four locked cuts, in `COMPILE_STAGES` order.
 *
 * Only the two strings a reader sees are here. The `src`, `phoneSrc` and `poster` of every stage
 * stay in `lib/compile-stages.ts`, so a locale can never point at a different film -- which is
 * exactly the defect landing-01 opened, when /ko built its stage table by spreading the list out
 * of the "use client" player module and got client references instead of values for `src` and
 * `poster`.
 *
 * Stages 2 and 3 are the strings /ko already published for these two cuts (recovered from commit
 * `d4c8a48`). Stages 1 and 4 are literal translations of `COMPILE_STAGES[0]` and `[3]`, which /ko
 * never had a Korean spelling for: the previous landing played one cut rather than four.
 */
export const LANDING_V2_FILM_STAGES_KO: readonly { label: string; line: string }[] = [
  { label: "파일", line: "원본 페이지에서 추출된 내용과 연결된 지식까지." },
  { label: "정리", line: "관련 정보를 연결된 지식 구조로 정리합니다." },
  { label: "업데이트", line: "바뀐 원문과 그 영향을 받는 지식을 함께 보여줍니다." },
  { label: "AI에서 사용", line: "어시스턴트·편집기·터미널이 같은 지식과 같은 인용을 사용합니다." },
];

/** The hero's own copy, in the language the page is written in. */
export function landingV2HeroExtra(korean?: boolean): LandingV2HeroExtraCopy {
  return LANDING_V2_HERO_EXTRA[korean ? "ko" : "en"];
}
