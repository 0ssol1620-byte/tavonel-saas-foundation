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
  The route is a page, is in the sitemap, and is now offered to crawlers.

  The 2026-09-05 adjudication put `/benchmarks` back in the robots disallow list until somebody
  audited the claims on it, which left the site advertising a URL in `sitemap.xml` and `llms.txt`
  that `robots.txt` withheld. The GTM lane ran that audit: no measured figure is published here,
  the North Star metric is stamped DEFINITION - NO VALUE PUBLISHED, the results table has no rows,
  and `validateBenchmarkReceipt` throws at build rather than rendering an unreceipted one. So the
  token came out, and this expectation flipped with it -- as the note it replaces said it would.

  `lib/seo-surface.test.ts` is the standing guard; this one checks the three files as served.
*/
test("is a real page, in the sitemap, and offered to crawlers", async ({ page }) => {
  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain("https://tavonel.com/benchmarks");

  const robots = await page.request.get("/robots.txt");
  const robotsText = await robots.text();
  expect(robotsText).not.toContain("Disallow: /benchmarks");
  expect(robotsText).not.toContain("Disallow: /product/continuous-knowledge");
  /*
    Named search crawlers are declared, and the training block is no longer silence.

    This asserted that no training token appeared at all, which was right while the policy was
    undecided -- naming one would have been deciding it in a commit about SEO. FD-61 decided it
    (a delegated decision, 2026-09-11, reversible by the founder; the reasoning is in
    `docs/policy/CRAWLER_POLICY.md`), so the assertion is inverted rather than dropped, and it
    now pins the served file to the whole list *and* its refusal -- which a single negative on one
    token could not do. `lib/seo-surface.test.ts` holds the same rule on the source.
  */
  expect(robotsText).toContain("User-Agent: OAI-SearchBot");
  expect(robotsText).toContain("User-Agent: PerplexityBot");
  for (const token of [
    "GPTBot", "CCBot", "ClaudeBot", "anthropic-ai",
    "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent",
  ]) {
    expect(robotsText, `${token} must be refused at the root`).toContain(
      `User-Agent: ${token}\nDisallow: /\n`,
    );
  }
  // A fetch a person asked for is a visit, not a corpus crawl: those tokens are not in the block
  // at all, so they fall to `*`, which allows them. A copy-paste into the list would remove a
  // reader's own assistant from the site, and this is what notices.
  for (const token of ["Claude-User", "Claude-SearchBot", "ChatGPT-User"]) {
    expect(robotsText, `${token} is a person's own fetch, not a training crawl`).not.toContain(`User-Agent: ${token}\n`);
  }
  // Private surfaces are still withheld from every named search crawler and from `*`.
  expect(robotsText.match(/Disallow: \/workspace/g)?.length).toBe(4);

  await page.goto("/benchmarks");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tavonel.com/benchmarks");
});
