import type { ExploreChangeStory } from "./explore-change";
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

/** The three acts the stage offers as a rail, in order. */
export const EXPLORE_ACTS: Array<{ act: ExploreAct; query: string; label: string; caption: string }> = [
  { act: "world", query: "world", label: "WORLD", caption: "The compiled objects and the relations between them." },
  { act: "evidence", query: "evidence", label: "EVIDENCE", caption: "One object, opened to the page region that supports it." },
  { act: "change_compare", query: "change", label: "CHANGE", caption: "One source revision, and the knowledge it reached." },
];

export const EXPLORE_COPY = {
  badge: "INTERACTIVE SAMPLE",
  hero: "Step inside a Compiled World.",
  sub: "Explore how knowledge, relationships and answers remain connected to the exact source that supports them.",
  enter: "ENTER WORLD",
  worldHint: "SELECT AN OBJECT",
  evidenceHint: "The page, the region and the version this object was compiled from.",
  changeHint: "The maintenance manual was reissued. Nothing else in the corpus moved.",
  /*
    The Change caption, written against the counts rather than around them.

    The blueprint's draft reads "Dependent knowledge was rebuilt; unrelated knowledge remained
    intact", which is true of this fixture and stops one word short of the part that matters:
    this compiler addresses an object by its content, so a reworded claim leaves the World and a
    new one arrives. Saying "rebuilt" without saying that invites a reader to look for a
    "rebuilt" count and find a zero.
  */
  changeCaption:
    "One line of one source document was reissued. The knowledge that depended on it was recompiled; the rest of the World was carried over untouched.",
  changeCountsNote:
    "This compiler addresses a knowledge object by its content, so a reworded claim leaves the World as one object and returns as another. Read added, removed and carried over together.",
  equivalenceHeading: "FULL-REBUILD EQUIVALENCE",
  equivalenceLead: "Both revisions were fully compiled; the comparison is between two complete compiles.",
  askPlaceholder: "Ask this World…",
  askNote:
    "This sample answers three prepared questions. Each answer is the source text the retriever scored, not a rewrite of it.",
  technical: "TECHNICAL DETAILS",
  /*
    The Entity qualifier, moved here from the object list by §49.

    It reads as it always did, word for word, because two tests read it word for word: the
    measured figure has to match `entity-extraction-eval.json`, and the heuristic must never be
    described as a resolver. Moving a disclosure is allowed; softening one on the way is not.
  */
  entityDisclaimer:
    "Entity labels in this fixed sample come from a simple capitalised-token heuristic, not by a resolver. In the recorded evaluation, 3 of 15 baseline labels were true positives. Unreviewed entities are shown only as sample structure; Claims and page-bound evidence are the parts to judge here.",
  closeLabel: "Leave the sample",
  endHeading: "Try the same path with your own knowledge.",
  endActions: [
    { label: "Start with your files", href: "/login", primary: true },
    { label: "Connect a source", href: "/integrations", primary: false },
    { label: "How compilation works", href: "/knowledge-compiler", primary: false },
  ],
} as const;

/* --------------------------------------------------------------- change view */

export type ExploreChangeSide = {
  label: string;
  manifestDigest: string;
  filename: string;
  href: string;
  digest: string;
  page: number;
  /** The file's own page count, so "region on page N of M" states M rather than assuming it. */
  pageCount: number;
  excerpt: string;
  bbox1000: [number, number, number, number];
};

export type ExploreChangeView = {
  documentId: string;
  before: ExploreChangeSide;
  after: ExploreChangeSide;
  /** Objects the revision reached: added, removed or rebuilt in place. Derived, never summed by hand. */
  reached: number;
  counts: ExploreChangeStory["counts"];
  relations: { added: number; removed: number; changed: number };
  evidenceRegions: { added: number; removed: number; changed: number };
  sourceRevisions: { added: number; removed: number; unchanged: number };
  affectedNodeIds: string[];
  untouchedNodeIds: string[];
  equivalence: ExploreChangeStory["equivalence"];
};

export function buildExploreChangeView(
  story: ExploreChangeStory,
  files: { before: ExploreDocument; after: ExploreDocument },
): ExploreChangeView {
  const reached = story.affectedNodeIds.length;
  if (reached !== story.counts.added + story.counts.removed + story.counts.rebuilt) {
    // The two are derived from the same diff by different routes; if they ever disagree the Act
    // would be showing two incompatible readings of one comparison.
    throw new Error("explore_change_view_reached_disagrees_with_counts");
  }
  return {
    documentId: story.sourceChange.documentId,
    before: {
      label: story.before.label,
      manifestDigest: story.before.manifestDigest,
      filename: files.before.filename,
      href: files.before.href,
      digest: files.before.digest,
      page: story.sourceChange.page,
      pageCount: files.before.pageCount,
      excerpt: story.sourceChange.before.excerpt,
      bbox1000: story.sourceChange.before.bbox1000,
    },
    after: {
      label: story.after.label,
      manifestDigest: story.after.manifestDigest,
      filename: files.after.filename,
      href: files.after.href,
      digest: files.after.digest,
      page: story.sourceChange.page,
      pageCount: files.after.pageCount,
      excerpt: story.sourceChange.after.excerpt,
      bbox1000: story.sourceChange.after.bbox1000,
    },
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
  counts: { objects: number; relations: number; regions: number };
};
