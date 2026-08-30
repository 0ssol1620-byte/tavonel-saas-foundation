import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";

export const metadata: Metadata = {
  title: "Knowledge Compiler — TAVONEL",
  description:
    "TAVONEL compiles documents, scans, code and connected systems into a source-grounded Compiled World.",
};

const STEPS = [
  ["READ", "Documents and scans", "Recover text and layout from documents and scans."],
  ["RECONSTRUCT", "Structure", "Restore headings, tables, regions and competing versions."],
  ["RESOLVE", "Identity and versions", "Decide which copy is current. Merge identities that name the same thing."],
  ["MODEL", "Relationships", "Map entities, relations and areas, with evidence still attached."],
  ["VERIFY", "Evidence attached", "A fact that cannot point at source text does not belong in the world."],
  ["COMPILE", "Reusable artifacts", "Emit ontology, graph, retrieval corpus and provenance."],
] as const;

export default function KnowledgeCompilerPage() {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <Link href="/product">Product</Link>
          <Link href="/research">Research</Link>
          <Link href="/developers">Developers</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>PRODUCT</b><span />KNOWLEDGE COMPILER</p>
                <h2>A compiler for knowledge, not a search box over files.</h2>
              </div>
              <div className="stack">
                <p className="lede">
                  Files are source material. The compiler reads them, reconstructs structure, resolves identities,
                  maps relationships, keeps evidence attached, and compiles the result into a Compiled World.
                  <b> READ → RECONSTRUCT → RESOLVE → MODEL → VERIFY → COMPILE.</b>
                </p>
                <div className="tiles">
                  {STEPS.map(([state, title, body]) => (
                    <article className="tile" key={title}>
                      <span className="n">{state}</span>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </article>
                  ))}
                </div>
                <p className="fine">
                  The model is replaceable. The compiled knowledge is the asset.
                  Surfaces that consume a world are listed on <Link href="/developers">/developers</Link>.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
