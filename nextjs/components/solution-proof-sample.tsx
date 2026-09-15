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
import { toVisualWorldModel, type VisualEvidence } from "@/lib/visual-world-model";

/*
  Real source evidence, shared with Explore. Counts come from the published artifact,
  not from candidates considered by the compiler or decorative marketing fixtures.
*/
const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const pageCount = exploreSampleSources.reduce((total, source) => total + source.pageCount, 0);

/*
  G1-016. Five solution pages shared one evidence block byte for byte, so the only thing that
  told a reader -- or a crawler -- which page they were on was twelve lines of hero copy.

  The fix is not five fixtures. It is five *selections* out of the one published Apple corpus:
  the annual filing, the quarterly statements and the proxy each answer a different question, and
  each solution page now opens on the filing its own audience would be reading. Nothing is
  authored here. `match` locates a region the compiler emitted, and a selection that stops
  matching the compiled corpus throws rather than silently showing a different region.
*/
export type ProofPick = { form: string; match: RegExp; framing: string };

function selectRegion(pick?: ProofPick): VisualEvidence | null {
  if (!pick) return chooseExploreEntryProof(world.evidence, []);
  const found = world.evidence.find((item) =>
    item.form === pick.form && item.page > 2 && pick.match.test(item.excerpt));
  if (!found) throw new Error(`solution_proof_region_not_found: ${pick.form} ${String(pick.match)}`);
  return found;
}

export default function SolutionProofSample({ pick }: { pick?: ProofPick } = {}) {
  const region = selectRegion(pick);
  if (!region) return null;
  const onPage = world.evidence.filter(
    (item) => item.sourceId === region.sourceId && item.page === region.page,
  );
  /*
    Quote the selected region itself. An evidenceRefs match alone previously selected a
    document-heading Claim while the highlighted region described the business. Presenting
    that pair as a verified claim would overstate the artifact's binding. This is explicitly
    a source passage, not an answer, a new model result, or claim-level verification.
  */
  const first = exploreSampleSnapshots[0];
  const last = exploreSampleSnapshots[exploreSampleSnapshots.length - 1];

  return (
    <figure className="solution-proof-sample" aria-labelledby="solution-proof-sample-title" data-proof-kind="source-passage">
      <figcaption className="solution-proof-sample-head">
        <span id="solution-proof-sample-title">Public compiled World · Apple SEC corpus</span>
        <Link href={{ pathname: "/explore", query: { act: "evidence", evidence: region.id } }}>Inspect the evidence</Link>
      </figcaption>

      {pick ? <p className="solution-proof-framing">{pick.framing}</p> : null}

      <div className="solution-proof-sample-body">
        <p className="solution-proof-claim" data-evidence-id={region.id}>
          <span>Source passage · excerpt</span>
          {excerptPreview(region.excerpt, 180).text}
        </p>
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
