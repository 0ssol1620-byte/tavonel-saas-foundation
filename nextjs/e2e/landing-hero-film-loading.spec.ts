import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/*
  Film loading states on the Release 2 Home (main dbe22b1e, PR #149).

  Written for the pre-Release-2 Home, where the walkthrough sat closed in `#s2 details.lv2-film-story`
  below a `#s1 .paper-source` image. Release 2 shows the four-stage film in #s1, right after the
  actions (components/landing-v2/hero-film-disclosure.tsx), so the same loading contract is asked of
  that structure, in both languages and both motion preferences, at the phone width:

  - the locked poster is the media the page asks for first, and it decodes;
  - under reduced motion no recording is requested until the visitor asks, by keyboard;
  - with motion allowed the recording starts by itself, after the poster;
  - the phone player opens fitted, and Focus details, its pressed state and its hint follow the
    page's language and the selected stage.

  Release 3 (main bcba7173, PR #150) re-cut the stage-1 poster: components/landing-v2/hero-film.tsx serves
  /film/poster-1-t3.00.webp (1440w) and /film/poster-1-t3.00-2x.webp (2880w) as one srcset, and a phone in Fit
  takes the 1440w file (main's e2e/landing-hero-mobile.spec.ts asserts the same currentSrc at 360 and 390).
  The locked poster here is that file; /film/poster-1-hero-2x.webp is no longer requested by Home.

  POSTER-RECUT (D-11, 2026-10-19): the stage-1 still is t = 8.16s, served from a <picture> as
  /film/poster-1-t8.16.avif (1440w) and -2x.avif (2880w), with the WebP pair of the same frame as the
  fallback. The poster this contract asks for first is the 1440px file of that frame, in whichever of
  the two formats the engine decodes (the last test below pins which).

  FINAL-SPEC 2026-10-26 §2.1 (acceptance 23-25, 28): below 768px Home opens on one source pane --
  Focus, pressed -- and the poster a phone asks for first is that pane's own 684x855 file, AVIF where
  the engine decodes it, never the 1440px frame. The view toggle is an icon named by its aria-label
  (the same localized "Focus details"), Home prints no hint paragraph (the strings stay for the
  player's other callers), and a press opens the whole frame (Fit). The pane follows the selected
  stage through `--pane-x` / `--pane-y` (STAGE_FRAMES.*.phonePane) instead of a scroll offset.
*/
const FILM = '#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]';
const POSTER = /^\/film\/poster-1-t8\.16-pane1-684x855\.(avif|webp)$/;
/** The 1440/2880px stage-1 frame, in either format, that a phone never asks for on the first screen (acceptance 25). */
const FRAME_POSTER = /^\/film\/poster-1-t8\.16(-2x)?\.(avif|webp)$/;
const LOCALES = [
  { path: "/", language: "English", play: "Play the compilation film", focus: "Focus details" },
  { path: "/ko", language: "Korean", play: "컴파일 영상 재생", focus: "세부 내용 확대" },
] as const;
const MOTION_PREFERENCES = [
  { preference: "reduce" as const, name: "reduced motion" },
  { preference: "no-preference" as const, name: "motion allowed" },
] as const;

