import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WorldRecompileTimeline from "../components/world-recompile-timeline";
import { exploreChangeBaselineDocument, exploreChangeTimeline } from "./explore-change";

/*
  GAP #10: the product sub-pages' empty left columns.

  The audit found three product pages arguing in prose beside a column that held an h1 and about
  900px of nothing. Two are filled by the time this file runs -- /product/document-understanding
  by the region highlight and /product/compiled-world by the one-arrival change surface -- and
  this lane fills the third. What the test holds is that all three are filled by a component
  reading real compiled data, because the failure mode the audit names is not an empty column: it
  is an abstract node cluster or an illustration of a diff put there to fill one.

  The figures on the new timeline are recomputed here from `exploreChangeTimeline`, the same way
  `hero-stats.test.ts` recomputes the strip's. Drift fails.
*/

const page = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const html = renderToStaticMarkup(createElement(WorldRecompileTimeline, {}));

/** The left column of the two-column document template: the first `.stack` under `.body`. */
function leftColumn(source: string): string {
  const at = source.indexOf('<div className="body">');
  expect(at, "the page does not use the two-column document template").toBeGreaterThan(-1);
  const start = source.indexOf('<div className="stack">', at);
  const end = source.indexOf('<div className="stack">', start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

/*
  /product/continuous-knowledge left that template: its intro is one grid. Below 1321px it reads
  heading, summary, timeline; from 1321px up the timeline sits in the left column under the
  heading and the summary takes the right. So the source order and the stylesheet's grid areas
  are what is held here, and the slice returned is the timeline's own cell.
*/
function continuousKnowledgeTimelineColumn(source: string): string {
  const intro = source.indexOf('data-continuous-intro=""');
  const heading = source.indexOf("className={styles.introHeading}", intro);
  const summary = source.indexOf("className={styles.summary}", heading);
  const cell = source.indexOf("className={styles.timeline}", summary);
  const timeline = source.indexOf("<WorldRecompileTimeline", cell);
  expect(intro, "the page has no intro grid").toBeGreaterThan(-1);
  expect(heading, "the heading is not inside the intro grid").toBeGreaterThan(intro);
  expect(summary, "the summary does not follow the heading").toBeGreaterThan(heading);
  expect(cell, "the timeline cell does not follow the summary").toBeGreaterThan(summary);
  expect(timeline, "the timeline is not in its cell").toBeGreaterThan(cell);

  const css = page("app/product/continuous-knowledge/continuous-knowledge.module.css");
  const areas = (rule: string) =>
    [...rule.match(/grid-template-areas:([^;]*);/)![1].matchAll(/"([^"]*)"/g)].map(([, row]) => row.trim().split(/\s+/));
  const narrow = css.match(/(?:^|\n)\.intro \{([^}]*)\}/)?.[1];
  const wide = css.match(/@media \(min-width: 1321px\) \{\s*\.intro \{([^}]*)\}/)?.[1];
  expect(narrow, "the intro has no single-column reading order").toBeDefined();
  expect(wide, "the intro has no two-column layout at 1321px").toBeDefined();
  expect(areas(narrow!)).toEqual([["heading"], ["summary"], ["timeline"]]);
  const rows = areas(wide!);
  expect(rows.map(row => row[0]), "the timeline is not in the left column at 1321px").toEqual(["heading", "timeline"]);
  expect(rows.map(row => row[1]), "the summary is not in the right column at 1321px").toEqual(["summary", "summary"]);
  expect(css).toMatch(/\.introHeading \{ grid-area: heading;/);
  expect(css).toMatch(/\.intro > \.summary \{ grid-area: summary; \}/);
  expect(css).toMatch(/\.timeline \{ grid-area: timeline;/);
  return source.slice(cell, source.indexOf("</div>", timeline));
}

describe("the product sub-pages' left columns", () => {
  it.each([
    ["app/product/document-understanding/page.tsx", "RegionHighlight"],
    ["app/product/compiled-world/page.tsx", "WorldDiffSample"],
    ["app/product/continuous-knowledge/page.tsx", "WorldRecompileTimeline"],
  ])("%s fills its column with %s", (path, component) => {
    const source = page(path);
    expect(source, `${path} never imports ${component}`).toContain(component);
    /* /product/document-understanding puts its panel in the second column by design; the other
       two fill the first, which is the column the audit found empty. */
    const where = path.includes("document-understanding")
      ? source
      : path.includes("continuous-knowledge") ? continuousKnowledgeTimelineColumn(source) : leftColumn(source);
    expect(where, `${component} is not in the column it was added to fill`).toContain(
      `<${component}`,
    );
  });

  it.each([
    "app/product/compiled-world/page.tsx",
    "app/product/continuous-knowledge/page.tsx",
    "app/product/document-understanding/page.tsx",
  ])("%s draws no illustration and no abstract cluster", path => {
    const source = page(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
    for (const banned of ["<svg", "node-cluster", "illustration", "placeholder", "/img/hero-"]) {
      expect(source, `${path} renders ${banned}`).not.toContain(banned);
    }
  });
});

describe("the recompilation timeline on /product/continuous-knowledge", () => {
  it("prints one step per arriving filing, in order, with both manifest digests", () => {
    expect(exploreChangeTimeline.length).toBeGreaterThan(0);
    const positions = exploreChangeTimeline.map(step =>
      html.indexOf(`${step.from} → ${step.to}`.replace(/&/g, "&amp;")),
    );
    for (const [index, at] of positions.entries()) {
      expect(at, `step ${index} is missing`).toBeGreaterThan(-1);
      if (index > 0) expect(at).toBeGreaterThan(positions[index - 1]!);
    }
    for (const step of exploreChangeTimeline) {
      for (const digest of [step.fromDigest, step.toDigest]) {
        expect(html).toContain(`${digest.replace(/^sha256:/, "sha256 ").slice(0, 20)}…`);
      }
    }
    expect(html).toContain(exploreChangeBaselineDocument.filename);
  });

  it("recomputes every figure it prints from the two compiles behind it", () => {
    const n = (value: number) => value.toLocaleString("en-US");
    for (const step of exploreChangeTimeline) {
      expect(html).toContain(
        `+${n(step.objects.added)} new · ${n(step.objects.rebuilt)} rebuilt · ${n(step.objects.untouched)} untouched`,
      );
      expect(html).toContain(
        `+${n(step.evidenceRegions.added)} new · ${n(step.evidenceRegions.changed)} changed`,
      );
      /* Both numbers, never one: what the World compiled over what the filing contains (§57). */
      expect(html).toContain(
        `${n(step.arrival.compiledPageCount)} of ${n(step.arrival.pageCount)} filed`,
      );
      expect(step.arrival.compiledPageCount).toBeLessThanOrEqual(step.arrival.pageCount);
    }
  });

  it("says both sides are complete compiles, and claims no selective rebuild", () => {
    const text = html.replace(/<[^>]*>/g, " ").toLowerCase();
    expect(text).toContain("complete compile");
    expect(text).toContain("not the work a selective rebuild would have done");
    for (const overclaim of ["incremental", "only the affected", "accuracy", "정확도"]) {
      expect(text, `the timeline claims "${overclaim}"`).not.toContain(overclaim);
    }
  });

  it("renders no table, no row and no cell", () => {
    for (const tag of ["<table", "<tr", "<td", "<th", 'role="grid"']) {
      expect(html, `the timeline renders ${tag}`).not.toContain(tag);
    }
  });
});
