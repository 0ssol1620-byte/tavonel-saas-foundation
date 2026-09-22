import Link from "next/link";
import SourceSheet from "@/components/world-visual/source-sheet";
import styles from "./solution-proof-sample.module.css";
import { chooseExploreEntryProof, excerptPreview } from "@/lib/explore-entry-proof";
import { proofCopy } from "@/lib/proof-copy";
import {
  EXPLORE_SAMPLE_DIGEST,
  exploreSampleDocuments,
  exploreSampleSnapshots,
  exploreSampleSources,
  exploreSampleWorld,
} from "@/lib/explore-sample";
import { REGION_SCALE, sourceRegionRaster } from "@/lib/source-page-rasters";
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

  BQ-019. The block itself no longer repeats. One canonical staging exists -- on the landing --
  and the other seven routes carry a variant that names its own filing and links to the region:
  `excerpt` for the solution pages, `crop` for the page whose argument is what a read recovers
  from a printed statement. Repeating the whole block on eight routes did not make the proof
  eight times stronger; it made it read as a template.
*/
export type ProofPick = { form: string; match: RegExp; framing: string };
/*
  Gap #11 adds `thumb`: the crop with nothing interactive in it.

  The /solutions hub expands one anchor over the whole card (`solutions.module.css`, BA-052), so
  a second link inside a card is covered by the card's own target and announced twice. The
  thumbnail is therefore the crop and its filing line and no anchor -- the card is the link, and
  the region opens from the detail page the card leads to.
*/
export type ProofVariant = "canonical" | "excerpt" | "crop" | "thumb";

function selectRegion(pick?: ProofPick): VisualEvidence | null {
  if (!pick) return chooseExploreEntryProof(world.evidence, []);
  const found = world.evidence.find((item) =>
    item.form === pick.form && item.page > 2 && pick.match.test(item.excerpt));
  if (!found) throw new Error(`solution_proof_region_not_found: ${pick.form} ${String(pick.match)}`);
  return found;
}

function regionHref(region: VisualEvidence) {
  return { pathname: "/explore", query: { act: "evidence", evidence: region.id } } as const;
}

function filingLabel(region: VisualEvidence, korean?: boolean) {
  const filed = proofCopy(korean).filed;
  return region.form ? `${region.form}${region.filingDate ? ` · ${filed(region.filingDate)}` : ""}` : region.filename;
}

