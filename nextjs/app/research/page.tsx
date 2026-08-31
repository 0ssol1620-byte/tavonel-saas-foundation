import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/research" },
  openGraph: { url: "/research" },
  title: "Research — TAVONEL",
  description: "We test the compiler against the messy parts. Measured results, failed hypotheses, and methodology.",
};

const PILLARS = [
  ["MEASURED", "Document reading", "GPU OCR path, layout recovery and scan quality on declared corpora. Failures stay in the record."],
  ["BUILT, NOT PROVEN", "Knowledge construction", "Entity identity, relation extraction and provenance packages exist as artifacts. External correctness benchmarks are not closed."],
  ["IN PROGRESS", "Knowledge maintenance", "Selective recompilation is a research direction, demonstrated on fixture data, not a shipped claim."],
  ["NOT SUPPORTED", "Retrieval comparisons", "External baseline comparisons stay unpublished until a frozen run is reproduced."],
] as const;

export default function ResearchPage() {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <Link href="/">Back to the compiler</Link>
          <Link href="/evidence">Evidence</Link>
          <Link href="/developers">Developers</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>RESEARCH</b><span />KNOWLEDGE COMPILER</p>
                <h2>We test the compiler against the messy parts.</h2>
              </div>
              <div className="stack">
                <p className="lede">
                  Status is a protocol, not a mood. Every public result carries a badge:
                  MEASURED, REPRODUCED, SUPPORTED, NOT SUPPORTED, BUILT NOT PROVEN, or IN PROGRESS.
                </p>
                <div className="tiles">
                  {PILLARS.map(([state, title, body]) => (
                    <article className="tile" key={title}>
                      <span className="n">{state}</span>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </article>
                  ))}
                </div>
                <p className="fine">
                  Machine-readable receipts and failed hypotheses live on <Link href="/evidence">/evidence</Link>.
                  The public claim inventory is <code>docs/CLAIM_LEDGER_v1.md</code> in the product repository.
                  Patent language does not belong in the hero.
                </p>
                <p className="lede">
                  We do not publish competitor comparison tables first. Order: reproduce a baseline,
                  freeze the environment, publish config and metrics, publish failures, then review.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
