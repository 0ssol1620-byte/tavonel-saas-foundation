import type { Metadata } from "next";
import Link from "next/link";
import { PublicSitePage } from "@/components/public-site-chrome";

export const metadata: Metadata = {
  title: "TAVONEL Arena — Document AI & Information Retention Benchmarks",
  description:
    "TAVONEL Arena publishes reproducible document-AI research across parsing, information retention, routing, cost, latency and downstream AI quality, with versions and failures attached.",
  alternates: { canonical: "/arena" },
  openGraph: {
    title: "TAVONEL Arena — Document AI & Information Retention Benchmarks",
    description: "Measured document intelligence research with versions, failures, cost, latency and reproducibility attached.",
    url: "/arena",
    type: "website",
  },
  robots: { index: true, follow: true },
};

const TRACKS = [
  [
    "Document parsing",
    "Measure text, tables, formulas, reading order, charts and difficult layouts without treating one score as the whole document.",
  ],
  [
    "Information retention",
    "Track what survives the transformation: content, structure, visuals, captions, source positions and cross-page continuity.",
  ],
  [
    "Adaptive routing",
    "Compare fixed processors with a selective route that can accept, escalate, recover or abstain. A router result is withheld until the same corpus and frozen policy are evaluated.",
  ],
  [
    "Downstream AI",
    "Hold the retriever, model and questions fixed, then test whether better-preserved input changes answer correctness, completeness and citation quality.",
  ],
] as const;

const PUBLICATION_RULES = [
  ["Pin the run", "Model id, revision, corpus digest, prompt or processing policy, hardware and evaluator revision are recorded before comparison."],
  ["Count every case", "Failures, timeouts and skipped pages stay in the denominator. Success-only averages are labelled separately when they are useful."],
  ["Publish the trade-off", "Quality is shown beside latency, cost and failure rate rather than collapsed into a marketing winner."],
  ["Separate research from product claims", "An Arena result does not become a production claim until the relevant holdout, shadow or canary gate has passed."],
] as const;

export default function ArenaPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>TAVONEL ARENA</b><span />TESTED, NOT GUESSED</p>
              <h1 className="document-title">Which processing path<br />preserves what your AI needs?</h1>
              <p className="lede">
                No single parser wins every kind of document. TAVONEL Arena is where we measure
                those differences, the information that disappears between source and output, and
                whether routing or recovery actually improves the final AI task. <b>A number is not
                published here without the run that produced it.</b>
              </p>
              <div className="actions">
                <Link className="btn" href="/benchmarks">Read the benchmark protocol</Link>
                <Link className="btn ghost" href="/research">Research notes</Link>
              </div>
            </div>

            <div className="stack">
              <p className="slate"><span />WHAT THE ARENA MEASURES</p>
              <div className="tiles">
                {TRACKS.map(([title, body]) => (
                  <article className="tile" key={title}>
                    <h2>{title}</h2>
                    <p>{body}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="stack">
              <p className="slate"><span />PUBLICATION CONTRACT</p>
              <div className="chain">
                {PUBLICATION_RULES.map(([title, body]) => (
                  <article className="link" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="stack">
              <p className="slate"><span />CURRENT PUBLIC STATE</p>
              <p className="lede">
                The methodology is public now. The existing internal model-arena results are not
                being copied onto this page as a leaderboard because model versions, failure
                accounting, pricing snapshots and the public harness must be re-qualified together.
                The first public Arena release will add the leaderboard, raw result manifest,
                failure gallery and reproducibility receipts here when that gate is satisfied.
              </p>
              <div className="chain">
                <article className="link"><h3>See a source-backed result today</h3><p>Inspect the public Apple SEC sample, its original page and the compiled result.</p><Link href="/explore">Open the public sample →</Link></article>
                <article className="link"><h3>Bring a difficult document</h3><p>If your current pipeline loses a table, chart, reading order or source link, scope an evaluation against the same input.</p><Link href="/contact">Request an evaluation →</Link></article>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
