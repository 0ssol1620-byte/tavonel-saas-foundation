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

  /*
    V34 (D33 §4 #18): the hub cards carry the Input / Action / Output list and no thumbnail; the
    sample is placed on each detail page, from the same record, through SolutionWorkflowProof.
    The invariant is unchanged: what a reader sees of a solution is a filing from the record, never
    stock art or a placeholder.
  */
  it("is placed on each detail page from the record the hub reads", () => {
    const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    const detail = source("../app/solutions/[slug]/page.tsx");
    const proof = source("../app/solutions/solution-workflow-proof.tsx");
    expect(detail).toContain("<SolutionWorkflowProof kind={slug as SolutionSlug} pick={solution.proof} />");
    expect(proof).toContain("<SolutionProofSample pick={selectedPick}");
    const prose = proof.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const banned of ["<svg", "illustration", "placeholder", "/img/", "unsplash"]) {
      expect(prose, `the sample renders ${banned}`).not.toContain(banned);
    }
    /* The hub cards show no image at all; the hub's one drawing is the hero Figure, never stock art. */
    const hub = source("../components/v34/routes/solutions/solutions.tsx");
    expect(hub).not.toContain("<SolutionProofSample");
    for (const banned of ["placeholder", "/img/", "unsplash", "<img"]) {
      expect(hub, `the hub renders ${banned}`).not.toContain(banned);
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
