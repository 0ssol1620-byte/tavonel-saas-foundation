import { test, expect } from "@playwright/test";

for (const path of ["/", "/ko"]) {
  test(`${path} shares a measured outer edge and gives the film a readable width`, async ({ page }) => {
    await page.goto(path);
    const wrap = await page.locator("#hero .lv2-wrap").boundingBox();
    const mark = await page.locator("header .wordmark").boundingBox();
    const film = await page.locator("#hero .compile-film-viewport").boundingBox();
    expect(wrap && mark && film).toBeTruthy();
    expect(Math.abs(wrap!.x - mark!.x)).toBeLessThanOrEqual(1);
    const cap = page.viewportSize()!.width >= 1600 ? 1280 : 1120;
    expect(film!.width).toBeGreaterThanOrEqual(Math.min(cap, wrap!.width) - 2);
    expect(film!.x).toBeGreaterThanOrEqual(wrap!.x - 1);
    expect(film!.x + film!.width).toBeLessThanOrEqual(wrap!.x + wrap!.width + 1);
  });
}

test("every source has matching upright typography, not a substituted italic face", async ({ page }) => {
  await page.goto("/");
  const typography = await page.locator("h1 .lv2-emphasis").evaluate(element => {
    const style = getComputedStyle(element);
    const parent = getComputedStyle(element.closest("h1")!);
    return { family: style.fontFamily, parentFamily: parent.fontFamily, size: style.fontSize,
      parentSize: parent.fontSize, style: style.fontStyle, weight: style.fontWeight, parentWeight: parent.fontWeight, synthesis: style.fontSynthesis, parentSynthesis: parent.fontSynthesis };
  });
  expect(typography.family).toBe(typography.parentFamily);
  expect(typography.size).toBe(typography.parentSize);
  expect(typography.style).toBe("normal");
  expect(typography.weight).toBe(typography.parentWeight);
  expect(typography.synthesis).toBe(typography.parentSynthesis);
});
