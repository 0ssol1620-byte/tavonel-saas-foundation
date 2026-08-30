import type { Metadata } from "next";
import Link from "next/link";
import CanvasTransitionLink from "@/components/canvas-transition-link";
import Logomark from "@/components/logomark";
import OpeningFilm from "@/components/opening-film";

export const metadata: Metadata = {
  title: "Sixteen seconds — TAVONEL",
  description:
    "A staged compile: mess, read, resolve, world, evidence, a change that does not consume the graph. Drawn, not recorded.",
};

/**
 * The film, on its own, with nothing else on screen.
 *
 * The landing page makes this case across five scenes and a scroll, which is right for someone
 * who has already decided to spend a minute and useless for someone deciding whether to spend
 * ten seconds. This page is the version that can be opened, watched and sent.
 *
 * The cut is documents, not a particle field: mess → one page read → one world → a change
 * that does not consume the graph → one held fact. Pause and Skip are on screen because the
 * cut is longer than five seconds.
 *
 * It is not embedded above the front page and is not meant to be. A sequence that plays before
 * the content gates the content, and the first screen is where readers are already thinnest --
 * so the front page animates around its own text and this page is where the film gets the room
 * it needs. One link, from the footer.
 */
export default function FilmPage() {
  return (
    <div className="page film-page">
      <header className="nav film-nav">
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <CanvasTransitionLink href="/">Back to the compiler</CanvasTransitionLink>
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        <OpeningFilm />
      </main>
    </div>
  );
}
