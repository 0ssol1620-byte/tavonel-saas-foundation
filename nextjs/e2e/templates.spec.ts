import { expect, test, type Page } from "@playwright/test";
import { measureOverflow } from "./support/overflow";

/*
  UX-L7 (lane P2-11): the page templates, read off the browser. UX-PLAN-2026-10-17 §5.1 (the
  templates), §5.4 (which route is which), §5.3 rules R7 and R8, §8.2 (UX-L7 acceptance).

  - §5.4. Every route of the inventory declares its template once, as `data-template` on its page
    root -- the element that holds <main>, or <main> itself on /explore -- and the value is the one
    the inventory assigns. T6 (the workspace and sign-in app shell) is not a public template and is
    not declared; /research/experiments is in the inventory but serves a 404, so it is not measured
    (the same list as type-scale.spec.ts and site-alignment.spec.ts).
  - §5.1. T0-T5 are PAPER: the ground behind the H1 is the light surface, never the instrument one.
  - R7. An internal link -- an <a> whose href resolves to this origin -- carries no ↗, in its text or
    in a generated ::before/::after. ↗ says "this leaves the site"; a link to the sample, to a page or
    to a file this origin serves does not.
  - R8. Every rendered <summary> in <main> shows a marker: the browser's disclosure triangle (a
    list-item with a list style) or a drawn one (a ::before/::after with a glyph, or an empty one
    painted by a border or a background). `display: flex` or `inline-flex` on a summary removes the
    native marker, which is how /api, /benchmarks, /docs and /knowledge-compiler lost theirs.
  - Seven widths, no horizontal overflow: the document does not scroll sideways and no in-flow
    element crosses the right edge (support/overflow.ts, the measurement overflow-audit.spec.ts uses).

  The seven widths of AGENTS.md's capture set are driven from the 1440 project, as site-alignment.spec.ts
  does: CI's Product QA job runs the 1440, 390 and 360 projects only, and these rules have to hold at all
  seven where they are enforced.
*/

const TEMPLATES = {
  T0: ["/", "/ko"],
  T1: [
    "/product", "/product/compiled-world", "/product/continuous-knowledge", "/product/document-understanding",
    "/product/knowledge-compiler", "/how-it-works", "/knowledge-compiler", "/solutions", "/solutions/ai-ready-knowledge",
    "/solutions/document-intelligence", "/solutions/knowledge-graph", "/solutions/source-grounded-assistants",
    "/solutions/knowledge-operations", "/integrations", "/demo",
  ],
  T2: ["/pricing", "/ko/pricing", "/evaluation", "/ko/evaluation", "/contact", "/ko/contact"],
  T3: [
    "/docs", "/docs/quickstart", "/developers", "/api", "/cookbooks", "/cookbooks/documents-to-grounded-work", "/sources",
    "/changelog", "/resources",
  ],
  T4: ["/explore"],
  T5: [
    "/trust", "/security", "/enterprise", "/status", "/evidence", "/benchmarks", "/benchmarks/gdp-pdf", "/research",
    "/research/notes", "/reproducibility", "/privacy", "/terms", "/refunds", "/subprocessors",
  ],
} as const;
type Template = keyof typeof TEMPLATES;

const WIDTHS = [1920, 1440, 1280, 1024, 768, 390, 360] as const;
const viewportOf = (width: number) => ({ width, height: width <= 390 ? 844 : 900 });
/* Paper is #faf9f6-#fbfaf7 (relative luminance ~0.95); the instrument ground #090d14 is ~0.004. */
const PAPER_FLOOR = 0.8;

type Reading = {
  roots: { tag: string; template: string | null; holdsMain: boolean }[];
  internalArrows: string[];
  bareSummaries: string[];
  ground: { colour: string; luminance: number; from: string } | null;
};

