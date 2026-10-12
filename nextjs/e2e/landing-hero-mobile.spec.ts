import { expect, test, type Page } from "@playwright/test";

const PHONE_PROJECTS = new Set(["360", "390"]);

/*
  The phone film contract -- an explicit choice between the full frame and magnified detail, all
  four cuts, a keyboard-scrollable focused viewport, and a poster under reduced motion until the
  visitor plays -- belongs to the film, not to the landmark it sits in.

  Source-led Home (2026-10-08): the film is an optional, illustrative walkthrough, closed at the
  foot of Scene 02 and mounted only once opened. Home opens a phone on the whole frame
  (`LANDING_MOBILE_FILM_VIEW = "fit"`); "Focus details" is one tap away and magnifies the cut.
*/
const DISCLOSURE = '#s2 [data-testid="landing-film-disclosure"]';
const FILM_SCENE = `${DISCLOSURE} .compile-film-sequence`;

/* The player mounts from React state, so the disclosure is opened only once the page is live. */
async function openWalkthrough(page: Page) {
  await expect(page.locator("header.nav")).toHaveAttribute("data-scrolled", /[01]/);
  await page.locator(`${DISCLOSURE} > summary`).click();
  await expect(page.locator(FILM_SCENE)).toHaveCount(1);
}

test.describe("landing film mobile inspection", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!PHONE_PROJECTS.has(testInfo.project.name), "the focused film is a phone layout");
    await page.goto("/");
  });

  test("opens on the full frame and keeps an explicit route to magnified detail", async ({ page }) => {
    await openWalkthrough(page);
    const sequence = page.locator(FILM_SCENE);
    const viewport = sequence.locator(".compile-film-viewport");
    const media = viewport.locator(".compile-film-video, .compile-film-still").first();
    const focus = sequence.getByRole("button", { name: "Focus details" });

    await expect(sequence).toHaveAttribute("data-narrow", "1");
    await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
    await expect(focus).toBeVisible();
    await expect(focus).toHaveAttribute("aria-controls", await viewport.getAttribute("id") ?? "");

    const fitted = await Promise.all([viewport.boundingBox(), media.boundingBox()]);
    expect(fitted[0]).not.toBeNull();
    expect(fitted[1]).not.toBeNull();
    // The viewport's one-pixel border sits outside the media content box on both sides.
    expect(Math.abs(fitted[1]!.width - fitted[0]!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(fitted[1]!.height - fitted[0]!.height)).toBeLessThanOrEqual(2);

    await focus.click();
    await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
    const fit = sequence.getByRole("button", { name: "Fit full frame" });
    await expect(fit).toBeVisible();

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
  });

  test("preserves all four film tabs and keeps the focused viewport keyboard-scrollable", async ({ page }) => {
    await openWalkthrough(page);
    const sequence = page.locator(FILM_SCENE);
    const viewport = sequence.locator(".compile-film-viewport");
    const tabs = sequence.getByRole("tab");

    await expect(sequence).toHaveAttribute("data-narrow", "1");
    await expect(tabs).toHaveCount(4);
    await sequence.getByRole("button", { name: "Focus details" }).click();
    await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
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

  test("keeps reduced motion on the poster until the visitor explicitly plays", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await openWalkthrough(page);
    const sequence = page.locator(FILM_SCENE);

    await expect(sequence).toHaveAttribute("data-narrow", "1");
    await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
    await expect(sequence.locator(".compile-film-still")).toBeVisible();
    await expect(sequence.locator(".compile-film-video")).toHaveCount(0);
    await expect(sequence.getByRole("button", { name: "Play the compilation film" })).toBeVisible();
    await expect(sequence.getByRole("button", { name: "Focus details" })).toBeVisible();
  });
});
