import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TRUST_PROVISIONS } from "@/content/trust/provisions";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { signedProductDemo } from "@/lib/signed-product-demo";
import { SAMPLE_FRAME_LABEL } from "@/components/sample-world-frame";
import { ENTERPRISE_REGISTRY_LINKS, RETAINED, SCOPED } from "@/components/v34/routes/enterprise/enterprise-content";
import { EnterpriseBody } from "@/components/v34/routes/enterprise/enterprise";
import { routeMetadata } from "./route-metadata";
import { V34_ROUTE_KEYS, v34Route } from "./routes";

/*
  Source-level guards for /enterprise (components/v34/routes/enterprise/** and app/enterprise/page.tsx)
  plus one server render, in the shape of lib/v34/home-page.test.ts: the page gates on its
  registry key, takes its title from the registry, types no figure, price or plan, claims no
  certification, links only to live routes or to retained pages that exist, keeps every required
  trust answer, and gives every link a target of at least 24px with a hover and a focus state.
*/

const KEY = "enterprise" as const;
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
const html = renderToStaticMarkup(createElement(EnterpriseBody));
const plain = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("enterprise route files", () => {
  it("has its component, content, art, sample frame and sheets", () => {
    expect(sources.map((f) => f.file.split("/").pop()).sort()).toEqual([
      "enterprise-art.tsx", "enterprise-content.ts", "enterprise.module.css", "enterprise.tsx", "sample-frame.module.css", "sample-frame.tsx",
    ]);
  });

  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("the page file", () => {
  it("gates on its registry key before anything renders, and takes its metadata from the registry", () => {
    expect(V34_ROUTE_KEYS).toContain(KEY);
    expect(page).toContain(`releaseGate("${KEY}")`);
    expect(page.indexOf("releaseGate")).toBeLessThan(page.indexOf("<Enterprise"));
    expect(page).toContain(`routeMetadata("${KEY}")`);
    expect(page).toContain("routeViewport()");
  });

  it("renders its structured data inside the frame", () => {
    const body = stripped(code).find((f) => f.file.endsWith("/enterprise.tsx"))!;
    expect(body.text).toContain(`<V34Page route="${KEY}">`);
    expect(body.text).toContain(`<RouteJsonLd route="${KEY}" />`);
  });
});

describe("one h1, from the registry", () => {
  it("writes no h1 of its own and mounts one Hero", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    const body = stripped(code).find((f) => f.file.endsWith("/enterprise.tsx"))!;
    expect(body.text.match(/<Hero\b/g)).toHaveLength(1);
  });

  it("renders exactly one h1 and it is the registry title", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(plain(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)![0]).trim()).toBe(v34Route(KEY).title.replace(/ — TAVONEL$/, ""));
    expect(routeMetadata(KEY).title).toBe(v34Route(KEY).title);
  });

  it("uses the registry description as its lead", () => {
    expect(plain(html)).toContain(v34Route(KEY).description);
  });
});

describe("no typed figure, price, plan or certification", () => {
  // The drawing's coordinates are geometry, not figures; every other file is read for numbers.
  const text = stripped(code).filter((f) => !f.file.endsWith("-art.tsx")).map((f) => f.text).join("\n").replace(/\b\d{4}-\d{2}-\d{2}\b/g, "");

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
    expect(text).not.toMatch(/\b\d+\s+(?:records?|sources?|documents?|pages?|files?|days?|hours?|minutes?|seconds?|tools?)\b/i);
  });

  it("claims no certification, audit, third-party test or standard, and carries no work-order id", () => {
    expect(text).not.toMatch(/\b(?:certified|certification|compliant|compliance|attestation|audited|SOC ?2|ISO ?27001|HIPAA|NIST|FedRAMP)\b/i);
    expect(text).not.toMatch(/penetration|third-party test|guarantee/i);
    expect(text).not.toMatch(/\b(?:D\d{2}|U\d{2}|WO-[A-Z]+-[A-Z]?\d+|EG-\d+)\b/);
  });
});

