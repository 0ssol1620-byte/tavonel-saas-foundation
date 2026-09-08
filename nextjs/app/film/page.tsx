import type { Metadata } from "next";
import OpeningFilm from "@/components/opening-film";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/film" },
  openGraph: { url: "/film" },
  /*
    Not indexable, and not reachable in production.

    This comment used to call the page "a link to hand to someone, and a thing to open in a sales
    call" that "stays reachable by anyone holding the link". That was never true of the deployed
    site: `layout.tsx` beside this file calls `notFound()` whenever `VERCEL_ENV === "production"`,
    so on tavonel.com the link is a 404 -- confirmed by curl, which returns 404 with
    `X-Matched-Path: /film`. This route is a preview and review surface. Anyone wanting the film
    as a shareable link has to remove that guard first, and then decide what it competes with.

    The rest still holds, and is the reason the guard is not simply deleted: the content is the
    same eighteen seconds the landing page already carries, so letting a crawler index both
    offers the search engine two pages making one argument and invites it to rank the one with
    no product on it. `follow` stays on so the links out of it still count.
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
