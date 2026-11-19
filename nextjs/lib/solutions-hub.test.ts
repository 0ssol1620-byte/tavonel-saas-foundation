import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { HERO, TASKS } from "@/components/v34/routes/solutions/solutions-content";
import { v34Route } from "@/lib/v34/routes";

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

  V34 (D33 §4 #18): the hub's body is `components/v34/routes/solutions/solutions.tsx` and its words
  are `solutions-content.ts`; `app/solutions/page.tsx` is the thin registry page. Every check below
  is the same invariant it was, read from where the hub now lives.
*/

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
const page = read("../app/solutions/page.tsx");
const hub = read("../components/v34/routes/solutions/solutions.tsx");
const words = read("../components/v34/routes/solutions/solutions-content.ts");
const css = read("../components/v34/routes/solutions/solutions.module.css");
const detail = read("../app/solutions/[slug]/page.tsx");
const slugs = [...detail.matchAll(/^ {2}"([a-z-]+)": \{\r?$/gm)].map((match) => match[1]!);

/*
  Comments explain what is deliberately absent and must not themselves count as present -- the
  same reason `public-copy-purge.test.ts` strips before it matches.
*/
const strip = (text: string) => text
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");
const shipped = strip(hub);
const shippedWords = strip(words);

describe("the solutions hub", () => {
  it("reads its cards from the record the detail pages render", () => {
    expect(detail).toContain("export const SOLUTIONS = {");
    expect(hub).toContain('import { SOLUTIONS } from "@/app/solutions/[slug]/page";');
    expect(hub).toContain("Object.entries(SOLUTIONS)");
  });

  it("writes no solution of its own", () => {
    expect(slugs.length).toBeGreaterThanOrEqual(5);
    for (const slug of slugs) {
      for (const [file, text] of [["solutions.tsx", shipped], ["solutions-content.ts", shippedWords]] as const) {
        expect(text, `${slug} is written into ${file} instead of read from the record`).not.toContain(`"${slug}"`);
      }
    }
  });

  /*
    Named in the masterplan, with no route. A card for it would be a link the router answers
    with a 404, which is worse than a hub that lists five.
  */
  it("offers no destination that does not exist", () => {
    for (const text of [shipped, shippedWords]) {
      expect(text).not.toContain("technical-document-assistant");
      expect(text).not.toContain("/cookbooks");
    }
    expect(shipped, "one card per record, linked by its own slug").toContain("/solutions/${slug}");
  });

  it("prints the reader each card is for, the way the detail page does", () => {
    expect(hub).toContain("For: {solution.audience}");
    expect(detail).toContain("For: {solution.audience}");
  });

  /*
    BA-040 moved a disclaimer out of the lede to the foot; the 2026-11-10 founder rule (label what
    a thing IS, never a defensive "not ..." sentence) retires it. The invariant that survives: the
    section that lists the five pages says what a reader finds on one -- the workflow, a sample
    source and the published limits -- and no "not ... customer" sentence stands in for that.
  */
  it("says what a solution page is before a reader opens one", () => {
    expect(shipped).toMatch(/<Section[^>]*title=\{TASKS\.title\}[^>]*lead=\{TASKS\.lead\}/);
    for (const part of ["workflow", "sample source", "published limits"]) expect(TASKS.lead).toContain(part);
    for (const text of [shipped, shippedWords]) expect(text).not.toMatch(/not (?:completed )?customer/);
  });

  /*
    BA-040 in the cards, BA-052 on the surface, BA-054 in the eyebrow: three halves of the same
    first impression -- five cards that end on a complaint under a rule line, that look clickable
    and are not, under a heading whose descriptor slot is filled with our own brand name.
  */
  it("makes the task concrete before a reader opens a detail", () => {
    const card = shipped.match(/<dl className=\{s\.task\}[\s\S]*?<\/dl>/)?.[0] ?? "";
    expect(card, "the card markup is still where this can read it").not.toBe("");
    expect(card).toContain('aria-label="Input, action and output"');
    for (const field of ["input", "action", "output"]) expect(card).toContain(`{solution.task.${field}}`);
    expect(shipped).not.toContain("{solution.problem}");
  });

  it("makes the whole card the target it looks like", () => {
    expect(shipped.match(/<Link\b/g), "one link per card, not a second anchor wrapped round the first").toHaveLength(1);
    expect(shipped).toContain("<Link className={s.link}");
    expect(css).toMatch(/\.card \{[^}]*position: relative/);
    expect(css, "the title anchor is expanded over the article").toMatch(/\.link::after \{[^}]*inset: 0/);
    expect(css, "and the surface answers a pointer").toMatch(/\.card:hover/);
    expect(css, "and a keyboard").toMatch(/\.link:focus-visible/);
  });

  /*
    BA-054 was that the eyebrow's descriptor slot held our own brand name -- "SOLUTIONS ·
    TAVONEL" -- so the first line of the page said nothing. In V34 the h1 is the shared Hero's,
    its words are the registry title, and the eyebrow the Hero carries may not be the brand.
  */
  it("leads with the heading rather than a label above it", () => {
    expect(shipped.match(/<Hero\b/g)).toHaveLength(1);
    expect(shipped).not.toMatch(/<h1\b/);
    // the registry heading: the title without " — TAVONEL" (V34RouteRecord.heading since route batch 2)
    expect(shipped).toContain("title={route.heading}");
    expect(HERO.eyebrow).not.toMatch(/tavonel/i);
  });

  /* `/resources` is a 308 to `/journal` (D33 §1.1); the hub ends on the field guides there. */
  it("ends at the field guides and the closing action", () => {
    expect(words).toContain('href: to("journal")');
    expect(shipped).toMatch(/<Bridge\b[\s\S]*<FinalCta\b/);
  });

  it("is canonical, indexable and in the sitemap", () => {
    expect(page).toContain('routeMetadata("solutions")');
    expect(v34Route("solutions").path).toBe("/solutions");
    expect(page).not.toMatch(/robots:\s*\{[^}]*index:\s*false/);
    expect(sitemap().map((entry) => new URL(entry.url).pathname)).toContain("/solutions");
  });
});
