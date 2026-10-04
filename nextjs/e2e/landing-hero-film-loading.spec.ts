import { expect, test } from "@playwright/test";

const LOCALES = [
  { path: "/", language: "English", summary: "Watch the illustrative product walkthrough", focus: "Focus details", fit: "Fit full frame", fittedHint: "Full frame · Focus details to inspect small type.", focusedHint: "Focused view · Swipe or use arrow keys to inspect the frame." },
  { path: "/ko", language: "Korean", summary: "예시 제품 흐름 영상 보기", focus: "세부 내용 확대", fit: "전체 화면 보기", fittedHint: "전체 화면 · 작은 글자는 세부 내용 확대에서 확인하세요.", focusedHint: "확대 보기 · 옆으로 밀거나 방향키로 화면을 살펴보세요." },
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

      const sequence = disclosure.locator(".compile-film-sequence");
      const focusControl = disclosure.locator(".compile-film-focus-control");
      const viewport = disclosure.locator(".compile-film-viewport");
      const stages = disclosure.getByRole("tab");

      // The mounted phone player starts fitted and exposes the localized action and explanation.
      await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "0");
      await expect(focusControl).toHaveAttribute("aria-pressed", "false");
      await expect(focusControl).toHaveText(locale.focus);
      await expect(disclosure.locator(".compile-film-mobile-tools p")).toHaveText(locale.fittedHint);

      // Focus is an explicit opt-in and pans to the selected stage's authored pane.
      await focusControl.click();
      await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
      await expect(focusControl).toHaveAttribute("aria-pressed", "true");
      await expect(focusControl).toHaveText(locale.fit);
      await expect(disclosure.locator(".compile-film-mobile-tools p")).toHaveText(locale.focusedHint);
      await stages.nth(1).click();
      await expect(stages.nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "1");
      await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

      // Returning to fit works, and changing stages in fit mode keeps the visitor's choice.
      await focusControl.click();
      await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "1");
      await expect(focusControl).toHaveAttribute("aria-pressed", "false");
      await expect(focusControl).toHaveText(locale.focus);
      await stages.nth(0).click();
      await expect(stages.nth(0)).toHaveAttribute("aria-selected", "true");
      await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "0");
    });
  }
}
