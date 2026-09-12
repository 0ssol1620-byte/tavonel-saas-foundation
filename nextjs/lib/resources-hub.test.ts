import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESOURCE_LINKS,
  RESOURCE_PURPOSES,
  RESOURCE_TAG_LABELS,
  RESOURCE_WORKFLOWS,
  resourceFilterHref,
} from "./site-navigation";
import { COOKBOOKS } from "./cookbook-content";

/*
  WG-048 / WG-051 / WG-074: the two ways the hub's filter can quietly stop working.

  It is data plus one CSS rule per tag, so the failure mode is never a crash. Either a new entry
  arrives untagged and disappears from every filtered view but "Everything", or a new tag arrives
  with no rule and its control does nothing at all. Both are checked here rather than noticed by
  a reader. The rule test is why the second is not paranoia: CSS Modules rewrites an id selector
  the way it rewrites a class, so a rule that loses its `:global()` wrapper looks for an id that
  is not in the document and filters nothing, with no error anywhere.

  WG-074 is the last of them: narrowing is presentational, so every description stays in the HTML
  at every filter state, for Ctrl+F and for a crawler.
*/

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
const ALL_TAGS = [...RESOURCE_PURPOSES, ...RESOURCE_WORKFLOWS];

describe("the resources hub can be narrowed by purpose and workflow", () => {
  it("tags every entry, so nothing drops out of a filtered view", () => {
    for (const link of RESOURCE_LINKS) {
      expect(link.purposes.length, `${link.href} carries no purpose tag`).toBeGreaterThan(0);
    }
  });

  it("offers no control that would empty the hub", () => {
    // Every control names a tag some entry actually carries: one selection can never match zero.
    for (const tag of ALL_TAGS) {
      const carriers = RESOURCE_LINKS.filter(
        (link) => [...link.purposes, ...link.workflows].some((carried) => carried === tag),
      );
      expect(carriers.length, `no resource carries the ${tag} tag`).toBeGreaterThan(0);
    }
  });

  it("has a hiding rule and a label for every tag", () => {
    const css = read("../app/resources/resources.module.css");
    for (const tag of ALL_TAGS) {
      expect(css, `resources.module.css has no :target rule for ${tag}`)
        .toContain(`.hub:has(:global(#find-${tag}):target) [data-tags]:not([data-tags~="${tag}"])`);
      expect(RESOURCE_TAG_LABELS[tag], `${tag} has no label`).toBeTruthy();
    }
  });

  it("keeps all nine descriptions in the HTML at every filter state", () => {
    /*
      WG-074. Narrowing happens in CSS over a fully rendered list, so the body stays searchable by
      Ctrl+F and by a crawler. A server-filtered page would drop the other entries out of the
      document, which is the thing this test exists to prevent, so the page maps the whole array
      and takes no search params.
    */
    const page = read("../app/resources/page.tsx");
    expect(page).toContain("RESOURCE_LINKS.map");
    expect(page).not.toContain("searchParams");
    expect(page).not.toContain('"use client"');
  });

  it("links only to pages that exist, and never to a draft cookbook", () => {
    const app = resolve(import.meta.dirname, "../app");
    for (const link of RESOURCE_LINKS) {
      expect(link.href, "the hub does not link to a proposed route").not.toContain("/cookbooks");
      expect(existsSync(resolve(app, `${link.href.slice(1)}/page.tsx`)), `${link.href} has no page`)
        .toBe(true);
    }
  });

  it("marks a representative case only where a real compiled result is published", () => {
    const representative = RESOURCE_LINKS.filter((link) => link.representativeCase);
    expect(representative.map((link) => link.href)).toEqual(["/explore"]);
  });
});

describe("a solution page hands the reader on to the hub and the docs", () => {
  const page = read("../app/solutions/[slug]/page.tsx");
  const slugs = [...page.matchAll(/^ {2}"([a-z-]+)": \{\r?$/gm)].map((match) => match[1]!);
  const tags = [...page.matchAll(/^ {4}resources: "([a-z-]+)",\r?$/gm)].map((match) => match[1]!);

  it("gives every solution a filter the hub actually has a control for", () => {
    expect(slugs.length).toBeGreaterThan(0);
    expect(tags).toHaveLength(slugs.length);
    for (const tag of tags) {
      expect(ALL_TAGS, `${tag} is not a hub tag`).toContain(tag);
    }
  });

  it("renders the filter link and the documentation link, and no cookbook link", () => {
    expect(page).toContain("resourceFilterHref(resourceTagOf(solution))");
    expect(page).toContain('href="/docs"');
    // A prose mention of the proposed route is fine; a link to it is not.
    expect(page, "a solution page must not point at a proposed route").not.toMatch(/href=.*cookbooks/);
  });

  it("builds the fragment the hub's controls answer to", () => {
    expect(resourceFilterHref("build")).toBe("/resources#find-build");
  });
});

/*
  B3. No route reaches a draft cookbook, asserted over the files rather than over one array.

  Two assertions above already cover the two ways it nearly happened: a `/cookbooks` href in
  `RESOURCE_LINKS`, and a `href=` to one in the solutions template. Neither covers a link written
  directly into the resources page's own markup, and neither covers the rest of
  `site-navigation.ts` -- `RESOURCE_LINKS` is one of several arrays in that file, and the footer and
  the nav are the other ways a page gets linked from everywhere at once.

  So the check is the file text with its comments removed, because all three files discuss
  `/cookbooks/*` in prose on purpose and a prose mention is not a link. It is conditioned on the
  records: the day one is approved this fails, and failing is correct -- approval is a deliberate
  edit in three places (the record, the sitemap's ROUTES, and this test), not a silent unlocking.
*/
describe("nothing links a draft cookbook", () => {
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const linkSources = [
    "../app/resources/page.tsx",
    "../app/resources/resources.module.css",
    "../app/solutions/[slug]/page.tsx",
    "./site-navigation.ts",
  ];

  it("holds only while every record is a draft", () => {
    expect(COOKBOOKS.map((record) => record.publication)).toEqual(Array(6).fill("draft"));
  });

  it.each(linkSources)("%s names no cookbook route outside a comment", (file) => {
    const source = withoutComments(read(file));
    expect(source, `${file} links a draft cookbook`).not.toContain("/cookbooks");
    // The stripper has to be doing something, or this test is vacuous on the two files that
    // discuss the route in prose.
    if (file.endsWith("page.tsx")) expect(source.length).toBeLessThan(read(file).length);
  });
});
