import type { Metadata } from "next";
import Link from "next/link";
import CanvasTransitionLink from "@/components/canvas-transition-link";
import Logomark from "@/components/logomark";
import OpeningFilm3 from "@/components/opening-film-3";

export const metadata: Metadata = {
  title: "Eighteen seconds — recompile the slice — TAVONEL",
  description: "A file changes. Only that slice recompiles. The new edge reverse-traces to the source line.",
};

export default function FilmThreePage() {
  return (
    <div className="page film-page">
      <header className="nav film-nav">
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <CanvasTransitionLink href="/film">Cut 1</CanvasTransitionLink>
          <CanvasTransitionLink href="/film-2">Cut 2</CanvasTransitionLink>
          <CanvasTransitionLink href="/">Back to the compiler</CanvasTransitionLink>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <OpeningFilm3 />
      </main>
    </div>
  );
}
