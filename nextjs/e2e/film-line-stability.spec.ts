import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/*
  UX-L6 (UX-PLAN-2026-10-17 §3.6, §4.6, §8.2; R4-MJ1): the Home film's frame stays where it is
  when the film changes stage by itself.

  With motion on, the film in Fit advances about every 18 s with no input. The reading line above
  the frame wraps to one to three lines by stage, so before fix round 5 the frame moved 22.5px on
  every advance, and Chrome recorded single layout shifts up to 0.0624 that no visitor caused. The
  reading block now reserves its longest line (film-reading-layer.module.css). The phone test in
  hero-home-responsive.spec.ts measures the four stages by pressing their tabs under reduced
  motion. This file measures what a press cannot: the auto-advance itself, with motion on, through
  the layout-shift entries the browser records. §4.6 keeps the auto-advance only on that condition.

  Every scenario sets its own viewport from project 390, the pattern the phone specs already use.

  FINAL-SPEC 2026-10-26 (§2.1, D-7): the reading line is gone, and a phone opens on one source pane
  (Focus) rather than on Fit. The rule this file guards is unchanged -- the frame does not move when
  the film changes stage by itself -- so the stage is read from the tab the film selects
  (`aria-selected`), and the detector takes away the one thing that now keeps the frame still: a
  tab row whose height does not depend on the stage.
*/

