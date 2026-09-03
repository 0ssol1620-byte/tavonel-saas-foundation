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
  await expect(page.getByText("DETERMINISTIC PRODUCT SAMPLE")).toBeVisible();
});

test("sample binds an answer to a page-level citation without fabricated proof", async ({ page }) => {
  await page.goto("/explore");
  // The fixture is a maintenance manual now, not TAVONEL's own retention policy. Compiling our
  // own document taught the visitor what we say about ourselves rather than what the product
  // does to their material, and the filename was the tell.
  await expect(page.getByText("FP-200-maintenance-manual-revC.pdf")).toBeVisible();
  await expect(page.getByText("BBOX [118, 214, 886, 374]")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open citation/ })).toBeVisible();
  // This asserted a RESEARCH FRONTIER card whose every field read `not_yet`. The card is gone:
  // a placeholder object on a page whose entire claim is that every object is bound to evidence
  // argued against the page it appeared on. What the card stood for still has to hold, so it is
  // asserted directly instead -- provenance is stated, and no placeholder is rendered as a fact.
  await expect(page.getByText("PAGE + BBOX BOUND")).toBeVisible();
  await expect(page.locator("html")).not.toContainText(/not_yet/i);
  await expect(page.getByText(/not customer proof/i)).toBeVisible();
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
