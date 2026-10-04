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
      const article = document.querySelector(".docs-body")!.getBoundingClientRect();
      const paragraph = document.querySelector(".docs-body p:not(.docs-note):not(.lede)");
      return {width: innerWidth, titleBottom:t.bottom, summaryTop:s.top, titleLeft:t.left, summaryLeft:s.left,
        articleWidth:article.width, overflow:document.documentElement.scrollWidth-innerWidth,
        paragraphSize:paragraph ? parseFloat(getComputedStyle(paragraph).fontSize) : null};
    });
    expect(result.summaryTop).toBeGreaterThanOrEqual(result.titleBottom);
    expect(Math.abs(result.titleLeft-result.summaryLeft)).toBeLessThan(2);
    expect(result.overflow).toBeLessThanOrEqual(1);
    if (result.width >= 1280) expect(result.articleWidth).toBeGreaterThan(580);
    if (result.paragraphSize !== null) expect(result.paragraphSize).toBeGreaterThanOrEqual(result.width <= 600 ? 16 : 17);
    await test.info().attach("readable-documentation", {body:await page.screenshot({animations:"disabled"}),contentType:"image/png"});
  });
}

async function dismissConsent(page: import("@playwright/test").Page) {
  const panel = page.getByRole("region", { name: "Optional analytics", exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(panel).toBeHidden();
}

test("MCP reading controls and title clear the shared header with either consent state", async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  test.skip(width !== 390 && width !== 1440, "This focused layout check runs at the phone and desktop reference widths.");

  await page.goto("/docs/mcp");
  const consent = page.getByRole("region", { name: "Optional analytics", exact: true });
  await expect(consent).toBeVisible();

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
    if (consentVisible && layout.banner) {
      expect(doesNotOverlap(layout.banner, layout.header)).toBe(true);
      expect(layout.banner.bottom).toBeLessThanOrEqual(layout.header.top + 1);
      for (const content of [layout.search, layout.index, layout.title, layout.summary]) {
        expect(content.top).toBeGreaterThanOrEqual(layout.banner.bottom - 1);
      }
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
