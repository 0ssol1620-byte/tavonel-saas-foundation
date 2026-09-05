import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/developers" },
  openGraph: { url: "/developers" },
  title: "Developers — TAVONEL",
  description: "Compile knowledge once, then expose it through API, MCP, retrieval packages and signed exports.",
};

const SURFACE = [
  ["Compile", "Upload or connect sources and follow observed run events from input to Compiled World."],
  ["Read World", "Read a compiled world: ontology, graph, retrieval corpus, provenance, validation."],
  ["Ask", "Ask returns source-linked citations, or states that the available evidence is insufficient."],
  ["Export", "Take a signed, hash-verifiable package with a published trust key instead of a vendor-locked copy."],
  ["MCP", "Eight read-only tools over the same World an agent would otherwise be given a copy of."],
] as const;

export default function DevelopersPage() {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <Link href="/">Back to the compiler</Link>
          <a href="/api">API</a>
          <Link href="/docs">Docs</Link>
          <Link href="/evidence">Evidence</Link>
        </nav>
        <MobilePrimaryNav />
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>DEVELOPERS</b><span />ONE WORLD</p>
                <h1 className="document-title">Give every model the same grounded world.</h1>
              </div>
              <div className="stack">
                <p className="lede">
                  Compile knowledge once, then expose it through API, MCP, retrieval packages and signed exports.
                  The model is replaceable. The compiled knowledge is the asset.
                </p>
                <div className="tiles">
                  {SURFACE.map(([title, body]) => (
                    <article className="tile" key={title}>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </article>
                  ))}
                </div>
                <p className="fine">The endpoint reference, the error catalogue and the package format are in <Link href="/docs">the documentation</Link>, with a request in cURL, Python and TypeScript for each endpoint. Current availability is published at <Link href="/status">/status</Link>.</p>
                <div className="stack">
                  <p className="slate"><b>PUBLIC TOOLING</b><span />VERSIONED FILES</p>
                  <h3>Start with the contract, then a scoped key.</h3>
                  <pre><code>{`curl -H "Authorization: Bearer $TAVONEL_API_KEY" \\
  https://tavonel.com/api/v1/documents`}</code></pre>
                  <div className="tiles">
                    <article className="tile"><h3>OpenAPI</h3><p>Machine-readable v1 HTTP contract.</p><a href="/openapi.json">Open schema</a></article>
                    <article className="tile"><h3>CLI</h3><p>Node.js 20+ client with immutable version and update check.</p><a href="/developer/tavonel-cli.mjs" download>Download CLI</a></article>
                    <article className="tile"><h3>MCP</h3><p>Eight stdio tools: sources, World, search, Ask, objects, relations, evidence, package. No write tool, and it refuses to start if one is added.</p><a href="/developer/tavonel-mcp.mjs" download>Download MCP server</a></article>
                    <article className="tile"><h3>Source agent</h3><p>Local-first SMB, NFS, SFTP and S3-compatible connector agent.</p><a href="/developer/tavonel-source-agent.py" download>Download source agent</a></article>
                  </div>
                  <p className="fine">Verify versions and SHA-256 values against <a href="/developer/channel.json">the public distribution channel</a>. The <a href="/developer/README.md">setup and safety contract</a> documents scopes, secret handling and fail-closed behavior.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