/** Runs in the page; self-contained because Playwright serialises it. */
function read(): Reading {
  const transparent = (colour: string) => colour === "transparent" || /rgba\(.*,\s*0\)$/.test(colour);
  const name = (el: Element) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
  };

  const roots = [...document.querySelectorAll("[data-template]")].map(el => ({
    tag: name(el),
    template: el.getAttribute("data-template"),
    holdsMain: el.matches("main") || el.querySelector(":scope > main") !== null,
  }));

  const internalArrows: string[] = [];
  for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    let url: URL;
    try { url = new URL(a.href, location.href); } catch { continue; }
    if (url.origin !== location.origin) continue;
    const painted = [a.textContent ?? "", getComputedStyle(a, "::before").content, getComputedStyle(a, "::after").content].join(" ");
    if (painted.includes("↗")) internalArrows.push(`${a.getAttribute("href")} "${(a.textContent ?? "").trim().slice(0, 60)}"`);
  }

  const drawn = (pseudo: CSSStyleDeclaration) => {
    if (pseudo.display === "none" || pseudo.content === "none" || pseudo.content === "normal") return false;
    if (pseudo.content !== '""') return true;
    const sides = ["Top", "Right", "Bottom", "Left"] as const;
    return sides.some(side => parseFloat(pseudo.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0
      && !transparent(pseudo.getPropertyValue(`border-${side.toLowerCase()}-color`)))
      || !transparent(pseudo.backgroundColor) || pseudo.backgroundImage !== "none";
  };
  const bareSummaries: string[] = [];
  for (const summary of document.querySelectorAll("main summary")) {
    if (summary.getClientRects().length === 0) continue; // not rendered at this width
    const style = getComputedStyle(summary);
    const native = style.display === "list-item" && (style.listStyleType !== "none" || style.listStyleImage !== "none");
    if (native || drawn(getComputedStyle(summary, "::before")) || drawn(getComputedStyle(summary, "::after"))) continue;
    bareSummaries.push(`"${(summary.textContent ?? "").trim().slice(0, 60)}" (display ${style.display}, list-style ${style.listStyleType})`);
  }

  let ground: Reading["ground"] = null;
  const h1 = document.querySelector("main h1");
  for (let el: Element | null = h1; el; el = el.parentElement) {
    const colour = getComputedStyle(el).backgroundColor;
    if (transparent(colour)) continue;
    const [r, g, b] = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(c => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    ground = { colour, luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b, from: name(el) };
    break;
  }

  return { roots, internalArrows, bareSummaries, ground };
}

async function visit(page: Page, route: string, width: number) {
  await page.setViewportSize(viewportOf(width));
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  // A route that does not render cannot be measured; skipping it silently would pass a broken page.
  expect(response?.status(), `${route} answers at ${width}`).toBeLessThan(400);
  await page.evaluate(() => document.fonts.ready);
  // Layout, not motion: one frame and a short settle are enough for the composition.
  await page.waitForTimeout(300);
}

test.describe("page templates (UX-L7)", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "drives all seven widths from the 1440 project");
  });

  for (const [template, routes] of Object.entries(TEMPLATES) as [Template, readonly string[]][]) {
    for (const route of routes) {
      test(`${route} is ${template}: one declared root, paper, no internal ↗, a marker on every summary, no overflow at seven widths`, async ({ page }) => {
        test.setTimeout(180_000);
        for (const width of WIDTHS) {
          await visit(page, route, width);
          const at = `${route} @${width}`;
          const m = await page.evaluate(read);
          expect.soft(m.roots, `${at}: data-template roots`).toEqual([expect.objectContaining({ template, holdsMain: true })]);
          expect.soft(m.ground, `${at}: no ground behind the H1`).not.toBeNull();
          if (m.ground) expect.soft(m.ground.luminance, `${at}: H1 ground ${m.ground.colour} on ${m.ground.from} is not paper`).toBeGreaterThanOrEqual(PAPER_FLOOR);
          expect.soft(m.internalArrows, `${at}: internal links carrying ↗`).toEqual([]);
          expect.soft(m.bareSummaries, `${at}: summaries without a visible marker`).toEqual([]);
          const overflow = await page.evaluate(measureOverflow);
          expect.soft(overflow.documentOverflow, `${at}: document scrolls sideways`).toBeLessThanOrEqual(1);
          expect.soft(overflow.offenders, `${at}: elements past the right edge`).toEqual([]);
        }
      });
    }
  }

  /*
    The failure path. Each rule above is checked against a page that breaks it, so a measurement that
    always returns "clean" cannot pass this spec. The page's CSP forbids injected <style>, so the
    breakage is written through the CSSOM and the DOM.
  */
  test("the detector reports a missing or doubled template, an instrument ground, an internal ↗, a bare summary and an overflow", async ({ page }) => {
    await visit(page, "/evaluation", 1440);
    const clean = await page.evaluate(read);
    expect(clean.roots).toEqual([expect.objectContaining({ template: "T2", holdsMain: true })]);
    expect(clean.internalArrows).toEqual([]);

    const broken = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      const root = document.querySelector("[data-template]")!;
      // An internal link with ↗ in its text, another with ↗ painted by CSS, and an external one that may keep it.
      const internal = Object.assign(document.createElement("a"), { href: "/explore?detector=1", textContent: "Open the sample ↗" });
      const external = Object.assign(document.createElement("a"), { href: "https://www.sec.gov/", textContent: "Open the filing at the SEC ↗" });
      main.append(internal, external);
      // A summary laid out as flex loses the native marker; a list-item one keeps it.
      const bare = document.createElement("details");
      bare.innerHTML = "<summary>Read the bare disclosure</summary><p>x</p>";
      (bare.firstElementChild as HTMLElement).style.display = "flex";
      const kept = document.createElement("details");
      kept.innerHTML = "<summary>Read the kept disclosure</summary><p>x</p>";
      main.append(bare, kept);
      // Instrument ground on the page root, and a block wider than the viewport.
      (root as HTMLElement).style.setProperty("background", "#090d14", "important");
      for (let el = document.querySelector("main h1")?.parentElement; el && el !== root; el = el.parentElement) {
        el.style.setProperty("background", "transparent", "important");
      }
      const wide = document.createElement("div");
      wide.style.width = "3000px";
      wide.style.height = "10px";
      main.append(wide);
      return true;
    });
    expect(broken).toBe(true);
    const m = await page.evaluate(read);
    expect(m.internalArrows).toEqual(['/explore?detector=1 "Open the sample ↗"']);
    expect(m.bareSummaries).toEqual(['"Read the bare disclosure" (display flex, list-style disclosure-closed)']);
    expect(m.ground?.luminance ?? 1).toBeLessThan(PAPER_FLOOR);
    const overflow = await page.evaluate(measureOverflow);
    expect(overflow.offenders.length).toBeGreaterThan(0);

    // ↗ painted by a pseudo-element is caught too: a link styled with the arrow as generated content.
    await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>('main a[href="/explore?detector=1"]')!;
      link.textContent = "Open the sample";
      // CSSOM rule, not an injected <style>: the CSP allows the first and blocks the second.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('main a[href="/explore?detector=1"]::after { content: " \\2197"; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    expect((await page.evaluate(read)).internalArrows).toEqual(['/explore?detector=1 "Open the sample"']);

    // A missing declaration and a doubled one are both reported against the inventory.
    const declared = await page.evaluate(() => {
      const root = document.querySelector("[data-template]")!;
      root.removeAttribute("data-template");
      return document.querySelectorAll("[data-template]").length;
    });
    expect(declared).toBe(0);
    expect((await page.evaluate(read)).roots).toEqual([]);
    const doubled = await page.evaluate(() => {
      document.querySelector(".page")!.setAttribute("data-template", "T2");
      document.querySelector("main")!.setAttribute("data-template", "T1");
      return document.querySelectorAll("[data-template]").length;
    });
    expect(doubled).toBe(2);
    expect((await page.evaluate(read)).roots).toHaveLength(2);
  });
});
