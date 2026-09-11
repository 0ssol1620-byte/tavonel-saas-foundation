import type { CollectionOcrInput, CollectionOcrRegion } from "./collection-compiler";
import {
  exploreSampleBaselineInputs,
  exploreSampleBaselineWorld,
  exploreSampleDocuments,
  exploreSampleInputs,
  exploreSampleSnapshots,
  exploreSampleWorld,
} from "./explore-sample";
import { diffWorldVersions, type WorldVersionDiff } from "./world-version-diff";

/*
  What arriving filings did to a Compiled World.

  The Change Act asks the hardest question the product makes, and it now asks the temporal form
  of it: a year of new public filings landed on top of an annual report -- what did the World do
  about it? The honest answer can only come from two complete compiles, so that is what this is.
  `lib/explore-sample.ts` compiles Apple's 2025 Form 10-K alone (W0) and the same 10-K together
  with the four 2026 filings that followed it (W4), and everything below is read out of those
  two artifacts by `diffWorldVersions`. No count here was typed. No count here could be typed:
  change either snapshot and the frozen digests in `explore-sample.ts` refuse the build before
  this module runs.

  Two things this deliberately does not do.

  It does not claim full-rebuild equivalence. Both sides are full compiles, so the comparison
  proves that the two Worlds differ in the ways reported -- not that a *selective* rebuild would
  have reached the same World as a full one. That is a different experiment, it needs the Core's
  `verify_equivalence`, and until a receipt from it is wired in here, `equivalence` says `not_yet`
  and the Act renders without a badge.

  And it does not describe an arrival as a revision. Nothing in the 2025 10-K was reissued: four
  new documents joined the corpus. `sourceRevisions.added` is therefore four new source versions
  with none removed, and the Act says a filing arrived rather than that a filing changed.
*/

export type ExploreChangeArrival = {
  documentId: string;
  /** The filing as a reader names it: form and filing date, both from the acquisition record. */
  label: string;
  form: string;
  filingDate: string;
  reportDate: string;
  accession: string;
  /** The bytes the compiler read -- a reference render for every 2026 filing. */
  filename: string;
  href: string;
  digest: string;
  representationKind: "original" | "reference_render";
  pageCount: number;
  regionCount: number;
  page: number;
  excerpt: string;
  bbox1000: [number, number, number, number];
};

export type ExploreChangeStory = {
  before: { label: string; manifestDigest: string; documentIds: string[] };
  after: { label: string; manifestDigest: string; documentIds: string[] };
  /** The filings W4 has and W0 does not, oldest first. */
  arrivals: ExploreChangeArrival[];
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
  return [...(input.regions ?? [])].sort((left, right) => left.order - right.order);
}

/**
 * The filings W4 compiled that W0 did not.
 *
 * Membership only. A document present in both must be byte-identical in both, or this is not an
 * arrival story at all and the Act would be narrating the wrong event; that case throws rather
 * than being reported as an addition. So does a baseline document that W4 dropped.
 */
function findArrivals() {
  const before = new Map(exploreSampleBaselineInputs.map((input) => [input.documentId, input] as const));
  for (const input of exploreSampleInputs) {
    const previous = before.get(input.documentId);
    if (previous && previous.inputSha256 !== input.inputSha256) {
      throw new Error(`explore_change_carried_document_moved: ${input.documentId}`);
    }
  }
  const missing = [...before.keys()].filter((documentId) =>
    !exploreSampleInputs.some((input) => input.documentId === documentId));
  if (missing.length > 0) throw new Error(`explore_change_baseline_document_dropped: ${missing.join(",")}`);
  const arrived = exploreSampleInputs.filter((input) => !before.has(input.documentId));
  if (arrived.length === 0) throw new Error("explore_change_expects_at_least_one_arriving_filing");
  return arrived;
}

/**
 * The one region of an arriving filing the Act puts on screen.
 *
 * A presentation choice, and a deliberately dumb one so that it stays a choice about layout
 * rather than about meaning: the longest region on the first compiled page that carries text the
 * baseline World did not already have. Nothing here reads a number, a phrase or a page out of
 * the filing to decide, so a different corpus shows a different region rather than the wrong one.
 *
 * The "not already in W0" clause earns its place. An SEC filing opens on a cover sheet, and now
 * that W0 is the whole 2025 Form 10-K instead of three of its pages, the longest line on a
 * 10-Q's cover -- the Commission's own address block -- is text the baseline already contained.
 * An arrival card answers "what arrived", so quoting a line that did not arrive would be the
 * wrong answer told convincingly. `explore-change.test.ts` asserts exactly this property.
 */
