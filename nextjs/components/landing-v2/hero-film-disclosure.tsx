"use client";

import { preload } from "react-dom";

import CompileStagePlayer, { type MobileFilmView } from "@/components/compile-stage-player";
import type { CompileStage } from "@/lib/compile-stages";
import styles from "./landing-hero.module.css";

/** The landing opens a phone on the whole frame; "Focus details" stays one tap away. */
export const LANDING_MOBILE_FILM_VIEW: MobileFilmView = "fit";

/** Visible hero media; the existing player owns visibility, reduced motion and playback. */
export default function HeroFilmDisclosure({
  korean,
  stages,
}: {
  korean: boolean;
  stages: CompileStage[];
}) {
  // Next supports resource hints in an SSR client component, before hydration.
  const openingPoster = stages[0]?.poster;
  if (openingPoster) preload(openingPoster, { as: "image", fetchPriority: "high" });
  return (
    <figure
      className={`lv2-film-story ${styles.film}`}
      data-testid="landing-hero-film"
    >
        <div className={`lv2-film ${styles.filmBody}`}>
          <CompileStagePlayer stages={stages} preferVideo priorityPoster korean={korean} initialMobileFilmView={LANDING_MOBILE_FILM_VIEW} />
        </div>
      <figcaption className="fine">{korean ? "제품 흐름 예시 · 실제 고객 결과가 아닙니다." : "Illustrative product demo · examples, not customer results."}</figcaption>
    </figure>
  );
}
