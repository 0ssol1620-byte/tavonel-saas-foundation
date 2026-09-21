/**
 * The two strings the hero's proof panel and its stat strip need, in both site languages.
 *
 * A separate file because every other landing string is owned by `lib/landing-v2-copy.ts` and
 * `lib/brand-copy.ts`, and a concurrent lane is rewriting those. Nothing here restates a claim
 * either of them makes: these are a caption naming what the reader is looking at and four labels
 * naming what four counts count. The counts themselves are in `lib/hero-stats.ts`, derived from
 * the compiled public World and never typed.
 *
 * Two rules the wording follows, both of them the project's:
 *
 *   - **No "accuracy", and no word that implies one.** The panel shows where a passage was read
 *     from. It does not grade the reading, and `hero-proof.test.ts` fails on the word.
 *   - **A count carries its denominator.** "Pages read" is two numbers, not one: how much of the
 *     corpus this World holds and how long the corpus is (§57).
 *
 * Korean is a literal translation of the English, with the spellings `lib/ko-terms.ts` fixes.
 */

export type HeroProofLocale = "en" | "ko";

export const HERO_PROOF_COPY: Readonly<
  Record<HeroProofLocale, {
    /** One sentence under the panel, saying what a reader is looking at. */
    caption: string;
    /** The strip's accessible name. Read aloud, never painted. */
    stripLabel: string;
    /** In the order `lib/hero-stats.ts` emits them. */
    stats: readonly [string, string, string, string];
  }>
> = {
  en: {
    caption:
      "A page of the public sample World, with the regions this compile read out of it. Move through them with Tab or a pointer; each one opens at its own id in Explore.",
    stripLabel: "What the public sample World holds",
    stats: [
      "public filings compiled",
      "pages read, of the pages filed",
      "evidence regions bound to a page",
      "World manifest digest",
    ],
  },
  ko: {
    caption:
      "공개 샘플 World의 한 페이지와, 이 컴파일이 그 페이지에서 읽어낸 근거 영역입니다. Tab 또는 포인터로 이동하며, 각 영역은 Explore에서 자기 id로 열립니다.",
    stripLabel: "공개 샘플 World가 담고 있는 것",
    stats: [
      "컴파일된 공개 공시 문서",
      "읽은 페이지 / 제출된 페이지",
      "페이지에 묶인 근거 영역",
      "World 매니페스트 다이제스트",
    ],
  },
} as const;
