import type { Metadata } from "next";
import OpeningFilm3 from "@/components/opening-film-3";

export const metadata: Metadata = {
  title: "Eighteen seconds — recompile the slice — TAVONEL",
  description: "A file changes. Only that slice recompiles. Related nodes grow edges.",
};

export default function FilmThreePage() {
  return (
    <div className="page film-page">
      <main id="main" tabIndex={-1}>
        <OpeningFilm3 />
      </main>
    </div>
  );
}
