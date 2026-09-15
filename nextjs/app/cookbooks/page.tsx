import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicPageShell } from "@/components/public-page-shell";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { COOKBOOKS, WORKFLOW_LABEL, orderedSections } from "@/lib/cookbook-content";

/*
  BA-210. The six cookbooks had no index and no parent.

  `app/cookbooks/[slug]/page.tsx` argued the absence into place: every record is a draft, a draft
  is not linked from Resources as a representative case, and an index listing six drafts is that
  link with extra steps. The conclusion does not follow from the premise. What it produced was six
  pages reachable from nowhere -- not from the nav, not from the footer, not from Resources, and
  not from each other -- each emitting a one-node breadcrumb trail for a parent that returned 404.
  Honesty about publication state does not require unreachability.

  So: an index, and the same publication state the records already carry. It is `noindex` and it
  stays out of the sitemap and llms.txt, exactly as the six do, because a hub whose every entry is
  a draft is not a page to advertise -- it is the page that makes the six navigable for a reader
  who was sent one of them, and the parent their breadcrumb names.

  What it does not do is dress six drafts as six cases. There is no outcome number, no customer, no
  logo and no "featured" row; each card is the record's title, its workflow family, and the first
  sentence of its own What this is for section, read from the record rather than written here.
*/

export const metadata: Metadata = {
  title: "Cookbooks — TAVONEL",
  description:
    "Six task guides: compile a document set into reviewable work, trace a figure to its source, answer from your manuals, connect an external AI, hand over a signed package, apply a source revision.",
  alternates: { canonical: "/cookbooks" },
  openGraph: { url: "/cookbooks" },
  /*
    The index follows its entries. Every record is a draft, so the hub declares the same refusal
    the six declare -- one flag, in the same place, for the same reason. It flips when a record is
    approved, which is a founder act with a run behind it and the sitemap work that goes with it.
  */
  robots: { index: false, follow: true },
};

/** The first sentence of a record's outcome, which is what the card is for. */
function firstSentence(text: string): string {
  const end = text.indexOf(". ");
  return end === -1 ? text : text.slice(0, end + 1);
}

export default function CookbooksIndexPage() {
  return (
    <PublicPageShell>
      <BreadcrumbJsonLd trail={[{ name: "Cookbooks", path: "/cookbooks" }]} />
      <section className="scene doc"><div className="shell"><div className="body">
        <div className="stack">
          <p className="slate"><b>COOKBOOKS</b><span aria-hidden="true" />· SIX TASKS</p>
          <h1 className="document-title">One task, start to finish.</h1>
        </div>
        <div className="stack">
          <p className="lede">
            Each guide takes one piece of work through the product as it runs today: what it is
            for, what you need before you start, where the runnable code is, where it stops, and
            what to do next. Every guide is published ahead of a recorded run; the run-dependent
            sections appear when one exists.
          </p>
          <div className="tiles">
            {COOKBOOKS.map((record) => {
              const outcome = orderedSections(record).find((section) => section.key === "outcome");
              /*
                Fail closed rather than render a card with no description: `orderedSections`
                throws on a missing section, and a ready outcome is the one thing every record
                has -- but a card is a promise about a page, so it does not get built from a
                section that came back locked.
              */
              if (!outcome || outcome.status !== "ready") {
                throw new Error(`cookbook ${record.slug} has no outcome to put on its card`);
              }
              return (
                <article className="tile" key={record.slug}>
                  <p className="slate"><span aria-hidden="true" />{WORKFLOW_LABEL[record.workflowId]}</p>
                  <h2><Link href={`/cookbooks/${record.slug}` as Route}>{record.title}</Link></h2>
                  <p>{firstSentence(outcome.body)}</p>
                </article>
              );
            })}
          </div>
          <div className="actions">
            <Link className="btn ghost" href="/docs">Read the documentation</Link>
            <Link className="btn ghost" href="/explore">Open the read-only sample</Link>
          </div>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}
