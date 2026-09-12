import { expect, test } from "@playwright/test";

test("the first screen offers a real published sample without promising open customer intake", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Give your AI knowledge you can check.");
  await expect(page.locator(".hero .lede")).toContainText("Explore a published sample.");
  const panel = page.locator('.home-evidence-preview[aria-label="Published sample and its source"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator(".solution-proof-sample")).toHaveCount(1);
  await expect(panel).toContainText("Apple SEC corpus");
  await expect(panel).toContainText("Compiled claim");
  await expect(panel.getByRole("link", { name: "Inspect the evidence" })).toHaveAttribute("href", "/explore");
  await expect(page.locator(".hero .tiles .tile")).toHaveCount(3);
  await expect(page.locator(".hero .tiles")).toContainText("AI APPLICATIONS");
});

test("the source panel and readable headline fit the viewport", async ({ page }) => {
  await page.goto("/");
  await page.locator(".home-evidence-preview").scrollIntoViewIfNeeded();
  const measurements = await page.evaluate(() => {
    const width = window.innerWidth;
    const selectors = [".hero h1", ".hero .lede", ".home-evidence-preview", ".hero .tiles"];
    return { width, scrollWidth: document.documentElement.scrollWidth, elements: selectors.map(selector => {
      const element = document.querySelector(selector)!;
      const rect = element.getBoundingClientRect();
      return {selector, left:rect.left, right:rect.right, width:rect.width, fontSize:parseFloat(getComputedStyle(element).fontSize)};
    })};
  });
  expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.width + 1);
  for (const element of measurements.elements) {
    expect(element.left, element.selector).toBeGreaterThanOrEqual(-1);
    expect(element.right, element.selector).toBeLessThanOrEqual(measurements.width + 1);
    expect(element.width, element.selector).toBeGreaterThan(200);
  }
  expect(measurements.elements[0].fontSize).toBeGreaterThanOrEqual(36);
  expect(measurements.elements[1].fontSize).toBeGreaterThanOrEqual(17);
});

test("the displayed proof leads to the actual Explore surface", async ({ page }) => {
  await page.goto("/");
  await page.locator(".home-evidence-preview").getByRole("link", { name: "Inspect the evidence" }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.locator("main")).toBeVisible();
});

test("Korean visitors can inspect the same sample before making an inquiry", async ({ page }) => {
  await page.goto("/ko");
  await expect(page.locator("h1")).toContainText("AI가 쓰는 지식,");
  await expect(page.locator("h1")).toContainText("근거까지 확인하세요.");
  await expect(page.locator(".actions .btn").first()).toHaveText("공개 샘플 열기");
  await expect(page.locator(".ko-published-proof .solution-proof-sample")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