/*
  BQ-063 / n34. `korean` reaches `SourceSheet` and the page frame under it, so /ko's proof block
  reads in Korean instead of being the one place on that page a Korean reader cannot follow. It
  is optional and English is the default: /explore, the five solution pages and the crop variant
  are byte-identical, and no e2e selector built on their text moves.
*/
export default function SolutionProofSample({ pick, variant = "canonical", korean }: {
  pick?: ProofPick;
  variant?: ProofVariant;
  korean?: boolean;
} = {}) {
  const copy = proofCopy(korean);
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
  const preview = excerptPreview(region.excerpt, 180);

  /*
    BQ-019 / D4. The two routes that link to the proof rather than restaging it: a solution page
    shows the passage its own audience would be reading, named by filing and page, and nothing
    else. Nothing here is authored -- the excerpt, the filing and the page are the compiler's.
  */
  if (variant === "excerpt") {
    return (
      <figure className={styles.excerpt} data-proof-kind="source-passage" data-proof-variant="excerpt">
        <figcaption className={styles.excerptLabel}>{copy.fromSource}</figcaption>
        <p className={styles.excerptText} data-evidence-id={region.id}>
          {preview.text}{preview.truncated ? "…" : ""}
        </p>
        <div className={styles.excerptFoot}>
          <span>{filingLabel(region, korean)} · {copy.page(region.page)}</span>
          <Link href={regionHref(region)}>{copy.openRegion}</Link>
        </div>
      </figure>
    );
  }

  /*
    The page-crop variant: the region as it was printed, cut from the committed render of the same
    page at twice the scale. Where no crop is committed it falls back to the passage rather than
    drawing a stand-in for one.
  */
  const crop = sourceRegionRaster(region.digest, region.page, region.bbox1000);

  /*
    Gap #11. The same crop with no anchor and no target of its own, for a card that is the link.

    `loading="lazy"` here and not on the crop variant: five of these are on one hub page, well
    below the fold, and the committed rasters are between 25KB and 250KB each. The dimensions are
    on the element, so the card reserves its space before the bytes arrive and nothing shifts.
  */
  if (variant === "thumb") {
    return crop ? (
      <figure className={styles.thumb} data-proof-kind="source-passage" data-proof-variant="thumb">
        {/* eslint-disable-next-line @next/next/no-img-element -- as the crop variant: the
            committed raster is served byte for byte so the render stays checkable. */}
        <img src={crop.file} alt={`${filingLabel(region, korean)}, ${copy.cropAlt(region.page)}`} width={crop.width} height={crop.height} decoding="async" loading="lazy" />
        <figcaption className={styles.excerptFoot}>
          <span>{filingLabel(region, korean)} · {copy.pageOf(region.page, region.pageCount)}</span>
        </figcaption>
      </figure>
    ) : (
      <figure className={styles.thumb} data-proof-kind="source-passage" data-proof-variant="thumb">
        <p className={styles.excerptText} data-evidence-id={region.id}>
          {preview.text}{preview.truncated ? "…" : ""}
        </p>
        <figcaption className={styles.excerptFoot}>
          <span>{filingLabel(region, korean)} · {copy.page(region.page)}</span>
        </figcaption>
      </figure>
    );
  }

  if (variant === "crop" && crop) {
    return (
      <figure className={styles.crop} data-proof-kind="source-passage" data-proof-variant="crop">
        {/* eslint-disable-next-line @next/next/no-img-element -- the committed raster is
            served byte for byte: next/image would re-encode it, and the manifest's sha256 of
            these bytes is what makes the render checkable against its source. */}
        <img src={crop.file} alt={`${filingLabel(region, korean)}, ${copy.cropAlt(region.page)}`} width={crop.width} height={crop.height} decoding="async" style={{ maxWidth: `${Math.round(crop.width / REGION_SCALE)}px` }} />
        <figcaption className={styles.excerptFoot}>
          <span>{filingLabel(region, korean)} · {copy.pageOf(region.page, region.pageCount)}</span>
          <Link href={regionHref(region)}>{copy.openRegion}</Link>
        </figcaption>
      </figure>
    );
  }
  if (variant === "crop") {
    return <SolutionProofSample pick={pick} variant="excerpt" korean={korean} />;
  }

  /*
    The canonical staging, in handoff §4.4 order: the page, the region cut out of it, the passage
    read from that region, the objects that passage supports, and the way through to the World it
    is part of. `SourceSheet` carries the first three; the last two are this block's own.
  */
  const linked = world.nodes
    .filter((node) => node.evidenceRefs.includes(region.id))
    .slice(0, 6);
  const first = exploreSampleSnapshots[0];
  const last = exploreSampleSnapshots[exploreSampleSnapshots.length - 1];

  return (
    <figure className={styles.block} aria-labelledby="solution-proof-sample-title" data-proof-kind="source-passage" data-proof-variant="canonical" data-evidence-id={region.id}>
      <figcaption className={styles.head}>
        <span id="solution-proof-sample-title">{copy.head}</span>
        {/* D34: a link that opens a verification surface wears .link-verify (--verified + the underline). */}
        <Link className="link-verify" href={regionHref(region)}>{copy.inspect}</Link>
      </figcaption>

      {pick ? <p className={styles.framing}>{pick.framing}</p> : null}

      {/* Beats 1-3: the page, the region on it, the passage read from that region. */}
      <SourceSheet regions={onPage} activeId={region.id} ledger="disclosure" korean={korean} />

      {/* Beat 4: what this passage is attached to in the compiled World. */}
      {linked.length > 0 ? (
        <dl className={styles.linked}>
          <dt>{copy.linkedObjects}</dt>
          <dd>{linked.map((node) => <span key={node.id}>{node.label}</span>)}</dd>
        </dl>
      ) : null}

      {/* Beat 5: the World this is one region of, and the counts it publishes. */}
      <p className={styles.counts}>
        {copy.counts(exploreSampleSources.length, pageCount.toLocaleString("en-US"), world.totals.regions.toLocaleString("en-US"))}
        {" · "}{first.id.toUpperCase()} → {last.id.toUpperCase()} ·{" "}
        <span className={styles.digest}>
          {EXPLORE_SAMPLE_DIGEST.replace(/^sha256:/, "sha256 ").slice(0, 18)}…
        </span>
      </p>
    </figure>
  );
}
