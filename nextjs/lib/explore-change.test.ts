import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exploreChangeBaselineDocument, exploreChangeStory } from "./explore-change";
import {
  EXPLORE_SAMPLE_BASELINE_DIGEST,
  EXPLORE_SAMPLE_DIGEST,
  exploreSampleBaselineInputs,
  exploreSampleBaselineWorld,
  exploreSampleInputs,
  exploreSampleWorld,
} from "./explore-sample";
import { countChanges } from "./world-version-diff";

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
