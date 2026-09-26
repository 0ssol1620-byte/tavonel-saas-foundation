import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { EVIDENCE } from "@/lib/evidence-record";
import recoveryReceipt from "@/public/research/receipts/R-01-recovery-counterfactual-olmocr-2026-08-08.json";
import { TrustNext } from "@/components/trust-next";
import {
  BENCHMARK_FAMILIES,
  NORTH_STAR,
  RECEIPT_FIELDS,
  qualifiedBenchmarkRecords,
} from "@/lib/benchmark-registry";
import {
  ArenaBarChart,
  ArenaReceipts,
  ArenaSpeedQualityPlot,
} from "@/components/benchmarks/arena-charts";
import {
  arenaBars,
  arenaDots,
  modelArenaBoard,
  settledModels,
  unsettledModels,
} from "@/lib/model-arena-page-data";
import styles from "./benchmarks.module.css";

/*
  This route returned 404 for months, and the 404 was the honest answer at the time: the only
  thing we could have put here was a table of numbers a reader had no way to check.

  It now opens on a completed run instead of on the protocol that governs one. The protocol is
  still published, in full, below the results -- what changed is which of the two a reader meets
  first. A page whose subject is measurement, opening on four paragraphs about how measurement
  ought to work and no measurement, was the one page on this site that argued against itself.

  What the results are and are not:

  - They are the Model Arena campaign of 2026-09-03: ten document-reading models run here,
    on one corpus, through one evaluator revision, with a canary proof per model. OmniDocBench
    scores the first stage of the work -- reading a page -- and nothing more. It does not measure
    identity, lineage, temporal integrity or recompilation, which is why the eight-family
    protocol below exists and why no number here is presented as a score for TAVONEL.
  - No competitor's published leaderboard row appears beside them. A number someone else measured
    is theirs; `validateBenchmarkReceipt` refuses to render a quotation as a result, and the same
    rule is why this page compares models we ran to each other and to nothing else.
  - The word "accuracy" does not appear on this page. An Edit distance and a TEDS score are
    structural similarity measures against one benchmark's ground truth; `benchmarks-page.test.ts`
    fails the build if the rendered page contains the word.

  The board is read from `content/benchmarks/model-arena-20260903.json`, written by
  `scripts/benchmarks/build-model-arena-artifact.mjs` from the campaign's own reports and bound
  to each of them by sha256. The taxonomy and receipt fields below are read from
  lib/benchmark-registry.ts, which is also what validates a record at build time.
*/

export const metadata: Metadata = {
  title: "Knowledge Compilation Benchmark — TAVONEL",
  description:
    "A completed document-reading run with its receipts — model revisions, page counts, GPU and price snapshot — and the protocol a knowledge compilation result has to satisfy before it is published.",
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
  /*
    Three of these normalise away the word "accuracy", which the constitution does not let this
    site use for a completion or a similarity figure and which three registry identifiers still
    spell. "text accuracy" is a similarity to a reference transcription, "bbox" is whether a
    region landed where the ground truth puts it, and "point-in-time accuracy" is whether an
    answer matches what was true on a date. Each label now names what is measured; the registry
    keeps its identifiers, because renaming a metric there would move what the validator checks.
  */
  "text accuracy": "text fidelity to the source",
  bbox: "region placement",
  "bbox correctness": "region correctness",
  "point-in-time accuracy": "point-in-time correctness",
  VRAM: "GPU memory",
  "hallucination / omission": "hallucinated and omitted content",
  "source change → active world p50 / p95": "median and 95th-percentile time from source change to Active World",
  "cost / 1,000 pages": "cost per 1,000 pages",
  "cost / changed semantic unit": "cost per changed semantic unit",
  "selective vs full equivalence": "equivalence with a full rebuild",
  "Source change → Active World p95": "95th-percentile time from source change to Active World",
};

const metricLabel = (metric: string) => METRIC_LABEL[metric] ?? metric;

