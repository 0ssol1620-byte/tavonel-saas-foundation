import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
  V33 containment rules for components/v34/**\/*.module.css, as a static scan:
  - no element (type) selector after a combinator, and no wrapper/child sharing one class;
  - grid tracks use minmax(0, 1fr), never a bare fr that can force the track wider than its box;
  - overflow: hidden only where it is the point (scroll surface, media crop);
  - no @import and no :root, so nothing leaks past the V34 wrapper on soft navigation.
  The folder may not exist yet, in which case the scan passes with nothing to read.
*/

type Rule = { selector: string; body: string };

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Flat list of style rules; at-rules with nested rules are entered, keyframes and font-face skipped. */
export function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (source: string) => {
    let i = 0;
    while (i < source.length) {
      const open = source.indexOf("{", i);
      if (open === -1) break;
      const prelude = source.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === "{") depth += 1;
        else if (source[j] === "}") depth -= 1;
        j += 1;
      }
      const body = source.slice(open + 1, j - 1);
      if (prelude.startsWith("@")) {
        if (/^@(media|supports|layer|container)/.test(prelude)) walk(body);
      } else {
        rules.push({ selector: prelude, body });
      }
      i = j;
    }
  };
  walk(stripComments(css));
  return rules;
}

/** Compound selectors of one complex selector, split on descendant, child and sibling combinators. */
function compounds(selector: string): string[] {
  const parts: string[] = [];
  let current = "";
  let paren = 0;
  let bracket = 0;
  for (const ch of selector) {
    if (ch === "(") paren += 1;
    else if (ch === ")") paren -= 1;
    else if (ch === "[") bracket += 1;
    else if (ch === "]") bracket -= 1;
    if (paren === 0 && bracket === 0 && /[\s>+~]/.test(ch)) {
      if (current) parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

const OVERFLOW_OK = /scroll|media|crop/i;

export function scanCss(file: string, source: string): string[] {
  const problems: string[] = [];
  const css = stripComments(source);
  if (/@import\b/.test(css)) problems.push(`${file}: @import is not allowed in a module sheet`);
  for (const { selector, body } of parseRules(source)) {
    for (const complex of selector.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (/:root\b/.test(complex)) problems.push(`${file}: ${complex} reaches :root`);
      const parts = compounds(complex);
      parts.slice(1).forEach((part) => {
        if (/^[a-zA-Z]/.test(part)) problems.push(`${file}: ${complex} uses the type selector ${part} after a combinator`);
      });
      const classes = parts.map((part) => part.match(/^\.([\w-]+)/)?.[1]).filter((c): c is string => Boolean(c));
      const repeated = classes.find((c, index) => classes.indexOf(c) !== index);
      if (repeated) problems.push(`${file}: ${complex} nests .${repeated} inside .${repeated}`);
    }
    if (/overflow(-x|-y)?\s*:\s*hidden/.test(body) && !OVERFLOW_OK.test(selector) && !OVERFLOW_OK.test(file)) {
      problems.push(`${file}: ${selector} hides overflow outside a scroll surface or media crop`);
    }
    for (const [, value] of body.matchAll(/grid-template-(?:columns|rows)\s*:\s*([^;]+)/g)) {
      const withoutSafe = value!.replace(/minmax\(\s*0(?:px)?\s*,\s*[\d.]+fr\s*\)/g, "");
      if (/(^|[\s(,])[\d.]*fr\b/.test(withoutSafe)) problems.push(`${file}: ${selector} uses a bare fr track, use minmax(0, 1fr)`);
    }
  }
  return problems;
}

const root = join(import.meta.dirname, "../../components/v34");

function moduleSheets(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return moduleSheets(path);
    return name.endsWith(".module.css") ? [path] : [];
  });
}

describe("components/v34 module CSS containment", () => {
  it("has no violations in any module sheet (vacuous while the folder is absent)", () => {
    const problems = moduleSheets(root).flatMap((path) => scanCss(relative(root, path), readFileSync(path, "utf8")));
    expect(problems).toEqual([]);
  });
});

describe("the containment scan catches what it exists to catch", () => {
  const caught = (css: string) => scanCss("fixture.module.css", css);

  it("passes a contained sheet", () => {
    expect(
      caught(`
        .card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); min-width: 0; }
        .card > .title { color: #18241e; }
        .scrollTable { overflow-x: auto; }
        @media (max-width: 760px) { .card { grid-template-columns: minmax(0, 1fr); } }
        /* .a .a { overflow: hidden; } is only a comment */
      `),
    ).toEqual([]);
  });

  it("flags a type selector after a combinator", () => {
    expect(caught(".card div { color: red; }")).toHaveLength(1);
    expect(caught(".card > p { color: red; }")).toHaveLength(1);
    expect(caught(".card:hover a { color: red; }")).toHaveLength(1);
  });

  it("flags a wrapper and child sharing a class", () => {
    expect(caught(".card .card { margin: 0; }")).toHaveLength(1);
  });

  it("flags a bare fr track, including inside a media query", () => {
    expect(caught(".grid { grid-template-columns: 1fr 1fr; }")).toHaveLength(1);
    expect(caught("@media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }")).toHaveLength(1);
  });

  it("flags overflow hidden on an ordinary surface but not on a media crop", () => {
    expect(caught(".panel { overflow: hidden; }")).toHaveLength(1);
    expect(caught(".panel { overflow-x: hidden; }")).toHaveLength(1);
    expect(caught(".mediaCrop { overflow: hidden; }")).toEqual([]);
  });

  it("flags @import and :root", () => {
    expect(caught('@import "./other.css" layer(base); .a { color: #000; }')).toHaveLength(1);
    expect(caught(":root { --x: 1; }")).toHaveLength(1);
  });
});
