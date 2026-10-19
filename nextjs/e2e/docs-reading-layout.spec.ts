import { expect, test } from "@playwright/test";

for (const route of ["/docs/quickstart", "/docs/ask", "/docs/cli", "/docs/mcp"]) {
  test(`${route} places the title above a readable article instead of an empty middle column`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator(".docs-body")).toBeVisible();
    const result = await page.evaluate(() => {
      const title = document.querySelector("h1")!;
      const summary = document.querySelector(".docs-body > .lede")!;
      const t = title.getBoundingClientRect();
      const s = summary.getBoundingClientRect();
      // The reading grid includes the local index; measure the prose wrapper itself.
      const prose = document.querySelector(".docs-body > .stack")!;
      const article = prose.getBoundingClientRect();
      const paragraph = prose.querySelector("p:not(.docs-note):not(.lede)");
      const indices = document.querySelectorAll('.docs-body nav[aria-label="On this page"]');
      const index = indices[0]?.getBoundingClientRect();
      // The chapter rail (search + index): the parent of the index disclosure, at every width.
      const rail = document.querySelector(".docs-reading-surface details")!.parentElement!.getBoundingClientRect();
      return {width: innerWidth, titleBottom:t.bottom, summaryTop:s.top, summaryBottom:s.bottom,
        railLeft:rail.left, railRight:rail.right, railTop:rail.top,
        titleBeforeRail: Boolean(title.compareDocumentPosition(document.querySelector(".docs-reading-surface details")!) & Node.DOCUMENT_POSITION_FOLLOWING),
        titleLeft:t.left, summaryLeft:s.left, articleTop:article.top, articleRight:article.right,
        articleWidth:article.width, indexCount:indices.length,
        index:index ? {left:index.left, top:index.top, bottom:index.bottom, width:index.width} : null,
        overflow:document.documentElement.scrollWidth-innerWidth,
        paragraphSize:paragraph ? parseFloat(getComputedStyle(paragraph).fontSize) : null};
    });
    expect(result.summaryTop).toBeGreaterThanOrEqual(result.titleBottom);
    /*
      B-09 (delegated decision 2, 2026-10-19): the title row comes first, in the DOM and on screen,
      above the chapter rail. From 1080px it spans both columns -- the H1 on the rail's edge, which is
      the container edge, and the summary opening the reading column beside the rail, under the
      title. Below 1080 the page is one column and title and summary share its edge, as before.
    */
    expect(result.titleBeforeRail).toBe(true);
    expect(result.railTop).toBeGreaterThanOrEqual(result.titleBottom);
    if (result.width >= 1080) {
      expect(Math.abs(result.titleLeft-result.railLeft)).toBeLessThan(2);
      expect(result.summaryLeft).toBeGreaterThanOrEqual(result.railRight);
    } else {
      expect(Math.abs(result.titleLeft-result.summaryLeft)).toBeLessThan(2);
    }
    expect(result.overflow).toBeLessThanOrEqual(1);
    if (result.width >= 1280) expect(result.articleWidth).toBeGreaterThan(580);
    if (result.paragraphSize !== null) expect(result.paragraphSize).toBeGreaterThanOrEqual(result.width <= 600 ? 16 : 17);
    if (result.index) {
      expect(result.indexCount).toBe(1);
      if (result.width >= 1280) {
        expect(result.index.left).toBeGreaterThanOrEqual(result.articleRight);
        expect(result.index.width).toBeGreaterThanOrEqual(180);
        expect(result.index.width).toBeLessThanOrEqual(210);
      } else {
        expect(result.index.top).toBeGreaterThanOrEqual(result.summaryBottom);
        expect(result.index.bottom).toBeLessThanOrEqual(result.articleTop);
      }
    }
    await test.info().attach("readable-documentation", {body:await page.screenshot({animations:"disabled"}),contentType:"image/png"});
    if (result.index) {
      const index = page.locator('.docs-body nav[aria-label="On this page"]');
      await expect(index).toHaveCount(1);
      await expect(index.locator(":scope > p")).toHaveCSS("font-size", "13px");
      const summary = page.locator(".docs-body > .lede");
      await expect(summary).toHaveCSS("font-size", result.width <= 600 ? "16px" : "18px");
      const summaryLineHeight = await summary.evaluate(element => Number.parseFloat(getComputedStyle(element).lineHeight));
      expect(summaryLineHeight).toBeCloseTo(result.width <= 600 ? 24.8 : 28.8, 1);
      const links = index.locator("a");
      const anchors = await links.evaluateAll(elements => elements.map(element => element.getAttribute("href")));
      expect(new Set(anchors).size).toBe(anchors.length);
      const destinations = await page.evaluate(hrefs => hrefs.map(href => {
        if (!href || !/^#.+/.test(href)) return false;
        const matches = [...document.querySelectorAll("[id]")].filter(element => element.id === href.slice(1));
        return matches.length === 1 && Boolean(document.querySelector(".docs-body")?.contains(matches[0]));
      }), anchors);
      expect(destinations.every(Boolean), "every local anchor resolves once inside the article").toBe(true);
      const link = links.last();
      await expect(link).toHaveCSS("font-size", "14px");
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const fragment = await link.getAttribute("href");
      expect(fragment).toMatch(/^#.+/);
      await page.keyboard.press("Tab");
      await link.focus();
      await expect(link).toBeFocused();
      await expect(link).toBeInViewport();
      await expect(link).not.toHaveCSS("outline-style", "none");
      if (result.width < 1280) {
        const scrolling = await index.locator("ul").evaluate(element => {
          const style = getComputedStyle(element);
          return { overflow: style.overflowY, maxHeight: style.maxHeight };
        });
        expect(scrolling).toEqual({ overflow: "visible", maxHeight: "none" });
      }
      await page.keyboard.press("Enter");
      await expect.poll(() => new URL(page.url()).hash).toBe(fragment);
      await expect(page.locator(fragment!)).toBeVisible();
    }
  });
}

