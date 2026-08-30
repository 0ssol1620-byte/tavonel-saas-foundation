import type { Metadata } from "next";
import Link from "next/link";
import CanvasTransitionLink from "@/components/canvas-transition-link";
import Logomark from "@/components/logomark";
import OpeningFilm2 from "@/components/opening-film-2";

export const metadata: Metadata = {
  title: "Eighteen seconds — compile the links — TAVONEL",
  description: "A node is chosen. Its markdown is read. Ontology and correlation compile. Related nodes grow edges.",
};

export default function FilmTwoPage() {
  return (
    <div className="page film-page">
      <header className="nav film-nav">
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <CanvasTransitionLink href="/film">Cut 1</CanvasTransitionLink>
          <CanvasTransitionLink href="/">Back to the compiler</CanvasTransitionLink>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <OpeningFilm2 />
      </main>
    </div>
  );
}
