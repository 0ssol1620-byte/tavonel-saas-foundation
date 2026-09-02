import type { Metadata } from "next";
import { notFound } from "next/navigation";
import OpeningFilm4 from "@/components/opening-film-4";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/film-4" },
  openGraph: { url: "/film-4" },
  title: "Eighteen seconds — use the world — TAVONEL",
  description:
    "An assistant, an editor and a terminal reach the same compiled world, and every answer arrives with the page it came from.",
};

export default function FilmFourPage() {
  notFound();
  return (
    <div className="page film-page">
      <main id="main" tabIndex={-1}>
        <OpeningFilm4 />
      </main>
    </div>
  );
}
