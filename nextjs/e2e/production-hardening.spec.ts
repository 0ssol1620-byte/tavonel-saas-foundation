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

test("landing scenes flow continuously without artificial viewport oceans", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440");
  await page.goto("/");
  const geometry = await page.locator('main > section[data-scene], main > [data-home-measurement], main > [data-home-measures], main > #walkthrough, main > [data-home-reader-guide]').evaluateAll(sections => sections.map(section => {
    const rect = section.getBoundingClientRect();
    return { id: section.id || (section.hasAttribute("data-home-measurement") ? "measurement" : section.hasAttribute("data-home-measures") ? "measures" : "reader-guide"), top: rect.top, bottom: rect.bottom, height: rect.height, minHeight: getComputedStyle(section).minHeight };
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
  /*
    Release 3 (2026-10-16): the receipted measurement band (`section[data-home-measures]`, brief
    move 7) sits between s1 and s2. Measured on build sRc4B7jgCEvbjOa4NSbYo at 1440, s2 started
    one band height (469px EN) below s1's bottom because the band was not in this list. It is in
    the list now, so the same three rules apply to it: it butts against s1 and s2, it is not
    collapsed, and it is not an ocean.
  */
  // FINAL-SPEC 2026-10-26 §11 F-1: the reader guide (FAQ) leaves Home, so s5 butts against s6.
  // Founder 2026-11-10: the recorded walkthrough left s1 for its own band after the measures, under the same three rules.
  expect(geometry.map(item => item.id)).toEqual(["s1", "measures", "walkthrough", "s2", "s3", "s4", "s5", "s6"]);
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
