import { expect, test } from "@playwright/test";
const FILM = '#s1 [data-source-inspection-film]';
test.describe("phone source inspection", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(!["360", "390"].includes(info.project.name), "phone composition");
    await page.goto("/");
    await expect(page.locator("header.nav")).toHaveAttribute("data-scrolled", /[01]/);
  });
  test("uses the independently framed phone poster and readable play control", async ({ page }) => {
    const film = page.locator(FILM);
    await expect(film).toBeVisible();
    expect(await film.locator("img").evaluate((image: HTMLImageElement) => image.currentSrc)).toContain("/film/source-inspection/mobile.webp");
    const play = film.getByRole("button", { name: "Play the source inspection" });
    expect((await play.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(film.locator("video")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
  test("plays the phone crop of the same inspection and discloses its scope", async ({ page }) => {
    const film = page.locator(FILM);
    await film.getByRole("button", { name: "Play the source inspection" }).click();
    const video = film.locator("video");
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(1);
    expect(await video.evaluate((node: HTMLVideoElement) => node.currentSrc)).toContain("/film/source-inspection/mobile.webm");
    const box = (await video.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await film.locator("summary").click();
    await expect(film.locator("details")).toContainText("phone recording focuses on the passage area of the same actions");
  });
  test("reduced motion stays static and failed playback restores the source poster", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/");
    const film = page.locator(FILM);
    await expect(film.locator("video")).toHaveCount(0);
    await page.route("**/film/source-inspection/mobile.webm", route => route.abort());
    await film.getByRole("button", { name: "Play the source inspection" }).click();
    await expect(film.getByRole("status")).toContainText("recording could not load");
    await expect(film.locator("picture img")).toBeVisible();
  });
});
