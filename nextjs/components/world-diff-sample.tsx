import Link from "next/link";
import type { Route } from "next";
import { exploreChangeTimeline } from "@/lib/explore-change";

/*
  G1-019 / G1-020. The page that says "a world your AI can reason about" had no world on it, and
  the left half of its first screen was blank for about 900px.

  This is the change surface from /explore, reduced to the one step and the numbers that fit a
  product page. Every figure is read out of `exploreChangeTimeline`, which diffs two complete
  compiled Worlds whose manifest digests are frozen -- so there is nothing drawn, nothing
  illustrated and nothing typed. The last step is used because it is the World the sample
  publishes; if the corpus ever grows again, this follows it.
*/
const step = exploreChangeTimeline[exploreChangeTimeline.length - 1];
if (!step) throw new Error("world_diff_sample_has_no_step");

const n = (value: number) => value.toLocaleString("en-US");

export default function WorldDiffSample() {
  /* A diff that prints "0 changed · −0" is reporting nothing three times. Only the parts that
     moved are shown; a step where nothing moved says so in one word. */
  const parts = (...items: Array<[number, string]>) => {
    const kept = items.filter(([value]) => value !== 0).map(([value, label]) => `${label.replace("{n}", n(value))}`);
    return kept.length > 0 ? kept.join(" · ") : "unchanged";
  };
  const rows: Array<[string, string]> = [
    ["Source revisions", parts([step.sourceRevisions.added, "+{n}"], [step.sourceRevisions.unchanged, "{n} unchanged"])],
    ["Objects", parts([step.objects.added, "+{n} new"], [step.objects.rebuilt, "{n} rebuilt"], [step.objects.untouched, "{n} untouched"])],
    ["Relations", parts([step.relations.added, "+{n} new"], [step.relations.changed, "{n} changed"], [step.relations.removed, "−{n} removed"])],
    ["Evidence regions", parts([step.evidenceRegions.added, "+{n} new"], [step.evidenceRegions.changed, "{n} changed"], [step.evidenceRegions.removed, "−{n} removed"])],
  ];
  return (
    <figure className="world-diff-sample" aria-labelledby="world-diff-sample-title">
      <figcaption className="world-diff-sample-head">
        <span id="world-diff-sample-title">Published World · one filing arriving</span>
        <Link href={"/explore?act=change" as Route}>Open the change view</Link>
      </figcaption>
      <p className="world-diff-sample-arrival">
        <b>{step.arrival.label}</b>
        <span>{n(step.arrival.compiledPageCount)} of {n(step.arrival.pageCount)} pages compiled · {n(step.arrival.regionCount)} regions · accession {step.arrival.accession}</span>
      </p>
      <dl className="world-diff-sample-rows">
        {rows.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <p className="world-diff-sample-digests">
        <span>{step.fromDigest.replace(/^sha256:/, "sha256 ").slice(0, 20)}…</span>
        <span aria-hidden="true">→</span>
        <span>{step.toDigest.replace(/^sha256:/, "sha256 ").slice(0, 20)}…</span>
      </p>
      {/*
        Both sides of this comparison are complete compiles: this repository's compiler has no
        incremental path, and `lib/explore-change.ts` says so where the numbers are produced. The
        sentence is on the page too, because a "rebuilt" count beside an "untouched" count is
        exactly where a reader would otherwise infer a partial rebuild that did not happen.
      */}
      <p className="world-diff-sample-fine">
        Both Worlds above are complete compiles of their corpus, compared after the fact. What a
        compile promises when a source changes, and the state each promise holds here, is set out
        clause by clause in the{" "}
        <Link href={"/product/continuous-knowledge" as Route}>Compiler Contract</Link>.
      </p>
    </figure>
  );
}
