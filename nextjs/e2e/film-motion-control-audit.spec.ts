import { expect, test } from "@playwright/test";

test("reduced motion keeps an explicit Play control on the Hero V2 film, and it plays", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const hero = page.getByTestId("one-path-hero-film");
    const control = hero.locator(".compile-film-motion-control");
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute("data-control", "play");
    await expect(hero.locator(".compile-film-still")).toBeVisible();

    await control.click();
    const video = hero.locator("video.compile-film-video");
    await expect(video).toBeVisible();
    await expect(hero.locator(".compile-film-still")).toHaveCount(0);
    await expect(control).toHaveAttribute("data-control", "pause");
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 15_000 }).toBeGreaterThan(0);

    await control.click();
    await expect(control).toHaveAttribute("data-control", "resume");
    await expect(hero.locator(".compile-film-still")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the Hero V2 motion control remains a 44px target on phone and desktop", async ({ browser }) => {
  for (const width of [390, 1280] as const) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 } });
    const page = await context.newPage();
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const control = page.getByTestId("one-path-hero-film").locator(".compile-film-motion-control");
      await expect(control, `${width}px has no motion control`).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    } finally {
      await context.close();
    }
  }
});