describe("what the previous page said is still said", () => {
  const phrases = [
    "pilot is scoped with us rather than bought online",
    "qualified review",
    "draft for review",
    "archived 2026-09-23 template",
    "Once executed, the signed agreement prevails within its scope",
    "Export a signed candidate package with its source inventory, provenance and validation record",
    "there is no silent activation",
    "Residency, private deployment and how people sign in are scoped with you before anything is promised",
  ];

  it.each(phrases)("keeps %s", (phrase) => {
    expect(plain(html)).toContain(phrase);
  });

  it("links the processing addendum and the archived template, labelled as such", () => {
    expect(html).toContain(`href="${RETAINED.addendum}"`);
    expect(html).toMatch(/href="\/policy\/TAVONEL_DPA_v2_2026-09-23\.md"[^>]*>archived 2026-09-23 template<\/a>/);
  });

  it("renders every provision row from the one content module, and none of it twice in the page's own files", () => {
    const text = plain(html);
    for (const row of TRUST_PROVISIONS) {
      expect(text, row.id).toContain(row.subject);
      expect(text, row.id).toContain(row.line);
    }
    const own = stripped(code).map((f) => f.text).join("\n");
    for (const row of TRUST_PROVISIONS) expect(own).not.toContain(row.line);
  });

  it("gives each Scoped-with-you card the sentence of the provision row it names", () => {
    for (const card of SCOPED.cards) {
      const row = TRUST_PROVISIONS.find((r) => r.id === card.provision);
      expect(row, card.provision).toBeDefined();
      expect(plain(html)).toContain(card.title);
      expect(plain(html)).toContain(row!.line);
    }
  });

  it("keeps the review inventory out of the page's own words", () => {
    const own = stripped(code).map((f) => f.text).join("\n");
    for (const internal of ["exactly one member", "SAML", "SCIM", "SOC 2", "ISO 27001", "penetration-test", "No uptime percentage", "RunPod", "Cloud Run", "431 catalog objects", "Apple"]) {
      expect(own, internal).not.toContain(internal);
    }
  });

  it("states no overage rate", () => {
    const own = stripped(code).map((f) => f.text).join("\n");
    expect(own).not.toMatch(/per standard page|STANDARD_PAGE_USD|MAXIMUM_PAGE_USD|PROCESSING_UNIT_USD/);
  });
});

describe("the public sample", () => {
  const start = html.indexOf(SAMPLE_FRAME_LABEL);
  const frame = html.slice(html.lastIndexOf("<figure", start), html.indexOf("</figure>", start));

  it("keeps its synthetic-data label inside the bordered frame, before the evidence", () => {
    expect(start).toBeGreaterThan(-1);
    expect(SAMPLE_FRAME_LABEL).toContain("SYNTHETIC DATA");
    expect(frame.indexOf(SAMPLE_FRAME_LABEL)).toBeLessThan(frame.indexOf("<blockquote"));
    expect(frame).toContain(">Sample<");
  });

  it("renders the demo's own answer, citation and revision, and draws one region at the citation's coordinates", () => {
    const { citation } = signedProductDemo.answer;
    expect(plain(frame)).toContain(citation.excerpt);
    expect(frame).toContain(citation.evidenceId);
    expect(plain(frame)).toContain(`page ${citation.pageNumber1}`);
    expect(plain(frame)).toContain(signedProductDemo.answer.question);
    expect(plain(frame)).toContain(`revision ${signedProductDemo.activation.revision}`);
    expect(frame).not.toContain("<table");
    expect([...frame.matchAll(/<span class="[^"]*region[^"]*"/gi)]).toHaveLength(1);
    const bbox = citation.bbox1000!;
    expect(frame).toContain(`left:${bbox[0] / 10}%`);
    expect(frame).toContain(`top:${bbox[1] / 10}%`);
  });
});

describe("links", () => {
  it("types no path outside the retained-page table", () => {
    for (const f of stripped(code)) {
      const without = f.file.endsWith("enterprise-content.ts") ? f.text.replace(/export const RETAINED = \{[\s\S]*?\} as const;/, "") : f.text;
      expect(without, f.file).not.toMatch(/["'`]\/[a-z.]/);
    }
  });

  it("links only to live registry routes", () => {
    for (const key of ENTERPRISE_REGISTRY_LINKS) {
      expect(v34Route(key).release, `${key} is held`).toBe("live");
      expect(html).toContain(`href="${v34Route(key).path}"`);
    }
  });

  it("links only to retained pages and files that exist", () => {
    for (const path of Object.values(RETAINED)) {
      const candidates = [join(root, "app", path, "page.tsx"), join(root, "app", path, "route.ts"), join(root, "public", path)];
      expect(candidates.some(existsSync), `${path} is served by nothing in this tree`).toBe(true);
    }
  });

  it("sends the primary action to the contact page and the secondary to the compiled sample", () => {
    expect(html).toContain(`href="${v34Route("contact").path}"`);
    expect(html).toContain('href="/explore"');
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
    const linkClasses = [...new Set([...sheet.matchAll(/\.(\w*(?:[lL]ink|inline|source))\s*\{/g)].map((m) => m[1]!))];
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
