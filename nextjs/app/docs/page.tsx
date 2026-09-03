import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicPageShell } from "@/components/public-page-shell";
import { DocsSearch } from "@/components/docs-search";
import { DOCS_GROUPS, DOCS_REVIEWED, DOCS_SECTIONS, DOCS_VERSION, docsSearchIndex } from "@/lib/docs-content";

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
  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell"><div className="body">
        <div className="stack">
          <p className="slate"><b>DOCUMENTATION</b><span />API {DOCS_VERSION}</p>
          <h1 className="document-title">From sources to a Compiled World.</h1>
        </div>
        <div className="stack">
          <p className="lede">
            Upload or connect sources, confirm the preflight boundary, follow the compile as it runs
            on our servers, then read the World and the evidence under every object.
          </p>
          <DocsSearch entries={docsSearchIndex()} />
        </div>

        {DOCS_GROUPS.map((group) => (
          <div className="stack" key={group}>
            <p className="slate"><b>{group.toUpperCase()}</b></p>
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

        <div className="stack">
          <p className="fine">
            API version {DOCS_VERSION} · documentation reviewed {DOCS_REVIEWED} ·{" "}
            <a href="/api/openapi">machine-readable contract</a> ·{" "}
            <a href="/llms.txt">llms.txt</a>
          </p>
          <div className="actions">
            <Link className="btn" href="/login">Open your workspace</Link>
            <a className="btn ghost" href="/api">API reference</a>
          </div>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}
