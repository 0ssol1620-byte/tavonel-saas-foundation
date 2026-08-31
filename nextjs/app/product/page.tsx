import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product" },
  openGraph: { url: "/product" },
  title: "Product — TAVONEL",
  description:
    "TAVONEL is a Knowledge Compiler. Documents, scans, code and connected systems go in. A Compiled World comes out.",
};

const SURFACES = [
  [
    "/product/knowledge-compiler",
    "CATEGORY",
    "Knowledge Compiler",
    "Read sources, reconstruct structure, resolve identities, map relationships, keep evidence attached, and compile the result.",
  ],
  [
    "/product/document-understanding",
    "READING",
    "Document understanding",
    "Recover text, layout and structure from documents and scans before anything is compiled.",
  ],
  [
    "/product/compiled-world",
    "OUTPUT",
    "Compiled World",
    "Structured knowledge with provenance and reusable retrieval artifacts — not a pile of searchable files.",
  ],
  [
    "/product/continuous-knowledge",
    "DIRECTION",
    "Continuous knowledge",
    "When a document changes, what else is now wrong? Selective recompilation is labelled Direction/Research, not a shipped claim.",
  ],
] as const;

export default function ProductPage() {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <Link href="/">Back to the compiler</Link>
          <Link href="/research">Research</Link>
          <Link href="/evidence">Evidence</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>PRODUCT</b><span />KNOWLEDGE COMPILER</p>
                <h2>Compile documents into a world an AI can reason about.</h2>
              </div>
              <div className="stack">
                <p className="lede">
                  TAVONEL is a Knowledge Compiler. Documents, scans, code and connected systems go in.
                  <b> A Compiled World comes out</b> &mdash; structured knowledge, evidence, graph and retrieval artifacts.
                </p>
                <div className="tiles">
                  {SURFACES.map(([href, state, title, body]) => (
                    <Link className="tile" href={href} key={href}>
                      <span className="n">{state}</span>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </Link>
                  ))}
                </div>
                <p className="fine">
                  This deployment is a private pilot. Measured claims live on <Link href="/evidence">/evidence</Link>.
                  Selective recompilation and automated ontology are labelled Direction/Research.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
