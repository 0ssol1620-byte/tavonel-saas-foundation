import { exploreChangeBaselineDocument, exploreChangeStory } from "./explore-change";
import { chooseExploreEntryProof, excerptPreview } from "./explore-entry-proof";
import {
  EXPLORE_SAMPLE_QUESTIONS,
  exploreSampleAnswers,
  exploreSampleDocuments,
  exploreSampleWorld,
} from "./explore-sample";
import { buildExploreAnswerViews } from "./explore-story";
import { landingV2PageImage, landingV2RegionImage } from "./landing-v2-assets";
import { toVisualWorldModel, type VisualNode, type VisualState } from "./visual-world-model";

/**
 * The hero scene's data, read out of the compiled public World.
 *
 * SERVER ONLY. `lib/explore-sample.ts` runs the collection compiler and pulls `node:crypto` with
 * it, so importing this from a client component would ship the compiler to the browser (the
 * reason `/explore` builds its model in `app/explore/page.tsx` and hands the stage a bounded
 * projection). The `server-only` package is not installed in this tree -- see the note in
 * `components/public-primary-cta.tsx` -- so the boundary is asserted instead:
 * `landing-v2-hero.test.ts` fails if any `"use client"` file imports this module.
 *
 * What comes out is small, flat and JSON-serializable, because it crosses the RSC boundary into
 * the hero's markup. Nothing in it is written here: the source is a committed filing, the region
 * is `/explore`'s own entry proof, the compiled object is the Claim the compiler bound to that
 * region first, the counts are `exploreChangeStory`'s, and the question is one of the four the
 * sample answers. §11.3: if the World stops carrying it, this throws at build time rather than
 * the hero rendering something plausible.
 */

/* --------------------------------------------------------------------------------- the shape */

export type HeroSource = {
  form: string;
  filingDate: string;
  filename: string;
  page: number;
  /*
    How long the filing is. `buildHeroScene()` refuses to return a scene unless the World holds
    every one of those pages -- see the check beside `compiledPageCount` there -- so the hero may
    print this one number where every other surface prints two (§57).
  */
  pageCount: number;
  digest: string;
  representationKind: string;
  /** The derivative the hero paints: a resize of the committed render of this page. */
  rasterSrc: string;
  rasterSrcSet: string;
  rasterAvifSrcSet: string;
  width: number;
  height: number;
  /** The issuer's own copy where there is one, and the filing on EDGAR. */
  officialHref: string | null;
  secHref: string | null;
};

export type HeroRegion = {
  id: string;
  bbox1000: number[];
  /*
    The four coordinates as one string -- `[30,291 → 971,380]` -- and nothing else.

    This used to be the whole §4.1 label, `SOURCE · 10-K · p.4 · [...]`, with the unit beside it,
    both assembled here. A data module has no locale, so `/ko` printed the one label on the page
    whose entire job is to say where a number came from, and the unit those numbers are in, in a
    language the page is not written in. The words are now `LandingV2HeroCopy.regionLabelFormat`
    and `LandingV2EvidenceCopy.regionUnit`, which exist in both languages. What stays here is the
    measurement.
  */
  coordinates: string;
  cropSrc: string;
  cropSrcSet: string;
  cropAvifSrcSet: string;
  cropWidth: number;
  cropHeight: number;
};

export type HeroCompiled = {
  nodeId: string;
  kind: string;
  label: string;
  excerpt: string;
  excerptTruncated: boolean;
  /** The World's own state word for this object. Never a word this module chose. */
  state: VisualState;
  evidenceCount: number;
};

export type HeroRelated = {
  id: string;
  label: string;
  kind: string;
  predicate: string;
  state: VisualState;
  /** Which node this relation actually hangs off, so a relation is never attributed upward. */
  via: string;
};

