/*
  The static half of lead decision 23 (WO-CI-29; kept by decision 25), shared by the V34 route tests. A link
  class used inside a sentence is a plain inline box at every width: nothing in its sheet may grow its box,
  its line, or move it, and a media or other at-rule block may only paint. Node only: nothing the app builds
  imports this file.

  The parser reads what the browser would apply, not what a naive split sees: a block nested inside a style
  rule (`.a { @media (x) { ... } }`, `.a { &:hover { ... } }`, `.a { .b & { ... } }`) is a rule of its own
  with the conditions that hold it, its `&` resolved. Anything it cannot place -- an unbalanced brace, a
  declaration without a colon -- throws: a sheet that cannot be read is not evidence that it is plain.
*/

export type CssRule = { condition: string; selector: string; declarations: [string, string][] };

/** Properties that grow the link's box or line, or move it (a hit area made any way is one of these). */
export const BOX =
  /^(?:display|min-height|height|max-height|line-height|vertical-align|position|top|bottom|left|right|inset(?:-[a-z]+)*|float|transform|translate|scale|rotate|zoom|padding(?:-top|-bottom|-block(?:-start|-end)?)?|border(?:-top|-bottom|-block(?:-start|-end)?)?(?:-width|-style)?)$/;
/** What a link may change inside a condition: its paint. */
export const PAINT =
  /^(?:color|outline(?:-color|-style|-width|-offset)?|background(?:-color|-clip)?|text-decoration(?:-[a-z]+)?|text-underline-offset|forced-color-adjust)$/;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Index of the quote closing the string opened at `open`; a backslash escapes the next character. Throws when there is none. */
function stringEnd(css: string, open: number): number {
  const quote = css[open]!;
  for (let i = open + 1; i < css.length; i++) {
    if (css[i] === "\\") i++;
    else if (css[i] === quote) return i;
  }
  throw new Error("unterminated string in the sheet");
}

/** The sheet without its comments; a `/*` inside a string is text, not a comment. */
function stripComments(css: string): string {
  let out = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === '"' || c === "'") {
      const end = stringEnd(css, i);
      out += css.slice(i, end + 1);
      i = end;
    } else if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) throw new Error("unterminated comment in the sheet");
      i = end + 1;
    } else out += c;
  }
  return out;
}

/** Splits at commas outside parentheses and strings: the items of a selector list. */
function splitList(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (c === '"' || c === "'") i = stringEnd(list, i);
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { items.push(list.slice(from, i).trim()); from = i + 1; }
  }
  items.push(list.slice(from).trim());
  return items;
}

/** Index of the brace closing the one at `open`, skipping strings and parentheses; throws when there is none. */
function closing(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i]!;
    if (c === '"' || c === "'") i = stringEnd(css, i);
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced braces in the sheet");
}

/**
 * Every style rule of a sheet with the at-rule conditions that hold it ("" outside any). `selector` is null
 * for the top level and for an at-rule whose body holds rules; inside a style rule it is the rule's own
 * (already resolved) selector, and the declarations met there belong to it.
 */
function walk(css: string, condition: string, selector: string | null, out: CssRule[]): void {
  const declarations: [string, string][] = [];
  let buffer = "";
  let parens = 0;
  const declare = () => {
    const text = clean(buffer);
    buffer = "";
    if (text === "") return;
    if (selector === null) {
      if (text.startsWith("@")) return; // @import, @charset, @layer a, b;
      throw new Error(`"${text}" is a declaration outside any rule`);
    }
    const colon = text.indexOf(":");
    if (colon <= 0) throw new Error(`${selector}: "${text}" is not a declaration`);
    declarations.push([text.slice(0, colon).trim().toLowerCase(), text.slice(colon + 1).trim()]);
  };
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === '"' || c === "'") {
      const end = stringEnd(css, i);
      buffer += css.slice(i, end + 1);
      i = end;
    } else if (c === "(") { parens++; buffer += c; }
    else if (c === ")") { parens--; buffer += c; }
    else if (c === ";" && parens === 0) declare();
    else if (c === "{") {
      const end = closing(css, i);
      const prelude = clean(buffer);
      buffer = "";
      if (prelude === "") throw new Error("a block without a selector or at-rule");
      const body = css.slice(i + 1, end);
      if (/^@(?:font-face|page|property|counter-style)(?![\w-])/.test(prelude)) { /* declarations of no style rule */ }
      else if (prelude.startsWith("@")) walk(body, condition ? `${condition} ${prelude}` : prelude, selector, out);
      else {
        // Each item of a selector list is resolved on its own: `.x { .y, .a { } }` is `.x .y` and `.x .a`.
        const own = selector === null ? prelude : splitList(prelude)
          .map((item) => (item.includes("&") ? item.replaceAll("&", `:is(${selector})`) : `:is(${selector}) ${item}`)).join(", ");
        walk(body, condition, own, out);
      }
      i = end;
    } else if (c === "}") throw new Error("unbalanced braces in the sheet");
    else buffer += c;
  }
  declare();
  if (selector !== null && declarations.length > 0) out.push({ condition, selector, declarations });
}

export function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  walk(stripComments(css), "", null, out);
  return out;
}

/**
 * Why `name` (a local class of the sheet) is not a plain inline link at every width; [] when it is. Every
 * rule whose selector names the class counts -- state, context, pseudo-element or nesting -- and there must
 * be a rule outside every condition (a class the sheet does not define cannot be shown to be plain).
 */
export function inSentenceViolations(css: string, name: string): string[] {
  const named = new RegExp(`\\.${name}(?![\\w-])`);
  // A rule reaches the link when it names the class, or when an item of its list ends in the element `a`
  // (`.notice a { padding: 12px }` applies to every link in the notice, this one among them).
  const reaches = (item: string) => named.test(item) || /^a(?![\w-])/.test(/[^\s>+~]*$/.exec(item)![0]);
  const own = cssRules(css).filter((rule) => splitList(rule.selector).some(reaches));
  const found: string[] = [];
  // The base rule is the bare class (alone or in a list): `.a:hover { }` does not define a link's plain state.
  if (!own.some((rule) => rule.condition === "" && splitList(rule.selector).includes(`.${name}`))) {
    found.push(`.${name}: no rule outside every condition defines it`);
  }
  for (const { condition, selector, declarations } of own) {
    for (const [property, value] of declarations) {
      if (condition !== "") {
        if (!PAINT.test(property)) found.push(`${condition} { ${selector} { ${property}: ${value} } }: inside a condition a link may only paint`);
      } else if (property === "display") {
        if (value !== "inline") found.push(`${selector}: display: ${value} is not inline`);
      } else if (BOX.test(property)) found.push(`${selector}: ${property}: ${value} changes or moves the box that holds the link`);
    }
  }
  return found;
}
