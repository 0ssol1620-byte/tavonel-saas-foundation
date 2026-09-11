import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
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
      {/*
        BA-108. The feed link moved out of the lede and into the action row below, because
        subscribing is an action and this page had none: it ended at `<ChangelogList />` with
        nothing offered to a reader who had just read what changed.
      */}
      <p className="fine">
        Grouped as added, improved and fixed, with the surface each change touched. Breaking
        changes carry the migration beside them.
      </p>
    </div>
    <div className="stack"><ChangelogList /></div>
    <div className="stack">
      <div className="actions">
        <a className="btn" href="/changelog/feed.xml">Subscribe to the Atom feed</a>
        <Link className="btn ghost" href={"/docs/errors" as Route}>Read the API contract</Link>
      </div>
    </div>
  </div></div></section></PublicPageShell>;
}