/*
  Release 2 (main dbe22b1e): the consent card is not on the first paint. It appears after the first
  scroll past 200px or 8 s (CONSENT_REVEAL in components/marketing-consent.tsx), stays until answered,
  and is a bottom-fixed card rather than a band above the header. Reveal it with a scroll and measure
  the reading position back at the top.
*/
async function revealConsentAtTop(page: import("@playwright/test").Page) {
  await page.evaluate(() => window.scrollTo(0, 300));
  const panel = page.getByRole("region", { name: "Optional analytics", exact: true });
  await expect(panel).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  return panel;
}

async function dismissConsent(page: import("@playwright/test").Page) {
  const panel = await revealConsentAtTop(page);
  await panel.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(panel).toBeHidden();
}

test("MCP reading controls and title clear the shared header with either consent state", async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  test.skip(width !== 390 && width !== 1440, "This focused layout check runs at the phone and desktop reference widths.");

  await page.goto("/docs/mcp");
  await revealConsentAtTop(page);

  const expectReadingPosition = async (consentVisible: boolean) => {
    const layout = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>("header.nav.chrome-v2-header");
      const search = document.querySelector<HTMLElement>('.docs-reading-surface input[aria-label="Search every documentation page, including page bodies"]');
      const title = document.querySelector<HTMLElement>(".docs-reading-surface .document-title");
      const summary = document.querySelector<HTMLElement>(".docs-reading-surface .docs-body > .lede");
      const banner = document.querySelector<HTMLElement>("[data-marketing-consent-panel]");
      if (!header || !search || !title || !summary) {
        throw new Error("Missing MCP shared header, Docs search, article title, or summary");
      }
      const box = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      };
      const width = innerWidth;
      const indexControl = width <= 1079
        ? document.querySelector<HTMLElement>(".docs-reading-surface details > summary")
        : document.querySelector<HTMLElement>('.docs-reading-surface nav[aria-label="Documentation"]');
      if (!indexControl) throw new Error("Missing responsive Docs index control");
      const bannerBox = banner ? box(banner) : null;
      return {
        width,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth,
        header: box(header),
        banner: bannerBox,
        search: box(search),
        index: box(indexControl),
        indexVisible: Boolean(indexControl.getClientRects().length),
        title: box(title),
        summary: box(summary),
        paragraphSize: Number.parseFloat(getComputedStyle(summary).fontSize),
      };
    });

    const hasVisibleArea = (box: { top: number; bottom: number }) =>
      Math.max(0, Math.min(layout.height, box.bottom) - Math.max(0, box.top)) > 0;
    const doesNotOverlap = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) =>
      a.bottom <= b.top || b.bottom <= a.top;

    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.indexVisible).toBe(true);
    expect(hasVisibleArea(layout.search)).toBe(true);
    expect(hasVisibleArea(layout.index)).toBe(true);
    /*
      B-09: the title row is first now, so the reading controls sit under the title rather than
      under the header. The same reach, measured from the block that is above them: the title
      within 64/80px of the header, the search within 64/80px of the title.
    */
    expect(layout.title.top - layout.header.bottom).toBeLessThanOrEqual(layout.width <= 600 ? 64 : 80);
    expect(layout.search.top - layout.title.bottom).toBeLessThanOrEqual(layout.width <= 600 ? 64 : 80);
    expect(layout.search.top).toBeGreaterThanOrEqual(layout.title.bottom - 1);
    expect(hasVisibleArea(layout.title)).toBe(true);
    expect(layout.title.top).toBeGreaterThanOrEqual(layout.header.bottom - 1);
    expect(layout.title.top).toBeLessThan(layout.height);
    expect(layout.summary.top).toBeGreaterThanOrEqual(layout.title.bottom);
    expect(hasVisibleArea(layout.summary)).toBe(true);
    expect(layout.paragraphSize).toBeGreaterThanOrEqual(layout.width <= 600 ? 16 : 17);
    // B-09: the index control (the rail's column from 1080, its disclosure below) is under the title at every width.
    expect(layout.index.top).toBeGreaterThanOrEqual(layout.title.bottom - 1);
    /*
      Release 2: the card sits at the viewport's bottom edge, below the header, and must clear the
      search, title and summary; the Docs index starts above it (at 1440 it is the full-height
      sidebar the bottom-left card overlaps near its foot). Measured on the merged build with the
      card shown at scroll 0: 390x844 card 740.8-836, summary ends 281.8; 1440x900 card 743.4-884,
      summary ends 245, index starts 153.9.
    */
    if (consentVisible && layout.banner) {
      expect(doesNotOverlap(layout.banner, layout.header)).toBe(true);
      expect(layout.banner.top).toBeGreaterThanOrEqual(layout.header.bottom - 1);
      expect(layout.banner.bottom).toBeLessThanOrEqual(layout.height + 1);
      for (const content of [layout.search, layout.title, layout.summary]) {
        expect(doesNotOverlap(content, layout.banner)).toBe(true);
      }
      expect(layout.index.top).toBeLessThan(layout.banner.top);
    }

    await test.info().attach(consentVisible ? "mcp-reading-consent-visible" : "mcp-reading-consent-dismissed", {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  };

  await expectReadingPosition(true);
  await dismissConsent(page);
  await expectReadingPosition(false);
});

