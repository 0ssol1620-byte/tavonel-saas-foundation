import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  exploreChangeBaselineDocument,
  exploreChangeStory,
  exploreChangeTimeline,
} from "./explore-change";
import {
  EXPLORE_SAMPLE_BASELINE_DIGEST,
  EXPLORE_SAMPLE_DIGEST,
  exploreSampleBaselineInputs,
  exploreSampleBaselineWorld,
  exploreSampleInputs,
  exploreSampleSnapshots,
  exploreSampleWorld,
} from "./explore-sample";
import { countChanges, diffWorldVersions } from "./world-version-diff";

/*
  The Change Act's numbers, checked against the two compiles they came from.

  The failure this guards against is the one the Act invites: a persuasive carry-over number is
  easy to type and hard to distinguish from a derived one. Every count is therefore re-derived
  here from `diff`, and the two sums below are asserted as a partition: an object of either World
  is rebuilt, added, removed or unchanged, and no object is two of those.

  The other half is the sample's own honesty. The Act compares two *full* compiles. It is not a
  selective-recompilation result and it is not an equivalence proof, and the last tests in this
  file are what stop it becoming one by accident.
*/

const sampleDirectory = fileURLToPath(new URL("../public/explore-sample/", import.meta.url));
const story = exploreChangeStory;

describe("the two sides are complete compiles of one growing corpus", () => {
  it("names the frozen digest of each snapshot", () => {
    expect(story.after.manifestDigest).toBe(EXPLORE_SAMPLE_DIGEST);
    expect(story.before.manifestDigest).toBe(EXPLORE_SAMPLE_BASELINE_DIGEST);
    expect(story.before.manifestDigest).not.toBe(story.after.manifestDigest);
  });

  it("grows the document set rather than revising it, so the diff has one cause", () => {
    const before = new Map(exploreSampleBaselineInputs.map((input) => [input.documentId, input] as const));
    // Every document W0 compiled is still in W4, byte for byte. The change is arrival, not edit.
    for (const [documentId, input] of before) {
      const carried = exploreSampleInputs.find((item) => item.documentId === documentId);
      expect(carried, documentId).toBeTruthy();
      expect(carried!.inputSha256, documentId).toBe(input.inputSha256);
    }
    const arrivedIds = exploreSampleInputs
      .filter((input) => !before.has(input.documentId))
      .map((input) => input.documentId)
      .sort();
    expect(story.arrivals.map((arrival) => arrival.documentId).sort()).toEqual(arrivedIds);
    expect(story.arrivals.length).toBeGreaterThan(0);
  });

  it("compiled both sides from files that are in the repository", () => {
    for (const filename of [
      exploreChangeBaselineDocument.filename,
      ...story.arrivals.map((arrival) => arrival.filename),
    ]) {
      expect(existsSync(`${sampleDirectory}${filename}`), filename).toBe(true);
    }
    expect(story.before.documentIds).not.toEqual(story.after.documentIds);
    expect(story.after.documentIds).toEqual(expect.arrayContaining(story.before.documentIds));
  });
});

