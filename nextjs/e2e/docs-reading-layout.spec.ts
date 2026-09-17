import { expect, test } from "@playwright/test";

for (const route of ["/docs/quickstart", "/docs/ask", "/docs/cli"]) {
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
