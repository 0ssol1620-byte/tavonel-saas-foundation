import type { Metadata } from "next";
import OpeningFilm from "@/components/opening-film";

export const metadata: Metadata = {
  title: "Eighteen seconds — compile — TAVONEL",
  description: "Files go in. A world an AI can cite comes out.",
};

export default function FilmPage() {
  return (
    <div className="page film-page">
      <main id="main" tabIndex={-1}>
        <OpeningFilm />
      </main>
    </div>
  );
}
