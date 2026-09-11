/**
 * V04 — the low-end and reduced-motion path, pinned at the boundary it is specified at.
 *
 * `mobile-landing.spec.ts` already asserts the video fallback at 360, 390 and 768 and the still
 * under reduced motion, and this file does not repeat that. Two things were missing.
 *
 * The breakpoint itself. The rule the measurement produced is "the canvas is only mounted from
 * 900px up" (docs/audit/mobile/2026-09-05), and every existing assertion sits far from 900 --
 * so a regression that moved the line to 600 or 1200 would leave the whole suite green. This
 * spec drives its own contexts at 899 and 901 and asserts the change happens between them.
 *
 * Reduced motion and the first screen. The existing reduced-motion tests scroll to the film and
 * assert what it shows. What nobody checked is the thing the audit actually asked: that with
 * motion removed, the page's words and its actions are usable *immediately* -- no scroll, no
 * wait for an animation to reveal them.
 *
 * There is no WebGL path to test: the films use `canvas.getContext("2d")` and neither `three`
 * nor `@react-three/fiber` is a dependency of this package. The CLAUDE.md decision of
 * 2026-08-09 to reinstate R3F has not reached this code, so a "WebGL unavailable" assertion here
 * would be testing an absence.
 */

import { test, expect } from "@playwright/test";

const SEQUENCE = "#s3 .compile-film-sequence";

async function openFilm(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator("#s3").scrollIntoViewIfNeeded();
  await page.locator(SEQUENCE).waitFor({ state: "visible" });
  await page.waitForTimeout(900);
}

test("the live canvas mounts above 900px and not below it", async ({ browser }) => {
  test.setTimeout(90_000);
  const readRenderer = async (width: number) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    try {
      await openFilm(page);
      const video = page.locator("#s3 .compile-film-video");
      const videos = await video.count();
      return {
        renderer: await page.locator(SEQUENCE).getAttribute("data-film-renderer"),
        canvases: await page.locator("#s3 .compile-film-live canvas").count(),
        videos,
        // Read only when there is one. A locator that matches nothing waits for it to appear,
        // which above the breakpoint is a wait that never ends.
        poster: videos === 1 ? await video.getAttribute("poster") : null,
      };
    } finally {
      await context.close();
    }
  };

  const below = await readRenderer(899);
  expect(below.renderer, "899px must not mount the live canvas").toBe("video-fallback");
  expect(below.canvases).toBe(0);
  // Fail closed: without the canvas there has to be something in the frame.
  expect(below.videos, "899px has neither canvas nor video").toBe(1);
  expect(below.poster, "the fallback video carries no poster").toBeTruthy();

  const above = await readRenderer(901);
  expect(above.renderer, "901px is above the measured floor and should run the canvas").toBe("live-canvas");
  expect(above.canvases).toBe(1);
});

test("reduced motion gives the first screen its words and its actions with no wait", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // The preference has to be the one the page reads, not the one the config declares --
    // landing.spec.ts records that the project's `use.reducedMotion` does not reach matchMedia.
    expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

    // No scroll, no settle: what a visitor has on arrival.
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: 5_000 });
    await expect(heading).toContainText("Your AI needs more than searchable files.");

    const explore = page.locator('main a[href="/explore"]').first();
    await expect(explore).toBeInViewport({ timeout: 5_000 });
    // Both hero actions, whatever the commercial posture calls the second one.
    const actions = page.locator("main .actions a");
    expect(await actions.count()).toBeGreaterThanOrEqual(2);
    for (const action of await actions.all()) {
      await expect(action).toBeVisible();
      const opacity = await action.evaluate(element => Number(getComputedStyle(element).opacity));
      expect(opacity, "an action is waiting for an animation that reduced motion removed").toBeGreaterThan(0.5);
    }

    // Motion removed, content kept: the film's still stands in for the canvas.
    await page.locator("#s3").scrollIntoViewIfNeeded();
    await expect(page.locator("#s3 .compile-film-still")).toBeVisible();
    await expect(page.locator("#s3 .compile-film-live canvas")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
