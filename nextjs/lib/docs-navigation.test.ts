import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { slugify, tocEntries } from "@/components/docs/page-toc";
import { SECTION_LABEL } from "./cookbook-content";
import { DOCS_GROUPS, DOCS_SECTIONS } from "./docs-content";

/*
  The two indexes a documentation page carries, and the ways each of them fails quietly.

  The section index (`DocsToc`) is a persistent list of every section beside the article, and its
  failure mode is not a crash: it is a list that no longer marks where you are, or a mobile
  disclosure that ships as an open panel above every page, or -- the worst of the three -- a
  second copy of the list whose ids collide with the first and break every jump link on the
  page. None of those throw.

  The in-page index (`PageToc`) is jump links, and its failure mode is a fragment that points at
  the wrong block. That is why the id is derived from the label and deduplicated, and why both
  halves are tested here rather than looked at.

  Rendering is not asserted through a DOM: this suite runs in Node with no jsdom and no testing
  library, and the interesting properties are either pure (the ids) or structural (what the
  server component's source contains). Geometry and overflow are Playwright's job --
  `e2e/overflow-audit.spec.ts` walks /docs/quickstart at seven widths.
*/

/* Line endings are normalised so a multi-line expectation below does not depend on them. */
const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8").replace(/\r\n/g, "\n");
const sectionPage = read("../app/docs/[section]/page.tsx");
const docsToc = read("../components/docs/docs-toc.tsx");
const tocCss = read("../components/docs/docs-toc.module.css");

