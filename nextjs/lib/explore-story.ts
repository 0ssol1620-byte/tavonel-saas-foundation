import type { ExploreChangeStep, ExploreChangeStory } from "./explore-change";
import type { ExploreSampleAnswer } from "./explore-sample";
import type { ExploreDocument, VisualEvidence, VisualRevision } from "./visual-world-model";

/*
  The script of the Explore stage: what it says, which act it is in, and what the Change act is
  allowed to claim.

  Two rules shape this file. The first is that it holds no compiled data -- the change view is
  built from a story handed in by the server, so a client component can import the copy and the
  state machine without dragging the collection compiler into the browser bundle. The second is
  that every number the Change act shows is read off `ExploreChangeStory`, which read it off two
  complete compiles. There is no arithmetic here that a test in `explore-change.test.ts` has not
  already pinned to an artifact.
*/

/*
  The six states of the stage, spelled as the campaign's frozen interface spells them:
  ENTRY → WORLD → OBJECT_FOCUS → EVIDENCE → CHANGE_COMPARE → ASK. The stage root publishes the
  current one as `data-world-act`, and a second lane reads that attribute, so the vocabulary is
  the contract's rather than a shorter one that reads better in this file.
*/
export type ExploreAct =
  | "entry"
  | "world"
  | "object_focus"
  | "evidence"
  | "change_compare"
  | "ask";

/**
 * The acts a URL may name, and the state each one means.
 *
 * `/explore?act=world|evidence|change` (§57 step 4). The query vocabulary is deliberately the
 * short one -- a link in an email is read by a person -- while the state it resolves to is the
 * contract's.
 */
export const DEEP_LINK_ACTS: Readonly<Record<string, ExploreAct>> = {
  world: "world",
  evidence: "evidence",
  change: "change_compare",
};

/**
 * The act a query string asks for.
 *
 * Anything else -- absent, misspelled, an act that is not deep-linkable -- lands on `entry`,
 * which is the state a first visitor should get. A deep link is a convenience, never a way to
 * reach a state the stage cannot render.
 */
export function actFromQuery(value: string | string[] | undefined): ExploreAct {
  const requested = Array.isArray(value) ? value[0] : value;
  // `Object.hasOwn`, not `in` or a bare lookup: `?act=constructor` reaches the prototype and
  // would otherwise resolve to something that is not an act at all.
  return requested !== undefined && Object.hasOwn(DEEP_LINK_ACTS, requested)
    ? DEEP_LINK_ACTS[requested]
    : "entry";
}

/**
 * The source region a query string asks for: `/explore?evidence=<regionId>` (§28 P0).
 *
 * `?act=evidence` lands a reader on the act; it cannot land them on the region a particular claim
 * was compiled from, which is the half of "evidence deep link" that makes a citation quotable
 * outside this page. This resolves the second half.
 *
 * The id is checked against the regions the page actually shipped rather than trusted. A stale,
 * mistyped or invented id returns `null` and the stage opens on its own default region instead of
 * addressing one that does not exist -- the same rule `actFromQuery` follows, and the reason a
 * bare lookup is not used here either.
 */
export function evidenceIdFromQuery(
  value: string | string[] | undefined,
  regions: ReadonlyArray<{ id: string }>,
): string | null {
  const requested = Array.isArray(value) ? value[0] : value;
  if (requested === undefined || requested === "") return null;
  return regions.some((region) => region.id === requested) ? requested : null;
}

/** The three acts the stage offers as a rail, in order. */
export const EXPLORE_ACTS: Array<{ act: ExploreAct; query: string; label: string; caption: string }> = [
  { act: "world", query: "world", label: "WORLD", caption: "The compiled objects and the relations between them." },
  { act: "evidence", query: "evidence", label: "EVIDENCE", caption: "One object, opened to the page region that supports it." },
  { act: "change_compare", query: "change", label: "CHANGE", caption: "The annual World, and the same World after four 2026 filings arrived." },
];

