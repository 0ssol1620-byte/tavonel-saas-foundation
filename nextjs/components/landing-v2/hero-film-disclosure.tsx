"use client";

import { preload } from "react-dom";
import { PHONE_HERO, PHONE_HERO_FILM_MEDIA, PHONE_HERO_STILL_MEDIA } from "@/lib/hero-phone-mode";

import CompileStagePlayer, { FILM_POSTER_SIZES, PHONE_PANE_MEDIA, filmPosterAvifSrcSet, filmPosterSrcSet, type MobileFilmView, type WideView } from "@/components/compile-stage-player";
import type { CompileStage } from "@/lib/compile-stages";
import styles from "./landing-hero.module.css";

/**
 * Founder ask 2026-10-27 ("랜딩페이지에 영상은 축소상태가 디폴트여야"), over FINAL-SPEC 2026-10-26 §2.1: Home opens the
 * film compact -- the whole frame -- on a desktop. "Focus details" (the same toggle, pressed) is the expand.
 *
 * Below 900px the film opens on Focus since the phone film returned (R3, 2026-11-09, D1): the whole 16:10 frame at
 * phone width draws product type at 3-4px, the reason the film was taken off phones on 2026-11-04, so a phone opens
 * on the readable 4:5 pane (STAGE_FRAMES[].phonePane, type >= 12 CSS px) and 768-899px on the pan surface. "Fit full
 * frame" (the toggle, released) is one press away.
 */
export const LANDING_MOBILE_FILM_VIEW: MobileFilmView = "focus";
export const LANDING_WIDE_FILM_VIEW: WideView = "fit";

/** Visible hero media; the existing player owns visibility, reduced motion and playback. */
export default function HeroFilmDisclosure({
  korean,
  stages,
  priority = true,
}: {
  korean: boolean;
  stages: CompileStage[];
  /** False while the specimen strip renders above the film (see hero-film.tsx). */
  priority?: boolean;
}) {
  // Next supports resource hints in an SSR client component, before hydration.
  // With a 1x copy the preload carries the same srcset and sizes as the <img>, so a phone fetches one file.
  const opening = stages[0];
  const openingSrcSet = opening && filmPosterSrcSet(opening);
  /*
    D-11: with an AVIF pair the hint names the AVIF srcset and its type, so a browser that cannot decode
    AVIF skips the hint and the <picture> falls back to WebP; there is still one image preload.
    No hint at all while the specimen strip renders above the film (priority false): the strip's first crop is the LCP element then.
    A phone opens on its pane (R3): below 768px the hint names stage 1's own pane still instead, so each width
    preloads exactly the one image its first screen paints.
  */
  const openingAvifSrcSet = opening && filmPosterAvifSrcSet(opening);
  // Round 2: while a phone shows the Inspector still, the poster's hint names the widths that draw the film.
  const pane = PHONE_HERO === "film" && LANDING_MOBILE_FILM_VIEW === "focus" ? opening?.phonePosterAvif : undefined;
  const media = PHONE_HERO === "still" ? { media: PHONE_HERO_FILM_MEDIA } : pane ? { media: "(min-width: 768px)" } : {};
  if (priority && pane) preload(pane, { as: "image", type: "image/avif", fetchPriority: "high", media: PHONE_PANE_MEDIA });
  if (priority && opening?.posterAvif && openingAvifSrcSet) {
    preload(opening.posterAvif, { as: "image", type: "image/avif", fetchPriority: "high", imageSrcSet: openingAvifSrcSet, imageSizes: FILM_POSTER_SIZES, ...media });
  } else if (priority && opening?.poster) {
    preload(opening.poster, openingSrcSet
      ? { as: "image", fetchPriority: "high", imageSrcSet: openingSrcSet, imageSizes: FILM_POSTER_SIZES, ...media }
      : { as: "image", fetchPriority: "high", ...media });
  }
  return (
    <figure
      className={`lv2-film-story ${styles.film}`}
      data-testid="landing-hero-film"
    >
        <div className={`lv2-film ${styles.filmBody}`}>
          <CompileStagePlayer stages={stages} preferVideo priorityPoster={priority} lazyPoster={!priority} posterSkipMedia={PHONE_HERO === "still" ? PHONE_HERO_STILL_MEDIA : undefined} korean={korean} initialMobileFilmView={LANDING_MOBILE_FILM_VIEW} initialWideView={LANDING_WIDE_FILM_VIEW} storyLayout />
        </div>
      <figcaption className="fine">{korean ? "제품 흐름 예시 · 고객 결과가 아닙니다." : "Illustrative demo · not customer results."}</figcaption>
    </figure>
  );
}
