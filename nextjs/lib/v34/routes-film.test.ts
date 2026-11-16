import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilmBody } from "@/components/v34/routes/film/film";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { routeMetadata } from "./route-metadata";
import { V34_HELD_PATHS, v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for /film (held): app/film/page.tsx and components/v34/routes/film, plus a server
  render. The 404 in production belongs to app/film/layout.tsx (unchanged), so the page itself does not
  call releaseGate; the layout guard is pinned here instead.
*/

const KEY = "film" as const;
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = "components/v34/routes/film";

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesUnder(child) : [child];
  });
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const files = filesUnder(join(root, dir)).map((path) => ({
  file: relative(root, path).replaceAll("\\", "/"),
  text: stripComments(readFileSync(path, "utf8")),
}));
const prose = files.filter((f) => /\.tsx?$/.test(f.file) && !/film-art\.tsx$/.test(f.file));
const text = prose.map((f) => f.text).join("\n");
const html = renderToStaticMarkup(createElement(FilmBody));

describe("/film page file", () => {
  const page = stripComments(readFileSync(join(root, "app/film/page.tsx"), "utf8"));
  const layout = stripComments(readFileSync(join(root, "app/film/layout.tsx"), "utf8"));

  it("is a held registry route and its metadata is the registry's", () => {
    expect(v34Route(KEY).release).toBe("held");
    expect(v34Route(KEY).path).toBe("/film");
    expect(routeMetadata(KEY).title).toBe(v34Route(KEY).title);
    expect(page).toContain(`routeMetadata("${KEY}")`);
    expect(page).not.toMatch(/OpeningFilm|RouteStub/);
  });

  it("leaves the 404 to the layout guard, which stays as it was", () => {
    expect(layout).toContain('process.env.VERCEL_ENV === "production"');
    expect(layout).toContain("notFound()");
  });

  it("adds no video file and no media element", () => {
    expect(filesUnder(join(root, "app/film")).filter((f) => /\.(mp4|webm|mov|m4v)$/i.test(f))).toHaveLength(0);
    expect(html).not.toMatch(/<(?:video|audio|source)\b/);
    expect(html).not.toMatch(/autoplay/i);
  });

  it("is English only", () => {
    for (const f of files) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("one h1 and the Storyboard label", () => {
  it("writes no h1 of its own and renders the registry title once", () => {
    for (const f of files) expect(f.text, f.file).not.toMatch(/<h1\b/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`>${v34Route(KEY).title}</h1>`);
  });

  it("labels the page and its drawing Storyboard", () => {
    expect(html).toContain(">Storyboard<");
    expect(html).toMatch(/<figcaption[^>]*>.*Storyboard/);
  });
});

describe("figures, prices, plans and tool names are never typed", () => {
  it("types no price and no plan", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) expect(text, `plan label "${offer.label}"`).not.toMatch(new RegExp(`\b${offer.label}\b`));
  });

  it("writes no figure", () => {
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(text).not.toMatch(/\b\d+\.\d+\b/);
    expect(text).not.toMatch(/\b\d{3,}\b/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b\d+:\d\d\b/);
    expect(text).not.toMatch(/\b\d+\s+(?:records?|relationships?|sources?|documents?|pages?|files?|days?|minutes?|seconds?|tools?|formats?)\b/i);
  });

  it("names no MCP tool", () => {
    for (const name of MCP_TOOL_NAMES) expect(text, name).not.toContain(name);
  });
});

describe("tokens", () => {
  it("uses no colour literal", () => {
    for (const f of files) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
    }
  });
});

describe("links", () => {
  it("links no held route and no unregistered internal path", () => {
    const hrefs = [...html.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const normal = href.length > 1 ? href.replace(/\/$/, "") : href;
      expect(V34_HELD_PATHS as readonly string[], `${href} is held`).not.toContain(normal);
      const registered = v34RouteByPath(normal);
      expect(registered, `${href} is not a registry page`).toBeTruthy();
      expect(registered!.release, `${href} is held`).toBe("live");
    }
  });

  it("reaches registry pages by key, never by a typed path", () => {
    for (const f of prose) expect(f.text, f.file).not.toMatch(/["'`]\/(?:compiler|methods|evidence|world|changes|connect|journal)\b/);
  });
});

describe("copy", () => {
  it("states what things are, with no defensive disclaimer", () => {
    for (const f of prose) expect(f.text, f.file).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });

  it("promises no date and carries no internal identifier", () => {
    expect(text).not.toMatch(/\b(?:coming soon|will launch|launches in|available from)\b/i);
    expect(text).not.toMatch(/\b(?:D\d{2}|U\d{2}|EG-\w+|WO-[\w-]+)\b/);
  });
});
