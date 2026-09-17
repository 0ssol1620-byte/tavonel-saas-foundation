import type { Metadata } from "next";
import { notFound } from "next/navigation";

/*
  BQ-114. The 404 this route serves, with its own title.

  A `notFound()` page renders `app/not-found.tsx`, and that file's `metadata` export does not
  answer for a route segment that has a page of its own -- the segment does, and this one had
  none, so the document head came from the root layout. /customers served the homepage's title,
  description and share card with a 404 status: the tab read like the homepage, and a link to it
  unfurled as the homepage's pitch.

  The values match `app/not-found.tsx` deliberately. Two 404s on one site that disagree about
  what a 404 is called is the same defect in a smaller font. `canonical: null` removes the tag
  rather than pointing a dead address at a live one.
*/
export const metadata: Metadata = {
  title: "Not found — TAVONEL",
  description:
    "There is nothing at this address. The link may be out of date, or the page may never have existed — here is the way back into the site.",
  alternates: { canonical: null },
  robots: { index: false, follow: true },
  openGraph: {
    title: "Not found — TAVONEL",
    description: "There is nothing at this address.",
    type: "website",
  },
};

/** Intentionally unavailable. Kept only as a stable 404 for retired inbound URLs. */
export default function CustomersPage() {
  notFound();
}
