import { expect, test, type Locator } from "@playwright/test";

async function visibleTargetHeights(locator: Locator) {
  return locator.evaluateAll(elements => elements.flatMap(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
    return [{ text: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().replaceAll(/\s+/g, " ").slice(0, 100), height: rect.height }];
  }));
}

test("the mobile Explore controls keep a 44px touch floor across World, Ask and technical details", async ({ page }, testInfo) => {
  testInfo.skip(testInfo.project.name !== "390", "mobile touch geometry is asserted at the 390px product viewport");
  await page.goto("/explore?act=world");

  const headerTargets = await visibleTargetHeights(page.locator("header a, header button"));
  expect(headerTargets.length).toBeGreaterThanOrEqual(3);
  for (const target of headerTargets) expect(target.height, target.text).toBeGreaterThanOrEqual(44);

  const parallel = page.locator('details[class*="parallelList"]');
  await expect(parallel).toBeVisible();
  const worldTargets = await visibleTargetHeights(parallel.locator("summary, button"));
  expect(worldTargets.length).toBeGreaterThan(1);
  for (const target of worldTargets) expect(target.height, target.text).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: /Ask this World/i }).click();
  const ask = page.getByRole("dialog", { name: /Ask/i });
  await expect(ask).toBeVisible();
  for (const target of await visibleTargetHeights(ask.locator("button"))) {
    expect(target.height, target.text).toBeGreaterThanOrEqual(44);
  }
  await ask.getByRole("button", { name: /Close Ask/i }).click();

  await page.getByRole("button", { name: /Technical details/i }).click();
  const drawer = page.getByRole("dialog", { name: /Technical details/i });
  await expect(drawer).toBeVisible();
  const close = drawer.getByRole("button", { name: /Close technical details/i });
  expect((await close.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});
