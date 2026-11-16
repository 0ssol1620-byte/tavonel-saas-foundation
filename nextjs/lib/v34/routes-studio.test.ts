import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOLS } from "@/lib/mcp-tools";
import { StudioBody } from "@/components/v34/routes/studio/studio";
import { STUDIO_DESTINATIONS } from "@/components/v34/routes/studio/studio-content";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { PUBLIC_CORPUS_STATS } from "./public-corpus";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";
import { WALKTHROUGH_STEPS } from "./walkthrough";

/*
  Source-level guards for the /studio route (components/v34/routes/studio/** and
  app/studio/page.tsx), plus one server render. Followed from home-page.test.ts.
*/

const KEY = "studio";
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes", KEY);

const files = readdirSync(dir).map((name) => ({ file: relative(root, join(dir, name)).replaceAll("\\", "/"), text: readFileSync(join(dir, name), "utf8") }));
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const code = files.filter((f) => /\.tsx?$/.test(f.file)).map((f) => ({ ...f, text: stripComments(f.text) }));
const styles = files.filter((f) => f.file.endsWith(".css")).map((f) => ({ ...f, text: stripComments(f.text) }));
const text = code.map((f) => f.text).join("\n");
const html = renderToStaticMarkup(createElement(StudioBody));
const page = stripComments(readFileSync(join(root, "app", KEY, "page.tsx"), "utf8"));

describe("studio page", () => {
  it("uses a registry key, the release gate and the registry metadata", () => {
    expect(V34_ROUTE_KEYS).toContain(KEY);
    expect(page).toContain(`releaseGate("${KEY}")`);
    expect(page).toContain(`routeMetadata("${KEY}")`);
    expect(page).toContain("routeViewport()");
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).not.toContain("RouteStub");
  });

  it("is English only", () => {
    for (const f of files) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });

  it("renders exactly one h1, the registry title, and writes none of its own", () => {
    for (const f of code) expect(f.text, f.file).not.toMatch(/<h1\b/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(v34Route(KEY).title.replace(/ — TAVONEL$/, ""));
  });

  it("labels the walkthrough and takes the primary action from the shared action", () => {
    expect(html).toContain("Reference walkthrough");
    expect(text).toContain("createWorldAction()");
    expect(html).toContain(createWorldAction().label);
    expect(html).toContain(`href="${createWorldAction().href}"`);
  });
});

describe("computed, not typed", () => {
  it("types no price, plan, tool name or figure", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    for (const offer of Object.values(BILLING_OFFERS)) expect(text, offer.label).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const [name] of MCP_TOOLS) expect(text, name).not.toMatch(new RegExp(`\\b${name}\\b`));
    // The copy lives in the content file; the component holds drawing geometry, which is numbers by nature.
    const copy = code.find((f) => f.file.endsWith("-content.ts"))!.text;
    for (const pattern of [/\b\d{1,3}(?:,\d{3})+\b/, /\b\d+\.\d+\b/, /\b\d{2,}\b/, /\d\s?%/]) expect(copy).not.toMatch(pattern);
  });

  it("prints the corpus counts and the walkthrough records", () => {
    const stats = PUBLIC_CORPUS_STATS();
    for (const n of [stats.records, stats.relations, stats.sources.total]) expect(html).toContain(n.toLocaleString("en-US"));
    for (const step of WALKTHROUGH_STEPS) expect(html).toContain(step.record.title);
    expect(html).not.toMatch(/undefined|NaN/);
  });
});

describe("copy", () => {
  it("drops what the register row removes", () => {
    for (const word of [/kPa/, /Cloud drive/i, /\bNAS\b/, /ChatGPT|Claude|Codex/, /connection check/i, /partial World/i]) {
      expect(html).not.toMatch(word);
    }
  });

  it("states what things are, with no defensive disclaimer", () => {
    const content = code.find((f) => f.file.endsWith("studio-content.ts"))!;
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });
});

describe("links", () => {
  it("types no path and links only to live registry routes", () => {
    for (const f of code) expect(f.text, f.file).not.toMatch(/["'`]\/[a-z]/);
    expect(STUDIO_DESTINATIONS.length).toBeGreaterThan(0);
    for (const path of STUDIO_DESTINATIONS) {
      const route = v34RouteByPath(path);
      expect(route, `${path} is not in the registry`).toBeDefined();
      expect(route!.release, `${path} is held`).toBe("live");
    }
  });
});

describe("sheet", () => {
  it("uses tokens only, pairs every background with a colour, hides no overflow and has no motion", () => {
    for (const f of styles) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|color-mix)\(/i);
      for (const [, name] of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, f.file).toMatch(/^--v34-/);
      for (const [, selector, body] of f.text.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) {
        if (/(?:^|;|\s)background(?:-color)?\s*:/.test(body!)) expect(body, selector!.trim()).toMatch(/(?:^|;|\s)color\s*:/);
      }
      expect(f.text).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden|@import\b|\b(?:animation|transition|@keyframes)\b/);
    }
  });
});
