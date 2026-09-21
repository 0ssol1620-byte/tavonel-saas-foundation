import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ExploreFrame from "../components/explore/explore-frame";
import { EXPLORE_SAMPLE_DIGEST, exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import { layoutVisualWorld, toVisualWorldModel } from "./visual-world-model";

/*
  THE VALIDATOR FOR GAP #8.

  The embed's claim is that it is `/explore`'s World rather than a picture of it, so the test
  recompiles the model here and fails if the frame's counts, its digest or its drawn-object total
  stop matching the artifact -- the same discipline `hero-stats.test.ts` applies to the strip.

  It also holds the one thing the gap document says an embed must not do, which is to travel
  without the sentence about what a single clean English-language issuer establishes. Moving the
  widget is allowed; leaving the caveat on the route it came from is not.
*/

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const layout = layoutVisualWorld(world);
const html = renderToStaticMarkup(createElement(ExploreFrame, { caption: "A Compiled World" }));
const page = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("the embedded Explore frame", () => {
  it("prints the published World's own counts, recomputed here", () => {
    expect(html).toContain(`${layout.placements.length.toLocaleString("en-US")} of ${world.totals.objects.toLocaleString("en-US")} objects drawn`);
    expect(html).toContain(`${world.totals.regions.toLocaleString("en-US")} evidence regions`);
    expect(html).toContain(EXPLORE_SAMPLE_DIGEST.replace(/^sha256:/, "sha256 ").slice(0, 18));
    /* The frame is bounded to what the layout draws, so it can never claim to draw more. */
    expect(layout.placements.length).toBeLessThanOrEqual(world.totals.objects);
  });

  it("draws real compiled objects, each one a focusable control with its own label", () => {
    for (const placement of layout.placements) {
      expect(html, `${placement.id} is not drawn`).toContain(`data-node-id="${placement.id}"`);
    }
    expect((html.match(/<button/g) ?? []).length).toBe(layout.placements.length);
    expect(html).toContain('data-visual-node=""');
  });

  it("carries the corpus caveat and the way to the capability manifest", () => {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("One issuer");
    expect(text).toContain("single permission level show the mechanism");
    expect(text).toContain("not a claim about a mixed internal corpus");
    expect(html).toContain('href="/sources"');
    expect(html).toContain('href="/explore?act=world"');
  });

  /*
    The renderer is the stage's, not a second one, and it is a figure rather than a film: the
    entry stagger is switched off, so nothing on a reading page animates itself in on scroll.
  */
  it("reuses the stage's renderer with its motion off", () => {
    const canvas = page("components/explore/explore-frame-canvas.tsx");
    expect(canvas).toContain('from "@/components/world-visual/world-canvas"');
    expect(canvas).toMatch(/\breduced\b/);
    expect(canvas).toMatch(/\bsettled\b/);
    expect(html).toContain('data-reduced="1"');
    expect(html).toContain('data-settled="1"');
    /* Every transition delay the frame emits is zero: `nodeStagger` returns 0 when reduced. */
    expect(html).not.toMatch(/transition-delay:\s*[1-9]/);
  });

  it("is the same component on both pages, and neither page draws its own", () => {
    for (const path of ["app/product/page.tsx", "app/knowledge-compiler/page.tsx"]) {
      const source = page(path);
      expect(source, `${path} does not render the frame`).toContain("<ExploreFrame ");
      expect(source, `${path} imports a second frame`)
        .toContain('from "@/components/explore/explore-frame"');
      const prose = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
      for (const banned of ["<svg", "node-cluster", "illustration", "placeholder", "<canvas"]) {
        expect(prose, `${path} draws ${banned}`).not.toContain(banned);
      }
    }
  });

  it("claims no accuracy, no throughput and no table structure around the frame", () => {
    const text = html.replace(/<[^>]+>/g, " ").toLowerCase();
    for (const barred of ["accuracy", "accurate", "per minute", "per second", "throughput", "at scale", "table extraction", "row", "cell"]) {
      expect(text, `the frame says ${barred}`).not.toContain(barred);
    }
  });
});
