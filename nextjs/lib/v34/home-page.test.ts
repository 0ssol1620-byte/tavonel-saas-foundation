import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { typedCounts } from "./route-test-support";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { primaryCallToAction } from "@/lib/commercial-state";
import { MARKETING_EVENTS } from "@/lib/marketing-analytics";
import { BRAND_LINE } from "@/lib/site-navigation";
import { CREATE_WORLD_LABEL, createWorldAction } from "@/components/v34/ui/create-world";
import { HomeBody } from "@/components/v34/routes/home/home";
import { Walkthrough } from "@/components/v34/walkthrough/walkthrough";
import { HOME_DESTINATIONS } from "@/components/v34/routes/home/home-content";
import { PUBLIC_CORPUS_STATS } from "./public-corpus";
import { routeMetadata } from "./route-metadata";
import { v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for the home route (components/v34/routes/home/** and app/page.tsx), plus one
  server render. The home page is the reference the other routes copy, so the rules that keep a
  route honest are pinned here as text checks: a figure that is not computed, a price or plan name
  typed by hand, a second h1, a colour that is not a token, a link to a held page.
*/

const root = fileURLToPath(new URL("../../", import.meta.url));
const homeDir = join(root, "components/v34/routes/home");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const files = existsSync(homeDir) ? filesUnder(homeDir) : [];
const sources = files.map((path) => ({ file: relative(root, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }));
const code = sources.filter((f) => /\.tsx?$/.test(f.file));
const styles = sources.filter((f) => f.file.endsWith(".css"));

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const stripped = (list: typeof sources) => list.map((f) => ({ file: f.file, text: stripComments(f.text) }));

const counts = (n: number) => [String(n), n.toLocaleString("en-US")];

describe("home route files", () => {
  it("has the component, its content, its analytics and its sheet", () => {
    expect(sources.map((f) => f.file.split("/").pop()).sort()).toEqual([
      "home-analytics.tsx", "home-content.ts", "home.module.css", "home.tsx",
    ]);
  });

  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("one h1", () => {
  it("writes no h1 of its own and mounts exactly one Hero", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    const home = stripped(code).find((f) => f.file.endsWith("/home.tsx"))!;
    expect(home.text.match(/<Hero\b/g)).toHaveLength(1);
  });

  it("renders exactly one h1 and it reads as the page title", () => {
    const html = renderToStaticMarkup(createElement(HomeBody));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Turn your files into <span[^>]*>knowledge your AI can trust\.<\/span><\/h1>/);
  });
});

describe("numbers come from the corpus, prices and plans from the catalog", () => {
  const text = stripped(code).map((f) => f.text).join("\n");

  it("types no price", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    expect(text).not.toMatch(/\bpriceUsd\b/);
  });

  it("names no plan by hand", () => {
    for (const offer of Object.values(BILLING_OFFERS)) {
      expect(text, `plan label "${offer.label}"`).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    }
  });

  it("writes no figure: no grouped, decimal or three-digit number, no percentage, no count-plus-noun", () => {
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(text).not.toMatch(/\b\d+\.\d+\b/);
    expect(text).not.toMatch(/\b\d{3,}\b/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b\d+\s+(?:records?|relationships?|sources?|documents?|pages?|files?|days?|minutes?|seconds?|tools?|formats?)\b/i);
  });

  it("does not restate any count the corpus snapshot computes", () => {
    const stats = PUBLIC_CORPUS_STATS();
    const computed = [stats.records, stats.relations, stats.relationTypes, stats.sources.total, stats.controlRecords, ...stats.layers.map((l) => l.count)];
    for (const n of computed) {
      for (const form of counts(n)) {
        expect(text, `the computed figure ${form}`).not.toMatch(new RegExp(`(?<![\\w.,])${form.replace(",", "\\,")}(?![\\w.,])`));
      }
    }
  });

  it("prints the computed counts at render time", () => {
    const stats = PUBLIC_CORPUS_STATS();
    const html = renderToStaticMarkup(createElement(HomeBody));
    for (const layer of stats.layers) expect(html).toContain(layer.count.toLocaleString("en-US"));
    expect(html).toContain(stats.records.toLocaleString("en-US"));
    expect(html).toContain(stats.relations.toLocaleString("en-US"));
    expect(html).toContain(stats.sources.total.toLocaleString("en-US"));
    expect(html).not.toMatch(/undefined|NaN/);
  });
});

describe("tokens and explicit pairs", () => {
  it("uses no colour literal in the sheet or in code", () => {
    for (const f of stripped(sources)) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
    }
  });

  it("names no basic colour and reads only --v34-* custom properties", () => {
    for (const f of stripped(styles)) {
      expect(f.text, f.file).not.toMatch(/(?:color|background|border[\w-]*|outline[\w-]*)\s*:[^;]*\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple)\b/i);
      for (const [, name] of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, f.file).toMatch(/^--v34-/);
    }
  });

  it("sets a foreground wherever it paints a background", () => {
    for (const f of stripped(styles)) {
      for (const [, selector, body] of f.text.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) {
        if (!/(?:^|;|\s)background(?:-color)?\s*:/.test(body!)) continue;
        expect(body, `${f.file}: ${selector!.trim()} paints a background without a colour`).toMatch(/(?:^|;|\s)color\s*:/);
      }
    }
  });

  it("hides no overflow and imports nothing", () => {
    for (const f of stripped(styles)) {
      expect(f.text).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden/);
      expect(f.text).not.toMatch(/@import\b/);
    }
  });

  it("has no motion of its own", () => {
    for (const f of stripped(styles)) expect(f.text).not.toMatch(/\b(?:animation|transition|@keyframes)\b/);
  });
});

