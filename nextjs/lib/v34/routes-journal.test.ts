import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JournalBody, LIVE_ARTICLES, READ_MINUTES } from "@/components/v34/routes/journal/journal";
import { CATEGORY, FEATURED, REFERENCE } from "@/components/v34/routes/journal/journal-content";
import { COVERS } from "@/components/v34/routes/journal/covers";
import { articleDates } from "@/components/v34/routes/journal/article-dates";
import { COMPILER_BLOCKS, CompilerBody } from "@/components/v34/routes/journal-compiler/compiler-article";
import { COMPILER_SOURCES } from "@/components/v34/routes/journal-compiler/compiler-sources";
import { MCP_BLOCKS, McpBody } from "@/components/v34/routes/journal-mcp/mcp-article";
import { MCP_SOURCES } from "@/components/v34/routes/journal-mcp/mcp-sources";
import { articleReadMinutes } from "@/components/v34/ui/article-layout";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_COUNT_WORD, MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { routeMetadata } from "./route-metadata";
import { V34_HELD_PATHS, v34Route, v34RouteByPath, type V34RouteKey } from "./routes";

/*
  Source-level guards for the journal routes (app/journal, app/journal/compiler, app/journal/mcp and
  components/v34/routes/journal*), plus server renders. Follows home-page.test.ts: a plan or price
  typed by hand, a tool name typed by hand, a second h1, a colour that is not a token, a link to a
  held page, a defensive disclaimer, a date nobody computed.
*/

const root = fileURLToPath(new URL("../../", import.meta.url));

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const ROUTES = [
  { key: "journal" as V34RouteKey, page: "app/journal/page.tsx", dir: "components/v34/routes/journal" },
  { key: "journal-compiler" as V34RouteKey, page: "app/journal/compiler/page.tsx", dir: "components/v34/routes/journal-compiler" },
  { key: "journal-mcp" as V34RouteKey, page: "app/journal/mcp/page.tsx", dir: "components/v34/routes/journal-mcp" },
];

