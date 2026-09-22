import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SolutionProofSample, { type ProofPick, type ProofVariant } from "../components/solution-proof-sample";
import { SOLUTIONS } from "../app/solutions/[slug]/page";
import { exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import { sourceRegionRaster } from "./source-page-rasters";
import { toVisualWorldModel } from "./visual-world-model";

/*
  THE VALIDATOR FOR GAP #11.

  The hub gets five images, and the one failure mode the audit names by number is five images of
  the same document (G1-016, which this repository has already shipped once). So the first thing
  this file does is resolve every card's region the way the component resolves it and assert the
  five land on five distinct pages -- three distinct filings, which is what the published corpus
  holds, and never one filing five times.

  The second thing it holds is that a thumbnail inside a card whose whole surface is one anchor
  contains no second anchor. That is not a style preference: `solutions.module.css` expands the
  title's link over the article with `inset: 0`, so a link under it is unreachable by pointer and
  announced twice by a screen reader.
*/

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const entries = Object.entries(SOLUTIONS);

/*
  The component takes its whole props object with a default, so `createElement` resolves the
  no-props overload and rejects a call that passes one. Naming the signature here is the narrow
  fix: it asserts nothing about behaviour, and a prop that stops existing still fails the build.
*/
const Thumb = SolutionProofSample as (props: { pick: ProofPick; variant: ProofVariant }) => ReactElement | null;

/** The component's own selection, repeated here rather than imported, so drift fails. */
function selected(pick: { form: string; match: RegExp }) {
  const found = world.evidence.find(
    (item) => item.form === pick.form && item.page > 2 && pick.match.test(item.excerpt),
  );
  expect(found, `no region matches ${pick.form} ${String(pick.match)}`).toBeTruthy();
  return found!;
}

describe("the /solutions card thumbnails", () => {
  it("shows five cards, and no two show the same page of the same filing", () => {
    expect(entries.length).toBe(5);
    const picked = entries.map(([, solution]) => selected(solution.proof));
    const pages = picked.map((region) => `${region.sourceId}#${region.page}`);
    expect(new Set(pages).size, `two cards show the same page: ${pages.join(", ")}`).toBe(5);
    /* And not one filing wearing five hats: the corpus has several, and the cards use them. */
    expect(new Set(picked.map((region) => region.sourceId)).size).toBeGreaterThan(1);
  });

  it("commits no new raster: every thumbnail is a crop of a render already in the repository", () => {
    for (const [slug, solution] of entries) {
      const region = selected(solution.proof);
      const crop = sourceRegionRaster(region.digest, region.page, region.bbox1000);
      expect(crop, `${slug} has no committed crop`).toBeTruthy();
      expect(crop!.file.endsWith(".webp"), `${slug}'s crop is not a webp`).toBe(true);
      expect(crop!.width).toBeGreaterThan(0);
      expect(crop!.height).toBeGreaterThan(0);
    }
  });

  it("renders a real image with its dimensions, lazily, and no link inside the card", () => {
    for (const [slug, solution] of entries) {
      const html = renderToStaticMarkup(
        createElement(Thumb, { pick: solution.proof, variant: "thumb" }),
      );
      expect(html, `${slug} renders no image`).toContain("<img");
      expect(html, `${slug} omits width or height`).toMatch(/width="\d+"[\s\S]*height="\d+"/);
      expect(html, `${slug} loads eagerly`).toContain('loading="lazy"');
      /* An alt that names the filing and the page, not "image" or an empty string. */
      expect(html, `${slug} has no descriptive alt`).toMatch(/alt="[^"]{12,}"/);
      expect(html, `${slug} nests a link under the card's own target`).not.toContain("<a ");
      expect(html).toContain('data-proof-variant="thumb"');
    }
  });

  it("is placed on the hub from the record the detail pages read", () => {
    const page = readFileSync(
      fileURLToPath(new URL("../app/solutions/page.tsx", import.meta.url)),
      "utf8",
    );
    expect(page).toContain('<SolutionProofSample pick={solution.proof} variant="thumb" />');
    const prose = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
    /* No illustration, no stock art, no drawing: the card shows a filing or it shows nothing. */
    for (const banned of ["<svg", "illustration", "placeholder", "/img/", "unsplash"]) {
      expect(prose, `the hub renders ${banned}`).not.toContain(banned);
    }
  });

  it("claims no accuracy and no table structure in what a thumbnail says", () => {
    for (const [slug, solution] of entries) {
      const html = renderToStaticMarkup(
        createElement(Thumb, { pick: solution.proof, variant: "thumb" }),
      );
      const text = html.replace(/<[^>]+>/g, " ").toLowerCase();
      for (const barred of ["accuracy", "accurate", "extracted table", "table extraction", "per minute", "throughput"]) {
        expect(text, `${slug} says ${barred}`).not.toContain(barred);
      }
    }
  });
});
