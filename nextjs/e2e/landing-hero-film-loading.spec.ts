import { expect, test } from "@playwright/test";

const LOCALES = [
  { path: "/", language: "English", summary: "Watch the illustrative product walkthrough" },
  { path: "/ko", language: "Korean", summary: "예시 제품 흐름 영상 보기" },
] as const;
const MOTION_PREFERENCES = [
  { preference: "reduce" as const, name: "reduced motion" },
  { preference: "no-preference" as const, name: "motion allowed" },
] as const;

const resourceKey = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

for (const locale of LOCALES) {
  for (const motion of MOTION_PREFERENCES) {
    test(`opens the optional film by keyboard in ${locale.language} with ${motion.name}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "390", "run the focused media contract once at the phone viewport");
      await page.emulateMedia({ reducedMotion: motion.preference });

      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      await page.goto(locale.path, { waitUntil: "domcontentloaded" });
      await expect.poll(() => new URL(page.url()).pathname).toBe(locale.path);

      const sourceImage = page.locator("#s1 .paper-source img");
      await expect(sourceImage).toBeVisible();
      await expect.poll(() => sourceImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      const sourceImageUrl = await sourceImage.evaluate((image: HTMLImageElement) => image.currentSrc);
      const sourceImageKey = resourceKey(sourceImageUrl);
      await expect.poll(() => requests.some((url) => resourceKey(url) === sourceImageKey)).toBe(true);

      const disclosure = page.locator("#s2 details.lv2-film-story");
      const summary = disclosure.locator(":scope > summary");
      await expect(disclosure).toBeVisible();
      await expect(summary).toHaveText(locale.summary);
      await expect(disclosure).not.toHaveAttribute("open", "");
      await expect(disclosure.locator(".lv2-film")).toHaveCount(0);
      await expect(disclosure.locator("video, img")).toHaveCount(0);
      expect(
        requests.filter((url) => new URL(url).pathname.startsWith("/film/")),
        "film assets must not load before the disclosure opens",
      ).toEqual([]);

      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(disclosure).toHaveAttribute("open", "");
      await expect(disclosure.locator(".compile-film-motion-control")).toBeVisible();
      await expect.poll(() => requests.some((url) => new URL(url).pathname.startsWith("/film/"))).toBe(true);
    });
  }
}