const sources = ROUTES.flatMap((r) => filesUnder(join(root, r.dir)).map((path) => ({
  route: r.key,
  file: relative(root, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
})));
const code = sources.filter((f) => /\.tsx?$/.test(f.file)).map((f) => ({ ...f, text: stripComments(f.text) }));
const styles = sources.filter((f) => f.file.endsWith(".css")).map((f) => ({ ...f, text: stripComments(f.text) }));
/** Source citations carry dates and identifiers, and the drawings carry coordinates, by nature; every other file is prose and code. */
const prose = code.filter((f) => !/-sources\.ts$|\/covers\.tsx$|\/proof-line\.tsx$/.test(f.file));

const FIXTURE = { published: "2026-11-16", modified: "2026-11-16" };
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const pages = {
  journal: () => render(createElement(JournalBody)),
  "journal-compiler": () => render(createElement(CompilerBody, FIXTURE)),
  "journal-mcp": () => render(createElement(McpBody, FIXTURE)),
} as const;

describe("route files and registry keys", () => {
  it("has files for each route, and every key is a live registry route", () => {
    for (const r of ROUTES) {
      expect(sources.filter((f) => f.route === r.key).length, r.dir).toBeGreaterThan(0);
      expect(v34Route(r.key).release, r.key).toBe("live");
    }
  });

  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("each page file", () => {
  for (const r of ROUTES) {
    it(`${r.page} gates on its own key, takes registry metadata and renders the route body`, () => {
      const page = stripComments(read(r.page));
      expect(page).toContain(`routeMetadata("${r.key}")`);
      expect(page).toContain(`await releaseGate("${r.key}")`);
      expect(page).toContain("routeViewport()");
      expect(page.indexOf("releaseGate")).toBeLessThan(page.indexOf("return"));
      expect(page).not.toMatch(/RouteStub/);
      expect(routeMetadata(r.key).title).toBe(v34Route(r.key).title);
    });
  }
});

describe("one h1, from the registry", () => {
  it("writes no h1 of its own", () => {
    for (const f of code) expect(f.text, f.file).not.toMatch(/<h1\b/);
  });

  for (const r of ROUTES) {
    it(`${r.key} renders exactly one h1 that reads as the registry title`, () => {
      const html = pages[r.key as keyof typeof pages]();
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      const title = v34Route(r.key).title.replace(/ — TAVONEL$/, "");
      expect(html).toMatch(new RegExp(`<h1[^>]*>${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`));
    });
  }
});

describe("figures, prices, plans and tool names are never typed", () => {
  const text = prose.map((f) => f.text).join("\n");

  it("types no price and no plan", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) {
      expect(text, `plan label "${offer.label}"`).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    }
  });

  it("writes no figure: no grouped, decimal or three-digit number, no percentage, no count-plus-noun", () => {
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(text).not.toMatch(/\b\d+\.\d+\b/);
    expect(text).not.toMatch(/\b\d{3,}\b/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b\d+\s+(?:records?|relationships?|sources?|documents?|pages?|files?|days?|minutes?|seconds?|tools?|formats?)\b/i);
  });

  it("names no MCP tool by hand: the list and the count come from lib/mcp-tools", () => {
    for (const name of MCP_TOOL_NAMES) expect(text, name).not.toContain(name);
    const html = pages["journal-mcp"]();
    for (const name of MCP_TOOL_NAMES) expect(html, name).toContain(`>${name}</code>`);
    expect(html).toContain(`offers ${MCP_TOOL_COUNT_WORD} read-only tools`);
  });

  it("prints a read time counted from the words each article prints", () => {
    const compiler = articleReadMinutes(COMPILER_BLOCKS);
    const mcp = articleReadMinutes(MCP_BLOCKS);
    expect(pages["journal-compiler"]()).toContain(`${compiler} min read`);
    expect(pages["journal-mcp"]()).toContain(`${mcp} min read`);
    expect(READ_MINUTES["journal-compiler"]).toBe(compiler);
    expect(READ_MINUTES["journal-mcp"]).toBe(mcp);
    expect(pages.journal()).toContain(`${mcp} min read`);
  });
});

describe("article dates come from the registry and nowhere else", () => {
  it("has no date written in a page or a component", () => {
    for (const f of prose) expect(f.text, f.file).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });

  it("fails closed when a record carries no dates, and returns them when it does", () => {
    const bare = v34Route("journal-mcp");
    expect(() => articleDates("journal-mcp", { ...bare, article: undefined })).toThrow(/no article dates/);
    expect(articleDates("journal-mcp", { ...bare, article: FIXTURE })).toEqual(FIXTURE);
  });

  it("prints both dates from the values it is given", () => {
    const html = render(createElement(McpBody, { published: "2026-11-01", modified: "2026-11-16" }));
    expect(html).toContain('dateTime="2026-11-01"');
    expect(html).toContain('dateTime="2026-11-16"');
  });
});

describe("tokens and explicit pairs", () => {
  it("uses no colour literal in a sheet or in code", () => {
    for (const f of [...code, ...styles]) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
    }
  });

  it("reads only --v34-* custom properties and names no basic colour", () => {
    for (const f of styles) {
      expect(f.text, f.file).not.toMatch(/(?:color|background|fill|stroke|border[\w-]*|outline[\w-]*)\s*:[^;]*\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple)\b/i);
      for (const [, name] of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, f.file).toMatch(/^--v34-/);
    }
  });

  it("sets a foreground wherever it paints a background", () => {
    for (const f of styles) {
      for (const [, selector, body] of f.text.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) {
        if (!/(?:^|;|\s)background(?:-color)?\s*:/.test(body!)) continue;
        expect(body, `${f.file}: ${selector!.trim()} paints a background without a colour`).toMatch(/(?:^|;|\s)color\s*:/);
      }
    }
  });

  it("steps layout only at the section 3.10 breakpoints (1000, 900, 760, 480, 360)", () => {
    const allowed = [1000, 900, 901, 760, 761, 480, 481, 360, 361]; // a min-width steps up one past its boundary
    for (const f of styles) {
      for (const [, px] of f.text.matchAll(/@media[^{]*\(\s*(?:min|max)-width\s*:\s*(\d+)px\s*\)/g)) {
        expect(allowed, `${f.file}: ${px}px`).toContain(Number(px));
      }
    }
  });

  it("hides no overflow, imports nothing and has no motion of its own", () => {
    for (const f of styles) {
      expect(f.text, f.file).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden/);
      expect(f.text, f.file).not.toMatch(/@import\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:animation|transition|@keyframes)\b/);
    }
  });
});

