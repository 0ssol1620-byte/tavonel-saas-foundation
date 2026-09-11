import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { TrustNext } from "@/components/trust-next";
import {
  BENCHMARK_FAMILIES,
  NORTH_STAR,
  RECEIPT_FIELDS,
  qualifiedBenchmarkRecords,
} from "@/lib/benchmark-registry";
import styles from "./benchmarks.module.css";

/*
  This route returned 404 for months, and the 404 was the honest answer at the time: the only
  thing we could have put here was a table of numbers a reader had no way to check.

  What it publishes now is the part that was always publishable -- the protocol. Which families
  a knowledge-compilation result is measured in, what a record has to carry before it counts as
  a result, and the four rules that decide whether a run may be compared to anything. None of
  that needs a score to be true, and all of it is the thing a reader can hold us to later.

  The taxonomy and the receipt fields are read from lib/benchmark-registry.ts, which is also what
  validates a record at build time. The page cannot promise a field the validator does not check,
  and the validator cannot require a field the page did not publish, because there is one list.

  No competitor score, no arena figure and no vendor leaderboard row appears here. A number that
  someone else measured is theirs; the registry can record it as a quotation, and
  validateBenchmarkReceipt refuses to let it be shown as a result.
*/

export const metadata: Metadata = {
  title: "Knowledge Compilation Benchmark — TAVONEL",
  description:
    "The metric families, the receipt fields and the qualification rules a knowledge compilation result has to satisfy before TAVONEL publishes it as a number.",
  alternates: { canonical: "/benchmarks" },
  openGraph: { url: "/benchmarks" },
  robots: { index: true, follow: true },
};

/*
  The four rules, stated as what they do to a record rather than as principles.

  /research states the same four as a way of working. Here each one is also a branch in
  validateBenchmarkReceipt, so the wording names the check.
*/
const QUALIFICATION = [
  [
    "Freeze the configuration",
    "Model id, revision, input mode, prompt and run configuration are pinned before the run and recorded as digests. A run whose prompt was edited while it was running is one run of two configurations, and is comparable to neither.",
  ],
  [
    "Publish the denominator",
    "The record names the population it was measured over, and so does every individual metric. The same percentage over a whole corpus and over the subset that failed are two different findings that look identical without it.",
  ],
  [
    "Publish what failed",
    "The weaknesses ship with the run. A hypothesis that did not hold is a finding, and a table that only survives because its worst row was left out is worth less than no table.",
  ],
  [
    "Reproduce before comparing",
    "Someone else's published score is recorded as theirs, with the source, and is never restated as something we measured. A comparison waits for a run executed here under the frozen configuration above.",
  ],
] as const;

