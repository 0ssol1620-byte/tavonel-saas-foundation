import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { PublicPageShell } from "@/components/public-page-shell";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { DocsCopyButton } from "@/components/docs-copy-button";
import { DocsSnippet } from "@/components/docs-snippet";
import {
  DOCS_REVIEWED,
  DOCS_SECTIONS,
  DOCS_VERSION,
  findDocsSection,
  formatReviewDate,
  type DocsBlock,
} from "@/lib/docs-content";
import { readDocsEndpoints, snippetFor, SNIPPET_LANGUAGES, type DocsEndpoint } from "@/lib/docs-endpoints";
import { DocsToc } from "@/components/docs/docs-toc";
import { PageToc, tocEntries } from "@/components/docs/page-toc";
import layout from "@/components/docs/docs-toc.module.css";
import anchor from "@/components/docs/page-toc.module.css";

export function generateStaticParams() {
  return DOCS_SECTIONS.map((section) => ({ section: section.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  const entry = findDocsSection(section);
  if (!entry) return {};
  return {
    title: `${entry.title} — TAVONEL docs`,
    description: entry.summary,
    alternates: { canonical: `/docs/${section}` },
    openGraph: { url: `/docs/${section}` },
  };
}

/**
 * Emphasis only, and only the pair the source actually uses.
 *
 * The content is data rather than MDX on purpose -- a markdown pipeline would let a section
 * carry a heading level, a link or a script that nothing here checks. `**bold**` is the one
 * mark the prose needs, so it is the one mark that renders.
 */
function withEmphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>
  ));
}

function CodeBlock({ label, body, id }: { label: string; body: string; id?: string }) {
  return (
    <figure className={id ? `docs-code ${anchor.anchor}` : "docs-code"} id={id}>
      <figcaption>
        <span>{label}</span>
        <DocsCopyButton value={body} />
      </figcaption>
      <pre><code>{body}</code></pre>
    </figure>
  );
}

/* The names people call them, rather than the identifiers the generator uses. */
const LANGUAGE_LABELS = { curl: "cURL", python: "Python", typescript: "TypeScript" } as const;

