import type { CollectionOcrInput, CollectionOcrRegion } from "./collection-compiler";
import {
  exploreSampleDocuments,
  exploreSampleInputs,
  exploreSampleRevisionBDocuments,
  exploreSampleRevisionBInputs,
  exploreSampleRevisionBWorld,
  exploreSampleWorld,
} from "./explore-sample";
import { diffWorldVersions, type WorldVersionDiff } from "./world-version-diff";

/*
  What one source revision did to a Compiled World.

  The Change Act asks the hardest question the product makes: a document was reissued -- what
  did that cost? The honest answer can only come from two complete compiles, so that is what
  this is. `lib/explore-sample.ts` compiles the same three-document corpus twice, once with the
  maintenance manual at revision B and once at revision C, and everything below is read out of
  those two artifacts by `diffWorldVersions`. No count here was typed. No count here could be
  typed: change either fixture and the frozen digests in `explore-sample.ts` refuse the build
  before this module runs.

  What this does not do, stated because the temptation is obvious: it does not claim
  full-rebuild equivalence. Both sides of this comparison are full compiles, so the comparison
  proves that the two worlds differ in the ways reported -- not that a *selective* rebuild would
  have reached the same world as a full one. That is a different experiment, it needs the Core's
  `verify_equivalence`, and until a receipt from it is wired in here, `equivalence` says
  `not_yet` and the Act renders without a badge.
*/

export type ExploreChangeStory = {
  before: { label: "Revision B"; manifestDigest: string; documentIds: string[] };
  after: { label: "Revision C"; manifestDigest: string; documentIds: string[] };
  sourceChange: {
    documentId: string;
    filename: string;
    page: number;
    before: { excerpt: string; bbox1000: [number, number, number, number] };
    after: { excerpt: string; bbox1000: [number, number, number, number] };
  };
  diff: WorldVersionDiff;
  counts: { rebuilt: number; added: number; removed: number; untouched: number };
  affectedNodeIds: string[];
  untouchedNodeIds: string[];
  equivalence:
    | { state: "not_yet"; reason: string }
    | { state: "receipt"; source: string; sha256: string; equivalent: boolean; compared: number };
};

function documentIdsOf(inputs: readonly CollectionOcrInput[]) {
  return [...inputs.map((input) => input.documentId)].sort();
}

function regionsOf(input: CollectionOcrInput): CollectionOcrRegion[] {
  const regions = input.regions;
  if (!regions || regions.length === 0) {
    throw new Error(`explore_change_document_has_no_regions: ${input.documentId}`);
  }
  return [...regions].sort((left, right) => left.order - right.order);
}

/** Every number a region states, in the order it states them. */
function quantities(text: string) {
  return (text.match(/\d[\d.,]*/g) ?? []).join("|");
}

/**
 * The one document that was reissued.
 *
 * Both corpora hold the same document ids -- that is the point of the fixture -- so the revised
 * document is the one whose content digest moved. More than one, and this throws rather than
 * choosing: a story about "the source revision" is only true while there is exactly one.
 */
function findRevisedDocument() {
  const before = new Map(exploreSampleRevisionBInputs.map((input) => [input.documentId, input] as const));
  const after = new Map(exploreSampleInputs.map((input) => [input.documentId, input] as const));
  const revised = [...after.values()].filter((input) => {
    const previous = before.get(input.documentId);
    return previous !== undefined && previous.inputSha256 !== input.inputSha256;
  });
  if (revised.length !== 1) {
    throw new Error(`explore_change_expects_one_revised_document: found ${revised.length}`);
  }
  const afterInput = revised[0];
  const beforeInput = before.get(afterInput.documentId)!;
  if (before.size !== after.size || [...after.keys()].some((id) => !before.has(id))) {
    throw new Error("explore_change_corpus_membership_changed");
  }
  return { beforeInput, afterInput };
}

/**
 * The region the revision rewrote.
 *
 * Paired by reading order, because these are two revisions of one page rather than two
 * documents. Of the regions whose text moved, the one this Act is about is the one whose stated
 * quantities moved with it -- a reissue that renames itself is not the change a maintenance
 * planner is asking about, and the interval is. Exactly one region may qualify; if the fixture
 * ever grows a second, this throws instead of silently picking the first.
 */
function findChangedRegion(beforeInput: CollectionOcrInput, afterInput: CollectionOcrInput) {
  const before = regionsOf(beforeInput);
  const after = regionsOf(afterInput);
  if (before.length !== after.length) {
    throw new Error("explore_change_region_count_changed");
  }
  const candidates = after.flatMap((region, index) => {
    const previous = before[index];
    if (previous.order !== region.order) throw new Error("explore_change_region_order_misaligned");
    if (previous.text === region.text) return [];
    if (quantities(previous.text) === quantities(region.text)) return [];
    return [{ before: previous, after: region }];
  });
  if (candidates.length !== 1) {
    throw new Error(`explore_change_expects_one_restated_quantity: found ${candidates.length}`);
  }
  const pair = candidates[0];
  if (pair.before.pageNumber1 !== pair.after.pageNumber1) {
    throw new Error("explore_change_region_moved_pages");
  }
  return pair;
}