export default function BenchmarksPage() {
  const records = qualifiedBenchmarkRecords();

  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>BENCHMARK</b><span />KNOWLEDGE COMPILATION</p>
              <h1 className="document-title">Measure the compile,<br />not the page read.</h1>
            </div>

            <div className="stack">
              <p className="lede">
                A document-reading leaderboard scores the first stage of the work. Compiling
                knowledge also has to bind each statement to the region that supports it, decide
                when two mentions are one thing, keep track of which revision is current, work out
                what a change to page 40 invalidates three files away, and refuse to answer what
                the world cannot support. <b>The Knowledge Compilation Benchmark is the protocol
                for measuring all of it</b> — eight families, one receipt, four rules.
              </p>

              {/*
                B04. Five hubs answered five different questions with nothing saying which was
                which, so a reader looking for one of them read parts of three. One line, the
                same shape on each: what this page answers, and where the next question goes.
              */}
              <p className="fine">
                <b>This page answers one question:</b> what a knowledge-compilation result has to
                carry before it may be published as a number. The numbers we already have, with
                their denominators and their receipts, are on <Link href={"/research/notes" as Route}>Research notes</Link>;
                how a citation stays bound to its source is on <Link href={"/evidence" as Route}>Evidence</Link>;
                the frozen fixtures you can rerun are on <Link href={"/reproducibility" as Route}>Reproducibility</Link>;
                the security and compliance status is on <Link href={"/trust" as Route}>Trust</Link>.
              </p>

              <p className={styles.state}>
                <b>No run on this deployment carries every field of the receipt below.</b> So this
                page publishes the protocol and no table. A row arrives here when there is a
                receipt behind it: the digests, the denominator, and the failures the run produced.
              </p>
              {/*
                B07. The audit's point is that the trust case is made of architecture rather than
                of customer outcomes, and it is right. The honest fix is not a case study; it is
                saying why there is none, in the place a reader looks for one. There are no
                consented customer cases, so there is no section — and an absence with no label
                reads as an oversight rather than as a state.
              */}
              <p className="fine">Customer results are published only with written consent, and no customer has given it, so there is no customer case on this site and no operating figure taken from one. A named customer, a before-and-after time or a logo appears here when a customer has signed off on the wording, and not before.</p>

              <h2 className={`slate ${styles.sectionTitle}`}><span />THE EIGHT METRIC FAMILIES</h2>
              <div className="tiles">
                {BENCHMARK_FAMILIES.map((family) => (
                  <article className="tile" key={family.id}>
                    <h3>{family.label}</h3>
                    <p>{family.definition}</p>
                    <p className={styles.taxonomy}>{family.metrics.join(" · ")}</p>
                  </article>
                ))}
              </div>

              <h2 className={`slate ${styles.sectionTitle}`}><span />WHAT A RESULT HAS TO CARRY</h2>
              <p className={styles.para}>
                Every figure published here binds to a record carrying all of these fields. A
                record missing a digest, or missing the population a rate was measured over, is
                refused by the build rather than rendered with a blank cell.
              </p>
              <dl className={styles.receipt}>
                {RECEIPT_FIELDS.map((field) => (
                  <div className={styles.receiptRow} key={field.key}>
                    <dt>
                      {field.label}
                      {field.kind === "digest" ? <em>sha256</em> : null}
                    </dt>
                    <dd>{field.pins}</dd>
                  </div>
                ))}
              </dl>

              <h2 className={`slate ${styles.sectionTitle}`}><span />QUALIFICATION RULES</h2>
              <div className="chain">
                {QUALIFICATION.map(([title, body]) => (
                  <article className="link" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <h2 className={`slate ${styles.sectionTitle}`}><span />NORTH STAR METRIC</h2>
              <div className={styles.north}>
                <p className={styles.northMark}>DEFINITION · NO VALUE PUBLISHED ON THIS DEPLOYMENT</p>
                <h3>{NORTH_STAR.name}</h3>
                <p>{NORTH_STAR.definition}</p>
                <p className={styles.northMark}>SUPPORTING METRICS</p>
                <ul className={styles.supporting}>
                  {NORTH_STAR.supporting.map((metric) => <li key={metric}>{metric}</li>)}
                </ul>
              </div>

              {/*
                The results table exists only when there is a result. Rendering the header of an
                empty table would be a page about an absence; the absence has one sentence, above.
              */}
              {records.length > 0 ? (
                <>
                  <h2 className={`slate ${styles.sectionTitle}`}><span />RESULTS</h2>
                  {records.map((record) => (
                    <div className={styles.resultsScroll} key={record.runReceiptDigest}>
                      <table className={styles.results}>
                        <caption>
                          {record.datasetName} {record.datasetVersion} · {record.modelId} @{" "}
                          {record.modelRevision} · {record.date} · run receipt {record.runReceiptDigest}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Metric</th>
                            <th scope="col">Family</th>
                            <th scope="col">Value</th>
                            <th scope="col">Measured over</th>
                          </tr>
                        </thead>
                        <tbody>
                          {record.metrics.map((metric) => (
                            <tr key={`${metric.family}-${metric.name}`}>
                              <th scope="row">{metric.name}</th>
                              <td>{metric.family.replace("_", " ")}</td>
                              <td className={styles.value}>{metric.value} {metric.unit}</td>
                              <td className={styles.denominator}>
                                {metric.denominator.count.toLocaleString("en-US")} {metric.denominator.population}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </>
              ) : null}

              <div className="actions">
                <Link className="btn ghost" href={"/research" as Route}>How we report research</Link>
                <Link className="btn ghost" href="/evidence">How evidence is bound</Link>
              </div>
            </div>
            <TrustNext from="/benchmarks" />
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
