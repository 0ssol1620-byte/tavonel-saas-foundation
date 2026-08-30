import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";
import OpeningFilm from "@/components/opening-film";

export const metadata: Metadata = {
  title: "Sixteen seconds — TAVONEL",
  description:
    "The whole argument, drawn rather than recorded: scattered files pulled into one world, a change travelling only as far as it actually reaches, and the one fact that was held back for a person.",
};

/**
 * The film, on its own, with nothing else on screen.
 *
 * The landing page makes this case across five scenes and a scroll, which is right for someone
 * who has already decided to spend a minute and useless for someone deciding whether to spend
 * ten seconds. This page is the version that can be opened, watched and sent.
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
          <Link href="/">Back to the compiler</Link>
        </nav>
      </header>

      <main id="main">
        <OpeningFilm />
      </main>
    </div>
  );
}
