const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

test("homepage opens the no-login Compiled World sample", async ({ page }) => {
  await page.goto("/");
  const cta = page.getByRole("link", { name: "Explore a Compiled World" }).first();
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole("heading", { name: /Follow a result all the way/ })).toBeVisible();
  // The sample declares itself once, in the header badge. It used to say "DETERMINISTIC
  // PRODUCT SAMPLE" here and "not customer proof" further down, which is two answers to an
  // accusation nobody browsing a demo has made. The label has to survive; the arguing does not.
  await expect(page.getByText("INTERACTIVE SAMPLE")).toBeVisible();
});

test("sample binds an answer to a page-level citation without fabricated proof", async ({ page }) => {
  await page.goto("/explore");
  // The fixture is a maintenance manual now, not TAVONEL's own retention policy. Compiling our
  // own document taught the visitor what we say about ourselves rather than what the product
  // does to their material, and the filename was the tell.
  //
  // These were three frozen literals -- a filename with the wrong case and one hand-written
  // bbox -- from when the sample was typed into the component. The sample is now compiled from
  // three committed PDFs by the same code that compiles a customer's, so the coordinates belong
  // to the text layer and `lib/explore-sample.test.ts` is what pins them. What this file is for
  // is the thing that test cannot see: that provenance reaches the screen at all.
  await expect(page.getByText(/^fp-200-[a-z0-9-]+\.pdf$/i)).toBeVisible();
  await expect(page.getByText(/^BBOX \[\d+, \d+, \d+, \d+\]$/)).toBeVisible();
  await expect(page.getByText(/^REGION ON PAGE \d+ OF \d+$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Open citation/ })).toBeVisible();
  // This asserted a RESEARCH FRONTIER card whose every field read `not_yet`, and then the
  // `PAGE + BBOX BOUND` tile that replaced it. Both were a page claiming provenance in words.
  // The three assertions above are the page showing it, so the claim is gone and the reading
  // stands in its place. What must still hold is that no placeholder renders as a fact.
  await expect(page.locator("html")).not.toContainText(/not_yet/i);
  // The page must label itself as a sample exactly once. More than once is the defensiveness
  // that made the strongest page on the site read as the weakest.
  await expect(page.getByText("INTERACTIVE SAMPLE")).toHaveCount(1);
  await expect(page.locator("html")).not.toContainText(/trusted by|customer success|certified/i);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("mobile sample switches between Source and World rather than squeezing both", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390" && testInfo.project.name !== "360");
  await page.goto("/explore");
  const source = page.getByRole("button", { name: "Source", exact: true });
  const world = page.getByRole("button", { name: "World", exact: true });
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await world.click();
  await expect(world).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("SEMANTIC OBJECT INSPECTOR")).toBeVisible();
});

test("Security record exposes fail-closed controls without certification claims", async ({ page }) => {
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: /Where your documents go/ })).toBeVisible();
  await expect(page.getByText(/Every external operation fails closed/)).toBeVisible();
  await expect(page.getByText("CURRENT DEPLOYMENT CONTROLS")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/SOC 2 certified|ISO 27001 certified/i);
});