function openingRegion(input: CollectionOcrInput, baselineText: string): CollectionOcrRegion {
  const regions = regionsOf(input);
  if (regions.length === 0) throw new Error(`explore_change_document_has_no_regions: ${input.documentId}`);
  const arrived = regions.filter((region) => !baselineText.includes(region.text));
  if (arrived.length === 0) throw new Error(`explore_change_arrival_adds_no_text: ${input.documentId}`);
  const firstPage = Math.min(...arrived.map((region) => region.pageNumber1));
  return arrived
    .filter((region) => region.pageNumber1 === firstPage)
    .reduce((longest, region) => (region.text.length > longest.text.length ? region : longest));
}

const baselineText = exploreSampleBaselineInputs.map((input) => input.text).join("\n");

function arrivalOf(input: CollectionOcrInput): ExploreChangeArrival {
  const document = exploreSampleDocuments.find((entry) => entry.documentId === input.documentId);
  if (!document?.form || !document.filingDate || !document.reportDate || !document.accession) {
    throw new Error(`explore_change_arrival_has_no_source_record: ${input.documentId}`);
  }
  const region = openingRegion(input, baselineText);
  return {
    documentId: input.documentId,
    label: `${document.form} · filed ${document.filingDate}`,
    form: document.form,
    filingDate: document.filingDate,
    reportDate: document.reportDate,
    accession: document.accession,
    filename: document.filename,
    href: document.href,
    digest: document.digest,
    representationKind: document.representationKind ?? "original",
    pageCount: document.pageCount,
    regionCount: document.regionCount,
    page: region.pageNumber1,
    excerpt: region.text,
    bbox1000: region.bbox1000,
  };
}

const arrivals = findArrivals()
  .map(arrivalOf)
  .sort((left, right) => left.filingDate.localeCompare(right.filingDate));
const diff = diffWorldVersions(exploreSampleBaselineWorld, exploreSampleWorld);

/*
  Which objects the arrivals reached, and which they did not.

  Read-model object ids are content-derived, so an object that survives unchanged keeps its id in
  both Worlds and an object the arrivals rewrote does not. That makes the four counts a partition
  rather than four separate measurements: every object of W4 is either rebuilt, added or
  untouched, and every object of W0 is either rebuilt, removed or untouched.
  `explore-change.test.ts` asserts both sums.

  `rebuilt` is deliberately the narrow number -- objects present in both Worlds whose compiled
  fields differ -- and it sits beside `added` and `removed` rather than absorbing them. On this
  corpus it is the interesting one: a Topic the annual filing already carried is still the same
  object after four filings arrive, now with more evidence and more relations under it. Rolling
  the three counts into one friendlier "recompiled" figure would hide exactly that.
*/
const beforeIds = new Set(exploreSampleBaselineWorld.objects.map((object) => object.id));
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
    label: "2025 Form 10-K",
    manifestDigest: exploreSampleBaselineWorld.world.manifestDigest,
    documentIds: documentIdsOf(exploreSampleBaselineInputs),
  },
  after: {
    label: "2025 Form 10-K + four 2026 filings",
    manifestDigest: exploreSampleWorld.world.manifestDigest,
    documentIds: documentIdsOf(exploreSampleInputs),
  },
  arrivals,
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
    No equivalence claim here.

    `EquivalenceReport` lives in the Core (`akc_cir.recompilation`), not in this repository, and
    nothing here has run it over this corpus. The Act says what the comparison is instead of
    showing a badge for a check that did not happen.
  */
  equivalence: {
    state: "not_yet",
    /*
      BA-028 took this sentence off the public act, where it was the last thing read before the
      sign-up action, and left it in the technical drawer -- which is the surface a reader opens
      to see machinery. Two words went with the move: "receipt" and "this deployment" are how we
      describe our own wiring, not what the sentence is about. What it is about is that the
      comparison on screen is between two whole compiles, so a selective-rebuild check has
      nothing here to check.
    */
    reason:
      "Full-rebuild equivalence is a separate check the compiler core runs over a selective rebuild. Both sides of this comparison are complete compiles, so there is no selective result for it to compare.",
  },
};

/* ------------------------------------------------------------ the five steps */

/**
 * One arrival, as the step that produced a World rather than as a card.
 *
 * `rebuilt` is the dependency-impact figure and is deliberately separate from `added`: an object
 * that the arriving filing *introduced* is not evidence that the filing reached anything, while
 * an object the previous World already carried whose compiled fields moved is exactly that.
 *
 * `recompiledObjects` and `objectsAfter` are equal at every step and the type keeps both anyway,
 * because that equality is the honest statement this deployment can make: the compiler in this
 * repository has no incremental path, so each snapshot is a complete compile of its corpus. A
 * type that carried only "objects changed" would let a reader infer a selective rebuild that did
 * not happen. §11.7 and §25.3.
 */
