import { expect, test } from "@playwright/test";

/*
  UX-L2 (lane P2-04): one container, read off the browser. UX-PLAN-2026-10-17 §4.5, §5.2 and rule
  R1 of §5.3.

  R1: the container token is one. On every T0-T5 route of the plan's §5.4 inventory, at all seven
  widths, the header wordmark, the H1 and the first section's content share one left edge (±1px),
  and that edge is the one the tokens define -- `--tv-page-w`, min(1320px, 100% - 2 ×
  clamp(24px, 5vw, 72px)), centred (DESIGN_MASTER_V3 §6.4). Before this lane Home ran a 1200px
  container and the rest of the site 1280px, so the wordmark moved 40px when a reader left Home.

  §5.2: from 900px the header shows its one filled action (except on /explore, which it would point
  at); below 900 the row is the wordmark and Menu. The header is 64px tall from 900 and 56px below
  (`--tv-header-h`), and /explore and /login take the same geometry.

  "First section" is the first block below the hero -- the <section> or <header> holding the H1 --
  found by climbing out of the hero's wrappers to the next sibling that starts under it; a column
  beside the hero is part of the hero. Where the whole page is one section, it is that section: the
  title column and the reading column of an editorial page are one grid. Its content edge is the leftmost in-flow text or replaced element in it, or the card
  or rule that element sits in: a two-column section is aligned when its first column is. Absolutely
  and fixed-positioned descendants are overlays and chips, not the column, so they are not counted,
  and the glyphs inside an SVG drawing are the drawing's, not the column's.

  /research/experiments is in the inventory but serves a 404 today, so it is not measured (the same
  list as e2e/brand-tokens.spec.ts).
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

/*
  The seven widths of AGENTS.md's capture set, driven from inside the 1440 project rather than by the
  seven width projects: CI's Product QA job runs 1440, 390 and 360 only (launch-qa.yml), and R1 has
  to hold at all seven where it is enforced, not only on a workstation.
*/
const WIDTHS = [1920, 1440, 1280, 1024, 768, 390, 360] as const;
const viewportOf = (width: number) => ({ width, height: width <= 390 ? 844 : 900 });

/** The container's left edge as the tokens define it: max(clamp(24px, 5vw, 72px), (100% - 1320px) / 2). */
const edgeFor = (viewport: number) => Math.max(Math.min(Math.max(viewport * 0.05, 24), 72), (viewport - 1320) / 2);
const headerHeightFor = (viewport: number) => (viewport >= 900 ? 64 : 56);
/*
  B-09 (delegated decision 2, 2026-10-19). Below 821px the /explore stage header is two rows: the
  wordmark with the crumb, then its two actions. Each row holds controls on the 44px touch floor
  (e2e/explore-touch-targets.spec.ts), so two rows cannot fit inside the 56px header row -- 2 x 44 =
  88 > 56 with no gap at all -- and neither shrinking a target nor hiding a label is allowed. Its
  ceiling is therefore the two-row geometry it has, 44 + 8 + 44 + 8 + 1 (border) = 105px: no third
  row, and no label in it cut (no ellipsis, nothing wider than its box).
*/
const EXPLORE_TWO_ROW_HEADER = 105;

type Edges = {
  viewport: number;
  wordmark: number | null;
  headerHeight: number | null;
  h1: number | null;
  content: number | null;
  contentFrom: string;
  cta: string | null;
  /** Header labels that are cut: an ellipsis, or text wider than its box. */
  headerClipped: string[];
};

