const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const OVERFLOW_ROUTES = [
  "/api",
  "/developers",
  "/docs/upload",
  "/docs/collections-and-compile",
  "/docs/run-events",
  "/docs/review",
  "/docs/world-api",
  "/docs/search",
  "/docs/ask",
  "/reproducibility",
] as const;

test("mobile public navigation remains reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390" && testInfo.project.name !== "360");
  await page.goto("/");
  const menu = page.locator(".mobile-primary-nav");
  await expect(menu).toBeVisible();
  await menu.locator(":scope > summary").click();
  const direct = menu.locator(":scope > nav a.mobile-nav-direct");
  await expect(direct).toHaveCount(3);
  await expect(direct).toHaveText(["How it works", "Connect", "Pricing"]);
  await expect(menu.locator(":scope > nav a.mobile-nav-cta")).toHaveCount(1);
  await expect(menu.locator("details.mobile-nav-group")).toHaveCount(0);
});

test("audited public and docs routes keep horizontal overflow local", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390" && testInfo.project.name !== "360");
  for (const route of OVERFLOW_ROUTES) {
    await page.goto(route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route} document overflow`).toBeLessThanOrEqual(1);
  }
});

test("odd grids compose the final item instead of painting an empty cell", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440");
  for (const route of ["/", "/developers", "/research", "/research/notes", "/security"]) {
    await page.goto(route);
    const grids = page.locator(".input-formats, .tiles");
    const count = await grids.count();
    for (let index = 0; index < count; index += 1) {
      const grid = grids.nth(index);
      const children = grid.locator(":scope > *");
      const childCount = await children.count();
      if (childCount % 2 === 0) continue;
      const [parentBox, lastBox] = await Promise.all([grid.boundingBox(), children.last().boundingBox()]);
      expect(parentBox, `${route} parent grid`).not.toBeNull();
      expect(lastBox, `${route} final grid item`).not.toBeNull();
      expect(Math.abs((parentBox?.width ?? 0) - (lastBox?.width ?? 0)), `${route} odd final cell`).toBeLessThanOrEqual(3);
    }
  }
});

test("One-Path landing sections flow continuously without artificial viewport oceans", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440");
  await page.goto("/");
  const geometry = await page.locator('main > section[data-scene]').evaluateAll(sections => sections.map(section => {
    const rect = section.getBoundingClientRect();
    return { id: section.id, top: rect.top, bottom: rect.bottom, height: rect.height, minHeight: getComputedStyle(section).minHeight };
  }));
  expect(geometry.map(item => item.id)).toEqual(["s1", "how-it-works", "connect", "proof", "stays-current", "ready-for-ai"]);
  for (let index = 1; index < geometry.length; index += 1) {
    expect(Math.abs(geometry[index].top - geometry[index - 1].bottom), `${geometry[index - 1].id} → ${geometry[index].id}`).toBeLessThanOrEqual(2);
  }
  for (const section of geometry) {
    expect(section.height, `${section.id} collapsed`).toBeGreaterThan(180);
    expect(section.minHeight, `${section.id} still carries a viewport-height scene floor`).not.toMatch(/vh|svh|dvh/);
  }
});

test("standalone public product surfaces expose one semantic H1", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440");
  for (const route of ["/developers", "/product/compiled-world", "/product/document-understanding"]) {
    await page.goto(route);
    await expect(page.locator("h1")).toHaveCount(1);
  }
  await page.goto("/product/knowledge-compiler");
  await expect(page).toHaveURL(/\/knowledge-compiler$/);
  await expect(page.locator("h1")).toHaveCount(1);
});

test("polished public controls do not expose native spinner/select chrome", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440");
  await page.goto("/pricing");
  const numberAppearance = await page.locator('#pricing-pages').evaluate((element) => getComputedStyle(element).appearance);
  expect(numberAppearance).not.toBe("auto");

  await page.goto("/contact");
  const selectAppearances = await page.locator("select").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).appearance));
  expect(selectAppearances.length).toBeGreaterThan(0);
  expect(selectAppearances.every((appearance) => appearance !== "auto")).toBe(true);
});
