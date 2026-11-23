import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cssRules, inSentenceViolations } from "./in-sentence-guard";

/*
  WO-CI-30 item 3. The guard of lead decision 23 reads a sheet the way the browser applies it. Before this
  file the reader split a rule's body on ";" and a block nested inside a style rule
  (`.a { @media (x) { padding-block: 12px } }`, `.a { &:hover { ... } }`) read as one odd declaration name,
  which no property pattern matched -- so the nesting that could give a link a hit area passed. Each case
  below is a mutant of a plain link class: it must be named, and the plain class must pass.
*/

const PLAIN = ".a { display: inline; color: red; text-underline-offset: 3px; }\n.a:hover { color: blue; }\n.a:focus-visible { outline: 3px solid red; outline-offset: 3px; }\n";

describe("the sheet reader", () => {
  it("places a nested block as a rule of its own, with the conditions that hold it and its & resolved (a rule's own declarations come last)", () => {
    const rules = cssRules(".a { color: red; @media (pointer: coarse) { padding-block: 12px; } &:hover { color: blue; } .b & { display: block; } @supports (x: y) { @media (z) { top: 1px } } }");
    expect(rules).toEqual([
      { condition: "@media (pointer: coarse)", selector: ".a", declarations: [["padding-block", "12px"]] },
      { condition: "", selector: ":is(.a):hover", declarations: [["color", "blue"]] },
      { condition: "", selector: ".b :is(.a)", declarations: [["display", "block"]] },
      { condition: "@supports (x: y) @media (z)", selector: ".a", declarations: [["top", "1px"]] },
      { condition: "", selector: ".a", declarations: [["color", "red"]] },
    ]);
  });

  it("reads top-level at-rules, strings and url() with a semicolon, and a last declaration without one", () => {
    expect(cssRules('@import "x.css"; @media (max-width: 1px) { .a { color: red } } .b { background: url(data:image/png;base64,AA==); content: "}{;" }')).toEqual([
      { condition: "@media (max-width: 1px)", selector: ".a", declarations: [["color", "red"]] },
      { condition: "", selector: ".b", declarations: [["background", "url(data:image/png;base64,AA==)"], ["content", '"}{;"']] },
    ]);
  });

  it("reads an escaped quote and a comment-like text inside a string as text, and a nested selector list item by item", () => {
    expect(cssRules('.a { content: "x\\"}"; padding: 9px; }')).toEqual([
      { condition: "", selector: ".a", declarations: [["content", '"x\\"}"'], ["padding", "9px"]] },
    ]);
    expect(cssRules('.a { content: "/*"; } .b { color: red; } /* closed */')).toEqual([
      { condition: "", selector: ".a", declarations: [["content", '"/*"']] },
      { condition: "", selector: ".b", declarations: [["color", "red"]] },
    ]);
    expect(cssRules(".x { .y, .a { color: red; } }")[0]!.selector).toBe(":is(.x) .y, :is(.x) .a");
    expect(() => cssRules('.a { content: "x\\" }')).toThrow(/unterminated string/);
    expect(() => cssRules(".a { color: red; } /* open")).toThrow(/unterminated comment/);
  });

  it("refuses a sheet it cannot read instead of passing it", () => {
    expect(() => cssRules(".a { color: red")).toThrow(/unbalanced/);
    expect(() => cssRules(".a { color: red } }")).toThrow(/unbalanced/);
    expect(() => cssRules(".a { color }")).toThrow(/not a declaration/);
    expect(() => cssRules("color: red;")).toThrow(/outside any rule/);
    expect(() => cssRules('.a { content: "x }')).toThrow(/unterminated/);
  });
});