/** Runs in the page; self-contained because Playwright serialises it. */
function measure(): Edges {
  const visible = (el: Element) => {
    const box = el.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const name = (el: Element) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}`;
  };
  const replaced = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE", "INPUT", "SELECT", "TEXTAREA", "IFRAME"]);
  const isLeaf = (el: Element) =>
    replaced.has(el.tagName.toUpperCase()) ||
    [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
  /** An overlay or a chip: it, or an ancestor inside `root`, is taken out of flow. */
  const positioned = (el: Element, root: Element) => {
    for (let at: Element | null = el; at && at !== root; at = at.parentElement) {
      const position = getComputedStyle(at).position;
      if (position === "absolute" || position === "fixed") return true;
    }
    return false;
  };
  const leavesOf = (root: Element) =>
    [...root.querySelectorAll("*")].filter((el) => {
      // A drawing is one replaced box; the glyphs inside it are not the column's edge. Nor is a
      // decoration hidden from assistive technology (a rotated arrow glyph overhangs its box).
      if (el.parentElement?.closest("svg") || el.closest("[aria-hidden=\"true\"]")) return false;
      return isLeaf(el) && visible(el) && !positioned(el, root);
    });
  const opaque = (colour: string) => colour !== "transparent" && !/rgba\(.*,\s*0\)$/.test(colour);
  const painted = (el: Element) => {
    const style = getComputedStyle(el);
    return opaque(style.backgroundColor) ||
      (parseFloat(style.borderLeftWidth) > 0 && style.borderLeftStyle !== "none" && opaque(style.borderLeftColor));
  };
  /** Where a reader sees the leaf's column start: the leaf, or the card or rule it sits in. */
  const edgeOf = (leaf: Element, root: Element) => {
    let edge = leaf.getBoundingClientRect().left;
    for (let at = leaf.parentElement; at && at !== root; at = at.parentElement) {
      if (painted(at)) edge = Math.min(edge, at.getBoundingClientRect().left);
    }
    return edge;
  };

  const viewport = document.documentElement.clientWidth;
  const header = [...document.querySelectorAll("header")].find((el) => !el.closest("footer") && el.querySelector(".wordmark") && visible(el)) ?? null;
  const wordmark = header ? [...header.querySelectorAll(".wordmark")].find(visible) ?? null : null;
  const cta = header ? [...header.querySelectorAll("a.btn")].find(visible) ?? null : null;
  const h1 = [...document.querySelectorAll("h1")].find(visible) ?? null;

  let content: number | null = null;
  let contentFrom = "no H1";
  if (h1) {
    const main = h1.closest("main") ?? document.body;
    const hero = h1.closest("section, header") ?? h1.parentElement ?? main;
    const heroBottom = hero.getBoundingClientRect().bottom;
    let section: Element | null = null;
    let leaves: Element[] = [];
    // The next block after the hero, climbing out of its wrappers until <main>.
    for (let at: Element | null = hero; at && at !== main && !section; at = at.parentElement) {
      for (let next = at.nextElementSibling; next; next = next.nextElementSibling) {
        // A column beside the hero belongs to the hero; the first section is the one below it.
        if (!visible(next) || next.getBoundingClientRect().top < heroBottom - 1) continue;
        leaves = leavesOf(next);
        if (leaves.length) { section = next; break; }
      }
    }
    if (!section) {
      section = hero;
      leaves = leavesOf(hero);
    }
    if (leaves.length) {
      const root = section;
      const first = leaves.reduce((a, b) => (edgeOf(b, root) < edgeOf(a, root) ? b : a));
      content = edgeOf(first, root);
      contentFrom = `${name(section)} > ${name(first)}`;
      section.setAttribute("data-alignment-section", "1");
    } else {
      contentFrom = `${name(section)} (no content)`;
    }
  }
  const headerClipped = header
    ? [...header.querySelectorAll("a, button, p, span, b")].filter(visible).filter((el) =>
      getComputedStyle(el).textOverflow === "ellipsis" || el.scrollWidth > el.clientWidth + 1,
    ).map((el) => `${name(el)} "${(el.textContent ?? "").trim().slice(0, 40)}"`)
    : [];
  return {
    viewport,
    headerClipped,
    wordmark: wordmark ? wordmark.getBoundingClientRect().left : null,
    headerHeight: header ? header.getBoundingClientRect().height : null,
    h1: h1 ? h1.getBoundingClientRect().left : null,
    content,
    contentFrom,
    cta: cta ? (cta.textContent ?? "").trim() : null,
  };
}

async function edgesOf(page: import("@playwright/test").Page, route: string) {
  const response = await page.goto(route);
  expect(response?.status(), `${route} answers`).toBeLessThan(400);
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(measure);
}

for (const width of WIDTHS) test.describe(`one container (UX-L2, R1) at ${width}`, () => {
  test.use({ viewport: viewportOf(width) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "drives all seven widths from the 1440 project");
  });

  for (const route of ROUTES) {
    test(`${route}: wordmark, H1 and first section share the container edge`, async ({ page }) => {
      /*
        B-09: no known failure left. A /docs chapter page holds R1 at every width: its title row
        spans the chapter rail and the reading column, so the H1 stands on the container edge with
        the wordmark and the rail under it (delegated decision 2, 2026-10-19). It was a test.fail at
        1080px and up, which also swallowed a 500 or a missing H1 on those routes.
      */
      const m = await edgesOf(page, route);
      const edge = edgeFor(m.viewport);
      const at = `${route} @${m.viewport}: wordmark ${m.wordmark}, H1 ${m.h1}, content ${m.content} (${m.contentFrom}), edge ${edge}`;
      expect(m.wordmark, `no header wordmark on ${route}`).not.toBeNull();
      expect(m.h1, `no H1 on ${route}`).not.toBeNull();
      expect(m.content, `no first-section content on ${route}: ${m.contentFrom}`).not.toBeNull();
      expect.soft(Math.abs(m.wordmark! - edge), `wordmark off the container edge. ${at}`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(m.wordmark! - m.h1!), `|wordmark − H1| > 1px. ${at}`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(m.h1! - m.content!), `|H1 − first section| > 1px. ${at}`).toBeLessThanOrEqual(1);
      if (route === "/explore" && m.viewport <= 820) {
        // B-09: two rows are allowed below 821px, within the two-row ceiling and with no label cut.
        expect.soft(m.headerHeight!, `/explore header height ${m.headerHeight} @${m.viewport}`).toBeGreaterThanOrEqual(headerHeightFor(m.viewport) - 1);
        expect.soft(m.headerHeight!, `/explore header height ${m.headerHeight} @${m.viewport}`).toBeLessThanOrEqual(EXPLORE_TWO_ROW_HEADER + 1);
        expect.soft(m.headerClipped, `/explore header labels cut @${m.viewport}`).toEqual([]);
      } else {
        expect.soft(Math.abs(m.headerHeight! - headerHeightFor(m.viewport)), `header height ${m.headerHeight} on ${route}`).toBeLessThanOrEqual(1);
      }
      // §5.2: the one filled action from 900px, never on the page it points at; wordmark + Menu below 900.
      if (m.viewport >= 900 && route !== "/explore") expect.soft(m.cta, `no header action at ${m.viewport} on ${route}`).not.toBeNull();
      else expect.soft(m.cta, `a header action at ${m.viewport} on ${route}`).toBeNull();
    });
  }

  // T6, so outside R1's inventory, but §5.2 puts the sign-in header on the same geometry.
  test("/login: the header sits on the container edge at the shared height", async ({ page }) => {
    const m = await edgesOf(page, "/login");
    expect(m.wordmark, "no header wordmark on /login").not.toBeNull();
    expect.soft(Math.abs(m.wordmark! - edgeFor(m.viewport)), `/login wordmark ${m.wordmark} @${m.viewport}`).toBeLessThanOrEqual(1);
    expect.soft(Math.abs(m.headerHeight! - headerHeightFor(m.viewport)), `/login header ${m.headerHeight} @${m.viewport}`).toBeLessThanOrEqual(1);
  });

  test("the header row holds between 900 and 1249: wordmark, Menu and the action on one line", async ({ page }) => {
    test.skip(width !== 1024, "the one width of the seven inside the 900-1249 band");
    await page.goto("/product");
    const header = page.locator("header.nav");
    await expect(header.locator(".nav-actions a.btn")).toBeVisible();
    await expect(header.locator(".nav-actions a[href='/pricing']")).toBeHidden();
    await expect(header.locator(".nav-actions .nav-signin")).toBeHidden();
    // Pricing and Sign in are rows of the sheet in this band, not gone.
    await header.locator("details.mobile-primary-nav > summary").click();
    await expect(header.locator("details.mobile-primary-nav a.mobile-nav-direct[href='/pricing']")).toBeVisible();
    await expect(header.locator("details.mobile-primary-nav a.mobile-nav-signin")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await header.locator("details.mobile-primary-nav > summary").click();

    // The band's edges: the action holds on one 64px row at 900 and 1249, and leaves the row at 899.
    for (const [band, action, height] of [[900, true, 64], [1249, true, 64], [899, false, 56]] as const) {
      await page.setViewportSize({ width: band, height: 900 });
      const cta = header.locator(".nav-actions a.btn");
      if (action) await expect(cta, `the action at ${band}`).toBeVisible();
      else await expect(cta, `the action at ${band}`).toBeHidden();
      expect(Math.round((await header.boundingBox())!.height), `header height at ${band}`).toBe(height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${band}`).toBe(true);
    }
  });
});

