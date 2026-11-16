import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SOLUTIONS } from "@/app/solutions/[slug]/page";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { SolutionsBody } from "@/components/v34/routes/solutions/solutions";
import { FIELDS, ROLES, SOLUTIONS_DESTINATIONS } from "@/components/v34/routes/solutions/solutions-content";
import { routeMetadata } from "./route-metadata";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for /solutions (app/solutions/page.tsx and components/v34/routes/solutions/**)
  plus one server render, in the pattern of home-page.test.ts. The five workflow pages under
  /solutions/[slug] are out of scope and untouched; what is pinned here is that the hub reads them
  and does not copy them.
*/

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/solutions");

function filesUnder(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const sources = (existsSync(dir) ? filesUnder(dir) : []).map((path) => ({
  file: relative(root, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));
const code = sources.filter((f) => /\.tsx?$/.test(f.file));
const styles = sources.filter((f) => f.file.endsWith(".css"));

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const stripped = (list: typeof sources) => list.map((f) => ({ file: f.file, text: stripComments(f.text) }));
const page = stripComments(readFileSync(join(root, "app/solutions/page.tsx"), "utf8"));
const html = renderToStaticMarkup(createElement(SolutionsBody));
const text = stripped(code).map((f) => f.text).join("\n");

describe("route files", () => {
  it("has the body, its words, its drawing and its sheet", () => {
    expect(sources.map((f) => f.file.split("/").pop()).sort()).toEqual([
      "solutions-art.tsx", "solutions-content.ts", "solutions.module.css", "solutions.tsx",
    ]);
  });

  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("app/solutions/page.tsx", () => {
  it("names a registry key and gates on it before anything renders", () => {
    expect(V34_ROUTE_KEYS).toContain("solutions");
    expect(page).toContain('routeMetadata("solutions")');
    expect(page).toContain('releaseGate("solutions")');
    expect(page.indexOf('releaseGate("solutions")')).toBeLessThan(page.indexOf("<V34Page"));
    expect(page).toContain('<V34Page route="solutions">');
    expect(page).toContain('<RouteJsonLd route="solutions" />');
    expect(page).toContain("routeViewport()");
  });

  it("takes its title and description from the registry", () => {
    const { title, description } = routeMetadata("solutions");
    expect(title).toBe(v34Route("solutions").title);
    expect(description).toBe(v34Route("solutions").description);
  });

  it("leaves the workflow pages alone: no file under [slug] is part of this route", () => {
    expect(sources.every((f) => !f.file.includes("[slug]"))).toBe(true);
  });
});

describe("one h1", () => {
  it("writes no h1 of its own and mounts exactly one Hero", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    const body = stripped(code).find((f) => f.file.endsWith("/solutions.tsx"))!;
    expect(body.text.match(/<Hero\b/g)).toHaveLength(1);
  });

  it("renders exactly one h1 and it is the registry's title", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const title = v34Route("solutions").title.replace(/ — TAVONEL$/, "");
    expect(html).toContain(`>${title}</h1>`);
  });
});

describe("numbers, prices, plans and tools", () => {
  it("types no price and names no plan", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) {
      expect(text, `plan label "${offer.label}"`).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    }
  });

  it("writes no figure and names no MCP tool", () => {
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(text).not.toMatch(/\b\d+\.\d+\b/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b\d+\s+(?:records?|relationships?|sources?|documents?|pages?|files?|days?|tools?|formats?|workflows?|solutions?)\b/i);
    for (const name of MCP_TOOL_NAMES) expect(text, name).not.toContain(name);
  });

  it("uses no segment the register removes", () => {
    expect(html.toLowerCase()).not.toMatch(/famil(?:y|ies)|creator/);
  });
});

describe("tokens, containment and states", () => {
  it("uses no colour literal and reads only --v34-* custom properties", () => {
    for (const f of stripped(sources)) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
    }
    for (const f of stripped(styles)) for (const [, name] of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, f.file).toMatch(/^--v34-/);
  });

  it("sets a foreground wherever it paints a background, hides no overflow, has no motion", () => {
    for (const f of stripped(styles)) {
      for (const [, selector, body] of f.text.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) {
        if (/(?:^|;|\s)background(?:-color)?\s*:/.test(body!)) expect(body, `${selector!.trim()} paints a background without a colour`).toMatch(/(?:^|;|\s)color\s*:/);
      }
      expect(f.text).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden/);
      expect(f.text).not.toMatch(/\b(?:animation|transition|@keyframes|@import)\b/);
    }
  });

  it("stretches one link over each card, with a painted hover and focus", () => {
    const css = stripped(styles)[0]!.text;
    expect(css).toMatch(/\.card \{[^}]*position: relative/);
    expect(css).toMatch(/\.link::after \{[^}]*position: absolute;[^}]*inset: 0/);
    expect(css).toMatch(/\.link:hover \{[^}]*text-decoration: underline/);
    expect(css).toMatch(/\.card:hover \{[^}]*background/);
    expect(css).toMatch(/\.link:focus-visible \{[^}]*outline: 3px/);
  });
});

describe("cards and links", () => {
  const cards = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];

  it("renders one card per role, per field and per documented workflow, each a data-v34-card host with one link", () => {
    expect(cards).toHaveLength(ROLES.items.length + FIELDS.items.length + Object.keys(SOLUTIONS).length);
    for (const card of cards) {
      expect(card).toContain("data-v34-card");
      expect(card.match(/<a\b/g), card.slice(0, 120)).toHaveLength(1);
    }
  });

  it("reads the workflows from the SOLUTIONS record the detail pages render", () => {
    for (const [slug, solution] of Object.entries(SOLUTIONS)) {
      expect(html, slug).toContain(`href="/solutions/${slug}"`);
      expect(html, slug).toContain(solution.task.input);
      expect(html, slug).toContain(solution.audience);
    }
    const body = stripped(code).find((f) => f.file.endsWith("/solutions.tsx"))!;
    expect(body.text).toContain("Object.entries(SOLUTIONS)");
    for (const slug of Object.keys(SOLUTIONS)) expect(text, `${slug} is copied instead of read`).not.toContain(`"${slug}"`);
  });

  it("types no path: a registry destination is a key, and the workflow link is built from the record's slug", () => {
    const literal = stripped(code).flatMap((f) => [...f.text.matchAll(/["'`]\/[a-z][^"'`]*/g)].map((m) => m[0]));
    expect(literal).toEqual(["`/solutions/${slug}"]);
  });

  it("links only to live routes, and every registry path the page renders is live", () => {
    expect(SOLUTIONS_DESTINATIONS.length).toBeGreaterThan(0);
    for (const path of SOLUTIONS_DESTINATIONS) {
      const route = v34RouteByPath(path);
      expect(route, `${path} is not in the registry`).toBeDefined();
      expect(route!.release, `${path} is held`).toBe("live");
    }
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const route = v34RouteByPath(href!);
      if (route) expect(route.release, `${href} is held`).toBe("live");
    }
  });
});

describe("copy", () => {
  it("states what things are, with no defensive disclaimer", () => {
    const content = stripped(code).find((f) => f.file.endsWith("solutions-content.ts"))!;
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });
});
