import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { typedCounts, typedCountsInFile } from "./route-test-support";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { SUPPORT_ACKNOWLEDGEMENT } from "@/lib/support-targets";
import { ADDRESSES, CONTACT_REGISTRY_LINKS, RETAINED } from "@/components/v34/routes/contact/contact-content";
import { ContactBody } from "@/components/v34/routes/contact/contact";
import { inSentenceViolations } from "./in-sentence-guard";
import { routeMetadata } from "./route-metadata";
import { V34_ROUTE_KEYS, v34Route } from "./routes";

/*
  Source-level guards for /contact (components/v34/routes/contact/** and app/contact/page.tsx) plus
  one server render: the page gates on its registry key, takes its title from the registry, keeps the
  working form and the three addresses, types no figure, price or plan, and the form's field sheet is
  given tokens whose borders reach 3:1 on the surface the form sits on.
*/

const KEY = "contact" as const;
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
const html = renderToStaticMarkup(createElement(ContactBody));
const plain = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("contact route files", () => {
  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });

  it("no longer carries the legacy page sheet", () => {
    expect(existsSync(join(root, "app/contact/contact-faq.module.css"))).toBe(false);
    expect(page).not.toContain("PublicSitePage");
  });
});

describe("the page file", () => {
  it("gates on its registry key before anything renders, and takes its metadata from the registry", () => {
    expect(V34_ROUTE_KEYS).toContain(KEY);
    expect(page).toContain(`releaseGate("${KEY}")`);
    expect(page.indexOf("releaseGate")).toBeLessThan(page.indexOf("<Contact"));
    expect(page).toContain(`routeMetadata("${KEY}")`);
    expect(page).toContain("routeViewport()");
  });

  it("renders its structured data inside the frame", () => {
    const body = stripped(code).find((f) => f.file.endsWith("/contact.tsx"))!;
    expect(body.text).toContain(`<V34Page route="${KEY}">`);
    expect(body.text).toContain(`<RouteJsonLd route="${KEY}" />`);
  });
});

describe("one h1, from the registry", () => {
  it("writes no h1 of its own, mounts one Hero and renders the registry title", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    expect(stripped(code).find((f) => f.file.endsWith("/contact.tsx"))!.text.match(/<Hero\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(plain(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)![0]).trim()).toBe("Talk to TAVONEL about your own document set");
    expect(routeMetadata(KEY).title).toBe(v34Route(KEY).title);
    expect(plain(html)).toContain(v34Route(KEY).description);
  });
});

describe("the working form and the addresses", () => {
  it("mounts the existing form unchanged, with its fields and its honeypot", () => {
    expect(stripped(code).find((f) => f.file.endsWith("/contact.tsx"))!.text).toContain("<ContactForm />");
    expect(html).toContain('class="contact-form"');
    for (const name of ["name", "email", "company", "topic", "message", "website"]) expect(html, name).toContain(`name="${name}"`);
    expect(html).toContain("Send inquiry");
  });

  it("prints the three addresses as mail links and the one acknowledgement target", () => {
    for (const address of ADDRESSES) expect(html).toContain(`href="mailto:${address.email}"`);
    expect(plain(html)).toContain(SUPPORT_ACKNOWLEDGEMENT);
  });

  it("keeps the six first questions and ends none of them at a held route", () => {
    expect(html.match(/<details\b/g)!.length).toBeGreaterThanOrEqual(6);
    expect(plain(html)).toContain("Are my documents used to train models?");
    expect(plain(html)).not.toContain("No inquiry is sent");
  });
});

describe("the field sheet", () => {
  const sheet = stripped(styles).map((f) => f.text).join("\n");

  it("sets the field border to the control border and the field ground to white, at 3:1 or more", () => {
    expect(sheet).toMatch(/--hairline-hi:\s*var\(--v34-control-border\)/);
    expect(sheet).toMatch(/--g1:\s*var\(--v34-white\)/);
    const tokens = readFileSync(join(root, "components/v34/tokens.module.css"), "utf8");
    const hex = (name: string) => tokens.match(new RegExp(`--v34-${name}:\\s*(#[0-9a-fA-F]{6})`))![1]!;
    expect(contrast(hex("control-border"), hex("white"))).toBeGreaterThanOrEqual(3);
    expect(contrast(hex("control-border"), hex("green"))).toBeGreaterThanOrEqual(3);
  });
});

describe("no typed figure, price or plan", () => {
  const text = stripped(code).filter((f) => !f.file.endsWith("-art.tsx")).map((f) => f.text).join("\n");

  it("types no price and names no plan", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    for (const offer of Object.values(BILLING_OFFERS)) expect(text, `plan "${offer.label}"`).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
  });

  it("writes no figure and no work-order id", () => {
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(text).not.toMatch(/\b\d+\.\d+\b/);
    expect(text).not.toMatch(/\b\d{3,}\b/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b(?:D\d{2}|U\d{2}|WO-[A-Z]+-[A-Z]?\d+|EG-\d+)\b/);
    expect(html).not.toMatch(/undefined|NaN/);
  });
});

