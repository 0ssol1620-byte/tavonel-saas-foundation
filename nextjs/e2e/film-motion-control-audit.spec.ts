import { expect, test } from "@playwright/test";

/*
  film-01 / film-02 -- the control is there when the still is a preference, and it starts the film.

  The unit side (`lib/film-motion-control.test.ts`) covers the three states. This is the half a
  pure function cannot answer: that under `prefers-reduced-motion` a real button is rendered, that
  it says Play, and that pressing it actually begins playback instead of swapping one still for
  another.

  The context is built here rather than taken from a project, because `use.reducedMotion` does not
  reach `matchMedia` on this Playwright build -- `e2e/landing.spec.ts` records the same thing --
  and the whole test is about what the page reads.
*/
test("reduced motion keeps a Play control on the film, and it plays", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(
      await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    ).toBe(true);

    await page.locator("#s3").scrollIntoViewIfNeeded();
    const control = page.locator("#s3 .compile-film-motion-control");
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute("data-control", "play");
    await expect(control).toHaveAttribute("aria-label", /^Play/);
    // The still is standing in, and nothing is playing yet.
    await expect(page.locator("#s3 .compile-film-still")).toBeVisible();

    // A visitor's own request. WCAG 2.2.2 bars auto-play, not play.
    await control.click();
    const video = page.locator("#s3 video.compile-film-video");
    await expect(video).toBeVisible();
    await expect(page.locator("#s3 .compile-film-still")).toHaveCount(0);
    await expect(control).toHaveAttribute("data-control", "pause");

    // Playing, not merely mounted: the recording's own clock has to move.
    await expect
      .poll(async () => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // And it can be stopped again, which is the requirement the control exists for.
    await control.click();
    await expect(control).toHaveAttribute("data-control", "resume");
    await expect(control).toHaveAttribute("aria-label", /^Resume/);
    await expect(page.locator("#s3 .compile-film-still")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the control is on the frame at every width, phone included", async ({ browser }) => {
  for (const width of [390, 1280] as const) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 } });
    const page = await context.newPage();
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.locator("#s3").scrollIntoViewIfNeeded();
      const control = page.locator("#s3 .compile-film-motion-control");
      await expect(control, `${width}px has no motion control`).toBeVisible();
      const box = await control.boundingBox();
      expect(box, `${width}px control has no box`).not.toBeNull();
      // The same 44px floor every other control on the landing page is held to.
      expect(box!.width, `${width}px control is ${box!.width}px wide`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${width}px control is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
    } finally {
      await context.close();
    }
  }
});
