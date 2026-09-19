import { exploreChangeStory } from "./explore-change";
import { chooseExploreEntryProof, excerptPreview } from "./explore-entry-proof";
import { exploreSampleAnswers, exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import { buildExploreAnswerViews } from "./explore-story";
import { landingV2PageImage, landingV2RegionImage } from "./landing-v2-assets";
import { toVisualWorldModel, type VisualState } from "./visual-world-model";

/**
 * The three product-proof scenes' data: Scene 02's tabs, Scene 04's evidence record, Scene 05's
 * dependency-impact view.
 *
 * SERVER ONLY, for the reason `lib/landing-v2-hero.ts` gives: this reaches the collection
 * compiler. `landing-v2-proof.test.ts` fails if a `"use client"` file imports it.
 *
 * Every figure below is read from the compiled public World or from the comparison of two
 * complete compiles of it. Nothing is averaged, nothing is rounded into a friendlier number, and
 * the one number this module formats -- a region's coordinates at three decimals -- is a unit
 * conversion of the compiler's own per-mille box, stated as such.
 */

/* ------------------------------------------------------------------------ the state vocabulary

  The words the product already uses for an object's state, kept in one place rather than
  invented here.

  `components/explore/parallel-view.tsx` exports `STATE_WORD` and /explore prints it in the
  Evidence act's STATE row. It cannot be imported: that file is `"use client"`, and a value
  exported from a client module reaches a server module as a client reference rather than as the
  object (the trap `lib/explore-story.ts` documents). So the table is repeated here and
  `landing-v2-proof.test.ts` imports the original and asserts the two are identical -- which
  fails the moment /explore renames a state, instead of the landing quietly keeping the old word.

  `lib/claim-state.ts` is the other state vocabulary on this site and is deliberately not used:
  it names the state of a *published capability claim* (QUALIFIED, DEMONSTRATED, ...), not the
  state of a compiled object, and borrowing its words here would put a capability label under a
  paragraph of a filing.
*/
export const LANDING_V2_STATE_WORD: Record<VisualState, string> = {
  current: "CURRENT",
  candidate: "PUBLISHED SAMPLE",
  changed: "CHANGED",
  affected: "AFFECTED",
  unresolved: "UNRESOLVED",
  dim: "UNCHANGED",
};

/* --------------------------------------------------------------------------------- the shapes */

export type ProofRaster = { src: string; srcSet: string; avifSrcSet: string; width: number; height: number };

export type ProofSource = {
  form: string;
  filingDate: string;
  filename: string;
  page: number;
  pageCount: number;
  digest: string;
  representationKind: string;
};

export type ProofTab = {
  question: string;
  /** The cited region's own text, trimmed. The sample quotes the source; it does not rewrite it. */
  answerExcerpt: string;
  answerTruncated: boolean;
  source: ProofSource;
  region: { id: string; bbox1000: number[] };
  /**
   * Which of the answer's citations this tab opens.
   *
   * Usually the first. When the retriever's leading citation sits on a page this repository has
   * no committed render of, the tab shows the first cited region that does -- still a region the
   * retriever cited for this question, and the index says which one it is rather than letting a
   * third-ranked region pass for the top one.
   */
  citationIndex: number;
  citationCount: number;
  rasters: { page: ProofRaster; crop: ProofRaster };
  openHref: string;
};

export type EvidenceRecord = {
  claim: { nodeId: string; kind: string; label: string; excerpt: string; excerptTruncated: boolean };
  /** The World's own word for this object's state. Never a word chosen here. */
  status: { state: VisualState; label: string };
  source: ProofSource & { officialHref: string | null; secHref: string | null };
  /** The compiler's per-mille box, and the same box as unit-interval coordinates. */
  region: { id: string; bbox1000: number[]; normalized: number[]; normalizedLabel: string; unit: string };
  version: { digest: string; short: string };
  rasters: { page: ProofRaster; crop: ProofRaster };
  hrefs: { evidence: string; original: string };
  /** The citation a reader copies, assembled from the record rather than written. */
  citation: string;
};

export type RecompileView = {
  beforeLabel: string;
  afterLabel: string;
  arrivals: { documentId: string; form: string; filingDate: string; label: string; page: number; excerptPreview: string }[];
  /** A readable sample of the objects the arrivals reached -- never the whole list. */
  affectedSample: { id: string; label: string; labelTruncated: boolean; kind: string; state: VisualState; stateLabel: string }[];
  counts: { rebuilt: number; added: number; removed: number; untouched: number };
  /** The comparison is between two complete compiles; this says so where the counts are read. */
  equivalence: { state: string; reason: string };
  hrefs: { change: string; contract: string };
};

/* -------------------------------------------------------------------------------- the reading */

const EXCERPT_LIMIT = 240;
const AFFECTED_SAMPLE = 6;

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const answers = buildExploreAnswerViews(exploreSampleAnswers, world.evidence);

function rasterOf(digest: string, page: number, bbox1000: readonly number[]) {
  const pageImage = landingV2PageImage(digest, page);
  const cropImage = landingV2RegionImage(digest, page, bbox1000);
  if (!pageImage || !cropImage) return null;
  const set = (image: typeof pageImage): ProofRaster => ({
    src: image.src,
    srcSet: image.srcSet,
    avifSrcSet: image.avifSrcSet,
    width: image.width,
    height: image.height,
  });
  return { page: set(pageImage), crop: set(cropImage) };
}

function sourceOf(region: { form?: string; filingDate?: string; filename: string; page: number; pageCount: number; digest: string; representationKind?: string }): ProofSource {
  if (!region.form || !region.filingDate) throw new Error(`landing_v2_proof_source_not_a_filing: ${region.filename}`);
  return {
    form: region.form,
    filingDate: region.filingDate,
    filename: region.filename,
    page: region.page,
    pageCount: region.pageCount,
    digest: region.digest,
    representationKind: region.representationKind ?? "original",
  };
}

/**
 * Scene 02's tabs: prepared questions this World answers, each opened onto the page it cites.
 *
 * The selection rule is structural, in question order, and has exactly one requirement a reader
 * can see: the region the tab opens must be a region the retriever cited for that question AND
 * sit on a page this repository has a committed render of. A tab whose source page could only be
 * drawn is not a tab.
 *
 * §12 asks for three tabs reaching three filings. This corpus gives three tabs reaching two:
 * of the four prepared questions, one cites no region on any page with a committed render, and
 * the remaining three land on the Q1 10-Q twice and the proxy once. Rendering a fourth page to
 * make the number three is a corpus job (`scripts/render-source-pages.mjs`), not a copy job, so
 * the tabs say which filing and which page each one is and the count stands as measured.
 */
export function buildProofTabs(): ProofTab[] {
  const tabs: ProofTab[] = [];
  for (const answer of answers) {
    const index = answer.regions.findIndex((cited) => {
      const evidence = world.evidence.find((item) => item.id === cited.evidenceId);
      return evidence ? rasterOf(evidence.digest, evidence.page, evidence.bbox1000) !== null : false;
    });
    if (index < 0) continue;
    const cited = answer.regions[index];
    const evidence = world.evidence.find((item) => item.id === cited.evidenceId);
    if (!evidence) throw new Error(`landing_v2_proof_citation_unresolved: ${answer.question}`);
    const rasters = rasterOf(evidence.digest, evidence.page, evidence.bbox1000);
    if (!rasters) throw new Error(`landing_v2_proof_rasters_vanished: ${cited.evidenceId}`);
    const preview = excerptPreview(cited.excerpt, EXCERPT_LIMIT);
    tabs.push({
      question: answer.question,
      answerExcerpt: preview.text,
      answerTruncated: preview.truncated,
      source: sourceOf(evidence),
      region: { id: evidence.id, bbox1000: [...evidence.bbox1000] },
      citationIndex: index,
      citationCount: answer.regions.length,
      rasters,
      openHref: `/explore?act=evidence&evidence=${encodeURIComponent(evidence.id)}`,
    });
    if (tabs.length === 3) break;
  }
  if (tabs.length === 0) throw new Error("landing_v2_proof_has_no_tab_with_a_committed_page");
  return tabs;
}

/**
 * Scene 04's inspector: one real evidence record, the same region the hero opens on.
 *
 * The fields are §14's, and every one of them is read: STATUS is the object's state in the
 * World, SOURCE is the file the compiler read, PAGE is where the region sits and of how many,
 * REGION is the compiler's box in two units, VERSION is the source digest.
 */
export function buildEvidenceRecord(): EvidenceRecord {
  const region = chooseExploreEntryProof(world.evidence, answers);
  if (!region) throw new Error("landing_v2_proof_has_no_entry_proof");
  const document = exploreSampleDocuments.find((entry) => entry.documentId === region.sourceId);
  if (!document) throw new Error(`landing_v2_proof_source_record_missing: ${region.sourceId}`);
  const node = world.nodes.find(
    (item) => item.evidenceRefs[0] === region.id && item.kind !== "Evidence" && item.kind !== "Document",
  );
  if (!node) throw new Error(`landing_v2_proof_region_states_no_object: ${region.id}`);
  const rasters = rasterOf(region.digest, region.page, region.bbox1000);
  if (!rasters) throw new Error(`landing_v2_proof_derivative_missing: ${region.digest} p${region.page}`);

  const preview = excerptPreview(node.label, EXCERPT_LIMIT);
  const normalized = region.bbox1000.map((value) => Number((value / 1000).toFixed(3)));
  const source = sourceOf(region);
  // `sourceVersionId` is the digest without its algorithm prefix; the short form is the head of
  // the hex, and the full string travels beside it so a truncation is never the only copy.
  const short = `${region.digest.slice(0, 14)}…`;

  return {
    claim: { nodeId: node.id, kind: node.kind, label: node.label, excerpt: preview.text, excerptTruncated: preview.truncated },
    status: { state: node.state, label: LANDING_V2_STATE_WORD[node.state] },
    source: { ...source, officialHref: document.officialHref ?? null, secHref: document.secHref ?? null },
    region: {
      id: region.id,
      bbox1000: [...region.bbox1000],
      normalized,
      normalizedLabel: `${normalized[0].toFixed(3)}, ${normalized[1].toFixed(3)} → ${normalized[2].toFixed(3)}, ${normalized[3].toFixed(3)}`,
      /* The words `lib/proof-copy.ts` already publishes for this unit. */
      unit: "bbox, per mille of the page",
    },
    version: { digest: region.digest, short },
    rasters,
    hrefs: {
      evidence: `/explore?act=evidence&evidence=${encodeURIComponent(region.id)}`,
      /* The committed bytes the compiler read, opened at the page the region is on. */
      original: `${document.href}#page=${region.page}`,
    },
    citation: `${source.form} · filed ${source.filingDate} · ${source.filename} · page ${source.page} of ${source.pageCount} · bbox ${region.bbox1000.join(",")} (per mille) · ${region.digest}`,
  };
}

/**
 * Scene 05's dependency-impact view.
 *
 * A reshape of `exploreChangeStory`, never a recomputation: the four counts are the ones
 * `diffWorldVersions` measured between two complete compiles, and `equivalence` travels with
 * them so the scene cannot be read as a selective rebuild (`lib/claim-state.ts` records selective
 * recompilation as Direction, not a shipped capability).
 */
export function buildRecompileView(): RecompileView {
  const byId = new Map(world.nodes.map((node) => [node.id, node] as const));
  const affectedSample = exploreChangeStory.affectedNodeIds
    .map((id) => byId.get(id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    // Objects a reader can recognise: the compiler labels an object with its own text, and a
    // two-word running header says nothing about what the arrival reached.
    .filter((node) => node.label.trim().length >= 40)
    .slice(0, AFFECTED_SAMPLE)
    .map((node) => {
      // The flag travels with the text: a quotation cut short without a marker is a small lie
      // the component would otherwise have to guess at.
      const preview = excerptPreview(node.label, 90);
      return {
        id: node.id,
        label: preview.text,
        labelTruncated: preview.truncated,
        kind: node.kind,
        state: node.state,
        stateLabel: LANDING_V2_STATE_WORD[node.state],
      };
    });

  return {
    beforeLabel: exploreChangeStory.before.label,
    afterLabel: exploreChangeStory.after.label,
    arrivals: exploreChangeStory.arrivals.map((arrival) => ({
      documentId: arrival.documentId,
      form: arrival.form,
      filingDate: arrival.filingDate,
      label: arrival.label,
      page: arrival.page,
      excerptPreview: excerptPreview(arrival.excerpt, EXCERPT_LIMIT).text,
    })),
    affectedSample,
    counts: { ...exploreChangeStory.counts },
    equivalence: {
      state: exploreChangeStory.equivalence.state,
      reason:
        exploreChangeStory.equivalence.state === "not_yet"
          ? exploreChangeStory.equivalence.reason
          : "",
    },
    hrefs: { change: "/explore?act=change", contract: "/product/continuous-knowledge" },
  };
}
