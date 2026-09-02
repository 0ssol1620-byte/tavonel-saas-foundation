import type { Metadata } from "next";
import OpeningFilm3 from "@/components/opening-film-3";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/film-3" },
  openGraph: { url: "/film-3" },
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
