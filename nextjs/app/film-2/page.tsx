import type { Metadata } from "next";
import { notFound } from "next/navigation";
import OpeningFilm2 from "@/components/opening-film-2";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/film-2" },
  openGraph: { url: "/film-2" },
  title: "Eighteen seconds — compile the links — TAVONEL",
  description: "A node is chosen. Its markdown is read. Ontology and correlation compile. Related nodes grow edges.",
};

export default function FilmTwoPage() {
  notFound();
  return (
    <div className="page film-page">
      <main id="main" tabIndex={-1}>
        <OpeningFilm2 />
      </main>
    </div>
  );
}
