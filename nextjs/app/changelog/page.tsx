import type { Metadata } from "next";
import { ChangelogList } from "@/components/changelog-list";
import { PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = {
  title: "Changelog — TAVONEL",
  description: "What changed in TAVONEL, grouped as added, improved and fixed, with the surface it touched and any breaking change.",
  alternates: { canonical: "/changelog", types: { "application/atom+xml": "/changelog/feed.xml" } },
  openGraph: { url: "/changelog" },
};

/*
  Masterplan 13.3's complaint about this page was not its length. It was that both entries were
  written from the inside -- "changed the landing page to five scenes" is a record of what we
  did, and a changelog is a record of what someone else can now do, or must now change.

  What that asks for is structure: Added, Improved and Fixed, the surface an entry touched, a
  version where one was released, a permalink, a filter, a feed, and a breaking change called a
  breaking change with the migration beside it. All of that comes from `lib/changelog.ts`, so an
  entry cannot reach the page and miss the feed.
*/

export default function ChangelogPage() {
  return <PublicPageShell><section className="scene doc"><div className="shell"><div className="body">
    <div className="stack">
      <p className="slate"><b>CHANGELOG</b><span />PRODUCT</p>
      <h1 className="document-title">What changed, without the noise.</h1>
      <p className="fine">
        Grouped as added, improved and fixed, with the surface each change touched. Breaking
        changes carry the migration beside them. <a href="/changelog/feed.xml">Atom feed</a>.
      </p>
    </div>
    <ChangelogList />
  </div></div></section></PublicPageShell>;
}
