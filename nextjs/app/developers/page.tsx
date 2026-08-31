import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/developers" },
  openGraph: { url: "/developers" },
  title: "Developers — TAVONEL",
  description: "Compile knowledge once, then expose it through API, MCP, retrieval packages and signed exports.",
};

const SURFACE = [
  ["Compile", "Point the compiler at sources. Quarantine, sanitization and processing receipts are part of the job, not optional."],
  ["GET World", "Read a compiled world: ontology, graph, retrieval corpus, provenance, validation."],
  ["Ask", "Query against the current world. Answers that cannot show evidence should not pretend to."],
  ["Export", "A signed directory of files, not a vendor lock. Public key at /api/export/trust."],
  ["MCP", "Read-only MCP surface for agents that should consume the same world."],
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
          <Link href="/api/openapi">OpenAPI</Link>
          <Link href="/evidence">Evidence</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>DEVELOPERS</b><span />ONE WORLD</p>
                <h2>Give every model the same grounded world.</h2>
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
                <p className="fine">
                  Live capability is fail-closed. See <Link href="/status">/status</Link>. Do not treat this page as a promise that every surface is open in this deployment.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
