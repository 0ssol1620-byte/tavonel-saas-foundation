import { describe, expect, it } from "vitest";
import { entityTerms, entityTier, EVIDENCE_WINDOW_CHARACTERS, evidenceWindow, markedWindow, questionTerms, termSpread } from "./ask-evidence-window";
import { tokens } from "./lexical-tokens";

const regions = (rows: Array<[string, string]>) => rows.map(([source, text]) => ({ source, tokens: new Set(tokens(text)) }));

describe("entity terms", () => {
  const world = regions([
    ["s1", "Quillmore Dynamics revenue 2023"],
    ["s2", "Brakewell revenue 2023"],
    ["s3", "Corvanta revenue 2023"],
  ]);

  it("are the question's non-numeric words found in fewer sources than its most widespread word", () => {
    const terms = questionTerms("What was Quillmore revenue in 2023?");
    expect(entityTerms(terms, world).map(term => term.term)).toEqual(["quillmore"]);
  });

  it("fall back to the most widespread number when every word is equally widespread (a name and a year)", () => {
    expect(entityTerms(questionTerms("Quillmore 2023"), world).map(term => term.term)).toEqual(["quillmore"]);
  });

  it("are none when every question word is equally widespread, so nothing is reordered", () => {
    expect(entityTerms(questionTerms("revenue 2023"), world)).toEqual([]);
    expect(entityTerms(questionTerms("Quillmore Dynamics"), world)).toEqual([]);
    expect(entityTier([], new Set(["revenue"]))).toBe(0);
  });

  it("never include a year or a number, however rare", () => {
    const terms = questionTerms("Brakewell revenue 1999");
    const rare = regions([["s1", "1999"], ["s2", "Brakewell revenue"], ["s3", "Corvanta revenue"]]);
    expect(entityTerms(terms, rare).map(term => term.term)).toEqual(["brakewell"]);
  });

  it("skip two-letter Latin function words", () => {
    expect(questionTerms("revenue in 2023 of Quillmore").map(term => term.term)).toEqual(["revenue", "2023", "quillmore"]);
  });

  it("tier a region holding the entity term above one holding only the year and the line item", () => {
    const terms = questionTerms("Quillmore revenue 2023");
    const entities = entityTerms(terms, world);
    expect(entityTier(entities, new Set(["quillmore"]))).toBe(1);
    expect(entityTier(entities, new Set(["revenue", "2023"]))).toBe(0);
  });

  it("tier holding any entity term the same, so two rare words never outrank one", () => {
    const terms = questionTerms("Quillmore Dynamics say revenue");
    const world4 = regions([["s1", "Quillmore Dynamics revenue"], ["s2", "say revenue"], ["s3", "revenue"]]);
    const entities = entityTerms(terms, world4);
    expect(entities.map(term => term.term)).toEqual(["quillmore", "dynamics", "say"]);
    expect(entityTier(entities, new Set(["quillmore", "dynamics"]))).toBe(1);
    expect(entityTier(entities, new Set(["say", "revenue"]))).toBe(1);
  });
});

