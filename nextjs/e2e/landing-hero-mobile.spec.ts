import { expect, test } from "@playwright/test";

const PHONE_PROJECTS = new Set(["360", "390"]);

/*
  Gap #1, 2026-09-22: the film moved from the hero into Scene 02, "How it compiles".

  The phone film contract -- starts magnified, keeps an
  explicit route back to the full frame, keeps all four cuts, stays keyboard-scrollable, and holds
  a poster under reduced motion until the visitor plays -- belongs to the film, not to the landmark
  it sits in. The landing now places the four-cut selector in a native disclosure, so this test
  opens it before exercising the tabs. The hero's own phone behaviour is asserted in `e2e/evidence-first.spec.ts` and
  `e2e/landing-v2.spec.ts`.
*/
const FILM_SCENE = "#s2 .compile-film-sequence";

test.describe("landing film mobile inspection", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!PHONE_PROJECTS.has(testInfo.project.name), "the focused film is a phone layout");
    await page.goto("/");
  });

  test("starts magnified and keeps an explicit route back to the full frame", async ({ page }) => {
    const sequence = page.locator(FILM_SCENE);
    const viewport = sequence.locator(".compile-film-viewport");
    const media = viewport.locator(".compile-film-video, .compile-film-still").first();
    const fit = page.getByRole("button", { name: "Fit full frame" });

    await expect(sequence).toHaveAttribute("data-narrow", "1");
    await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
    await expect(fit).toBeVisible();
    await expect(fit).toHaveAttribute("aria-controls", await viewport.getAttribute("id") ?? "");

    const focused = await Promise.all([viewport.boundingBox(), media.boundingBox()]);
    expect(focused[0]).not.toBeNull();
    expect(focused[1]).not.toBeNull();
    expect(focused[1]!.width).toBeGreaterThanOrEqual(1119);
    expect(focused[1]!.width / focused[0]!.width).toBeGreaterThan(2.8);
    const scroll = await viewport.evaluate(node => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      scrollWidth: node.scrollWidth,
    }));
    expect(scroll.scrollWidth).toBeGreaterThanOrEqual(1119);
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    await fit.click();
    await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
    await expect(page.getByRole("button", { name: "Focus details" })).toBeVisible();

    const fitted = await Promise.all([viewport.boundingBox(), media.boundingBox()]);
    // The viewport's one-pixel border sits outside the media content box on both sides.
    expect(Math.abs(fitted[1]!.width - fitted[0]!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(fitted[1]!.height - fitted[0]!.height)).toBeLessThanOrEqual(2);
  });

  test("preserves all four film tabs and keeps the focused viewport keyboard-scrollable", async ({ page }) => {
    const sequence = page.locator(FILM_SCENE);
    const viewport = sequence.locator(".compile-film-viewport");
    const tabs = sequence.getByRole("tab");

    await expect(sequence).toHaveAttribute("data-narrow", "1");
    await sequence.locator(".compile-film-stage-disclosure summary").click();
    await expect(tabs).toHaveCount(4);
    await tabs.nth(2).click();
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(sequence).toHaveAttribute("data-video-primary-src", "/film/compile-cut-3.mp4");

    await viewport.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);

    await tabs.nth(1).click();
    await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "1");
    await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(200);
  });

  test("keeps reduced motion on the focused poster until the visitor explicitly plays", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const sequence = page.locator(FILM_SCENE);

    await expect(sequence).toHaveAttribute("data-narrow", "1");
    await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
    await expect(sequence.locator(".compile-film-still")).toBeVisible();
    await expect(sequence.locator(".compile-film-video")).toHaveCount(0);
    await expect(sequence.getByRole("button", { name: "Play the compilation film" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fit full frame" })).toBeVisible();
  });
});