export const EXPLORE_COPY = {
  badge: "INTERACTIVE SAMPLE",
  hero: "Step inside a Compiled World.",
  sub: "Explore how knowledge, relationships and answers remain connected to the exact source that supports them.",
  enter: "ENTER WORLD",
  worldHint: "SELECT AN OBJECT",
  /*
    §11.6's user-facing sentence, word for word.

    Everything else in the Evidence act is machinery -- the page, the box, two digests, the
    accession. This is the one line that says what all of it means, and it says it in language
    that needs no explanation, which is why it is a constant rather than something a component
    rephrases.
  */
  evidenceLead: "This object is supported by this exact source region.",
  evidenceHint: "The page, the region and the version this object was compiled from.",
  changeHint: "Apple's 2025 Form 10-K, then the same World after the four 2026 filings arrived.",
  /*
    The public SEC sample is a full-world diff, not an incremental-recompile receipt.

    BA-028: this caption is now the only place the act describes the comparison. The act used to
    close on a FULL-REBUILD EQUIVALENCE heading whose state read NOT ESTABLISHED IN THIS
    DEPLOYMENT, so the last thing a reader met before the sign-up action was a named absence and
    the wiring state of an internal check. The fact it protected -- that both sides are complete
    compiles and nothing selective is implied -- is said here once, positively, and the
    equivalence check itself stays where it is already published: /product/continuous-knowledge
    and the receipt inside a downloaded package.
  */
  changeCaption:
    "Both snapshots are complete compiles of the corpus as it stood, compared object by object. Every count below is measured from that comparison.",
  changeCountsNote:
    "A content-addressed object keeps its identity while its compiled fields hold and gets a new one when they do not, so an arriving filing both adds objects and rebuilds objects the annual filing already carried. All four counts are shown as measured.",
  changeArrivalsHeading: "FILINGS THAT ARRIVED",
  changeTimelineHeading: "HOW THIS WORLD WAS REACHED",
  /*
    The sentence that keeps the timeline from implying selective recompilation.

    A five-step temporal view is exactly the shape a reader expects incremental compilation to
    have, so the step that says otherwise has to be on the same screen as the steps. The Core's
    selective recompilation is a different execution with its own receipt (§25.3) and this page
    has none, so a timeline that quietly let the reader assume one would be the most convenient
    untruth available in this act.

    BA-033 rewrote the opening: the fact now leads with what the steps are ("every object in the
    World is rebuilt at every step") rather than with the internal wiring state it used to lead
    with, and it no longer names the deployment.
  */
  changeTimelineNote:
    "Each step is a complete compile of the corpus as it stood, compared with the complete compile before it: every object in the World is rebuilt at every step, so the recompiled figure is the whole World rather than a selectively rebuilt subset. Rebuilt in place counts objects the previous World already carried whose compiled fields moved — the arriving filing's dependency impact, as measured. The steps run in reporting-period order, which is not filing order here: Apple filed the 2026 proxy statement three weeks before the first-quarter report it follows above.",
  askPlaceholder: "Ask this World…",
  askNote:
    "This sample answers four prepared questions. Each answer is the source text the retriever scored, not a rewrite of it.",
  technical: "TECHNICAL DETAILS",
  /*
    The Entity qualifier, moved here from the object list by §49.

    It reads as it always did, word for word, because two tests read it word for word: the
    measured figure has to match `entity-extraction-eval.json`, and the heuristic must never be
    described as a resolver. Moving a disclosure is allowed; softening one on the way is not.

    The figure moved from "3 of 15" to "3 of 16" on 2026-09-06, and it moved down. Gap-matrix row
    D7-01 removed the extractor's per-document cap of eight entities, so the manual's ninth
    candidate -- MPa, a pressure unit -- reached the label set for the first time. The heuristic
    did not change; the 15 was measured through the cap. Re-deriving the published number from
    its receipt is the rule, and it applies in the direction that flatters nothing.
  */
  entityDisclaimer:
    "Entity labels in this fixed sample come from a simple capitalised-token heuristic, not by a resolver. In the recorded evaluation, 3 of 16 baseline labels were true positives. Unreviewed entities are shown only as sample structure; Claims and page-bound evidence are the parts to judge here.",
  closeLabel: "Leave the sample",
  endHeading: "Try the same path with your own knowledge.",
  endActions: [
    { label: "Start with your files", href: "/login", primary: true },
    { label: "Connect a source", href: "/integrations", primary: false },
    { label: "How compilation works", href: "/knowledge-compiler", primary: false },
  ],
} as const;

/* --------------------------------------------------------------- change view */

/** One filing the Act shows, with the source region it opens on. */
export type ExploreChangeArrivalView = ExploreChangeStory["arrivals"][number];

export type ExploreChangeView = {
  /** The World the arrivals landed on, named by its snapshot label and its one committed file. */
  baseline: {
    label: string;
    manifestDigest: string;
    filename: string;
    href: string;
    digest: string;
    /** The file's own page count, so "region on page N of M" states M rather than assuming it. */
    pageCount: number;
  };
  after: { label: string; manifestDigest: string };
  arrivals: ExploreChangeArrivalView[];
  /** Objects the arrivals reached: added, removed or rebuilt in place. Derived, never summed by hand. */
  reached: number;
  counts: ExploreChangeStory["counts"];
  relations: { added: number; removed: number; changed: number };
  evidenceRegions: { added: number; removed: number; changed: number };
  sourceRevisions: { added: number; removed: number; unchanged: number };
  /** W0 → W1 → W2 → W3 → W4, one entry per arriving filing (§24). Oldest first. */
  timeline: ExploreChangeStep[];
  affectedNodeIds: string[];
  untouchedNodeIds: string[];
  equivalence: ExploreChangeStory["equivalence"];
};

