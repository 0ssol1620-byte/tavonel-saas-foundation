import { test, expect } from "@playwright/test";

test("How it works explains a pipeline rather than repeating the Product World", async ({ page }) => {
  await page.goto("/how-it-works");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tavonel.com/how-it-works");
  const process = page.getByRole("list", { name: "The compilation process" });
  await expect(process.locator("li")).toHaveCount(6);
  await expect(process).toContainText("full-corpus compiles");
  await expect(page.getByRole("heading", { name: "From a source to a versioned World." })).toBeVisible();
  await expect(page.locator('.explore-frame')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("Product offers output uses and a distinct process destination", async ({ page }) => {
  await page.goto("/product");
  await expect(page.getByRole("heading", { name: "A World. Ready for your AI." })).toBeVisible();
  for (const name of ["Open the evidence", "Keep versions readable", "Use the World in your stack"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole("link", { name: "Follow the compilation process" })).toHaveAttribute("href", "/how-it-works");
  await expect(page.getByRole("list", { name: "The compilation process" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("Home publishes the negative GDP result with its comparison boundary", async ({ page }) => {
  await page.goto("/");
  const measured = page.locator('[data-home-measurement]');
  await expect(measured.locator('dd')).toHaveText(["31 / 100", "27 / 100", "−4.0 pp"]);
  await expect(measured).toContainText("Compiled context did not improve this run");
  await expect(measured).toContainText("cannot be compared with published GDP.pdf scores or competitors");
  await expect(measured.getByRole("link")).toHaveAttribute("href", "/benchmarks/gdp-pdf");
});

// New light-surface text must not inherit the old dark-surface palette.
test("hero film controls and measured-result heading retain readable contrast", async ({ page }) => {
  await page.goto("/");
  for (const selector of ['.compile-film-stages button', '.compile-film-caption p', '.compile-film-progress', '[data-home-measurement] h2']) {
    const contrasts = await page.locator(selector).evaluateAll(elements => elements.map(element => {
      const luminance = (value: string) => {
        const channels = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(channel => {
          const n = channel / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
      };
      let ancestor: Element | null = element;
      let background = 'rgb(255, 255, 255)';
      while (ancestor) {
        const candidate = getComputedStyle(ancestor).backgroundColor;
        const channels = candidate.match(/[\d.]+/g)?.map(Number) ?? [];
        if (channels.length === 3 || (channels.length === 4 && channels[3]! >= 0.99)) { background = candidate; break; }
        ancestor = ancestor.parentElement;
      }
      const fg = luminance(getComputedStyle(element).color), bg = luminance(background);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    }));
    expect(contrasts.length, selector).toBeGreaterThan(0);
    for (const contrast of contrasts) expect(contrast, selector).toBeGreaterThanOrEqual(4.5);
  }
});
