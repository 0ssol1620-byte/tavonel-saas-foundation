import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublicPageShell } from "@/components/public-page-shell";
import SiteHeader from "@/components/v34/shell/site-header";
import V34Page from "@/components/v34/shell/v34-page";
import { current, resolveEntries, V34_PRIMARY_NAV } from "./nav";
import { v34Route, v34RouteByPath, type V34RouteKey } from "./routes";

/*
  WO-CI-5a D3: a page inside a primary section marks that section's bar item, and the mark is made
  on the server -- the bar is a server component and gets no client script for it. A registry route
  hands the shell its key; a retained page (PublicSitePage, PublicPageShell) or a page that draws
  the header itself (/pricing) hands it its path. A page that hands neither renders an unmarked bar,
  which is the defect (/solutions/knowledge-graph had no bar item marked).

  The drawer and the More panel read the path on the client; the mock below gives them a different
  one, so a mark found in the bar can only have come from the server-side prop.
*/
vi.mock("next/navigation", () => ({ usePathname: () => "/not-the-page" }));

const root = fileURLToPath(new URL("../../", import.meta.url));
const PRIMARY = resolveEntries(V34_PRIMARY_NAV).map((link) => link.href);

/** The `<a>` of the bar's primary list (not the More panel or the drawer) that links `href`. */
function barLink(html: string, href: string): string {
  const bar = html.slice(html.indexOf('aria-label="Primary"'));
  const list = bar.slice(0, bar.indexOf("</ul>"));
  return list.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`))?.[0] ?? "";
}

/** The shell around a one-line body. Both shells are plain server functions, so they are called as a page renders them. */
const body = createElement("p", null, "body");
const page = (path: string) => renderToStaticMarkup(V34Page({ path, children: body }));

const barMarks = (html: string) => PRIMARY.filter((href) => barLink(html, href).includes("aria-current"));

describe("the bar marks the primary section a page sits in, from the server", () => {
  it.each([
    ["/solutions/knowledge-graph", "/solutions", "true"],
    ["/solutions/ai-ready-knowledge", "/solutions", "true"],
    ["/pricing", "/pricing", "page"],
  ])("V34Page with path %s marks %s as %s", (path, owner, mark) => {
    const html = page(path);
    expect(barLink(html, owner)).toContain(`aria-current="${mark}"`);
    expect(barMarks(html)).toEqual([owner]);
  });

  it("a retained page's path reaches the bar through PublicPageShell and PublicSitePage", () => {
    const html = renderToStaticMarkup(PublicPageShell({ template: "T1", path: "/solutions/knowledge-graph", children: body }));
    expect(barMarks(html)).toEqual(["/solutions"]);
  });

  it("a page outside every primary section marks nothing", () => {
    for (const path of ["/sources", "/docs", "/trust", "/solutionsx"]) {
      expect(barMarks(page(path)), path).toEqual([]);
    }
    expect(barMarks(renderToStaticMarkup(createElement(SiteHeader)))).toEqual([]);
  });
});

/** Every `app/<route>/page.tsx` with the URL it serves (route groups dropped, dynamic segments kept). */
function pages(dir = join(root, "app")): { file: string; path: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    if (name !== "page.tsx") return [];
    const segments = relative(join(root, "app"), dir).split(sep).filter((part) => part && !/^\(.*\)$/.test(part));
    return [{ file: relative(root, full).split(sep).join("/"), path: `/${segments.join("/")}` }];
  });
}

/** The path a page hands the shell, as written in its source, or null when it hands none. */
function handedPath(source: string): string | null {
  const registry = source.match(/<V34Page\b[^>]*\broute="([\w-]+)"/);
  if (registry) return v34Route(registry[1] as V34RouteKey).path;
  const given = source.match(/<(?:SiteHeader\b[^>]*\bcurrentPath|(?:PublicPageShell|PublicSitePage|V34Page)\b[^>]*\bpath)=\{(`[^`]*`|"[^"]*"|[^{}]*)\}/);
  if (!given) return null;
  const value = given[1].trim();
  const key = value.match(/^v34Route\("([\w-]+)"\)\.path$/);
  if (key) return v34Route(key[1] as V34RouteKey).path;
  const literal = value.match(/^[`"]([^`"]+)[`"]$/);
  // A template literal's interpolations stand for one path segment each.
  return literal ? literal[1].replace(/\$\{[^}]+\}/g, "segment") : null;
}

describe("every page inside a primary section hands the shell where it is", () => {
  const inSection = pages().flatMap(({ file, path }) => {
    const owner = PRIMARY.find((href) => path === href || path.startsWith(`${href}/`));
    return owner ? [{ file, path, owner }] : [];
  });

  it("finds the section pages, the retained /solutions/[slug] and the hand-assembled /pricing among them", () => {
    expect(inSection.map((page) => page.file)).toEqual(expect.arrayContaining(["app/solutions/[slug]/page.tsx", "app/pricing/page.tsx"]));
  });

  it.each(PRIMARY)("the primary href %s has a page file", (href) => {
    expect(inSection.some((page) => page.path === href), href).toBe(true);
  });

  it("each one marks its own section", () => {
    const unmarked = inSection.flatMap(({ file, path, owner }) => {
      const source = readFileSync(join(root, file), "utf8");
      // The page draws the shell (or part of it) itself: what it hands over is what the bar marks.
      if (/<(?:SiteHeader|PublicPageShell|PublicSitePage|V34Page)\b/.test(source)) {
        const handed = handedPath(source);
        const concrete = path.replace(/\[[^\]]+\]/g, "segment");
        return handed && current(owner, handed) && (handed === concrete || current(owner, concrete) === "true")
          ? [] : [`${file}: hands the shell ${handed ?? "no path"}, so ${owner} is not marked on ${path}`];
      }
      // Otherwise the body renders `V34Page route=...`, which only a registry route can do.
      return v34RouteByPath(path) ? [] : [`${file}: ${path} is not a registry route and hands the shell no path`];
    });
    expect(unmarked).toEqual([]);
  });
});

/*
  WO-CI-5a D4: the drawer's More groups are an accordion that opens one group at a time. That is the
  platform's exclusive `<details name>` group -- every group shares one name -- and no script.
*/
describe("the drawer's groups open one at a time", () => {
  it("every group in the drawer carries the same non-empty name, and no other details element shares it", () => {
    const html = renderToStaticMarkup(createElement(SiteHeader));
    const dialog = html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"));
    const groups = [...dialog.matchAll(/<details\b[^>]*>/g)].map((match) => match[0].match(/\bname="([^"]+)"/)?.[1] ?? "");
    expect(groups.length, "the drawer carries the More groups").toBeGreaterThanOrEqual(2);
    expect(new Set(groups).size, `names ${groups.join(", ")}`).toBe(1);
    expect(groups[0]).not.toBe("");
    const outside = html.replace(dialog, "");
    expect(outside.includes(`name="${groups[0]}"`), "the name is the drawer's own").toBe(false);
  });
});
