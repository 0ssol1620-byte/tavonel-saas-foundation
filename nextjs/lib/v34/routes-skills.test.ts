import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { h1Text, typedCounts } from "./route-test-support";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { SkillsBody } from "@/components/v34/routes/skills/skills";
import { CONTRACT, EXAMPLE, FINAL, TRUST } from "@/components/v34/routes/skills/skills-content";
import { PUBLIC_CORPUS_STATS } from "./public-corpus";
import { routeMetadata } from "./route-metadata";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for the skills route (app/skills/page.tsx and components/v34/routes/skills/**),
  plus one server render. The route is held: it answers 404 in production until the registry flips it.
*/

const KEY = "skills";
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes", KEY);

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
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const code = sources.filter((f) => /\.tsx?$/.test(f.file)).map((f) => ({ ...f, text: strip(f.text) }));
const styles = sources.filter((f) => f.file.endsWith(".css")).map((f) => ({ ...f, text: strip(f.text) }));
const page = strip(readFileSync(join(root, "app", KEY, "page.tsx"), "utf8"));
const html = renderToStaticMarkup(createElement(SkillsBody));
const prose = html.replace(/<(?:svg|script)[\s\S]*?<\/(?:svg|script)>/g, "").replace(/<[^>]+>/g, " ");

describe("skills page", () => {
  it("is a thin held page: registry key, gate first, registry metadata", () => {
    expect(V34_ROUTE_KEYS).toContain(KEY);
    expect(v34Route(KEY).release).toBe("held");
    expect(page).toContain(`routeMetadata("${KEY}")`);
    expect(page.indexOf(`await releaseGate("${KEY}")`)).toBeGreaterThan(-1);
    expect(page.indexOf("releaseGate(")).toBeLessThan(page.indexOf("return <"));
    expect(page).not.toMatch(/RouteStub/);
  });

  it("renders one h1 that is the registry title", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const title = routeMetadata(KEY).title;
    expect(String(title)).toBe(v34Route(KEY).title);
    expect(h1Text(html)).toBe("Skills that apply compiled knowledge to a task");
    for (const f of code) expect(f.text, f.file).not.toMatch(/<h1\b/);
  });

  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("copy", () => {
  const all = code.map((f) => f.text).join("\n");

  it("types no price, plan name or tool name", () => {
    expect(all).not.toMatch(/[$€£₩]\s?\d/);
    expect(all).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) expect(all).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const tool of MCP_TOOL_NAMES) expect(prose).not.toContain(tool);
  });

  it("writes no number into prose and no count the corpus computes", () => {
    const stats = PUBLIC_CORPUS_STATS();
    expect(prose.replace(/\b0[1-9]\b/g, "")).not.toMatch(/\d/);
    for (const n of [stats.records, stats.relations, stats.sources.total]) expect(prose).not.toContain(n.toLocaleString("en-US"));
  });

  it("uses no word the register forbids and no defensive disclaimer", () => {
    expect(prose).not.toMatch(/\b(?:guarantee|certified|licensed|marketplace|verified skills)\b/i);
    const content = code.find((f) => f.file.endsWith("-content.ts"))!;
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
    expect(prose).not.toMatch(/\b(?:D\d{2}|U\d{2}|EG-)\b/);
  });

  it("labels its drawing as an illustration", () => {
    expect(html).toContain("Illustration");
    expect(html).toContain('role="img"');
  });
});

describe("links and styles", () => {
  it("types no path and links only to live routes", () => {
    for (const f of code) expect(f.text, f.file).not.toMatch(/["'`]\/[a-z]/);
    const internal = [...html.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]!);
    expect(internal.length).toBeGreaterThan(0);
    for (const path of internal) {
      const route = v34RouteByPath(path.replace(/\/$/, "") || "/");
      if (route) expect(route.release, path).toBe("live");
    }
  });

  it("uses tokens only, sets a foreground where it paints, hides no overflow, has no motion", () => {
    for (const f of [...code, ...styles]) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|oklch|color-mix)\(/i);
    }
    for (const f of styles) {
      for (const [, name] of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, f.file).toMatch(/^--v34-/);
      for (const [, selector, body] of f.text.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) {
        if (/(?:^|;|\s)background(?:-color)?\s*:/.test(body!)) expect(body, selector!.trim()).toMatch(/(?:^|;|\s)color\s*:/);
      }
      expect(f.text).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden/);
      expect(f.text).not.toMatch(/\b(?:animation|transition|@keyframes|@import)\b/);
    }
  });
});

/*
  Layout against the styled prototype (route_preview/<route>/index.html served over HTTP with its CSS).
  A band is the markup between two <section openings; FinalCta closes the page.
*/
const bands = html.split(/<section\b/).slice(1);
const band = (title: string) => {
  const found = bands.filter((b) => b.includes(title));
  expect(found, title).toHaveLength(1);
  return found[0]!;
};
const inOrder = (titles: readonly string[]) => {
  const at = titles.map((t) => html.indexOf(t));
  for (const [i, t] of titles.entries()) expect(at[i], t).toBeGreaterThan(-1);
  expect(at).toEqual([...at].sort((a, b) => a - b));
};

describe("layout against the prototype", () => {
  it("keeps the prototype's section order", () => {
    inOrder([CONTRACT.title, EXAMPLE.title, TRUST.title, FINAL.title]);
  });

  it("puts the manifest drawing in the contract band and the example manifest in a focusable, labelled block", () => {
    expect(band(CONTRACT.title)).toContain('role="img"');
    const example = band(EXAMPLE.title);
    expect(example).not.toContain('role="img"');
    expect(example).toMatch(/<pre\b[^>]*tabindex="0"[^>]*aria-label="Example manifest"/);
    expect(example).toContain("write: false");
  });

  it("numbers the trust rows", () => {
    const text = band(TRUST.title).replace(/<[^>]+>/g, " ");
    TRUST.rows.forEach((_, i) => expect(text).toContain(String(i + 1).padStart(2, "0")));
  });
});

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("skills")).toEqual([]);
  });
});
