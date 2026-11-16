import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { FederationBody } from "@/components/v34/routes/federation/federation";
import { v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for the held /federation route (app/federation/page.tsx and components/v34/routes/federation/**),
  plus one server render: the gate, the registry key, one h1, no typed price, plan, fee or figure,
  no defensive disclaimer, no link to a held route.
*/

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/federation");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const files = readdirSync(dir).map((name) => ({ name, text: strip(readFileSync(join(dir, name), "utf8")) }));
const code = files.filter((f) => /\.tsx?$/.test(f.name)).map((f) => f.text).join("\n");
const page = strip(readFileSync(join(root, "app/federation/page.tsx"), "utf8"));
const html = renderToStaticMarkup(createElement(FederationBody));
const visible = html.replace(/<[^>]*>/g, " ");

describe("federation page", () => {
  it("is the thin V34 page: registry metadata, then the release gate, then the body", () => {
    expect(page).toContain('routeMetadata("federation")');
    expect(page).toContain("routeViewport()");
    expect(page).toContain('await releaseGate("federation")');
    expect(page.indexOf("releaseGate(")).toBeLessThan(page.indexOf("<Federation"));
    expect(v34Route("federation").release).toBe("held");
  });

  it("renders one h1 that carries the registry title", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(v34Route("federation").title.replace(" — TAVONEL", ""));
    expect(code).not.toMatch(/<h1\b/);
  });
});

describe("federation copy", () => {
  it("is English only", () => {
    for (const f of files) expect(f.text, f.name).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });

  it("types no price, plan, fee, seller or figure", () => {
    expect(code).not.toMatch(/[$€£₩]\s?\d/);
    expect(visible).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b|\b\d+\.\d+\b|\b\d{2,}\b|\d\s?%/);
    expect(code).not.toMatch(/\b(?:USD|per month|a month|payout|commission|platform fee|MCP)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) expect(code).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
  });

  it("states what things are, with no defensive disclaimer and no internal id", () => {
    expect(code.replace(/aria-label="[^"]*"/g, "")).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
    expect(code).not.toMatch(/\b(?:D\d\d|U\d\d|EG-\d+|WO-RT)\b/);
  });

  it("labels its drawing as an illustration", () => {
    expect(code).toContain('kind="Illustration"');
    expect(html).toContain("Illustration");
  });
});

describe("federation links", () => {
  it("types no path: every destination is a registry key", () => {
    expect(code).not.toMatch(/["'`]\/[a-z]/);
  });

  it("links only to live routes", () => {
    const hrefs = [...html.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]!).filter((h) => v34RouteByPath(h));
    for (const path of hrefs) expect(v34RouteByPath(path)!.release, path).toBe("live");
  });
});
