import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { ResearchBody } from "@/components/v34/routes/research/research";
import { PROGRAM, RESEARCH_DESTINATIONS } from "@/components/v34/routes/research/research-content";
import { readResearchThread, statusLabel } from "@/components/v34/routes/research/research-data";
import { PUBLIC_CORPUS_STATS, readPublicCorpus, type PublicCorpus } from "./public-corpus";
import { routeMetadata } from "./route-metadata";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for /research (app/research/page.tsx and components/v34/routes/research/**)
  plus one server render. This is the researcher page; the research program that was this URL's
  body is /research/program (routes-research-program.test.ts).
*/

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/research");

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
const page = stripComments(readFileSync(join(root, "app/research/page.tsx"), "utf8"));
const corpus = readPublicCorpus();
const thread = readResearchThread(corpus);
const html = renderToStaticMarkup(createElement(ResearchBody));
const text = stripped(code).map((f) => f.text).join("\n");

describe("route files", () => {
  it("has the body, its words, its corpus lookup, its drawings and its sheet", () => {
    expect(sources.map((f) => f.file.split("/").pop()).sort()).toEqual([
      "research-art.tsx", "research-content.ts", "research-data.ts", "research.module.css", "research.tsx",
    ]);
  });

  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("app/research/page.tsx", () => {
  it("names a registry key and gates on it before anything renders", () => {
    expect(V34_ROUTE_KEYS).toContain("research");
    expect(page).toContain('routeMetadata("research")');
    expect(page).toContain('releaseGate("research")');
    expect(page.indexOf('releaseGate("research")')).toBeLessThan(page.indexOf("<V34Page"));
    expect(page).toContain('<V34Page route="research">');
    expect(page).toContain('<RouteJsonLd route="research" />');
    expect(page).toContain("routeViewport()");
  });

  it("takes its title and description from the registry, and carries nothing of the program body", () => {
    expect(routeMetadata("research").title).toBe(v34Route("research").title);
    expect(page).not.toMatch(/PolicyJumpIndex|PublicSitePage|TrustNext/);
  });
});

describe("one h1", () => {
  it("writes no h1 of its own and mounts exactly one Hero", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    const body = stripped(code).find((f) => f.file.endsWith("/research.tsx"))!;
    expect(body.text.match(/<Hero\b/g)).toHaveLength(1);
  });

  it("renders exactly one h1 and it is the registry's title", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`>${v34Route("research").title.replace(/ — TAVONEL$/, "")}</h1>`);
  });
});

describe("every figure about the thread is read from the corpus", () => {
  it("types no price, plan, tool name or number", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\b(?:USD|per month|per year)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) expect(text, offer.label).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const name of MCP_TOOL_NAMES) expect(text, name).not.toContain(name);
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(text).not.toMatch(/\b\d+\.\d+\b/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b\d+\s+(?:records?|relationships?|sources?|documents?|pages?|planets?|days?|tools?)\b/i);
    expect(text).not.toMatch(/\b(?:seven|three|zero)\b/i);
  });

  it("reads seven planets, three in the habitable zone, the zone's own state and note and the sources from the corpus records", () => {
    expect(thread.planets).toHaveLength(7);
    expect(thread.planets.filter((p) => p.inZone).map((p) => p.id)).toEqual(["planet-e", "planet-f", "planet-g"]);
    expect(thread.zone.status).toBe("uncertain");
    expect(thread.cited.map((s) => s.id)).toEqual(["nasa", "webb"]);
    expect(html).toContain("7 planets. 3 in the habitable zone.");
    expect(html).toContain(thread.zone.note);
    expect(html).toContain(statusLabel(thread.zone.status));
    for (const src of [...thread.cited, ...thread.others]) {
      expect(html, src.id).toContain(`href="${src.href}"`);
      expect(html, src.id).toContain(src.label);
    }
  });

  it("prints the corpus totals it quotes, as computed", () => {
    const stats = PUBLIC_CORPUS_STATS(corpus);
    expect(html).toContain(`${stats.records.toLocaleString("en-US")} records from ${stats.sources.total.toLocaleString("en-US")} public sources`);
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it("fails closed when the corpus lacks a record the page needs", () => {
    const without = (id: string): PublicCorpus => ({ ...corpus, nodes: corpus.nodes.filter((n) => n.id !== id) });
    expect(() => readResearchThread(without("star"))).toThrow(/no TRAPPIST-1 star record/);
    expect(() => readResearchThread(without("hz"))).toThrow(/no habitable zone record/);
    const planetless: PublicCorpus = { ...corpus, nodes: corpus.nodes.filter((n) => !n.id.startsWith("planet-")) };
    expect(() => readResearchThread(planetless)).toThrow(/no planet records for the star/);
    const noSource: PublicCorpus = { ...corpus, sources: Object.fromEntries(Object.entries(corpus.sources).filter(([k]) => k !== "webb")) };
    expect(() => readResearchThread(noSource)).toThrow(/no source entry for webb/);
  });
});

describe("labels and removed claims", () => {
  it("labels the corpus and the drawings", () => {
    expect(html).toContain("Public reference corpus");
    expect(html).toContain(">Illustration<");
  });

  it("makes none of the claims the register removes", () => {
    expect(html.toLowerCase()).not.toMatch(/unpublished work|export citations|export selected/);
  });

  it("opens each original in a new tab, with the reason said to a screen reader", () => {
    const links = [...html.matchAll(/<a\b[^>]*href="(https:\/\/[^"]+)"[^>]*>/g)];
    expect(links.length).toBeGreaterThanOrEqual(thread.cited.length + thread.others.length);
    for (const [tag] of links) expect(tag).toMatch(/target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/);
    expect(html).toContain("(opens in a new tab)");
  });
});

describe("tokens, containment and motion", () => {
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

  it("draws the drawings from shapes, with no text to fall below the type floor", () => {
    const art = stripped(code).find((f) => f.file.endsWith("research-art.tsx"))!;
    expect(art.text).not.toMatch(/<text\b|font-size/);
    expect(art.text.match(/role="img"/g)).toHaveLength(2);
  });
});

describe("links", () => {
  it("types no path except the program page, which has no registry row yet", () => {
    const literal = stripped(code).flatMap((f) => [...f.text.matchAll(/["'`]\/[a-z][^"'`]*/g)].map((m) => m[0]));
    expect(literal).toEqual(['"/research/program']);
    expect(PROGRAM.href).toBe("/research/program");
  });

  it("links only to live routes and offers the program page above the fold", () => {
    for (const path of RESEARCH_DESTINATIONS) {
      const route = v34RouteByPath(path);
      expect(route, `${path} is not in the registry`).toBeDefined();
      expect(route!.release, `${path} is held`).toBe("live");
    }
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const route = v34RouteByPath(href!);
      if (route) expect(route.release, `${href} is held`).toBe("live");
    }
    expect(html.indexOf(`href="${PROGRAM.href}"`)).toBeGreaterThan(-1);
    expect(html.indexOf(`href="${PROGRAM.href}"`)).toBeLessThan(html.indexOf("A worked example"));
  });
});

describe("copy", () => {
  it("states what things are, with no defensive disclaimer", () => {
    const content = stripped(code).find((f) => f.file.endsWith("research-content.ts"))!;
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });
});
