import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseExploreEntryProof } from "./explore-entry-proof";
import {
  EXPLORE_SAMPLE_DIGEST,
  exploreSampleDocuments,
  exploreSampleSnapshots,
  exploreSampleSources,
  exploreSampleWorld,
} from "./explore-sample";
import { toVisualWorldModel } from "./visual-world-model";

/*
  The proof card on the five solution pages (BA-041, BA-043, BA-056).

  The vitest environment here is node, so this checks the two things that can actually go wrong
  without a DOM: the data the figure binds to, and the drawn anti-patterns coming back. Layout is
  the Playwright and screenshot pass's job.
*/
const source = readFileSync(
  join(process.cwd(), "components/solution-proof-sample.tsx"),
  "utf8",
);

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const region = chooseExploreEntryProof(world.evidence, []);

describe("solution proof sample", () => {
  it("binds to a real region a reader can actually read", () => {
    expect(region).not.toBeNull();
    // The whole point of the card is that the words inside the box are legible: a cover page or
    // a "Table of Contents" line is what the earlier fake page was captioned with.
    expect(region!.excerpt.trim().length).toBeGreaterThanOrEqual(100);
    expect(region!.page).toBeGreaterThan(2);
    expect(region!.bbox1000).toHaveLength(4);
    expect(region!.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("opens on the same region /explore does", () => {
    // Same chooser, so the proof a buyer sees here is the proof they land on there.
    expect(chooseExploreEntryProof(world.evidence, [])!.id).toBe(region!.id);
  });

  it("shows a claim the compiler bound to that region, or none at all", () => {
    const claim = world.nodes.find(
      (node) => node.kind === "Claim" && node.evidenceRefs.includes(region!.id),
    );
    expect(claim).toBeDefined();
    expect(claim!.label.trim().length).toBeGreaterThan(0);
    // The figure prints `claim.label` -- the object's own text. Nothing is authored for the page.
    expect(source).toContain("excerptPreview(claim.label");
  });

  it("prints only counts the compiled artifact holds", () => {
    expect(exploreSampleSources.length).toBe(5);
    expect(exploreSampleSources.reduce((total, item) => total + item.pageCount, 0)).toBe(290);
    expect(world.totals.regions).toBe(exploreSampleWorld.evidence.length);
    expect(exploreSampleSnapshots[0].id).toBe("w0");
    expect(exploreSampleSnapshots[exploreSampleSnapshots.length - 1].id).toBe("w4");
    expect(EXPLORE_SAMPLE_DIGEST.startsWith("sha256:aff67d5c6d0")).toBe(true);
  });

  it("never prints the candidate count as an object count", () => {
    // 6,300 is `validation.counts.candidatesConsidered`. It was published as "6,300 objects".
    expect(exploreSampleWorld.objects.length).not.toBe(6_300);
    expect(source).not.toContain("candidatesConsidered");
    expect(source).not.toMatch(/objects</);
  });

  it("draws nothing: no icon stack, no striped page, no dot grid, no timeline glow", () => {
    for (const banned of [
      "solution-proof-documents",
      "solution-proof-page",
      "solution-proof-object-map",
      "solution-proof-timeline",
      "<i />",
    ]) {
      expect(source, `${banned} is a drawn stand-in for evidence`).not.toContain(banned);
    }
    // The real surface, by import: a figure that stops rendering /explore's sheet has drifted.
    expect(source).toContain('from "@/components/world-visual/source-sheet"');
  });

  it("keeps the one link a thumb has to hit at the 44px floor", () => {
    const css = readFileSync(join(process.cwd(), "app/ux-polish.css"), "utf8");
    const rule = css.slice(css.indexOf(".solution-proof-sample-head a {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("min-height: 44px");
  });
});