const FILM = '#s1 figure[data-testid="landing-hero-film"]';
const STAGE_COUNT = 4;
/** The stage on screen: the index of the tab the film selected. */
const selectedStage = (page: Page) => page.locator(`${FILM} [role="tab"]`).evaluateAll(tabs => tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true"));
// The lane's acceptance (UX-PLAN §8.2, UX-L6): frame.top within ±0.5px, layout-shift sum <= 0.001.
const TOP_TOLERANCE = 0.5;
const SHIFT_BUDGET = 0.001;

type Shift = { value: number; startTime: number; hadRecentInput: boolean; sources: string[] };
type FrameTop = { min: number; max: number; frames: number; stop: boolean };

/* Every layout shift from the first paint on, with the elements the browser says moved. */
async function recordShifts(page: Page) {
  await page.addInitScript(() => {
    const store = window as unknown as { __shifts: unknown[] };
    store.__shifts = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node | null }[] })[]) {
        store.__shifts.push({
          value: entry.value,
          startTime: entry.startTime,
          hadRecentInput: entry.hadRecentInput,
          sources: (entry.sources ?? []).map(source => source.node instanceof Element
            ? `${source.node.tagName.toLowerCase()}${[...source.node.classList].map(name => `.${name}`).join("")}`
            : String(source.node?.nodeName ?? "")),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/*
  Waits for `advances` stage changes the film makes by itself. Returns the frame's top at each
  stage, its extremes sampled on every animation frame in between, and the layout shifts recorded
  from the first measured stage on. Nothing here touches the page -- no click, key or scroll -- so
  a shift in the record is one the film made. `before` runs once the film plays, before the
  watch starts (the detector below uses it to take the reservation away).
*/
async function watchAutoAdvance(page: Page, advances: number, before?: () => Promise<void>) {
  const film = page.locator(FILM);
  const sequence = film.locator(".compile-film-sequence");
  await expect(sequence).toHaveAttribute("data-narrow", "1");
  await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
  // Motion on: the cut plays, so the stage will advance without input.
  const video = film.locator("video.compile-film-video");
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState >= 2 && !node.paused && node.currentTime > 0), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  if (before) await before();
  await expect(film.locator("[data-film-reading] p"), "no reading line on Home (D-7)").toHaveCount(0);
  const first = await selectedStage(page);
  expect(first, "the film selects one of the four stages").toBeGreaterThanOrEqual(0);
  const startTime = await page.evaluate(() => {
    const store = window as unknown as { __frameTop: FrameTop };
    const frame = document.querySelector("#s1 .compile-film-viewport")!;
    store.__frameTop = { min: Infinity, max: -Infinity, frames: 0, stop: false };
    const tick = () => {
      const sample = store.__frameTop;
      if (sample.stop) return;
      const top = frame.getBoundingClientRect().top;
      sample.min = Math.min(sample.min, top);
      sample.max = Math.max(sample.max, top);
      sample.frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return performance.now();
  });
  const frame = film.locator(".compile-film-viewport");
  const tops = [(await frame.boundingBox())!.y];
  for (let step = 1; step <= advances; step++) {
    // 18 s per cut (lib/film-script.ts FILM_DURATION); the cut's own `ended` may come first.
    await expect.poll(() => selectedStage(page), { message: `auto-advance ${step}`, timeout: 30_000 }).toBe((first + step) % STAGE_COUNT);
    tops.push((await frame.boundingBox())!.y);
  }
  // Layout-shift entries are delivered after the frame that shifted; let the last one arrive.
  await page.waitForTimeout(1_000);
  const record = await page.evaluate(since => {
    const store = window as unknown as { __frameTop: FrameTop; __shifts: Shift[] };
    store.__frameTop.stop = true;
    return { sampled: store.__frameTop, shifts: store.__shifts.filter(shift => shift.startTime >= since), scrollY: window.scrollY };
  }, startTime);
  const counted = record.shifts.filter(shift => !shift.hadRecentInput);
  return {
    first,
    tops,
    ...record,
    inputShifts: record.shifts.length - counted.length,
    sum: counted.reduce((total, shift) => total + shift.value, 0),
  };
}

/*
  Three advances, so every stage's line is on screen once whichever stage the watch starts on
  (the acceptance asks for two). 430x932 is the width where the consent sheet opens at 8 s, so
  its arrival falls inside the watch as well.
*/
for (const [width, height] of [[390, 844], [430, 932]] as const) {
  for (const path of ["/", "/ko"]) {
    test(`with motion on, three auto-advances leave the phone film where it was (${path} ${width}x${height})`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "390", "sets its own viewport");
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await recordShifts(page);
      await page.goto(path);
      const run = await watchAutoAdvance(page, 3);
      await testInfo.attach(`auto-advance-${path === "/" ? "en" : "ko"}-${width}`, { body: JSON.stringify({ width, height, path, ...run }, null, 2), contentType: "application/json" });
      expect(run.scrollY, "unscrolled").toBe(0);
      expect(run.inputShifts, "no input during the watch").toBe(0);
      expect(run.sampled.frames, "the frame was sampled between advances").toBeGreaterThan(60);
      for (const [step, top] of run.tops.entries()) {
        expect(Math.abs(top - run.tops[0]!), `stage ${((run.first + step) % 4) + 1}: frame top as at the start`).toBeLessThanOrEqual(TOP_TOLERANCE);
      }
      expect(run.tops[0]! - run.sampled.min, "no frame between advances drew the film higher").toBeLessThanOrEqual(TOP_TOLERANCE);
      expect(run.sampled.max - run.tops[0]!, "no frame between advances drew the film lower").toBeLessThanOrEqual(TOP_TOLERANCE);
      expect(run.sum, "layout-shift sum over the auto-advances").toBeLessThanOrEqual(SHIFT_BUDGET);
    });
  }
}

/*
  The failure path: the same watch, with a stage-dependent height put above the frame through the
  CSSOM (the page's CSP allows no injected stylesheet). The tab row is given a floor of 0.3px per
  source pixel of the stage's pane offset (`--pane-y`: 380 / 238 / 186 / 180 since fix round R3), so it stands
  114 / 71.4 / 55.8 / 54px by stage and any three consecutive advances include a change of height:
  the frame has to move and the shift has to be recorded. If this passes with the assertions above,
  the watch can see nothing.
*/
test("the watch records the shift when the row above the frame changes height by stage (detector)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "sets its own viewport");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await recordShifts(page);
  await page.goto("/");
  const run = await watchAutoAdvance(page, 3, () => page.locator(`${FILM} .compile-film-stages`).evaluate(node => { (node as HTMLElement).style.minHeight = "calc(var(--pane-y) * 0.3px)"; }));
  await testInfo.attach("auto-advance-detector-en-390", { body: JSON.stringify(run, null, 2), contentType: "application/json" });
  expect(run.inputShifts, "no input during the watch").toBe(0);
  expect(Math.max(...run.tops.map(top => Math.abs(top - run.tops[0]!))), "the unreserved frame moves with the line").toBeGreaterThan(TOP_TOLERANCE);
  expect(run.sampled.max - run.sampled.min, "the sampler sees it move").toBeGreaterThan(TOP_TOLERANCE);
  expect(run.sum, "the shift is recorded").toBeGreaterThan(SHIFT_BUDGET);
});

