"use client";

import { preload } from "react-dom";

import CompileStagePlayer, { FILM_POSTER_SIZES, filmPosterSrcSet, type MobileFilmView } from "@/components/compile-stage-player";
import type { CompileStage } from "@/lib/compile-stages";
import styles from "./landing-hero.module.css";

/** The landing opens a phone on the whole frame; "Focus details" stays one tap away. */
export const LANDING_MOBILE_FILM_VIEW: MobileFilmView = "fit";

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
  if (priority && opening?.poster) {
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
          <CompileStagePlayer stages={stages} preferVideo priorityPoster={priority} lazyPoster={!priority} korean={korean} initialMobileFilmView={LANDING_MOBILE_FILM_VIEW} storyLayout />
        </div>
      <figcaption className="fine">{korean ? "제품 흐름 예시 · 실제 고객 결과가 아닙니다." : "Illustrative product demo · examples, not customer results."}</figcaption>
    </figure>
  );
}