/*
  R1 on the docs routes, inside the docs owner's own browser suite (Phase 4 follow-ups (g), DELTA-REVIEW-2026-10-19 N-3).

  UX-PLAN-2026-10-17 section 5.3 R1: the header wordmark, the H1 and the content under it share one left edge (+/-1px), the one
  the tokens define (`--tv-page-w`: min(1320px, 100% - 2 x clamp(24px, 5vw, 72px)), centred). e2e/site-alignment.spec.ts
  measures it on every public route, but the Repair-scope `docs` owner did not select that suite, so a change to only
  app/docs/[section]/page.tsx or components/docs/* could move the /docs title row off the edge (the B-09 layout) and pass.
  The owner's paths sit in the 5dd95ed8 affected-integration fixtures, where site-alignment.spec.ts did not exist yet, so
  the docs routes' R1 is measured here, in the suite the owner already selects. "Content" is measured as
  site-alignment.spec.ts measures it: the first block below the H1's hero, its leftmost in-flow text or replaced element,
  or the painted card or rule inside that block it sits in. The leftmost one has to be on the edge.
  Driven at all seven widths from the 1440 project, as site-alignment.spec.ts does.
*/
const R1_DOCS_ROUTES = ["/docs", "/docs/quickstart", "/docs/mcp"] as const;
const R1_WIDTHS = [1920, 1440, 1280, 1024, 768, 390, 360] as const;
const containerEdge = (viewport: number) => Math.max(Math.min(Math.max(viewport * 0.05, 24), 72), (viewport - 1320) / 2);

