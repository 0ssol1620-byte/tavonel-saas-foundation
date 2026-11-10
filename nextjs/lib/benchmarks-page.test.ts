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

  /*
    2026-11-10 public-copy cleanup (founder direction): intended re-pin. The document-reader board
    was an internal model-selection experiment. Its row labels, notes, hosted-row price mechanics
    and the not-supported box left the page, so the board assertions became absence assertions.
    The recovery result stays, with its denominator and receipt.
  */
  it("publishes no internal model-selection material or process vocabulary", () => {
    for (const internal of [
      "opus5_subscription", "ARENA_CONTRACT", "api_equivalent", "masterplan", "Model Arena",
      "FOUNDER_EXCLUDED", "founder", "subscription surface", "scalar", "Not supported",
      "Blind quality", "campaign", " lane", "router", "low-quality",
    ]) {
      expect(text, internal).not.toContain(internal);
    }
  });

  it("prints the recovery result with its denominator and its receipt", () => {
    expect(text).toContain("80.6");
    expect(text).toContain("53.7");
    expect(text).toContain("1,403 documents and 8,413 checks");
    expect(html).toContain("R-01-recovery-counterfactual-olmocr-2026-08-08.json");
  });

  it("never prints a price per page", () => {
    expect(text.toLowerCase()).not.toMatch(/per 1,?000 pages\s*\$/);
    expect(text.toLowerCase().match(/\$[\d.]+\s*\/\s*page/g) ?? []).toEqual([]);
  });

  /* 2026-11-10 (founder direction): intended re-pin. The GDP.pdf run page stays reachable at its URL, noindex, and unlinked. */
  it("neither links nor imports the GDP.pdf run page", () => {
    expect(html).not.toContain("/benchmarks/gdp-pdf");
    expect(read("app/benchmarks/page.tsx")).not.toMatch(/from\s+["'].*benchmarks\/gdp-pdf/);
  });

  it("does not restate a competitor's leaderboard row as a result", () => {
    for (const name of ["Reducto", "LlamaParse", "LlamaIndex", "Mistral OCR", "Unstructured"]) {
      expect(text).not.toContain(name);
    }
  });

  it("prints no local filesystem path", () => {
    expect(html).not.toContain("C:/");
    expect(html).not.toContain("Users/");
  });
});

/*
  2026-11-10: the document-reader board, its chart component and its stylesheet were deleted with
  the rest of the internal model-selection material, so their 360px and scroll-frame invariants
  went with them. The reduced-motion check on the evidence highlight stays.
*/
describe("reduced motion", () => {
  it("animates nothing in the evidence highlight, so there is nothing for reduced motion to turn off", () => {
    const file = read("components/evidence/region-highlight.module.css");
    expect(file).not.toMatch(/\btransition\s*:/);
    expect(file).not.toMatch(/\banimation\s*:/);
    expect(file).not.toMatch(/@keyframes/);
  });
});
