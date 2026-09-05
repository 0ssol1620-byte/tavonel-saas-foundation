import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exploreChangeSourceFiles, exploreChangeStory } from "./explore-change";
import {
  EXPLORE_SAMPLE_DIGEST,
  EXPLORE_SAMPLE_REVISION_B_DIGEST,
  exploreSampleInputs,
  exploreSampleRevisionBInputs,
  exploreSampleRevisionBWorld,
  exploreSampleWorld,
} from "./explore-sample";
import { countChanges } from "./world-version-diff";

/*
  The Change Act's numbers, checked against the two compiles they came from.

  The failure this guards against is the one the Act invites. "3 knowledge objects rebuilt, 29
  untouched" is a sentence anybody can type, it is the most persuasive sentence on the site, and
  nothing on a rendered page distinguishes a derived count from a decorative one. So every count
  is re-derived here from `diff`, and the two sums below are asserted as a partition: an object
  of either world is rebuilt, added, removed or untouched, and no object is two of those.

  The other half is the sample's own honesty. The Act compares two *full* compiles. It is not a
  selective-recompilation result and it is not an equivalence proof, and the last test in this
  file is what stops it becoming one by accident.
*/

const sampleDirectory = fileURLToPath(new URL("../public/explore-sample/", import.meta.url));
const story = exploreChangeStory;

function inputFor<T extends { documentId: string }>(inputs: readonly T[], documentId: string): T {
  const input = inputs.find((item) => item.documentId === documentId);
  if (!input) throw new Error(`explore_change_test_no_input_for: ${documentId}`);
  return input;
}

describe("the two sides are complete compiles of the same corpus", () => {
  it("names the frozen digest of each world", () => {
    expect(story.after.manifestDigest).toBe(EXPLORE_SAMPLE_DIGEST);
    expect(story.before.manifestDigest).toBe(EXPLORE_SAMPLE_REVISION_B_DIGEST);
    expect(story.before.manifestDigest).not.toBe(story.after.manifestDigest);
  });

  it("holds the document set fixed so the diff has one cause", () => {
    expect(story.before.documentIds).toEqual(story.after.documentIds);
    const moved = story.after.documentIds.filter((documentId) =>
      inputFor(exploreSampleRevisionBInputs, documentId).inputSha256
        !== inputFor(exploreSampleInputs, documentId).inputSha256);
    expect(moved).toEqual([story.sourceChange.documentId]);
  });

  it("compiled both sides from files that are in the repository", () => {
    for (const file of [exploreChangeSourceFiles.before, exploreChangeSourceFiles.after]) {
      expect(existsSync(`${sampleDirectory}${file.filename}`), file.filename).toBe(true);
    }
    expect(exploreChangeSourceFiles.before.digest).not.toBe(exploreChangeSourceFiles.after.digest);
    expect(exploreChangeSourceFiles.before.documentId).toBe(exploreChangeSourceFiles.after.documentId);
  });
});

describe("the source change is a region of those files", () => {
  const before = inputFor(exploreSampleRevisionBInputs, story.sourceChange.documentId);
  const after = inputFor(exploreSampleInputs, story.sourceChange.documentId);

  it("quotes each side verbatim out of the document the compiler was given", () => {
    expect(before.text).toContain(story.sourceChange.before.excerpt);
    expect(after.text).toContain(story.sourceChange.after.excerpt);
    expect(story.sourceChange.before.excerpt).not.toBe(story.sourceChange.after.excerpt);
  });

  it("carries the geometry the extractor read, on the page it read it from", () => {
    for (const [side, input] of [
      [story.sourceChange.before, before],
      [story.sourceChange.after, after],
    ] as const) {
      const region = input.regions!.find((item) => item.text === side.excerpt);
      expect(region, side.excerpt.slice(0, 40)).toBeTruthy();
      expect(side.bbox1000).toEqual(region!.bbox1000);
      expect(region!.pageNumber1).toBe(story.sourceChange.page);
      const [left, top, right, bottom] = side.bbox1000;
      expect(left).toBeLessThan(right);
      expect(top).toBeLessThan(bottom);
      expect(bottom).toBeLessThanOrEqual(1000);
    }
  });

  it("is a restated quantity, which is what the Act says it is", () => {
    const digits = (value: string) => (value.match(/\d[\d.,]*/g) ?? []).join("|");
    expect(digits(story.sourceChange.before.excerpt)).not.toBe(digits(story.sourceChange.after.excerpt));
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

  it("partitions both worlds, leaving no object unaccounted for", () => {
    const { rebuilt, added, removed, untouched } = story.counts;
    expect(rebuilt + added + untouched).toBe(exploreSampleWorld.objects.length);
    expect(rebuilt + removed + untouched).toBe(exploreSampleRevisionBWorld.objects.length);
  });

  it("has something on both sides of the sentence it is used to write", () => {
    /*
      "Dependent knowledge was rebuilt; unrelated knowledge remained intact" is only a true
      caption while both halves are non-zero. A fixture that changed everything, or nothing,
      would render that sentence over numbers that contradict it.
    */
    expect(story.counts.untouched).toBeGreaterThan(0);
    expect(story.counts.added + story.counts.removed + story.counts.rebuilt).toBeGreaterThan(0);
  });
});

describe("every id the Act will highlight exists in a compiled world", () => {
  const beforeIds = new Set(exploreSampleRevisionBWorld.objects.map((object) => object.id));
  const afterIds = new Set(exploreSampleWorld.objects.map((object) => object.id));

  it("resolves every affected id to an object of one world or the other", () => {
    expect(story.affectedNodeIds.length).toBeGreaterThan(0);
    for (const id of story.affectedNodeIds) {
      expect(beforeIds.has(id) || afterIds.has(id), id).toBe(true);
    }
    for (const object of story.diff.objects.added) expect(afterIds.has(object.id) && !beforeIds.has(object.id)).toBe(true);
    for (const object of story.diff.objects.removed) expect(beforeIds.has(object.id) && !afterIds.has(object.id)).toBe(true);
    for (const object of story.diff.objects.changed) expect(beforeIds.has(object.id) && afterIds.has(object.id)).toBe(true);
  });

  it("resolves every untouched id to an object of both worlds", () => {
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
