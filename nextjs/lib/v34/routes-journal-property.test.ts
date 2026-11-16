import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { typedCounts } from "./route-test-support";
import { PROPERTY_BLOCKS, PropertyBody } from "@/components/v34/routes/journal-property/property-article";
import { PROPERTY_SOURCES } from "@/components/v34/routes/journal-property/property-sources";
import { articleDates } from "@/components/v34/routes/journal/article-dates";
import { articleReadMinutes } from "@/components/v34/ui/article-layout";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { routeMetadata } from "./route-metadata";
import { V34_HELD_PATHS, v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for /journal/property (held): app/journal/property and components/v34/routes/journal-property,
  plus a server render. Follows home-page.test.ts: a gate that is not called, a plan, a price or a figure
  typed by hand, a second h1, a colour that is not a token, a link to a held page, a defensive
  disclaimer, a date nobody computed, a statement the register row drops.
*/

const KEY = "journal-property" as const;
const root = fileURLToPath(new URL("../../", import.meta.url));
const pageFile = "app/journal/property/page.tsx";
const dir = "components/v34/routes/journal-property";

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
/** Source citations carry dates and identifiers, and the drawings carry coordinates, by nature; every other file is prose and code. */
const prose = files.filter((f) => /\.tsx?$/.test(f.file) && !/-sources\.ts$|\/figures\.tsx$/.test(f.file));
/** Identifiers the article quotes from its sources. They are names and dates, and no figure is derived from them. */
const QUOTED: readonly string[] = [];
const text = QUOTED.reduce((all, quoted) => all.replaceAll(quoted, ""), prose.map((f) => f.text).join("\n"));
const FIXTURE = { published: "2026-11-16", modified: "2026-11-16" };
const html = renderToStaticMarkup(createElement(PropertyBody, FIXTURE));

describe("/journal/property page file", () => {
  const page = stripComments(readFileSync(join(root, pageFile), "utf8"));

  it("is a registry route of the expected release, and its metadata is the registry's", () => {
    expect(v34Route(KEY).release).toBe("held");
    expect(v34Route(KEY).path).toBe("/journal/property");
    expect(routeMetadata(KEY).title).toBe(v34Route(KEY).title);
  });

  it("gates on its own key before it renders the body", () => {
    expect(page).toContain(`routeMetadata("${KEY}")`);
    expect(page).toContain(`await releaseGate("${KEY}")`);
    expect(page).toContain("routeViewport()");
    expect(page.indexOf("releaseGate")).toBeLessThan(page.indexOf("return"));
    expect(page).not.toMatch(/RouteStub/);
  });

  it("is English only", () => {
    for (const f of files) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("one h1, from the registry", () => {
  it("writes no h1 of its own and renders the registry title once", () => {
    for (const f of files) expect(f.text, f.file).not.toMatch(/<h1\b/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const title = "How property documents become a cited record";
    expect(html).toContain(`>${title}</h1>`);
  });
});

describe("figures, prices, plans and tool names are never typed", () => {
  it("types no price and no plan", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) expect(text, `plan label "${offer.label}"`).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
  });

  it("writes no figure: no grouped, decimal or three-digit number, no percentage, no count-plus-noun", () => {
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(text).not.toMatch(/\b\d+\.\d+\b/);
    expect(text).not.toMatch(/\b\d{3,}\b/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b\d+\s+(?:records?|relationships?|sources?|documents?|pages?|files?|days?|minutes?|seconds?|tools?|formats?)\b/i);
  });

  it("names no MCP tool", () => {
    for (const name of MCP_TOOL_NAMES) expect(text, name).not.toContain(name);
  });

  it("prints a read time counted from the words it prints", () => {
    expect(html).toContain(`${articleReadMinutes(PROPERTY_BLOCKS)} min read`);
  });
});

describe("dates come from the registry and nowhere else", () => {
  it("has no ISO date in a page or a component", () => {
    for (const f of prose) expect(f.text, f.file).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });

  it("fails closed without dates, and prints the two it is given", () => {
    expect(() => articleDates(KEY, { ...v34Route(KEY), article: undefined })).toThrow(/no article dates/);
    const printed = renderToStaticMarkup(createElement(PropertyBody, { published: "2026-11-01", modified: "2026-11-16" }));
    expect(printed).toContain('dateTime="2026-11-01"');
    expect(printed).toContain('dateTime="2026-11-16"');
  });
});

describe("tokens", () => {
  it("uses no colour literal and writes no sheet of its own", () => {
    expect(files.filter((f) => f.file.endsWith(".css"))).toHaveLength(0);
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
    for (const f of prose) expect(f.text, f.file).not.toMatch(/["'`]\/(?:journal|changes|evidence|world|markets|research|engineering)\b/);
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

  it("makes no valuation, parcel, listing or investment-return claim", () => {
    expect(text).not.toMatch(/\b(?:guarantee[sd]?|worth|valued at|estimated value|investment returns?|rental yield|bargain|undervalued|Curated Worlds?|directory)\b/i);
  });

  it("is a preview that gives no launch date", () => {
    expect(v34Route(KEY).release).toBe("held");
    expect(html).not.toMatch(/\b(?:launch|available|ships?|shipping)\b[^<]{0,40}\b(?:20\d\d|soon|next)\b/i);
  });

  it("cites an ordered list of external https sources, each once, as the page prints them", () => {
    expect(PROPERTY_SOURCES.length).toBeGreaterThan(0);
    expect(new Set(PROPERTY_SOURCES.map((s) => s.href)).size).toBe(PROPERTY_SOURCES.length);
    for (const source of PROPERTY_SOURCES) expect(source.href).toMatch(/^https:\/\//);
    const printed = [...html.matchAll(/<a class="[^"]*" href="(https:[^"]+)"/g)].map((m) => m[1]);
    expect(printed).toEqual(PROPERTY_SOURCES.map((s) => s.href.replaceAll("&", "&amp;")));
  });
});

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("journal-property")).toEqual([]);
  });
});
