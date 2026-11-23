import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { typedCount, typedCounts } from "./route-test-support";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { EngineeringBody } from "@/components/v34/routes/engineering/engineering";
import { ACCESS, ENGINEERING_DESTINATIONS, REFERENCE, STEPS, SUPPORT } from "@/components/v34/routes/engineering/engineering-content";
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
// the shared typed-count pattern (route-test-support.ts), with "one" counted and this page's own nouns
const COUNT_OPTIONS = { one: true, nouns: ["controls?", "requirements?", "revisions?", "versions?", "procedures?", "standards?", "editions?", "releases?"] };
const COUNT = typedCount(COUNT_OPTIONS);

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
    expect(h1).toBe("Engineering references with revision history");
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

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("engineering", COUNT_OPTIONS)).toEqual([]);
  });
});

/*
  The lane review found three prototype parts missing. Register row /engineering removes firmware
  identification, the deprecated-procedure flag, the Approved service Skill and supplier exchange,
  and nothing else, so the support-issue split and the two reference actions are restored without
  those rows. The diff visual is the hero's own drawn art (two revisions, the changed line, its page).
*/
describe("what the register keeps from the prototype", () => {
  const html = renderToStaticMarkup(createElement(EngineeringBody));
  const at = (s: string) => html.indexOf(s);

  it("opens with the support-issue split, an illustrated issue beside it", () => {
    expect(at(SUPPORT.title)).toBeGreaterThan(-1);
    expect(at(SUPPORT.title)).toBeLessThan(at(STEPS.title));
    const split = html.slice(at(SUPPORT.title), at(STEPS.title));
    expect(split).toContain(">Illustration<");
    for (const [term, text] of SUPPORT.card.rows) {
      expect(split).toContain(term);
      expect(split).toContain(text);
    }
    expect(split).not.toMatch(/firmware|deprecated|Approved service|supplier/i);
  });

  it("ends the Change record band on revision handling and on privacy and access", () => {
    const band = html.slice(at(REFERENCE.title), at(ACCESS.title));
    for (const action of [REFERENCE.changes, REFERENCE.security]) {
      expect(band).toContain(`href="${action.href}"`);
      expect(band).toContain(action.label);
      expect(v34RouteByPath(action.href)?.release).toBe("live");
    }
  });

  it("keeps the diff visual as the hero's own drawn art", () => {
    expect(html.indexOf("an earlier and a later revision of a standard side by side")).toBeGreaterThan(-1);
    expect(html.indexOf("an earlier and a later revision of a standard side by side")).toBeLessThan(at(SUPPORT.title));
  });
});
