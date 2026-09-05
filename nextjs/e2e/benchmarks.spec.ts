const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/*
  /benchmarks, in a browser.

  The unit tests in lib/benchmark-registry.test.ts hold the validator and the page source. What
  they cannot see is the thing this route was a 404 to avoid: a page that looks like it is
  reporting results. So the assertions here are mostly about absence -- no table, no percentage,
  no competitor -- alongside the protocol content that is the reason to publish the page at all.
*/

const FAMILIES = [
  "Document reading",
  "Evidence",
  "Identity",
  "Knowledge",
  "Temporal",
  "Recompilation",
  "Ask",
  "Operations",
];

test("publishes the compilation benchmark protocol and no results table", async ({ page }) => {
  await page.goto("/benchmarks");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Measure the compile");

  for (const family of FAMILIES) {
    await expect(page.getByRole("heading", { name: family, exact: true })).toBeVisible();
  }
  await expect(page.locator(".tile")).toHaveCount(FAMILIES.length);

  // The receipt contract, as many rows as the registry declares fields.
  await expect(page.locator("dl dt")).toHaveCount(21);
  await expect(page.locator("dl dt").filter({ hasText: "Corpus digest" })).toHaveCount(1);
  await expect(page.locator("dl dt").filter({ hasText: "Published failures" })).toHaveCount(1);

  await expect(page.getByRole("heading", { name: "Verified Fresh Knowledge Coverage" })).toBeVisible();

  // The absence, stated once and legible, rather than an empty table.
  await expect(page.locator("main")).toContainText("No run on this deployment carries every field of the receipt below.");
  await expect(page.locator("table")).toHaveCount(0);

  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  expect(body, "a percentage here would be a number with no receipt").not.toMatch(/\d+(\.\d+)?\s*%/);
  for (const vendor of ["OmniDocBench", "Mistral", "Gemini", "GPT-", "Qwen"]) {
    expect(body, `${vendor} has no place on a page that publishes no comparison`).not.toContain(vendor);
  }
});

test("carries no empty structural cell and never overflows its viewport", async ({ page }) => {
  await page.goto("/benchmarks");
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    width: window.innerWidth,
    empty: Array.from(document.querySelectorAll(".tile, .link, dl > div, li"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 100 && rect.height > 40 && (element.textContent ?? "").trim().length === 0;
      }).length,
  }));
  expect(result.overflow, `/benchmarks overflows at ${result.width}px`).toBeLessThanOrEqual(1);
  expect(result.empty, "/benchmarks contains an empty structural cell").toBe(0);
});

test("is reachable from research and from the resources hub", async ({ page }) => {
  await page.goto("/research");
  await expect(page.getByRole("link", { name: "Benchmark protocol" })).toHaveAttribute("href", "/benchmarks");

  await page.goto("/resources");
  await expect(page.getByRole("link", { name: "Benchmarks", exact: true }).first()).toHaveAttribute("href", "/benchmarks");
});

/*
  The route is a page, is in the sitemap, and is still withheld from crawlers.

  This lane removed `/benchmarks` from the robots disallow list, which is an indexing decision
  rather than an implementation one. The orchestrator's 2026-09-05 adjudication reserved it for
  the founder and set the default back to disallowed, so this assertion now holds the
  adjudicated state instead of the lane's: the page is built and reachable, and robots.txt says
  it is not yet offered. When the founder decides to index it, the token comes out of
  `app/robots.ts` and this expectation flips in the same commit.
*/
test("is a real page in the sitemap, with indexing still withheld pending the founder's call", async ({ page }) => {
  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain("https://tavonel.com/benchmarks");

  const robots = await page.request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /benchmarks");

  await page.goto("/benchmarks");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tavonel.com/benchmarks");
});
