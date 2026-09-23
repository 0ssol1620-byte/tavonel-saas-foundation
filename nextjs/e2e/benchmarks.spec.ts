const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/*
  /benchmarks, in a browser.

  The unit tests in lib/benchmark-registry.test.ts hold the validator and the page source. What
  they cannot see is whether a published result carries its limits and receipt. R-01 is the
  historical same-pipeline recovery result; the compilation protocol has no qualified result.
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

test("publishes the compilation protocol and source-bound recovery without an unreceipted table", async ({ page }) => {
  await page.goto("/benchmarks");
  // The 2026-09-17 copy pass rewrote the imperative headline ("Measure the compile...") as a
  // statement. What this pins is unchanged: the H1 names the measurement, not a result.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("How a compile is measured");

  for (const family of FAMILIES) {
    await expect(page.getByRole("heading", { name: family, exact: true })).toBeVisible();
  }
  await expect(page.locator(".tile")).toHaveCount(FAMILIES.length);

  // The receipt contract, as many rows as the registry declares fields.
  await expect(page.locator("dl dt")).toHaveCount(21);
  await expect(page.locator("dl dt").filter({ hasText: "Corpus digest" })).toHaveCount(1);
  await expect(page.locator("dl dt").filter({ hasText: "Published failures" })).toHaveCount(1);

  await expect(page.getByRole("heading", { name: "Verified Fresh Knowledge Coverage" })).toBeVisible();

  /*
    BA-076 / BA-077. The page states what it is, rather than what it has not got.

    The sentence that used to be here announced, three paragraphs under a headline promising
    "Measure the compile", that no run carries every receipt field -- and the North Star label
    carried "NO VALUE PUBLISHED ON THIS DEPLOYMENT" beside the metric it defines. Both are gone;
    the table is still absent, which a reader can see without being told.

    Pinned in both directions: the protocol claim and the condition for a row arriving are
    required, and neither the old notice nor "this deployment" may come back.
  */
  const stated = page.locator("main");
  await expect(stated).toContainText("The qualification contract defines what a knowledge-compilation result has to carry");
  await expect(page.getByRole("heading", { name: "GDP.pdf evaluation design" })).toBeVisible();
  await expect(stated).toContainText("Results will be published here only with a qualified run receipt");
  for (const arm of ["Native PDF", "Compiled context", "Fixed retrieval", "Adaptive routing"]) {
    await expect(page.getByRole("heading", { name: arm, exact: true })).toBeVisible();
  }
  await expect(stated).not.toContainText("No run on this deployment");
  await expect(stated).not.toContainText("NO VALUE PUBLISHED");
  await expect(stated, "our operations vocabulary on a buyer's page").not.toContainText("this deployment");
  /*
    Gap #2 (2026-09-22). The page now carries the Model Arena run we made ourselves and its two
    receipt tables: the per-model receipts (revision, hardware, listed price snapshot) and the
    campaign files with the sha256 of the bytes every figure was read from. Those are the only
    tables allowed here. A results table for the compile protocol still waits on a qualified
    record, and a table carrying a figure with no receipt is the thing this test exists against.
  */
  const receiptTables = page.locator('table[class*="receipts"]');
  expect(
    await page.locator("table").count(),
    "every table on /benchmarks is a receipt table",
  ).toBe(await receiptTables.count());
  await expect(receiptTables.last()).toContainText("sha256");

  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const recovery = page.locator('section[aria-labelledby="recovery-title"]');
  await expect(recovery).toContainText("80.6");
  await expect(recovery).toContainText("53.7");
  await expect(recovery).toContainText("1,403 documents and 8,413 checks");
  await expect(recovery).toContainText("36.9% even with recovery");
  await expect(recovery.getByRole("link", { name: /R-01 result and receipt/ })).toHaveAttribute("href", /R-01/);
  expect(body.match(/\d+(?:\.\d+)?\s*%/g), "every public percentage needs a receipt and limitation").toEqual(["36.9%"]);
  /*
    OmniDocBench is the benchmark our own run was scored on, named beside its evaluator pin, so
    it is no longer barred here. A vendor's published leaderboard row still is: a figure someone
    else measured stays theirs.

    The 2026-09-22 copy cleanup dropped the paragraph's closing narration -- the sentence that
    announced no competitor row was placed beside these, on a page that carries none. What it
    protected is pinned positively instead: the board states the scope of the scores, states that
    every row is a run we made ourselves, and still names the evaluator revision the run was
    scored at. The vendor-name sweep below is unchanged and is what actually keeps someone
    else's figure off this page.
  */
  await expect(page.locator("main")).toContainText("evaluator revision");
  await expect(page.locator("main")).toContainText("These scores measure page reading only");
  await expect(page.locator("main")).toContainText("a model we ran ourselves");
  for (const vendor of ["Mistral", "Gemini", "GPT-", "Qwen"]) {
    expect(body, `${vendor} has no place on a page that publishes only our own run`).not.toContain(vendor);
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

/*
  BA-086 / BA-088 changed how /research gets a reader here, not whether it does.

  It used to be a "Benchmark protocol" ghost, one of three equal ghosts sitting directly above a
  TrustNext that rendered the page's only filled button -- so a reader saw three equivalent
  choices and then a fourth, more prominent one. The row went; the destination is in the closing
  cross-link row, named the same word the page is called everywhere else.

  So what is asserted is reachability rather than a button: /research links here, and so does the
  hub. A page that loses its way in fails; a page that changes the shape of the link does not.
*/
test("is reachable from research and from the resources hub", async ({ page }) => {
  await page.goto("/research");
  await expect(page.locator('main a[href="/benchmarks"]').first()).toBeVisible();
  // /research names the destination the way the page is titled everywhere else on the site.
  await expect(page.locator('main a[href="/benchmarks"]').first()).toHaveText("Benchmarks");
  // And the ghost row it replaced does not come back beside the page's single next step.
  await expect(page.locator("main .actions .btn.ghost")).toHaveCount(0);

  await page.goto("/resources");
  await expect(page.getByRole("link", { name: "Benchmark protocol", exact: true }).first()).toHaveAttribute("href", "/benchmarks");
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
    "GPTBot", "CCBot", "anthropic-ai",
    "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent",
  ]) {
    expect(robotsText, `${token} must be refused at the root`).toContain(
      `User-Agent: ${token}\nDisallow: /\n`,
    );
  }
  // A fetch a person asked for is a visit, not a corpus crawl: those tokens are not in the block
  // at all, so they fall to `*`, which allows them. A copy-paste into the list would remove a
  // reader's own assistant from the site, and this is what notices.
  /*
    SD-05 (2026-09-16, docs/policy/DECISION_LOG_2026-09-16.md): ClaudeBot is a fetch-time agent,
    not a training crawler, so it moved from the refusal block to the same allow-list as
    OAI-SearchBot and PerplexityBot. The training tokens above are still refused.
  */
  expect(robotsText, "ClaudeBot is allowed like the other answer-engine fetchers").toContain("User-Agent: ClaudeBot\nAllow: /\n");
  for (const token of ["Claude-User", "Claude-SearchBot", "ChatGPT-User"]) {
    expect(robotsText, `${token} is a person's own fetch, not a training crawl`).not.toContain(`User-Agent: ${token}\n`);
  }
  // Private surfaces are still withheld from every named search crawler and from `*`:
  // `*`, OAI-SearchBot, PerplexityBot, ClaudeBot (SD-05) and the Google block.
  expect(robotsText.match(/Disallow: \/workspace/g)?.length).toBe(5);

  await page.goto("/benchmarks");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tavonel.com/benchmarks");
});
