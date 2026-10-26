import { expect, test } from "@playwright/test";
const FILM = '#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]';
test.describe("phone four-stage film", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(!["360", "390"].includes(info.project.name), "phone composition");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("header.nav")).toHaveAttribute("data-scrolled", /[01]/);
  });
  test("opens on the locked stage-1 pane poster with readable stage and play controls", async ({ page }) => {
    const film = page.locator(FILM);
    await expect(film).toBeVisible();
    // FINAL-SPEC 2026-10-26 §2.1 (acceptance 23, 25): a phone opens on one source pane, the stage-1 pane's own 684x855
    // file (a crop of the locked 2880px poster, lib/locked-film-assets.json), as AVIF where the browser decodes it and as
    // the WebP fallback where it does not, in a 4:5 frame 16px wider than the column.
    expect(await film.locator("img.compile-film-still").evaluate((image: HTMLImageElement) => new URL(image.currentSrc).pathname))
      .toMatch(/^\/film\/poster-1-t8\.16-pane1-684x855\.(avif|webp)$/);
    const frame = (await film.locator(".compile-film-viewport").boundingBox())!;
    const column = (await page.locator("#s1 .lv2-wrap").boundingBox())!;
    expect(Math.abs(frame.width / frame.height - 0.8), "a 4:5 pane").toBeLessThan(0.01);
    expect(Math.abs(frame.width - (column.width + 16)), "the column plus 16px").toBeLessThanOrEqual(1);
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expect(film.getByRole("tab")).toHaveText(["Files", "Organize", "Updates", "Use with AI"]);
    const play = film.getByRole("button", { name: "Play the compilation film", exact: true });
    expect((await play.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(film.locator("video")).toHaveCount(0);
    await expect(film.locator(".compile-film-sequence")).toHaveAttribute("data-mobile-view", "focus");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
  test("plays the approved recording and supports Fit, Focus and keyboard stage selection", async ({ page }) => {
    const film = page.locator(FILM);
    await film.getByRole("button", { name: "Play the compilation film", exact: true }).click();
    const video = film.locator("video");
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(1);
    expect(await video.evaluate((node: HTMLVideoElement) => node.currentSrc)).toContain("/film/compile-cut.mp4");
    // The pane draws the 2880px cut at 2880/w of its width (w = the stage's rect width) and clips it (FINAL-SPEC §2.1), so what a reader sees is the
    // frame: it, not the media's untransformed box, is what stays inside the phone's width.
    const box = (await film.locator(".compile-film-viewport").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await film.locator(".compile-film-viewport").evaluate(node => getComputedStyle(node).overflowX)).toBe("clip");
    await expect(film.locator("figcaption")).toHaveText("Illustrative demo · not customer results.");
    const focus = film.getByRole("button", { name: "Focus details", exact: true });
    const toggle = (await focus.boundingBox())!;
    expect(toggle.height, "44px touch target (acceptance 28)").toBeGreaterThanOrEqual(44);
    expect(toggle.width, "44px touch target (acceptance 28)").toBeGreaterThanOrEqual(44);
    // Fix round 3 (M1): one toggle, pressed while the pane shows; a press opens the whole frame and a second returns.
    await expect(film.locator(".compile-film-sequence")).toHaveAttribute("data-mobile-view", "focus");
    await expect(focus).toHaveAttribute("aria-pressed", "true");
    await focus.click();
    await expect(film.locator(".compile-film-sequence")).toHaveAttribute("data-mobile-view", "fit");
    await expect(focus).toHaveAttribute("aria-pressed", "false");
    await focus.click();
    await expect(film.locator(".compile-film-sequence")).toHaveAttribute("data-mobile-view", "focus");
    await expect(focus).toHaveAttribute("aria-pressed", "true");
    const tabs = film.getByRole("tab");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.last()).toBeFocused();
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  });
  test("reduced motion stays static and failed primary and fallback playback restore the locked poster", async ({ page }) => {
    const film = page.locator(FILM);
    await expect(film.locator("video")).toHaveCount(0);
    const failed: string[] = [];
    await page.route("**/film/compile-cut*.mp4", route => { failed.push(route.request().url()); return route.abort(); });
    await film.getByRole("button", { name: "Play the compilation film", exact: true }).click();
    // Home prints no caption row (FINAL-SPEC D-7), so the film says it failed in its own status line, never silently.
    await expect(film.locator('.compile-film-inline-error[role="status"]')).toContainText("This browser could not play the film");
    await expect(film.locator("img")).toBeVisible();
    expect(failed.some(url => url.endsWith("/film/compile-cut.mp4"))).toBe(true);
    expect(failed.some(url => url.endsWith("/film/compile-cut-hq-1440.mp4"))).toBe(true);
    await expect(film.getByRole("tab")).toHaveCount(4);
  });
});
