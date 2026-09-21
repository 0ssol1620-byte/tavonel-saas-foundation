import Link from "next/link";
import type { Route } from "next";
import { exploreChangeBaselineDocument, exploreChangeTimeline } from "@/lib/explore-change";

/*
  Every version of the public sample World, and what each arriving filing did to it.

  G1-019 / gap #10 (2026-09-22). This page argues that knowledge is not compiled once, in six
  hundred words, beside a column that held nothing but its own h1. What goes in the column is the
  thing the page is about: the five compiles of the public sample World, in order, with the
  manifest digest each one has and the diff between each pair.

  It is not `WorldDiffSample` with more rows. That component answers "what does one arrival do",
  which is /product/compiled-world's question, and it shows the last step only. This one answers
  "what does a sequence of arrivals do", which is this page's, and it shows all four transitions.
  They share the stylesheet and nothing else.

  WHY NOTHING HERE IS TYPED
  `exploreChangeTimeline` diffs five complete compiles whose manifest digests are frozen in
  `lib/explore-sample.ts`; change a snapshot and the frozen digest refuses the build before this
  module runs. `world-recompile-timeline.test.ts` recomputes every figure on this component from
  that timeline and fails on drift.

  WHAT IT DOES NOT CLAIM
  Both sides of every transition are full compiles. This deployment has no selective rebuild, so
  a step reports that two Worlds differ in the ways listed -- never that a partial recompile would
  have reached the same World. The sentence is under the list, where a reader meets a "rebuilt"
  count beside an "untouched" one and would otherwise infer exactly that.
*/

const n = (value: number) => value.toLocaleString("en-US");
const shortDigest = (digest: string) => `${digest.replace(/^sha256:/, "sha256 ").slice(0, 20)}…`;

export default function WorldRecompileTimeline() {
  return (
    <figure className="world-diff-sample world-recompile" aria-labelledby="world-recompile-title">
      <figcaption className="world-diff-sample-head">
        <span id="world-recompile-title">Published World · every version, in order</span>
        <Link href={"/explore?act=change" as Route}>Open the change view</Link>
      </figcaption>
      <p className="world-diff-sample-arrival">
        <b>{exploreChangeBaselineDocument.filename}</b>
        <span>
          the first compile, and the World every later version was built on top of ·{" "}
          {n(exploreChangeTimeline.length)} arrivals follow
        </span>
      </p>
      <ol className="world-recompile-steps">
        {exploreChangeTimeline.map((step) => (
          <li key={step.id}>
            <p className="world-recompile-step-head">
              <b>
                {step.from} → {step.to}
              </b>
              <span>{step.arrival.label}</span>
            </p>
            <dl className="world-diff-sample-rows">
              <div>
                <dt>Objects</dt>
                <dd>
                  +{n(step.objects.added)} new · {n(step.objects.rebuilt)} rebuilt ·{" "}
                  {n(step.objects.untouched)} untouched
                </dd>
              </div>
              <div>
                <dt>Evidence regions</dt>
                <dd>
                  +{n(step.evidenceRegions.added)} new · {n(step.evidenceRegions.changed)} changed
                </dd>
              </div>
              <div>
                <dt>Pages read</dt>
                <dd>
                  {n(step.arrival.compiledPageCount)} of {n(step.arrival.pageCount)} filed ·{" "}
                  accession {step.arrival.accession}
                </dd>
              </div>
            </dl>
            <p className="world-diff-sample-digests">
              <span>{shortDigest(step.fromDigest)}</span>
              <span aria-hidden="true">→</span>
              <span>{shortDigest(step.toDigest)}</span>
            </p>
          </li>
        ))}
      </ol>
      <p className="world-diff-sample-fine">
        Every World above is a complete compile of its corpus, compared after the fact. What each
        step reports is the difference between two finished compiles, not the work a selective
        rebuild would have done — this deployment has no selective path, and{" "}
        <Link href={"/explore?act=change" as Route}>the change view</Link> says the same thing
        where the same figures are produced.
      </p>
    </figure>
  );
}
