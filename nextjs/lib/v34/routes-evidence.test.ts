import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { h1Text, typedCounts } from "./route-test-support";
import { EvidenceBody } from "@/components/v34/routes/evidence/evidence";
import { sampleEvidencePage } from "@/lib/evidence-regions";
import { EVIDENCE_DESTINATIONS, EVIDENCE_RETAINED } from "@/components/v34/routes/evidence/evidence-content";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { DOCS_SECTIONS } from "@/lib/docs-content";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { PUBLIC_CORPUS_STATS } from "./public-corpus";
import { routeMetadata } from "./route-metadata";
import { v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for the /evidence route (components/v34/routes/evidence/** and app/evidence/page.tsx),
  plus one server render. The rules that keep a route honest are pinned as text checks, as on the
  home page: a figure that is not computed, a price or plan or tool name typed by hand, a second h1, a
  colour that is not a token, a link to a held page, a sentence the product cannot back.
*/

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/evidence");

function filesUnder(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const sources = filesUnder(dir).map((path) => ({ file: relative(root, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }));
const code = sources.filter((f) => /\.tsx?$/.test(f.file));
const styles = sources.filter((f) => f.file.endsWith(".css"));

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const stripped = (list: typeof sources) => list.map((f) => ({ file: f.file, text: stripComments(f.text) }));
const page = stripComments(readFileSync(join(root, "app/evidence/page.tsx"), "utf8"));
const html = renderToStaticMarkup(createElement(EvidenceBody, { view: sampleEvidencePage() }));

describe("evidence route files", () => {
  it("has exactly the files this route composes", () => {
    expect(sources.map((f) => f.file.split("/").pop()).sort()).toEqual(["evidence-art.tsx", "evidence-content.ts", "evidence-regions.tsx", "evidence.module.css", "evidence.tsx"]);
  });

  it("is English only and carries no internal id", () => {
    for (const f of sources) {
      expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
      expect(stripComments(f.text), f.file).not.toMatch(/\b(?:D\d{2}|U\d{2}|EG-\d+|WO-[A-Z]+(?:-[A-Z0-9]+)?)\b/);
    }
  });
});

describe("app/evidence/page.tsx", () => {
  it("is the thin V34 page: registry metadata, the release gate, then the body", () => {
    expect(page).toContain('routeMetadata("evidence")');
    expect(page).toContain('releaseGate("evidence")');
    expect(page).toContain("routeViewport()");
    expect(page.indexOf('releaseGate("evidence")')).toBeLessThan(page.indexOf("<Evidence"));
    expect(page).not.toMatch(/PublicSitePage|trust-next|own-files-cta|RouteStub/);
  });

  it("uses a key from the registry and takes its words from it", () => {
    expect(v34Route("evidence").path).toBe("/evidence");
    expect(v34Route("evidence").release).toBe("live");
    expect(routeMetadata("evidence").title).toBe(v34Route("evidence").title);
    expect(stripComments(sources.find((f) => f.file.endsWith("/evidence.tsx"))!.text)).toContain('route="evidence"');
  });
});

describe("one h1", () => {
  it("writes no h1 of its own and mounts exactly one Hero", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    const body = stripped(code).find((f) => f.file.endsWith("/evidence.tsx"))!;
    expect(body.text.match(/<Hero\b/g)).toHaveLength(1);
  });

  it("renders exactly one h1 and it is the registry heading", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(h1Text(html)).toBe("Evidence regions behind every cited answer");
    expect(v34Route("evidence").heading).toBe("Evidence regions behind every cited answer");
  });
});

describe("numbers come from the corpus and the product, prices and plans from the catalog", () => {
  const text = stripped(code).filter((f) => !f.file.endsWith("-art.tsx")).map((f) => f.text).join("\n");

  it("types no price", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    expect(text).not.toMatch(/\bpriceUsd\b/);
  });

  it("names no plan and no MCP tool by hand", () => {
    for (const offer of Object.values(BILLING_OFFERS)) {
      expect(text, `plan label "${offer.label}"`).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    }
    for (const tool of MCP_TOOL_NAMES) expect(text, `tool ${tool}`).not.toContain(tool);
  });

  it("writes no figure: no grouped, decimal or three-digit number, no percentage, no count-plus-noun", () => {
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(text).not.toMatch(/\b\d+\.\d+\b/);
    expect(text).not.toMatch(/\b\d{3,}\b/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b\d+\s+(?:records?|relationships?|sources?|documents?|pages?|files?|days?|minutes?|seconds?|tools?|formats?|filings?|regions?)\b/i);
  });

  it("does not restate any count the corpus snapshot computes", () => {
    const stats = PUBLIC_CORPUS_STATS();
    const computed = [stats.records, stats.relations, stats.relationTypes, stats.sources.total, stats.sources.loaded, stats.sources.referenceOnly, stats.controlRecords, ...stats.layers.map((l) => l.count), ...stats.domains.map((d) => d.count)];
    for (const n of computed) {
      for (const form of [String(n), n.toLocaleString("en-US")]) {
        expect(text, `the computed figure ${form}`).not.toMatch(new RegExp(`(?<![\\w.,\\[])${form.replace(",", "\\,")}(?![\\w.,\\]])`));
      }
    }
  });

  it("renders without an unresolved value", () => {
    expect(html).not.toMatch(/undefined|NaN|\[object/);
    const stats = PUBLIC_CORPUS_STATS();
    for (const s of stats.statuses) expect(html).toContain(s.count.toLocaleString("en-US"));
    expect(html).toContain("Records marked uncertain");
    expect(html).toContain("control-ac-1");
    expect(html).toContain("Open this region in the sample");
  });
});

describe("what the crosswalk carries over from the legacy page", () => {
  const content = sources.find((f) => f.file.endsWith("-content.ts"))!.text;
  const body = sources.find((f) => f.file.endsWith("/evidence.tsx"))!.text;

  it("keeps the shipped locator and the seven contracted ones as declarations the pin can read", () => {
    const shipped = content.match(/const READING_TODAY = \["([^"]+)"/);
    expect(shipped?.[1]).toBe("PDF");
    const contracted = content.match(/const CONTRACTED_LOCATORS = \[([\s\S]*?)\n\] as const;/);
    expect(contracted).not.toBeNull();
    const families = [...contracted![1]!.matchAll(/\["([^"]+)",/g)].map((m) => m[1]!);
    expect(families).toHaveLength(7);
    expect(families).not.toContain("PDF");
  });

  it("renders the shipped locator first and the contracted ones after the statement that they are unshipped", () => {
    expect(html).toContain("Reading today");
    for (const family of ["Spreadsheet", "Presentation", "Email", "JSON and XML", "Code", "CAD and BIM", "Audio and video"]) expect(html).toContain(family);
    expect(html.indexOf("ahead of the readers")).toBeGreaterThan(html.indexOf("Reading today"));
    expect(html.indexOf("Spreadsheet")).toBeGreaterThan(html.indexOf("ahead of the readers"));
    expect(html.match(/ahead of the readers/g)).toHaveLength(1);
    expect(html).not.toContain("<details");
  });

  it("states its own role and names at least three of its trust siblings", () => {
    expect(content).toContain("how a compiled result stays bound to the");
    expect(html).toContain("how a compiled result stays bound to the source it came from");
    const named = ["/benchmarks", "/reproducibility", "/research", "/trust"].filter((href) => content.includes(href) || html.includes(`href="${href}"`));
    expect(named.length).toBeGreaterThanOrEqual(3);
  });

  it("ends its trust steps on the shared TrustNext, named for this page and quiet", () => {
    expect(body).toContain('import { TrustNext } from "@/components/trust-next"');
    expect(body).toContain('<TrustNext from="/evidence" heading="h3" emphasis="quiet" />');
    expect(html).toContain("trust-next");
    expect(html).toContain("Next: Benchmarks");
    expect(html).toContain('class="btn ghost"');
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
      expect(f.text, f.file).not.toMatch(/(?:color|background|border[\w-]*|outline[\w-]*|fill|stroke)\s*:[^;]*(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple)(?![\w-])/i);
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

  it("hides no overflow, clamps no text and imports nothing", () => {
    for (const f of stripped(styles)) {
      expect(f.text).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden/);
      expect(f.text).not.toMatch(/line-clamp/);
      expect(f.text).not.toMatch(/@import\b/);
    }
  });

  it("has no motion of its own", () => {
    for (const f of stripped(styles)) expect(f.text).not.toMatch(/\b(?:animation|transition|@keyframes)\b/);
  });
});

/** Every style rule of a sheet with the at-rule preludes it sits in, so `@media (…) .a` and `.a` differ. */
function rulesOf(css: string): { context: string; selector: string }[] {
  const out: { context: string; selector: string }[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === "{") {
      const prelude = css.slice(start, i).trim();
      if (!prelude.startsWith("@")) out.push({ context: stack.join(" "), selector: prelude.replace(/\s+/g, " ") });
      stack.push(prelude);
      start = i + 1;
    } else if (css[i] === "}") {
      stack.pop();
      start = i + 1;
    }
  }
  return out;
}

describe("containment of the route sheet", () => {
  it("writes every selector as one flat compound: no combinator, so no descendant type or class can leak", () => {
    for (const f of stripped(styles)) {
      for (const { selector } of rulesOf(f.text)) {
        for (const complex of selector.split(",").map((part) => part.trim())) {
          const flattened = complex.replace(/\[[^\]]*\]/g, "[]").replace(/\([^)]*\)/g, "()");
          expect(flattened, `${f.file}: ${complex}`).toMatch(/^\.[\w-]+(?:\[\]|:[\w-]+(?:\(\))?)*$/);
        }
      }
    }
  });

  it("declares no selector twice in the same context, so one class never styles two elements by accident", () => {
    for (const f of stripped(styles)) {
      const seen = new Set<string>();
      for (const { context, selector } of rulesOf(f.text)) {
        const key = `${context} ${selector}`.trim();
        expect(seen.has(key), `${f.file}: ${key} is declared twice`).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("links", () => {
  const retained = EVIDENCE_RETAINED.map((href) => href.split("?")[0]!);

  it("types no path outside the content file, and only retained paths there", () => {
    for (const f of stripped(code)) {
      if (f.file.endsWith("-content.ts")) continue;
      // `from="/evidence"` names this page's own step of the trust order for TrustNext; it is a key, not a link.
      expect(f.text.replace('from="/evidence"', ""), f.file).not.toMatch(/["'\`]\/[a-z]/);
    }
    const content = stripped(code).find((f) => f.file.endsWith("-content.ts"))!;
    for (const [, path] of content.text.matchAll(/["'\`](\/[a-z][\w/-]*)/g)) {
      expect(retained, `${path} is not a declared retained destination`).toContain(path);
    }
  });

  it("points every retained destination at a page, a route handler or a docs section that exists", () => {
    expect(retained.length).toBeGreaterThan(0);
    for (const path of retained) {
      const docs = path.match(/^\/docs\/([\w-]+)$/);
      const found = docs
        ? DOCS_SECTIONS.some((section) => section.slug === docs[1])
        : existsSync(join(root, "app", path, "page.tsx")) || existsSync(join(root, "app", path, "route.ts"));
      expect(found, `${path} has no page`).toBe(true);
    }
  });

  it("links only to live registry routes", () => {
    for (const path of EVIDENCE_DESTINATIONS) {
      const route = v34RouteByPath(path);
      expect(route, `${path} is not in the registry`).toBeDefined();
      expect(route!.release, `${path} is held`).toBe("live");
    }
  });

  it("opens each external source in a new tab, with the reason said to a screen reader", () => {
    const external = [...html.matchAll(/<a [^>]*href="https:\/\/[^"]+"[^>]*>/g)].map((m) => m[0]);
    for (const tag of external) expect(tag).toMatch(/target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/);
    expect(html.match(/\(opens in a new tab\)/g)?.length ?? 0).toBeGreaterThanOrEqual(external.length);
  });
});

describe("analytics", () => {
  it("fires no event of its own", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/track[A-Z]\w*|data-analytics|gtag|dataLayer/);
  });
});

describe("copy", () => {
  const content = stripped(code).find((f) => f.file.endsWith("-content.ts"))!;

  it("states what things are, with no defensive disclaimer", () => {
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });

  it("leaves out what the product does not ship and what the register removed", () => {
    const text = stripped(code).map((f) => f.text).join("\n");
    for (const phrase of ["model conclusion", "Check access at query time", "forbidden document", "$416", "Apple", "certif", "quarantine", "tamper-proof", "guarantee"]) expect(text.toLowerCase(), phrase).not.toContain(phrase.toLowerCase());
  });
});

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("evidence")).toEqual([]);
  });
});
