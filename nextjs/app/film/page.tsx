import type { Metadata } from "next";
import OpeningFilm from "@/components/opening-film";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/film" },
  openGraph: { url: "/film" },
  /*
    Shareable, not indexable.

    This page is the brand film on its own -- a link to hand to someone, and a thing to open in
    a sales call. Its content is the same eighteen seconds the landing page already carries, so
    letting a crawler index both offers the search engine two pages making one argument and
    invites it to rank the one with no product on it. It stays reachable by anyone holding the
    link, and follow stays on so the links out of it still count.
  */
  robots: { index: false, follow: true },
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
