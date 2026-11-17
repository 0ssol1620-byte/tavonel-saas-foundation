import { expect, test } from "@playwright/test";

/*
  UX-L2 (lane P2-04): one container, read off the browser. UX-PLAN-2026-10-17 §4.5, §5.2 and rule
  R1 of §5.3.

  R1: the container token is one. On every T0-T5 route of the plan's §5.4 inventory, at all seven
  widths, the header wordmark, the H1 and the first section's content share one left edge (±1px),
  and that edge is the one the tokens define. Before this lane Home ran a 1200px container and the
  rest of the site 1280px, so the wordmark moved 40px when a reader left Home.

  V34 (WO-CI-5a): every route of the inventory renders inside the V34 shell (`[data-v34-header]`,
  components/v34/shell), and a route that the V34 program moved answers 308 to its V34 page
  (`V34_REDIRECTS`, next.config.mjs), which is the page measured. The container is the shell's
  `--v34-shell` token (components/v34/tokens.module.css), centred; the edge is read off the page
  through that token, not typed here. The wordmark is the header's home link (accessible name
  "TAVONEL home"), the action is the header's start link (`data-analytics="header-start"`).

  §5.2, restated for the V34 shell: above the drawer breakpoint the header shows its one filled
  action (except on the page it points at); at and below it the row is the wordmark and the drawer
  trigger. The header is the `--v34-header-h` row plus its bottom rule, at every width, and /explore
  and /login take the same geometry.

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

/*
  The seven widths of AGENTS.md's capture set, driven from inside the 1440 project rather than by the
  seven width projects: CI's Product QA job runs 1440, 390 and 360 only (launch-qa.yml), and R1 has
  to hold at all seven where it is enforced, not only on a workstation.
*/
const WIDTHS = [1920, 1440, 1280, 1024, 768, 390, 360] as const;
const viewportOf = (width: number) => ({ width, height: width <= 390 ? 844 : 900 });

/*
  The V34 header's drawer breakpoint (components/v34/shell/site-header.module.css: "At 1000 and below
  the items, More and the account actions leave; the drawer takes over"). Above it the bar carries the
  one filled action; at and below it the row is the wordmark and the drawer trigger.
*/
const DRAWER_MAX = 1000;
/*
  B-09 (delegated decision 2, 2026-10-19) held the /explore stage header to a two-row ceiling below
  821px. Under the V34 shell the stage header is part of the page body and the site header is the
  shell's one row, so /explore is held to the same header geometry as every other route, and the
  "no label cut" check that B-09 made for /explore now runs on every route.
*/

type Edges = {
  viewport: number;
  /** The container's left edge as the `--v34-shell` token resolves on this page. */
  edge: number | null;
  wordmark: number | null;
  headerHeight: number | null;
  /** The header row as the tokens define it: `--v34-header-h` plus the header's bottom rule. */
  headerToken: number | null;
  h1: number | null;
  content: number | null;
  contentFrom: string;
  cta: string | null;
  ctaHref: string | null;
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
  const header = [...document.querySelectorAll("[data-v34-header]")].find((el) => !el.closest("footer") && visible(el)) ?? null;
  const inBar = (el: Element) => !el.closest("dialog");
  const wordmark = header ? [...header.querySelectorAll("a[aria-label=\"TAVONEL home\"]")].filter(inBar).find(visible) ?? null : null;
  const cta = header ? [...header.querySelectorAll("a[data-analytics=\"header-start\"]")].filter(inBar).find(visible) ?? null : null;
  cta?.setAttribute("data-alignment-cta", "1");
  const h1 = [...document.querySelectorAll("h1")].find(visible) ?? null;

  // The tokens, resolved where the shell declares them: a probe sized by them inside the V34 wrapper.
  const site = header?.closest("[data-v34-site]") ?? null;
  let edge: number | null = null;
  let headerToken: number | null = null;
  if (site && header) {
    const probe = document.createElement("div");
    for (const [property, value] of [
      ["width", "var(--v34-shell)"], ["height", "var(--v34-header-h)"], ["margin-inline", "auto"], ["visibility", "hidden"],
    ]) probe.style.setProperty(property, value);
    site.prepend(probe);
    const box = probe.getBoundingClientRect();
    probe.remove();
    edge = box.left;
    headerToken = box.height + parseFloat(getComputedStyle(header).borderBottomWidth);
  }

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
    edge,
    headerClipped,
    wordmark: wordmark ? wordmark.getBoundingClientRect().left : null,
    headerHeight: header ? header.getBoundingClientRect().height : null,
    headerToken,
    h1: h1 ? h1.getBoundingClientRect().left : null,
    content,
    contentFrom,
    cta: cta ? (cta.textContent ?? "").trim() : null,
    ctaHref: cta ? new URL((cta as HTMLAnchorElement).href).pathname : null,
  };
}

