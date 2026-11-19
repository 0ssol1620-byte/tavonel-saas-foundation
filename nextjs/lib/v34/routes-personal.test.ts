import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { h1Text, typedCount, typedCounts, withoutNonPlanWords } from "./route-test-support";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { PersonalBody } from "@/components/v34/routes/personal/personal";
import { PERSONAL_DESTINATIONS } from "@/components/v34/routes/personal/personal-content";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/personal");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const files = readdirSync(dir).map((f) => ({ f, text: strip(readFileSync(join(dir, f), "utf8")) }));
const code = files.filter((x) => /\.tsx?$/.test(x.f));
const all = code.filter((x) => !x.f.endsWith("-art.tsx")).map((x) => x.text).join("\n");
const page = strip(readFileSync(join(root, "app/personal/page.tsx"), "utf8"));
// the shared typed-count pattern (route-test-support.ts), with "one" counted: this page was written to it
const COUNT = typedCount({ one: true });

describe("personal route", () => {
  it("is a registry route, gated and rendered from its own body", () => {
    expect(V34_ROUTE_KEYS).toContain("personal");
    expect(v34Route("personal").release).toBe("live");
    expect(page).toContain('releaseGate("personal")');
    expect(page).toContain('routeMetadata("personal")');
    expect(page).not.toContain("RouteStub");
  });

  it("renders one h1 that is the registry title", () => {
    const html = renderToStaticMarkup(createElement(PersonalBody));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(h1Text(html)).toBe("Turn your own PDFs into a World you can cite");
    expect(code.filter((x) => /<h1\b/.test(x.text))).toHaveLength(0);
  });

  it("links only to live registry routes and types no path", () => {
    for (const path of PERSONAL_DESTINATIONS) {
      expect(v34RouteByPath(path)?.release, path).toBe("live");
    }
    for (const x of code) expect(x.text, x.f).not.toMatch(/["'`]\/[a-z]/);
  });

  it("types no price, plan, tool name or figure", () => {
    expect(all).not.toMatch(/[$€£₩]\s?\d/);
    // The page component's own name is not a plan: route-test-support.ts names that one use, and only it.
    const named = code.filter((x) => !x.f.endsWith("-art.tsx")).map((x) => withoutNonPlanWords(`routes/personal/${x.f}`, x.text)).join("\n");
    for (const offer of Object.values(BILLING_OFFERS)) expect(named).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    // and what a reader reads: the rendered body names no plan, not even its own route name (the breadcrumb
    // JSON-LD carries that name, as the registry allows, and is not read on the page)
    const body = renderToStaticMarkup(createElement(PersonalBody)).replace(/<script\b[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");
    for (const offer of Object.values(BILLING_OFFERS)) expect(body).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const name of MCP_TOOL_NAMES) expect(all).not.toContain(name);
    expect(all).not.toMatch(/\b\d{3,}\b|\b\d+\.\d+\b|\d\s?%/);
    expect(all).not.toMatch(/\b\d+\s+(?:files?|days?|pages?|tools?|documents?)\b/i);
    // the art is in: its coordinates carry no counted noun, but its label is text a reader hears
    for (const x of code) expect(x.text, x.f).not.toMatch(COUNT);
  });

  it("the count guard catches every shape of a typed count", () => {
    const counts = ["three", "Fifteen", "twenty-one", "a dozen", "dozens of", "a handful of", "a couple of", "5", "12"];
    const fillers = ["", "of your ", "PDF ", "MCP ", "of your own ", "short 10-K PDF "];
    for (const n of counts) for (const f of fillers) for (const noun of ["files", "PDF", "tools", "days"]) {
      expect(`${n} ${f}${noun}`).toMatch(COUNT);
    }
    for (const ok of ["Start with the few files that matter to one goal.", "Any MCP client can read the World", "Ask a question"]) {
      expect(ok).not.toMatch(COUNT);
    }
  });

  it("prints the computed tool list", () => {
    const html = renderToStaticMarkup(createElement(PersonalBody));
    for (const name of MCP_TOOL_NAMES) expect(html).toContain(name);
  });

  it("drops what the register removed, uses no raster and has no disclaimer copy", () => {
    expect(all).not.toMatch(/recurring|maintenance|local sources|one private World|\.webp|<img/i);
    const content = code.find((x) => x.f === "personal-content.ts")!.text;
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
    expect(typedCounts("personal", { one: true })).toEqual([]);
  });
});