describe("links", () => {
  const retained = prose.flatMap((f) => [...f.text.matchAll(/(?:retained\(|href: )"(\/[a-z][^"]*)"(?: as Route)?/g)].map((m) => m[1]!));

  it("points every retained page at a page file that exists", () => {
    expect(retained.length).toBeGreaterThan(0);
    for (const path of retained) {
      const segments = path.slice(1).split("/");
      const direct = existsSync(join(root, "app", ...segments, "page.tsx"));
      const docsSection = segments[0] === "docs" && segments.length === 2 && existsSync(join(root, "app/docs/[section]/page.tsx"));
      expect(direct || docsSection, `${path} has no page`).toBe(true);
    }
  });

  it("reaches a registry page only by key, and the reference list is the retained set", () => {
    for (const f of prose) expect(f.text, f.file).not.toMatch(/["'`]\/(?:journal|compiler|developers|connect|evidence|world|studio)\b/);
    expect(REFERENCE.items.map((i) => i.href)).toEqual(["/docs", "/cookbooks", "/research/notes", "/benchmarks", "/changelog", "/reproducibility"]);
  });

  for (const key of Object.keys(pages) as (keyof typeof pages)[]) {
    it(`${key} links no held route and no unregistered internal path`, () => {
      const html = pages[key]();
      const hrefs = [...html.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]!);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        const normal = href.length > 1 ? href.replace(/\/$/, "") : href;
        expect(V34_HELD_PATHS as readonly string[], `${href} is held`).not.toContain(normal);
        const registered = v34RouteByPath(normal);
        if (registered) expect(registered.release, `${href} is held`).toBe("live");
      }
    });
  }

  it("keeps a held article out of the index, and a live one only with a category and a cover", () => {
    const html = pages.journal();
    for (const path of V34_HELD_PATHS) expect(html, path).not.toContain(`href="${path}"`);
    expect(LIVE_ARTICLES.length).toBeGreaterThan(1);
    for (const article of LIVE_ARTICLES) {
      expect(CATEGORY[article.key], `${article.key} category`).toBeTruthy();
      expect(COVERS[article.key], `${article.key} cover`).toBeTruthy();
      if (article.key !== FEATURED) expect(html, article.key).toContain(`href="${article.path}"`);
    }
  });
});

describe("copy", () => {
  it("states what things are, with no defensive disclaimer", () => {
    for (const f of prose) {
      expect(f.text, f.file).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
    }
  });

  it("drops what the register row names", () => {
    const compiler = [...COMPILER_SOURCES, ...MCP_SOURCES].map((s) => s.href).join("\n");
    expect(compiler).not.toMatch(/tavonel\.com/);
    const mcp = stripComments(read("components/v34/routes/journal-mcp/mcp-article.tsx"));
    expect(mcp).not.toMatch(/directory|independent host review/i);
  });

  it("cites an ordered list of external https sources, each once, and the MCP ones name the revision", () => {
    for (const list of [COMPILER_SOURCES, MCP_SOURCES]) {
      expect(list.length).toBeGreaterThan(1);
      expect(new Set(list.map((s) => s.href)).size).toBe(list.length);
      for (const source of list) expect(source.href).toMatch(/^https:\/\//);
    }
    for (const source of MCP_SOURCES) expect(source.href + source.label).toMatch(/2025-06-18/);
    const html = pages["journal-compiler"]();
    const hrefs = [...html.matchAll(/<a class="[^"]*" href="(https:[^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(COMPILER_SOURCES.map((s) => s.href));
  });
});

describe("the primary action", () => {
  it("puts a primary action in the first band of the index", () => {
    const html = pages.journal();
    const hero = html.slice(0, html.indexOf("</section>"));
    expect(hero).toContain(`href="${v34Route(FEATURED).path}"`);
  });
});
