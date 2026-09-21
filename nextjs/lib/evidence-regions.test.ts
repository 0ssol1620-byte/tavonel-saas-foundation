import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import RegionHighlight from "../components/evidence/region-highlight";
import manifest from "../public/explore-sample/pages/pages.manifest.json";
import { sampleEvidencePage, type EvidencePageView } from "./evidence-regions";
import { isSourceRegionBox } from "./source-region-box";

/*
  The guard over the shared region highlight and the data behind it.

  What it is for, in the order it would go wrong:

    1. **The boxes are the compiler's.** Every drawn box is a `bbox1000` the World recorded, and
       the percentage on the element is that coordinate divided by ten. A regression in either
       half draws a rectangle over the wrong words, which is the one failure this component
       cannot survive: its entire claim is that the box is where the passage was.
    2. **The page is a committed render.** The image is resolved through the source document's
       own sha256 and page number in `pages.manifest.json`. A drawn page would be an invented
       document, so the absence branch says so rather than filling the frame.
    3. **No grid, no cell.** The capability manifest records `no_table_or_formula_extraction`.
       The markup carries no table and no cell semantics anywhere.
    4. **Keyboard before hover, and useful before hydration.** Every region is a real button in
       document order, and the server render already carries one region's excerpt and locator.
*/

const view = sampleEvidencePage();
const html = renderToStaticMarkup(createElement(RegionHighlight, { view, caption: "A caption." }));
const text = html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ");

const read = (relative: string) => readFileSync(path.join(import.meta.dirname, "..", relative), "utf8");

describe("the evidence page view", () => {
  it("carries at least one region, every one of them with a drawable box", () => {
    expect(view.regions.length).toBeGreaterThan(0);
    for (const region of view.regions) {
      expect(isSourceRegionBox(region.bbox1000)).toBe(true);
    }
  });

  it("reads its page image out of the committed render manifest, by the source's own digest", () => {
    if (!view.image) {
      expect(view.imageAbsentReason).toBe("page image not published for this sample");
      return;
    }
    const entry = manifest.pages.find((page) => page.file === view.image!.src);
    expect(entry).toBeDefined();
    expect(entry!.sourceSha256).toBe(view.source.digest);
    expect(entry!.page).toBe(view.source.page);
    expect(entry!.width).toBe(view.image.width);
    expect(entry!.height).toBe(view.image.height);
  });

  it("gives every region a locator carrying the page, the box and the source digest", () => {
    for (const region of view.regions) {
      expect(region.locator).toContain(`p.${view.source.page} of ${view.source.pageCount}`);
      expect(region.locator).toContain(region.bbox1000.join(","));
      expect(region.locator).toContain(view.source.digest);
      expect(region.locator).toContain("per mille");
    }
  });

  it("puts every region on the one page it names, and opens each at its own id", () => {
    for (const region of view.regions) {
      expect(region.href).toContain(encodeURIComponent(region.id));
      expect(region.excerpt.length).toBeGreaterThan(0);
    }
    expect(new Set(view.regions.map((region) => region.id)).size).toBe(view.regions.length);
  });

  it("is the same view on every build, so the page does not change between deployments", () => {
    expect(sampleEvidencePage()).toEqual(view);
  });

  it("is server-only: no client module may import it", () => {
    const importers = ["app/evidence/page.tsx", "app/product/document-understanding/page.tsx"];
    for (const file of importers) {
      const source = read(file);
      expect(source).toContain("sampleEvidencePage");
      expect(source.trimStart().startsWith('"use client"')).toBe(false);
    }
  });
});

describe("the rendered region highlight", () => {
  it("maps every per-mille box to the same box in percent", () => {
    for (const region of view.regions) {
      const [x0, y0, x1, y1] = region.bbox1000;
      expect(html).toContain(`left:${x0 / 10}%`);
      expect(html).toContain(`top:${y0 / 10}%`);
      expect(html).toContain(`width:${(x1 - x0) / 10}%`);
      expect(html).toContain(`height:${(y1 - y0) / 10}%`);
    }
  });

  it("draws one focusable button per region, in document order", () => {
    const buttons = html.match(/<button[^>]*aria-pressed/g) ?? [];
    expect(buttons).toHaveLength(view.regions.length);
    /* Exactly one is selected in the server render, so the excerpt is in the HTML before JS. */
    expect((html.match(/aria-pressed="true"/g) ?? [])).toHaveLength(1);
    expect(text).toContain(view.regions[0]!.excerpt.slice(0, 40));
    expect(text).toContain(view.regions[0]!.locator);
  });

  it("names every button and binds it to the panel that describes it", () => {
    for (let index = 0; index < view.regions.length; index += 1) {
      expect(text).toContain(`Evidence region ${index + 1} of ${view.regions.length}`);
    }
    const described = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(described).toBeTruthy();
    expect(html).toContain(`id="${described}"`);
  });

  it("renders no table, no row and no cell", () => {
    for (const tag of ["<table", "<thead", "<tbody", "<tr", "<td", "<th", 'role="grid"', 'role="cell"']) {
      expect(html).not.toContain(tag);
    }
  });

  it("never says accuracy, and never claims a confidence for a region", () => {
    expect(text.toLowerCase()).not.toContain("accuracy");
    expect(text.toLowerCase()).not.toMatch(/\bconfidence\b/);
  });

  it("states the absence instead of drawing a page, when no render is published", () => {
    const absent: EvidencePageView = { ...view, image: null, imageAbsentReason: "page image not published for this sample" };
    const drawn = renderToStaticMarkup(createElement(RegionHighlight, { view: absent }));
    expect(drawn).not.toContain("<img");
    expect(drawn).toContain("page image not published for this sample");
    /* The boxes are still at their measured positions: the coordinates exist, the picture does not. */
    const [x0] = absent.regions[0]!.bbox1000;
    expect(drawn).toContain(`left:${x0 / 10}%`);
  });

  it("puts no figure in the alt text: the metadata is text beside the image", () => {
    const alt = html.match(/alt="([^"]*)"/)?.[1] ?? "";
    expect(alt).not.toContain(view.regions[0]!.excerpt.slice(0, 20));
    expect(alt).toContain(view.source.filename);
  });
});
