import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/*
  The site chrome reads the router. There is no router in a node test, and `usePathname()`
  returns null rather than throwing, which the navigation then tries to call `.replace` on. The
  stub is the route this page is at, so the chrome renders the same nav state it renders in the
  app; nothing under test reads it.
*/
vi.mock("next/navigation", () => ({
  usePathname: () => "/benchmarks",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {} }),
}));

const { default: BenchmarksPage } = await import("../app/benchmarks/page");
import { arenaBars, arenaDots, modelArenaBoard, settledModels, unsettledModels } from "./model-arena-page-data";

/*
  The guard over the rendered /benchmarks page.

  Three things this suite is for, in the order they would go wrong:

    1. **The word.** "Accuracy" is not a word this site may use for a completion figure or for a
       structural similarity score, and /benchmarks is the page most likely to grow one back --
       three metric identifiers in `lib/benchmark-registry.ts` still spell it, and the page
       normalises all three. If one is added and not mapped, this fails.
    2. **The denominator.** Every figure on the board is drawn beside the population it was
       measured over. A chart that lost its page count would still render.
    3. **360px.** A wide table and the scatter plot each sit in their own scroll frame with
       `overflow-x: auto` and `min-width: 0`, which is the source invariant that keeps the route
       off the phone-overflow sweep. The sweep itself is the real check and runs in e2e; this is
       the half a node test can carry on every commit.
*/

const html = renderToStaticMarkup(createElement(BenchmarksPage));
const text = html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ");

const read = (relative: string) => readFileSync(path.join(import.meta.dirname, "..", relative), "utf8");

describe("the rendered /benchmarks page", () => {
  it("never says accuracy", () => {
    expect(html.toLowerCase()).not.toContain("accuracy");
  });

  it("prints the settled board, with each model's figure and the pages it was scored over", () => {
    for (const bar of arenaBars("text_edit")) {
      expect(text).toContain(bar.label);
      expect(text).toContain(bar.value.toFixed(4));
      expect(text).toContain(`${bar.pages.toLocaleString("en-US")} pages`);
    }
  });

  it("states the direction of each metric rather than implying it with a bar", () => {
    expect(text).toMatch(/Lower is better/);
    expect(text).toMatch(/Higher is better/);
  });

  it("plots only the rows with both readings, and lists every plotted value as text", () => {
    const dots = arenaDots();
    for (const dot of dots) {
      expect(text).toContain(`${dot.secondsPerPage} s/page`);
      expect(text).toContain(`${dot.timedPages.toLocaleString("en-US")} timed pages`);
    }
    expect(html).toContain(`Scatter plot of ${dots.length} models`);
  });

  it("keeps the rows the campaign did not settle on the page, each with its reason", () => {
    for (const model of unsettledModels()) {
      expect(text).toContain(model.display_name);
    }
    expect(text).toMatch(/FOUNDER_EXCLUDED/);
  });

  it("publishes the failed hypothesis rather than only the board", () => {
    expect(text).toMatch(/Not supported/);
    expect(text).toMatch(/Blind quality detection failed/);
  });

  it("carries the dataset licence, the evaluator pin and the price snapshot date", () => {
    const board = modelArenaBoard();
    expect(text).toContain(board.benchmark.dataset_license);
    expect(text).toContain(board.benchmark.dataset_redistribution.replace(/_/g, " "));
    expect(text).toContain(board.benchmark.evaluator_pin);
    expect(text).toContain(board.registry_snapshot_at);
  });

  it("binds every source by sha256 in the receipts drawer", () => {
    for (const source of modelArenaBoard().sources) {
      expect(text).toContain(source.sha256);
      expect(text).toContain(source.path);
    }
  });

  it("names the GPU and the listed rate for every row that has one, and never a price per page", () => {
    for (const model of modelArenaBoard().models) {
      if (model.gpu.gpu_type) expect(text).toContain(model.gpu.gpu_type);
      if (model.gpu.listed_usd_per_hour !== null) {
        expect(text).toContain(`$${model.gpu.listed_usd_per_hour.toFixed(2)}/h listed`);
      }
    }
    expect(text.toLowerCase()).not.toMatch(/per 1,?000 pages\s*\$/);
    /*
      The one dollar-per-page string on the page is the campaign's own rule that the hosted lane
      is never reported as one. No figure here is divided into a price for a page: a listed GPU
      rate is raw hardware cost, and the constitution keeps it away from anything that reads as
      what a page costs to buy.
    */
    expect(text.toLowerCase().match(/\$[\d.]+\s*\/\s*page/g) ?? []).toEqual(["$0/page"]);
  });

  it("links the sibling run without importing it", () => {
    expect(html).toContain("/benchmarks/gdp-pdf");
    expect(read("app/benchmarks/page.tsx")).not.toMatch(/from\s+["'].*benchmarks\/gdp-pdf/);
  });

  it("does not restate a competitor's leaderboard row as a result", () => {
    for (const name of ["Reducto", "LlamaParse", "LlamaIndex", "Mistral OCR", "Unstructured"]) {
      expect(text).not.toContain(name);
    }
  });

  it("carries the campaign's own caveats verbatim", () => {
    for (const caveat of modelArenaBoard().caveats) {
      expect(text.replace(/\s+/g, " ")).toContain(caveat.replace(/\s+/g, " "));
    }
  });
});

/*
  THE 360px GUARD, as far as a node test can carry it.

  The e2e overflow sweep is the real check and this route is in its list. It cannot run here:
  there is no layout engine. What is still checkable is the source invariant that makes the page
  safe at 360px -- every element wider than a phone is inside a frame that scrolls on its own
  axis and may shrink below its content.
*/
describe("the 360px invariant", () => {
  const sheet = read("components/benchmarks/arena-charts.module.css");
  const component = read("components/benchmarks/arena-charts.tsx");

  it("puts every table inside a scroll frame", () => {
    const tables = component.match(/<table/g) ?? [];
    const frames = component.match(/<div className=\{styles\.tableScroll\}/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    expect(frames.length).toBe(tables.length);
  });

  it("gives that frame its own overflow and a min-width of zero", () => {
    expect(sheet).toMatch(/\.tableScroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(sheet).toMatch(/\.tableScroll\s*\{[^}]*min-width:\s*0/);
  });

  it("puts the scatter plot in a scroll frame too, because its ticks are text", () => {
    expect(component).toContain("styles.plotScroll");
    expect(sheet).toMatch(/\.plotScroll\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("lets a digest and a bar row break rather than widen the page", () => {
    expect(sheet).toMatch(/\.digest\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(sheet).toMatch(/\.barLabel\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(sheet).toMatch(/\.bars\s*\{[^}]*min-width:\s*0/);
  });

  it("stacks the bar row before it reaches a phone, rather than keeping four columns", () => {
    /* The four-column grid is behind a min-width query; the default is the stacked areas. */
    expect(sheet).toMatch(/@media \(min-width: 720px\)/);
    expect(sheet).toMatch(/"label label"/);
  });

  it("animates nothing, so there is nothing for reduced motion to turn off", () => {
    for (const file of [sheet, read("components/evidence/region-highlight.module.css")]) {
      expect(file).not.toMatch(/\btransition\s*:/);
      expect(file).not.toMatch(/\banimation\s*:/);
      expect(file).not.toMatch(/@keyframes/);
    }
  });
});

describe("the settled board itself", () => {
  it("is what the page renders and not a subset of it", () => {
    expect(arenaBars("text_edit").length).toBe(settledModels().length);
  });
});
