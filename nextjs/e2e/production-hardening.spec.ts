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
  /*
    V34 shell (WO-CI-5b): below 1001px the bar's items give way to a modal <dialog> drawer opened by "Open navigation"
    (components/v34/shell/mobile-drawer.tsx). What this case asserts is unchanged: every section the bar offers is
    reachable on a phone -- the drawer's primary list is the bar's own list, read off the page rather than spelled twice --
    and the groups behind "More" open in place.
  */
  const bar = page.locator('[data-v34-header] nav[aria-label="Primary"] a');
  const offered = await bar.evaluateAll(links => links.map(link => ({ text: link.textContent?.trim() ?? "", href: link.getAttribute("href") })));
  expect(offered.length, "the bar offers its primary destinations").toBeGreaterThanOrEqual(5);
  await expect(page.locator('[data-v34-header] nav[aria-label="Primary"]')).toBeHidden();
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Site navigation" });
  await expect(drawer).toBeVisible();
  const direct = drawer.locator('nav[aria-label="Site"] > ul a');
  await expect(direct).toHaveCount(offered.length);
  expect(await direct.evaluateAll(links => links.map(link => ({ text: link.textContent?.trim() ?? "", href: link.getAttribute("href") })))).toEqual(offered);
  expect(offered.map(item => item.href)).toContain("/pricing");
  // The groups behind More open in place: a group's links are hidden until its summary is pressed.
  const groups = drawer.locator('nav[aria-label="Site"] details');
  expect(await groups.count(), "the drawer carries the More groups").toBeGreaterThan(0);
  const first = groups.first();
  await expect(first.locator("ul a").first()).toBeHidden();
  await first.locator("summary").click();
  await expect(first.locator("ul a").first()).toBeVisible();
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
