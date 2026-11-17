import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import V34Page from "@/components/v34/shell/v34-page";
import { reach as reachFrom, specifiers } from "./import-graph";
import { h1Text } from "./route-test-support";

/*
  D33 #4: the retained public routes carry the V34 shell. Most of them reach it through
  `PublicSitePage`, which is `V34Page` without a registry key. /explore cannot: its stage renders
  the page's one `<main>` itself, so the page draws V34Page's header and footer around it (WO-CI-6B).

  "The same header and footer" is checked against `V34Page`, not against a copy of its markup: each
  is what a retained route gets from `V34Page`, byte for byte, inside V34Page's token wrapper. The
  stage's `<main>` is NOT inside that wrapper: `.site` sets the colour scheme and the type every
  descendant inherits, and the workbench is drawn on the legacy body's (round 2, M2). And the route
  must not reach the legacy chrome module at all -- importing it is what put the legacy stylesheet
  chunk on /explore's first paint, whichever module did the import and however it imported it.
*/

vi.mock("next/navigation", () => ({ usePathname: () => "/explore" }));

const root = fileURLToPath(new URL("../../", import.meta.url));

/** A retained route that renders its own `<main>` inside the V34 frame, and the page module that serves it. */
const OWN_MAIN_ROUTES = [{ path: "/explore", page: "app/explore/page.tsx" }] as const;

const render = (component: FunctionComponent<{ children?: ReactNode }>, children?: ReactNode) =>
  renderToStaticMarkup(createElement(component, null, children));

/** The element that opens at the first `<tag ...marker`, through its matching close. */
function element(html: string, tag: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `${marker} is rendered`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf(`<${tag}`, at);
  const pattern = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  pattern.lastIndex = open;
  let depth = 0;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[0] === `</${tag}>` ? -1 : 1;
    if (depth === 0) return html.slice(open, match.index + match[0].length);
  }
  throw new Error(`unclosed <${tag}> at ${marker}`);
}

const frame = render(V34Page as FunctionComponent<{ children?: ReactNode }>, createElement("i", { id: "body" }));
const frameRoot = frame.slice(0, frame.indexOf(">") + 1);
/** V34Page's wrapper class: the token wrapper whose inherited type and colour scheme the stage must not take. */
const siteClass = /class="([^"]+)"/.exec(frameRoot)![1]!;
const frameHeader = element(frame, "header", "data-v34-header");
const frameFooter = frame.slice(frame.lastIndexOf("<footer"), frame.lastIndexOf("</footer>") + "</footer>".length);

const reach = (entry: string) => reachFrom(root, entry);

/** The elements open at `index` in server-rendered markup, outermost first (their opening tags). */
function ancestors(html: string, index: number): string[] {
  const VOID = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
  const stack: { name: string; tag: string }[] = [];
  for (const match of html.slice(0, index).matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
    const [tag, closing, name, selfClosing] = match;
    if (closing) {
      const at = stack.map((open) => open.name).lastIndexOf(name!);
      if (at >= 0) stack.length = at;
    } else if (!selfClosing && !VOID.test(name!)) {
      stack.push({ name: name!, tag });
    }
  }
  return stack.map((open) => open.tag);
}

