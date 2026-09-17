import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseExploreEntryProof, excerptPreview } from "./explore-entry-proof";
import {
  EXPLORE_SAMPLE_DIGEST,
  exploreSampleDocuments,
  exploreSampleSnapshots,
  exploreSampleSources,
  exploreSampleWorld,
} from "./explore-sample";
import { toVisualWorldModel } from "./visual-world-model";

/*
  The shared proof card on solution and entry pages.
  Node tests verify the frozen source data and its rendering contract. Playwright verifies
  the actual displayed passage, selected region, evidence deep link and layout together.
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
    expect(region!.excerpt.trim().length).toBeGreaterThanOrEqual(100);
    expect(region!.page).toBeGreaterThan(2);
    expect(region!.bbox1000).toHaveLength(4);
    expect(region!.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("opens on the same region /explore does", () => {
    expect(chooseExploreEntryProof(world.evidence, [])!.id).toBe(region!.id);
  });

  it("quotes the selected source instead of treating a claim reference as verified support", () => {
    const preview = excerptPreview(region!.excerpt, 180).text;
    expect(preview.trim().length).toBeGreaterThan(80);
    expect(preview.replace(/\s+/g, " ").slice(0, 80))
      .toBe(region!.excerpt.replace(/\s+/g, " ").slice(0, 80));
    expect(source).toContain("excerptPreview(region.excerpt, 180)");
    expect(source).toContain('data-proof-kind="source-passage"');
    expect(source).toContain('data-evidence-id={region.id}');
    /* BQ-072: a cut excerpt says so, with a real ellipsis rather than a bare stop mid-sentence. */
    expect(source).toContain('{preview.truncated ? "…" : ""}');
    // A matching evidenceRefs ID did not establish that the old document-heading Claim
    // was supported by this business-description passage. Do not restore that shortcut.
    expect(source).not.toContain("excerptPreview(claim.label");
    expect(source).not.toContain("<span>Compiled claim</span>");
  });

  it("links to the displayed region, not an unrelated default World entry", () => {
    expect(source).toContain('pathname: "/explore"');
    expect(source).toContain('act: "evidence", evidence: region.id');
    expect(source).toContain("activeId={region.id}");
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
    expect(source).toContain('from "@/components/world-visual/source-sheet"');
  });

  /*
    BQ-076. The block's styling moved out of two global polish sheets into its own module, which
    is what ended the card-inside-a-card-inside-a-card with three different radii. The guard moves
    with it: it is the same rule, read where the rule now lives.
  */
  it("keeps the one link a thumb has to hit at the 44px floor", () => {
    const css = readFileSync(join(process.cwd(), "components/solution-proof-sample.module.css"), "utf8");
    for (const selector of [".head a {", ".excerptFoot a {"]) {
      const rule = css.slice(css.indexOf(selector));
      expect(rule.slice(0, rule.indexOf("}")), selector).toContain("min-height: 44px");
    }
  });

  /*
    BQ-014. The proof is staged in handoff §4.4 order: the page first and largest, then the region
    cut out of it, then the passage read from that region, then what it supports, then the way
    through to the World. The order is the argument -- a version that opens on extracted text has
    not made the claim it exists to make -- so it is guarded as an order, not as a set of parts.
  */
  it("stages the five beats in §4.4 order, page first", () => {
    const canonical = source.slice(source.indexOf('data-proof-variant="canonical"'));
    const beats = [
      "<SourceSheet regions={onPage}",
      "Objects compiled from this region",
      "styles.counts",
    ].map((beat) => canonical.indexOf(beat));
    expect(beats.every((at) => at > -1), "a beat of the canonical staging is missing").toBe(true);
    expect([...beats].sort((a, b) => a - b)).toEqual(beats);
    // The page is never a tab peer of the text extracted from it again.
    expect(readFileSync(join(process.cwd(), "components/world-visual/source-sheet.tsx"), "utf8"))
      .not.toContain('role="tablist"');
  });

  /*
    BQ-019 / D4. One canonical staging, on the landing. Every other route names its own filing and
    links to the region instead of repeating the whole block, which is what made eight routes read
    as one template with different hero copy.
  */
  it("gives the repeating routes a variant that links rather than restages", () => {
    expect(source).toContain('data-proof-variant="excerpt"');
    expect(source).toContain('data-proof-variant="crop"');
    const solutions = readFileSync(join(process.cwd(), "app/solutions/[slug]/page.tsx"), "utf8");
    expect(solutions).toContain('<SolutionProofSample pick={solution.proof} variant="excerpt" />');
    const read = readFileSync(join(process.cwd(), "app/product/document-understanding/page.tsx"), "utf8");
    expect(read).toContain('variant="crop"');
    // BQ-077: and at the content width, not inside the 420px title rail.
    expect(read).toContain("proofStyles.fullWidth");
  });
});