/** Runs in the page; self-contained because Playwright serialises it. */
function docsEdges() {
  const visible = (el: Element) => {
    const box = el.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const replaced = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE", "INPUT", "SELECT", "TEXTAREA", "IFRAME"]);
  const header = [...document.querySelectorAll("header")].find((el) => !el.closest("footer") && el.querySelector(".wordmark") && visible(el));
  const wordmark = header ? [...header.querySelectorAll(".wordmark")].find(visible) : undefined;
  const h1 = [...document.querySelectorAll("main h1")].find(visible);
  if (!wordmark || !h1) return { viewport: document.documentElement.clientWidth, wordmark: null, h1: null, content: null, from: "missing wordmark or H1" };
  const main = h1.closest("main")!;
  const outOfFlow = (el: Element, root: Element) => {
    for (let at: Element | null = el; at && at !== root; at = at.parentElement) {
      const position = getComputedStyle(at).position;
      if (position === "absolute" || position === "fixed") return true;
    }
    return false;
  };
  const painted = (el: Element) => {
    const style = getComputedStyle(el);
    const opaque = (colour: string) => colour !== "transparent" && !/rgba\(.*,\s*0\)$/.test(colour);
    return opaque(style.backgroundColor) || (parseFloat(style.borderLeftWidth) > 0 && style.borderLeftStyle !== "none" && opaque(style.borderLeftColor));
  };
  const leavesOf = (root: Element) => [...root.querySelectorAll("*")].filter((el) => {
    if (el.parentElement?.closest("svg") || el.closest("[aria-hidden=\"true\"]")) return false;
    const leaf = replaced.has(el.tagName.toUpperCase()) || [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
    return leaf && visible(el) && !outOfFlow(el, root);
  });
  // The first block below the hero, climbing out of the hero's wrappers until <main> (site-alignment.spec.ts).
  const hero = h1.closest("section, header") ?? h1.parentElement ?? main;
  const heroBottom = hero.getBoundingClientRect().bottom;
  let block: Element | null = null;
  let leaves: Element[] = [];
  for (let at: Element | null = hero; at && at !== main && !block; at = at.parentElement) {
    for (let next = at.nextElementSibling; next; next = next.nextElementSibling) {
      if (!visible(next) || next.getBoundingClientRect().top < heroBottom - 1) continue;
      leaves = leavesOf(next);
      if (leaves.length) { block = next; break; }
    }
  }
  const root = block ?? hero;
  if (!block) leaves = leavesOf(hero);
  // A painted card or rule counts up to the block, not past it: a full-bleed band is not a column edge.
  const edgeOf = (leaf: Element) => {
    let edge = leaf.getBoundingClientRect().left;
    for (let at = leaf.parentElement; at && at !== root; at = at.parentElement) if (painted(at)) edge = Math.min(edge, at.getBoundingClientRect().left);
    return edge;
  };
  let content: number | null = null, from = "no content below the H1";
  for (const el of leaves) {
    const edge = edgeOf(el);
    if (content === null || edge < content) {
      content = edge;
      from = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""}`;
    }
  }
  return { viewport: document.documentElement.clientWidth, wordmark: wordmark.getBoundingClientRect().left, h1: h1.getBoundingClientRect().left, content, from };
}

test.describe("R1 on the docs routes: wordmark, H1 and content on the container edge", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "drives all seven widths from the 1440 project");
  });
  for (const width of R1_WIDTHS) {
    for (const route of R1_DOCS_ROUTES) {
      test(`${route} at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
        const response = await page.goto(route);
        expect(response?.status(), `${route} answers`).toBeLessThan(400);
        await page.evaluate(() => document.fonts.ready);
        const m = await page.evaluate(docsEdges);
        const edge = containerEdge(m.viewport);
        const at = `${route} @${m.viewport}: wordmark ${m.wordmark}, H1 ${m.h1}, content ${m.content} (${m.from}), edge ${edge}`;
        expect(m.wordmark, at).not.toBeNull();
        expect(m.h1, at).not.toBeNull();
        expect(m.content, at).not.toBeNull();
        expect.soft(Math.abs(m.wordmark! - edge), `wordmark off the container edge. ${at}`).toBeLessThanOrEqual(1);
        expect.soft(Math.abs(m.h1! - m.wordmark!), `|wordmark - H1| > 1px. ${at}`).toBeLessThanOrEqual(1);
        expect.soft(Math.abs(m.content! - m.h1!), `|H1 - content| > 1px. ${at}`).toBeLessThanOrEqual(1);
      });
    }
  }

  test("the measurement catches a title row moved off the edge", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/docs/quickstart");
    await page.locator("main h1").first().evaluate((h1) => { (h1 as HTMLElement).style.marginLeft = "24px"; });
    const m = await page.evaluate(docsEdges);
    expect(Math.abs(m.h1! - m.wordmark!)).toBeGreaterThan(1);
  });
});