export type ExploreChangeStep = {
  id: string;
  from: string;
  to: string;
  fromDigest: string;
  toDigest: string;
  arrival: {
    documentId: string;
    label: string;
    form: string;
    filingDate: string;
    accession: string;
    pageCount: number;
    compiledPageCount: number;
    regionCount: number;
  };
  objects: { added: number; removed: number; rebuilt: number; untouched: number };
  relations: { added: number; removed: number; changed: number };
  evidenceRegions: { added: number; removed: number; changed: number };
  sourceRevisions: { added: number; removed: number; unchanged: number };
  /** Every object of the resulting World. Equal to `recompiledObjects` on this deployment. */
  objectsAfter: number;
  recompiledObjects: number;
};

function stepBetween(
  before: (typeof exploreSampleSnapshots)[number],
  after: (typeof exploreSampleSnapshots)[number],
): ExploreChangeStep {
  const arrived = after.inputs.filter((input) =>
    !before.inputs.some((previous) => previous.documentId === input.documentId));
  if (arrived.length !== 1) {
    throw new Error(`explore_change_step_expects_one_arrival: ${after.id}:${arrived.length}`);
  }
  const document = exploreSampleDocuments.find((entry) => entry.documentId === arrived[0].documentId);
  if (!document?.form || !document.filingDate || !document.accession) {
    throw new Error(`explore_change_step_arrival_has_no_source_record: ${arrived[0].documentId}`);
  }
  const diff = diffWorldVersions(before.world, after.world);
  if (diff.sourceRevisions.added.length !== 1) {
    // One arriving filing is one new source version, at every step and not only end to end.
    throw new Error(`explore_change_step_source_revisions_disagree: ${after.id}`);
  }
  const beforeIds = new Set(before.world.objects.map((object) => object.id));
  const rebuilt = new Set(diff.objects.changed.map((object) => object.id));
  const untouched = after.world.objects
    .filter((object) => beforeIds.has(object.id) && !rebuilt.has(object.id)).length;
  return {
    id: after.id,
    from: before.label,
    to: after.label,
    fromDigest: before.world.world.manifestDigest,
    toDigest: after.world.world.manifestDigest,
    arrival: {
      documentId: document.documentId,
      label: `${document.form} · filed ${document.filingDate}`,
      form: document.form,
      filingDate: document.filingDate,
      accession: document.accession,
      pageCount: document.pageCount,
      compiledPageCount: document.compiledPageCount,
      regionCount: document.regionCount,
    },
    objects: {
      added: diff.objects.added.length,
      removed: diff.objects.removed.length,
      rebuilt: diff.objects.changed.length,
      untouched,
    },
    relations: {
      added: diff.relations.added.length,
      removed: diff.relations.removed.length,
      changed: diff.relations.changed.length,
    },
    evidenceRegions: {
      added: diff.evidence.added.length,
      removed: diff.evidence.removed.length,
      changed: diff.evidence.changed.length,
    },
    sourceRevisions: {
      added: diff.sourceRevisions.added.length,
      removed: diff.sourceRevisions.removed.length,
      unchanged: diff.sourceRevisions.unchanged,
    },
    objectsAfter: after.world.objects.length,
    /*
      Not a placeholder for a number this deployment could report differently. Every snapshot in
      `exploreSampleSnapshots` is a full compile of its whole corpus, so the objects recompiled at
      each step are all of them. The Core's selective recompilation is a different execution with
      its own receipt, and no receipt from it is wired into this page.
    */
    recompiledObjects: after.world.objects.length,
  };
}

/**
 * W0 → W1 → W2 → W3 → W4, one entry per arriving filing (§24, §25.2).
 *
 * Four steps for five snapshots: the first World is a starting point, not a change. Every figure
 * is read out of a diff between two complete compiles whose digests are frozen, so a step cannot
 * report a change to a World that did not compile.
 */
export const exploreChangeTimeline: ExploreChangeStep[] = exploreSampleSnapshots
  .slice(1)
  .map((snapshot, index) => stepBetween(exploreSampleSnapshots[index], snapshot));

/**
 * The filing the arrivals landed on, for the pane that names the starting point.
 *
 * Separate from `ExploreChangeStory` because that type is the interface other modules read and
 * it speaks in document ids; the Act also needs the file's own name, href and page count.
 */
export const exploreChangeBaselineDocument = (() => {
  const documentId = exploreSampleBaselineInputs[0]?.documentId;
  const document = exploreSampleDocuments.find((entry) => entry.documentId === documentId);
  if (!document) throw new Error("explore_change_baseline_document_missing");
  return document;
})();
