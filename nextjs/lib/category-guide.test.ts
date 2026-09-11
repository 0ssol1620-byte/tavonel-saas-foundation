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
  /*
    A negative assertion reads the page with its rationale stripped out, the same way
    `public-copy-purge.test.ts` does. Several of these comments name a retired phrase in order to
    record why it went, and a check that could not tell a comment from copy would make the file
    unable to explain its own history.
  */
  const shipped = solutions.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

  it("gives all five a limitations list the page renders", () => {
    expect((solutions.match(/limitations: \[/g) ?? [])).toHaveLength(5);
    expect(solutions).toContain("solution.limitations.map");
    /*
      BA-044 retitled the fold. "WHERE THIS STOPS" is how we describe scope internally and reads
      as a warning label to a buyer, so the same content is now titled as the decision input it
      is. The fold is still required here, and the old title is refused so it cannot return.
    */
    expect(solutions).toContain("WHAT TO PLAN FOR");
    expect(solutions).toContain("Before your first compile");
    expect(shipped).not.toContain("WHERE THIS STOPS");
  });

  it("names real limits rather than solved problems", () => {
    /*
      The abstention sentinel is the CORRECTED wording, not the old one (stage 2 C14).

      It read "abstains", which the page satisfied with "The World abstains where the sources do
      not support an answer." -- a sentence the evidence lane measured as false: abstention is an
      eligibility test, and both retrieval paths answered every deliberately unanswerable question.
      So the sentinel is the narrower claim the page actually keeps, which also means the overclaim
      cannot come back by rewording: this test needs the limit named, and
      product-claims-sync.test.ts bans the four assertive forms of the old one.

      Three of the five sentinels moved with BA-042, BA-049 and BA-050, and each is now the fact
      rather than our internal state of it. The claim each one guards is unchanged:

      - BA-042: "declines when no evidence matched" -> "declines when nothing matched at all". The
        page had promised "Explicit abstention" as an outcome and then withdrawn it forty lines
        later; the outcome is now the fact and the limit still says exactly where the decline
        does and does not happen. The extra sentinel pins the half that used to be missing --
        that judging whether a match answers the question is the reader's.
      - BA-049: "Membership is not available" -> the commercial fact it was hiding behind an
        engineering milestone. `billing-catalog.ts` has Team as `saleChannel: "contact"`, so the
        sentinel is the sentence that says it is not a checkout -- which is also the rule the
        entitlements lane requires of every surface.
      - BA-050: "not calibrated" -> the review behaviour a buyer plans around. The uncalibrated
        threshold itself is not deleted from the site: `lib/evidence-record.ts` publishes "Most
        thresholds are uncalibrated" as a first-class row on /evidence, and this asserts that,
        so the fact cannot leave the site by way of this page being tidied.
    */
    const sentinels = [
      "declines when nothing matched at all",
      "is the reader’s call",
      "rather than bought at a checkout",
      "held for review with the regions that support each side",
      "is an estimate",
      "human decision",
    ];
    for (const phrase of sentinels) expect(solutions, phrase).toContain(phrase);
    for (const retired of ["Explicit abstention", "not calibrated", "Membership is not available"]) {
      expect(shipped, `${retired} was reframed and must not come back`).not.toContain(retired);
    }
    expect(
      readFileSync(resolve(import.meta.dirname, "./evidence-record.ts"), "utf8"),
      "the uncalibrated-threshold statement stays published on /evidence",
    ).toContain("Most thresholds are uncalibrated");
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
