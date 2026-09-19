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
 * now is one sentence, and it is the one sentence the four locked films may not be shown without.
 *
 * `entityDisclaimer` stays and moves with the objects it qualifies: /explore's own short caveat,
 * imported rather than respelled, printed as a footnote on Scene 02. Contract rule 7 keeps it on
 * the page once; the hero is simply no longer where it belongs.
 */

export type LandingV2HeroExtraCopy = {
  /**
   * §11.3 / contract rule 7, under the hero film.
   *
   * The four cuts draw a ruled table, section-and-line labels and `.csv` sources, and this
   * deployment emits none of the three: it emits the paragraph as it was printed, the page it was
   * read from and the box it sat in. This is the previous landing's own sentence, kept as it was
   * published except for its closing clause, which pointed at three /explore frames the page no
   * longer carries. A film that runs ahead of the deployment is allowed on the page only with it.
   */
  filmNote: string;
  /** /explore's Entity caveat in one sentence, printed once on the page (Scene 02's footnote). */
  entityDisclaimer: string;
};

export const LANDING_V2_HERO_EXTRA: Record<"en" | "ko", LandingV2HeroExtraCopy> = {
  en: {
    filmNote:
      "A directed film, not a screen recording: the ruled table, the section-and-line labels and the .csv sources in it run ahead of this deployment. What a compile emits today is the paragraph as it was printed, the page it was read from and the box it sat in.",
    entityDisclaimer: EXPLORE_COPY.entityCaveatShort,
  },
  ko: {
    filmNote:
      "제품 흐름을 설명하는 연출 영상이며 실제 화면 녹화가 아닙니다. 영상 속 격자로 그린 표, 절·행 번호 위치, .csv 원문은 현재 배포보다 앞서 있습니다. 지금 컴파일이 내보내는 것은 인쇄된 그대로의 문단과 그것을 읽어 온 페이지·영역입니다.",
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
