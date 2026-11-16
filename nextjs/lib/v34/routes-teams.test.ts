import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { typedCount, typedCounts } from "./route-test-support";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { TeamsBody } from "@/components/v34/routes/teams/teams";
import { TEAMS_DESTINATIONS } from "@/components/v34/routes/teams/teams-content";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/teams");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const files = readdirSync(dir).map((f) => ({ f, text: strip(readFileSync(join(dir, f), "utf8")) }));
const code = files.filter((x) => /\.tsx?$/.test(x.f));
const all = code.filter((x) => !x.f.endsWith("-art.tsx")).map((x) => x.text).join("\n");
const content = code.find((x) => x.f === "teams-content.ts")!.text;
const page = strip(readFileSync(join(root, "app/teams/page.tsx"), "utf8"));
// the shared typed-count pattern (route-test-support.ts), with "one" counted and this page's own nouns
const COUNT_OPTIONS = { one: true, nouns: ["members?", "readers?", "people", "users?", "seats?", "roles?", "versions?"] };
const COUNT = typedCount(COUNT_OPTIONS);

describe("teams route (held)", () => {
  it("is a held registry route that gates itself before rendering", () => {
    expect(V34_ROUTE_KEYS).toContain("teams");
    expect(v34Route("teams").release).toBe("held");
    expect(page).toContain('releaseGate("teams")');
    expect(page.indexOf("releaseGate")).toBeLessThan(page.indexOf("<Teams"));
    expect(page).toContain('routeMetadata("teams")');
    expect(page).not.toContain("RouteStub");
  });

  it("renders one h1 that is exactly the registry title", () => {
    const html = renderToStaticMarkup(createElement(TeamsBody));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)![1];
    expect(h1).toBe("Shared Worlds for groups that work together");
    expect(code.filter((x) => /<h1\b/.test(x.text))).toHaveLength(0);
  });

  it("prints the computed tool list", () => {
    const html = renderToStaticMarkup(createElement(TeamsBody));
    for (const name of MCP_TOOL_NAMES) expect(html).toContain(name);
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it("links only to live registry routes and types no path", () => {
    for (const path of TEAMS_DESTINATIONS) expect(v34RouteByPath(path)?.release, path).toBe("live");
    for (const x of code) expect(x.text, x.f).not.toMatch(/["'`]\/[a-z]/);
  });

  it("types no price, plan, tool name, figure or count", () => {
    expect(all).not.toMatch(/[$€£₩]\s?\d/);
    for (const offer of Object.values(BILLING_OFFERS)) expect(all).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const name of MCP_TOOL_NAMES) expect(all).not.toContain(name);
    expect(all).not.toMatch(/\b\d{3,}\b|\b\d+\.\d+\b|\d\s?%/);
    for (const x of code) expect(x.text, x.f).not.toMatch(COUNT);
  });

  it("promises no date, role matrix, permission or approval, and has no disclaimer copy", () => {
    expect(content).not.toMatch(/\b(?:soon|coming|launch(?:es|ing)?|roadmap|Q[1-4]|20\d\d|administrators?|reviewers?|approv\w*|permissions?|seats?|SSO)\b/i);
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
    expect(typedCounts("teams", COUNT_OPTIONS)).toEqual([]);
  });
});
