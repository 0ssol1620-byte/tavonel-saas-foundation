import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product/continuous-knowledge" },
  openGraph: { url: "/product/continuous-knowledge" },
  title: "Continuous knowledge — TAVONEL",
  description:
    "When a document changes, what else is now wrong? Selective recompilation is a research direction, not a shipped claim.",
};

const PARTS = [
  ["DIRECTION", "Selective recompilation", "Follow the dependencies a change actually reached, and rebuild those. Demonstrated on fixture data. Not offered as a shipped capability in this deployment."],
  ["DIRECTION", "Knowledge architecture", "Automatic ontology design tuned to a specific customer domain is a direction, not a shipped capability."],
  ["DESIGN", "Hold for review", "Two readings are possible. TAVONEL will not pick one. Ambiguity stays out of the live world until a person decides."],
  ["RESEARCH", "Status is a protocol", "Public results carry a badge: MEASURED, REPRODUCED, SUPPORTED, NOT SUPPORTED, BUILT NOT PROVEN, or IN PROGRESS."],
] as const;

export default function ContinuousKnowledgePage() {
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
          <Link href="/evidence">Evidence</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>DIRECTION</b><span />CONTINUOUS KNOWLEDGE</p>
                <h2>When a document changes, what else is now wrong?</h2>
              </div>
              <div className="stack">
                <p className="lede">
                  A revised source should not silently leave yesterday&apos;s answer in today&apos;s AI.
                  The compiler is designed to follow those dependencies, hold ambiguity, and rebuild only what the change reached.
                  <b> That behaviour is labelled Direction/Research.</b>
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
                  This question was moved off the homepage on purpose. It belongs here, labelled, until measurement closes.
                  Methodology lives on <Link href="/research">/research</Link>. The record lives on <Link href="/evidence">/evidence</Link>.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