const GDP_PDF_ARMS = [
  [
    "Native PDF",
    "The provider receives the native PDF and the benchmark prompt, with no added context.",
    "Two-arm run published",
  ],
  [
    "Compiled context",
    "The same native PDF and prompt are paired with TAVONEL's sealed compiled context. This is the primary comparison with Native PDF.",
    "Two-arm run published",
  ],
  [
    "Fixed retrieval",
    "The same compiled corpus is queried through a fixed embedder and reranker, then cited evidence is passed to the same target model.",
    "Not run",
  ],
  [
    "Adaptive routing",
    "The same corpus and query pass through a sealed eligible routing policy. The receipt records the chosen candidate and, where available, its control counterfactual or shadow run.",
    "Not run",
  ],
] as const;

export default function BenchmarksPage() {
  const records = qualifiedBenchmarkRecords();
  const arena = modelArenaBoard();
  const settled = settledModels();
  const unsettled = unsettledModels();
  /*
    The failed hypothesis, read from the evidence record rather than restated here, so the page
    that publishes the run and the page that publishes the research findings cannot disagree
    about what was and was not supported.
  */
  const notSupported = EVIDENCE.filter((entry) => entry.state === "unsupported");
  const recovery = EVIDENCE.find((entry) => entry.receipt?.id === "R-01");
  if (!recovery?.receipt) throw new Error("The published recovery result requires receipt R-01");

  return (
    <PublicSitePage>
      <section className={"scene doc " + styles.benchmarkScene}>
        <div className="shell">
          <div className="body">
            <div className="stack">
              <h1 className="document-title">How a compile is measured.</h1>
            </div>

            <div className="stack">
              <p className="lede">
                The reader study compares {settled.length} models on the same{" "}
                <span data-derived="1">{arena.benchmark.gt_pages.toLocaleString("en-US")}</span>{" "}
                benchmark pages. The recovery study below tests our own pipeline with and without
                one lane. Both publish methods and limits; neither is a current-service score.
              </p>

              <section className={styles.recovery} aria-labelledby="recovery-title">
                <p className={styles.recoveryLabel}>TAVONEL research · same-pipeline comparison</p>
                <h2 className={styles.sectionTitle} id="recovery-title">Recovery makes a measurable difference on difficult pages.</h2>
                <div className={styles.recoveryMeasures} aria-label="olmOCR-Bench recovery comparison">
                  <div>
                    <strong>{(recoveryReceipt.with_recovery.overall_score * 100).toFixed(1)}</strong>
                    <span>with recovery</span>
                    <span className={styles.recoveryTrack} aria-hidden="true"><span style={{ width: (recoveryReceipt.with_recovery.overall_score * 100).toFixed(1) + "%" }} /></span>
                  </div>
                  <div>
                    <strong>{(recoveryReceipt.without_recovery.overall_score * 100).toFixed(1)}</strong>
                    <span>without recovery</span>
                    <span className={styles.recoveryTrack} aria-hidden="true"><span style={{ width: (recoveryReceipt.without_recovery.overall_score * 100).toFixed(1) + "%" }} /></span>
                  </div>
                </div>
                <p className={styles.para}>
                  olmOCR-Bench score across {recoveryReceipt.held_constant.input_count.toLocaleString("en-US")} documents and {recoveryReceipt.held_constant.test_count.toLocaleString("en-US")} checks, measured {recovery.receipt.date}. This isolates one recovery lane in a historical research pipeline. It is not a current-service score or a competitor comparison. Low-quality old scans reached {(recoveryReceipt.per_category["old_scans.jsonl"].with_recovery * 100).toFixed(1)}% even with recovery.
                </p>
                <details className={styles.recoveryDetails}>
                  <summary>Method and limits</summary>
                  <p>{recovery.body}</p>
                </details>
                <a href={recovery.receipt.url}>Download the R-01 result and receipt</a>
              </section>

              {/* ------------------------------------------------- the completed run */}

              <h2 className={styles.sectionTitle}>
                Document reading, measured here — Model Arena, {arena.board_generated_at_kst}
              </h2>
              <p className={styles.para}>
                These scores measure page reading only. Every row is a model we ran ourselves on{" "}
                {arena.benchmark.name}, scored by {arena.benchmark.evaluator} at evaluator revision{" "}
                <span data-derived="1">{arena.benchmark.evaluator_pin.slice(0, 12)}</span>, under the
                conditions listed below.
              </p>

              <ArenaBarChart
                title="Text Edit distance against the benchmark’s ground truth"
                direction="Lower is better"
                unit="normalised edit distance, 0 to 1"
                bars={arenaBars("text_edit", settled)}
              />

              <ArenaBarChart
                title="Table structure similarity (TEDS)"
                direction="Higher is better"
                unit="tree-edit-distance similarity, 0 to 1"
                bars={arenaBars("table_teds", settled)}
              />

              <ArenaSpeedQualityPlot dots={arenaDots(settled)} />

              {/*
                The rows that are not settled, with the campaign's own reason each one is not.

                They are on the page rather than filtered out of it. Two are reference readings
                the campaign refused to rank, and one is a model the founder stopped mid-run over
                GPU spend; a board that quietly dropped all three would be a board whose shape was
                chosen after the numbers were known.
              */}
              <h3 className={styles.sectionTitle}>Rows we did not rank</h3>
              <div className="chain">
                {unsettled.map((model) => (
                  <article className="link" key={model.key}>
                    <span className="st">{model.status}</span>
                    <h3>{model.display_name}</h3>
                    {model.status_note ? <p>{model.status_note}</p> : null}
                    {model.omnidoc ? (
                      <p className="fine" data-derived="1">
                        text Edit {model.omnidoc.text_edit.toFixed(4)} · table TEDS{" "}
                        {model.omnidoc.table_teds.toFixed(4)} · reading-order Edit{" "}
                        {model.omnidoc.reading_order_edit.toFixed(4)} · over{" "}
                        {model.omnidoc.pages.toLocaleString("en-US")} pages · tag{" "}
                        {model.omnidoc.tag}
                      </p>
                    ) : null}
                    {/*
                      The campaign's own notes, folded and unedited.

                      They are the scoring lane's internal record -- markdown, model keys, tags
                      and all -- and rewriting one into a marketing sentence is the edit that
                      makes a receipt stop receipting. So they are carried byte for byte and put
                      behind a disclosure, where the reader who wants to know why a row is a
                      reference row finds the answer in the words the run recorded.
                    */}
                    {model.notes.length > 0 ? (
                      <details className="status-fold">
                        <summary>Why, in the campaign&rsquo;s own words</summary>
                        {model.notes.map((note) => (
                          <pre className={styles.verbatim} key={note}>{note}</pre>
                        ))}
                      </details>
                    ) : null}
                  </article>
                ))}
              </div>

              {arena.hosted_price_reference ? (
                <p className={styles.state}>
                  <b>The hosted row.</b> {arena.hosted_price_reference.model_key} ran on a
                  subscription surface, not on a GPU we rented, so it has no hardware line. Its
                  list-price reference on{" "}
                  <span data-derived="1">{arena.hosted_price_reference.captured_at}</span> was $
                  <span data-derived="1">{arena.hosted_price_reference.input_usd_per_mtok}</span>
                  /Mtok in and $
                  <span data-derived="1">{arena.hosted_price_reference.output_usd_per_mtok}</span>
                  /Mtok out. {arena.hosted_price_reference.note}
                </p>
              ) : null}

              {/*
                The failed hypothesis, on the results section rather than at the foot of the page.

                A reader looking at ten bars is exactly the reader who should be told that the one
                ranking signal this site does not have is a blind quality score, and that it is
                absent because it was tested and did not work.
              */}
              {notSupported.map((entry) => (
                <div className={styles.notSupported} key={entry.title}>
                  <p className={styles.notSupportedMark}>Not supported</p>
                  <h3>{entry.title}</h3>
                  <p>{entry.body}</p>
                  <p className="fine">
                    Nothing on this page, and no routing decision behind it, reads a scalar
                    quality score. <Link href={"/research/notes" as Route}>Read the finding</Link>.
                  </p>
                </div>
              ))}

              <h3 className={styles.sectionTitle}>Conditions, licence and pins</h3>
              <ul className={styles.conditions}>
                <li>
                  <b>Dataset.</b> {arena.benchmark.name} at revision{" "}
                  <span data-derived="1">{arena.benchmark.dataset_revision.slice(0, 12)}</span> —
                  licensed {arena.benchmark.dataset_license}, redistribution{" "}
                  {arena.benchmark.dataset_redistribution.replace(/_/g, " ")}. Its pages are not
                  republished here and no page image from it appears on this site.
                </li>
                <li>
                  <b>Evaluator.</b> {arena.benchmark.evaluator} from{" "}
                  {arena.benchmark.evaluator_repository} at pin{" "}
                  <span data-derived="1">{arena.benchmark.evaluator_pin}</span>, licence{" "}
                  {arena.benchmark.evaluator_license}, entrypoint{" "}
                  <code>{arena.benchmark.evaluator_entrypoint}</code>. Scoring driver:{" "}
                  <code>{arena.benchmark.driver}</code>.
                </li>
                <li>
                  <b>Speed.</b> {arena.speed_method.definition} {arena.speed_method.not_measured}
                </li>
                <li>
                  <b>Registry snapshot.</b> Model revisions and the GPU catalogue were resolved at{" "}
                  <span data-derived="1">{arena.registry_snapshot_at}</span>. A listed GPU rate is
                  the provider&rsquo;s rate when that pod was provisioned; it is raw hardware cost
                  and never a price for a page.
                </li>
              </ul>

              <h3 className={styles.sectionTitle}>Limits of this run</h3>
              <ul className={styles.conditions}>
                {arena.caveats.map((caveat) => (
                  <li className={styles.verbatim} key={caveat}>{caveat}</li>
                ))}
              </ul>

              <ArenaReceipts models={arena.models} sources={arena.sources} />

              {/* ------------------------------------------------- the sibling run */}

              <h2 className={styles.sectionTitle}>The other run on this site</h2>
              <div className="chain">
                <article className="link">
                  <span className="st">GDP.pdf</span>
                  <h3>Does compiled context change what a model gets right?</h3>
                  <p>
                    A held-out task set answered twice by the same model — once from the PDF alone,
                    once with TAVONEL&rsquo;s compiled context beside it. The measured delta, the
                    conditions it was measured under and the deviations from the sealed protocol
                    are on its own page.
                  </p>
                  <p className="fine">
                    <Link href={"/benchmarks/gdp-pdf" as Route}>Read the GDP.pdf run</Link>
                  </p>
                </article>
                <article className="link">
                  <span className="st">Model Arena</span>
                  <h3>Which reader should the router send a page to?</h3>
                  <p>
                    The board above. It answers what a page costs to read and how closely each
                    reader reproduced it, which is the evidence a routing policy is learned from.
                  </p>
                </article>
              </div>

              {/* ------------------------------------------------- the protocol */}

              {/*
                B04 asked each of the five hubs to say which question it answers, and it was
                right to. BA-088 is about how it was done.

                BA-076. What sat here was a bordered state block announcing, three paragraphs
                under a headline promising "Measure the compile", that this page has no
                benchmark results. Nothing about being a protocol needs a score, and the
                condition for a row arriving is a forward statement rather than a confession.

                Moved below the results 2026-09-22: the same sentence, in the place where a
                reader who has just read a board asks what governs one.
              */}
              <p className={styles.state}>
                The qualification contract defines what a knowledge-compilation result has to
                carry: a frozen configuration, corpus and output digests, a named denominator,
                published failures, and reproducible scoring material.
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

              {/*
                G2-012. This block distinguishes the completed two-arm GDP.pdf run from the
                remaining two arms of the four-arm design. The external corpus and reference
                harness are linked directly; the published result names its protocol deviations.

                The supporting research below remains derived from the evidence registry, with
                dates and downloadable receipts carried by each record.
              */}
              <h2 className={styles.sectionTitle}>GDP.pdf evaluation design</h2>
              <p className={styles.para}>
                GDP.pdf is a public set of 100 held-out tasks across ten professional domains. We
                have published the PDF-alone and PDF-plus-compiled-context arms with their actual
                conditions and deviations. Fixed retrieval and adaptive routing remain unrun; the
                four-arm design is not a completed benchmark or a leaderboard score.
              </p>
              <p className={styles.para}>
                Review the{" "}
                <a href="https://huggingface.co/datasets/surgeai/GDP.pdf">public dataset</a>{" "}
                and <a href="https://github.com/surge-ai/gdp-pdf">reference harness</a>.
              </p>
              {/*
                Two of the four arms have now been run. The result page says what it found --
                which was that the compiled arm did not beat the PDF alone -- and lists every
                condition that makes it incomparable with a published GDP.pdf score. It is linked
                rather than summarised here: a one-line summary of a negative result on the
                protocol page is where a negative result goes to be forgotten.
              */}
              <p className={styles.para}>
                <Link href={"/benchmarks/gdp-pdf" as Route}>
                  Read the two-arm run: compiled context against the PDF alone
                </Link>{" "}
                &mdash; a first result on this design, with its deviations, denominators and
                receipts. It is not comparable with any published GDP.pdf score.
              </p>
              <div className="chain">
                {GDP_PDF_ARMS.map(([title, body, state]) => (
                  <article className="link" key={title}>
                    <span className="st">{state}</span>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <h2 className={styles.sectionTitle}>Published supporting research</h2>
              <p className={styles.para}>
                These findings remain scoped to the population and question named in each
                downloadable receipt.
              </p>
              <div className="chain">
                {EVIDENCE.filter((entry) => entry.receipt).map((entry) => (
                  <article className="link" key={entry.title}>
                    <span className="st">{entry.receipt!.date}</span>
                    <h3>{entry.title}</h3>
                    <p>{entry.takeaway}</p>
                    <p className="fine">
                      <b>Receipt {entry.receipt!.id}</b> · {entry.receipt!.of} ·{" "}
                      <a href={entry.receipt!.url} download>Download the receipt</a> ·{" "}
                      <Link href={"/research/notes" as Route}>Read the finding in full</Link>
                    </p>
                  </article>
                ))}
              </div>

              <h2 className={styles.sectionTitle}>The eight metric families</h2>
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
                    {/*
                      BQ-112. A list of metrics is a list, not a middot-joined mono string.

                      Four to six names in 10px tracked mono joined by " · " read as one machine
                      identifier at a glance, and 10px is under the type floor. They are the
                      family's members, so they are a `<ul>` in sans -- and a screen reader
                      announces "list, five items" rather than one long sentence whose separators
                      it does not speak.

                      The row says "render metrics as a real table" and this is deliberately not
                      one. What the row is against is the mono middot string, and a table here
                      would have two columns -- family and its metrics -- of which the second is
                      still a list of names, beside a definition that is a paragraph. At 390px it
                      would stack back into exactly these cards. The list is the table's honest
                      shape for this data; the divergence is on the record rather than silent.
                    */}
                    <ul className={styles.taxonomy}>
                      {family.metrics.map((metric) => <li key={metric}>{metricLabel(metric)}</li>)}
                    </ul>
                  </article>
                ))}
              </div>

              <h2 className={styles.sectionTitle}>What a result has to carry</h2>
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

              <h2 className={styles.sectionTitle}>Qualification rules</h2>
              <div className="chain">
                {QUALIFICATION.map(([title, body]) => (
                  <article className="link" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <h2 className={styles.sectionTitle}>North Star metric</h2>
              <div className={styles.north}>
                {/*
                  BA-077. The label read "DEFINITION · NO VALUE PUBLISHED ON THIS DEPLOYMENT",
                  so the closing statement of the page that says what we optimise for carried a
                  notice, in tracked uppercase, that we have no number for it -- and brought
                  back "this deployment" while doing it. The label's job is to say that this is
                  a definition, which the one word "Definition" does. An absent value is already
                  evident from the absence of a value. (type-02 later took the caps off the label
                  as well: it is a kicker, and a kicker is sentence case.)
                */}
                <p className={styles.northMark}>Definition</p>
                <h3>{NORTH_STAR.name}</h3>
                <p>{NORTH_STAR.definition}</p>
                <p className={styles.northMark}>Supporting metrics</p>
                <ul className={styles.supporting}>
                  {NORTH_STAR.supporting.map((metric) => <li key={metric}>{metricLabel(metric)}</li>)}
                </ul>
              </div>

              {/*
                The results table exists only when there is a qualified record. The evaluation
                design above carries no score and does not need a placeholder table.
              */}
              {records.length > 0 ? (
                <>
                  <h2 className={styles.sectionTitle}>Results</h2>
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
