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
  docsSectionTitle,
  findCookbook,
  orderedSections,
  type CookbookSection,
} from "@/lib/cookbook-content";
import { loginUrlForRecipe } from "@/lib/recipe-intent";
import { sanitizeDocumentText } from "@/lib/sanitize-html";

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

function SectionBlock({ section }: { section: CookbookSection }) {
  const id = `cookbook-${section.key}`;
  return (
    <Fragment>
      <h2 id={id}>{SECTION_LABEL[section.key]}</h2>
      {section.status === "locked" ? (
        /*
          The whole of what a locked section renders. No placeholder figure, no sample answer and
          no greyed-out screenshot: the reader is told it has not been run and why, which is a
          fact, where an example would be a fabrication.
        */
        <p className="docs-note">This section has not been run. {sanitizeDocumentText(section.lockedReason)}</p>
      ) : (
        /*
          Keyed by position, not by the paragraph text: two identical sentences in one section are
          a duplicate key, and React's answer to a duplicate key is to render one of them. A
          repeated sentence is an editing mistake worth seeing on the page, not one worth hiding.
          The list is static content and never reorders, so position is the stable key here.
        */
        section.body
          .split("\n\n")
          .map((paragraph, index) => <p key={`${section.key}-${index}`}>{sanitizeDocumentText(paragraph)}</p>)
      )}
      {section.status === "ready" && section.docsSlug ? (
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

  return (
    <PublicPageShell>
      <BreadcrumbJsonLd trail={[{ name: record.title, path: `/cookbooks/${record.slug}` }]} />
      <section className="scene doc"><div className="shell"><div className="body">
        <div className="stack">
          <p className="slate"><b>COOKBOOK</b><span />DRAFT · NOT YET RUN</p>
          <h1 className="document-title">{record.title}</h1>
        </div>

        <div className="stack">
          <nav aria-label="Sections on this page">
            <ol className="docs-steps">
              {sections.map((section) => (
                <li key={section.key}>
                  <a href={`#cookbook-${section.key}`}>{SECTION_LABEL[section.key]}</a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="stack docs-body">
            {sections.map((section) => <SectionBlock key={section.key} section={section} />)}
          </div>

          {/* The record's own state, printed from its fields rather than written into the copy. */}
          <p className="fine">
            Publication {record.publication} · verified build {record.verifiedBuild ?? "none recorded"} ·
            {" "}verified on {record.lastVerifiedAt ?? "no run recorded"} · source rights {record.sourceRights} ·
            {" "}recipe {record.recipeId} at version {record.recipeVersion}
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
          <div className="actions">
            <Link className="btn" href={loginUrlForRecipe(record.recipeId) as Route}>Start this recipe</Link>
            <Link className="btn ghost" href="/explore">Open the read-only sample</Link>
            <Link className="btn ghost" href="/docs">Read the documentation</Link>
            <Link className="btn ghost" href="/contact">Talk to us about your corpus</Link>
          </div>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}
