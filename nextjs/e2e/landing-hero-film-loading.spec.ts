import { expect, test } from "@playwright/test";

/*
  Film loading states on the Release 2 Home (main dbe22b1e, PR #149).

  Written for the pre-Release-2 Home, where the walkthrough sat closed in `#s2 details.lv2-film-story`
  below a `#s1 .paper-source` image. Release 2 shows the four-stage film in #s1, right after the
  actions (components/landing-v2/hero-film-disclosure.tsx), so the same loading contract is asked of
  that structure, in both languages and both motion preferences, at the phone width:

  - the locked poster is the media the page asks for first, and it decodes;
  - under reduced motion no recording is requested until the visitor asks, by keyboard;
  - with motion allowed the recording starts by itself, after the poster;
  - the phone player opens fitted, and Focus details / Fit full frame and their hint follow the
    page's language and the selected stage.
*/
const FILM = '#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]';
const POSTER = "/film/poster-1-hero-2x.webp";
const LOCALES = [
  { path: "/", language: "English", play: "Play the compilation film", focus: "Focus details", fit: "Fit full frame", fittedHint: "Full frame · Focus details to inspect small type.", focusedHint: "Focused view · Swipe or use arrow keys to inspect the frame." },
  { path: "/ko", language: "Korean", play: "컴파일 영상 재생", focus: "세부 내용 확대", fit: "전체 프레임 보기", fittedHint: "전체 프레임 · 작은 글자는 세부 내용 확대에서 확인하세요.", focusedHint: "확대 보기 · 옆으로 밀거나 방향키로 화면을 살펴보세요." },
] as const;
const MOTION_PREFERENCES = [
  { preference: "reduce" as const, name: "reduced motion" },
  { preference: "no-preference" as const, name: "motion allowed" },
] as const;

const isRecording = (url: string) => {
  const { pathname } = new URL(url);
  return pathname.startsWith("/film/") && (pathname.endsWith(".mp4") || pathname.endsWith(".webm"));
};
const isPoster = (url: string) => new URL(url).pathname === POSTER;

for (const locale of LOCALES) {
  for (const motion of MOTION_PREFERENCES) {
    test(`loads the poster first and the film on request in ${locale.language} with ${motion.name}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "390", "run the focused media contract once at the phone viewport");
      await page.emulateMedia({ reducedMotion: motion.preference });

      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      await page.goto(locale.path, { waitUntil: "domcontentloaded" });
      await expect.poll(() => new URL(page.url()).pathname).toBe(locale.path);

      const film = page.locator(FILM);
      await expect(film).toBeVisible();
      await expect.poll(() => requests.some(isPoster), "the locked poster is requested").toBe(true);

      if (motion.preference === "reduce") {
        const poster = film.locator("img").first();
        await expect(poster).toBeVisible();
        await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
        expect(await poster.evaluate((image: HTMLImageElement) => new URL(image.currentSrc).pathname)).toBe(POSTER);
        await expect(film.locator("video")).toHaveCount(0);
        expect(requests.filter(isRecording), "no recording loads before the visitor asks").toEqual([]);

        const play = film.getByRole("button", { name: locale.play, exact: true });
        await play.focus();
        await expect(play).toBeFocused();
        await page.keyboard.press("Enter");
      }
      await expect(film.locator("video")).toHaveCount(1);
      await expect.poll(() => requests.some(isRecording), "the recording is requested").toBe(true);
      expect(requests.findIndex(isPoster), "the poster is asked for before the recording").toBeLessThan(requests.findIndex(isRecording));

      const sequence = film.locator(".compile-film-sequence");
      const focusControl = film.locator(".compile-film-focus-control");
      const viewport = film.locator(".compile-film-viewport");
      const hint = film.locator(".compile-film-mobile-tools p");
      const stages = film.getByRole("tab");

      // The phone player starts fitted and exposes the localized action and explanation.
      await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
      await expect(focusControl).toHaveAttribute("aria-pressed", "false");
      await expect(focusControl).toHaveText(locale.focus);
      await expect(hint).toHaveText(locale.fittedHint);

      /*
        Focus is an explicit opt-in and pans to the selected stage's authored pane. The pane is the stage's reading target in
        components/compile-stage-player.tsx STAGE_FRAMES (Files 1, Organize 1, Updates 0, Use with AI 3 on Release 2), not
        the stage's position, and a playing film advances by itself, so each check follows a stage the visitor chose.
      */
      await focusControl.click();
      await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
      await expect(focusControl).toHaveAttribute("aria-pressed", "true");
      await expect(focusControl).toHaveText(locale.fit);
      await expect(hint).toHaveText(locale.focusedHint);
      await stages.nth(2).click();
      await expect(stages.nth(2)).toHaveAttribute("aria-selected", "true");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "0");
      await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(0);
      await stages.nth(0).click();
      await expect(stages.nth(0)).toHaveAttribute("aria-selected", "true");
      await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "1");
      await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

      // Returning to fit works, and changing stages in fit mode keeps the visitor's choice.
      await focusControl.click();
      await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "1");
      await expect(focusControl).toHaveAttribute("aria-pressed", "false");
      await expect(focusControl).toHaveText(locale.focus);
      await stages.nth(2).click();
      await expect(stages.nth(2)).toHaveAttribute("aria-selected", "true");
      await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "0");
    });
  }
}