const isRecording = (url: string) => {
  const { pathname } = new URL(url);
  return pathname.startsWith("/film/") && (pathname.endsWith(".mp4") || pathname.endsWith(".webm"));
};
const isPoster = (url: string) => POSTER.test(new URL(url).pathname);

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
        expect(await poster.evaluate((image: HTMLImageElement) => new URL(image.currentSrc).pathname)).toMatch(POSTER);
        expect(requests.filter(url => FRAME_POSTER.test(new URL(url).pathname)), "a phone asks for one first-screen poster, the pane").toEqual([]);
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
      /*
        Review 2026-10-26 B-2: in both motion preferences the playing cut asks for no frame poster. The <video> carries no
        poster attribute on a phone pane, and the pane's own still stays over the cut until its first frame, then goes.
        Until this check, the frame-poster count ran only under reduced motion, and a motion-allowed phone fetched two.
      */
      const video = film.locator("video");
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2), "the cut's first frame").toBe(true);
      expect(await video.getAttribute("poster"), "no frame poster on the phone pane's video").toBeNull();
      await expect(film.locator("[data-pane-hold]"), "the pane still is released at the first frame").toHaveCount(0);
      expect(requests.filter(url => FRAME_POSTER.test(new URL(url).pathname)), "a phone asks for one first-screen poster, the pane").toEqual([]);

      const sequence = film.locator(".compile-film-sequence");
      const focusControl = film.locator(".compile-film-focus-control");
      const hint = film.locator(".compile-film-mobile-tools p");
      const stages = film.getByRole("tab");
      const pane = () => sequence.evaluate(node => ["--pane-x", "--pane-y", "--pane-w"].map(name => (node as HTMLElement).style.getPropertyValue(name)));

      // The phone player opens on the stage's source pane: Focus, pressed, named in the page's language.
      await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
      await expect(focusControl).toHaveAttribute("aria-pressed", "true");
      await expect(focusControl).toHaveAccessibleName(locale.focus);
      await expect(hint, "Home prints no hint paragraph").toHaveCount(0);

      /*
        The pane follows the stage the visitor chose (STAGE_FRAMES.*.phonePane, 2880px source pixels): Updates opens
        {60, 186} 520 wide, Files {746, 380} 684 wide (fix round R3). A playing film advances by itself, so each check follows a stage the visitor chose.
        The reading target pane (`data-mobile-focus-pane`) is the stage's own, as before.
      */
      await stages.nth(2).click();
      await expect(stages.nth(2)).toHaveAttribute("aria-selected", "true");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "0");
      await expect.poll(pane).toEqual(["60", "186", "520"]);
      await stages.nth(0).click();
      await expect(stages.nth(0)).toHaveAttribute("aria-selected", "true");
      await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "1");
      await expect.poll(pane).toEqual(["746", "380", "684"]);

      // A press opens the whole frame (Fit), and changing stages in Fit keeps the visitor's choice.
      // Release 3 fix round 3, M1: one WAI-ARIA toggle whose name never changes; aria-pressed names the state.
      await focusControl.click();
      await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "1");
      await expect(focusControl).toHaveAttribute("aria-pressed", "false");
      await expect(focusControl).toHaveAccessibleName(locale.focus);
      await stages.nth(2).click();
      await expect(stages.nth(2)).toHaveAttribute("aria-selected", "true");
      await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
      await expect(sequence).toHaveAttribute("data-mobile-focus-pane", "0");
    });
  }
}

/*
  POSTER-RECUT (D-11, DECISION-REGISTER-2026-10-17; DESIGN_MASTER_V3 §22 "Hero poster <= 140KB AVIF").

  Three things the re-cut promises, asked of the files a browser is actually served, in Chromium and
  in WebKit (launched here, as film-line-stability does, so the chromium-only CI project covers both):

  - every Home AVIF is at most 140,000 bytes, and the still takes AVIF where the engine decodes it and
    its WebP fallback where it does not -- never neither;
  - the stage-1 Tier 2 bars sit over the document eyebrow in both 2880px files: painting them leaves no
    eyebrow ink above the title's cap line and none beside a bar, while the same rectangles held ink
    before they were painted (so a bar that drifted off the eyebrow fails here, not silently);
  - no request names a Release 3 stage-1 or stage-2 poster any more.

  The overprint is not zero: 2 rows (ORIGINAL) and 3 rows (EXTRACT) of eyebrow ink touch the cap tops
  under the bars' bottom edge, in every frame of cut 1 (public/film/README.md). This test holds the part
  that is true and does not claim the rest.
*/
const RECUT_AVIF = [
  "/film/poster-1-t8.16-pane1-684x855.avif",
  "/film/poster-1-t8.16-2x.avif", "/film/poster-1-t8.16.avif", "/film/poster-2-t9.28-2x.avif", "/film/poster-2-t9.28.avif",
  "/film/poster-3-t17.96-2x.avif", "/film/poster-3-t17.96.avif", "/film/poster-4-t17.96-2x.avif", "/film/poster-4-t17.96.avif",
];
const SUPERSEDED = /\/film\/poster-[12]-t(3\.00|17\.96)(-2x)?\.webp$/;