export function buildExploreChangeView(
  story: ExploreChangeStory,
  baselineFile: ExploreDocument,
  timeline: readonly ExploreChangeStep[],
): ExploreChangeView {
  const reached = story.affectedNodeIds.length;
  if (reached !== story.counts.added + story.counts.removed + story.counts.rebuilt) {
    // The two are derived from the same diff by different routes; if they ever disagree the Act
    // would be showing two incompatible readings of one comparison.
    throw new Error("explore_change_view_reached_disagrees_with_counts");
  }
  if (story.arrivals.length !== story.diff.sourceRevisions.added.length) {
    // One arriving filing is one new source version. If the two ever disagree, the Act's list of
    // filings and its count of source versions are describing different events.
    throw new Error("explore_change_view_arrivals_disagree_with_source_revisions");
  }
  if (timeline.length !== story.arrivals.length) {
    // The timeline walks one step per arriving filing. A shorter one would draw a path that
    // skips a World the corpus actually passed through.
    throw new Error("explore_change_view_timeline_disagrees_with_arrivals");
  }
  if (timeline[timeline.length - 1]?.toDigest !== story.after.manifestDigest) {
    // The last step has to land on the World the rest of the Act is describing.
    throw new Error("explore_change_view_timeline_does_not_reach_after");
  }
  return {
    baseline: {
      label: story.before.label,
      manifestDigest: story.before.manifestDigest,
      filename: baselineFile.filename,
      href: baselineFile.href,
      digest: baselineFile.digest,
      pageCount: baselineFile.pageCount,
    },
    after: { label: story.after.label, manifestDigest: story.after.manifestDigest },
    arrivals: story.arrivals.map((arrival) => ({ ...arrival })),
    reached,
    counts: story.counts,
    relations: {
      added: story.diff.relations.added.length,
      removed: story.diff.relations.removed.length,
      changed: story.diff.relations.changed.length,
    },
    evidenceRegions: {
      added: story.diff.evidence.added.length,
      removed: story.diff.evidence.removed.length,
      changed: story.diff.evidence.changed.length,
    },
    sourceRevisions: {
      added: story.diff.sourceRevisions.added.length,
      removed: story.diff.sourceRevisions.removed.length,
      unchanged: story.diff.sourceRevisions.unchanged,
    },
    timeline: timeline.map((step) => ({ ...step })),
    affectedNodeIds: [...story.affectedNodeIds],
    untouchedNodeIds: [...story.untouchedNodeIds],
    equivalence: story.equivalence,
  };
}

/* ----------------------------------------------------------------- ask views */

export type ExploreAnswerRegion = {
  /** The region id in `VisualWorldModel.evidence`, so a citation can open the Evidence act. */
  evidenceId: string;
  sourceId: string;
  filename: string;
  page: number;
  excerpt: string;
  /** Kept for the technical drawer. §49 takes the relevance decimal off the default surface. */
  relevance: number;
};

export type ExploreAnswerView = {
  question: string;
  /** The highest-scored region's own text. The sample quotes the source; it does not rewrite it. */
  answer: string;
  regions: ExploreAnswerRegion[];
};

/**
 * Bind each cited region to the region the stage can actually open.
 *
 * The retriever cites a source, a page and a box; the renderer addresses a compiled region by
 * id. Matching them here rather than in the component means a citation that no longer resolves
 * fails the build instead of rendering a button that does nothing.
 */
export function buildExploreAnswerViews(
  answers: ReadonlyArray<ExploreSampleAnswer>,
  evidence: ReadonlyArray<VisualEvidence>,
): ExploreAnswerView[] {
  return answers.map((answer) => {
    const regions = answer.citations.map((citation) => {
      const region = evidence.find(
        (item) =>
          item.sourceId === citation.sourceId &&
          item.bbox1000.join(",") === citation.bbox1000.join(","),
      );
      if (!region) {
        throw new Error(`explore_answer_citation_unresolved: ${answer.question} / ${citation.sourceId}`);
      }
      return {
        evidenceId: region.id,
        sourceId: region.sourceId,
        filename: region.filename,
        page: region.page,
        excerpt: citation.excerpt,
        relevance: citation.relevance,
      };
    });
    if (regions.length === 0) throw new Error(`explore_answer_has_no_regions: ${answer.question}`);
    return { question: answer.question, answer: regions[0].excerpt, regions };
  });
}

/* --------------------------------------------------------- technical drawer */

export type ExploreTechnicalRecord = {
  worldId: string;
  worldStatus: string;
  manifestDigest: string;
  runtime: string;
  receipt: { requestId: string; inputSha256: string; outputSha256: string; manifestDigest: string };
  sourceDirectory: string;
  documents: ExploreDocument[];
  revisions: VisualRevision[];
  /** What the compiler emitted for this World. */
  counts: { objects: number; relations: number; regions: number };
  /** What the page actually sent to the browser -- a bounded projection of the above (§24). */
  shipped: { objects: number; relations: number; regions: number };
};
