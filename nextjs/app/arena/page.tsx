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
  description: "The public model-comparison results are not published yet. The benchmark protocol is.",
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
              <h1 className="document-title">TAVONEL Arena is not published yet.</h1>
              <p className="lede">
                Arena is where processing paths will be compared on the same corpus, with model
                versions, failure accounting and price snapshots recorded per run. Nothing is
                published here until a run exists that a reader can reproduce.
              </p>
              <p>
                The protocol those runs will follow is published now, and so are the research
                notes behind it.
              </p>
              <div className="actions">
                <Link className="btn" href="/benchmarks">Read the benchmark protocol</Link>
                <Link className="btn ghost" href="/research">Research notes</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
