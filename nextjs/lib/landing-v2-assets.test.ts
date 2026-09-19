import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LANDING_V2_AVIF,
  LANDING_V2_IMAGES,
  landingV2PageImage,
  landingV2RegionImage,
} from "./landing-v2-assets";
import { buildHeroScene } from "./landing-v2-hero";
import { buildEvidenceRecord, buildProofTabs } from "./landing-v2-proof";
import pagesManifest from "@/public/explore-sample/pages/pages.manifest.json";

/*
  What `scripts/build-landing-v2-assets.mjs` emitted, checked against what it read and against
  what the landing can afford to send.

  The two rules that matter are the ones a reviewer cannot see by looking at the page: every
  derivative came from a committed raster whose digest still matches `pages.manifest.json`, and
  every byte count in the manifest is the byte count of the file on disk. A manifest that is
  merely self-consistent would let a re-encode with different settings pass unnoticed.
*/

const PUBLIC = join(import.meta.dirname, "..", "public");

/** The lane's ceilings: nothing over 220 KB, and the hero's 840px page under 120 KB. */
const MAX_BYTES = 220 * 1024;
const HERO_840_MAX_BYTES = 120 * 1024;

describe("the Landing V2 derivatives", () => {
  it("was cut from committed rasters whose digests still match", () => {
    expect(LANDING_V2_IMAGES.length).toBeGreaterThan(0);
    for (const image of LANDING_V2_IMAGES) {
      const entry = pagesManifest.pages.find(
        (page) => page.file === image.source && page.page === image.page,
      );
      expect(entry, `${image.source} p${image.page} is not in pages.manifest.json`).toBeDefined();
      expect(entry!.sourceSha256, `${image.source} source digest`).toBe(image.sourceSha256);
      const bytes = readFileSync(join(PUBLIC, image.source));
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(entry!.sha256);
    }
  });

  it("wrote every file it declared, at the byte length it declared", () => {
    for (const image of LANDING_V2_IMAGES) {
      expect(image.outputs.length, image.src).toBeGreaterThan(0);
      for (const output of image.outputs) {
        const file = join(PUBLIC, output.src);
        expect(statSync(file).size, `${output.src} size`).toBe(output.bytes);
        const bytes = readFileSync(file);
        expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, `${output.src} digest`).toBe(output.sha256);
      }
    }
  });

  it("stays inside the page weight the landing can afford", () => {
    for (const image of LANDING_V2_IMAGES) {
      for (const output of image.outputs) {
        expect(output.bytes, `${output.src} is over the ceiling`).toBeLessThanOrEqual(MAX_BYTES);
      }
    }
    const hero = buildHeroScene();
    const heroPage = landingV2PageImage(hero.source.digest, hero.source.page);
    const at840 = heroPage?.outputs.find((output) => output.width === 840 && output.format === "webp");
    expect(at840, "the hero page has no 840px WebP").toBeDefined();
    expect(at840!.bytes).toBeLessThanOrEqual(HERO_840_MAX_BYTES);
  });

  it("offers a WebP source set, and an AVIF one when the encoder produced it", () => {
    for (const image of LANDING_V2_IMAGES) {
      expect(image.srcSet, image.src).toContain(".webp ");
      expect(image.src.endsWith(".webp"), image.src).toBe(true);
      expect(image.srcSet).toContain(`${image.width}w`);
      if (LANDING_V2_AVIF) expect(image.avifSrcSet, image.src).toContain(".avif ");
      // Ascending by width, so a browser reads the set in the order it expects.
      const widths = image.outputs.filter((output) => output.format === "webp").map((output) => output.width);
      expect([...widths].sort((left, right) => left - right)).toEqual(widths.slice().sort((left, right) => left - right));
    }
  });

  /*
    The render set is a literal list in a plain-Node script and the selection lives in
    TypeScript, so this is the join that keeps the two from drifting: every region the hero and
    the proof scenes resolve to must have a derivative. A page added to the World without a
    render fails here rather than rendering a missing image on the landing.
  */
  it("covers every region the hero and the proof scenes resolve to", () => {
    const hero = buildHeroScene();
    const record = buildEvidenceRecord();
    const wanted: [string, string, number, readonly number[]][] = [
      ["hero", hero.source.digest, hero.source.page, hero.region.bbox1000],
      ["evidence record", record.source.digest, record.source.page, record.region.bbox1000],
      ...buildProofTabs().map(
        (tab) => [`tab: ${tab.question}`, tab.source.digest, tab.source.page, tab.region.bbox1000] as [string, string, number, readonly number[]],
      ),
    ];
    for (const [label, digest, page, bbox] of wanted) {
      expect(landingV2PageImage(digest, page), `${label}: no page derivative`).not.toBeNull();
      expect(landingV2RegionImage(digest, page, bbox), `${label}: no region derivative`).not.toBeNull();
    }
  });
});
