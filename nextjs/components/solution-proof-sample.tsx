import Link from "next/link";
import SourceSheet from "@/components/world-visual/source-sheet";
import { chooseExploreEntryProof, excerptPreview } from "@/lib/explore-entry-proof";
import {
  EXPLORE_SAMPLE_DIGEST,
  exploreSampleDocuments,
  exploreSampleSnapshots,
  exploreSampleSources,
  exploreSampleWorld,
} from "@/lib/explore-sample";
import { toVisualWorldModel } from "@/lib/visual-world-model";

/*
  The product surface, not a picture of it (BA-041).

  This figure used to be four drawn tiles: five flat document-stack icons whose text lines were
  box-shadows, a striped fake page with a real bbox drawn on it captioned with a real locator,
  twelve empty dots beside the number "6,300 objects", and five timeline dots ending in a
  coloured glow. Four named anti-patterns in one component, on five pages, on a site whose whole
  argument is that it shows evidence rather than describing it.

  What replaces them is the component /explore already renders -- `SourceSheet` over the frozen
  public Apple corpus -- so the proof on a solution page is the same page-bound region, the same
  excerpt, the same digests and the same locator line a visitor reaches by clicking through, and
  it cannot drift from the product because it *is* the product. The region is chosen by
  `chooseExploreEntryProof`, the same chooser /explore opens with.

  The four drawn figures are one caption line of counts read off the compiled artifact. Nothing
  here is drawn, and nothing is a number the artifact does not hold: the "6,300 objects" label is
  gone, because 6,300 was the number of candidates the compiler considered, not objects it
  published (BA-043).
*/
const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const region = chooseExploreEntryProof(world.evidence, []);
const pageCount = exploreSampleSources.reduce((total, source) => total + source.pageCount, 0);

export default function SolutionProofSample() {
  if (!region) return null;
  const onPage = world.evidence.filter(
    (item) => item.sourceId === region.sourceId && item.page === region.page,
  );
  /*
    One region, and what it supports. The claim is an object the compiler bound to this region --
    its own text, never a headline written for the page -- and it is omitted rather than
    substituted when the artifact binds none.
  */
  const claim = world.nodes.find(
    (node) => node.kind === "Claim" && node.evidenceRefs.includes(region.id),
  );
  const first = exploreSampleSnapshots[0];
  const last = exploreSampleSnapshots[exploreSampleSnapshots.length - 1];

  return (
    <figure className="solution-proof-sample" aria-labelledby="solution-proof-sample-title">
      <figcaption className="solution-proof-sample-head">
        <span id="solution-proof-sample-title">Public compiled World · Apple SEC corpus</span>
        <Link href="/explore">Inspect the evidence</Link>
      </figcaption>

      <div className="solution-proof-sample-body">
        {claim ? (
          <p className="solution-proof-claim">
            <span>Compiled claim</span>
            {excerptPreview(claim.label, 180).text}
          </p>
        ) : null}
        <SourceSheet regions={onPage} activeId={region.id} compact />
      </div>

      <p className="solution-proof-counts">
        {exploreSampleSources.length} filings · {pageCount.toLocaleString("en-US")} pages ·{" "}
        {world.totals.regions.toLocaleString("en-US")} regions · {first.id.toUpperCase()} →{" "}
        {last.id.toUpperCase()} ·{" "}
        <span className="solution-proof-digest">
          {EXPLORE_SAMPLE_DIGEST.replace(/^sha256:/, "sha256 ").slice(0, 18)}…
        </span>
      </p>
    </figure>
  );
}
