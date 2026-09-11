import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { TrustNext } from "@/components/trust-next";

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
  /*
    These last two used to name two frozen technologies outright and then describe how each one
    works. Both sit on the disclosure registry's publication freeze, both were a mechanism
    description rather than a research area, and neither was tracked as a claim -- so this page
    was the deepest public description of two unfiled inventions, sitting where nobody was
    auditing it. `lib/prohibited-phrases.test.ts` keeps the old wording from coming back.

    They stay on the page, because they are genuinely two of the open problems and removing them
    would misrepresent what the work is. What changed is the depth: each now states the problem
    and the value of solving it, and says nothing about how. There is a second reason to write
    them this way. The one measurement that exists for either is not flattering, and the previous
    phrasing implied a capability the measurement does not support.
  */
  /*
    BA-087. Both of these ended on a disclaimer about our own position -- "an open question
    here, not a settled one", "a problem we work on rather than a property we assume". Naming an
    open problem on a research page is the point; apologising for not having solved it is a
    different act, and both phrasings were written to pre-empt an objection nobody had made.
    Each now states the problem and what solving it is worth, and stops there. Nothing about the
    depth changes: still no mechanism, still no capability implied.
  */
  [
    "Cost of staying current",
    "Sources keep arriving, and a world nobody can afford to update stops being worth having. What it costs to keep a compiled world faithful to changing sources is the question this work is aimed at.",
  ],
  [
    "Model independence",
    "The worth of a compiled world should not rest on which model produced it. Holding the product's guarantees stable while the models underneath change is what this work is for.",
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
              {/*
                B04 asked each of the five hubs to say which question it answers, and it was
                right to. BA-088 is about how it was done: the same 11px mono template sentence
                opened five consecutive pages, each followed by the same four cross-links in the
                same order, which reads as scaffolding the author left in and puts a navigation
                paragraph where the page's argument should start.

                So the role is part of the lede -- this page is about which problems are still
                open -- and the cross-links are one labelled row at the foot of the page.
              */}
              <p className="lede">
                Parsing a document is a solved-enough problem. Deciding what the document is
                about, which of its statements are the same statement as one in another document,
                what supports them, and what a change to page 40 invalidates three files away — is
                not. This page is <b>which problems are still open, and how we work on them</b>;
                the results themselves are on{" "}
                <Link href={"/research/notes" as Route}>Research notes</Link>.
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

              {/*
                BA-086. Three equal ghosts with no primary, immediately above a TrustNext that
                renders the page's only filled button: a reader saw three equivalent choices and
                then a fourth, more prominent one. TrustNext is this page's next step; the other
                two destinations belong in the closing cross-link row.
              */}

              {/*
                BA-088. The cross-links the deleted template sentence carried, as one labelled
                row at the foot.
              */}
              <p className="fine">
                <b>Also in the trust case:</b>{" "}
                <Link href={"/research/notes" as Route}>Research notes</Link> ·{" "}
                <Link href={"/evidence" as Route}>Evidence</Link> ·{" "}
                <Link href={"/benchmarks" as Route}>Benchmarks</Link> ·{" "}
                <Link href={"/reproducibility" as Route}>Reproducibility</Link> ·{" "}
                <Link href={"/trust" as Route}>Trust</Link>
              </p>
            </div>
            <TrustNext from="/research" />
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
