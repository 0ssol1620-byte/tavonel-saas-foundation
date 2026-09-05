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
  await menu.locator("summary").click();
  await expect(menu.getByRole("link", { name: "Pricing" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Developers" })).toBeVisible();
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

test("short landing scenes no longer create viewport oceans", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440");
  await page.goto("/");
  const geometry = await page.evaluate(() => {
    const first = document.querySelector<HTMLElement>("#s1 .shell");
    const second = document.querySelector<HTMLElement>("#s2 .shell");
    const fourth = document.querySelector<HTMLElement>("#s4");
    const fifth = document.querySelector<HTMLElement>("#s5");
    if (!first || !second || !fourth || !fifth) return null;
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    return {
      gap: b.top - a.bottom,
      fourthHeight: fourth.getBoundingClientRect().height,
      fifthHeight: fifth.getBoundingClientRect().height,
      viewport: window.innerHeight,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.gap).toBeLessThan(300);
  expect(geometry!.fourthHeight).toBeLessThan(geometry!.viewport);
  expect(geometry!.fifthHeight).toBeLessThan(geometry!.viewport);
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