describe("the import graph the legacy-chrome check walks", () => {
  /*
    Round 1 followed only static imports: `next/dynamic`, `React.lazy` and `require` reached a
    module without the check seeing it (review r19/fuzz-reach). Every shape a module can be loaded
    by, crossed with each quote and spacing, must be seen; a type-only import, and an import that is
    only in a comment, must not.
  */
  const target = "@/components/public-site-chrome";
  const shapes: ((spec: string) => string)[] = [
    (q) => `import X from ${q};`,
    (q) => `import { A,\n  B } from ${q}`,
    (q) => `import * as all from ${q};`,
    (q) => `import X, { A } from ${q};`,
    (q) => `import ${q};`,
    (q) => `export { A } from ${q};`,
    (q) => `export * from ${q};`,
    (q) => `const F = dynamic(() => import(${q}));`,
    (q) => `const F = dynamic(() => import( ${q} ), { ssr: false });`,
    (q) => `const F = lazy(() => import(${q}));`,
    (q) => `const F = React.lazy(async () => (await import(${q})).default);`,
    (q) => `const c = require(${q});`,
    (q) => `const c = require( ${q} );`,
    (q) => `x();import(${q}).then(run)`,
  ];
  const sources = shapes.flatMap((shape) => [`"`, `'`].map((quote) => shape(`${quote}${target}${quote}`)));
  it.each(sources)("sees %s", (source) => {
    expect(specifiers(`const before = 1;\n${source}\nconst after = 2;`)).toContain(target);
  });
  it("sees a template-literal dynamic import and a stylesheet @import", () => {
    expect(specifiers(`const F = dynamic(() => import(\`${target}\`));`)).toContain(target);
    expect(specifiers(`@import "${target}.module.css";`)).toContain(`${target}.module.css`);
    expect(specifiers(`@import url("${target}.css") layer(x);`)).toContain(`${target}.css`);
  });
  it("does not count a type-only import or a commented-out one", () => {
    expect(specifiers(`import type { A } from "${target}";`)).toEqual([]);
    expect(specifiers(`// import X from "${target}";\n/* const F = dynamic(() => import("${target}")); */`)).toEqual([]);
  });
});

/** Every declaration of `prop` in a stylesheet, with the rule's selector and the at-rules around it. */
function declarations(css: string, prop: string): { selector: string; media: string[]; value: string }[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: { selector: string; media: string[]; value: string }[] = [];
  const stack: string[] = [];
  let text = "";
  const take = () => {
    const decl = text.trim();
    if (decl.startsWith(`${prop}:`)) {
      found.push({ selector: stack.at(-1) ?? "", media: stack.filter((at) => at.startsWith("@")), value: decl.slice(prop.length + 1).trim() });
    }
    text = "";
  };
  for (const char of source) {
    if (char === "{") { stack.push(text.trim()); text = ""; }
    else if (char === "}") { take(); stack.pop(); }
    else if (char === ";") take();
    else text += char;
  }
  return found;
}

describe("the stage's sticky-bar height is the shell's own (WO-CI-6C, E2)", () => {
  /*
    The stage sits outside `.site` (M2), so it cannot inherit `--v34-header-h`; it states the bar's
    height once, as `--v34-bar`, and subtracts it from every size that is "the viewport minus the
    stage's chrome". This holds that statement to the shell's stylesheets: the header's height token
    at each breakpoint, plus the rule under the bar. A change to either breaks this test, not the page.
  */
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  const pxOf = (value: string) => {
    const match = /^(\d+(?:\.\d+)?)px\b/.exec(value);
    expect(match, `a px value: ${value}`).not.toBeNull();
    return Number(match![1]);
  };
  const tokens = declarations(read("components/v34/tokens.module.css"), "--v34-header-h").filter((d) => d.selector === ".site");
  const rule = declarations(read("components/v34/shell/site-header.module.css"), "border-bottom").filter((d) => d.selector === ".header" && d.media.length === 0);
  const stage = declarations(read("components/explore/explore-stage.module.css"), "--v34-bar").filter((d) => d.selector === ".page");

  it("finds one wide and one narrow value on each side, under the same media query", () => {
    expect(tokens.map((d) => d.media.length).sort()).toEqual([0, 1]);
    expect(stage.map((d) => d.media.length).sort()).toEqual([0, 1]);
    expect(rule).toHaveLength(1);
    const narrow = (list: typeof tokens) => list.find((d) => d.media.length === 1)!.media[0]!.replace(/\s+/g, " ");
    expect(narrow(stage)).toBe(narrow(tokens));
  });

  it("states the bar as the header height plus its rule, at every breakpoint", () => {
    const border = pxOf(rule[0]!.value);
    for (const width of [0, 1]) {
      const token = tokens.find((d) => d.media.length === width)!;
      const own = stage.find((d) => d.media.length === width)!;
      expect(pxOf(own.value), `--v34-bar ${width ? token.media[0] : "(wide)"}`).toBe(pxOf(token.value) + border);
    }
  });

  it("reads its own declarations, not a lookalike (parser check)", () => {
    expect(declarations(".a{--x:1px}@media (max-width: 9px){.a{color:red;--x:2px}}", "--x")).toEqual([
      { selector: ".a", media: [], value: "1px" },
      { selector: ".a", media: ["@media (max-width: 9px)"], value: "2px" },
    ]);
    expect(declarations(".a{/* --x: 5px; */--xy:3px}", "--x")).toEqual([]);
  });
});

