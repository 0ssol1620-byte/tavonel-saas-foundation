"use client";

import { preload } from "react-dom";

import CompileStagePlayer, { FILM_POSTER_SIZES, filmPosterAvifSrcSet, filmPosterSrcSet, type MobileFilmView, type WideView } from "@/components/compile-stage-player";
import type { CompileStage } from "@/lib/compile-stages";
import styles from "./landing-hero.module.css";

/**
 * Founder ask 2026-10-27 ("랜딩페이지에 영상은 축소상태가 디폴트여야"), over FINAL-SPEC 2026-10-26 §2.1: Home opens the
 * film compact -- the whole frame -- at every width. "Focus details" (the same toggle, pressed) is the expand: one
 * readable 4:5 pane below 768px (STAGE_FRAMES[].phonePane), the pan surface to 899px, the 2x crop from 900px.
 */
export const LANDING_MOBILE_FILM_VIEW: MobileFilmView = "fit";
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
    Compact by default (2026-10-27): every width opens on the whole frame, so one srcset hint serves every width
    (a phone takes the 1440px file, a desktop the 2880px one); the phone pane's still loads only once Focus is pressed.
  */
  const openingAvifSrcSet = opening && filmPosterAvifSrcSet(opening);
  if (priority && opening?.posterAvif && openingAvifSrcSet) {
    preload(opening.posterAvif, { as: "image", type: "image/avif", fetchPriority: "high", imageSrcSet: openingAvifSrcSet, imageSizes: FILM_POSTER_SIZES });
  } else if (priority && opening?.poster) {
    preload(opening.poster, openingSrcSet
      ? { as: "image", fetchPriority: "high", imageSrcSet: openingSrcSet, imageSizes: FILM_POSTER_SIZES }
      : { as: "image", fetchPriority: "high" });
  }
  return (
    <figure
      className={`lv2-film-story ${styles.film}`}
      data-testid="landing-hero-film"
    >
        <div className={`lv2-film ${styles.filmBody}`}>
          <CompileStagePlayer stages={stages} preferVideo priorityPoster={priority} lazyPoster={!priority} korean={korean} initialMobileFilmView={LANDING_MOBILE_FILM_VIEW} initialWideView={LANDING_WIDE_FILM_VIEW} storyLayout />
        </div>
      <figcaption className="fine">{korean ? "제품 흐름 예시 · 고객 결과가 아닙니다." : "Illustrative demo · not customer results."}</figcaption>
    </figure>
  );
}