describe("links", () => {
  it("types no path outside the retained-page table", () => {
    for (const f of stripped(code)) {
      const without = f.file.endsWith("contact-content.ts") ? f.text.replace(/export const RETAINED = \{[\s\S]*?\} as const;/, "") : f.text;
      expect(without, f.file).not.toMatch(/["'`]\/[a-z.]/);
    }
  });

  it("links to live registry routes only", () => {
    for (const key of CONTACT_REGISTRY_LINKS) {
      expect(v34Route(key).release, `${key} is held`).toBe("live");
      expect(html).toContain(`href="${v34Route(key).path}"`);
    }
  });

  it("links to retained pages that exist", () => {
    for (const path of Object.values(RETAINED)) {
      expect(existsSync(join(root, "app", path, "page.tsx")), `${path} is served by nothing in this tree`).toBe(true);
      expect(html).toContain(`href="${path}"`);
    }
  });

  it("scrolls the hero action to the form", () => {
    expect(html).toContain('href="#inquiry"');
    expect(html).toContain('id="inquiry"');
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

  /*
    Lead decision 23 (WO-CI-29; replaces decision 22). A link alone in a row keeps a floor-sized target. A
    link inside a sentence is a plain inline box whose target is its text (WCAG 2.5.8 excepts it) at every
    width: a 44px box inside a 19 to 30px line reaches into the lines above and below whatever the width,
    where it shares tap area with a link on the next line or covers that line's words. So, inside any media
    or other at-rule block as well as outside, nothing may grow its box, its line or move it:
    - outside any condition: no display but inline, no min-height or height, no own line-height or
      vertical-align, no block padding, no top, bottom or block border, no position, offset, float,
      transform, translate, scale, rotate or zoom;
    - inside any condition (a media query at any width or pointer, a nested block, forced colours): only
      paint -- colour, outline, background and text decoration.
    IN_SENTENCE names the classes rendered mid-sentence, with the lines that render them; every other link
    class stands alone, so no class is in neither group, and a name or a line here that the sources no longer
    bear fails.
  */
  const IN_SENTENCE: Record<string, { file: string; lines: number[] }> = {
    inline: { file: "components/v34/routes/contact/contact.tsx", lines: [35, 39, 43, 47, 51, 55] },
  };

  it("gives every link class alone in a row a 24px target, every link class inside a sentence a plain inline box at every width, and each a hover and a focus state", () => {
    const sheet = stripped(styles).map((f) => f.text).join("\n");
    const linkClasses = [...new Set([...sheet.matchAll(/\.(mail|inline)\s*\{/g)].map((m) => m[1]!))];
    expect(linkClasses.length).toBe(2);
    for (const [name, { file, lines }] of Object.entries(IN_SENTENCE)) {
      expect(linkClasses, `.${name} is listed as inside a sentence but no rule defines it`).toContain(name);
      const source = readFileSync(join(root, file), "utf8").split(/\r?\n/);
      for (const line of lines) expect(source[line - 1], `${file}:${line} renders .${name}`).toContain(`className={s.${name}}`);
      // The shared reader (lib/v34/in-sentence-guard.ts) walks nested blocks, pseudo-elements and states too.
      expect(inSentenceViolations(sheet, name), `.${name} is a plain inline box at every width`).toEqual([]);
    }
    for (const name of linkClasses) {
      expect(sheet, `.${name}:hover`).toMatch(new RegExp(`\\.${name}:hover`));
      expect(sheet, `.${name}:focus-visible`).toMatch(new RegExp(`\\.${name}:focus-visible`));
      if (name in IN_SENTENCE) continue;
      const rule = sheet.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))![1]!;
      const min = rule.match(/min-height:\s*([\d.]+)(px|rem)/);
      expect(min, `.${name} has no min-height`).not.toBeNull();
      expect(Number(min![1]) * (min![2] === "rem" ? 16 : 1), `.${name} target`).toBeGreaterThanOrEqual(24);
    }
  });
});

describe("copy that is true of the product today", () => {
  const OPERATOR = {
    TAVONEL_LEGAL_BUSINESS_NAME: "Example Co",
    TAVONEL_LEGAL_REPRESENTATIVE: "A Person",
    TAVONEL_LEGAL_BUSINESS_NUMBER: "123-45-67890",
    TAVONEL_LEGAL_ADDRESS: "1 Example Street",
    TAVONEL_LEGAL_PHONE: "+82 2 1234 5678",
    TAVONEL_LEGAL_EMAIL: "ops@example.com",
  };
  const renderWith = (env: Record<string, string>) => {
    const saved = Object.keys(OPERATOR).map((k) => [k, process.env[k]] as const);
    for (const k of Object.keys(OPERATOR)) delete process.env[k];
    Object.assign(process.env, env);
    try {
      return renderToStaticMarkup(createElement(ContactBody));
    } finally {
      for (const [k, v] of saved) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };

  it("offers a call only when a telephone is published", () => {
    const without = renderWith({});
    expect(without).not.toContain("tel:");
    expect(plain(without)).toContain("Write to us");
    expect(plain(without)).not.toContain("Write or call");
    const withOp = renderWith(OPERATOR);
    expect(withOp).toContain("tel:");
    expect(plain(withOp)).toContain("Write or call");
  });

  it("does not say the form asks about the four preparation items", () => {
    expect(plain(html)).not.toMatch(/optional questions in the form ask about each/i);
  });

  it("sets the step labels small enough to stay inside their boxes", () => {
    const sheet = stripped(styles).map((f) => f.text).join("\n");
    expect(sheet).toMatch(/\.lab\s*\{[^}]*font-size:\s*14px/);
  });
});

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("contact")).toEqual([]);
  });

  it("types none in the shared form, or in the other page that renders it", () => {
    expect(typedCountsInFile("components/contact-form.tsx")).toEqual([]);
    expect(typedCountsInFile("components/evaluation-page.tsx")).toEqual([]);
  });
});
