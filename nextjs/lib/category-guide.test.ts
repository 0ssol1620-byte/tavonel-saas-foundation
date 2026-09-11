import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_SECTIONS } from "./docs-content";

/*
  The category page, against the list masterplan 13.11 gave it.

  This is a source assertion rather than a render test on purpose. Everything 13.11 asks for is
  content -- a comparison drawing, when to use one, when not to, a glossary, a FAQ, the package
  contract, a way onward -- and content is what gets quietly trimmed when a page is restyled. A
  render test would keep passing on a page that had lost half of them.

  The one thing it cannot check is whether the sentences are true. That is a person's job.
*/

const page = readFileSync(resolve(import.meta.dirname, "../app/knowledge-compiler/page.tsx"), "utf8");

/**
 * The file without its comments.
 *
 * The page explains in a comment which badge 13.11 asked to delete, and quotes it. A check for
 * the absence of a string has to be a check on what renders, or the explanation of a removal
 * reads as the removal not having happened.
 */
function rendered(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const diagram = readFileSync(resolve(import.meta.dirname, "../components/knowledge-compiler-diagram.tsx"), "utf8");

describe("what 13.11 asked to be added", () => {
  it("draws the comparison instead of only arguing it four times", () => {
    expect(page).toContain("<KnowledgeCompilerDiagram />");
    // The point of the drawing: one pipeline, four spans. A picture of four separate products
    // would be the same four comparisons again, in shapes.
    for (const stage of ["SOURCES", "READ", "STRUCTURE", "EVIDENCE", "WORLD", "PROJECTIONS"]) {
      expect(diagram, stage).toContain(stage);
    }
    for (const category of ["Enterprise search", "Knowledge graph", "RAG", "Knowledge Compiler"]) {
      expect(diagram, category).toContain(category);
    }
  });

  it("gives the drawing a text alternative that carries the same argument", () => {
    // An SVG whose meaning is its arrangement is invisible without one.
    expect(diagram).toContain('role="img"');
    expect(diagram).toContain("aria-labelledby");
    expect(diagram).toContain("<desc");
    expect(diagram).toMatch(/spans all six/);
  });

  it("says when to use one and, more importantly, when not to", () => {
    expect(page).toContain("When a compiler is the right tool");
    expect(page).toContain("When it is not the right tool");
    /*
      The four cases are the check that matters. A "when not to" section listing only problems
      the product happens to solve anyway is an advertisement with a humble heading, so each of
      these names something this product genuinely does not do.
    */
    for (const key of ["ONE DOCUMENT", "LIVE RECORDS", "NO REVIEWER", "BEYOND THE SOURCES"]) {
      expect(page, key).toContain(key);
    }
  });

  it("carries a glossary and a FAQ", () => {
    expect(page).toContain('title: "Glossary"');
    expect(page).toContain("faq: [");
    const questions = [...page.matchAll(/question: "/g)];
    expect(questions.length).toBeGreaterThanOrEqual(5);
  });

  it("points at the package contract by its real sections, and at a way onward", () => {
    const slugs = DOCS_SECTIONS.map((section) => section.slug);
    for (const target of ["exports", "cli"]) {
      // A link to a documentation section that does not exist is a 404 on the page whose
      // subject is portability.
      expect(slugs, target).toContain(target);
      expect(page).toContain(`/docs/${target}`);
    }
    expect(page).toContain("/explore");
    expect(page).toContain("/login");
    expect(page).toContain("START WITH YOUR FILES");
  });
});

describe("what 13.11 asked to be removed", () => {
  it("does not wear the badge that argued with the reader", () => {
    expect(rendered(page)).not.toContain("NOT A PERFORMANCE CLAIM");
    // `state` is the badge prop. The registries that report measurements still pass one; a
    // category guide passing one is the defect 13.11 named.
    expect(page).not.toMatch(/\bstate=\{?"/);
  });
});

describe("every solution page says where it stops too", () => {
  /*
    13.22 asks each solution page for its limitations, and it is the section that decides
    whether the rest of the page is a description or a pitch. The check is that each list names
    something the product does not do -- an abstention, an uncalibrated threshold, a tenancy
    limit -- rather than a difficulty it happens to solve.
  */
  const solutions = readFileSync(resolve(import.meta.dirname, "../app/solutions/[slug]/page.tsx"), "utf8");

  it("gives all five a limitations list the page renders", () => {
    expect((solutions.match(/limitations: \[/g) ?? [])).toHaveLength(5);
    expect(solutions).toContain("solution.limitations.map");
    expect(solutions).toContain("WHERE THIS STOPS");
  });

  it("names real limits rather than solved problems", () => {
    /*
      The abstention sentinel is the CORRECTED wording, not the old one (stage 2 C14).

      It read "abstains", which the page satisfied with "The World abstains where the sources do
      not support an answer." -- a sentence the evidence lane measured as false: abstention is an
      eligibility test, and both retrieval paths answered every deliberately unanswerable question.
      So the sentinel is now the narrower claim the page actually keeps, which also means the
      overclaim cannot come back by rewording: this test needs the limit named, and
      product-claims-sync.test.ts bans the four assertive forms of the old one.
    */
    for (const phrase of ["declines when no evidence matched", "not calibrated", "Membership is not available", "is an estimate", "human decision"]) {
      expect(solutions, phrase).toContain(phrase);
    }
  });
});

/*
  The 2026-09-11 brand fix, checked where it can regress silently.

  BA-017, BA-019 and BA-020 are structure rather than sentences: a page that lost the section index,
  re-split the comparison into three, stopped collapsing the reference sections or rendered both
  forms of the diagram at once would look fine in a screenshot at one width and be the defect the
  findings named at another. The diagram's two forms are a render assertion because the list is
  derived from the same two arrays as the drawing, and a `find` that matched the wrong span would
  print the wrong category under a stage with nothing else noticing.
*/
describe("the brand fix's structure", () => {
  const diagramCss = readFileSync(
    resolve(import.meta.dirname, "../components/knowledge-compiler-diagram.module.css"),
    "utf8",
  );

  it("renders the drawing and its phone list from the same data, and shows one at a time", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: Diagram } = await import("../components/knowledge-compiler-diagram");
    const html = renderToStaticMarkup(createElement(Diagram));

    // Both forms exist in the markup; CSS decides which one a width gets.
    expect(html).toContain("<svg");
    expect(html).toContain("<ol");
    for (const stage of ["SOURCES", "READ", "STRUCTURE", "EVIDENCE", "WORLD", "PROJECTIONS"]) {
      expect(html, stage).toContain(stage);
    }
    // Each single-stage span lands under its own stage, and the whole-line span is its own row.
    expect(html).toContain("Enterprise search finds the document");
    expect(html).toContain("Knowledge graph stores objects and relations");
    expect(html).toContain("RAG retrieves chunks at question time");
    expect(html).toContain("ALL SIX");
    expect(html).toContain("Knowledge Compiler compiles, binds evidence to regions, and versions the result");

    /*
      The swap, and the reason it is `display: none` on both sides: a visually-hidden list would
      be announced on top of the drawing's own title and description, so the six stages would
      reach a screen reader twice.
    */
    expect(diagramCss).toContain(".stack { display: none; }");
    expect(diagramCss).toMatch(/@media \(max-width: 640px\) \{\s*\.diagram \{ display: none; \}/);
    expect(diagramCss, "a hidden-but-rendered list would double-announce the stages")
      .not.toMatch(/\.stack \{[^}]*clip-path/);
  });

  it("keeps the section index, one comparison and the reference sections collapsed", () => {
    expect(page, "the index is what replaced having no way to skip").toContain("<PublicProofRegistry index");
    // Eight sections: the ten it had, with the three comparisons merged into one. Counted from
    // `sections={[` so the page's own <title> metadata is not one of them.
    const sections = page.slice(page.indexOf("sections={["));
    expect((sections.match(/title: "/g) ?? []).length).toBe(8);
    expect(page).toContain('title: "Compared with RAG, graphs and search"');
    expect(rendered(page), "the three separate comparisons must not come back")
      .not.toContain('title: "Compared with RAG"');
    expect((page.match(/collapsed: true/g) ?? []).length).toBe(3);
    for (const key of ["RAG", "KNOWLEDGE GRAPH", "ENTERPRISE SEARCH"]) {
      expect(page, key).toContain(`key: "${key}"`);
    }
  });

  it("ends on one primary and one secondary, with the references as a list", () => {
    const closing = page.slice(page.indexOf('title: "The package is the contract"'));
    expect(closing).toContain("readNext: [");
    expect((closing.match(/label: "/g) ?? []).length).toBe(6);
    // BA-016: the door describes the protocol behind it rather than announcing an absence.
    expect(rendered(page)).not.toContain("WHAT WOULD BE MEASURED");
    expect(closing).toContain('label: "How results are measured"');
  });
});

describe("what the page must not become", () => {
  it("claims no customer, certification or performance figure", () => {
    /*
      The failure mode for a category page is that it drifts into selling. The constitution's
      rule is that a number without a receipt is not published, and this page has no receipts,
      so it has no numbers.
    */
    expect(rendered(page)).not.toMatch(/trusted by|customers|certified|SOC 2|ISO 27001/i);
    const bodyText = page.match(/(?:body|description|answer|summary): "([^"]+)"/g) ?? [];
    for (const sentence of bodyText) {
      expect(sentence, sentence).not.toMatch(/\b\d+(?:\.\d+)?\s*(?:%|x faster|times faster)/);
    }
  });
});
