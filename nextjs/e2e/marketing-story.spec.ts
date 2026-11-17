import { test, expect } from "@playwright/test";
import { HOME_MOUNTS_LANDING_V2, HOME_NOT_MOUNTED_REASON } from "./support/held-feature";

test("How it works explains a pipeline rather than repeating the Product World", async ({ page }) => {
  // V34 (D33 1.1): /how-it-works answers 308 to /methods, which owns the pipeline.
  await page.goto("/how-it-works");
  await expect(page).toHaveURL(/\/methods$/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tavonel.com/methods");
  const process = page.locator("main ol").filter({ has: page.getByRole("heading", { level: 3 }) }).first();
  await expect(process.locator(":scope > li")).toHaveCount(6);
  // Not carried by the V34 /methods stages; soft so the rest of the page is still measured.
  expect.soft(await process.innerText()).toContain("full-corpus compiles");
  await expect(page.getByRole("heading", { name: "From a source file to the next version." })).toBeVisible();
  await expect(page.locator('[data-visual-world="explore"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("Product offers output uses and a distinct process destination", async ({ page }) => {
  // V34 (D33 1.1): /product answers 308 to /platform.
  await page.goto("/product");
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  // The three output uses are the page's own links into evidence, changes and the AI connection.
  for (const href of ["/evidence", "/changes", "/connect"]) {
    await expect(page.locator('main a[href="' + href + '"]').first(), href + " is offered from the body").toBeVisible();
  }
  // The process has its own destination (/how-it-works, now /methods); this page links to it, and does not repeat it.
  await expect(page.locator('main a[href="/methods"]').first()).toBeVisible();
  await expect(page.getByRole("list", { name: "The compilation process" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("Home leads with the product while the historical result keeps its conditions", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-home-measurement]')).toHaveCount(0);
  await page.goto("/benchmarks/gdp-pdf");
  const measured = page.locator('main');
  await expect(measured).toContainText("31 of 100");
  await expect(measured).toContainText("27 of 100");
  await expect(measured).toContainText("−4.0 pp");
  await expect(measured).toContainText("Not comparable with published GDP.pdf scores");
});

// New light-surface text must not inherit the old dark-surface palette.
test("four-stage film controls and captions retain readable contrast", async ({ page }) => {
  test.skip(!HOME_MOUNTS_LANDING_V2, HOME_NOT_MOUNTED_REASON);
  await page.goto("/");
  // FINAL-SPEC 2026-10-26 (D-7): Home prints no film caption row (the stage sentence is the poster's alt), so the
  // film's text on the page is its controls and the disclosure; both are still held to 4.5:1 below.
  // Founder 2026-11-10: the recorded player is the walkthrough below the fold; the hero film is the tabbed compile slot.
  await expect(page.locator("#walkthrough .compile-film-caption")).toHaveCount(0);
  // FINAL-SPEC 2026-10-26 §2.5: the change scene's note is gone; its one sentence and the fixed qualifier are its
  // paragraphs now, on the instrument ground, and each is held to the same 4.5:1.
  for (const selector of ['#walkthrough .compile-film-sequence button', '#walkthrough figure[data-testid="landing-hero-film"] figcaption', '#s1 figure[data-testid="hero-compile-tabs"] [role="tab"]', '#s1 figure[data-testid="hero-compile-tabs"] figcaption', '#s4 p', 'footer .wordmark b', 'footer .site-footer-legal-pair', 'footer [data-consent-anchor]']) {
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