export type HeroChange = {
  /*
    THE SNAPSHOT STEP AS MEASUREMENTS, NOT AS TWO TYPED LABELS.

    This used to be `beforeLabel` / `afterLabel`, passed straight through from
    `exploreChangeStory.before.label` and `.after.label` -- which are string literals in
    `lib/explore-change.ts` ("2025 Form 10-K", "2025 Form 10-K + four 2026 filings").
    `RevisionBadge` renders both inside `data-derived="1"`, and that attribute is what
    `e2e/landing-v2.spec.ts` accepts as proof a digit was measured. The count word and both years
    were therefore certified as receipts while nothing measured them: add a fifth filing to
    `exploreSampleInputs` and the badge lists five arrivals under a label that still says four,
    with `pnpm test` and the digit walk both green.

    What crosses now is the baseline filing's own form and filing year and the arrivals
    themselves; the sentence around them is `recompile.snapshotBeforeFormat` /
    `snapshotAfterFormat` in the page's language, filled in the component. A fifth arrival moves
    the printed count because the count is `arrivals.length`.
  */
  before: { form: string; year: string };
  arrivals: { form: string; filingDate: string; label: string }[];
  counts: { rebuilt: number; added: number; removed: number; untouched: number };
};

export type HeroAsk = {
  question: string;
  citation: { form: string; page: number; regionId: string; excerptPreview: string };
};

export type HeroScene = {
  source: HeroSource;
  region: HeroRegion;
  compiled: HeroCompiled;
  related: HeroRelated[];
  change: HeroChange;
  ask: HeroAsk;
  links: { evidence: string; change: string; world: string };
};

/* ------------------------------------------------------------------------------- the reading */

/** The excerpt budget for the hero card. Long enough to be a quotation, short enough to be read. */
const EXCERPT_LIMIT = 240;

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const answers = buildExploreAnswerViews(exploreSampleAnswers, world.evidence);

/**
 * Rank two candidate relations.
 *
 * Deterministic and stated: Topic, then Entity, then everything else; within a kind the more
 * connected node, then the id. So the same World always produces the same three, and a corpus
 * change moves them for a reason rather than by ordering luck.
 *
 * Topic outranks Entity rather than tying with it, and the reason is published on /explore:
 * `EXPLORE_COPY.entityDisclaimer` records that the Entity labels in this fixed sample come from a
 * capitalised-token heuristic and that three of sixteen evaluated labels were true positives.
 * Ranked on degree alone the hero drew "Form", "Pro" and "Securities Exchange Act" -- the
 * heuristic's weakest output, presented as the product's structure. The compiled Topics are the
 * same World's own groupings and carry no such caveat.
 */
const KIND_RANK: Record<string, number> = { Topic: 0, Entity: 1 };

function rankRelated(left: HeroRelated & { degree: number }, right: HeroRelated & { degree: number }) {
  return (
    (KIND_RANK[left.kind] ?? 2) - (KIND_RANK[right.kind] ?? 2) ||
    right.degree - left.degree ||
    left.id.localeCompare(right.id)
  );
}

