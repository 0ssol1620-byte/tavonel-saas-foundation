import { expect, test } from "@playwright/test";

const FILMS = ["/film/compile-cut.mp4", "/film/compile-cut-2.mp4", "/film/compile-cut-3.mp4", "/film/compile-cut-4.mp4"];

async function dismissConsent(page: import("@playwright/test").Page) {
  // Release 2: the consent card appears after a 200px scroll (or 8 s), not on the first paint.
  await page.evaluate(() => window.scrollTo(0, 300));
  const panel = page.getByRole("region", { name: "Optional analytics", exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(panel).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
}

test("the title leads directly into four selectable and playing demo recordings", async ({ page }, testInfo) => {
  // Four cold decoders share one case; preserve the per-film progress assertions.
  test.setTimeout(60_000);
  await page.goto("/");
  await dismissConsent(page);
  const film = page.locator('#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]');
  await expect(film).toHaveCount(1);
  await expect(film).toBeVisible();
  await expect(page.locator('#s1 [data-source-inspection-film]')).toHaveCount(0);
  await expect(page.locator('#s2 [data-testid="landing-hero-film"]')).toHaveCount(0);
  // FINAL-SPEC 2026-10-26 D-9: the disclosure's wording (S class: the notice stays, its words are a design choice).
  await expect(film.locator("figcaption")).toHaveText("Illustrative demo · not customer results.");
  const sequence = film.locator(".compile-film-sequence");
  // FINAL-SPEC 2026-10-26 §2.1: Home's player state is Focus at every width -- below 768px the source pane,
  // 768-899 the pan surface, from 900 the desktop's 2x reading crop (`data-wide-view`).
  await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
  // Release 3: a desktop opens on the 2x reading crop and offers the whole frame.
  // This supersedes handoff §5.1-4 / brief §2 "Fit default" on desktop only: decision R3-D1 under the
  // founder's 2026-10-03 delegated authority, founder veto open (RESUME-20261015-LEDGER.md).
  await expect(sequence).toHaveAttribute("data-wide-view", "crop");
  // Fix round 3 (M1): one "Focus details" toggle per width, pressed exactly while the focused view
  // shows -- the desktop crop, and on a phone the pane it now opens on.
  const viewToggle = film.getByRole("button", { name: "Focus details", exact: true });
  await expect(viewToggle).toHaveCount(1);
  await expect(viewToggle).toHaveAttribute("aria-pressed", "true");
  await expect(film.getByRole("button", { name: "Fit full frame", exact: true })).toHaveCount(0);
  const tabs = film.getByRole("tab");
  await expect(tabs).toHaveText(["Files", "Organize", "Updates", "Use with AI"]);
  const playback = [];
  for (let index = 0; index < FILMS.length; index++) {
    await tabs.nth(index).click();
    await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
    await expect(sequence).toHaveAttribute("data-video-primary-src", FILMS[index]);
    const video = sequence.locator("video");
    await expect(video).toHaveCount(1);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1);
    const first = await video.evaluate((v: HTMLVideoElement) => ({ time: v.currentTime, src: v.currentSrc, paused: v.paused, ready: v.readyState }));
    expect(first.paused).toBe(false);
    expect(first.ready).toBeGreaterThanOrEqual(3);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(first.time + 0.5);
    playback.push({ stage: index + 1, expectedPrimary: FILMS[index], ...first });
    await page.screenshot({ path: testInfo.outputPath(`stage-${index + 1}.png`) });
  }
  await testInfo.attach("actual-playback", { body: JSON.stringify(playback, null, 2), contentType: "application/json" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (testInfo.project.name === "390") {
    const focus = film.getByRole("button", { name: "Focus details", exact: true });
    // Fix round 3 (M1): the name stays; the pressed state follows the view on screen (the pane, then the whole frame).
    await expect(focus).toHaveAttribute("aria-pressed", "true");
    expect((await focus.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath("phone-focus-details.png") });
    await focus.click();
    await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
    await expect(focus).toHaveAttribute("aria-pressed", "false");
    await focus.click();
    await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
    await expect(focus).toHaveAttribute("aria-pressed", "true");
  }
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
});

test("reduced motion keeps four stages static until explicitly played", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await dismissConsent(page);
  const film = page.locator('#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]');
  await expect(film.getByRole("tab")).toHaveCount(4);
  const play = film.getByRole("button", { name: "Play the compilation film", exact: true });
  await expect(play).toBeVisible();
  await expect(film.locator("video")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("reduced-static.png") });
  await play.click();
  await expect.poll(() => film.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1);
  await expect(film.getByRole("button", { name: "Pause the compilation film", exact: true })).toBeVisible();
});