/*
  The failure path: each detector fires on a defect it exists to catch. A shifted H1, a shifted
  first section, a wordmark off the container and a missing header action are each injected on
  Home -- a page whose first section is its own block, below the hero -- and must each be
  reported: a measurement that cannot fail proves nothing.
*/
test.describe("the alignment detector", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "one width is enough to prove the detector");
  });

  test("reports a shifted H1, a shifted section, an off-edge wordmark and a missing action", async ({ page }) => {
    const clean = await edgesOf(page, "/");
    const edge = edgeFor(clean.viewport);
    expect(Math.abs(clean.h1! - clean.content!)).toBeLessThanOrEqual(1);

    // The CSP forbids injected <style>; CSSOM writes are not stylesheets and are allowed.
    const shift = (selector: string, property: string, value: string) =>
      page.evaluate(([s, p, v]) => {
        for (const el of document.querySelectorAll<HTMLElement>(s)) el.style.setProperty(p, v, "important");
      }, [selector, property, value] as const);

    await shift("main h1", "transform", "translateX(9px)");
    const h1Shifted = await page.evaluate(measure);
    expect(Math.abs(h1Shifted.wordmark! - h1Shifted.h1!)).toBeGreaterThan(1);

    await shift("main h1", "transform", "none");
    await shift("[data-alignment-section]", "transform", "translateX(9px)");
    const sectionShifted = await page.evaluate(measure);
    expect(Math.abs(sectionShifted.h1! - sectionShifted.content!)).toBeGreaterThan(1);

    await shift("header .wordmark", "transform", "translateX(9px)");
    await shift("header a.btn", "display", "none");
    const chromeBroken = await page.evaluate(measure);
    expect(Math.abs(chromeBroken.wordmark! - edge)).toBeGreaterThan(1);
    expect(chromeBroken.cta).toBeNull();
  });
});
