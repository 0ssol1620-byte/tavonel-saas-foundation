import { EXPLORE_COPY } from "./explore-story";

/*
  Scene 05's wiring: the two link labels and the engine qualifier.

  It is a separate module rather than three more fields on `LandingV2RecompileCopy` because that
  deck belongs to the copy lane and this scene needed three strings it does not carry. The rules
  it inherits are the deck's: no digit anywhere in this file (contract rule 4 -- every figure on
  the entry pages is read out of the compiled World at build time), Korean is a literal
  translation, and no destination is invented -- both hrefs come from `buildRecompileView()`.
*/

/**
 * The scene's one next action, and the compiler contract as secondary text.
 *
 * The change action is deliberately NOT a second spelling of `EXPLORE_CTA`: it opens one act of
 * the public World, the way `SCENE_ACTIONS.evidence` already opens the evidence act, and it says
 * which record it opens rather than repeating the site's single Explore action (contract rule 6).
 */
export const RECOMPILE_ACTIONS = {
  en: { change: "Open the change record", contract: "Read the compiler contract" },
  ko: { change: "변경 기록 열기", contract: "컴파일러 계약 읽기" },
} as const;

/**
 * BA-034: the engine qualifier travels with the counts, at every point that publishes them.
 *
 * English is `EXPLORE_COPY.countsQualifier` by reference, not a copy of it -- /explore and the
 * product pages already print that exact sentence beside the same figures, and a second spelling
 * of it here would be a second claim about which compiler produced them. Korean is its literal
 * translation, which is why it is a pair rather than one string.
 */
export const RECOMPILE_COUNTS_QUALIFIER = {
  en: EXPLORE_COPY.countsQualifier,
  ko: "이 저장소의 TypeScript 컬렉션 컴파일러가 내보내는 그대로입니다",
} as const;

/*
  The Korean state words moved out of this file on 2026-09-19 (QA round 4).

  They were keyed by the English word and only Scene 05 read them, so the hero and the evidence
  inspector went on printing the English word on /ko. `LANDING_V2_STATE_WORD_KO` and
  `landingV2StateWord()` in `lib/landing-v2-proof.ts` are keyed by `VisualState`, beside the
  English table, and all three call sites read them.
*/
