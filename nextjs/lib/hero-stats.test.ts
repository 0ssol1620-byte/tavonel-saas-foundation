import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HERO_STATS } from "./hero-stats";
import { HERO_PROOF_COPY } from "./hero-proof-copy";
import {
  EXPLORE_SAMPLE_DIGEST,
  exploreSampleDocuments,
  exploreSampleWorld,
} from "./explore-sample";
import { toVisualWorldModel } from "./visual-world-model";

/*
  THE VALIDATOR FOR GAP #9.

  The point of the stat strip is that its four numbers are not marketing figures: each one is
  recomputed here, a second time, from the compiled artifact, and this file fails the build the
  day the strip and the World disagree. That is the difference between "1,281 evidence regions"
  and a competitor's "5,000,000,000 pages" -- not the size of the number, the receipt behind it.

  It also holds the three things the gap document says the strip must not become: a rounded
  number, an estimate, and a figure with no surface a reader can go and count it on.
*/

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const stat = (id: (typeof HERO_STATS)[number]["id"]) => {
  const found = HERO_STATS.find(entry => entry.id === id);
  expect(found, `no stat is keyed ${id}`).toBeTruthy();
  return found!;
};

describe("the home hero's stat strip", () => {
  it("prints exactly what the compiled public World holds, recomputed here", () => {
    /* Filings: one per document record in the sample World, counted again rather than read. */
    let filings = 0;
    for (const _document of exploreSampleDocuments) filings += 1;
    expect(stat("filings").value).toBe(filings.toLocaleString("en-US"));

    /* Pages: both numbers, never one -- what the World compiled over what the filings contain. */
    const compiled = exploreSampleDocuments
      .map(document => document.compiledPageCount ?? document.pageCount)
      .reduce((a, b) => a + b, 0);
    const filed = exploreSampleDocuments.map(document => document.pageCount).reduce((a, b) => a + b, 0);
    expect(stat("pages").value).toBe(
      `${compiled.toLocaleString("en-US")} / ${filed.toLocaleString("en-US")}`,
    );
    expect(compiled).toBeLessThanOrEqual(filed);

    /* Regions: the World's own total, which is deliberately not the bounded model's length. */
    expect(stat("regions").value).toBe(world.totals.regions.toLocaleString("en-US"));
    expect(world.totals.regions).toBe(world.evidence.length);

    /* The digest: a prefix of the artifact the other three were counted from, never reformatted. */
    expect(EXPLORE_SAMPLE_DIGEST.startsWith(`sha256:${stat("digest").value.replace("sha256 ", "")}`)).toBe(true);
  });

  it("rounds nothing, estimates nothing and abbreviates nothing", () => {
    for (const entry of HERO_STATS) {
      expect(entry.value, `${entry.id} is hedged`).not.toMatch(/[+~]|over |about |approx|k\b|M\b|B\b/i);
    }
    /* A thousands separator is the only formatting a count carries. */
    expect(stat("regions").value).toMatch(/^\d{1,3}(,\d{3})*$/);
  });

  it("sends every figure to the surface a reader can count it on", () => {
    for (const entry of HERO_STATS) {
      expect(entry.href, `${entry.id} has no source link`).toMatch(/^\/explore\?act=(world|evidence|change)$/);
    }
  });

  it("gives every figure a label, in both languages, and never says accuracy", () => {
    for (const locale of ["en", "ko"] as const) {
      const copy = HERO_PROOF_COPY[locale];
      expect(copy.stats).toHaveLength(HERO_STATS.length);
      for (const label of copy.stats) expect(label.trim().length).toBeGreaterThan(0);
      for (const text of [copy.caption, copy.stripLabel, ...copy.stats]) {
        expect(text.toLowerCase(), `${locale} copy says accuracy`).not.toContain("accuracy");
        expect(text.toLowerCase()).not.toContain("정확도");
      }
    }
  });

  /*
    §7.1 of the gap document. Reducto publishes "5,000,000,000 pages" and Mistral "2,000 pages per
    minute"; this deployment caps a source at 5 MB and 80 pages, so a headline number here may
    only ever say what one published World contains. A throughput or capacity word in the strip's
    copy is the claim the manifest contradicts, and it is barred rather than reviewed.
  */
  it("makes no throughput, capacity or scale claim", () => {
    const text = [
      ...Object.values(HERO_PROOF_COPY).flatMap(copy => [copy.caption, copy.stripLabel, ...copy.stats]),
      readFileSync(fileURLToPath(new URL("../components/landing-v2/hero-proof.tsx", import.meta.url)), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " "),
    ]
      .join(" ")
      .toLowerCase();
    for (const barred of ["per minute", "per second", "throughput", "at any scale", "any size", "unlimited", "billion", "million"]) {
      expect(text, `the strip claims "${barred}"`).not.toContain(barred);
    }
  });
});