export function buildHeroScene(): HeroScene {
  const region = chooseExploreEntryProof(world.evidence, answers);
  if (!region) throw new Error("landing_v2_hero_has_no_entry_proof");

  const document = exploreSampleDocuments.find((entry) => entry.documentId === region.sourceId);
  if (!document) throw new Error(`landing_v2_hero_source_record_missing: ${region.sourceId}`);
  if (!region.form || !region.filingDate) {
    throw new Error(`landing_v2_hero_source_not_a_filing: ${region.sourceId}`);
  }

  /*
    §57, the rule `lib/explore-sample.ts` states over `compiledPageCount`: two numbers, never
    one. `HeroSource` carries only `pageCount`, and the hero prints "p.4 of 80" where
    `explore-stage`, `change-act`, `technical-details`, `world-diff-sample` and `source-sheet`
    all print compiled-of-total. That is harmless only while the entry proof's filing is compiled
    whole -- the 10-K is 80 of 80 -- and `chooseExploreEntryProof` is free to move to the two
    10-Qs, which are 36 of 37 and 38 of 40. A hero that then printed the second number alone
    would read a slice as the whole filing.

    A throw rather than a second figure in the hero: this module already fails closed on a
    missing derivative and on a region that states no object, the composition has one line for
    this metadata, and the moment the two numbers differ the hero needs a design decision rather
    than an extra token.
  */
  if (document.compiledPageCount !== undefined && document.compiledPageCount !== region.pageCount) {
    throw new Error(
      `landing_v2_hero_source_partially_compiled: ${region.sourceId} ${document.compiledPageCount}/${region.pageCount}`,
    );
  }

  const pageImage = landingV2PageImage(region.digest, region.page);
  const cropImage = landingV2RegionImage(region.digest, region.page, region.bbox1000);
  if (!pageImage || !cropImage) {
    // Fail closed. A hero with no committed render of its own source page would have to draw
    // something, and drawing a document is the one thing §21 forbids.
    throw new Error(`landing_v2_hero_derivative_missing: ${region.digest} p${region.page}`);
  }

  const byId = new Map(world.nodes.map((node) => [node.id, node] as const));

  /*
    The compiled object this region states.

    `toVisualWorldModel` orders an object's evidence refs so that the region whose text contains
    the object's own label leads the list (`refsStatingFirst`). So the object whose first ref is
    this region is the one the region states, rather than one of the hundreds the compiler also
    bound to every other region of the same filing.
  */
  const compiledNode = world.nodes.find(
    (node) => node.evidenceRefs[0] === region.id && node.kind !== "Evidence" && node.kind !== "Document",
  );
  if (!compiledNode) throw new Error(`landing_v2_hero_region_states_no_object: ${region.id}`);

  const preview = excerptPreview(compiledNode.label, EXCERPT_LIMIT);

  /*
    The Structure beat's two or three neighbours.

    The compiled Claim carries exactly one relation in this World -- `supported_by`, to the
    filing's Evidence node -- so a rule that read only its own edges would leave §11.2's Structure
    beat with a single grey box. The candidate set is therefore the edges of the compiled object
    AND the edges of the Document node the region belongs to, which are relations the compiler
    emitted over this same filing (`discusses_topic`, `mentions_entity`). Every entry carries
    `via` -- the node the relation actually leaves -- so the hero can say "10-K · filed
    2025-10-31 — discusses topic → Finance" and never imply the Claim owns a relation it does not.
  */
  const documentNode = world.nodes.find(
    (node) => node.kind === "Document" && node.evidenceRefs.includes(region.id),
  );
  const anchors = [compiledNode, ...(documentNode ? [documentNode] : [])];
  const seen = new Set<string>();
  const candidates: (HeroRelated & { degree: number })[] = [];
  for (const anchor of anchors) {
    for (const edge of world.edges) {
      if (edge.from !== anchor.id && edge.to !== anchor.id) continue;
      const other: VisualNode | undefined = byId.get(edge.from === anchor.id ? edge.to : edge.from);
      if (!other || other.id === compiledNode.id || seen.has(other.id)) continue;
      seen.add(other.id);
      candidates.push({
        id: other.id,
        label: other.label,
        kind: other.kind,
        predicate: edge.predicate,
        state: other.state,
        via: anchor.label,
        degree: other.degree,
      });
    }
  }
  const related: HeroRelated[] = candidates
    .sort(rankRelated)
    .slice(0, 3)
    .map(({ degree: _degree, ...entry }) => entry);

  /*
    The Use beat: the first prepared question whose leading citation sits on a page this
    repository has a committed render of, so the answer panel and the page behind it are the same
    page. "What changed?" is deliberately not among the four (`lib/explore-sample.ts`).
  */
  const asked = answers.find((answer) => {
    const cited = world.evidence.find((item) => item.id === answer.regions[0]?.evidenceId);
    return cited ? landingV2PageImage(cited.digest, cited.page) !== null : false;
  });
  if (!asked) throw new Error("landing_v2_hero_no_question_with_a_committed_page");
  if (!EXPLORE_SAMPLE_QUESTIONS.includes(asked.question as (typeof EXPLORE_SAMPLE_QUESTIONS)[number])) {
    throw new Error(`landing_v2_hero_question_not_prepared: ${asked.question}`);
  }
  const askedRegion = world.evidence.find((item) => item.id === asked.regions[0].evidenceId);
  if (!askedRegion?.form) throw new Error("landing_v2_hero_ask_citation_unresolved");

  /*
    "later filings", checked rather than assumed.

    `snapshotAfterFormat` says the arrivals came after the baseline, and `recompile.headline`
    says they arrived rather than revised anything. Both are true of this corpus -- the baseline
    is the 2025 Form 10-K and the four arrivals are 2026 filings -- and neither is enforced by
    anything upstream: `findArrivals()` only asks which documents are absent from the baseline
    snapshot. A corpus edit that back-dated one would leave the hero printing a sentence about
    order that the data no longer supports, so the order is a precondition of the scene.
  */
  const baselineFiled = exploreChangeBaselineDocument.filingDate;
  if (!baselineFiled || !exploreChangeBaselineDocument.form) {
    throw new Error("landing_v2_hero_baseline_not_a_filing");
  }
  if (exploreChangeStory.arrivals.length === 0) throw new Error("landing_v2_hero_no_arrivals");
  for (const arrival of exploreChangeStory.arrivals) {
    if (arrival.filingDate <= baselineFiled) {
      throw new Error(`landing_v2_hero_arrival_not_later: ${arrival.form} ${arrival.filingDate}`);
    }
  }

  const bbox = region.bbox1000;
  return {
    source: {
      form: region.form,
      filingDate: region.filingDate,
      filename: region.filename,
      page: region.page,
      pageCount: region.pageCount,
      digest: region.digest,
      representationKind: region.representationKind ?? "original",
      rasterSrc: pageImage.src,
      rasterSrcSet: pageImage.srcSet,
      rasterAvifSrcSet: pageImage.avifSrcSet,
      width: pageImage.width,
      height: pageImage.height,
      officialHref: document.officialHref ?? null,
      secHref: document.secHref ?? null,
    },
    region: {
      id: region.id,
      bbox1000: [...bbox],
      /* The measurement §4.1's label is built around. Nothing in it is typed. */
      coordinates: `[${bbox[0]},${bbox[1]} → ${bbox[2]},${bbox[3]}]`,
      cropSrc: cropImage.src,
      cropSrcSet: cropImage.srcSet,
      cropAvifSrcSet: cropImage.avifSrcSet,
      cropWidth: cropImage.width,
      cropHeight: cropImage.height,
    },
    compiled: {
      nodeId: compiledNode.id,
      kind: compiledNode.kind,
      label: compiledNode.label,
      excerpt: preview.text,
      excerptTruncated: preview.truncated,
      state: compiledNode.state,
      evidenceCount: compiledNode.evidenceCount,
    },
    related,
    change: {
      before: {
        form: exploreChangeBaselineDocument.form,
        year: baselineFiled.slice(0, 4),
      },
      arrivals: exploreChangeStory.arrivals.map((arrival) => ({
        form: arrival.form,
        filingDate: arrival.filingDate,
        label: arrival.label,
      })),
      counts: { ...exploreChangeStory.counts },
    },
    ask: {
      question: asked.question,
      citation: {
        form: askedRegion.form,
        page: askedRegion.page,
        regionId: askedRegion.id,
        excerptPreview: excerptPreview(asked.regions[0].excerpt, EXCERPT_LIMIT).text,
      },
    },
    links: {
      /* `evidenceIdFromQuery` resolves this against the shipped regions, so it is a real deep link. */
      evidence: `/explore?act=evidence&evidence=${encodeURIComponent(region.id)}`,
      change: "/explore?act=change",
      world: "/explore?act=world",
    },
  };
}
