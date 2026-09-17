import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicPageShell } from "@/components/public-page-shell";
import { DocsSearch } from "@/components/docs-search";
import { PageToc, tocEntries } from "@/components/docs/page-toc";
import tocStyles from "@/components/docs/page-toc.module.css";
import { DOCS_GROUPS, DOCS_REVIEWED, DOCS_SECTIONS, DOCS_VERSION, docsSearchIndex, findDocsSection, formatReviewDate } from "@/lib/docs-content";

/*
  The two sections a reader almost always wants first (BA-218).

  Twenty-two index rows in one full-width column, every one of them the same box with the same
  13px title and the same one-line summary, meant Quickstart and Changelog had identical weight.
  These two are promoted above the groups -- they are also still in their own group below, because
  the index is the index -- and they are read from the section data rather than written again here,
  so a retitled section cannot disagree with its own feature card.
*/
const FEATURED = ["quickstart", "use-with-ai"] as const;

export const metadata: Metadata = {
  title: "Documentation — TAVONEL",
  description: "Quickstart, concepts, the API contract, error codes and limits for compiling sources into a traceable Compiled World.",
  alternates: { canonical: "/docs" },
  openGraph: { url: "/docs" },
};

/*
  A documentation hub, replacing a page about documentation.

  What was here was four steps and two buttons -- accurate, and not something a developer with
  a key could work from. Masterplan 13.6 lists the information architecture; this is that list,
  with every section reachable and every number on it imported from the code that enforces it.
*/
export default function DocsPage() {
  /*
    BQ-100. The title column carries the chapter list, which is what this surface has to put there.

    The decision splits the `.body` grid by surface type: a reference route puts navigation beside
    its heading, every other route collapses to one reading measure. The collapse is expressed in
    `app/product-polish.css` as the condition rather than as a list of routes -- a `.body` whose
    first column holds nothing but the H1 is one column -- so the whole of the fix here is putting
    the real navigation in that column. The rule lets go of the page the moment it does.
  */
  const groups = tocEntries(DOCS_GROUPS);

  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell"><div className="body">
        <div className="stack">
          <h1 className="document-title">From sources to a Compiled World.</h1>
          <PageToc entries={groups} />
        </div>
        <div className="stack">
          <p className="lede">
            Upload or connect sources, confirm the preflight boundary, follow the compile as it runs
            on our servers, then read the World and the evidence under every object.
          </p>
          <DocsSearch entries={docsSearchIndex()} />
          <div className="tiles">
            {FEATURED.map((slug) => {
              const section = findDocsSection(slug);
              // Fail closed rather than render an empty card: a renamed slug is a build failure.
              if (!section) throw new Error(`/docs features ${slug}, which is not a section`);
              return (
                <article className="tile" key={slug}>
                  <h2><Link href={`/docs/${section.slug}` as Route}>{section.title}</Link></h2>
                  <p>{section.summary}</p>
                </article>
              );
            })}
          </div>
          <div className="docs-groups">
            {groups.map(({ id, label: group }) => (
              <div className="stack" key={group}>
                <h2 className={tocStyles.anchor} id={id}>{group}</h2>
                <ul className="docs-index">
                  {DOCS_SECTIONS.filter((section) => section.group === group).map((section) => (
                    <li key={section.slug}>
                      <Link href={`/docs/${section.slug}` as Route}>
                        <strong>{section.title}</strong>
                        <span>{section.summary}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="fine">
            API version {DOCS_VERSION} · documentation reviewed {formatReviewDate(DOCS_REVIEWED)} ·{" "}
            <a href="/api/openapi">OpenAPI contract</a> ·{" "}
            {/*
              BQ-137. The file said its own name and nothing else.

              "llms.txt" in a row of meta is a filename with no reader: the people who know
              the convention do not need the link, and everybody else sees a broken-looking
              token beside a version number. The link says what is on the other end; the
              filename stays in it, because that is what somebody looking for the convention
              is scanning for.
            */}
            <a href="/llms.txt">Site index for AI agents (llms.txt)</a>
          </p>
          {/*
            §22: this page's next action is "run the first flow", not "open a page".

            "Open your workspace" is where the reader ends up anyway and says nothing about what
            to do once there. The quickstart is the flow this hub exists to start, and
            /developers answers the other question a reader arrives with — which of the three
            access paths they want, before they follow any of them.
          */}
          <div className="actions">
            <Link className="btn" href={"/docs/quickstart" as Route}>Run the quickstart</Link>
            {/*
              BA-199: "Choose an access path" read like the name of the destination, so
              /developers had three names across the site. This one describes what the page does.
              BA-184: the third action pointed at /api, a four-tile stub that this site linked to
              as its "API reference" while the reference itself is these twenty-two sections.
            */}
            <Link className="btn ghost" href={"/developers" as Route}>Compare access paths</Link>
          </div>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}