describe.each(OWN_MAIN_ROUTES)("$path carries the V34 shell around its own main", ({ path, page }) => {
  it("never reaches the legacy chrome module, so its stylesheet chunk stays off the route", () => {
    const reached = reach(page);
    expect(reached.has("components/v34/shell/site-header.tsx"), "the V34 header is in the route's graph").toBe(true);
    expect([...reached].filter((file) => file.startsWith("components/public-site-chrome"))).toEqual([]);
  });

  it("renders V34Page's header and footer byte for byte, each in V34Page's wrapper, and its own main outside it", async () => {
    const { default: Page } = (await import(/* @vite-ignore */ join(root, page))) as { default: FunctionComponent };
    // React hoists the page's preload hints ahead of its markup; the page itself starts after them.
    const html = render(Page).replace(/^(?:<link\b[^>]*>)+/, "");
    expect(element(html, "header", "data-v34-header")).toBe(frameHeader);
    expect(html.slice(html.lastIndexOf("<footer"), html.lastIndexOf("</footer>") + "</footer>".length)).toBe(frameFooter);
    // The header and the footer each sit in V34Page's wrapper, so they read the same tokens as on every V34 page.
    const headerAt = html.indexOf("data-v34-header");
    const footerAt = html.lastIndexOf("<footer");
    const wrapperOf = (index: number) => ancestors(html, index).filter((tag) => tag.includes(siteClass));
    expect(wrapperOf(headerAt), `${path}: the header is inside V34Page's wrapper`).toHaveLength(1);
    expect(wrapperOf(footerAt), `${path}: the footer is inside V34Page's wrapper`).toHaveLength(1);
    // The stage's main is not: nothing it draws inherits the wrapper's colour scheme or type.
    const mainAt = html.indexOf("<main");
    expect(ancestors(html, mainAt).filter((tag) => tag.includes(siteClass)), `${path}: main outside the V34 wrapper`).toEqual([]);
    for (const wrapper of [...wrapperOf(headerAt), ...wrapperOf(footerAt)]) {
      expect(wrapper.startsWith(frameRoot.slice(0, -1)), "the wrapper is V34Page's").toBe(true);
      // A box would make the header a screen tall (`min-height: 100vh`) and confine its sticky bar.
      expect(wrapper).toMatch(/style="display:contents"/);
    }
    expect(html.match(/<main\b/g), "one main").toHaveLength(1);
    expect(html.match(/\bid="main"/g), "one skip-link target").toHaveLength(1);
    expect(h1Text(html).length).toBeGreaterThan(0);
    const outsideMain = html.replace(element(html, "main", "<main"), "");
    expect(outsideMain.match(/<footer\b/g), "one site footer outside main").toHaveLength(1);
    expect(outsideMain.match(/<header\b/g), "one site header outside main").toHaveLength(1);
    // The main sits between the V34 header and the V34 footer, as V34Page places its own.
    expect(headerAt).toBeLessThan(mainAt);
    expect(footerAt).toBeGreaterThan(html.indexOf("</main>"));
    // The stage's phone rules that apply only under the shell select `[data-v34-site] ~ main` (E1).
    expect(ancestors(html, mainAt), `${path}: main is a sibling of the shell's wrappers`).toEqual([]);
    expect(html.slice(0, mainAt)).toMatch(/<div\b[^>]*\bdata-v34-site=""/);
    expect(html).not.toMatch(/chrome-v2-(?:header|footer)/);
  }, 120_000);
});