describe("evidence window", () => {
  const terms = questionTerms("Quillmore revenue 2023");
  const ONE = terms.map(() => 1);

  it("is the whole region, verbatim, when it fits", () => {
    const text = "  Revenue 2023\n\tNet income 12  ";
    const window = evidenceWindow(text, terms, ONE, []);
    expect(text.slice(window.start, window.end)).toBe("Revenue 2023\n\tNet income 12");
    expect(window.regionLength).toBe(text.length);
  });

  it("holds the line with the question's line-item word and cuts on line boundaries", () => {
    const filler = Array.from({ length: 80 }, (_, index) => `Line item ${index} 1,234 5,678`);
    filler.splice(60, 0, "Revenue 48,215 44,907");
    const text = ["Quillmore Dynamics statement (in thousands)", ...filler].join("\n");
    // The company's three cited regions all name it; only this one holds the line item.
    const spread = termSpread(terms, [new Set(tokens(text)), new Set(["quillmore"]), new Set(["quillmore", "2023"])]);
    expect(spread).toEqual([3, 1, 1]);
    const window = evidenceWindow(text, terms, spread, []);
    const excerpt = text.slice(window.start, window.end);
    expect(excerpt).toContain("Revenue 48,215 44,907");
    expect(excerpt.length).toBeLessThanOrEqual(EVIDENCE_WINDOW_CHARACTERS);
    expect(window.start === 0 || text[window.start - 1] === "\n").toBe(true);
    expect(window.end === text.length || text[window.end] === "\n").toBe(true);
    expect(window.end - window.start).toBeLessThan(window.regionLength);
  });

  it("gives a region with no question word its opening, not a matching span", () => {
    const text = Array.from({ length: 50 }, (_, index) => `Unrelated caption ${index}.`).join("\n");
    const window = evidenceWindow(text, terms, ONE, []);
    expect(window.start).toBe(0);
    expect(text.slice(window.start, window.end).startsWith("Unrelated caption 0.")).toBe(true);
  });

  it("cuts a long line at a sentence end, then at whitespace", () => {
    const sentence = `${"word ".repeat(30)}end.`;
    const text = `${sentence} ${sentence} Revenue grew in 2023. ${sentence}`;
    const window = evidenceWindow(text, terms, ONE, []);
    const excerpt = text.slice(window.start, window.end);
    expect(excerpt).toContain("Revenue grew in 2023.");
    expect(excerpt.length).toBeLessThanOrEqual(EVIDENCE_WINDOW_CHARACTERS);
    expect(/[.\s]/.test(text[window.end - 1]!) || window.end === text.length).toBe(true);
  });

  it("stays bounded and fast on a 1,000,000-character region, with or without whitespace", () => {
    for (const text of [`${"x".repeat(999_990)} revenue`, `${"lorem ipsum ".repeat(83_333)}revenue 2023`, "🙂".repeat(500_000), `a${"🙂".repeat(499_999)}`]) {
      const started = performance.now();
      const window = evidenceWindow(text, terms, ONE, []);
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(window.end - window.start).toBeLessThanOrEqual(EVIDENCE_WINDOW_CHARACTERS);
      expect(window.end).toBeGreaterThan(window.start);
      // Never a lone surrogate at either edge (a lone one is replaced by U+FFFD when re-encoded).
      const excerpt = text.slice(window.start, window.end);
      expect(Buffer.from(excerpt, "utf8").toString("utf8")).toBe(excerpt);
    }
  });

  it("refuses a blank region instead of returning an empty excerpt", () => {
    expect(() => evidenceWindow(" \n\t ", terms, ONE, [])).toThrow("evidence_window_blank_region");
  });

  it("marks each cut edge in the answer part, and only a cut edge", () => {
    const text = "  Header line\nRevenue 2023 48,215\nTrailer line  ";
    expect(markedWindow(text, { start: 14, end: 33, regionLength: text.length })).toBe("… Revenue 2023 48,215 …");
    expect(markedWindow(text, { start: 2, end: 33, regionLength: text.length })).toBe("Header line\nRevenue 2023 48,215 …");
    expect(markedWindow(text, { start: 2, end: 46, regionLength: text.length })).toBe("Header line\nRevenue 2023 48,215\nTrailer line");
    const long = "x ".repeat(5_000);
    const window = evidenceWindow(long, terms, ONE, []);
    expect(markedWindow(long, window).length).toBeLessThanOrEqual(420);
  });

  it("refuses a spread that does not describe the question's terms", () => {
    for (const spread of [[1, 1], [1, Number.NaN, 1], [1, -1, 1], [1, 1.5, 1]]) {
      expect(() => evidenceWindow("Revenue 2023", terms, spread, [])).toThrow("evidence_window_spread_invalid");
    }
  });
});
