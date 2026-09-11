import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { PublicPageShell } from "@/components/public-page-shell";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import {
  COOKBOOK_SLUGS,
  SECTION_LABEL,
  WORKFLOW_LABEL,
  docsSectionTitle,
  findCookbook,
  orderedSections,
  type CookbookSection,
} from "@/lib/cookbook-content";
import { loginUrlForRecipe } from "@/lib/recipe-intent";
import { sanitizeDocumentText } from "@/lib/sanitize-html";
import { PageToc, tocEntries } from "@/components/docs/page-toc";
import anchor from "@/components/docs/page-toc.module.css";

/*
  One route for the six cookbooks, arranged the way `/docs/[section]` arranges the documentation:
  the content is data in `lib/cookbook-content.ts` and this file only lays it out.

  Three decisions worth reading before editing this page.

  There is no `/cookbooks` index. Every record is a draft, a draft is not linked from Resources
  as a representative case, and an index page listing six drafts is that link with extra steps.
  The index arrives with the first approved record.

  There is no image, no video and no raw-HTML sink here except the breadcrumb graph the whole
  site emits. Only a real capture of a real run may illustrate one of these workflows and none
  has been run, so the screen section is locked rather than illustrated -- and structured data
  stays at the site-wide Organization/SoftwareApplication plus this page's breadcrumb. `Article`
  needs `datePublished`, every record's `lastVerifiedAt` is null, and a date invented to satisfy
  a schema is a fabricated fact with markup around it.

  Every body goes through `sanitizeDocumentText`. Today every body is authored copy and the call
  changes nothing; the moment a record carries an excerpt out of a customer document it is the
  difference between text and markup.
*/

export function generateStaticParams() {
  return COOKBOOK_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const record = findCookbook(slug);
  if (!record) return {};
  const outcome = orderedSections(record).find((section) => section.key === "outcome");
  return {
    title: `${record.title} — TAVONEL`,
    description: outcome?.body ?? record.title,
    alternates: { canonical: `/cookbooks/${slug}` },
    openGraph: { url: `/cookbooks/${slug}` },
    /*
      A draft asks not to be indexed, and that is the whole publication mechanism here: the
      sitemap's ROUTES array, robots.txt's private list and this flag are the three places the
      site already keeps in agreement, and a fourth "draft/approved" classification file would be
      a second answer to a question that already has one.
    */
    robots: record.publication === "draft" ? { index: false, follow: true } : undefined,
  };
}

/*
  The one closing block that replaced six "not run" sections (BA-178).

  It is last, it is positive, and it is stated once. Six headings whose whole body was a grey box
  saying the section had not been run made half of every page an apology, and put the first of them
  two screens above the first thing the product actually does. What a run adds is still published
  -- a reader deciding whether to wait for one needs exactly this list -- it is just not the page.
*/
const PENDING_HEADING = "What a recorded run will add";

function SectionBlock({ section, id }: { section: Extract<CookbookSection, { status: "ready" }>; id: string }) {
  return (
    <Fragment>
      {/*
        The id comes from the page's own `tocEntries` call, so the anchor and the jump link that
        names it are one derivation rather than two strings that have to agree. `anchor.anchor`
        is the `scroll-margin-top` that keeps the heading out from under the fixed header -- the
        reason the docs template puts the class on the element carrying the id and not on
        `:target`.
      */}
      <h2 id={id} className={anchor.anchor}>{SECTION_LABEL[section.key]}</h2>
      {/*
        Keyed by position, not by the paragraph text: two identical sentences in one section are
        a duplicate key, and React's answer to a duplicate key is to render one of them. A
        repeated sentence is an editing mistake worth seeing on the page, not one worth hiding.
        The list is static content and never reorders, so position is the stable key here.
      */}
      {section.body
        .split("\n\n")
        .map((paragraph, index) => <p key={`${section.key}-${index}`}>{sanitizeDocumentText(paragraph)}</p>)}
      {section.docsSlug ? (
        <p className="fine">
          The exact contract:{" "}
          <Link href={`/docs/${section.docsSlug}` as Route}>{docsSectionTitle(section.docsSlug) ?? section.docsSlug}</Link>
          {" "}in the documentation.
        </p>
      ) : null}
    </Fragment>
  );
}

