import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = {
  title: "API — TAVONEL Developers",
  description: "Use TAVONEL's versioned API to compile sources, read Worlds, ask with evidence, and download signed results.",
  alternates: { canonical: "/api" },
  openGraph: { url: "/api" },
};

const OPERATIONS = [
  ["Compile", "Create an immutable collection from qualified source documents."],
  ["Read World", "Read persisted objects, relations, evidence, versions, and package files."],
  ["Ask", "Ask the active World and receive page-and-bbox-bound citations or an abstention."],
  ["Download", "Retrieve the signed, hash-verifiable knowledge package."],
] as const;

export default function ApiPage() {
  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell"><div className="body">
        <div className="stack"><p className="slate"><b>DEVELOPERS</b><span />API</p><h1 className="document-title">Build on the same source-grounded World.</h1></div>
        <div className="stack">
          <p className="lede">The v1 API keeps compilation, evidence, Ask, and portable exports on one tenant-scoped contract.</p>
          <div className="tiles">{OPERATIONS.map(([title, body]) => <article className="tile" key={title}><h3>{title}</h3><p>{body}</p></article>)}</div>
          <pre><code>{`curl -H "Authorization: Bearer $TAVONEL_API_KEY" \\
  https://tavonel.com/api/v1/documents`}</code></pre>
          <div className="actions"><a className="btn" href="/openapi.json" download="tavonel-openapi.json">Download OpenAPI</a><Link className="btn ghost" href="/docs">Read the docs</Link></div>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}
