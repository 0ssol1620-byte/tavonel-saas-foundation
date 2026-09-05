import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/research" },
  openGraph: { url: "/research" },
  title: "Research — TAVONEL",
  description:
    "The open problems in compiling documents into evidence-bound, versioned knowledge, and how we work on them.",
};

/*
  Research leadership, rather than an internal claim-governance policy.

  The previous page's four cards were badges — MEASURED, BUILT NOT PROVEN, IN PROGRESS, NOT
  SUPPORTED — attached to research areas, plus a note that "Patent language does not belong in
  the hero", which is an editing rule for us that had been published to visitors. A researcher
  arriving here wants the problems and the approach; the per-result states are a property of
  results, and live with the results at /research/notes.
*/

const AREAS = [
  [
    "Document reading",
    "Recovering text, layout, tables and figures from scans and complex pages, and reporting uncertainty instead of filling it in. The read has to produce coordinates, because everything downstream binds to them.",
  ],
  [
    "Semantic identity",
    "Deciding when two mentions across a corpus are the same thing. Identity is the hard part of compilation: merge too eagerly and the world is wrong, merge too little and it is useless.",
  ],
  [
    "Knowledge construction",
    "Building objects, claims and relations that carry their supporting regions, and refusing to emit the ones that cannot.",
  ],
  [
    "Evidence coverage",
    "Measuring how much of a compiled world is actually supported by a source region, rather than assuming coverage from the absence of errors.",
  ],
  [
    "Temporal integrity",
    "Keeping worlds versioned as their sources change, so a past answer stays traceable to what the sources said at the time.",
  ],
  [
    "Selective recompilation",
    "Working out which parts of a world a source change actually invalidates, so a corpus update does not mean recompiling everything.",
  ],
  [
    "Multi-model verification",
    "Treating models as replaceable workers and checking their output against the source, so the world contract survives swapping any one of them.",
  ],
] as const;

const METHOD = [
  ["Freeze the configuration", "Model, revision, prompt, schema and price snapshot are pinned before a run, or the result is not comparable to anything."],
  ["Publish the denominator", "A rate without the population it was measured over is not a result. Every number carries what it was measured on."],
  ["Publish what failed", "A hypothesis that did not hold is a finding. It is recorded with the same weight as one that did."],
  ["Reproduce before comparing", "A competitor's published score is quoted as theirs, never restated as something we reproduced. Comparative claims wait for a same-condition run."],
] as const;

export default function ResearchPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>RESEARCH</b><span />KNOWLEDGE COMPILATION</p>
              <h1 className="document-title">The hard parts of turning<br />documents into knowledge.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                Parsing a document is a solved-enough problem. Deciding what the document is
                about, which of its statements are the same statement as one in another document,
                what supports them, and what a change to page 40 invalidates three files away — is
                not. These are the problems we work on.
              </p>

              <p className="slate"><span />RESEARCH AREAS</p>
              <div className="tiles">
                {AREAS.map(([title, body]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />HOW WE REPORT</p>
              <div className="chain">
                {METHOD.map(([title, body]) => (
                  <article className="link" key={title}>
                    <h2>{title}</h2>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <div className="actions">
                <Link className="btn" href={"/research/notes" as Route}>Notes and findings</Link>
                <Link className="btn ghost" href={"/benchmarks" as Route}>Benchmark protocol</Link>
                <Link className="btn ghost" href="/evidence">How evidence is bound</Link>
                <Link className="btn ghost" href={"/reproducibility" as Route}>Reproducibility</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
