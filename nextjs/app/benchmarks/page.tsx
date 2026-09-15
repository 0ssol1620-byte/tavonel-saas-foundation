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

/*
  BA-093. The five things that have to be true of a record before its figure may be read as a
  result -- which is what a buyer needs from this section. The twenty-one-field schema behind
  them is still published, one click down, because a protocol page that hides its own contract
  is worth less than one that prints it; what changed is which of the two is the section and
  which is the detail.

  Each of these is a group of `RECEIPT_FIELDS` rather than a new claim, so the fold below is the
  same list stated field by field.
*/
const READING_A_NUMBER = [
  [
    "A configuration nobody could edit mid-run",
    "The model, its revision, the input mode, the prompt and the run configuration are recorded as digests taken before the run started.",
  ],
  [
    "A denominator",
    "The record names the population the run covered, and so does every individual metric on it.",
  ],
  [
    "The raw predictions",
    "The corpus and the run's own output are bound by digest, so the scoring can be repeated by someone who does not trust ours.",
  ],
  [
    "A price snapshot",
    "Cost per page means nothing without the prices it was computed at, on the date it was computed.",
  ],
  [
    "The failures the run produced",
    "Published with the run, not summarised out of it. A table that survives only because its worst row was left out is worth less than no table.",
  ],
] as const;

/*
  BA-094. Our internal metric identifiers, normalised for a reader.

  The chip rows printed the registry's own strings, which put four casings in one line -- VRAM
  shouting, `bbox` an internal coordinate name, the rest lowercase words -- used a slash for both
  "per" and "or", and left p50 / p95 as percentiles of nothing stated. Only the identifiers are
  mapped; a metric already written in English passes through, so the registry stays the one list
  and this is a rendering decision rather than a second vocabulary.
*/
const METRIC_LABEL: Record<string, string> = {
  bbox: "region accuracy",
  "bbox correctness": "region correctness",
  VRAM: "GPU memory",
  "hallucination / omission": "hallucinated and omitted content",
  "source change → active world p50 / p95": "median and 95th-percentile time from source change to Active World",
  "cost / 1,000 pages": "cost per 1,000 pages",
  "cost / changed semantic unit": "cost per changed semantic unit",
  "selective vs full equivalence": "equivalence with a full rebuild",
  "Source change → Active World p95": "95th-percentile time from source change to Active World",
};

