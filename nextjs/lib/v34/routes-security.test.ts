import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { typedCounts } from "./route-test-support";
import { TRUST_SEQUENCE } from "@/components/trust-next";
import { TRUST_PROVISIONS } from "@/content/trust/provisions";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { signedProductDemo } from "@/lib/signed-product-demo";
import { JUMP, RETAINED, SECURITY_REGISTRY_LINKS } from "@/components/v34/routes/security/security-content";
import { SecurityBody } from "@/components/v34/routes/security/security";
import { routeMetadata } from "./route-metadata";
import { V34_ROUTE_KEYS, v34Route } from "./routes";

/*
  Source-level guards for /security (components/v34/routes/security/** and app/security/page.tsx)
  plus one server render, in the shape of lib/v34/home-page.test.ts: the page gates on its
  registry key, takes its title from the registry, types no figure, price or plan, claims no
  certification, links only to live routes or to retained pages that exist, keeps every required
  trust answer, and gives every link a target of at least 24px with a hover and a focus state.
*/

const KEY = "security" as const;
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
const html = renderToStaticMarkup(createElement(SecurityBody));
const plain = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("security route files", () => {
  it("has its component, content, art, provisions table and sheets", () => {
    expect(sources.map((f) => f.file.split("/").pop()).sort()).toEqual([
      "provisions.module.css", "provisions.tsx", "security-art.tsx", "security-content.ts", "security.module.css", "security.tsx",
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
    expect(page.indexOf("releaseGate")).toBeLessThan(page.indexOf("<Security"));
    expect(page).toContain(`routeMetadata("${KEY}")`);
    expect(page).toContain("routeViewport()");
  });

  it("renders its structured data inside the frame", () => {
    const body = stripped(code).find((f) => f.file.endsWith("/security.tsx"))!;
    expect(body.text).toContain(`<V34Page route="${KEY}">`);
    expect(body.text).toContain(`<RouteJsonLd route="${KEY}" />`);
  });
});

describe("one h1, from the registry", () => {
  it("writes no h1 of its own and mounts one Hero", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    const body = stripped(code).find((f) => f.file.endsWith("/security.tsx"))!;
    expect(body.text.match(/<Hero\b/g)).toHaveLength(1);
  });

  it("renders exactly one h1 and it is the registry title", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(plain(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)![0]).trim()).toBe("Security practices and verifiable exports");
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

  it("prints the sample package's figures from the compiled demo", () => {
    const { signedExport } = signedProductDemo;
    expect(plain(html)).toContain(String(signedExport.fileCount));
    expect(plain(html)).toContain(signedExport.signature.algorithm);
    expect(html).not.toMatch(/undefined|NaN/);
  });
});

describe("the required trust answers are on the page", () => {
  const answers: Array<[string, string]> = [
    ["where data goes", "workspace-scoped intake boundary"],
    ["who can access it", "workspace membership are resolved server-side"],
    ["tenant isolation", "Data access is scoped to the authenticated workspace"],
    ["retention / deletion", "follow the applicable workspace policy and legal-hold state"],
    ["encryption in transit", "Traffic is encrypted in transit"],
    ["encryption at rest", "stored objects are encrypted at rest"],
    ["credential handling", "service credentials remain on trusted server boundaries"],
    ["audit", "sensitive administration events are recorded"],
    ["source access", "suspended, deleted or cannot be verified is refused"],
    ["training on customer data", "not used to train shared models"],
    ["human activation", "cannot silently replace the active World"],
    ["failure semantics", "protected action is refused rather than treated as successful"],
    ["controlled review", "architecture, control evidence and questionnaire responses"],
  ];

  it.each(answers)("answers %s", (_question, phrase) => {
    expect(plain(html)).toContain(phrase);
  });

  it("renders every provision row, grouped by state, from the one content module", () => {
    const text = plain(html);
    for (const row of TRUST_PROVISIONS) {
      expect(text, row.id).toContain(row.subject);
      expect(text, row.id).toContain(row.line);
    }
    for (const row of TRUST_PROVISIONS) expect(strip(code.map((f) => f.text).join("\n"))).not.toContain(row.line);
  });

  it("keeps the internal inventory out of the page's own words", () => {
    const own = stripped(code).filter((f) => !f.file.endsWith("provisions.tsx")).map((f) => f.text).join("\n");
    for (const internal of ["RunPod", "Cloud Run", "ClamAV", "generator seam", "injection classes", "authorization_revision", "RPO"]) {
      expect(own, internal).not.toContain(internal);
    }
  });
});

describe("links", () => {
  it("types no path outside the retained-page table", () => {
    for (const f of stripped(code)) {
      const without = f.file.endsWith("security-content.ts") ? f.text.replace(/export const RETAINED = \{[\s\S]*?\} as const;/, "") : f.text;
      expect(without, f.file).not.toMatch(/["'`]\/[a-z.]/);
    }
  });

  it("links only to live registry routes", () => {
    for (const key of SECURITY_REGISTRY_LINKS) {
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

  it("scrolls every page-jump link to a section that exists", () => {
    for (const item of JUMP) {
      expect(html).toContain(`href="#${item.id}"`);
      expect(html).toContain(`id="${item.id}"`);
    }
  });

  it("ends on its own step of the trust sequence, with the next page live", () => {
    const index = TRUST_SEQUENCE.findIndex((step) => step.href === v34Route(KEY).path);
    expect(index).toBeGreaterThanOrEqual(0);
    const next = TRUST_SEQUENCE[index + 1]!;
    expect(plain(html)).toContain(`Next: ${next.label}`);
    expect(v34Route("evidence").release).toBe("live");
    expect(next.href).toBe(v34Route("evidence").path);
    expect(html).toContain(`href="${next.href}"`);
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

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("security")).toEqual([]);
  });
});

describe("trust sequence", () => {
  /*
    The V34 /security Bridge types its link and label, so pin them to the step the sequence
    names after /security: the same page and the same action TrustNext would print.
  */
  it("sends /security to the next step's page with the sequence's own action", () => {
    const trustNext = readFileSync(join(root, "components/trust-next.tsx"), "utf8");
    const order = [...trustNext.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]!);
    const next = order[order.indexOf("/security") + 1]!;
    const action = trustNext.match(/"\/security": "([^"]+)"/)![1]!;
    expect(html).toMatch(new RegExp(`<a\\b[^>]*href="${next}"[^>]*>[\\s\\S]*?${action}`));
  });
});
