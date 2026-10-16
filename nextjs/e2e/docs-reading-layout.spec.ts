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
      return {width: innerWidth, titleBottom:t.bottom, summaryTop:s.top, summaryBottom:s.bottom,
        titleLeft:t.left, summaryLeft:s.left, articleTop:article.top, articleRight:article.right,
        articleWidth:article.width, indexCount:indices.length,
        index:index ? {left:index.left, top:index.top, bottom:index.bottom, width:index.width} : null,
        overflow:document.documentElement.scrollWidth-innerWidth,
        paragraphSize:paragraph ? parseFloat(getComputedStyle(paragraph).fontSize) : null};
    });
    expect(result.summaryTop).toBeGreaterThanOrEqual(result.titleBottom);
    expect(Math.abs(result.titleLeft-result.summaryLeft)).toBeLessThan(2);
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
    expect(layout.search.top - layout.header.bottom).toBeLessThanOrEqual(layout.width <= 600 ? 64 : 80);
    expect(layout.search.top).toBeGreaterThanOrEqual(layout.header.bottom - 1);
    expect(hasVisibleArea(layout.title)).toBe(true);
    expect(layout.title.top).toBeGreaterThanOrEqual(layout.header.bottom - 1);
    expect(layout.title.top).toBeLessThan(layout.height);
    expect(layout.summary.top).toBeGreaterThanOrEqual(layout.title.bottom);
    expect(hasVisibleArea(layout.summary)).toBe(true);
    expect(layout.paragraphSize).toBeGreaterThanOrEqual(layout.width <= 600 ? 16 : 17);
    if (layout.width <= 1079) expect(layout.title.top).toBeGreaterThanOrEqual(layout.index.bottom - 1);
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
