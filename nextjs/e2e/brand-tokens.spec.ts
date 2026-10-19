import { expect, test, type Page } from "@playwright/test";

/*
  UX-L1 (lane P2-03), the painted half: UX-PLAN-2026-10-17 §8.2's acceptance, read off the browser.

  On every T0-T5 route of the plan's §5.4 inventory at 1440, each visible filled primary action
  paints the one accent, rgb(0, 91, 179) (--tv-action, decision.md G-H 255°), and no element
  resolves a value §4.2-5 retires. lib/brand-tokens.test.ts reads the stylesheets; this reads what
  the cascade actually produced, which is the only place a fallback, an inherited token or an
  unlayered rule beating a layered one shows up.

  Two retirement sets. The four blues are retired everywhere. The rest -- the paper green, the dark
  mint, Home's region amber and the violets -- are retired on the public PAPER surfaces: the dark
  instrument faces some public pages still embed (the footer, the film stage, a docs code block,
  the two category guides that have not moved to paper yet, UX-L7) legitimately keep the dark
  state values, so an element counts as paper when the first opaque ground behind it is light.

  /research/experiments is in the inventory but serves a 404 today, so it is not measured; every
  measured route must answer below 400.
*/

const ROUTES = [
  "/", "/ko",
  "/product", "/product/compiled-world", "/product/continuous-knowledge", "/product/document-understanding",
  "/product/knowledge-compiler", "/how-it-works", "/knowledge-compiler", "/solutions", "/solutions/ai-ready-knowledge",
  "/solutions/document-intelligence", "/solutions/knowledge-graph", "/solutions/source-grounded-assistants",
  "/solutions/knowledge-operations", "/integrations", "/demo",
  "/pricing", "/ko/pricing", "/evaluation", "/ko/evaluation", "/contact", "/ko/contact",
  "/docs", "/docs/quickstart", "/developers", "/api", "/cookbooks", "/cookbooks/documents-to-grounded-work", "/sources",
  "/changelog", "/resources",
  "/explore",
  "/trust", "/security", "/enterprise", "/status", "/evidence", "/benchmarks", "/benchmarks/gdp-pdf", "/research",
  "/research/notes", "/reproducibility", "/privacy", "/terms", "/refunds", "/subprocessors",
] as const;

const RETIRED_EVERYWHERE = ["2447b3", "244ac8", "2347b8", "2259ce"];
const RETIRED_ON_PAPER = ["226849", "7be0be", "795400", "f2b73a", "fff1c7", "a996ff", "5f42e0", "5f42a1"];
const ACTION = "rgb(0, 91, 179)";

type Audit = { retired: string[]; actions: Array<{ what: string; background: string }> };

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
  const filled = ":is(.btn, .btn-primary, .lv2-cta):not(.ghost, .btn-ghost, .btn-secondary, .btn-danger, :disabled, [aria-disabled=\"true\"])";
  for (const el of document.querySelectorAll(filled)) {
    if (el.closest("[data-marketing-consent-panel]")) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
    actions.push({ what: `${name(el)} "${(el.textContent ?? "").trim().slice(0, 40)}"`, background: style.backgroundColor });
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
      // /explore draws no header action (it would point at itself) and has no filled action of its own.
      if (route !== "/explore") expect(actions.length, "a visible filled action to measure").toBeGreaterThan(0);
      for (const action of actions) expect(action.background, action.what).toBe(ACTION);
    });
  }

  test("the audit is not vacuous: it reports a retired paint and a filled action off the accent", async ({ page }) => {
    await page.goto("/pricing", { waitUntil: "load" });
    await page.evaluate(() => {
      const main = document.querySelector("main") as HTMLElement;
      const probe = document.createElement("div");
      probe.style.background = "#faf9f6";
      probe.innerHTML = `<p id="probe-blue" style="color:#2447b3">a</p>`
        + `<p id="probe-mint" style="color:#7be0be">b</p>`
        + `<a class="btn" id="probe-ink" href="#" style="background:#15191d">c</a>`;
      main.prepend(probe);
      const dark = document.createElement("div");
      dark.style.background = "#0e1013";
      dark.innerHTML = `<p id="probe-dark-mint" style="color:#7be0be">d</p>`;
      main.prepend(dark);
    });
    const { retired, actions } = await measure(page);
    expect(retired).toContain("p#probe-blue color #2447b3");
    expect(retired).toContain("p#probe-mint color #7be0be on paper");
    // The same mint on an instrument face is the dark-ground "verified", not a retirement.
    expect(retired.filter((hit) => hit.startsWith("p#probe-dark-mint "))).toEqual([]);
    expect(actions.find((action) => action.what.startsWith("a#probe-ink"))?.background).toBe("rgb(21, 25, 29)");
  });
});
