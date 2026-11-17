import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import V34Page from "@/components/v34/shell/v34-page";
import { h1Text } from "./route-test-support";

/*
  D33 #4: the retained public routes carry the V34 shell. Most of them reach it through
  `PublicSitePage`, which is `V34Page` without a registry key. /explore cannot: its stage renders
  the page's one `<main>` itself, so the page composes the same frame around it (WO-CI-6B).

  "The same frame" is checked against `V34Page`, not against a copy of its markup: the header, the
  footer and the wrapper a retained route gets from `V34Page` are what this route must render,
  byte for byte. And the route must not reach the legacy chrome module at all -- importing it is
  what put the legacy stylesheet chunk on /explore's first paint, whichever module did the import.
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
const frameHeader = element(frame, "header", "data-v34-header");
const frameFooter = frame.slice(frame.lastIndexOf("<footer"), frame.lastIndexOf("</footer>") + "</footer>".length);

/** Every repository module a source file reaches through static imports (`@/` and relative), CSS included. */
function reach(entry: string): Set<string> {
  const seen = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
      if (existsSync(candidate) && /\.(tsx?|css|json|mjs)$/.test(candidate)) return candidate;
    }
    return null;
  };
  const visit = (file: string) => {
    const key = relative(root, file).replaceAll("\\", "/");
    if (seen.has(key)) return;
    seen.add(key);
    if (!/\.tsx?$/.test(file)) return;
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    for (const match of source.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g)) {
      if (/^import\s+type\b/.test(match[0].trim())) continue;
      const next = resolve(file, match[1]!);
      if (next) visit(next);
    }
  };
  visit(join(root, entry));
  return seen;
}

describe.each(OWN_MAIN_ROUTES)("$path carries the V34 shell around its own main", ({ path, page }) => {
  it("never reaches the legacy chrome module, so its stylesheet chunk stays off the route", () => {
    const reached = reach(page);
    expect(reached.has("components/v34/shell/site-header.tsx"), "the V34 header is in the route's graph").toBe(true);
    expect([...reached].filter((file) => file.startsWith("components/public-site-chrome"))).toEqual([]);
  });

  it("renders V34Page's wrapper, header and footer byte for byte, around exactly one main and one h1", async () => {
    const { default: Page } = (await import(/* @vite-ignore */ join(root, page))) as { default: FunctionComponent };
    // React hoists the page's preload hints ahead of its markup; the page itself starts after them.
    const html = render(Page).replace(/^(?:<link\b[^>]*>)+/, "");
    expect(html.slice(0, frameRoot.length), `${path} opens with the V34 wrapper`).toBe(frameRoot);
    expect(element(html, "header", "data-v34-header")).toBe(frameHeader);
    expect(html.slice(html.lastIndexOf("<footer"), html.lastIndexOf("</footer>") + "</footer>".length)).toBe(frameFooter);
    expect(html.match(/<main\b/g), "one main").toHaveLength(1);
    expect(html.match(/\bid="main"/g), "one skip-link target").toHaveLength(1);
    expect(h1Text(html).length).toBeGreaterThan(0);
    const outsideMain = html.replace(element(html, "main", "<main"), "");
    expect(outsideMain.match(/<footer\b/g), "one site footer outside main").toHaveLength(1);
    expect(outsideMain.match(/<header\b/g), "one site header outside main").toHaveLength(1);
    // The main sits between the V34 header and the V34 footer, as V34Page places its own.
    const mainAt = html.indexOf("<main");
    expect(html.indexOf("data-v34-header")).toBeLessThan(mainAt);
    expect(html.lastIndexOf("<footer")).toBeGreaterThan(html.indexOf("</main>"));
    expect(html).not.toMatch(/chrome-v2-(?:header|footer)/);
  }, 120_000);
});
