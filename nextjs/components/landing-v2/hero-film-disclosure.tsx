"use client";

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
  return (
    <figure
      className={`lv2-film-story ${styles.film}`}
      data-testid="landing-hero-film"
    >
        <div className={`lv2-film ${styles.filmBody}`}>
          <CompileStagePlayer stages={stages} preferVideo priorityPoster korean={korean} initialMobileFilmView={LANDING_MOBILE_FILM_VIEW} />
        </div>
      <figcaption className="fine">{korean ? "예시 제품 흐름 영상 · 표시된 자료와 응답은 고객 결과가 아닙니다." : "Illustrative product walkthrough · displayed documents and answers are examples, not customer results."}</figcaption>
    </figure>
  );
}
