import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product/compiled-world" },
  openGraph: { url: "/product/compiled-world" },
  title: "Compiled World — TAVONEL",
  description:
    "The output of a TAVONEL compile: structured knowledge with provenance and reusable retrieval artifacts.",
};

const PARTS = [
  ["STRUCTURE", "What fits together", "What the things are, what area they belong to, what supports them and what they affect."],
  ["PROVENANCE", "Where a fact came from", "Each fact points at source text, version and location. An answer that cannot show evidence should not pretend to."],
  ["ARTIFACTS", "What a compile emits", "Ontology, graph, retrieval corpus, provenance and validation packages — a directory of files, not a dump."],
  ["EXPORT", "What you can take", "A signed package, hash-verified on the way out. The public key is published at /api/export/trust."],
  ["DIRECTION", "Automated ontology", "Automatic ontology design tuned to a specific customer domain is a direction, not a shipped capability."],
] as const;

export default function CompiledWorldPage() {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <Link href="/product">Product</Link>
          <Link href="/developers">Developers</Link>
          <Link href="/evidence">Evidence</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>PRODUCT</b><span />COMPILED WORLD</p>
                <h2>Not searchable files. A world an AI can reason about.</h2>
              </div>
              <div className="stack">
                <p className="lede">
                  The output of a compile is a Compiled World: entities, relations, areas, provenance and retrieval artifacts.
                  <b> One world, used by retrieval, agents, MCP, APIs and applications.</b>
                </p>
                <div className="tiles">
                  {PARTS.map(([state, title, body]) => (
                    <article className="tile" key={title}>
                      <span className="n">{state}</span>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </article>
                  ))}
                </div>
                <p className="fine">
                  Knowledge architecture is labelled Direction in this deployment.
                  Live capability is fail-closed; see <Link href="/status">/status</Link>.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
