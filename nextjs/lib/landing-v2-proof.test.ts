import { describe, expect, it } from "vitest";
import { STATE_WORD } from "@/components/explore/parallel-view";
import { exploreChangeStory } from "./explore-change";
import { EXPLORE_SAMPLE_QUESTIONS } from "./explore-sample";
import { LANDING_V2_AVIF } from "./landing-v2-assets";
import {
  LANDING_V2_STATE_WORD,
  buildEvidenceRecord,
  buildProofTabs,
  buildRecompileView,
} from "./landing-v2-proof";

const tabs = buildProofTabs();
const record = buildEvidenceRecord();
const view = buildRecompileView();

/** The 2025 Form 10-K, as the compiler recorded it. Also pinned in `landing-v2-hero.test.ts`. */
const HERO_DIGEST = "sha256:108590052c3ba5400c63660d787fe7ed4e43868292946d7a7facebe9ab7d1aab";

describe("the Landing V2 proof scenes", () => {
  it("borrows /explore's state vocabulary rather than inventing one", () => {
    // The landing copy of the table must equal the one /explore prints, or the same object
    // would have two names on two pages of the same site.
    expect(LANDING_V2_STATE_WORD).toEqual(STATE_WORD);
  });

  describe("Scene 02 tabs", () => {
    it("asks only prepared questions, and opens each onto a region that was cited for it", () => {
      expect(tabs.length).toBeGreaterThan(0);
      expect(tabs.length).toBeLessThanOrEqual(3);
      for (const tab of tabs) {
        expect(EXPLORE_SAMPLE_QUESTIONS).toContain(tab.question);
        expect(tab.citationIndex).toBeGreaterThanOrEqual(0);
        expect(tab.citationIndex).toBeLessThan(tab.citationCount);
        expect(tab.answerExcerpt.length).toBeGreaterThan(0);
        expect(tab.answerExcerpt.length).toBeLessThanOrEqual(240);
        expect(tab.openHref).toBe(`/explore?act=evidence&evidence=${encodeURIComponent(tab.region.id)}`);
      }
      expect(new Set(tabs.map((tab) => tab.question)).size).toBe(tabs.length);
    });

    it("carries a committed page render and a crop for every tab", () => {
      for (const tab of tabs) {
        for (const [label, raster] of [["page", tab.rasters.page], ["crop", tab.rasters.crop]] as const) {
          expect(raster.src, `${tab.question} ${label}`).toMatch(/^\/landing\/v2\/.+\.webp$/);
          expect(raster.srcSet).toContain(`${raster.width}w`);
          expect(raster.width).toBeGreaterThan(0);
          expect(raster.height).toBeGreaterThan(0);
          if (LANDING_V2_AVIF) expect(raster.avifSrcSet).toContain(".avif");
        }
        expect(tab.source.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(tab.source.page).toBeGreaterThan(0);
        expect(tab.source.page).toBeLessThanOrEqual(tab.source.pageCount);
      }
    });

    /*
      §12 wants three tabs over three filings. This corpus gives three tabs over two: the fourth
      prepared question cites no region on a page with a committed render, and of the three that
      do, two land on the Q1 10-Q. The count is asserted as measured rather than loosened to a
      range -- a third filing arrives when `scripts/render-source-pages.mjs` renders a page one
      of the other answers cites, which is a corpus change and should fail here first.
    */
    it("reaches the filings the committed renders allow, and says how many", () => {
      const filings = new Set(tabs.map((tab) => tab.source.digest));
      expect(tabs).toHaveLength(3);
      expect(filings.size).toBe(2);
      expect(new Set(tabs.map((tab) => `${tab.source.digest}:${tab.source.page}`)).size).toBe(3);
    });
  });

  describe("Scene 04 evidence record", () => {
    it("is the hero's region, with every field read from the artifact", () => {
      expect(record.source.digest).toBe(HERO_DIGEST);
      expect(record.source.form).toBe("10-K");
      expect(record.source.page).toBe(4);
      expect(record.source.filename).toBe("apple-2025-form-10-k.pdf");
      expect(record.region.bbox1000).toEqual([30, 291, 971, 380]);
      expect(record.region.normalized).toEqual([0.03, 0.291, 0.971, 0.38]);
      expect(record.region.normalizedLabel).toBe("0.030, 0.291 → 0.971, 0.380");
      expect(record.region.unit).toBe("bbox, per mille of the page");
      expect(record.claim.kind).toBe("Claim");
    });

    it("names the state the World gives the object, in the World's own word", () => {
      expect(record.status.label).toBe(STATE_WORD[record.status.state]);
      // A deterministic public sample is a published sample. It is not "verified", and the
      // inspector does not say so.
      expect(record.status.state).toBe("candidate");
      expect(record.status.label).toBe("PUBLISHED SAMPLE");
    });

    it("prints the digest truncated with the full value beside it", () => {
      expect(record.version.digest).toBe(HERO_DIGEST);
      expect(HERO_DIGEST.startsWith(record.version.short.replace("…", ""))).toBe(true);
      expect(record.version.short.length).toBeLessThan(record.version.digest.length);
    });

    it("assembles the copyable citation from the record", () => {
      expect(record.citation).toContain(record.source.filename);
      expect(record.citation).toContain(record.version.digest);
      expect(record.citation).toContain(record.region.bbox1000.join(","));
      expect(record.citation).toContain("per mille");
    });

    it("opens the committed bytes at the page the region sits on", () => {
      expect(record.hrefs.original).toBe(`/explore-sample/apple-2025-form-10-k.pdf#page=4`);
      expect(record.hrefs.evidence).toContain("act=evidence&evidence=");
      expect(record.rasters.page.src).toMatch(/^\/landing\/v2\/.+\.webp$/);
      expect(record.rasters.crop.src).toMatch(/^\/landing\/v2\/.+\.webp$/);
    });
  });

  describe("Scene 05 recompile view", () => {
    it("restates the comparison without recomputing any part of it", () => {
      expect(view.counts).toEqual(exploreChangeStory.counts);
      expect(view.beforeLabel).toBe(exploreChangeStory.before.label);
      expect(view.afterLabel).toBe(exploreChangeStory.after.label);
      expect(view.arrivals).toHaveLength(exploreChangeStory.arrivals.length);
      for (const [index, arrival] of view.arrivals.entries()) {
        const source = exploreChangeStory.arrivals[index];
        expect(arrival.form).toBe(source.form);
        expect(arrival.filingDate).toBe(source.filingDate);
        expect(arrival.page).toBe(source.page);
        expect(source.excerpt.startsWith(arrival.excerptPreview)).toBe(true);
      }
    });

    it("samples affected objects without implying the sample is the total", () => {
      expect(view.affectedSample.length).toBeGreaterThan(0);
      expect(view.affectedSample.length).toBeLessThanOrEqual(6);
      expect(view.affectedSample.length).toBeLessThan(exploreChangeStory.affectedNodeIds.length);
      const ids = new Set(exploreChangeStory.affectedNodeIds);
      for (const node of view.affectedSample) {
        expect(ids.has(node.id), `${node.id} is not in the affected set`).toBe(true);
        expect(node.stateLabel).toBe(STATE_WORD[node.state]);
      }
    });

    it("carries the no-selective-rebuild fact beside the counts (rule 7)", () => {
      expect(view.equivalence.state).toBe("not_yet");
      expect(view.equivalence.reason).toContain("complete compiles");
      expect(view.hrefs.contract).toBe("/product/continuous-knowledge");
      expect(view.hrefs.change).toBe("/explore?act=change");
      // The four counts are shown as measured; none of them is folded into a friendlier figure.
      expect(Object.keys(view.counts).sort()).toEqual(["added", "rebuilt", "removed", "untouched"]);
    });
  });
});