export default async function CookbookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = findCookbook(slug);
  if (!record) notFound();

  const sections = orderedSections(record);
  /*
    The six sections that describe the product, and the six a run will fill in.

    `orderedSections` is still the single source of both the order and the twelve-section
    contract; this split is only about where each half renders. The ready six are the page; the
    locked six are one closing list under `PENDING_HEADING`.
  */
  const ready = sections.filter((section) => section.status === "ready");
  const pending = sections.filter((section) => section.status === "locked");
  /*
    One jump list, from the documentation template's own component rather than a second one
    written here. `tocEntries` owns the slug, the duplicate suffix and the empty-label fallback;
    the ids it returns are joined back by order -- the ready sections, then the closing block,
    which is exactly the order rendered below.
  */
  const toc = tocEntries([...ready.map((section) => SECTION_LABEL[section.key]), PENDING_HEADING]);

  return (
    <PublicPageShell>
      <BreadcrumbJsonLd trail={[{ name: record.title, path: `/cookbooks/${record.slug}` }]} />
      <section className="scene doc"><div className="shell"><div className="body">
        <div className="stack">
          <p className="slate"><b>COOKBOOK</b><span />{WORKFLOW_LABEL[record.workflowId]}</p>
          <h1 className="document-title">{record.title}</h1>
        </div>

        <div className="stack">
          <PageToc entries={toc} />

          <div className="stack docs-body">
            {ready.map((section, order) => (
              <SectionBlock key={section.key} section={section} id={toc[order]!.id} />
            ))}
            <h2 id={toc[ready.length]!.id} className={anchor.anchor}>{PENDING_HEADING}</h2>
            {/*
              Paragraphs with a bold lead-in rather than a list, so the six items inherit the
              measure, colour and line height `.docs-body p` already sets. A <ul> here would need
              its own rule in `app/tavonel.css`, which this lane does not own, and would render
              at the browser default until it got one.
            */}
            {pending.map((section) => (
              <p key={section.key}>
                <strong>{SECTION_LABEL[section.key]}</strong>{" — "}{sanitizeDocumentText(section.whenRun)}
              </p>
            ))}
          </div>

          {/*
            BA-180. What was here printed five record fields -- publication state, verified build,
            verified date, source-rights state and the raw recipe slug -- three of them reading
            "none recorded", "no run recorded" and "unverified". Those are the fields of an
            internal record and a reader cannot act on one of them. The guide's own revision is
            the single fact on that line a reader can use, so it is the one that stays; the
            record's state is still asserted in `cookbook-content.test.ts`, where it belongs.
          */}
          <p className="fine">
            This guide is published ahead of a recorded run; the run-dependent sections appear when
            one exists. Guide revision {record.recipeVersion}.
          </p>

          {/*
            The calls to action come after the prerequisites and the limits, which is the order
            the section list fixes. Every destination exists today, none of them asks for an
            email, and none implies a self-serve path to an activated World -- the plan that
            activation needs is named in the prerequisites above, and /contact is where that
            conversation starts.

            The primary control is the recipe carrier, built by `loginUrlForRecipe` rather than
            written out here: the parameter names, the version and the return path are one
            function in `lib/recipe-intent.ts`, and a URL typed into this file is a fourth copy
            of a contract that already has one. A reader who signs in from here comes back to
            this page, and the sign-in page's preflight is where the plan requirement and the
            maximum cost of a run are stated before anything is spent.

            The three routes the `next` section's prose names all stay, because the prose points
            at them; the recipe link is added in front of them, not in place of one.
          */}
          {/*
            Two, not four (BA-208). Four same-width buttons stacked at the foot of a 5,300px phone
            page is a choice with no wrong answer, which is no choice at all. The documentation and
            the read-only sample are both named, with links, in the Next action prose directly
            above -- they were never lost, only un-promoted out of the decision row.
          */}
          <div className="actions">
            <Link className="btn" href={loginUrlForRecipe(record.recipeId) as Route}>Start this recipe</Link>
            <Link className="btn ghost" href="/contact">Talk to us about your corpus</Link>
          </div>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}