async function posterContract(page: Page, engine: string) {
  const requests: string[] = [];
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  await page.goto("/");
  const still = page.locator(`${FILM} img.compile-film-still`);
  await expect.poll(() => still.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const result = await page.evaluate(async ({ avif }) => {
    const sizes: Record<string, number> = {};
    for (const url of avif) sizes[url] = (await (await fetch(url)).arrayBuffer()).byteLength;
    const decodes = async (url: string) => { try { await createImageBitmap(await (await fetch(url)).blob()); return true; } catch { return false; } };
    const still = document.querySelector<HTMLImageElement>("img.compile-film-still")!;
    const rects = [...document.querySelectorAll(".compile-film-mask rect")].map(rect => ["x", "y", "width", "height"].map(name => Number(rect.getAttribute(name))));
    const color = document.querySelector(".compile-film-mask rect")?.getAttribute("fill") ?? "";
    const label = async (url: string) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      const inkIn = (x: number, y: number, w: number, h: number) => {
        const { data } = context.getImageData(x, y, w, h);
        let ink = 0;
        for (let i = 0; i < data.length; i += 4) if (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! < 150) ink++;
        return ink;
      };
      const before = rects.map(([x, y, w, h]) => inkIn(x!, y!, w!, h!));
      context.fillStyle = color;
      for (const [x, y, w, h] of rects) context.fillRect(x!, y!, w!, h!);
      const above = rects.map(([x, y, w]) => inkIn(x!, y! - 3, w!, 3));
      const beside = rects.map(([x, y, w, h]) => inkIn(x! - 6, y!, 6, h!) + inkIn(x! + w!, y!, 6, h!));
      return { width: bitmap.width, before, above, beside };
    };
    const webp = "/film/poster-1-t8.16-2x.webp";
    const avifDecodes = await decodes("/film/poster-1-t8.16-2x.avif");
    return {
      sizes, avifDecodes, currentSrc: new URL(still.currentSrc).pathname, rects, color,
      maskPoster: document.querySelector(".compile-film-mask")?.getAttribute("data-poster-mask") ?? "",
      labels: { [webp]: await label(webp), ...(avifDecodes ? { "/film/poster-1-t8.16-2x.avif": await label("/film/poster-1-t8.16-2x.avif") } : {}) },
    };
  }, { avif: RECUT_AVIF });

  for (const [url, bytes] of Object.entries(result.sizes)) expect(bytes, `${engine} ${url} within the §22 AVIF budget`).toBeLessThanOrEqual(140_000);
  // The still is one of the two formats of the re-cut frame, AVIF exactly when the engine decodes it; below 768px it is
  // the stage-1 pane's own file (FINAL-SPEC 2026-10-26 §2.1), above it the 1440/2880px frame.
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  expect(result.currentSrc, `${engine} still`).toMatch(new RegExp(`^/film/poster-1-t8\\.16${phone ? "-pane1-684x855" : "(-2x)?"}\\.${result.avifDecodes ? "avif" : "webp"}$`));
  expect(result.maskPoster).toBe("/film/poster-1-t8.16-2x.webp");
  expect(result.rects).toHaveLength(2);
  for (const [url, label] of Object.entries(result.labels)) {
    expect(label.width, url).toBe(2880);
    for (const ink of label.before) expect(ink, `${engine} ${url}: a bar is over eyebrow ink`).toBeGreaterThan(100);
    expect(label.above, `${engine} ${url}: no eyebrow ink above a bar`).toEqual([0, 0]);
    expect(label.beside, `${engine} ${url}: no eyebrow ink beside a bar`).toEqual([0, 0]);
  }
  expect(requests.filter(path => SUPERSEDED.test(path)), `${engine}: no Release 3 stage-1/2 poster`).toEqual([]);
  return result;
}

test("serves the re-cut posters as AVIF within 140,000 bytes, with a WebP fallback, and bars that cover the eyebrow", async ({ page, playwright, baseURL, browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "run the poster contract once, at the phone viewport");
  test.skip(browserName !== "chromium", "the page fixture is the Chromium half; WebKit is launched below");
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const chromium = await posterContract(page, "chromium");
  expect(chromium.avifDecodes, "Chromium decodes AVIF").toBe(true);
  expect(chromium.currentSrc, "a phone takes the stage-1 pane AVIF").toBe("/film/poster-1-t8.16-pane1-684x855.avif");
  const measured: Record<string, unknown> = { chromium };
  if (existsSync(playwright.webkit.executablePath())) {
    const browser = await playwright.webkit.launch();
    try {
      const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
      measured.webkit = await posterContract(await context.newPage(), "webkit");
      await context.close();
    } finally {
      await browser.close();
    }
  }
  await testInfo.attach("poster-recut-contract", { body: JSON.stringify(measured, null, 2), contentType: "application/json" });
});
