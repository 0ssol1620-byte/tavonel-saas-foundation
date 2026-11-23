import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { h1Text, typedCount, typedCounts } from "./route-test-support";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { EXPLORE_SAMPLE_DIGEST, exploreSampleSources } from "@/lib/explore-sample";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { MarketsBody } from "@/components/v34/routes/markets/markets";
import { MARKETS_DESTINATIONS } from "@/components/v34/routes/markets/markets-content";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/markets");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const files = readdirSync(dir).map((f) => ({ f, text: strip(readFileSync(join(dir, f), "utf8")) }));
const code = files.filter((x) => /\.tsx?$/.test(x.f));
// the SVG art carries coordinates, which are not figures
const all = code.filter((x) => !x.f.endsWith("-art.tsx")).map((x) => x.text).join("\n");
const content = code.find((x) => x.f === "markets-content.ts")!.text;
const page = strip(readFileSync(join(root, "app/markets/page.tsx"), "utf8"));
// the shared typed-count pattern (route-test-support.ts), with "one" counted: this page was written to it
const COUNT = typedCount({ one: true });

describe("markets route", () => {
  it("is a registry route, gated and rendered from its own body", () => {
    expect(V34_ROUTE_KEYS).toContain("markets");
    expect(v34Route("markets").release).toBe("live");
    expect(page).toContain('releaseGate("markets")');
    expect(page).toContain('routeMetadata("markets")');
    expect(page).not.toContain("RouteStub");
  });

  it("renders one h1 that is the registry title", () => {
    const html = renderToStaticMarkup(createElement(MarketsBody));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(h1Text(html)).toBe("Market filings compiled into a cited World");
  });

  it("shows the compiled sample, labelled, from computed values", () => {
    const html = renderToStaticMarkup(createElement(MarketsBody));
    expect(html).toContain("Sample");
    expect(html).toContain(EXPLORE_SAMPLE_DIGEST);
    for (const source of exploreSampleSources) {
      expect(html).toContain(source.filingDate);
      expect(html).toContain(source.secUrl);
    }
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it("links only to live registry routes and types no path", () => {
    for (const path of MARKETS_DESTINATIONS) expect(v34RouteByPath(path)?.release, path).toBe("live");
    for (const x of code) expect(x.text, x.f).not.toMatch(/["'`]\/[a-z]/);
  });

  it("types no price, plan, tool name, figure or digest", () => {
    expect(all).not.toMatch(/[$€£₩]\s?\d/);
    for (const offer of Object.values(BILLING_OFFERS)) expect(all).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const name of MCP_TOOL_NAMES) expect(all).not.toContain(name);
    expect(all).not.toMatch(/\b\d{3,}\b|\b\d+\.\d+\b|\d\s?%|sha256:/);
  });

  it("the count guard catches every shape of a typed count", () => {
    const counts = ["five", "Fifteen", "twenty-one", "a dozen", "dozens of", "a handful of", "a couple of", "5", "12"];
    const fillers = ["", "public ", "SEC ", "10-K ", "public SEC ", "annual 10-K SEC "];
    for (const n of counts) for (const f of fillers) for (const noun of ["filings", "report", "pages", "rows"]) {
      expect(`${n} ${f}${noun}`).toMatch(COUNT);
    }
    for (const ok of ["One company's SEC filings, compiled.", "the 10-K filings", "Follow a figure", "Compare periods side by side."]) {
      expect(ok).not.toMatch(COUNT);
    }
  });

  it("types no count as a number word or a counted noun", () => {
    // the art is in: its coordinates carry no counted noun, but its label is text a reader hears
    for (const x of code) expect(x.text, x.f).not.toMatch(COUNT);
  });

  it("carries no investment advice, performance claim or removed register item", () => {
    expect(content).not.toMatch(/\b(?:buy|sell|forecast|predict\w*|outperform\w*|alpha|trading signal|returns?|KQU|FRED|ALFRED|BEA|USGS)\b/i);
    expect(content).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });

  it("uses no colour literal and no hidden overflow", () => {
    for (const x of files) {
      expect(x.text, x.f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
      expect(x.text, x.f).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden|:global/);
    }
  });
});

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("markets", { one: true })).toEqual([]);
  });
});
