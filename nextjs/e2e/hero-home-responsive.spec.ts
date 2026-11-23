import { expect, test } from "@playwright/test";

/*
  V34 Home (WO-CI-5b): the hero's two actions are `[data-analytics="hero-primary"]` and `[data-analytics="hero-secondary"]`
  (components/v34/routes/home/home.tsx). The promise is unchanged: with the consent prompt showing, both actions are
  on the first screen, at least 44px tall, and the prompt is not on them.
*/
const HERO_ACTIONS = '[data-analytics="hero-primary"], [data-analytics="hero-secondary"]';

async function expectFirstVisitActions(page: import("@playwright/test").Page, bottomLimit: number) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // Release 2: the card appears after a 200px scroll (or 8 s); reveal it, then measure the first screen.
  await page.evaluate(() => window.scrollTo(0, 300));
  const panel = page.locator("[data-marketing-consent-panel]");
  await expect(panel).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  const actions = page.locator(HERO_ACTIONS);
  await expect(actions).toHaveCount(2);
  const card = (await panel.boundingBox())!;
  for (const action of await actions.all()) {
    await expect(action).toBeVisible();
    const rect = await action.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(bottomLimit);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    const apart = rect!.x + rect!.width <= card.x || card.x + card.width <= rect!.x || rect!.y + rect!.height <= card.y || card.y + card.height <= rect!.y;
    expect(apart, "the consent prompt is not on the action").toBe(true);
  }
}

test("first-visit desktop actions leave room below the consent-visible hero", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectFirstVisitActions(page, 876);
});

test("first-visit phone actions remain visible with the consent panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFirstVisitActions(page, 820);
});

test("reduced-motion hero actions have no pointer press transform", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const consent = page.getByRole("button", { name: "No thanks", exact: true });
  if (await consent.isVisible()) await consent.click();
  const action = page.locator('[data-analytics="hero-primary"]');
  await action.scrollIntoViewIfNeeded();
  const rect = await action.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.mouse.down();
  try {
    const style = await action.evaluate(element => ({
      active: element.matches(":active"),
      transform: getComputedStyle(element).transform,
      transition: getComputedStyle(element).transitionDuration,
    }));
    expect(style.active).toBe(true);
    expect(style.transform).toBe("none");
    // V34 Home takes the site-wide reduced-motion floor (app/tavonel.css: `transition-duration: 0.01ms !important`),
    // where Landing V2 reset its own to exactly 0s. Ten microseconds is no transition a visitor can see.
    expect(Number.parseFloat(style.transition)).toBeLessThanOrEqual(0.00001);
  } finally {
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
});
