import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/*
  UX-L1 (lane P2-03), the painted half: UX-PLAN-2026-10-17 §8.2's acceptance, read off the browser.

  On every T0-T5 route of the plan's §5.4 inventory at 1440, each visible filled primary action
  paints the one accent, and no element resolves a value §4.2-5 retires. lib/brand-tokens.test.ts
  reads the stylesheets; this reads what the cascade actually produced, which is the only place a
  fallback, an inherited token or an unlayered rule beating a layered one shows up.

  V34 (WO-CI-5a): every route of the inventory now renders in the V34 shell (a route the program
  moved answers 308 to its V34 page, which is the page measured), and the accent is the V34 action
  token, read from components/v34/tokens.module.css rather than typed here: `--v34-header-btn` on a
  light ground, and its dark-scene counterpart `--v34-lime` on a dark one (components/v34/ui/
  button-link.module.css, `.primary` and `.onDark`). The legacy accent rgb(0, 91, 179) (--tv-action,
  decision.md G-H 255°) is not a V34 action colour, so a filled action that still paints it fails.
  A filled action is a legacy `.btn` (still used by retained page bodies) or a V34 pill: a link or
  button with an opaque ground and the `--v34-radius-pill` radius.

  Two retirement sets. The four blues are retired everywhere. The rest -- the paper green, the dark
  mint, Home's region amber and the violets -- are retired on the public PAPER surfaces: the dark
  instrument faces some public pages still embed (the footer, the film stage, a docs code block,
  the two category guides that have not moved to paper yet, UX-L7) legitimately keep the dark
  state values, so an element counts as paper when the first opaque ground behind it is light.

  /research/experiments is in the inventory but serves a 404 today, so it is not measured; every
  measured route must answer below 400.
*/

const ROUTES = [
  "/",
  "/product", "/product/compiled-world", "/product/continuous-knowledge", "/product/document-understanding",
  "/product/knowledge-compiler", "/how-it-works", "/knowledge-compiler", "/solutions", "/solutions/ai-ready-knowledge",
  "/solutions/document-intelligence", "/solutions/knowledge-graph", "/solutions/source-grounded-assistants",
  "/solutions/knowledge-operations", "/integrations", "/demo",
  "/pricing", "/evaluation", "/contact",
  "/docs", "/docs/quickstart", "/developers", "/api", "/cookbooks", "/cookbooks/documents-to-grounded-work", "/sources",
  "/changelog", "/resources",
  "/explore",
  "/trust", "/security", "/enterprise", "/status", "/evidence", "/benchmarks", "/benchmarks/gdp-pdf", "/research",
  "/research/notes", "/reproducibility", "/privacy", "/terms", "/refunds", "/subprocessors",
] as const;

const RETIRED_EVERYWHERE = ["2447b3", "244ac8", "2347b8", "2259ce"];
const RETIRED_ON_PAPER = ["226849", "7be0be", "795400", "f2b73a", "fff1c7", "a996ff", "5f42e0", "5f42a1"];

/** A `--v34-*` colour token as `components/v34/tokens.module.css` declares it on `.site`, as rgb(). */
function v34Token(name: string) {
  const sheet = readFileSync(new URL("../components/v34/tokens.module.css", import.meta.url), "utf8");
  const hex = sheet.match(new RegExp(`${name}:\\s*#([0-9a-f]{6});`, "i"))?.[1];
  if (!hex) throw new Error(`${name} is not a six-digit colour in tokens.module.css`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
const ACTION = { light: v34Token("--v34-header-btn"), dark: v34Token("--v34-lime") };

type Audit = { retired: string[]; actions: Array<{ what: string; background: string; darkGround: boolean }> };

/** Runs in the page; self-contained because Playwright serialises it. */
function audit({ everywhere, onPaper }: { everywhere: string[]; onPaper: string[] }): Audit {
  const rgbOf = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const everywhereRgb = everywhere.map((hex) => ({ hex, rgb: rgbOf(hex) }));
  const paperRgb = onPaper.map((hex) => ({ hex, rgb: rgbOf(hex) }));
  const colours = (value: string) => {
    const out: Array<{ rgb: number[]; alpha: number }> = [];
    for (const m of value.matchAll(/rgba?\(([^)]+)\)/g)) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      out.push({ rgb: parts.slice(0, 3).map(Math.round), alpha: parts.length > 3 ? parts[3] : 1 });
    }
    for (const m of value.matchAll(/color\(srgb ([^)]+)\)/g)) {
      const parts = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
      out.push({ rgb: parts.slice(0, 3).map((v) => Math.round(v * 255)), alpha: parts.length > 3 ? parts[3] : 1 });
    }
    return out;
  };
  const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  const luminance = ([r, g, b]: number[]) => {
    const c = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  };
  /** The first opaque ground at or behind `from`; the document is dark (#090d14) when nothing paints one. */
  const ground = (from: Element | null) => {
    for (let el = from; el; el = el.parentElement) {
      const bg = colours(getComputedStyle(el).backgroundColor)[0];
      if (bg && bg.alpha === 1) return bg.rgb;
    }
    return [9, 13, 20];
  };
  const name = (el: Element) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}`;
  };
  const props = ["color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "outline-color", "text-decoration-color", "fill", "stroke", "box-shadow", "background-image"];
  const retired = new Set<string>();
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el);
    for (const prop of props) {
      const value = style.getPropertyValue(prop);
      if (!/rgb|color\(/.test(value)) continue;
      for (const { rgb } of colours(value)) {
        for (const { hex, rgb: bad } of everywhereRgb) if (same(rgb, bad)) retired.add(`${name(el)} ${prop} #${hex}`);
        for (const { hex, rgb: bad } of paperRgb) {
          if (!same(rgb, bad)) continue;
          // An element's own background is judged against the ground behind it, everything else against its own.
          const behind = ground(prop === "background-color" ? el.parentElement : el);
          if (luminance(behind) > 0.5) retired.add(`${name(el)} ${prop} #${hex} on paper`);
        }
      }
    }
  }
  const actions: Audit["actions"] = [];
  const legacyFilled = ":is(.btn, .btn-primary, .lv2-cta):not(.ghost, .btn-ghost, .btn-secondary, .btn-danger, :disabled, [aria-disabled=\"true\"])";
  // The V34 pill radius, resolved where the shell declares it (`.site`); absent on a page without the shell.
  const site = document.querySelector("[data-v34-site]");
  let pill: string | null = null;
  if (site) {
    const probe = document.createElement("span");
    probe.style.setProperty("border-top-left-radius", "var(--v34-radius-pill)");
    site.append(probe);
    pill = getComputedStyle(probe).borderTopLeftRadius;
    probe.remove();
  }
  const isFilled = (el: Element) => {
    if (el.matches(legacyFilled)) return true;
    if (!pill || !el.matches("a, button") || el.matches(":disabled, [aria-disabled=\"true\"]")) return false;
    const style = getComputedStyle(el);
    const bg = colours(style.backgroundColor)[0];
    return Boolean(bg && bg.alpha === 1) && style.borderTopLeftRadius === pill;
  };
  for (const el of document.querySelectorAll("body *")) {
    if (!isFilled(el)) continue;
    if (el.closest("[data-marketing-consent-panel]")) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
    actions.push({
      what: `${name(el)} "${(el.textContent ?? "").trim().slice(0, 40)}"`,
      background: style.backgroundColor,
      darkGround: luminance(ground(el.parentElement)) <= 0.5,
    });
  }
  return { retired: [...retired].sort(), actions };
}