describe("in-page table of contents", () => {
  it("derives a fragment from the text of the heading", () => {
    expect(slugify("Steps 1 to 4 — bash")).toBe("steps-1-to-4-bash");
    expect(slugify("claude_desktop_config.json / .mcp.json")).toBe("claude-desktop-config-json-mcp-json");
    expect(slugify("POST /compile-jobs")).toBe("post-compile-jobs");
  });

  it("never emits the same id twice, and never emits an empty one", () => {
    const entries = tocEntries(["Every request", "Every request", "———", "———"]);
    expect(entries.map((entry) => entry.id)).toEqual(["every-request", "every-request-2", "section", "section-2"]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    for (const entry of entries) expect(entry.id.length, JSON.stringify(entry)).toBeGreaterThan(0);
  });

  it("keeps the label the reader clicks and the fragment it lands on together", () => {
    const entries = tocEntries(["Resume after a disconnect"]);
    expect(entries).toEqual([{ id: "resume-after-a-disconnect", label: "Resume after a disconnect" }]);
  });

  /*
    The threshold, and the reason it is in the component rather than at each call site: a
    two-entry contents list costs a screenful and saves nobody a scroll, and a call site that
    forgot the check would ship one.
  */
  it("renders nothing until a page has three places to jump to", () => {
    const source = read("../components/docs/page-toc.tsx");
    expect(source).toContain("if (entries.length < 3) return null;");
  });

  it("is wired into the section page from the same data as the blocks", () => {
    expect(sectionPage).toContain("<PageToc entries={toc} />");
    expect(sectionPage).toContain("id={anchorIds.get(position)}");
    /*
      BA-201. The label used to come from a code block's caption or an endpoint's method and
      path, because those were the only labelled blocks the section data had -- so the jump list
      on the quickstart named three languages and no concept. The sections carry real
      subheadings now, and the rail lists those and nothing else; a code block or an endpoint is
      reached through the heading that introduces it.
    */
    expect(sectionPage).toContain('return block.kind === "heading" ? block.text : null;');
    expect(sectionPage, "a code caption is not a landmark").not.toContain("if (block.kind === \"code\") return block.label;");
  });

  /*
    Exported so the cookbook route can reuse it rather than growing a second jump list with its
    own slug rules. Named here because an export with no importer is the first thing a cleanup
    deletes.
  */
  it("exports the component and its id helper", () => {
    const source = read("../components/docs/page-toc.tsx");
    expect(source).toContain("export function PageToc(");
    expect(source).toContain("export function tocEntries(");
  });

  /*
    The cookbook route reuses it, which is the reason the export exists.

    That route shipped its own `<nav aria-label="Sections on this page">` with ids typed as
    `#cookbook-${section.key}` -- a second jump list with a second set of slug rules, and two
    strings that had to agree for a link to land. It now derives both halves from one
    `tocEntries` call, so the anchor and the link that names it cannot disagree, and the
    `scroll-margin-top` that keeps a heading out from under the fixed header comes with it
    instead of being rediscovered. The last assertion is the one that stops the old list
    growing back beside the new one.
  */
  it("is reused by the cookbook route rather than copied", () => {
    const cookbook = read("../app/cookbooks/[slug]/page.tsx");
    expect(cookbook).toContain('import { PageToc, tocEntries } from "@/components/docs/page-toc";');
    expect(cookbook).toContain("<PageToc entries={toc} />");
    /*
      BA-178 moved the six run-dependent sections out of the body and into one closing block, so
      the jump list is the ready sections plus that block rather than all twelve labels. Still one
      `tocEntries` call and still one derivation: the ids are joined back by the same order the
      page renders, which is what this pins.
    */
    expect(cookbook).toContain("const toc = tocEntries([...ready.map((section) => SECTION_LABEL[section.key]), PENDING_HEADING]);");
    expect(cookbook).toContain("id={toc[ready.length]!.id}");
    // The id and the anchor class sit on the element the link points at.
    expect(cookbook).toContain('<h2 id={id} className={anchor.anchor}>');
    expect(cookbook).toContain("id={toc[order]!.id}");
    expect(cookbook).not.toContain("#cookbook-");
    expect(cookbook).not.toContain('aria-label="Sections on this page"');
    // Six ready sections and the closing block, so the component's three-entry threshold cannot
    // silence this page. The label set is still checked for collisions across all twelve, because
    // a run opening a locked section brings its label back into the same list.
    expect(Object.keys(SECTION_LABEL).length).toBeGreaterThanOrEqual(3);
    expect(tocEntries(Object.values(SECTION_LABEL)).map((entry) => entry.id))
      .toHaveLength(Object.keys(SECTION_LABEL).length);
  });
});

/*
  BA-202. The eyebrow above every title on these five pages was `<b>LABEL</b><span />TEXT`, with
  the empty span styled as a 34px rule. A rule is not a character: the accessible name and every
  text extraction read the two clauses as one word -- "DEVELOPERSONE WORLD",
  "DOCUMENTATIONAPI 2026-09-02.1", "DOCUMENTATIONAll sections".

  The fix is the audit's second option: mark the rule decorative, and put a real separator in the
  text. So the pattern this pins is the absence of a bare `<span />` between two clauses.
*/
describe("eyebrow labels read as two clauses", () => {
  const SURFACES = [
    "../app/developers/page.tsx",
    "../app/docs/page.tsx",
    "../app/docs/[section]/page.tsx",
    "../app/cookbooks/[slug]/page.tsx",
    "../app/ko/page.tsx",
  ];

  it.each(SURFACES)("%s separates the label from the text it sits beside", (surface) => {
    const source = read(surface);
    /*
      Every `.slate` eyebrow on the page, and what follows the rule inside it. A two-clause
      eyebrow (one with a <b>) has to carry a separator; a one-clause eyebrow, where the rule
      leads and there is nothing before it, needs none -- but the rule is decorative either way.
    */
    const eyebrows = [...source.matchAll(/<p className="slate">([\s\S]*?)<\/p>/g)].map((match) => match[1]!);
    expect(eyebrows.length, surface + " renders no eyebrow -- the pattern has moved").toBeGreaterThan(0);
    for (const eyebrow of eyebrows) {
      expect(eyebrow, "the rule is decorative and says so: " + eyebrow).not.toContain("<span />");
      // A separator is owed only where there are two clauses: a label, the rule, and text after
      // it. A one-clause eyebrow -- a bare label, or a rule that leads -- has nothing to separate.
      const after = eyebrow.split('<span aria-hidden="true" />')[1] ?? "";
      if (!eyebrow.includes("<b>") || after.trim() === "") continue;
      expect(eyebrow, "two clauses fused into one accessible name: " + eyebrow).toMatch(/\/>·/);
    }
  });
});

describe("documentation section index", () => {
  it("lists every group and every section, from the documentation data", () => {
    expect(docsToc).toContain("DOCS_GROUPS.map");
    expect(docsToc).toContain("DOCS_SECTIONS.filter((section) => section.group === group)");
    // Not a second hand-written list: there are twenty-two sections and five groups, and the
    // component names none of them.
    for (const section of DOCS_SECTIONS) expect(docsToc, section.slug).not.toContain(`"${section.slug}"`);
    for (const group of DOCS_GROUPS) expect(docsToc, group).not.toContain(`"${group}"`);
  });

  it("marks the section being read, with the attribute assistive technology reads", () => {
    expect(docsToc).toContain('aria-current={section.slug === current ? "page" : undefined}');
    expect(tocCss).toContain('.list a[aria-current="page"]');
  });

  it("needs no client JavaScript: a details element and real links", () => {
    expect(docsToc).not.toContain("use client");
    expect(docsToc).not.toContain("useState");
    expect(docsToc).toContain("<details");
    expect(docsToc).toContain("<summary>Docs index</summary>");
    // Closed by default is the whole point of the mobile rendering: an open panel would push
    // every article on the site down by twenty-two rows.
    expect(docsToc).not.toMatch(/<details[^>]*\sopen/);
  });

  it("exposes one Documentation landmark at a time and no ids to collide", () => {
    expect([...docsToc.matchAll(/aria-label="Documentation"/g)]).toHaveLength(2);
    expect(tocCss).toContain(".column { display: none; }");
    expect(tocCss).toContain(".disclosure { display: none; }");
    // Two renderings of one list: an id in either of them would be duplicated in the document.
    expect(docsToc).not.toContain("id=");
  });

  it("is a sibling of the two-column body, not a third child of it", () => {
    // e2e/public-layout-balance.spec.ts asserts `main .body` never has more than two visible
    // direct children; putting the index inside it would fail that on every docs section.
    expect(sectionPage).toContain([
      '<div className={layout.layout}>',
      '        <DocsToc current={section} />',
      '        <div className="body">',
    ].join("\n"));
  });

  it("keeps the pager and the way back to the index", () => {
    expect(sectionPage).toContain('className="docs-pager"');
    expect(sectionPage).toContain('<Link href="/docs">All sections</Link>');
  });

  it("swaps column for disclosure at the width the site header does", () => {
    expect(tocCss).toContain("@media (min-width: 1080px)");
    expect(read("../app/tavonel.css")).toContain("@media (max-width: 1079px)");
  });
});