describe("links and the primary action", () => {
  it("types no path: every destination is a registry key", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/["'`]\/[a-z]/);
  });

  it("links only to live routes", () => {
    expect(HOME_DESTINATIONS.length).toBeGreaterThan(0);
    for (const path of HOME_DESTINATIONS) {
      const route = v34RouteByPath(path);
      expect(route, `${path} is not in the registry`).toBeDefined();
      expect(route!.release, `${path} is held`).toBe("live");
    }
  });

  it("takes the primary label and destination from the shared action", () => {
    const home = stripped(code).find((f) => f.file.endsWith("/home.tsx"))!;
    expect(home.text).toContain("createWorldAction()");
    expect(home.text).not.toContain(CREATE_WORLD_LABEL);
    expect(CREATE_WORLD_LABEL).toBe("Create your World");
    expect(createWorldAction()).toEqual({ href: primaryCallToAction().href, label: "Create your World" });
  });

  it("puts the primary action before the World in the document", () => {
    const html = renderToStaticMarkup(createElement(HomeBody));
    const primary = html.indexOf('data-analytics="hero-primary"');
    expect(primary).toBeGreaterThan(-1);
    expect(primary).toBeLessThan(html.indexOf("data-world-instrument"));
    expect(html).toContain(createWorldAction().label);
  });

  it("scrolls the secondary action to a section that exists", () => {
    const html = renderToStaticMarkup(createElement(HomeBody));
    expect(html).toContain('href="#walkthrough"');
    expect(html).toContain('id="walkthrough"');
  });
});

describe("analytics use only existing event names", () => {
  it("fires names that are already forwarded", () => {
    const analytics = stripped(code).find((f) => f.file.endsWith("home-analytics.tsx"))!;
    const names = [...analytics.text.matchAll(/"([a-z]+(?:_[a-z0-9]+)+)"/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(MARKETING_EVENTS.has(name), name).toBe(true);
  });
});

describe("copy", () => {
  it("states what things are, with no defensive disclaimer", () => {
    const content = stripped(code).find((f) => f.file.endsWith("home-content.ts"))!;
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });
});

describe("app/page.tsx", () => {
  const page = stripComments(readFileSync(join(root, "app/page.tsx"), "utf8"));

  it("is the thin V34 page: registry metadata, gate, dynamic CTA, no Landing V2 import", () => {
    expect(page).toContain('routeMetadata("home")');
    expect(page).toContain('releaseGate("home")');
    expect(page).toContain("routeViewport()");
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).not.toMatch(/landing-v2|landing-experiments|compile-stages/);
  });

  it("keeps the named home title exception", () => {
    const { title } = routeMetadata("home");
    expect(title).toBe(`TAVONEL — ${BRAND_LINE.headline}`);
    expect(v34Route("home").title).toBe(title);
  });
});

describe("hero_demo_interact carries the step it opens", () => {
  it("puts the destination step on every walkthrough control and sends it as `scene`", () => {
    const html = renderToStaticMarkup(createElement(Walkthrough));
    // four tabs, then four "next" buttons that open the following step and wrap at the end
    expect([...html.matchAll(/data-step="(\d)"/g)].map((m) => m[1]).join("")).toBe("01231230");
    const analytics = readFileSync(join(root, "components/v34/routes/home/home-analytics.tsx"), "utf8");
    expect(analytics).toContain('trackFunnelOnce("hero_demo_interact", { scene: stepButton.dataset.step ?? "" })');
  });
});

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("home")).toEqual([]);
  });
});
