import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { COMPANY_REGISTRY_LINKS, RETAINED } from "@/components/v34/routes/company/company-content";
import { CompanyBody } from "@/components/v34/routes/company/company";
import { routeMetadata } from "./route-metadata";
import { V34_ROUTE_KEYS, v34Route } from "./routes";

/*
  Source-level guards for /company (components/v34/routes/company/** and app/company/page.tsx) plus
  one server render, in the shape of lib/v34/routes-security.test.ts: the page gates on its registry
  key, takes its title from the registry, types no figure, price, plan or certification, invents no
  founding date, team, investor or customer, links only to live routes or retained pages that exist.
*/

const KEY = "company" as const;
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes", KEY);

function filesUnder(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const sources = filesUnder(dir).map((path) => ({
  file: relative(root, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));
const code = sources.filter((f) => /\.tsx?$/.test(f.file));
const styles = sources.filter((f) => f.file.endsWith(".css"));
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const stripped = (list: typeof sources) => list.map((f) => ({ file: f.file, text: strip(f.text) }));
const page = strip(readFileSync(join(root, "app", KEY, "page.tsx"), "utf8"));
const html = renderToStaticMarkup(createElement(CompanyBody));
const plain = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("company route files", () => {
  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });

  it("no longer renders the stub", () => {
    expect(page).not.toContain("RouteStub");
  });
});

describe("the page file", () => {
  it("gates on its registry key before anything renders, and takes its metadata from the registry", () => {
    expect(V34_ROUTE_KEYS).toContain(KEY);
    expect(page).toContain(`releaseGate("${KEY}")`);
    expect(page.indexOf("releaseGate")).toBeLessThan(page.indexOf("<Company"));
    expect(page).toContain(`routeMetadata("${KEY}")`);
    expect(page).toContain("routeViewport()");
  });

  it("renders its structured data inside the frame", () => {
    const body = stripped(code).find((f) => f.file.endsWith("/company.tsx"))!;
    expect(body.text).toContain(`<V34Page route="${KEY}">`);
    expect(body.text).toContain(`<RouteJsonLd route="${KEY}" />`);
  });
});

describe("one h1, from the registry", () => {
  it("writes no h1 of its own, mounts one Hero and renders the registry title", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    expect(stripped(code).find((f) => f.file.endsWith("/company.tsx"))!.text.match(/<Hero\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(plain(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)![0]).trim()).toBe(v34Route(KEY).title.replace(/ — TAVONEL$/, ""));
    expect(routeMetadata(KEY).title).toBe(v34Route(KEY).title);
    expect(plain(html)).toContain(v34Route(KEY).description);
  });
});

describe("no typed figure, price, plan or invented fact", () => {
  const text = stripped(code).filter((f) => !f.file.endsWith("-art.tsx")).map((f) => f.text).join("\n");

  it("types no price and names no plan", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) expect(text, `plan "${offer.label}"`).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
  });

  it("writes no figure", () => {
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(text).not.toMatch(/\b\d+\.\d+\b/);
    expect(text).not.toMatch(/\b\d{3,}\b/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b\d+\s+(?:records?|sources?|documents?|pages?|files?|days?|hours?|minutes?|seconds?|tools?)\b/i);
  });

  it("claims no certification and invents no founding date, team, investor, customer or publisher earnings", () => {
    expect(text).not.toMatch(/\b(?:certified|certification|compliant|compliance|attestation|audited|SOC ?2|ISO ?27001|HIPAA|NIST|FedRAMP)\b/i);
    expect(text).not.toMatch(/\b(?:founded|investors?|funding|backed by|our team|customers include|trusted by)\b/i);
    expect(text).not.toMatch(/\bearn\b/i);
    expect(text).not.toMatch(/\b(?:D\d{2}|U\d{2}|WO-[A-Z]+-[A-Z]?\d+|EG-\d+)\b/);
  });

  it("states no defensive disclaimer", () => {
    expect(plain(html)).not.toMatch(/not (?:a )?claim|not customer|no customer results|not validated/i);
  });

  it("prints no undefined or NaN", () => {
    expect(html).not.toMatch(/undefined|NaN/);
  });
});

describe("links", () => {
  it("types no path outside the retained-page table", () => {
    for (const f of stripped(code)) {
      const without = f.file.endsWith("company-content.ts") ? f.text.replace(/export const RETAINED = \{[\s\S]*?\} as const;/, "") : f.text;
      expect(without, f.file).not.toMatch(/["'`]\/[a-z.]/);
    }
  });

  it("links to live registry routes only, and links the three it names", () => {
    for (const key of COMPANY_REGISTRY_LINKS) {
      expect(v34Route(key).release, `${key} is held`).toBe("live");
    }
    expect(html).toContain(`href="${v34Route("platform").path}"`);
    expect(html).toContain(`href="${v34Route("contact").path}"`);
    expect(html).not.toContain(`href="${v34Route("film").path}"`);
  });

  it("links to every document it names, each served by a page in this tree", () => {
    for (const path of Object.values(RETAINED)) {
      expect(existsSync(join(root, "app", path, "page.tsx")), `${path} is served by nothing in this tree`).toBe(true);
      expect(html).toContain(`href="${path}"`);
    }
  });
});

describe("analytics", () => {
  it("adds no event of its own", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/track\w*\(|data-analytics|gtag|dataLayer/);
  });
});

describe("tokens, targets and states", () => {
  it("uses no colour literal and reads only --v34-* custom properties", () => {
    for (const f of stripped(sources)) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
    }
    for (const f of stripped(styles)) for (const [, name] of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, f.file).toMatch(/^--v34-/);
  });

  it("sets a foreground wherever it paints a background", () => {
    for (const f of stripped(styles)) {
      for (const [, selector, body] of f.text.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) {
        if (!/(?:^|;|\s)background(?:-color)?\s*:/.test(body!)) continue;
        expect(body, `${f.file}: ${selector!.trim()} paints a background without a colour`).toMatch(/(?:^|;|\s)color\s*:/);
      }
    }
  });

  it("hides no overflow, imports nothing and has no motion of its own", () => {
    for (const f of stripped(styles)) {
      expect(f.text).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden/);
      expect(f.text).not.toMatch(/@import\b/);
      expect(f.text).not.toMatch(/\b(?:animation|transition|@keyframes)\b/);
    }
  });

  it("gives every link class a 24px target, a hover and a focus state", () => {
    const sheet = stripped(styles).map((f) => f.text).join("\n");
    const linkClasses = [...new Set([...sheet.matchAll(/\.(\w*(?:[lL]ink))\s*\{/g)].map((m) => m[1]!))];
    expect(linkClasses.length).toBeGreaterThan(0);
    for (const name of linkClasses) {
      const rule = sheet.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))![1]!;
      const min = rule.match(/min-height:\s*([\d.]+)(px|rem)/);
      expect(min, `.${name} has no min-height`).not.toBeNull();
      expect(Number(min![1]) * (min![2] === "rem" ? 16 : 1), `.${name} target`).toBeGreaterThanOrEqual(24);
      expect(sheet, `.${name}:hover`).toMatch(new RegExp(`\\.${name}:hover`));
      expect(sheet, `.${name}:focus-visible`).toMatch(new RegExp(`\\.${name}:focus-visible`));
    }
  });
});
