import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";

/*
  The /solutions hub, and the one thing that can go wrong with it that nobody would notice.

  A hub is a list, and a hand-written list of five cards beside five pages of content is two
  sources for the same fact. The failure is silent in both directions: a sixth solution ships
  and the hub keeps showing five, or a solution is renamed and the hub keeps a card whose link
  404s. So the hub reads the `SOLUTIONS` record from the page that renders the detail, and this
  file's job is to keep it that way -- by reading both sources and refusing any card the record
  does not produce.

  It is source-text checking rather than rendering because this suite runs in Node against a
  server component tree; what is worth asserting here is the data path, and Playwright walks the
  rendered page (`e2e/overflow-audit.spec.ts` at seven widths).
*/

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
const hub = read("../app/solutions/page.tsx");
const detail = read("../app/solutions/[slug]/page.tsx");
const slugs = [...detail.matchAll(/^ {2}"([a-z-]+)": \{\r?$/gm)].map((match) => match[1]!);

/*
  Comments explain what is deliberately absent and must not themselves count as present -- the
  same reason `public-copy-purge.test.ts` strips before it matches. The hub's own comment names
  the solution it does not list.
*/
const shipped = hub
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");

describe("the solutions hub", () => {
  it("reads its cards from the record the detail pages render", () => {
    expect(detail).toContain("export const SOLUTIONS = {");
    expect(hub).toContain('import { SOLUTIONS } from "./[slug]/page";');
    expect(hub).toContain("Object.entries(SOLUTIONS)");
  });

  it("writes no solution of its own", () => {
    expect(slugs.length).toBeGreaterThanOrEqual(5);
    for (const slug of slugs) {
      expect(shipped, `${slug} is written into the hub instead of read from the record`)
        .not.toContain(`"${slug}"`);
    }
  });

  /*
    Named in the masterplan, with no route. A card for it would be a link the router answers
    with a 404, which is worse than a hub that lists five.
  */
  it("offers no destination that does not exist", () => {
    expect(shipped).not.toContain("technical-document-assistant");
    expect(shipped).not.toContain("/cookbooks");
    expect(shipped, "one card per record, linked by its own slug").toContain("/solutions/${slug}");
  });

  it("prints the reader each card is for, the way the detail page does", () => {
    expect(hub).toContain("For: {solution.audience}");
    expect(detail).toContain("For: {solution.audience}");
  });

  it("says what a solution page is before a reader opens one", () => {
    expect(hub).toContain("A described use is not a completed");
  });

  it("ends at the resources hub and the documentation", () => {
    expect(hub).toContain('href="/resources"');
    expect(hub).toContain('href="/docs"');
  });

  it("is canonical, indexable and in the sitemap", () => {
    expect(hub).toContain('alternates: { canonical: "/solutions" }');
    expect(hub).not.toMatch(/robots:\s*\{[^}]*index:\s*false/);
    expect(sitemap().map((entry) => new URL(entry.url).pathname)).toContain("/solutions");
  });
});