/*
  The reservation's range. Fit puts the line above the frame up to 899px (and to 1023px under a
  coarse pointer), the player's NARROW_FRAME, and until UX-L6 the block was reserved only below
  768px: at 768-899 the 16px line takes one or two lines by stage, and the frame moved 24px (EN 768
  602.7 / 578.7 / 602.7 / 602.7, Chrome; p2-06-film-line/band-base.txt). Measured by pressing the
  four tabs under reduced motion, as hero-home-responsive.spec.ts does for 360-430 in Chrome.

  WebKit runs the whole range from 360, launched from this file as site-nav.spec.ts does (the phone
  the founder checks the site on is WebKit). Windows WebKit's classic scrollbar takes 10px, so at
  360 its column is 302px; there stage 4's caption beside the toggle wrapped to a third line and
  dropped the frame 21.2px, and the mono quote grew stage 1's three lines by 0.5px.
*/
const BAND: readonly (readonly [number, number])[] = [[768, 1024], [820, 1180], [899, 1024]];
const PHONES: readonly (readonly [number, number])[] = [[360, 800], [390, 844], [412, 915], [430, 932]];

async function frameTopByStage(page: Page, path: string) {
  await page.goto(path);
  const film = page.locator(FILM);
  const sequence = film.locator(".compile-film-sequence");
  await expect(sequence).toHaveAttribute("data-narrow", "1");
  await expect(sequence).toHaveAttribute("data-mobile-view", "focus");
  await page.evaluate(() => document.fonts.ready);
  const tops: number[] = [];
  for (let stage = 0; stage < STAGE_COUNT; stage++) {
    await film.getByRole("tab").nth(stage).click();
    await expect.poll(() => selectedStage(page)).toBe(stage);
    tops.push((await film.locator(".compile-film-viewport").boundingBox())!.y);
  }
  return tops;
}

function expectOneTop(tops: number[], label: string) {
  for (const [stage, top] of tops.entries()) {
    expect(Math.abs(top - tops[0]!), `${label} stage ${stage + 1}: frame top as on stage 1 (${tops.join(" / ")})`).toBeLessThanOrEqual(TOP_TOLERANCE);
  }
}

test("from 768px to the edge of Fit the frame top is the same on every stage", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "sets its own viewports");
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const measured: Record<string, number[]> = {};
  for (const [width, height] of BAND) {
    await page.setViewportSize({ width, height });
    for (const path of ["/", "/ko"]) {
      const tops = await frameTopByStage(page, path);
      measured[`${path} ${width}`] = tops;
      expectOneTop(tops, `${path} ${width}`);
    }
  }
  await testInfo.attach("band-frame-tops-chromium", { body: JSON.stringify(measured, null, 2), contentType: "application/json" });
});

test("webkit: the frame top is the same on every stage from 360px to the edge of Fit", async ({ playwright, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "sets its own viewports");
  test.skip(!existsSync(playwright.webkit.executablePath()), "WebKit is not installed in this runner (playwright install webkit)");
  test.setTimeout(240_000);
  const browser = await playwright.webkit.launch();
  const measured: Record<string, number[]> = {};
  try {
    for (const [width, height] of [...PHONES, ...BAND]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height }, reducedMotion: "reduce" });
      const page = await context.newPage();
      for (const path of ["/", "/ko"]) {
        const tops = await frameTopByStage(page, path);
        measured[`${path} ${width}`] = tops;
        expectOneTop(tops, `webkit ${path} ${width}`);
      }
      await context.close();
    }
  } finally {
    await testInfo.attach("band-frame-tops-webkit", { body: JSON.stringify(measured, null, 2), contentType: "application/json" });
    await browser.close();
  }
});
