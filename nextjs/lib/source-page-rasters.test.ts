import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../public/explore-sample/pages/pages.manifest.json";
import { sourcePageLabel, sourcePageRaster, sourceRegionRaster } from "./source-page-rasters";
import { chooseExploreEntryProof } from "./explore-entry-proof";
import { exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import { toVisualWorldModel } from "./visual-world-model";

/*
  The rasters are the proof block's first paint, so they are held to the same rule as every other
  published artifact: the bytes on disk match the digest beside them, and the digest beside them
  is the digest of the source the compiler read. A raster that drifted from its source would be a
  picture of a document claiming to be that document.

  The second half is the drift guard the render script cannot write for itself: it is plain Node
  and the pick selection is TypeScript, so the page list is a literal there and this is what fails
  when a pick moves to a page nobody rendered.
*/
const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const sample = join(process.cwd(), "public", "explore-sample");
const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Every pick shipped on a public route, kept in the shape the call sites declare them. */
const SHIPPED_PICKS = [
  { form: "10-K", match: /PART I Item 1\. Business Company Background/ },
  { form: "10-Q", match: /CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS/ },
  { form: "DEF 14A", match: /Nominees to Apple’s Board of Directors Apple is overseen/ },
  { form: "10-Q", match: /Segment Operating Performance The following table shows net sales by reportable segment/ },
  { form: "DEF 14A", match: /Audit Committee Ron Sugar/ },
] as const;

describe("committed source page rasters", () => {
  it("matches the bytes it was rendered from and the bytes it emitted", () => {
    expect(manifest.pages.length).toBeGreaterThan(0);
    for (const page of manifest.pages) {
      expect(digest(readFileSync(join(sample, page.sourceFile)))).toBe(page.sourceSha256);
      const raster = readFileSync(join(process.cwd(), "public", page.file.replace(/^\//, "")));
      expect(digest(raster)).toBe(page.sha256);
      expect(raster.length).toBe(page.bytes);
      for (const region of page.regions) {
        const crop = readFileSync(join(process.cwd(), "public", region.file.replace(/^\//, "")));
        expect(digest(crop)).toBe(region.sha256);
      }
    }
  });

  it("covers the page and region every shipped proof pick resolves to", () => {
    const entry = chooseExploreEntryProof(world.evidence, []);
    expect(entry).not.toBeNull();
    const picks = [
      entry!,
      ...SHIPPED_PICKS.map((pick) => {
        const found = world.evidence.find(
          (item) => item.form === pick.form && item.page > 2 && pick.match.test(item.excerpt),
        );
        expect(found, `pick no longer resolves: ${pick.form} ${String(pick.match)}`).toBeDefined();
        return found!;
      }),
    ];
    for (const pick of picks) {
      expect(sourcePageRaster(pick.digest, pick.page), `no raster for ${pick.filename} p${pick.page}`).not.toBeNull();
      expect(sourceRegionRaster(pick.digest, pick.page, pick.bbox1000), `no crop for ${pick.id}`).not.toBeNull();
    }
  });

  it("returns null rather than a stand-in for a page nobody rendered", () => {
    expect(sourcePageRaster("sha256:" + "0".repeat(64), 1)).toBeNull();
    expect(sourceRegionRaster(manifest.pages[0].sourceSha256, manifest.pages[0].page, [1, 2, 3, 4])).toBeNull();
  });

  it("names the artefact once, and qualifies rendered bytes rather than renaming them", () => {
    expect(sourcePageLabel("original")).toBe("Source page");
    expect(sourcePageLabel("reference_render")).toBe("Source page · reference render");
    const surfaces = [
      "components/world-visual/source-sheet.tsx",
      "components/world-visual/original-source-page.tsx",
      "components/solution-proof-sample.tsx",
    ];
    for (const file of surfaces) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      for (const banned of ["Reference page", "Page render", "page render", "Source render"]) {
        expect(text, `${file} re-names the source page as "${banned}"`).not.toContain(banned);
      }
    }
  });
});
