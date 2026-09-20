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
  /*
    Five, not three. Landing V2's `CUSTOMER_NAV` (contract D2) is a five-destination bar, and the
    sheet renders that array -- so the count and the labels are read off the same source of truth
    the header uses rather than being a second spelling of it. What this case asserts is unchanged:
    every section the bar offers is reachable on a phone.
  */
  const direct = menu.locator(":scope > nav a.mobile-nav-direct");
  await expect(direct).toHaveCount(5);
  await expect(direct).toHaveText(["Product", "How it works", "Resources", "Docs", "Pricing"]);
  // BQ-059: the header keeps the action at every width; the sheet is the sections and Sign in.
  await expect(menu.locator(":scope > nav a.mobile-nav-cta")).toHaveCount(0);
  await expect(page.locator("header .nav-actions .btn")).toHaveCount(1);
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

test("landing scenes flow continuously without artificial viewport oceans", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440");
  await page.goto("/");
  const geometry = await page.locator('main > section[data-scene]').evaluateAll(sections => sections.map(section => {
    const rect = section.getBoundingClientRect();
    return { id: section.id, top: rect.top, bottom: rect.bottom, height: rect.height, minHeight: getComputedStyle(section).minHeight };
  }));
  /*
    Landing V2, 2026-09-20: six scenes. Two of the three rules are unchanged -- the
    scenes butt up against each other, and none of them is collapsed.

    The third is restated rather than kept verbatim. It barred a viewport-height floor outright,
    because the old landing used one to manufacture emptiness. V2 floors every scene on purpose
    (`.lv2-scene--full` at `min(900px, 100vh)`, `.lv2-scene--proof` at 80vh) so that a scene is a
    held frame rather than a paragraph that happens to be tall -- so the assertion becomes the
    thing the old rule was actually protecting: no scene may floor at more than one viewport, and
    no scene may be taller than two. An ocean is still a failure; a composed frame is not one.
  */
  expect(geometry.map(item => item.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
  for (let index = 1; index < geometry.length; index += 1) {
    expect(Math.abs(geometry[index].top - geometry[index - 1].bottom), `${geometry[index - 1].id} → ${geometry[index].id}`).toBeLessThanOrEqual(2);
  }
  const viewport = page.viewportSize()!.height;
  for (const section of geometry) {
    expect(section.height, `${section.id} collapsed`).toBeGreaterThan(180);
    expect(section.height, `${section.id} is an ocean, not a scene`).toBeLessThanOrEqual(viewport * 2);
    const floor = Number.parseFloat(section.minHeight);
    if (Number.isFinite(floor)) {
      expect(floor, `${section.id} floors past one viewport`).toBeLessThanOrEqual(viewport + 1);
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
