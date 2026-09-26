import type { Metadata } from "next";
import Link from "next/link";
import { PublicSitePage } from "@/components/public-site-chrome";

/*
  BQ-112 / D11. The page is delisted until it has results, and it says so in one screen.

  It used to publish four measurement tracks, a four-rule publication contract and two calls to
  action for a comparison nothing on this site has run in public. A flagship route carrying a
  methodology and no result is a promise the reader cannot check, and it sat in the footer, the
  Resources menu and the sitemap as though it were finished.

  The methodology itself is not deleted -- it is `/benchmarks`, which is a real page with the
  same content and no implied leaderboard behind it. This route stays so an existing link does
  not 404, answers `noindex`, and is absent from `app/sitemap.ts` and `RESOURCE_LINKS`. It comes
  back, with the leaderboard, when there is one.
*/
export const metadata: Metadata = {
  title: "Arena — TAVONEL",
  description: "Document-reader comparison results are published on Benchmarks. A separate Arena leaderboard is not published here.",
  alternates: { canonical: "/arena" },
  // Still its own address when someone shares the link. `noindex` governs the crawl; it does not
  // make the page preview as the homepage.
  openGraph: { url: "/arena" },
  robots: { index: false, follow: true },
};

export default function ArenaPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <h1 className="document-title">Document-reader results are on Benchmarks.</h1>
              <p className="lede">
                The Model Arena document-reading board is already published on Benchmarks, with
                model versions, failures and price snapshots for that run. A separate Arena
                leaderboard is not published at this address.
              </p>
              <p>
                Read the measured board and its limits before using a result to compare readers.
              </p>
              <div className="actions">
                <Link className="btn" href="/benchmarks">Read the measured results</Link>
                <Link className="btn ghost" href="/research">Research notes</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
