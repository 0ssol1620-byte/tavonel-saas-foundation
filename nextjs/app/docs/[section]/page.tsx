import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { PublicPageShell } from "@/components/public-page-shell";
import { DocsCopyButton } from "@/components/docs-copy-button";
import { DocsSnippet } from "@/components/docs-snippet";
import {
  DOCS_REVIEWED,
  DOCS_SECTIONS,
  DOCS_VERSION,
  findDocsSection,
  type DocsBlock,
} from "@/lib/docs-content";
import { readDocsEndpoints, snippetFor, SNIPPET_LANGUAGES, type DocsEndpoint } from "@/lib/docs-endpoints";

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

function CodeBlock({ label, body }: { label: string; body: string }) {
  return (
    <figure className="docs-code">
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

function Endpoint({ endpoint }: { endpoint: DocsEndpoint }) {
  return (
    <article className="docs-endpoint">
      <header>
        <b data-method={endpoint.method}>{endpoint.method}</b>
        <code>{endpoint.path}</code>
        {endpoint.scope ? <em>{endpoint.scope}</em> : null}
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

function Block({ block, endpoints }: { block: DocsBlock; endpoints: Map<string, DocsEndpoint> }) {
  switch (block.kind) {
    case "prose":
      return <p>{withEmphasis(block.text)}</p>;
    case "note":
      return <p className="docs-note">{withEmphasis(block.text)}</p>;
    case "steps":
      return <ol className="docs-steps">{block.items.map((item) => <li key={item}>{item}</li>)}</ol>;
    case "code":
      return <CodeBlock label={block.label} body={block.body} />;
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
      return endpoint ? <Endpoint endpoint={endpoint} /> : null;
    }
  }
}

export default async function DocsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const entry = findDocsSection(section);
  if (!entry) notFound();

  const endpoints = await readDocsEndpoints();
  const index = DOCS_SECTIONS.findIndex((item) => item.slug === section);
  const previous = DOCS_SECTIONS[index - 1];
  const next = DOCS_SECTIONS[index + 1];

  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell"><div className="body">
        <div className="stack">
          <p className="slate">
            <b>DOCUMENTATION</b><span /><Link href="/docs">All sections</Link>
          </p>
          <h1 className="document-title">{entry.title}</h1>
        </div>

        <div className="stack docs-body">
          <p className="lede">{entry.summary}</p>
          {entry.blocks.map((block, position) => (
            <Block key={position} block={block} endpoints={endpoints} />
          ))}
        </div>

        <div className="stack">
          <nav className="docs-pager">
            {previous ? <Link href={`/docs/${previous.slug}` as Route}>← {previous.title}</Link> : <span />}
            {next ? <Link href={`/docs/${next.slug}` as Route}>{next.title} →</Link> : <span />}
          </nav>
          <p className="fine">
            API version {DOCS_VERSION} · reviewed {DOCS_REVIEWED} ·{" "}
            {/*
              Feedback goes to an address that exists and is read. A form posting to an endpoint
              nobody had built would look like feedback and be a hole in the floor.
            */}
            <a href={`mailto:support@tavonel.com?subject=${encodeURIComponent(`Docs feedback: ${entry.title}`)}`}>
              Something wrong on this page?
            </a>
          </p>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}
