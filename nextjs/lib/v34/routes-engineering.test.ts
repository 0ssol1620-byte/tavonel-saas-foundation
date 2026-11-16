import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { EngineeringBody } from "@/components/v34/routes/engineering/engineering";
import { ACCESS, ENGINEERING_DESTINATIONS, REFERENCE, STEPS } from "@/components/v34/routes/engineering/engineering-content";
import { readPublicCorpus } from "./public-corpus";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/engineering");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const files = readdirSync(dir).map((f) => ({ f, text: strip(readFileSync(join(dir, f), "utf8")) }));
const code = files.filter((x) => /\.tsx?$/.test(x.f));
// the SVG art carries coordinates, which are not figures
const all = code.filter((x) => !x.f.endsWith("-art.tsx")).map((x) => x.text).join("\n");
const content = code.find((x) => x.f === "engineering-content.ts")!.text;
const page = strip(readFileSync(join(root, "app/engineering/page.tsx"), "utf8"));
const words = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen"
  + "|(?:twen|thir|for|fif|six|seven|eigh|nine)ty|hundreds?|thousands?|millions?|dozens?|handful|couple|pair|score";
const nouns = "controls?|requirements?|revisions?|versions?|documents?|pages?|sources?|records?|procedures?|standards?|editions?|releases?";
const COUNT = new RegExp(`\\b(?:(?:${words})(?:-[a-z]+)?|\\d+)\\s+(?:[\\w-]+\\s+){0,4}(?:${nouns})\\b`, "i");

describe("engineering route", () => {
  it("is a live registry route, gated and rendered from its own body", () => {
    expect(V34_ROUTE_KEYS).toContain("engineering");
    expect(v34Route("engineering").release).toBe("live");
    expect(page).toContain('releaseGate("engineering")');
    expect(page).toContain('routeMetadata("engineering")');
    expect(page).not.toContain("RouteStub");
  });

  it("renders one h1 that is exactly the registry title", () => {
    const html = renderToStaticMarkup(createElement(EngineeringBody));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)![1];
    expect(h1).toBe(v34Route("engineering").title.replace(/ — TAVONEL$/, ""));
    expect(code.filter((x) => /<h1\b/.test(x.text))).toHaveLength(0);
  });

  it("shows the standards Change record from the corpus, labelled", () => {
    const html = renderToStaticMarkup(createElement(EngineeringBody));
    const corpus = readPublicCorpus();
    const changes = corpus.nodes.filter((n) => n.domain === "Standards" && n.kind === "Change");
    expect(changes.length).toBeGreaterThan(0);
    for (const node of changes) {
      expect(html).toContain(node.label);
      expect(html).toContain(corpus.sources[node.source][2]);
    }
    expect(html).toContain("Public reference corpus");
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it("follows the prototype order: steps band, then the Change record, then access", () => {
    const html = renderToStaticMarkup(createElement(EngineeringBody));
    const at = (s: string) => html.indexOf(s);
    expect(at(STEPS.title)).toBeGreaterThan(-1);
    expect(at(STEPS.title)).toBeLessThan(at(REFERENCE.title));
    expect(at(REFERENCE.title)).toBeLessThan(at(ACCESS.title));
  });

  it("prints the computed tool list", () => {
    const html = renderToStaticMarkup(createElement(EngineeringBody));
    for (const name of MCP_TOOL_NAMES) expect(html).toContain(name);
  });

  it("links only to live registry routes and types no path", () => {
    for (const path of ENGINEERING_DESTINATIONS) expect(v34RouteByPath(path)?.release, path).toBe("live");
    for (const x of code) expect(x.text, x.f).not.toMatch(/["'`]\/[a-z]/);
  });

  it("types no price, plan, tool name or figure", () => {
    expect(all).not.toMatch(/[$€£₩]\s?\d/);
    for (const offer of Object.values(BILLING_OFFERS)) expect(all).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const name of MCP_TOOL_NAMES) expect(all).not.toContain(name);
    expect(all).not.toMatch(/\b\d{3,}\b|\b\d+\.\d+\b|\d\s?%|sha256:/);
    for (const x of code) expect(x.text, x.f).not.toMatch(COUNT);
  });

  it("the count guard catches every shape of a typed count", () => {
    for (const n of ["five", "Fifteen", "twenty-one", "a dozen", "dozens of", "a couple of", "5", "12"]) {
      for (const f of ["", "NIST ", "800-53 "]) for (const noun of ["controls", "revision", "pages"]) {
        expect(`${n} ${f}${noun}`).toMatch(COUNT);
      }
    }
    for (const ok of ["Compare versions", "From a revision to the requirement it changed.", "Read the revision guide"]) {
      expect(ok).not.toMatch(COUNT);
    }
  });

  it("drops what the register removed and has no disclaimer copy", () => {
    expect(content).not.toMatch(/firmware|deprecated|Approved service|supplier|\.webp|<img/i);
    expect(content).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });

  it("uses no colour literal and no hidden overflow", () => {
    for (const x of files) {
      expect(x.text, x.f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
      expect(x.text, x.f).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden|:global/);
    }
  });
});