describe("each arrival is a filing, opened on a region of itself", () => {
  it("reads its form, dates and accession off the acquisition record", () => {
    for (const arrival of story.arrivals) {
      expect(arrival.form, arrival.documentId).toBeTruthy();
      expect(arrival.filingDate, arrival.documentId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(arrival.reportDate, arrival.documentId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(arrival.accession, arrival.documentId).toMatch(/^\d{10}-\d{2}-\d{6}$/);
      expect(arrival.label).toBe(`${arrival.form} · filed ${arrival.filingDate}`);
    }
  });

  it("is listed oldest first, so the Act reads as a timeline", () => {
    const dates = story.arrivals.map((arrival) => arrival.filingDate);
    expect(dates).toEqual([...dates].sort());
  });

  it("says reference render where the compiler read a reference render", () => {
    /*
      §11.3, and the assertion that makes it a rule rather than an intention: a 2026 filing's
      acquired original is an HTML primary document, so the bytes the compiler read cannot be
      described as the original. Every arrival on this corpus is a rendered one.
    */
    for (const arrival of story.arrivals) {
      expect(arrival.representationKind, arrival.documentId).toBe("reference_render");
    }
    expect(exploreChangeBaselineDocument.representationKind).toBe("original");
  });

  it("quotes its region verbatim, with the geometry the extractor read", () => {
    for (const arrival of story.arrivals) {
      const input = exploreSampleInputs.find((item) => item.documentId === arrival.documentId)!;
      expect(input.text).toContain(arrival.excerpt);
      const region = input.regions!.find((item) => item.text === arrival.excerpt);
      expect(region, arrival.documentId).toBeTruthy();
      expect(arrival.bbox1000).toEqual(region!.bbox1000);
      expect(region!.pageNumber1).toBe(arrival.page);
      const [left, top, right, bottom] = arrival.bbox1000;
      expect(left).toBeLessThan(right);
      expect(top).toBeLessThan(bottom);
      expect(bottom).toBeLessThanOrEqual(1000);
      expect(arrival.page).toBeLessThanOrEqual(arrival.pageCount);
    }
  });

  it("shows a region the baseline World does not contain", () => {
    // The point of the Act: this text is in W4 and was not in W0.
    const baselineText = exploreSampleBaselineInputs.map((input) => input.text).join("\n");
    for (const arrival of story.arrivals) {
      expect(baselineText.includes(arrival.excerpt), arrival.documentId).toBe(false);
    }
  });

  /*
    BA-031. Three of the four cards quoted the identical Section 12(b) registration block, because
    the rule was "longest new region on the first new page" and an SEC filing's first new page is
    its cover. The page whose whole purpose is to show a claim resolving to a meaningful region
    was proving it with the least meaningful text in the corpus.

    What follows asserts the properties the new rule buys rather than the four strings it happens
    to produce today: pinning the quotes would freeze a presentation rule into four sentences, and
    a fixture that legitimately changes must still land on readable regions.
  */
  it("quotes each filing on text only that filing carries", () => {
    const excerpts = story.arrivals.map((arrival) => arrival.excerpt);
    expect(new Set(excerpts).size, "two cards quote the same text").toBe(excerpts.length);
    for (const arrival of story.arrivals) {
      const others = exploreSampleInputs
        .filter((input) => input.documentId !== arrival.documentId)
        .map((input) => input.text)
        .join("\n");
      expect(others.includes(arrival.excerpt), arrival.documentId).toBe(false);
    }
  });

  it("quotes a statement the reader can check, not the filing's cover", () => {
    for (const arrival of story.arrivals) {
      expect(arrival.excerpt, arrival.documentId).not.toMatch(
        /[☒☐]|PURSUANT TO SECTION|Check the appropriate box|Commission File|IRS Employer|Securities registered pursuant/i,
      );
      // Three figures a reader can carry back to the filing and check against it.
      const figures = arrival.excerpt.match(/\$\s?[0-9][0-9,]{2,}|[0-9]{1,3}(?:,[0-9]{3})+/g) ?? [];
      expect(figures.length, `${arrival.documentId}: ${arrival.excerpt.slice(0, 80)}`)
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("still selects by structure alone, with no phrase in the rule", () => {
    /*
      The failure path this file most needs after BA-031. A selector that looked for "Net sales"
      or "Operating income" would produce good-looking cards on this corpus and the wrong region
      on any other, and it would turn a presentation choice into a claim about which paragraph
      matters. The cover-sheet and figure filters are document structure; nothing else here may be
      a content test.
    */
    const source = readFileSync(fileURLToPath(new URL("./explore-change.ts", import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    for (const phrase of ["Net sales", "Operating income", "Total net sales", "Risk Factor"]) {
      expect(source, `the selector reads "${phrase}" out of the filing`).not.toContain(phrase);
    }
  });
});

describe("the counts are derived from the diff", () => {
  it("restates the diff rather than summarising it", () => {
    expect(story.counts.rebuilt).toBe(story.diff.objects.changed.length);
    expect(story.counts.added).toBe(story.diff.objects.added.length);
    expect(story.counts.removed).toBe(story.diff.objects.removed.length);
    expect(story.counts.untouched).toBe(story.untouchedNodeIds.length);
    expect(countChanges(story.diff)).toBeGreaterThan(0);
    expect(story.diff.identical).toBe(false);
  });

  it("partitions both Worlds, leaving no object unaccounted for", () => {
    const { rebuilt, added, removed, untouched } = story.counts;
    expect(rebuilt + added + untouched).toBe(exploreSampleWorld.objects.length);
    expect(rebuilt + removed + untouched).toBe(exploreSampleBaselineWorld.objects.length);
  });

  it("reports one new source version per arriving filing, and none removed", () => {
    expect(story.diff.sourceRevisions.added.length).toBe(story.arrivals.length);
    expect(story.diff.sourceRevisions.removed).toEqual([]);
    expect(story.diff.sourceRevisions.unchanged).toBe(exploreSampleBaselineInputs.length);
  });

  it("contains a measured change and keeps the identities that survived it", () => {
    expect(story.counts.added + story.counts.removed + story.counts.rebuilt).toBeGreaterThan(0);
    // Arrivals add; nothing here deletes an object the annual filing supported on its own.
    expect(story.counts.removed).toBe(0);
    expect(story.counts.untouched).toBeGreaterThan(0);
  });
});

describe("every id the Act will highlight exists in a compiled World", () => {
  const beforeIds = new Set(exploreSampleBaselineWorld.objects.map((object) => object.id));
  const afterIds = new Set(exploreSampleWorld.objects.map((object) => object.id));

  it("resolves every affected id to an object of one World or the other", () => {
    expect(story.affectedNodeIds.length).toBeGreaterThan(0);
    for (const id of story.affectedNodeIds) {
      expect(beforeIds.has(id) || afterIds.has(id), id).toBe(true);
    }
    for (const object of story.diff.objects.added) expect(afterIds.has(object.id) && !beforeIds.has(object.id)).toBe(true);
    for (const object of story.diff.objects.removed) expect(beforeIds.has(object.id) && !afterIds.has(object.id)).toBe(true);
    for (const object of story.diff.objects.changed) expect(beforeIds.has(object.id) && afterIds.has(object.id)).toBe(true);
  });

  it("resolves every untouched id to an object of both Worlds", () => {
    for (const id of story.untouchedNodeIds) {
      expect(beforeIds.has(id), id).toBe(true);
      expect(afterIds.has(id), id).toBe(true);
    }
  });

  it("never calls the same object both affected and untouched", () => {
    const affected = new Set(story.affectedNodeIds);
    expect(story.untouchedNodeIds.filter((id) => affected.has(id))).toEqual([]);
    expect(new Set(story.affectedNodeIds).size).toBe(story.affectedNodeIds.length);
    expect(new Set(story.untouchedNodeIds).size).toBe(story.untouchedNodeIds.length);
  });
});

describe("the timeline walks the five snapshots one filing at a time", () => {
  it("is four steps that chain W0 to W4 without skipping a World", () => {
    expect(exploreChangeTimeline).toHaveLength(4);
    expect(exploreChangeTimeline.map((step) => step.id)).toEqual(["w1", "w2", "w3", "w4"]);
    expect(exploreChangeTimeline[0].fromDigest).toBe(EXPLORE_SAMPLE_BASELINE_DIGEST);
    expect(exploreChangeTimeline[3].toDigest).toBe(EXPLORE_SAMPLE_DIGEST);
    // A gap here would be a path drawn through a World the corpus never passed through.
    for (let index = 1; index < exploreChangeTimeline.length; index += 1) {
      expect(exploreChangeTimeline[index].fromDigest, exploreChangeTimeline[index].id)
        .toBe(exploreChangeTimeline[index - 1].toDigest);
    }
    /*
      The order is §24's declared sequence -- 10-K, Q1, DEF 14A, Q2, Q3 -- and that is a
      reporting-period order, not a filing-date order. Apple filed the 2026 proxy on 2026-01-08,
      three weeks *before* the Q1 10-Q it follows here. The Act's arrival cards are sorted by
      filing date because they answer "what arrived"; the timeline is not, because it answers
      "which World came next", and asserting monotonic filing dates here would be asserting
      something about Apple's filing calendar that is not true.
    */
    expect(exploreChangeTimeline.map((step) => step.arrival.documentId)).toEqual([
      "apple-2026-q1-10-q",
      "apple-2026-proxy-def14a",
      "apple-2026-q2-10-q",
      "apple-2026-q3-10-q",
    ]);
    expect(exploreChangeTimeline.map((step) => step.arrival.filingDate))
      .toEqual(["2026-01-30", "2026-01-08", "2026-05-01", "2026-07-31"]);
    // Every step's arrival is a filing W4 actually compiled, and the two lists cover each other.
    expect([...exploreChangeTimeline.map((step) => step.arrival.documentId)].sort())
      .toEqual([...story.arrivals.map((arrival) => arrival.documentId)].sort());
  });

  it("derives every step count from its own diff, and adds exactly one source version", () => {
    for (const [index, step] of exploreChangeTimeline.entries()) {
      const before = exploreSampleSnapshots[index].world;
      const after = exploreSampleSnapshots[index + 1].world;
      const diff = diffWorldVersions(before, after);
      expect(step.objects.added, step.id).toBe(diff.objects.added.length);
      expect(step.objects.rebuilt, step.id).toBe(diff.objects.changed.length);
      expect(step.objects.removed, step.id).toBe(diff.objects.removed.length);
      expect(step.relations.added, step.id).toBe(diff.relations.added.length);
      expect(step.evidenceRegions.added, step.id).toBe(diff.evidence.added.length);
      // One arriving filing is one new source version, at every step and not only end to end.
      expect(step.sourceRevisions.added, step.id).toBe(1);
      expect(step.sourceRevisions.removed, step.id).toBe(0);
      // The partition holds per step exactly as it does across the whole change.
      expect(step.objects.rebuilt + step.objects.added + step.objects.untouched, step.id)
        .toBe(after.objects.length);
      expect(step.objects.rebuilt + step.objects.removed + step.objects.untouched, step.id)
        .toBe(before.objects.length);
    }
  });

  it("reports the whole World as recompiled at every step, because it was", () => {
    /*
      §25.3. This deployment's compiler has no incremental path: every snapshot is a complete
      compile of its corpus. `recompiledObjects === objectsAfter` is that fact in a number, and
      the day a selective rebuild does run here it will be a receipt that moves this assertion,
      not a copy edit.
    */
    for (const [index, step] of exploreChangeTimeline.entries()) {
      expect(step.recompiledObjects, step.id).toBe(step.objectsAfter);
      expect(step.objectsAfter, step.id).toBe(exploreSampleSnapshots[index + 1].world.objects.length);
      // A step that recompiled everything still reports a smaller number of objects it changed.
      expect(step.objects.rebuilt, step.id).toBeLessThan(step.objectsAfter);
    }
  });
});

describe("the sample does not claim more than it ran", () => {
  it("reports equivalence as not_yet, with a reason", () => {
    expect(story.equivalence.state).toBe("not_yet");
    if (story.equivalence.state !== "not_yet") throw new Error("unreachable");
    expect(story.equivalence.reason.length).toBeGreaterThan(40);
    // No badge, and no word that reads like one on a page that never ran the check.
    expect(story.equivalence.reason).not.toMatch(/\bpass(ed)?\b/i);
    expect(story.equivalence.reason).not.toMatch(/\bprove[sd]?\b/i);
  });

  it("states no provenance value of its own", () => {
    /*
      The same regression `explore-sample.test.ts` guards on the component. A digest or a
      bounding box written as a literal in this module would be a number nothing verified,
      sitting in the one file whose whole purpose is that its numbers were computed.
    */
    const source = readFileSync(fileURLToPath(new URL("./explore-change.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/sha256:[0-9a-f]{8}/);
    expect(source).not.toMatch(/\[\s*\d{2,},\s*\d{2,},\s*\d{2,},\s*\d{2,}\s*\]/);
  });
});