const revised = findRevisedDocument();
const changedRegion = findChangedRegion(revised.beforeInput, revised.afterInput);
const diff = diffWorldVersions(exploreSampleRevisionBWorld, exploreSampleWorld);

/*
  Which objects the revision reached, and which it did not.

  Read-model object ids are content-derived, so an object that survives a revision unchanged
  keeps its id in both worlds and an object the revision rewrote does not. That makes the four
  counts a partition rather than four separate measurements: every object of the revision-C
  world is either rebuilt, added, or untouched, and every object of the revision-B world is
  either rebuilt, removed, or untouched. `explore-change.test.ts` asserts both sums.

  `rebuilt` is deliberately the narrow number -- objects present in both worlds whose compiled
  fields differ -- and it sits beside `added` and `removed` rather than absorbing them. Rolling
  the three into one "recompiled" figure would be a bigger, friendlier number that no longer
  says which of three different things happened.

  A consequence worth knowing before anyone writes a caption over these numbers: this compiler
  addresses objects by their content, so a claim whose wording changed is not the same object
  with a new field -- it is a removal and an addition. `rebuilt` is therefore small, and on this
  fixture it is zero, while `added` and `removed` carry the work the revision caused. "0
  rebuilt" is a true statement about in-place mutation and a false summary of the change; the
  three numbers have to be read together, or the Act should read `added` and `removed` and leave
  `rebuilt` to the technical drawer.
*/
const beforeIds = new Set(exploreSampleRevisionBWorld.objects.map((object) => object.id));
const afterIds = new Set(exploreSampleWorld.objects.map((object) => object.id));
const rebuiltIds = new Set(diff.objects.changed.map((object) => object.id));
const untouchedNodeIds = [...afterIds].filter((id) => beforeIds.has(id) && !rebuiltIds.has(id)).sort();
const affectedNodeIds = [
  ...new Set([
    ...diff.objects.added.map((object) => object.id),
    ...diff.objects.removed.map((object) => object.id),
    ...diff.objects.changed.map((object) => object.id),
  ]),
].sort();

export const exploreChangeStory: ExploreChangeStory = {
  before: {
    label: "Revision B",
    manifestDigest: exploreSampleRevisionBWorld.world.manifestDigest,
    documentIds: documentIdsOf(exploreSampleRevisionBInputs),
  },
  after: {
    label: "Revision C",
    manifestDigest: exploreSampleWorld.world.manifestDigest,
    documentIds: documentIdsOf(exploreSampleInputs),
  },
  sourceChange: {
    documentId: revised.afterInput.documentId,
    filename: revised.afterInput.sanitizedKey.slice(revised.afterInput.sanitizedKey.lastIndexOf("/") + 1),
    page: changedRegion.after.pageNumber1,
    before: { excerpt: changedRegion.before.text, bbox1000: changedRegion.before.bbox1000 },
    after: { excerpt: changedRegion.after.text, bbox1000: changedRegion.after.bbox1000 },
  },
  diff,
  counts: {
    rebuilt: diff.objects.changed.length,
    added: diff.objects.added.length,
    removed: diff.objects.removed.length,
    untouched: untouchedNodeIds.length,
  },
  affectedNodeIds,
  untouchedNodeIds,
  /*
    No equivalence claim on this deployment.

    `EquivalenceReport` lives in the Core (`akc_cir.recompilation`), not in this repository, and
    nothing here has run it over this fixture. The Act says what the comparison is instead of
    showing a badge for a check that did not happen.
  */
  equivalence: {
    state: "not_yet",
    /*
      Read on the page directly after `EXPLORE_COPY.equivalenceLead`, which already says both
      revisions were fully compiled. Saying it again here ran the two into one paragraph that
      repeated itself, so this states only what the lead does not.
    */
    reason:
      "Full-rebuild equivalence is a separate check, run by the compiler core over a selective rebuild; no receipt from it is wired into this deployment.",
  },
};

/**
 * The two files behind the comparison, for the pane that puts the source page on screen.
 *
 * Separate from `ExploreChangeStory` on purpose: that type is the interface other lanes read,
 * and it names one document rather than one file per side. The revised document has two files
 * because it has two revisions, and the Act needs both hrefs.
 */
export const exploreChangeSourceFiles = {
  before: exploreSampleRevisionBDocuments.find((document) => document.documentId === revised.beforeInput.documentId)!,
  after: exploreSampleDocuments.find((document) => document.documentId === revised.afterInput.documentId)!,
};