function Endpoint({ endpoint, id }: { endpoint: DocsEndpoint; id?: string }) {
  return (
    <article className={id ? `docs-endpoint ${anchor.anchor}` : "docs-endpoint"} id={id}>
      <header>
        <b data-method={endpoint.method}>{endpoint.method}</b>
        <code>{endpoint.path}</code>
        {/*
          BA-216. The scope used to render as a bare em after the path -- `collections:read`
          with nothing saying what it was, which a reader either already knew or could not guess.
        */}
        {endpoint.scope ? <em>Scope <code>{endpoint.scope}</code></em> : null}
      </header>
      {endpoint.description ? <p>{endpoint.description}</p> : null}
      <DocsSnippet
        snippets={SNIPPET_LANGUAGES.map((language) => ({
          language,
          label: LANGUAGE_LABELS[language],
          body: snippetFor(endpoint, language),
        }))}
      />
      {endpoint.requestExample ? <CodeBlock label="Request body" body={endpoint.requestExample} /> : null}
      <table className="docs-table">
        <thead><tr><th>Status</th><th>Response</th></tr></thead>
        <tbody>
          {endpoint.responses.map((response) => (
            <tr key={response.status}><td><code>{response.status}</code></td><td>{response.description}</td></tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

/*
  The blocks a reader can jump to (BA-201).

  Headings, and only headings. This used to fall back to code captions and endpoint signatures,
  because those were the only labelled blocks the data had -- so "On this page" on the quickstart
  read "Steps 1 to 4 — bash / Steps 1 to 4 — Python / Steps 1 to 4 — TypeScript", six entries
  that named no concept at all. The section data carries real subheadings now
  (`{ kind: "heading" }`), and they are what the rail lists.

  Code blocks and endpoints keep no anchor of their own: each one sits under the heading that
  introduces it, which is the destination a reader wants anyway.
*/
function headingLabel(block: DocsBlock): string | null {
  return block.kind === "heading" ? block.text : null;
}

function Block({ block, endpoints, id }: { block: DocsBlock; endpoints: Map<string, DocsEndpoint>; id?: string }) {
  switch (block.kind) {
    case "heading":
      return <h2 id={id} className={anchor.anchor}>{block.text}</h2>;
    case "prose":
      return <p>{withEmphasis(block.text)}</p>;
    case "note":
      /*
        BA-217. The accent bar was doing two opposite jobs across the site -- real guidance here,
        and "this section has not been run" on every cookbook. The cookbook use is gone
        (BA-178); the label is what keeps this one legible without relying on the colour.
      */
      return <p className="docs-note"><strong>Note</strong> {withEmphasis(block.text)}</p>;
    case "steps":
      return <ol className="docs-steps">{block.items.map((item) => <li key={item}>{item}</li>)}</ol>;
    case "code":
      return <CodeBlock label={block.label} body={block.body} id={id} />;
    case "snippets":
      // One figure with a tab per language, the same control the endpoint blocks use.
      return <DocsSnippet snippets={block.items.map((item) => ({ ...item }))} />;
    case "table":
      return (
        <table className="docs-table">
          <thead><tr>{block.head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join("|")}>{row.map((cell, index) => <td key={index}>{withEmphasis(cell)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
    case "endpoint": {
      const endpoint = endpoints.get(block.operationId);
      /*
        A named operation that is not in the published contract renders nothing rather than a
        placeholder. `lib/docs-content.test.ts` fails on the same condition, so this branch is
        the runtime half of a check that is meant to be caught before deploy -- it exists so a
        stale name is an absent block, never an invented endpoint.
      */
      return endpoint ? <Endpoint endpoint={endpoint} id={id} /> : null;
    }
  }
}

export default async function DocsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const entry = findDocsSection(section);
  if (!entry) notFound();

  const endpoints = await readDocsEndpoints();
  /*
    Ids by position, so a block's anchor does not depend on how many unlabelled paragraphs sit
    above it. `tocEntries` owns the slug and the duplicate suffix; the map is only the join back
    to the block that carries the id.
  */
  const labelled = entry.blocks
    .map((block, position) => ({ position, label: headingLabel(block) }))
    .filter((item): item is { position: number; label: string } => item.label !== null);
  const toc = tocEntries(labelled.map((item) => item.label));
  const anchorIds = new Map(labelled.map((item, order) => [item.position, toc[order]!.id]));
  const index = DOCS_SECTIONS.findIndex((item) => item.slug === section);
  const previous = DOCS_SECTIONS[index - 1];
  const next = DOCS_SECTIONS[index + 1];

  return (
    <PublicPageShell>
      <BreadcrumbJsonLd trail={[{ name: "Documentation", path: "/docs" }, { name: entry.title, path: `/docs/${section}` }]} />
      <section className="scene doc"><div className="shell"><div className={layout.layout}>
        <DocsToc current={section} />
        <div className="body">
          <div className="stack">
            <p className="slate">
              <b>DOCUMENTATION</b><span /><Link href="/docs">All sections</Link>
            </p>
            <h1 className="document-title">{entry.title}</h1>
          </div>

          <div className="stack">
            <div className="stack docs-body">
              <p className="lede">{entry.summary}</p>
              <PageToc entries={toc} />
              {entry.blocks.map((block, position) => (
                <Block key={position} block={block} endpoints={endpoints} id={anchorIds.get(position)} />
              ))}
            </div>
            <nav className="docs-pager">
              {previous ? <Link href={`/docs/${previous.slug}` as Route}>← {previous.title}</Link> : <span />}
              {next ? <Link href={`/docs/${next.slug}` as Route}>{next.title} →</Link> : <span />}
            </nav>
            <p className="fine">
              API version {DOCS_VERSION} · reviewed {formatReviewDate(DOCS_REVIEWED)} ·{" "}
              {/*
                Feedback goes to an address that exists and is read. A form posting to an endpoint
                nobody had built would look like feedback and be a hole in the floor.

                BA-221: the label asked "Something wrong on this page?", which opens by assuming
                the page is wrong. It is the same mailto, phrased as an action.
              */}
              <a href={`mailto:support@tavonel.com?subject=${encodeURIComponent(`Docs feedback: ${entry.title}`)}`}>
                Report an issue with this page →
              </a>
            </p>
          </div>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}
