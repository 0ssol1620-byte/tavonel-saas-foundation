import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
    expect(html).toContain(v34Route("personal").title.replace(/ — TAVONEL$/, ""));
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
    for (const offer of Object.values(BILLING_OFFERS)) expect(all).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const name of MCP_TOOL_NAMES) expect(all).not.toContain(name);
    expect(all).not.toMatch(/\b\d{3,}\b|\b\d+\.\d+\b|\d\s?%/);
    expect(all).not.toMatch(/\b\d+\s+(?:files?|days?|pages?|tools?|documents?)\b/i);
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
