import { test, expect } from "@playwright/test";

/*
  Gap #1, 2026-09-22: the film explains how it compiles, from Scene 02.

  Both halves of this contract are unchanged and both are still asserted -- the scenes share one
  measured outer edge with the wordmark, and the film fills that edge up to its readable cap. What
  moved is which scene the film is in, so it is measured against Scene 02's wrap now, and the edge
  assertion is made on BOTH wraps instead of on the hero's alone. That is a wider check than the
  one it replaces, not a narrower one: a Scene 02 that had drifted off the shared edge was
  invisible to the old version of this test.
*/
for (const path of ["/", "/ko"]) {
  test(`${path} shares a measured outer edge and gives the film a readable width`, async ({ page }) => {
    await page.goto(path);
    const wrap = await page.locator("#s1 .lv2-wrap").boundingBox();
    const filmWrap = await page.locator("#s2 .lv2-wrap").boundingBox();
    const mark = await page.locator("header .wordmark").boundingBox();
    const film = await page.locator("#s2 .compile-film-viewport").boundingBox();
    expect(wrap && filmWrap && mark && film).toBeTruthy();
    expect(Math.abs(wrap!.x - mark!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(filmWrap!.x - mark!.x)).toBeLessThanOrEqual(1);
    const cap = page.viewportSize()!.width >= 1600 ? 1280 : 1120;
    expect(film!.width).toBeGreaterThanOrEqual(Math.min(cap, filmWrap!.width) - 2);
    expect(film!.x).toBeGreaterThanOrEqual(filmWrap!.x - 1);
    expect(film!.x + film!.width).toBeLessThanOrEqual(filmWrap!.x + filmWrap!.width + 1);
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

test("footer labels use their own cells without clipped or escaping text", async ({ page }) => {
  await page.goto("/product");
  await page.locator("footer.site").scrollIntoViewIfNeeded();
  const violations = await page.locator("footer.site .site-footer-groups a").evaluateAll(links =>
    links.flatMap(link => {
      const box = link.getBoundingClientRect();
      return link.scrollWidth > link.clientWidth + 1 || box.height < 44
        ? [{ text: link.textContent, scroll: link.scrollWidth, width: link.clientWidth, height: box.height }] : [];
    }));
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('footer.site a[href="/subprocessors"]')).toBeVisible();
});

test("the first developer request remains keyboard reachable on a narrow screen", async ({ page }) => {
  await page.goto("/developers");
  const sample = page.getByRole("region", { name: "First API request example" });
  await expect(sample).toHaveAttribute("tabindex", "0");
  await sample.focus();
  await expect(sample).toBeFocused();
  await expect(sample.locator("code")).not.toHaveText("");
});