async function measure(page: Page) {
  // No pointer over the page: a hovered control is the hover token, which is not what is measured.
  await page.mouse.move(0, 0);
  return page.evaluate(audit, { everywhere: RETIRED_EVERYWHERE, onPaper: RETIRED_ON_PAPER });
}

test.describe("brand tokens as painted (UX-L1)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "the plan's acceptance is measured at 1440");
  });

  for (const route of ROUTES) {
    test(`${route} paints the one accent and no retired value`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "load" });
      expect(response?.status(), `${route} answers`).toBeLessThan(400);
      const { retired, actions } = await measure(page);
      expect(retired, "elements resolving a retired value").toEqual([]);
      // /explore had no filled action of its own under the legacy header; the V34 header's action is measured there too.
      if (route !== "/explore") expect(actions.length, "a visible filled action to measure").toBeGreaterThan(0);
      for (const action of actions) expect.soft(action.background, action.what).toBe(action.darkGround ? ACTION.dark : ACTION.light);
    });
  }

  test("the audit is not vacuous: it reports a retired paint and a filled action off the accent", async ({ page }) => {
    await page.goto("/pricing", { waitUntil: "load" });
    /*
      "load" can fire before React hydrates /pricing. Probes injected before hydration are extra
      HTML to React (minified error #418), and its client re-render drops them, so the audit then
      sees nothing. Inject only while the probes are absent and measure until they survive: the
      assertions below are unchanged, only the hydration race is waited out.
    */
    let audited: Awaited<ReturnType<typeof measure>> = { retired: [], actions: [] };
    await expect(async () => {
      await page.evaluate(() => {
        if (document.getElementById("probe-blue")) return;
        const main = document.querySelector("main") as HTMLElement;
        const probe = document.createElement("div");
        probe.style.background = "#faf9f6";
        probe.innerHTML = `<p id="probe-blue" style="color:#2447b3">a</p>`
          + `<p id="probe-mint" style="color:#7be0be">b</p>`
          + `<a class="btn" id="probe-ink" href="#" style="background:#15191d">c</a>`
          // A V34 pill (no legacy class) painted in the retired legacy accent.
          + `<a id="probe-pill" href="#" style="background:#005bb3;border-radius:var(--v34-radius-pill)">e</a>`;
        main.prepend(probe);
        const dark = document.createElement("div");
        dark.style.background = "#0e1013";
        dark.innerHTML = `<p id="probe-dark-mint" style="color:#7be0be">d</p>`;
        main.prepend(dark);
      });
      audited = await measure(page);
      expect(audited.retired).toContain("p#probe-blue color #2447b3");
    }).toPass({ timeout: 10_000 });
    const { retired, actions } = audited;
    expect(retired).toContain("p#probe-blue color #2447b3");
    expect(retired).toContain("p#probe-mint color #7be0be on paper");
    // The same mint on an instrument face is the dark-ground "verified", not a retirement.
    expect(retired.filter((hit) => hit.startsWith("p#probe-dark-mint "))).toEqual([]);
    expect(actions.find((action) => action.what.startsWith("a#probe-ink"))?.background).toBe("rgb(21, 25, 29)");
    const pill = actions.find((action) => action.what.startsWith("a#probe-pill"));
    expect(pill?.background, "a V34 pill is measured as a filled action").toBe("rgb(0, 91, 179)");
    expect(pill?.background).not.toBe(pill?.darkGround ? ACTION.dark : ACTION.light);
  });
});