const metricLabel = (metric: string) => METRIC_LABEL[metric] ?? metric;

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
                B04 asked each of the five hubs to say which question it answers, and it was
                right to. BA-088 is about how it was done.

                The role sentence went into the lede above -- "the protocol for measuring
                all of it" -- and the four cross-links are one labelled row at the foot, because
                the same 11px mono template opened five consecutive pages in the same order and
                put a navigation paragraph where the argument should start.

                BA-076. What sat here was a bordered state block announcing, three paragraphs
                under a headline promising "Measure the compile", that this page has no
                benchmark results. Nothing about being a protocol needs a score, and the
                condition for a row arriving is a forward statement rather than a confession.
              */}
              <p className={styles.state}>
                <b>This page is the protocol, not a scoreboard.</b> It defines
                what a knowledge-compilation result has to carry before anyone — including us —
                may publish it as a number. A result appears here with its digests, its
                denominator and the failures the run produced, or it does not appear.
              </p>
              {/*
                B07's label is right that an absence with nothing said about it reads as an
                oversight. BA-072 is about how many times it was said: this exact sentence,
                ending on "no customer has given it", was printed on /benchmarks, /evidence and
                /reproducibility -- three pages volunteering that we have no customers, to a
                reader who had not asked and to no legal requirement.

                The policy stays, once, on /trust, written as a policy: customer names, figures
                and logos appear on this site only with that customer's written sign-off on the
                exact wording. What is gone is the count.
              */}

              <h2 className={`slate ${styles.sectionTitle}`}><span />The eight metric families</h2>
              <div className="tiles">
                {BENCHMARK_FAMILIES.map((family) => (
                  <article className="tile" key={family.id}>
                    <h3>{family.label}</h3>
                    <p>{family.definition}</p>
                    {/*
                      BA-094. The chip row printed our internal metric identifiers: four casings
                      in one line (VRAM shouting, bbox an internal coordinate name, the rest
                      lowercase words), a slash doing duty as both "per" and "or", and p50 / p95
                      with nothing saying what they are percentiles of. `METRIC_LABEL` normalises
                      the ones that were identifiers and leaves the ones that were already
                      English alone.
                    */}
                    <p className={styles.taxonomy}>{family.metrics.map(metricLabel).join(" · ")}</p>
                  </article>
                ))}
              </div>

              <h2 className={`slate ${styles.sectionTitle}`}><span />What a result has to carry</h2>
              {/*
                BA-093. Twenty-one rows of our internal receipt schema, field by field, in
                tracked uppercase mono, as the largest section of the page. A buyer arriving
                where they expected results read a process vocabulary instead, and a competitor
                read exactly how we structure evidence.

                What a reader needs is the rule, so the five rules are the section. The field
                list is not deleted -- it is the checkable half, and a protocol page that hides
                its own contract is worth less -- it is folded, for the reader who came to hold
                us to it. The audit proposed moving the full list to /docs; there is no receipt
                schema section in `lib/docs-content.ts` to move it to, so it stays here behind
                one click and the move is a cross-lane request to docs-developers-ko.
              */}
              <p className={styles.para}>
                Every figure published here binds to a record, and five things have to be true of
                it before the figure may be read as a result.
              </p>
              <div className="chain">
                {READING_A_NUMBER.map(([title, body]) => (
                  <article className="link" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>
              <details className="status-fold">
                <summary>The complete receipt schema</summary>
                <p className={styles.para}>
                  A record missing a digest, or missing the population a rate was measured over,
                  is refused by the build rather than rendered with a blank cell. These are the
                  fields the validator checks.
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
              </details>

              <h2 className={`slate ${styles.sectionTitle}`}><span />Qualification rules</h2>
              <div className="chain">
                {QUALIFICATION.map(([title, body]) => (
                  <article className="link" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <h2 className={`slate ${styles.sectionTitle}`}><span />North Star metric</h2>
              <div className={styles.north}>
                {/*
                  BA-077. The label read "DEFINITION · NO VALUE PUBLISHED ON THIS DEPLOYMENT",
                  so the closing statement of the page that says what we optimise for carried a
                  notice, in tracked uppercase, that we have no number for it -- and brought
                  back "this deployment" while doing it. The label's job is to say that this is
                  a definition, which "DEFINITION" does. An absent value is already evident from
                  the absence of a value.
                */}
                <p className={styles.northMark}>DEFINITION</p>
                <h3>{NORTH_STAR.name}</h3>
                <p>{NORTH_STAR.definition}</p>
                <p className={styles.northMark}>SUPPORTING METRICS</p>
                <ul className={styles.supporting}>
                  {NORTH_STAR.supporting.map((metric) => <li key={metric}>{metricLabel(metric)}</li>)}
                </ul>
              </div>

              {/*
                The results table exists only when there is a result. Rendering the header of an
                empty table would be a page about an absence; the absence has one sentence, above.
              */}
              {records.length > 0 ? (
                <>
                  <h2 className={`slate ${styles.sectionTitle}`}><span />Results</h2>
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

              {/*
                BA-095. Two ghosts in their own mono-labelled row, immediately above a TrustNext
                rendering the page's only filled button: three buttons where there is one next
                step. Both destinations are in the cross-link row below.

                BA-088. The four cross-links the deleted template sentence carried.
              */}
              <p className="fine">
                <b>Also in the trust case:</b>{" "}
                <Link href={"/research/notes" as Route}>Research notes</Link> ·{" "}
                <Link href={"/evidence" as Route}>Evidence</Link> ·{" "}
                <Link href={"/reproducibility" as Route}>Reproducibility</Link> ·{" "}
                <Link href={"/research" as Route}>Research</Link> ·{" "}
                <Link href={"/trust" as Route}>Trust</Link>
              </p>
            </div>
            <TrustNext from="/benchmarks" />
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
