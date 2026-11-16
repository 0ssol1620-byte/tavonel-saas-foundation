import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { typedCounts } from "./route-test-support";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MarketplaceBody } from "@/components/v34/routes/marketplace/marketplace";
import { v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for the held /marketplace route (app/marketplace/page.tsx and components/v34/routes/marketplace/**),
  plus one server render: the gate, the registry key, one h1, no typed price, plan, fee or figure,
  no defensive disclaimer, no link to a held route.
*/

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/marketplace");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const files = readdirSync(dir).map((name) => ({ name, text: strip(readFileSync(join(dir, name), "utf8")) }));
const code = files.filter((f) => /\.tsx?$/.test(f.name)).map((f) => f.text).join("\n");
const page = strip(readFileSync(join(root, "app/marketplace/page.tsx"), "utf8"));
const html = renderToStaticMarkup(createElement(MarketplaceBody));
const visible = html.replace(/<[^>]*>/g, " ");

describe("marketplace page", () => {
  it("is the thin V34 page: registry metadata, then the release gate, then the body", () => {
    expect(page).toContain('routeMetadata("marketplace")');
    expect(page).toContain("routeViewport()");
    expect(page).toContain('await releaseGate("marketplace")');
    expect(page.indexOf("releaseGate(")).toBeLessThan(page.indexOf("<Marketplace"));
    expect(v34Route("marketplace").release).toBe("held");
  });

  it("renders one h1 whose text is exactly the registry title, without the document-title suffix", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)![1]!.replace(/<[^>]*>/g, "");
    expect(h1).toBe("A marketplace for compiled knowledge Worlds");
    expect(code).not.toMatch(/<h1\b/);
  });

  it("shows the document-title form nowhere on the page", () => {
    expect(visible).not.toMatch(/—\s*TAVONEL/);
    expect(html).not.toContain(v34Route("marketplace").title);
  });
});

describe("marketplace copy", () => {
  it("is English only", () => {
    for (const f of files) expect(f.text, f.name).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });

  it("types no price, plan, fee, seller or figure", () => {
    expect(code).not.toMatch(/[$€£₩]\s?\d/);
    expect(visible).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b|\b\d+\.\d+\b|\b\d{2,}\b|\d\s?%/);
    expect(code).not.toMatch(/\b(?:USD|per month|a month|payout|commission|platform fee|MCP)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) expect(code).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
  });

  it("uses none of the held-row forbidden terms", () => {
    expect(visible).not.toMatch(/Curated Worlds|directory listing|role matrix|\b(?:fifteen|ten|twenty|thirty|fifty)\s+(?:percent|per cent)\b/i);
  });

  it("states what things are, with no defensive disclaimer and no internal id", () => {
    expect(code.replace(/aria-label="[^"]*"/g, "")).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
    expect(code).not.toMatch(/\b(?:D\d\d|U\d\d|EG-\d+|WO-RT)\b/);
  });

  it("gives its headings the surface's text colour, since the global h3 colour is near-white", () => {
    // every V34 surface points the site-wide h1-h3 colour (--text-hi) at its own text colour
    const tokens = readFileSync(join(root, "components/v34/tokens.module.css"), "utf8");
    expect(tokens.match(/--text-hi: var\(--v34-fg\);/g)).toHaveLength(2);
    const css = readFileSync(join(dir, "marketplace.module.css"), "utf8");
    expect(css).not.toMatch(/\.itemTitle \{[^}]*\bcolor:(?! var\(--v34-fg\))/);
  });

  it("labels its drawing as an illustration", () => {
    expect(code).toContain('kind="Illustration"');
    expect(html).toContain("Illustration");
  });
});

describe("marketplace links", () => {
  it("types no path: every destination is a registry key", () => {
    expect(code).not.toMatch(/["'`]\/[a-z]/);
  });

  it("links only to live routes", () => {
    const hrefs = [...html.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]!).filter((h) => v34RouteByPath(h));
    for (const path of hrefs) expect(v34RouteByPath(path)!.release, path).toBe("live");
  });
});

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("marketplace")).toEqual([]);
  });
});