describe("what makes an in-sentence link class plain", () => {
  it("passes a plain inline class with paint-only states", () => {
    expect(inSentenceViolations(PLAIN, "a")).toEqual([]);
    expect(inSentenceViolations(`${PLAIN}@media (forced-colors: active) { .a { color: LinkText; } }`, "a")).toEqual([]);
    expect(inSentenceViolations(`${PLAIN}.a { &:hover { color: green; } }`, "a")).toEqual([]);
  });

  it("refuses a class the sheet does not define", () => {
    expect(inSentenceViolations(PLAIN, "b")).toEqual([".b: no rule outside every condition defines it"]);
    // Defined only inside a condition: still no base rule, so it is refused.
    expect(inSentenceViolations("@media (x) { .b { color: red } }", "b")).toEqual([".b: no rule outside every condition defines it"]);
  });

  // Each mutant puts a hit area, or something that moves or grows the box, where the guard has to see it.
  it.each([
    ["a nested at-rule with block padding", `${PLAIN}.a { @media (pointer: coarse) { padding-block: 12px; } }`],
    ["a nested at-rule with a min-height", `${PLAIN}.a { @media (max-width: 1079px) { min-height: 44px; } }`],
    ["a nested state that grows the box", `${PLAIN}.a { &:hover { padding: 12px 0; } }`],
    ["a nested at-rule whose last declaration has no semicolon (the old reader read it as a property named \"@media (pointer\")", `${PLAIN}.a { @media (pointer: coarse) { padding-block: 12px } }`],
    ["a nested pseudo-element whose last declaration has no semicolon", `${PLAIN}.a { &::after { content: ""; position: absolute; inset: -12px } }`],
    ["a nested descendant context", `${PLAIN}.a { .row & { display: inline-flex; } }`],
    ["a nested pseudo-element hit area", `${PLAIN}.a { &::after { content: ""; position: absolute; inset: -12px; } }`],
    ["a pseudo-element hit area, flat", `${PLAIN}.a::before { content: ""; position: absolute; top: -12px; bottom: -12px; left: 0; right: 0; }`],
    ["a pseudo-element hit area inside a condition", `${PLAIN}@media (pointer: coarse) { .a::after { position: absolute; inset: -12px; } }`],
    ["a context rule that grows the box", `${PLAIN}.notice .a { display: inline-flex; min-height: 44px; }`],
    ["an at-rule inside an at-rule", `${PLAIN}@supports (display: grid) { @media (x) { .a { padding-block: 10px; } } }`],
    ["a flat media rule", `${PLAIN}@media (pointer: coarse) { .a { line-height: 44px; } }`],
    ["display other than inline", ".a { display: inline-block; }"],
    ["a transform", `${PLAIN}.a { transform: translateY(-4px); }`],
    ["a selector list naming the class", `${PLAIN}.x, .a { display: flex; }`],
    ["a nested selector list whose second item is the class", `${PLAIN}.x { .y, .a { min-height: 44px; } }`],
    ["an element selector in a context, which reaches every link there", `${PLAIN}.notice a { padding-block: 12px; }`],
    ["an element selector with a state", `${PLAIN}.notice a:hover { display: inline-flex; }`],
    ["an element selector inside a nested rule", `${PLAIN}.notice { a { min-height: 44px; } }`],
    ["a box rule after an escaped quote, which the old reader threw on or skipped", `${PLAIN}.a { content: "x\\"}"; padding: 9px; }`],
    ["a box rule after a comment opener inside a string", `${PLAIN}.a { content: "/*"; } .a { padding: 9px; } /* */`],
  ])("names %s", (_what, css) => {
    expect(inSentenceViolations(css, "a").length, css).toBeGreaterThan(0);
  });

  it("does not take a rule for the link because its selector merely contains an element letter a", () => {
    expect(inSentenceViolations(`${PLAIN}.card { padding: 12px; } .notice span.abc { padding: 4px; } .x:not(a) { padding: 3px; }`, "a")).toEqual([]);
    // A paint-only rule on every link is not a violation.
    expect(inSentenceViolations(`${PLAIN}.notice a { color: blue; }`, "a")).toEqual([]);
  });

  it("needs the bare class as the base rule: a state alone does not define a plain link", () => {
    expect(inSentenceViolations(".a:hover { color: red; }", "a")).toEqual([".a: no rule outside every condition defines it"]);
    expect(inSentenceViolations(".x .a { color: red; }", "a")).toEqual([".a: no rule outside every condition defines it"]);
    // The bare class inside a list is a base rule.
    expect(inSentenceViolations(".b, .a { display: inline; color: red; }", "a")).toEqual([]);
  });

  it("is not fooled by a class whose name only starts like the one asked for", () => {
    expect(inSentenceViolations(`${PLAIN}.a-row { display: flex; min-height: 44px; }`, "a")).toEqual([]);
  });

  /*
    Through the real path: the sheets of the five routes whose links are read mid-sentence, as the files
    on disk, with the one nested-rule mutation applied to the real text. The unmutated sheet passes
    (link-rows.test.ts and routes-*.test.ts pin each one against the markup); the mutated one fails.
  */
  it.each([
    ["research-program/program", "inlineLink"],
    ["connect/connect", "inlineLink"],
    ["contact/contact", "inline"],
    ["security/security", "inline"],
    ["developers/developers", "sentenceLink"],
  ])("kills the nested hit area on the real sheet of %s", (sheet, name) => {
    const css = readFileSync(join(import.meta.dirname, "../../components/v34/routes", `${sheet}.module.css`), "utf8");
    expect(inSentenceViolations(css, name), `${sheet} .${name} as committed`).toEqual([]);
    const mutated = `${css}\n.${name} { @media (pointer: coarse) { padding-block: calc((44px - 1em) / 2); } }\n.${name}::after { content: ""; position: absolute; inset: -12px; }\n`;
    expect(inSentenceViolations(mutated, name).length).toBeGreaterThanOrEqual(2);
  });
});