async function edgesOf(page: import("@playwright/test").Page, route: string) {
  const response = await page.goto(route);
  expect(response?.status(), `${route} answers`).toBeLessThan(400);
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(measure);
  // The token probe needs the V34 wrapper; a route without it has no container edge to hold.
  expect(m.edge, `no V34 container token on ${route}`).not.toBeNull();
  return m;
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
      const edge = m.edge!;
      const at = `${route} @${m.viewport}: wordmark ${m.wordmark}, H1 ${m.h1}, content ${m.content} (${m.contentFrom}), edge ${edge}`;
      expect(m.wordmark, `no header wordmark on ${route}`).not.toBeNull();
      expect(m.h1, `no H1 on ${route}`).not.toBeNull();
      expect(m.content, `no first-section content on ${route}: ${m.contentFrom}`).not.toBeNull();
      expect.soft(Math.abs(m.wordmark! - edge), `wordmark off the container edge. ${at}`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(m.wordmark! - m.h1!), `|wordmark − H1| > 1px. ${at}`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(m.h1! - m.content!), `|H1 − first section| > 1px. ${at}`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(m.headerHeight! - m.headerToken!), `header height ${m.headerHeight} on ${route}, token row ${m.headerToken}`).toBeLessThanOrEqual(1);
      expect.soft(m.headerClipped, `${route} header labels cut @${m.viewport}`).toEqual([]);
      // §5.2: the one filled action above the drawer breakpoint, never on the page it points at; wordmark + drawer at and below it.
      if (m.viewport > DRAWER_MAX && m.ctaHref !== new URL(page.url()).pathname) expect.soft(m.cta, `no header action at ${m.viewport} on ${route}`).not.toBeNull();
      else expect.soft(m.cta, `a header action at ${m.viewport} on ${route}`).toBeNull();
    });
  }

  // T6, so outside R1's inventory, but §5.2 puts the sign-in header on the same geometry.
  test("/login: the header sits on the container edge at the shared height", async ({ page }) => {
    const m = await edgesOf(page, "/login");
    expect(m.wordmark, "no header wordmark on /login").not.toBeNull();
    expect.soft(Math.abs(m.wordmark! - m.edge!), `/login wordmark ${m.wordmark} @${m.viewport}, edge ${m.edge}`).toBeLessThanOrEqual(1);
    expect.soft(Math.abs(m.headerHeight! - m.headerToken!), `/login header ${m.headerHeight} @${m.viewport}, token row ${m.headerToken}`).toBeLessThanOrEqual(1);
  });

  /*
    The band the bar is tightest in. Under the legacy header this was 900-1249, where Pricing and Sign
    in moved into the sheet; under the V34 header the bar keeps its items, More, Sign in and the action
    down to 1001px and hands all of them to the drawer at 1000. The promise is the same: one row, the
    action on it above the breakpoint, Pricing and Sign in reachable on both sides of it, no overflow.
  */
  test("the header row holds down to the drawer breakpoint: items, Sign in and the action on one line", async ({ page }) => {
    test.skip(width !== 1024, "the one width of the seven inside the tight band");
    await page.goto("/platform");
    const header = page.locator("[data-v34-header]");
    const bar = header.locator("nav[aria-label='Primary']");
    const cta = header.locator("a[data-analytics='header-start']").first();
    await expect(cta).toBeVisible();
    await expect(bar.getByRole("link", { name: "Pricing", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // The band's edges: the action holds on one row at 1001 and 1249, and leaves the row at 1000,
    // where Pricing and Sign in are rows of the drawer, not gone.
    const tokenRow = () => header.evaluate((element) => {
      const probe = document.createElement("div");
      probe.style.setProperty("height", "var(--v34-header-h)");
      element.append(probe);
      const height = probe.getBoundingClientRect().height;
      probe.remove();
      return height + parseFloat(getComputedStyle(element).borderBottomWidth);
    });
    for (const [band, action] of [[DRAWER_MAX + 1, true], [1249, true], [DRAWER_MAX, false]] as const) {
      await page.setViewportSize({ width: band, height: 900 });
      if (action) await expect(cta, `the action at ${band}`).toBeVisible();
      else await expect(cta, `the action at ${band}`).toBeHidden();
      expect(Math.abs((await header.boundingBox())!.height - await tokenRow()), `header height at ${band}`).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${band}`).toBe(true);
    }
    await header.getByRole("button", { name: "Open navigation" }).click();
    const drawer = header.locator("dialog");
    await expect(drawer.getByRole("link", { name: "Pricing", exact: true })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
    const edge = clean.edge!;
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

    await shift("[data-v34-header] a[aria-label=\"TAVONEL home\"]", "transform", "translateX(9px)");
    await shift("[data-alignment-cta]", "display", "none");
    const chromeBroken = await page.evaluate(measure);
    expect(Math.abs(chromeBroken.wordmark! - edge)).toBeGreaterThan(1);
    expect(chromeBroken.cta).toBeNull();
  });
});
