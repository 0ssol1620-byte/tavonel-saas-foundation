import { test, expect } from "@playwright/test";

async function heroAt(browser: import("@playwright/test").Browser, width: number, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, reducedMotion });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const hero = page.getByTestId("one-path-hero-film");
  await expect(hero).toBeVisible();
  return { context, page, hero };
}

test("the approved Hero V2 stays on the encoded-film path across the former canvas breakpoint", async ({ browser }) => {
  for (const width of [899, 901] as const) {
    const { context, hero } = await heroAt(browser, width);
    try {
      const sequence = hero.locator(".compile-film-sequence");
      await expect(sequence).toHaveAttribute("data-film-renderer", "video-fallback");
      await expect(hero.locator(".compile-film-live canvas")).toHaveCount(0);
      const video = hero.locator(".compile-film-video");
      await expect(video).toBeVisible();
      await expect(video.locator("source")).toHaveCount(1);
      await expect(video.locator("source")).toHaveAttribute("src", "/film/compile-cut.mp4");
      await expect(video).toHaveAttribute("poster", "/film/poster-1.webp");
    } finally {
      await context.close();
    }
  }
});

test("reduced motion gives the first screen its value, actions and explicit Play control immediately", async ({ browser }) => {
  const { context, page, hero } = await heroAt(browser, 1280, "reduce");
  try {
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText("Bring your knowledge.");
    await expect(heading).toContainText("ready for AI.");
    const actions = page.locator("#s1 .one-path-actions a");
    await expect(actions).toHaveCount(2);
    for (const action of await actions.all()) await expect(action).toBeVisible();
    await expect(hero.locator(".compile-film-still")).toBeVisible();
    await expect(hero.locator(".compile-film-video")).toHaveCount(0);
    await expect(hero.getByRole("button", { name: "Play the compilation film" })).toBeVisible();
  } finally {
    await context.close();
  }
});
